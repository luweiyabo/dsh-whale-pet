import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_NOTIFY,
    cardTtl,
    channelDecision,
    classifyTurnEnd,
    createNotifierSound,
    createSystemNotifier,
    emptyNotifyQueue,
    formatNotifyText,
    isSecureScope,
    notificationEnvironment,
    notifyDecision,
    notifyQueueReducer,
    titleMark,
} from '../src/client/notify.js';
import { createActivitySystem } from '../src/client/activity.js';

// ---- 测试替身 -------------------------------------------------------------

function fakeNotification(permission = 'granted') {
    class FakeNotification {
        static permission = permission;
        static created = [];
        static requestPermission() {
            return Promise.resolve(FakeNotification.permission);
        }
        constructor(title, options) {
            this.title = title;
            this.options = options;
            this.closed = false;
            FakeNotification.created.push(this);
        }
        close() {
            this.closed = true;
        }
    }
    return FakeNotification;
}

function fakeAudio() {
    const state = { resumed: 0, started: 0, stopped: [] };
    class FakeCtx {
        constructor() {
            this.state = 'suspended';
            this.currentTime = 0;
            this.destination = {};
        }
        resume() {
            state.resumed += 1;
            this.state = 'running';
            return Promise.resolve();
        }
        createOscillator() {
            return {
                type: 'sine',
                frequency: { setValueAtTime() {} },
                connect() {},
                start() {
                    state.started += 1;
                },
                stop(at) {
                    state.stopped.push(at);
                },
            };
        }
        createGain() {
            return {
                gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
                connect() {},
            };
        }
    }
    return { FakeCtx, state };
}

const t = (key) => {
    const zh = {
        notifyDone: '完成',
        notifyError: '失败',
        notifyWaiting: '待确认',
        notifyWaitBody: '等待你的审批或回答',
        notifyErrorBody: '回合发生错误',
        notifySteps: '{n} 步',
        notifyLimit: '达到长度上限',
    };
    return zh[key] || key;
};

// ---- classifyTurnEnd -------------------------------------------------------

test('turn/end 分类：只提示完成与失败', () => {
    assert.deepEqual(classifyTurnEnd({ kind: 'completed' }), { kind: 'done' });
    assert.deepEqual(classifyTurnEnd({ kind: 'max-tokens' }), { kind: 'done', limit: true });
    assert.deepEqual(classifyTurnEnd({ kind: 'error', error: { message: 'boom' } }), {
        kind: 'error',
        message: 'boom',
    });
    assert.deepEqual(classifyTurnEnd({ kind: 'error', error: { code: 'E_PRESET' } }), {
        kind: 'error',
        message: 'E_PRESET',
    });
    // 用户取消 / 被拦截 / 恢复补写：全部静默
    assert.equal(classifyTurnEnd({ kind: 'aborted', reason: { kind: 'user' } }), null);
    assert.equal(classifyTurnEnd({ kind: 'blocked' }), null);
    assert.equal(classifyTurnEnd({ kind: 'interrupted' }), null);
    assert.equal(classifyTurnEnd({ kind: 'forked' }), null);
    assert.equal(classifyTurnEnd(undefined), null);
});

// ---- 通道判定 --------------------------------------------------------------

test('页面聚焦：当前会话出气泡，其它会话出卡片', () => {
    const base = {
        notify: DEFAULT_NOTIFY,
        visible: true,
        focused: true,
        secure: true,
        supported: true,
        permission: 'granted',
    };
    assert.deepEqual(notifyDecision({ ...base, kind: 'done', sessionId: 's1', currentSessionId: 's1' }), {
        channel: 'bubble',
        title: false,
        card: false,
    });
    assert.deepEqual(notifyDecision({ ...base, kind: 'done', sessionId: 's2', currentSessionId: 's1' }), {
        channel: 'card',
        title: false,
        card: true,
    });
});

test('页面不可见：安全上下文且已授权走系统通知', () => {
    const d = notifyDecision({
        kind: 'done',
        notify: DEFAULT_NOTIFY,
        visible: false,
        focused: false,
        secure: true,
        supported: true,
        permission: 'granted',
    });
    assert.equal(d.channel, 'system');
    assert.equal(d.title, false);
});

