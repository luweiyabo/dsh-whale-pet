import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHostApi, subscribeSessionActivity } from '../src/client/host-api.js';
import * as host from '../lib/index.js';

function observable(value) {
    const listeners = new Set();
    return {
        getSnapshot: () => value,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        set(next) {
            value = next;
            for (const fn of listeners) fn();
        },
    };
}

// ---------------------------------------------------------------------------
// 0.2.0 设置适配：remote.settings（typert Remote 子服务）信封 → 内部旧形状
// ---------------------------------------------------------------------------
test('resolveHostApi：无 connection 时经 getSettings(remote.settings) 读写，并接线会话订阅', async () => {
    const calls = [];
    const svc = {
        async describe() {
            return {
                ok: true,
                value: {
                    writable: true,
                    hasDocument: true,
                    namespaces: [{ ns: 'whale-pet', value: { size: 400 } }],
                },
            };
        },
        async update(...args) {
            calls.push(args);
            return { ok: true, value: { ns: 'whale-pet' } };
        },
    };
    const sessions = { list: observable({ ids: [], byId: {} }) };
    const api = resolveHostApi(undefined, {
        getSettings: () => svc,
        sessions,
        remote: { session: {} },
    });

    assert.ok(api, '应返回 api');
    const described = await api.settings.describe();
    assert.equal(described.result.ok, true);
    assert.equal(described.result.value.namespaces[0].value.size, 400);

    await api.settings.update({ ns: 'whale-pet', patch: { size: 450 } });
    assert.deepEqual(calls, [['whale-pet', { size: 450 }, undefined]]);
    assert.equal(typeof api.subscribeActivity, 'function');
});

test('resolveHostApi：0.2.0 设置未就绪时 describe 返回 ok:false 而非抛错', async () => {
    const api = resolveHostApi(undefined, {
        getSettings: () => undefined,
        sessions: { list: observable({ ids: [], byId: {} }) },
    });
    const described = await api.settings.describe();
    assert.equal(described.result.ok, false);
});

// ---------------------------------------------------------------------------
// 0.2.0 会话形状：uiSession.sessionStatus / uiSession.current / pendingSubmissions
// ---------------------------------------------------------------------------
test('subscribeSessionActivity：从 sessionStatus.pendingInteraction 读取审批/问答，并从 uiSession.current 取当前会话', async () => {
    const status = observable(
        new Map([['s1', { running: true, pendingInteraction: { key: 'approval:1', kind: 'approval' } }]])
    );
    const current = observable({ key: 's1' });
    const list = observable({ ids: ['s1'], byId: { s1: { running: true } } });
    const remote = {
        session: {
            async *follow() {
                await new Promise(() => {});
            },
        },
    };
    const sessions = {
        list,
        binding: () => ({
            session: {
                getSnapshot: () => ({ pendingSubmissions: [{ requestId: 'q1', placement: 'queued' }] }),
                subscribe: () => () => {},
            },
        }),
    };
    const frames = [];
    const stop = subscribeSessionActivity(
        { sessions, remote, uiSession: { sessionStatus: status, current } },
        (frame) => frames.push(frame),
        { scope: 'current' }
    );
    await new Promise((r) => setTimeout(r, 5));
    stop();

    assert.ok(
        frames.some((f) => f.type === 'approval/requested' && f.sessionId === 's1'),
        '应识别审批请求'
    );
    assert.ok(
        frames.some((f) => f.type === 'session/queue' && Array.isArray(f.items) && f.items.length === 1),
        '应从 pendingSubmissions 识别排队消息'
    );
});

// ---------------------------------------------------------------------------
// 宿主半侧：静态 Config 导出 + settings.register 存在才调用
// ---------------------------------------------------------------------------
test('lib/index.js 导出静态 Config（0.2.0 settings schema）', () => {
    assert.ok(host.Config, '应导出 Config');
    // schemastery schema 是可调用对象（function 形态）
    assert.equal(typeof host.Config, 'function');
});

test('lib/index.js apply 在 settings 服务没有 register（0.2.0）时不抛错', () => {
    const ctx = {
        settings: {
            describe: () => [{ ns: 'whale-pet', value: { size: 400 } }],
            update: async () => ({}),
        },
        webServer: { register: () => () => {} },
        effect: (fn) => fn(),
        get: (name) => (name === 'llm' ? { listConfigurableProviders: () => [] } : undefined),
    };
    assert.doesNotThrow(() => host.apply(ctx, { size: 400, position: 'bottom-right' }));
});
