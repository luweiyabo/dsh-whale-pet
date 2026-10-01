import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHostApi, subscribeSessionActivity } from '../src/client/host-api.js';

function observable(initial) {
    let value = initial;
    const listeners = new Set();
    return {
        getSnapshot: () => value,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        set(next) {
            value = next;
            for (const listener of listeners) listener();
        },
    };
}

const waitFor = async (predicate, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.fail(message);
};

test('新版宿主 API 转发配置 RPC，并优先读取模型投影', async () => {
    const calls = [];
    const connection = {
        rpc: {
            async call(namespace, endpoint, payload) {
                calls.push({ namespace, endpoint, payload });
                return { ok: true, value: endpoint === 'session/modelCatalog' ? { default: fallback } : {} };
            },
        },
    };
    const projected = { provider: 'deepseek', model: 'deepseek-chat' };
    const fallback = { provider: 'moonshot', model: 'kimi-k2' };
    const projection = observable({ next: projected });
    const sessions = {
        list: observable({ current: 's1', ids: ['s1'], byId: { s1: { running: false } } }),
        binding: () => ({ session: { projections: { faceOf: () => projection } } }),
    };
    const api = resolveHostApi(connection, { sessions, remote: { session: {} } });

    await api.settings.describe();
    await api.settings.update({ namespace: 'whale-pet' });
    assert.deepEqual((await api.sessions.models({ sessionId: 's1' })).result.value.current, projected);
    assert.deepEqual(
        calls.map(({ namespace, endpoint }) => [namespace, endpoint]),
        [
            ['/api', 'settings/describe'],
            ['/api', 'settings/update'],
        ]
    );

    projection.set(undefined);
    assert.deepEqual((await api.sessions.models({ sessionId: 's1' })).result.value.current, fallback);
    assert.equal(calls.at(-1).endpoint, 'session/modelCatalog');
});

test('旧版 connection.api 保持原样返回', () => {
    const legacy = { settings: {}, events: {} };
    assert.equal(resolveHostApi({ api: legacy, rpc: { call() {} } }), legacy);
});

test('会话 follow 只恢复未结束回合，转发实时事件并在断线后重建快照', async () => {
    const list = observable({ current: 's1', ids: ['s1'], byId: { s1: { running: true } } });
    const pending = observable(new Map([['s1', { key: 'approval:1', kind: 'approval' }]]));
    let followCount = 0;
    const remote = {
        session: {
            async *follow() {
                followCount++;
                if (followCount === 1) {
                    yield {
                        type: 'snapshot',
                        cursor: 3,
                        records: [
                            { type: 'event', event: { seq: 1, type: 'turn/end', data: {} } },
                            { type: 'event', event: { seq: 2, type: 'turn/start', data: {} } },
                            { type: 'event', event: { seq: 3, type: 'tool/call', data: { name: 'write' } } },
                        ],
                        projections: {
                            values: {
                                modelSelection: { next: { provider: 'deepseek', model: 'deepseek-chat' } },
                            },
                        },
                    };
                    yield { type: 'event', event: { seq: 4, type: 'approval/asked', data: {} } };
                    yield {
                        type: 'event',
                        event: { seq: 5, type: 'turn/end', data: { reason: { kind: 'error' } } },
                    };
                    return;
                }
                yield {
                    type: 'snapshot',
                    cursor: 5,
                    records: [
                        { type: 'event', event: { seq: 4, type: 'approval/asked', data: {} } },
                        { type: 'event', event: { seq: 5, type: 'turn/end', data: {} } },
                    ],
                };
                await new Promise(() => {});
            },
        },
    };
    const sessions = {
        list,
        binding: () => ({ session: { getSnapshot: () => ({ queue: [] }), subscribe: () => () => {} } }),
    };
    const frames = [];
    const stop = subscribeSessionActivity(
        { sessions, remote, uiSession: { pendingInteractions: pending } },
        (frame) => frames.push(frame),
        { reconnectMs: 1, scope: 'current' }
    );

    await waitFor(() => followCount === 2, 'follow 流结束后应重新连接');
    stop();

    const restored = frames.filter((frame) => frame.type === 'session/event' && frame.snapshot);
    assert.deepEqual(
        restored.map((frame) => frame.event.type),
        ['turn/start', 'tool/call', 'model/selection'],
        '历史中已经结束的回合以及重连后的已结束历史都不应重新触发'
    );
    assert.ok(frames.some((frame) => frame.type === 'approval/requested' && !frame.snapshot));
    assert.ok(frames.some((frame) => frame.type === 'host/agent-error'));
    assert.ok(frames.some((frame) => frame.type === 'approval/requested' && frame.snapshot));
});