test('系统通知不可用：有提示音走声音+标题，无提示音回前台补卡', () => {
    const common = {
        kind: 'error',
        notify: DEFAULT_NOTIFY,
        visible: false,
        focused: false,
        secure: true,
        supported: true,
        permission: 'denied',
    };
    assert.deepEqual(notifyDecision(common), { channel: 'sound', title: true, card: false });
    assert.deepEqual(notifyDecision({ ...common, notify: { ...DEFAULT_NOTIFY, sound: false } }), {
        channel: 'none',
        title: true,
        card: true,
    });
});

test('非安全上下文（局域网 http）不会尝试系统通知', () => {
    const d = notifyDecision({
        kind: 'done',
        notify: DEFAULT_NOTIFY,
        visible: false,
        focused: false,
        secure: false,
        supported: false,
        permission: 'unsupported',
    });
    assert.equal(d.channel, 'sound');
});

test('事件开关关闭与未知 kind 一律静默', () => {
    const off = { ...DEFAULT_NOTIFY, done: false };
    assert.equal(
        notifyDecision({ kind: 'done', notify: off, visible: true, focused: true, secure: true }).channel,
        'none'
    );
    assert.equal(notifyDecision({ kind: 'nope', notify: DEFAULT_NOTIFY }).channel, 'none');
});

test('余额全局提醒：聚焦只出气泡，失焦走系统/提示音', () => {
    const base = {
        notify: DEFAULT_NOTIFY,
        sessionScoped: false,
        secure: true,
        supported: true,
        permission: 'granted',
    };
    assert.deepEqual(channelDecision({ ...base, visible: true, focused: true }), {
        channel: 'bubble',
        title: false,
        card: false,
    });
    assert.deepEqual(channelDecision({ ...base, visible: true, focused: false }), {
        channel: 'system',
        title: false,
        card: false,
    });
    assert.deepEqual(channelDecision({ ...base, visible: false, focused: false, permission: 'denied' }), {
        channel: 'sound',
        title: true,
        card: false,
    });
});

// ---- 文案 ------------------------------------------------------------------

test('通知文案：完成带指标，失败带消息，等待有固定说明', () => {
    const done = formatNotifyText(
        { kind: 'done', summary: { durationMs: 200000, tools: 12, tokens: 8400 } },
        t
    );
    assert.equal(done.title, '完成');
    assert.equal(done.body, '3m20s · 12 步 · 8.4k tokens');

    const limited = formatNotifyText({ kind: 'done', summary: { tokens: 1200 }, limit: true }, t);
    assert.equal(limited.body, '1.2k tokens · 达到长度上限');

    assert.deepEqual(formatNotifyText({ kind: 'error', message: '模型超时' }, t), {
        title: '失败',
        body: '模型超时',
    });
    assert.deepEqual(formatNotifyText({ kind: 'error' }, t), { title: '失败', body: '回合发生错误' });
    assert.deepEqual(formatNotifyText({ kind: 'waiting' }, t), {
        title: '待确认',
        body: '等待你的审批或回答',
    });
});

// ---- 系统通知适配器 --------------------------------------------------------

test('系统通知：未授权/不支持时不发送', () => {
    const unsupported = createSystemNotifier({
        scope: { isSecureContext: true },
        Notification: undefined,
        now: () => 0,
    });
    assert.equal(unsupported.supported(), false);
    assert.equal(unsupported.send({ title: 'x' }), false);

    const denied = createSystemNotifier({
        scope: { isSecureContext: true },
        Notification: fakeNotification('denied'),
        now: () => 0,
    });
    assert.equal(denied.send({ title: 'x' }), false);
});

