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

test('remote.account 适配为 api.account.getBalance，缺失时不暴露', async () => {
    const calls = [];
    const account = {
        getBalance(metadata) {
            calls.push(metadata);
            return Promise.resolve({ status: 'ready', value: [], bonusWallets: [] });
        },
    };
    const api = resolveHostApi({ rpc: { call() {} } }, { remoteAccount: account });
    const metadata = { version: '0.2.0', locale: 'zh', timezoneOffsetSeconds: 28800 };
    assert.deepEqual(await api.account.getBalance(metadata), {
        status: 'ready',
        value: [],
        bonusWallets: [],
    });
    assert.deepEqual(calls, [metadata]);

    const without = resolveHostApi({ rpc: { call() {} } }, {});
    assert.equal(without.account, undefined);
});

test('remote.account 的 { ok, value } 信封被拆开，失败信封转成异常', async () => {
    const ready = { status: 'ready', value: [{ currency: 'CNY', balance: '18.25' }], bonusWallets: [] };
    const wrapped = resolveHostApi(
        { rpc: { call() {} } },
        { remoteAccount: { getBalance: async () => ({ ok: true, value: ready }) } }
    );
    assert.deepEqual(await wrapped.account.getBalance({}), ready);

    // 签出（value=null）也要保持 null，宠物侧据此显示"未登录"
    const signedOut = resolveHostApi(
        { rpc: { call() {} } },
        { remoteAccount: { getBalance: async () => ({ ok: true, value: null }) } }
    );
    assert.equal(await signedOut.account.getBalance({}), null);

    const failed = resolveHostApi(
        { rpc: { call() {} } },
        {
            remoteAccount: {
                getBalance: async () => ({ ok: false, error: { message: 'host exploded', code: 'EBOOM' } }),
            },
        }
    );
    await assert.rejects(failed.account.getBalance({}), /host exploded/);
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

// ---- 子代理（subagent）会话判定 -------------------------------------------
// 宿主把子代理实现成独立的子会话：它们会出现在会话列表里（flattenLineage 按
// parentId 缩进）、各自发 turn/end，但绝不是用户正在对话的会话，完成时不该提示。

test('子代理会话判定：列表行 origin=subagent 即子代理，普通会话不受影响', () => {
    const list = observable({
        current: 's1',
        ids: ['s1', 'child'],
        byId: {
            s1: { running: false },
            child: { running: true, origin: 'subagent', parentId: 's1' },
        },
    });
    const api = resolveHostApi({ rpc: { call() {} } }, { sessions: { list }, remote: { session: {} } });
    assert.equal(api.isSubagentSession('s1'), false, '普通会话不是子代理');
    assert.equal(api.isSubagentSession('child'), true, '子代理会话必须被认出来');
    assert.equal(api.isSubagentSession(''), false);
    assert.equal(api.isSubagentSession(undefined), false);
});

test('子代理会话判定：列表行缺 origin 时回落到 sessions.subagentAddress', () => {
    const list = observable({ current: 's1', ids: ['s1'], byId: { s1: { running: false } } });
    const sessions = {
        list,
        // 宿主子代理目录派生：子代理刚结束、列表行还没带 origin 时仍能认出来
        subagentAddress: (id) =>
            id === 'ghost' ? { parentSessionId: 's1', childSessionId: 'ghost', mode: 'one-shot' } : undefined,
    };
    const api = resolveHostApi({ rpc: { call() {} } }, { sessions, remote: { session: {} } });
    assert.equal(api.isSubagentSession('ghost'), true);
    assert.equal(api.isSubagentSession('s1'), false);
});

test('子代理会话判定：没有 sessions 服务（旧宿主）时不暴露该方法', () => {
    const api = resolveHostApi({ rpc: { call() {} } }, { remote: { session: {} } });
    assert.equal(api.isSubagentSession, undefined);
});
