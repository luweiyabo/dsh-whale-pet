import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createRemoteSessionGetter,
    createSettingsGetter,
    resolveHostApi,
    subscribeSessionActivity,
} from '../src/client/host-api.js';

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

test('modern 宿主先刷新模型投影再返回当前模型', async () => {
    let refreshed = 0;
    const projection = observable({});
    const sessions = {
        list: observable({ current: 's1', ids: ['s1'], byId: { s1: { running: false } } }),
        async refreshProjections(sessionId) {
            refreshed += 1;
            projection.set({ next: { provider: 'deepseek', model: 'deepseek-chat' } });
            return sessionId;
        },
        binding: () => ({ session: { projections: { faceOf: () => projection } } }),
    };
    const settings = {
        describe: async () => ({ ok: true, value: { namespaces: [] } }),
        update: async () => ({ ok: true, value: {} }),
    };
    const api = resolveHostApi(
        {},
        { sessions, remote: { session: {} }, modern: true, getSettings: () => settings }
    );
    assert.deepEqual((await api.sessions.models({ sessionId: 's1' })).result.value.current, {
        provider: 'deepseek',
        model: 'deepseek-chat',
    });
    assert.equal(refreshed, 1);
});

test('modern 宿主投影刷新后仍为空时返回 undefined，不伪造模型', async () => {
    const sessions = {
        list: observable({ current: 's1', ids: ['s1'], byId: { s1: {} } }),
        async refreshProjections() {},
        binding: () => ({ session: { projections: { faceOf: () => observable({}) } } }),
    };
    const settings = {
        describe: async () => ({ ok: true, value: { namespaces: [] } }),
        update: async () => ({ ok: true, value: {} }),
    };
    const api = resolveHostApi(
        {},
        { sessions, remote: { session: {} }, modern: true, getSettings: () => settings }
    );
    assert.equal((await api.sessions.models({ sessionId: 's1' })).result.value.current, undefined);
});

test('优先使用官方 model directory 的 current（含新会话默认模型）', async () => {
    const projection = observable({});
    const sessions = {
        list: observable({ current: 's1', ids: ['s1'], byId: { s1: {} } }),
        binding: () => ({ session: { projections: { faceOf: () => projection } } }),
    };
    const connection = {
        rpc: {
            async call() {
                throw new Error('should not call');
            },
        },
    };
    const api = resolveHostApi(connection, {
        sessions,
        remote: { session: {} },
        modelDirectories: {
            directoryFor() {
                return {
                    async load() {},
                    store: {
                        getSnapshot: () => ({
                            current: { provider: 'deepseek-account', model: 'deepseek-flash' },
                        }),
                    },
                };
            },
        },
    });
    assert.deepEqual((await api.sessions.models({ sessionId: 's1' })).result.value.current, {
        provider: 'deepseek-account',
        model: 'deepseek-flash',
    });
});

test('model directory 不可用时回落到会话投影', async () => {
    const projected = { provider: 'moonshot', model: 'kimi-k2' };
    const projection = observable({ next: projected });
    const sessions = {
        list: observable({ current: 's1', ids: ['s1'], byId: { s1: {} } }),
        binding: () => ({ session: { projections: { faceOf: () => projection } } }),
    };
    const api = resolveHostApi(
        {
            rpc: {
                async call() {
                    throw new Error('should not call');
                },
            },
        },
        {
            sessions,
            remote: { session: {} },
            modelDirectories: {
                directoryFor() {
                    throw new Error('no scope');
                },
            },
        }
    );
    assert.deepEqual((await api.sessions.models({ sessionId: 's1' })).result.value.current, projected);
});