test('系统通知：发送成功、点击回调关闭、同 tag 限流、构造失败降级', () => {
    const FakeNotification = fakeNotification('granted');
    let clock = 0;
    const notifier = createSystemNotifier({
        scope: { isSecureContext: true },
        Notification: FakeNotification,
        now: () => clock,
    });
    let clicked = 0;
    assert.equal(notifier.send({ title: '完成', body: 'b', tag: 't', onClick: () => (clicked += 1) }), true);
    assert.equal(FakeNotification.created.length, 1);
    FakeNotification.created[0].onclick();
    assert.equal(clicked, 1);
    assert.equal(FakeNotification.created[0].closed, true);

    // 同 tag 3s 内不重复
    clock = 1000;
    assert.equal(notifier.send({ title: '再来', tag: 't' }), false);
    clock = 3001;
    assert.equal(notifier.send({ title: '再来', tag: 't' }), true);

    // 构造抛错：返回 false 而不是炸掉调用方
    class Throwing {
        static permission = 'granted';
        static requestPermission() {
            return Promise.resolve('granted');
        }
        constructor() {
            throw new Error('no notification');
        }
    }
    const broken = createSystemNotifier({
        scope: { isSecureContext: true },
        Notification: Throwing,
        now: () => 10000,
    });
    assert.equal(broken.send({ title: 'x' }), false);
});

test('isSecureScope：优先使用浏览器判定，缺失时按 localhost 兜底', () => {
    assert.equal(isSecureScope({ isSecureContext: true }), true);
    assert.equal(isSecureScope({ isSecureContext: false }), false);
    assert.equal(isSecureScope({ location: { hostname: 'localhost' } }), true);
    assert.equal(isSecureScope({ location: { hostname: '127.0.0.1' } }), true);
    assert.equal(isSecureScope({ location: { hostname: '192.168.1.9' } }), false);
    assert.equal(isSecureScope(null), false);
    assert.deepEqual(notificationEnvironment({ isSecureContext: true, Notification: fakeNotification() }), {
        secure: true,
        supported: true,
        permission: 'granted',
    });
});

// ---- 提示音 ----------------------------------------------------------------

test('提示音：无 AudioContext 静默失败，有则 resume 后播放', () => {
    const none = createNotifierSound({ scope: {}, AudioContext: undefined });
    assert.equal(none.prime(), false);
    assert.equal(none.play(), false);

    const { FakeCtx, state } = fakeAudio();
    const sound = createNotifierSound({ scope: {}, AudioContext: FakeCtx });
    assert.equal(sound.prime(), true);
    assert.equal(state.resumed, 1);
    assert.equal(sound.play(), true);
    assert.equal(state.started, 1);
});

// ---- 队列 ------------------------------------------------------------------

const card = (id, kind = 'done') => ({ id, kind, sessionId: 's1', title: '完成', meta: '' });

test('队列：同屏最多 3 张，溢出排队；promote 后补显', () => {
    let state = emptyNotifyQueue();
    for (let i = 0; i < 3; i += 1)
        state = notifyQueueReducer(state, { type: 'enqueue', card: card('c' + i) });
    assert.equal(state.cards.filter((c) => c.status === 'shown').length, 3);
    state = notifyQueueReducer(state, { type: 'enqueue', card: card('c3') });
    assert.equal(state.cards.find((c) => c.id === 'c3').status, 'queued');
    assert.equal(state.cards.filter((c) => c.status === 'shown').length, 3);

    state = notifyQueueReducer(state, { type: 'dismiss', id: 'c0' });
    state = notifyQueueReducer(state, { type: 'promote' });
    assert.equal(state.cards.find((c) => c.id === 'c3').status, 'shown');
});

test('队列：重复 id 不重复入队；超出总上限丢旧卡', () => {
    let state = emptyNotifyQueue();
    state = notifyQueueReducer(state, { type: 'enqueue', card: card('a') });
    state = notifyQueueReducer(state, { type: 'enqueue', card: card('a') });
    assert.equal(state.cards.length, 1);
    for (let i = 0; i < 10; i += 1)
        state = notifyQueueReducer(state, { type: 'enqueue', card: card('x' + i) });
    assert.equal(state.cards.length, 6);
    // 淘汰策略：先丢最旧的排队卡，已显示的卡保留到自动消失
    assert.deepEqual(
        state.cards.map((c) => c.id),
        ['a', 'x0', 'x1', 'x7', 'x8', 'x9']
    );
});

