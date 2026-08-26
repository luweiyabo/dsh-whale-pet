/**
 * 行为矩阵测试：Agent 的每种行为 → 宠物播放的动作
 * =====================================================================
 * 完整链路（与运行时一致）：
 *   事件帧（api.events）→ applyFrame（感知层，纯函数）→ 意图活跃集合
 *     → highestIntent（仲裁，纯函数）→ 动作池（设置配置/代码默认）
 *     → 动画 id（animUrl 出 /whale-pet/... 播放 URL）
 *
 * 本文件只测纯函数层（不渲染 React，与 client-internals.test.js 同模式）；
 * 浏览器实测步骤见文件末尾注释。运行：node --test test/intent-behavior.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

let plugin;
globalThis.window = {
    __ModuleLoader__: {
        load(definition) {
            plugin = definition.factory((id) => {
                if (id === 'react') {
                    return {
                        createElement() {},
                        useState() {},
                        useEffect() {},
                        useRef() {},
                        useCallback() {},
                    };
                }
                throw new Error('unavailable test dependency: ' + id);
            });
        },
    },
};
await import('../lib/client.js');
delete globalThis.window;

const {
    INTENT,
    INTENT_ACTIONS,
    INTENT_CFG_KEY,
    emptyIntentState,
    applyFrame,
    highestIntent,
    mergeConfig,
    startActivitySensor,
    createArbiter,
    parseSessionModelSelection,
    pickFrom,
    setCustomAnims,
    ANIM_FAIL_COOLDOWN_MS,
    failedAnims,
} = plugin.__internals;

// ---- 帧构造器（与官方 api.events 形状一致；turn:step 用于 tool/result 配对） ----
const toolCall = (name, turn = 't1', step = 1) => ({
    type: 'session/event',
    event: { type: 'tool/call', data: { name, turn, step } },
});
const toolResult = (turn = 't1', step = 1, error) => ({
    type: 'session/event',
    event: { type: 'tool/result', data: error ? { turn, step, error } : { turn, step } },
});
const chunk = () => ({ type: 'session/event', event: { type: 'assistant/chunk', data: {} } });
const userMessage = () => ({ type: 'session/event', event: { type: 'user/message', data: {} } });

/** 依次把帧喂给感知层，返回最终活跃集合里优先级最高的意图 */
function intentAfter(frames, t0 = 1_700_000_000_000) {
    let state = emptyIntentState();
    let t = t0;
    for (const frame of frames) {
        t += 100;
        state = applyFrame(state, frame, t);
    }
    return highestIntent(state.active);
}

/** 配置（默认值 + 用户覆盖）下该意图的动作池 */
function actionsFor(cfg, intent) {
    if (intent === INTENT.IDLE) return [];
    return (cfg && cfg.intents && cfg.intents[INTENT_CFG_KEY[intent]]) || [];
}

// ============================================================================
// 1) 行为矩阵：Agent 行为 → 意图 → 默认动作（核心映射，与 README/设置一致）
// ============================================================================
const BEHAVIOR_MATRIX = [
    ['Agent 空闲（running=false）', [{ type: 'host/session-status', running: false }], INTENT.IDLE, []],
    [
        'Agent 运行中（兜底 WORKING）',
        [{ type: 'host/session-status', running: true }],
        INTENT.WORKING,
        ['eating_tokens'],
    ],
    ['bash 执行命令', [toolCall('bash')], INTENT.CODING, ['coding']],
    ['write 写文件', [toolCall('write')], INTENT.CODING, ['coding']],
    ['edit 修改文件', [toolCall('edit')], INTENT.CODING, ['coding']],
    ['read 读取文件', [toolCall('read')], INTENT.READING, ['taking_notes']],
    ['grep 检索内容', [toolCall('grep')], INTENT.READING, ['taking_notes']],
    ['web_search 联网搜索', [toolCall('web_search')], INTENT.RESEARCHING, ['taking_notes']],
    ['思考/流式输出 assistant/chunk', [chunk()], INTENT.THINKING, ['deep_thought']],
    [
        '等待审批 approval/requested',
        [{ type: 'approval/requested' }],
        INTENT.WAITING_USER,
        ['looking_around'],
    ],
    [
        '等待回答问题 question/requested',
        [{ type: 'question/requested' }],
        INTENT.WAITING_USER,
        ['looking_around'],
    ],
    ['收到用户消息 user/message', [userMessage()], INTENT.LISTENING, ['attentive_listening']],
    [
        '用户消息排队 session/queue',
        [{ type: 'session/queue', items: [{ id: 1 }] }],
        INTENT.LISTENING,
        ['attentive_listening'],
    ],
    [
        '工具执行失败 tool/result.error',
        [toolCall('bash'), toolResult('t1', 1, 'boom')],
        INTENT.ERROR,
        ['jump_scare'],
    ],
    ['Agent 出错 host/agent-error', [{ type: 'host/agent-error' }], INTENT.ERROR, ['jump_scare']],
    [
        '回合结束 turn/end（全部工作意图清空）',
        [toolCall('bash'), { type: 'session/event', event: { type: 'turn/end', data: {} } }],
        INTENT.IDLE,
        [],
    ],
];

