import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { resolveHostApi, subscribeSessionActivity } from '../src/client/host-api.js';
import { createActivitySystem } from '../src/client/activity.js';

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
        get count() {
            return listeners.size;
        },
    };
}

function fixture() {
    const list = observable({
        ids: ['a', 'b'],
        current: 'a',
        byId: { a: { running: true }, b: { running: true } },
    });
    const pendingInteractions = observable(new Map());
    const calls = [];
    const remote = {
        session: {
            follow(request, signal) {
                const values = [];
                let wake;
                let ended = false;
                const stream = {
                    request,
                    signal,
                    push(value) {
                        values.push(value);
                        wake?.();
                    },
                    end() {
                        ended = true;
                        wake?.();
                    },
                    async *[Symbol.asyncIterator]() {
                        while (!ended && !signal.aborted) {
                            if (values.length) yield values.shift();
                            else
                                await new Promise((resolve) => {
                                    wake = resolve;
                                });
                        }
                    },
                };
                signal.addEventListener('abort', () => wake?.(), { once: true });
                calls.push(stream);
                return stream;
            },
        },
    };
    return { sessions: { list }, uiSession: { pendingInteractions }, remote, calls };
}
const event = (type, seq, data = {}) => ({ type: 'event', event: { type, seq, data } });
const snapshot = (cursor, records = [], model) => ({
    type: 'snapshot',
    cursor,
    records,
    projections: { values: { modelSelection: model } },
});

test('新版模型优先读取待用选择，空会话回落宿主默认模型', async () => {
    let model = { next: { provider: 'custom', model: 'next' }, lastUsed: { provider: 'old', model: 'old' } };
    const calls = [];
    const sessions = {
        list: observable({}),
        binding: () => ({ session: { projections: { faceOf: () => ({ getSnapshot: () => model }) } } }),
    };
    const api = resolveHostApi(
        {
            rpc: {
                call: async (...args) => {
                    calls.push(args);
                    return { ok: true, value: { default: { provider: 'deepseek', model: 'default' } } };
                },
            },
        },
        { sessions, remote: { session: {} } }
    );
    assert.equal((await api.sessions.models({ sessionId: 'a' })).result.value.current.model, 'next');
    assert.equal(calls.length, 0);
    model = null;
    assert.equal((await api.sessions.models({ sessionId: 'a' })).result.value.current.model, 'default');
    assert.deepEqual(calls[0].slice(0, 3), ['/api', 'session/modelCatalog', { args: {} }]);
});

test('新版 current 范围切换取消旧订阅，丢弃迟到帧，卸载释放全部监听', async () => {
    const f = fixture();
    const frames = [];
    const stop = subscribeSessionActivity(f, (frame) => frames.push(frame), { scope: 'current' });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].request, {
        address: { kind: 'session', sessionId: 'a' },
        assistantStream: true,
        maxMessages: 1,
    });
    f.sessions.list.set({ ...f.sessions.list.getSnapshot(), current: 'b' });
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.calls.length, 2);
    f.calls[0].push(event('tool/call', 2, { name: 'write' }));
    await delay(5);
    assert.equal(
        frames.some((frame) => frame.event?.type === 'tool/call'),
        false
    );
    stop();
    assert.ok(f.calls.every((call) => call.signal.aborted));
    assert.equal(f.sessions.list.count, 0);
    assert.equal(f.uiSession.pendingInteractions.count, 0);
});