test('队列：隐藏时强制排队；waiting 由 resolve 撤销', () => {
    let state = emptyNotifyQueue();
    state = notifyQueueReducer(state, {
        type: 'enqueue',
        card: card('w1', 'waiting'),
        status: 'queued',
    });
    assert.equal(state.cards[0].status, 'queued');
    state = notifyQueueReducer(state, {
        type: 'enqueue',
        card: { ...card('d1'), sessionId: 's1' },
        status: 'queued',
    });
    state = notifyQueueReducer(state, { type: 'resolve', sessionId: 's1' });
    assert.deepEqual(
        state.cards.map((c) => c.id),
        ['d1']
    );
});

test('标题标记与自动消失时长', () => {
    assert.equal(titleMark(0), '');
    assert.equal(titleMark(1), '●');
    assert.equal(titleMark(3), '●(3)');
    assert.equal(cardTtl('waiting'), 15000);
    assert.equal(cardTtl('error'), 10000);
    assert.equal(cardTtl('done'), 8000);
});

// ---- 感知层顺序：后台会话事件不能被子会话过滤吞掉 -------------------------

test('scope 过滤不影响完成提示与统计（后台会话仍派发 onNotify/onTurn）', () => {
    const seen = [];
    const system = createActivitySystem({ normalizeAnimId: (x) => x });
    const api = {
        subscribeActivity(emit) {
            emit({
                type: 'session/event',
                sessionId: 'other',
                event: { type: 'turn/end', seq: 7, data: { turn: 2, reason: { kind: 'completed' } } },
            });
            return () => {};
        },
    };
    const stop = system.startActivitySensor(api, () => {}, {
        filter: (frame) => frame.sessionId !== 'other',
        onNotify: (frame) => seen.push(['notify', frame.sessionId]),
        onTurn: (info) => seen.push(['turn', info.sessionId, info.seq, info.turn]),
        onUsage: (usage, sessionId) => seen.push(['usage', sessionId]),
    });
    assert.deepEqual(seen, [
        ['notify', 'other'],
        ['turn', 'other', 7, 2],
    ]);
    stop();
});