for (const [name, frames, expectIntent, expectActions] of BEHAVIOR_MATRIX) {
    test(`行为矩阵：${name}`, () => {
        const intent = intentAfter(frames);
        assert.equal(intent, expectIntent, '意图判定错误');
        // 代码默认动作池（INTENT_ACTIONS）与合并配置后的默认值一致
        if (expectActions.length) assert.deepEqual(INTENT_ACTIONS[intent], expectActions);
        const cfg = mergeConfig(null);
        assert.deepEqual(actionsFor(cfg, intent), expectActions, '默认动作池错误');
        // 意图消退后回落自主链：空池 = IDLE 行为链
        if (intent === INTENT.IDLE) assert.deepEqual(actionsFor(cfg, INTENT.IDLE), []);
    });
}

test('Agent 活动会清除倾听意图，避免其压住后续动作', () => {
    const agentFrames = [
        [{ type: 'host/session-status', running: true }, INTENT.WORKING],
        [{ type: 'session/event', event: { type: 'step/start', data: {} } }, INTENT.THINKING],
        [chunk(), INTENT.THINKING],
        [toolCall('bash'), INTENT.CODING],
    ];
    for (const [agentFrame, expected] of agentFrames) {
        assert.equal(intentAfter([userMessage(), agentFrame]), expected);
    }
});

// ============================================================================
// 2) 优先级仲裁：多意图同时活跃时取最高（ERROR 9 > WAITING_USER 8 > … > IDLE）
// ============================================================================
test('多意图并存时按优先级取最高（错误可抢占等待/工作）', () => {
    const frames = [
        toolCall('bash'), // CODING(6) + WORKING(2)
        { type: 'approval/requested' }, // WAITING_USER(8)
        { type: 'host/agent-error' }, // ERROR(9)
    ];
    assert.equal(intentAfter(frames), INTENT.ERROR);
    // 去掉错误：等待用户压过写代码
    assert.equal(intentAfter(frames.slice(0, 2)), INTENT.WAITING_USER);
    // 工具结果无错正常消退：只剩 WORKING
    assert.equal(intentAfter([toolCall('bash'), toolResult('t1', 1)]), INTENT.WORKING);
});

// ============================================================================
// 3) 设置覆盖映射：用户在设置里改了意图→动作，播放的动作跟着变（热生效数据源）
// ============================================================================
test('设置覆盖意图映射后播放不同动作', () => {
    const cfg = mergeConfig({ intents: { coding: ['whale_tail_slap'] } });
    assert.deepEqual(cfg.intents.coding, ['whale_tail_slap']);
    assert.equal(intentAfter([toolCall('bash')]), INTENT.CODING);
    assert.deepEqual(actionsFor(cfg, INTENT.CODING), ['whale_tail_slap']);
    // 未覆盖的意图仍走默认
    assert.deepEqual(actionsFor(cfg, INTENT.ERROR), ['jump_scare']);
});