test('新版快照恢复未结束回合但不重放规则/用量，实时帧按游标去重', async () => {
    const f = fixture();
    const system = createActivitySystem({ normalizeAnimId: (id) => id });
    let state;
    const models = [];
    const rules = [];
    let usage = 0;
    const stop = system.startActivitySensor(
        { subscribeActivity: (emit, opts) => subscribeSessionActivity(f, emit, opts) },
        (next) => {
            state = next;
        },
        {
            scope: 'current',
            onModel: (model) => models.push(model),
            onUsage: () => usage++,
            rules: [
                {
                    id: 'write',
                    enable: true,
                    when: [{ field: 'type', op: 'eq', value: 'tool/call' }],
                    cooldownMs: 1000,
                    holdMs: 1000,
                },
            ],
            onRuleFired: (id) => rules.push(id),
        }
    );
    f.calls[0].push(
        snapshot(
            5,
            [
                event('turn/start', 1),
                event('tool/call', 2, { name: 'write', turn: 1, step: 1 }),
                event('assistant/message', 3, { usage: {} }),
            ],
            { next: { provider: 'p', model: 'm' } }
        )
    );
    await delay(5);
    assert.ok(state.active.CODING);
    assert.equal(usage, 0);
    assert.deepEqual(rules, []);
    assert.equal(models[0].model, 'm');
    f.calls[0].push(event('assistant/message', 6, { usage: {} }));
    f.calls[0].push(event('assistant/message', 6, { usage: {} }));
    await delay(5);
    assert.equal(usage, 1);
    stop();
});

test('新版断线仅重开失效流，重新读快照，销毁后不再重连', async () => {
    const f = fixture();
    const stop = subscribeSessionActivity(f, () => {}, { reconnectMs: 5 });
    assert.equal(f.calls.length, 2);
    f.calls[0].end();
    await delay(20);
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[1].signal.aborted, false);
    stop();
    await delay(15);
    assert.equal(f.calls.length, 3);
});

test('新版聚合状态隔离会话、保留规则脉冲，并恢复问答等待与错误', async () => {
    let emit;
    let state;
    const system = createActivitySystem({ normalizeAnimId: (id) => id });
    const stop = system.startActivitySensor(
        {
            subscribeActivity: (fn) => {
                emit = fn;
                return () => {};
            },
        },
        (next) => {
            state = next;
        },
        { errorHoldMs: 5 }
    );
    emit({ type: 'session/event', sessionId: 'a', event: { type: 'tool/call', data: { name: 'write' } } });
    emit({ type: 'session/event', sessionId: 'b', event: { type: 'turn/end', data: {} } });
    assert.ok(state.active.CODING);
    emit({ type: 'question/requested', sessionId: 'b' });
    assert.ok(state.active.WAITING_USER);
    emit({ type: 'activity/reset', sessionId: 'b' });
    assert.equal(state.active.WAITING_USER, undefined);
    assert.ok(state.active.CODING);
    emit({
        type: 'session/event',
        sessionId: 'a',
        event: { type: 'turn/end', data: { reason: { kind: 'error' } } },
    });
    assert.ok(state.active.ERROR);
    await delay(15);
    emit({ type: 'host/session-status', sessionId: 'b', running: true });
    assert.equal(state.active.ERROR, undefined);
    assert.equal(state.active.CODING, undefined);
    stop();
});

test('审批与问答状态只读观察，不注册任何答复处理器', async () => {
    const f = fixture();
    const frames = [];
    const stop = subscribeSessionActivity(f, (frame) => frames.push(frame), { scope: 'current' });
    f.uiSession.pendingInteractions.set(new Map([['a', { key: 'question-1', kind: 'question' }]]));
    assert.equal(frames.at(-1).type, 'question/requested');
    assert.equal(frames.at(-1).snapshot, false);
    f.uiSession.pendingInteractions.set(new Map());
    assert.equal(frames.at(-1).type, 'question/resolved');
    stop();
});

test('新版客户端挂载等待会话与 Remote 命名空间就绪', async () => {
    let plugin;
    runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
        window: {
            __ModuleLoader__: {
                load(definition) {
                    plugin = definition.factory(() => ({}));
                },
            },
        },
    });
    let dependencies;
    let mount;
    plugin.apply(
        {
            get: (key) => (key === 'connection' ? { rpc: { call() {} } } : undefined),
            inject(names, callback) {
                dependencies = names;
                mount = callback;
            },
        },
        {}
    );
    assert.deepEqual(Array.from(dependencies), ['sessions', 'remote', 'uiSession']);
    assert.equal(typeof mount, 'function');
});