test('watchAllRunning：scope=current 时也为后台运行会话开 follow', async () => {
    const { subscribeSessionActivity } = await import('../src/client/host-api.js');
    const listeners = new Set();
    const list = {
        getSnapshot: () => ({
            ids: ['a', 'b'],
            current: 'a',
            byId: { a: { running: true }, b: { running: true } },
        }),
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
    const follows = [];
    const remote = {
        session: {
            follow(request) {
                follows.push(request.address.sessionId || request.address);
                const stream = {
                    async *[Symbol.asyncIterator]() {},
                };
                return stream;
            },
        },
    };
    const uiSession = { current: { getSnapshot: () => ({ key: 'a' }) } };
    const stop = subscribeSessionActivity({ sessions: { list }, remote, uiSession }, () => {}, {
        scope: 'current',
        watchAllRunning: true,
    });
    assert.ok(follows.includes('a'), '当前会话应被 follow');
    assert.ok(follows.includes('b'), '后台运行会话也应被 follow');
    stop();
});

// ---- 跨平台降级矩阵 -------------------------------------------------------
// 三个平台（Windows/macOS/Linux）都走标准 Notifications API；能否弹系统通知只由
// 「安全上下文 + 权限 + 构造函数可用」决定。这里把每种环境显式跑一遍，保证任何
// 平台分支都不会出现「既无系统通知、又无声音/标题」的静默失败。
test('跨平台降级矩阵：任何环境都至少落到声音或标题/卡片', () => {
    const base = { kind: 'done', notify: DEFAULT_NOTIFY, visible: false, focused: false };
    const matrix = [
        // Windows Desktop / Web 本机
        {
            name: 'secure+granted',
            input: { secure: true, supported: true, permission: 'granted' },
            channel: 'system',
        },
        // Web 未授权 / 用户拒绝
        {
            name: 'secure+default',
            input: { secure: true, supported: true, permission: 'default' },
            channel: 'sound',
        },
        {
            name: 'secure+denied',
            input: { secure: true, supported: true, permission: 'denied' },
            channel: 'sound',
        },
        // 局域网 http：没有 Notifications API
        {
            name: 'insecure',
            input: { secure: false, supported: false, permission: 'unsupported' },
            channel: 'sound',
        },
        // 极旧壳 / 无 Notification 构造函数
        {
            name: 'unsupported',
            input: { secure: true, supported: false, permission: 'unsupported' },
            channel: 'sound',
        },
    ];
    for (const row of matrix) {
        const decision = notifyDecision({ ...base, ...row.input });
        assert.equal(decision.channel, row.channel, row.name);
        assert.ok(decision.channel !== 'none' || decision.title || decision.card, row.name + ' 不能静默失败');
    }
});

test('系统通知发送端在三种失败下都返回 false（调用方降级）', () => {
    const unsupported = createSystemNotifier({ scope: {}, Notification: undefined, now: () => 0 });
    assert.equal(unsupported.send({ title: 'x' }), false);

    const denied = createSystemNotifier({
        scope: { isSecureContext: true },
        Notification: fakeNotification('denied'),
        now: () => 0,
    });
    assert.equal(denied.send({ title: 'x' }), false);

    class Throwing {
        static permission = 'granted';
        static requestPermission() {
            return Promise.resolve('granted');
        }
        constructor() {
            throw new Error('platform toast unavailable');
        }
    }
    const throwing = createSystemNotifier({
        scope: { isSecureContext: true },
        Notification: Throwing,
        now: () => 0,
    });
    assert.equal(throwing.send({ title: 'x' }), false);
});

// ---- 子代理会话不提示 -----------------------------------------------------
// 宿主把子代理做成独立子会话，它们各自发 turn/end / 审批帧。子代理完成属于
// 实现细节，不该弹完成提示；但宠物动作照旧（父回合还在跑）。

test('子代理会话：只喂宠物动作，不派发提示与统计', () => {
    const seen = [];
    const states = [];
    const system = createActivitySystem({ normalizeAnimId: (x) => x });
    const api = {
        subscribeActivity(emit) {
            emit({
                type: 'session/event',
                sessionId: 'child',
                event: { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } },
            });
            emit({ type: 'approval/requested', sessionId: 'child' });
            emit({
                type: 'session/event',
                sessionId: 'main',
                event: { type: 'turn/end', seq: 5, data: { turn: 2, reason: { kind: 'completed' } } },
            });
            return () => {};
        },
    };
    const stop = system.startActivitySensor(api, (state) => states.push(state), {
        isSubagentSession: (id) => id === 'child',
        onNotify: (frame) => seen.push(['notify', frame.sessionId]),
        onTurn: (info) => seen.push(['turn', info.sessionId, info.seq]),
        onUsage: (usage, sessionId) => seen.push(['usage', sessionId]),
    });
    assert.deepEqual(
        seen,
        [
            ['notify', 'main'],
            ['turn', 'main', 5],
        ],
        '子代理会话的完成/审批帧不能进提示与统计'
    );
    assert.ok(states.length >= 2, '子代理回合仍要驱动宠物动作');
    stop();
});

test('子代理会话判定缺失或抛错时按普通会话处理（不吞提示）', () => {
    const seen = [];
    const system = createActivitySystem({ normalizeAnimId: (x) => x });
    const frame = {
        type: 'session/event',
        sessionId: 's1',
        event: { type: 'turn/end', seq: 9, data: { reason: { kind: 'completed' } } },
    };
    const run = (opts) => {
        seen.length = 0;
        const api = {
            subscribeActivity(emit) {
                emit(frame);
                return () => {};
            },
        };
        const stop = system.startActivitySensor(api, () => {}, {
            onTurn: (info) => seen.push(['turn', info.sessionId]),
            ...opts,
        });
        stop();
        return seen.slice();
    };
    assert.deepEqual(
        run({
            isSubagentSession: () => {
                throw new Error('目录未就绪');
            },
        }),
        [['turn', 's1']]
    );
    assert.deepEqual(run({}), [['turn', 's1']]);
});