// ============================================================================
// 4) 全链路集成：真实传感器 + 仲裁器模拟一轮 Agent 行为序列
// ============================================================================
test('感知→仲裁全链路：写代码→等待→倾听→思考→回合结束', async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForAbort = (signal) =>
        new Promise((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', resolve, { once: true });
        });
    // 模拟一轮真实会话的事件流（只走 mux 流；host 流空转）。
    // 场景刻意用"连续升级 + 最后静默"：连续升级走 debounce 立即生效，
    // 最后 turn/end 是降级（linger 消退）——与真实时序语义一致。
    // 注意：turn/end 不会清 WAITING_USER（审批可能跨回合），
    // 必须先 approval/resolved 再 turn/end 才会回落 IDLE。
    const frames = [
        { type: 'host/session-status', running: true }, // → WORKING
        toolCall('bash'), // → CODING（优先级 6 > 2）
        { type: 'approval/requested' }, // → WAITING_USER（8 > 6）
        toolResult('t1', 1, 'boom'), // → ERROR（9 > 8）
        { type: 'approval/resolved' }, // 清 WAITING_USER → ERROR 仍占优
        { type: 'session/event', event: { type: 'turn/end', data: {} } }, // → IDLE
    ];
    const api = {
        events: {
            async *host(_input, signal) {
                await waitForAbort(signal);
            },
            async *mux(_input, signal) {
                for (const f of frames) {
                    yield f;
                    await sleep(1);
                }
                await waitForAbort(signal);
            },
        },
    };
    // 感知层：收集每帧后的活跃集合 → 意图序列
    const intents = [];
    const stop = startActivitySensor(api, (state) => intents.push(highestIntent(state.active)), {
        reconnectMs: 1000,
        errorHoldMs: () => 50,
    });
    for (let attempts = 0; attempts < 20 && intents.length < frames.length; attempts++) {
        await sleep(10);
    }
    stop();
    assert.ok(intents.length >= frames.length, '应收到全部帧的感知结果');
    // 关键行为按序出现过（含 ERROR 抢占等待、回合结束回落 IDLE）
    const ordered = [INTENT.WORKING, INTENT.CODING, INTENT.WAITING_USER, INTENT.ERROR, INTENT.IDLE];
    let idx = -1;
    for (const want of ordered) {
        const at = intents.indexOf(want, idx + 1);
        assert.ok(at > idx, `意图 ${want} 应按序出现，实际 ${intents.join(' -> ')}`);
        idx = at;
    }

    // 决策层：把同一序列喂给仲裁器，验证"升级走 debounce、降级走 linger"后输出
    const emitted = [];
    const arbiter = createArbiter({ debounceMs: 5, lingerMs: 80, ruleMeta: {} });
    arbiter.subscribe((i) => emitted.push(i));
    for (const intent of intents) {
        const active = {};
        if (intent !== INTENT.IDLE) active[intent] = Date.now();
        arbiter.update(active);
        await sleep(8);
    }
    await sleep(120); // 等最后的 IDLE 消退（linger 80ms 已足够）
    arbiter.dispose();
    assert.equal(emitted[0], INTENT.WORKING, '首个仲裁输出应为 WORKING');
    const seenOrder = [INTENT.WORKING, INTENT.CODING, INTENT.WAITING_USER, INTENT.ERROR, INTENT.IDLE];
    let j = -1;
    for (const want of seenOrder) {
        const at = emitted.indexOf(want, j + 1);
        assert.ok(at > j, `仲裁输出应按序包含 ${want}，实际 ${emitted.join(' -> ')}`);
        j = at;
    }
});

// ============================================================================
// 5) 余额模型预取：解析 session.models 响应（启动即显示余额的数据源）
// ============================================================================
test('解析 session.models 响应得到当前会话模型选择', () => {
    assert.deepEqual(
        parseSessionModelSelection({ current: { provider: 'deepseek', model: 'deepseek-chat' } }),
        { route: 'deepseek', model: 'deepseek-chat' }
    );
    // 带 reasoningEffort 的选择同样可解析（只取 route/model）
    assert.deepEqual(
        parseSessionModelSelection({
            current: { provider: 'moonshot', model: 'kimi-k2', reasoningEffort: 'high' },
        }),
        { route: 'moonshot', model: 'kimi-k2' }
    );
    // 无有效选择 → null（缺 provider/model、空字符串、响应异常）
    assert.equal(parseSessionModelSelection({ current: { provider: '', model: 'x' } }), null);
    assert.equal(parseSessionModelSelection({ current: { provider: 'p' } }), null);
    assert.equal(parseSessionModelSelection({ current: null }), null);
    assert.equal(parseSessionModelSelection({}), null);
    assert.equal(parseSessionModelSelection(null), null);
});