test('model directory 缺失时用官方 modelCatalog 默认模型', async () => {
    const sessions = {
        list: observable({ current: 's1', ids: ['s1'], byId: { s1: {} } }),
        binding: () => ({ session: { projections: { faceOf: () => observable({}) } } }),
    };
    const api = resolveHostApi(
        {},
        {
            sessions,
            remoteSession: {
                async modelCatalog() {
                    return {
                        ok: true,
                        value: { default: { provider: 'deepseek-account', model: 'deepseek-flash' } },
                    };
                },
            },
            modern: true,
            getSettings: () => ({
                describe: async () => ({ ok: true, value: { namespaces: [] } }),
                update: async () => ({ ok: true, value: {} }),
            }),
        }
    );
    assert.deepEqual((await api.sessions.models({ sessionId: 's1' })).result.value.current, {
        provider: 'deepseek-account',
        model: 'deepseek-flash',
    });
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

// ---- remote.settings 取法（0.2.2 traced 子服务） ---------------------------
// 0.2.2 起 remote 的子命名空间是 traced service：属性访问（ctx.remote.settings /
// ctx.get('remote').settings）会被转成 `ctx['remote.settings']` 并走 ctx 的 inject
// 守卫，客户端半侧没注入该命名空间时抛错。服务名读取（ctx.get）不受守卫约束，
// 必须先试；否则设置面板会等满超时后显示"无法读取设置"。
function settingsNamespace() {
    return {
        async describe() {
            return {
                ok: true,
                value: { namespaces: [{ ns: 'whale-pet', value: { visible: true }, revision: 0 }] },
            };
        },
        async update() {
            return { ok: true, value: {} };
        },
    };
}

test('traced remote.settings 属性访问被 inject 守卫拒绝时，改用服务名读取', async () => {
    const settings = settingsNamespace();
    const ctx = {
        get(name) {
            return name === 'remote.settings' ? settings : undefined;
        },
    };
    const guardedRemote = new Proxy(
        {},
        {
            get() {
                throw new Error('cannot get property "settings" without inject');
            },
        }
    );
    const getSettings = createSettingsGetter(ctx, guardedRemote);
    assert.equal(getSettings(), settings, '属性访问抛错不能挡住服务名读取的结果');

    const api = resolveHostApi({}, { modern: true, getSettings });
    const result = await api.settings.describe();
    assert.equal(result.result.ok, true);
    assert.equal(result.result.value.namespaces[0].ns, 'whale-pet');
});

test('旧宿主没有 remote.settings 服务名时，回落到属性访问', () => {
    const settings = settingsNamespace();
    const ctx = {
        get() {
            throw new Error('cannot get property "remote.settings" without inject');
        },
    };
    assert.equal(createSettingsGetter(ctx, { settings })(), settings);
});

test('设置服务始终不可用时超时返回失败信封，面板据此显示"无法读取设置"', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const ctx = { get: () => undefined };
    const api = resolveHostApi(
        {},
        { modern: true, settingsTimeoutMs: 20, getSettings: createSettingsGetter(ctx, undefined) }
    );
    const result = await api.settings.describe();
    assert.equal(result.result.ok, false, '服务始终缺失时 describe 必须回失败信封而不是抛错');
    assert.equal(result.result.value, null);
});

// ---- remote.session / uiSession 取法（0.2.2 惰性服务） --------------------
// 与 remote.settings 同规则：属性访问会撞 Cordis 的 inject 守卫，服务名读取不受限；
// 且这些服务可能晚于挂载就绪，必须惰性读取而不是 mount 时抓快照。
test('traced remote.session 属性访问被 inject 守卫拒绝时，改用服务名读取', () => {
    const session = { follow() {} };
    const ctx = {
        get(name) {
            return name === 'remote.session' ? session : undefined;
        },
    };
    const guardedRemote = new Proxy(
        {},
        {
            get() {
                throw new Error('cannot get property "session" without inject');
            },
        }
    );
    assert.equal(createRemoteSessionGetter(ctx, guardedRemote)(), session);
});

test('旧宿主没有 remote.session 服务名时，回落到属性访问', () => {
    const session = { follow() {} };
    const ctx = {
        get() {
            throw new Error('cannot get property "remote.session" without inject');
        },
    };
    assert.equal(createRemoteSessionGetter(ctx, { session })(), session);
});

test('uiSession 是惰性 getter：服务晚于 resolveHostApi 就绪时也能读到', () => {
    let service;
    const api = resolveHostApi(
        {},
        {
            modern: true,
            getSettings: () => ({ describe() {}, update() {} }),
            getUiSession: () => service,
        }
    );
    assert.equal(api.uiSession, undefined, '服务未就绪时不应抛出，也不应伪造');
    const current = { getSnapshot: () => ({ key: 's1' }), subscribe: () => () => {} };
    service = { current };
    assert.equal(api.uiSession, service, '服务就绪后同一个 api 对象应能读到');
});

test('settings.update 失败时保留宿主错误码，供调用方区分并发冲突', async () => {
    const svc = {
        describe: async () => ({ ok: true, value: { namespaces: [] } }),
        update: async () => ({
            ok: false,
            error: { code: 'settings/conflict', message: 'settings namespace changed since it was read' },
        }),
    };
    const api = resolveHostApi({}, { modern: true, getSettings: () => svc });
    await assert.rejects(
        api.settings.update({ ns: 'whale-pet', patch: { visible: false }, expectedRevision: 1 }),
        (error) => error.code === 'settings/conflict'
    );
});