test('新版并行工具按调用 ID 清除对应意图，并识别工具结果错误标志', () => {
    const system = createActivitySystem({ normalizeAnimId: (id) => id });
    let state = system.emptyIntentState();
    const apply = (type, data) => {
        state = system.applyFrame(state, { type: 'session/event', event: { type, data } }, 1);
    };
    apply('tool/call', { name: 'pwsh', turn: 1, step: 1, callId: 'command' });
    apply('tool/call', { name: 'read_image', turn: 1, step: 1, callId: 'image' });
    assert.ok(state.active.CODING);
    assert.ok(state.active.READING);
    apply('tool/result', {
        turn: 1,
        step: 1,
        message: { content: [{ toolCallId: 'command', isError: true }] },
    });
    assert.equal(state.active.CODING, undefined);
    assert.ok(state.active.READING);
    assert.ok(state.active.ERROR);
});

test('新版规则脉冲不被后续状态帧擦掉，工具规则记账按会话隔离', () => {
    let emit;
    let state;
    const fired = [];
    const system = createActivitySystem({ normalizeAnimId: (id) => id });
    const stop = system.startActivitySensor(
        {
            subscribeActivity: (fn) => {
                emit = fn;
                return () => {};
            },
        },
        (next) => {
            state = next;
        },
        {
            rules: [
                {
                    id: 'written',
                    when: [
                        { field: 'type', op: 'eq', value: 'tool/result' },
                        { field: 'toolName', op: 'eq', value: 'write' },
                    ],
                    holdMs: 1000,
                    cooldownMs: 1000,
                },
            ],
            onRuleFired: (id) => fired.push(id),
        }
    );
    const send = (sessionId, type, data) => emit({ sessionId, type: 'session/event', event: { type, data } });
    send('a', 'tool/call', { name: 'write', turn: 1, step: 1 });
    send('b', 'tool/call', { name: 'read', turn: 1, step: 1 });
    send('a', 'tool/result', { turn: 1, step: 1 });
    assert.deepEqual(fired, ['written']);
    send('b', 'turn/end', {});
    assert.ok(state.active['rule:written']);
    stop();
});

test('新版子会话使用带父会话与模式的正式 follow 地址', () => {
    const f = fixture();
    f.sessions.subagentAddress = () => ({
        parentSessionId: 'parent',
        childSessionId: 'a',
        mode: 'continuable',
    });
    const stop = subscribeSessionActivity(f, () => {}, { scope: 'current' });
    assert.deepEqual(f.calls[0].request.address, {
        kind: 'subagent',
        parentSessionId: 'parent',
        childSessionId: 'a',
        mode: 'continuable',
    });
    stop();
});

test('新版快照恢复工具配对供后续结果规则使用，同时保留旧错误/审批规则事件名', async () => {
    const f = fixture();
    const system = createActivitySystem({ normalizeAnimId: (id) => id });
    const fired = [];
    const stop = system.startActivitySensor(
        { subscribeActivity: (emit, opts) => subscribeSessionActivity(f, emit, opts) },
        () => {},
        {
            scope: 'current',
            rules: [
                {
                    id: 'result',
                    when: [
                        { field: 'type', op: 'eq', value: 'tool/result' },
                        { field: 'toolName', op: 'eq', value: 'write' },
                    ],
                },
                { id: 'approval', when: [{ field: 'type', op: 'eq', value: 'approval/requested' }] },
                { id: 'error', when: [{ field: 'type', op: 'eq', value: 'host/agent-error' }] },
            ],
            onRuleFired: (id) => fired.push(id),
        }
    );
    f.calls[0].push(
        snapshot(2, [event('turn/start', 1), event('tool/call', 2, { name: 'write', callId: 'x' })])
    );
    await delay(5);
    assert.deepEqual(fired, []);
    f.calls[0].push(event('tool/result', 3, { message: { content: [{ toolCallId: 'x' }] } }));
    f.calls[0].push(event('approval/asked', 4, { id: 'ask' }));
    f.calls[0].push(event('turn/end', 5, { reason: { kind: 'error' } }));
    await delay(5);
    assert.deepEqual(fired, ['result', 'approval', 'error']);
    stop();
});