// ============================================================================
// 6) 播放健壮性：动作抽取只挑有效动画，空池/悬空 id 不卡死行为链
// ============================================================================
test('pickFrom 只抽有效动画；空池/全悬空/排除后为空返回 null', () => {
    setCustomAnims([{ id: 'wave', ext: 'webm', mtime: 1 }]);
    // 有效池（内置 + 自定义）正常抽取
    assert.ok(['coding', 'wave'].includes(pickFrom(['coding', 'wave'])));
    // 全悬空 → null（自定义动作文件被直接删除/手写脏配置）
    assert.equal(pickFrom(['dead_id']), null);
    assert.equal(pickFrom(['dead_id', 'another_dead']), null);
    // 空池 → null
    assert.equal(pickFrom([]), null);
    // exclude 后无剩余 → null（acts 池只剩当前动画时）
    assert.equal(pickFrom(['breathing'], 'breathing'), null);
    // 混有悬空 id 时从有效项中抽取
    const picked = pickFrom(['dead_id', 'coding', 'taking_notes']);
    assert.ok(['coding', 'taking_notes'].includes(picked));
    const picked2 = pickFrom(['coding', 'dead_id', 'breathing', 'wave']);
    assert.ok(['coding', 'breathing', 'wave'].includes(picked2));
    setCustomAnims([]); // 清理自定义注册表，避免影响后续用例
});

test('pickFrom 冷却期内剔除最近加载失败的动画，冷却后恢复', () => {
    setCustomAnims([{ id: 'stale', ext: 'webm', mtime: 1 }]);
    const now = Date.now();
    // 模拟 useVideoLayer error 兜底写入的失败标记（文件被删、清单未刷新 → 加载 404）
    failedAnims.set('stale', now);
    // 冷却期内：唯一候选被剔除 → 全失败返回 null；混合池只抽其他有效项
    assert.equal(pickFrom(['stale']), null);
    assert.equal(pickFrom(['stale', 'coding']), 'coding');
    // 两个"清单仍在但文件已删"的 id 同时被冷却 → 不交替（回落 IDLE 的 null 路径）
    failedAnims.set('stale2', now);
    assert.equal(pickFrom(['stale', 'stale2']), null);
    // 冷却过期（早于冷却窗口的失败）→ 允许重试，文件恢复后自愈；过期条目同时被清理
    failedAnims.set('stale', now - ANIM_FAIL_COOLDOWN_MS - 10000);
    assert.equal(pickFrom(['stale']), 'stale');
    assert.equal(failedAnims.has('stale'), false, '冷却过期的失败条目应被清理');
    // 加载成功会清除标记（onReadyHandler 行为）→ 立即可抽
    failedAnims.delete('stale');
    assert.equal(pickFrom(['stale']), 'stale');
    failedAnims.clear(); // 清理失败表，避免影响后续用例
    setCustomAnims([]);
});

// ============================================================================
// 浏览器实测指南（手动验证同一条链路，含真实去抖/消退时序）
// ============================================================================
// 1. 安装并启动：dsh plugin --profile web add . && dsh web
// 2. 在 Harness 界面里做以下操作，观察右下角宠物动作：
//    - 让 Agent "写一个函数"       → 写代码 coding（CODING 意图）
//    - 让它"读完这个文件再回答"     → 记笔记 taking_notes（READING）
//    - 触发审批/等待（如高危操作）  → 东张西望 looking_around（WAITING_USER）
//    - 向它发一条消息              → 侧耳倾听 attentive_listening（LISTENING）
//    - 让它调用一个会失败的工具     → 被吓一跳 jump_scare（ERROR）
//    - 什么也不做                  → 待机/转向/随机动作/漫游（IDLE 自主链）
// 3. 时序提示：升级切换约 500ms（debounceMs），消退约 1.5s（lingerMs），
//    连续工具调用不会闪切；右键宠物 → 打开设置，改动意图映射保存后
//    宠物立即按新映射播放（热生效），这本身就是对映射层最直接的验证。
// 4. 触发规则可用设置卡片里的"试触发"按钮立即播放一次验证。
