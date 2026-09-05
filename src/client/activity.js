// 每次 DSH factory 调用都创建独立状态，避免注册表与缓存跨实例共享。
export function createActivitySystem({ normalizeAnimId }) {
    // ============================================================================
    // 意图系统（事件驱动核心）—— 感知层与决策层的纯函数部分
    // ============================================================================
    // 意图（intent）：Harness 活动归一化后的"宠物该演什么"。
    // 纯函数 applyFrame 把事件流帧映射为意图活跃集合，单测友好（见
    // exports.__internals）。
    var INTENT = {
        IDLE: 'IDLE', // 无活动：自主行为链
        WORKING: 'WORKING', // Agent 运行中（兜底意图）
        CODING: 'CODING', // 写代码/操作类工具
        READING: 'READING', // 阅读/检索类工具
        RESEARCHING: 'RESEARCHING', // 联网查询类工具
        THINKING: 'THINKING', // 模型思考/输出中
        WAITING_USER: 'WAITING_USER', // 等待用户审批/回答
        LISTENING: 'LISTENING', // 用户消息到达/排队（倾听）
        ERROR: 'ERROR', // 工具失败 / Agent 出错
    };
    // 意图优先级：数值越大越优先（仲裁时取最高）
    var INTENT_PRIORITY = {
        ERROR: 9,
        WAITING_USER: 8,
        LISTENING: 7,
        CODING: 6,
        READING: 5,
        RESEARCHING: 4,
        THINKING: 3,
        WORKING: 2,
        IDLE: 0,
    };
    // 工具名 → 意图分类（代码默认表；设置仅覆盖意图对应的动作池）
    var TOOL_INTENTS = {
        bash: 'CODING',
        pwsh: 'CODING',
        write: 'CODING',
        edit: 'CODING',
        str_replace_editor: 'CODING',
        todo_write: 'CODING',
        workflow: 'CODING',
        read: 'READING',
        read_image: 'READING',
        glob: 'READING',
        grep: 'READING',
        skill: 'READING',
        web_search: 'RESEARCHING',
        web_fetch: 'RESEARCHING',
    };
    // 意图 → 候选动作池：每次仲裁切换随机选一个，完整播放一次后回自主链。
    // 注意：looking_around（东张西望）同时是转向动画，播完会翻转 facing（左右张望，符合倾听语义）
    var INTENT_ACTIONS = {
        WORKING: ['eating_tokens'],
        CODING: ['coding'],
        READING: ['taking_notes'],
        RESEARCHING: ['taking_notes'],
        THINKING: ['deep_thought'],
        WAITING_USER: ['looking_around'],
        LISTENING: ['attentive_listening'],
        ERROR: ['jump_scare'],
    };

    // 意图状态：{ active: {intent: 最近活跃时间戳}, toolCounts: {intent: 计数},
    //            stepTools: {'turn:step': [intent,...]}, running: bool }
    var emptyIntentState = () => ({ active: {}, toolCounts: {}, stepTools: {}, running: false });

    // 从活跃集合取最高优先级意图（无 → IDLE）。ruleMeta：规则元数据
    // （{ 'rule:<id>': rule }），规则与内置意图同一张牌桌比优先级。
    // 同优先级 tie-break：IDLE 让位给任何活跃意图；其余按 id 字典序（确定性）
    function highestIntent(active, ruleMeta) {
        var best = INTENT.IDLE;
        var bestP = INTENT_PRIORITY[INTENT.IDLE];
        for (var k in active) {
            var p = intentPriorityOf(k, ruleMeta);
            if (
                p > bestP ||
                (p === bestP && best === INTENT.IDLE && k !== INTENT.IDLE) ||
                (p === bestP && best !== INTENT.IDLE && k < best)
            ) {
                best = k;
                bestP = p;
            }
        }
        return best;
    }

    // 事件流帧 → 意图状态（不可变更新）。帧形状与官方 api.events 一致：
    //   host:  { type:'host/session-status', running } | { type:'host/agent-error' }
    //   mux:   { type:'session/event', event } | { type:'approval/requested' } |
    //          { type:'approval/resolved' } | { type:'question/requested' } |
    //          { type:'question/resolved' } | { type:'session/queue' }
    function toolKey(data) {
        const callId = data.callId || data.message?.content?.[0]?.toolCallId;
        return callId ? 'call:' + callId : data.turn + ':' + data.step;
    }
    function applyFrame(state, frame, now) {
        var next = {
            active: { ...state.active },
            toolCounts: { ...state.toolCounts },
            stepTools: state.stepTools,
            running: state.running,
        };
        var touch = (i) => {
            next.active[i] = now;
        };
        var clear = (i) => {
            delete next.active[i];
        };

        if (frame.type === 'host/session-status') {
            next.running = !!frame.running;
            if (frame.running) {
                clear(INTENT.LISTENING);
                touch(INTENT.WORKING);
            } else {
                clear(INTENT.WORKING);
                clear(INTENT.THINKING);
            }
            return next;
        }
        if (frame.type === 'host/agent-error') {
            touch(INTENT.ERROR);
            return next;
        }
        if (frame.type === 'approval/requested' || frame.type === 'question/requested') {
            touch(INTENT.WAITING_USER);
            return next;
        }
        if (frame.type === 'approval/resolved' || frame.type === 'question/resolved') {
            clear(INTENT.WAITING_USER);
            return next;
        }
        if (frame.type === 'session/queue') {
            // 排队中的用户消息（busy 时输入进队列）：用户在"说话"→ LISTENING；
            // 空队列不激活（残留 LISTENING 由 linger 自然消退）
            if (Array.isArray(frame.items) && frame.items.length) touch(INTENT.LISTENING);
            return next;
        }
        if (frame.type === 'session/event') {
            var ev = frame.event || {};
            var d = ev.data || {};
            if (ev.type === 'approval/asked') {
                touch(INTENT.WAITING_USER);
                return next;
            }
            if (ev.type === 'approval/decided') {
                clear(INTENT.WAITING_USER);
                return next;
            }
            if (ev.type === 'tool/call') {
                clear(INTENT.LISTENING);
                // 模型请求工具：分类意图 + 按 turn:step 记账（tool/result 无工具名，靠此配对）
                var ti = TOOL_INTENTS[d.name] || null;
                touch(INTENT.WORKING);
                if (ti) {
                    touch(ti);
                    next.toolCounts[ti] = (next.toolCounts[ti] || 0) + 1;
                }
                var stepKey = toolKey(d);
                next.stepTools = {
                    ...next.stepTools,
                    [stepKey]: [...(next.stepTools[stepKey] || []), ti],
                };
                return next;
            }
            if (ev.type === 'tool/result') {
                if (d.error || d.message?.content?.[0]?.isError) touch(INTENT.ERROR);
                // 消退该 turn:step 最近一次调用的工具意图
                var key = toolKey(d);
                var arr = next.stepTools[key];
                if (arr && arr.length) {
                    next.stepTools = { ...next.stepTools, [key]: arr.slice(0, -1) };
                    var done = arr[arr.length - 1];
                    if (done) {
                        next.toolCounts[done] = (next.toolCounts[done] || 1) - 1;
                        if (next.toolCounts[done] <= 0) {
                            delete next.toolCounts[done];
                            clear(done);
                        }
                    }
                }
                return next;
            }
            if (ev.type === 'user/message') {
                touch(INTENT.LISTENING);
                return next;
            }
            if (ev.type === 'turn/start') {
                clear(INTENT.LISTENING);
                touch(INTENT.WORKING);
                return next;
            }
            if (ev.type === 'turn/end') {
                // 回合结束：清空全部工作类意图、ERROR 与工具记账
                clear(INTENT.WORKING);
                clear(INTENT.THINKING);
                clear(INTENT.CODING);
                clear(INTENT.READING);
                clear(INTENT.RESEARCHING);
                clear(INTENT.LISTENING);
                clear(INTENT.ERROR);
                clear(INTENT.WAITING_USER);
                if (d.reason?.kind === 'error') touch(INTENT.ERROR);
                next.toolCounts = {};
                next.stepTools = {};
                return next;
            }
            if (ev.type === 'step/start') {
                clear(INTENT.LISTENING);
                touch(INTENT.THINKING);
                touch(INTENT.WORKING);
                return next;
            }
            if (ev.type === 'step/end') {
                clear(INTENT.THINKING);
                return next;
            }
            if (ev.type === 'assistant/chunk') {
                clear(INTENT.LISTENING);
                touch(INTENT.THINKING); // 只刷新时间戳，不计数
                return next;
            }
            return next;
        }
        return next;
    }

    // ============================================================================
    // 触发规则 —— 纯函数匹配层（applyFrame 之后的第二级意图生产者）
    // ============================================================================
    // 规则 = 声明式条件列表（AND）+ 动作池 + 优先级/冷却/保持。命中 → 激活
    // 'rule:<id>' 意图进仲裁器（与内置意图同一张牌桌）；脉冲语义：holdMs 后
    // 自动摘除（同 ERROR 模式）。全部纯函数、无副作用，进 __internals 可单测。
    var RULE_PREFIX = 'rule:';
    var isRuleIntent = (intent) => typeof intent === 'string' && intent.lastIndexOf(RULE_PREFIX, 0) === 0;
    var intentActionIsOnce = (intent) => intent !== INTENT.IDLE;
    var RULE_MIN_COOLDOWN_MS = 1000;
    var RULE_MAX_COOLDOWN_MS = 3600000;
    var RULE_MAX_COUNT = 50;
    var COND_OPS = ['eq', 'ne', 'contains', 'regex', 'exists'];
    var RULE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
    // 被测字符串截断长度：约束 contains/regex 的输入规模与内存（长 error
    // 消息场景）。注意：截断不能防灾难性回溯（200 字符对指数型正则仍是
    // 天文数字），真正的门禁是下方 danger 检测拒绝此类模式
    var RULE_VALUE_MAX = 200;
    // 编译后正则缓存：chunk 洪流下避免每帧每条件重复编译（实测省 ~50%）
    var REGEX_CACHE_MAX = 128;
    var regexCache = new Map();
    // 只接受可静态判定为安全的正则子集：拒绝反向引用、lookaround/命名组，
    // 以及对“包含 alternation 或其他量词”的组再次量化。后者同时覆盖
    // (a+)+ 与 (a|aa)+ 等典型指数级回溯；普通 ^foo|bar$、(ab)+ 仍可使用。
    function isSafeRegexPattern(pattern) {
        if (typeof pattern !== 'string' || pattern.length > 256) return false;
        var stack = [];
        var inClass = false;
        for (var i = 0; i < pattern.length; i++) {
            var ch = pattern[i];
            if (ch === '\\') {
                var escaped = pattern[i + 1];
                if (!inClass && (/[1-9]/.test(escaped || '') || escaped === 'k')) return false;
                i++;
                continue;
            }
            if (ch === '[' && !inClass) {
                inClass = true;
                continue;
            }
            if (ch === ']' && inClass) {
                inClass = false;
                continue;
            }
            if (inClass) continue;
            if (ch === '(') {
                if (pattern[i + 1] === '?') return false;
                stack.push({ complex: false });
                continue;
            }
            if (ch === '|') {
                if (stack.length) stack[stack.length - 1].complex = true;
                continue;
            }
            if (ch === ')') {
                if (!stack.length) return false;
                var group = stack.pop();
                var next = pattern[i + 1];
                var quantified = next === '+' || next === '*' || next === '?' || next === '{';
                if (quantified && group.complex) return false;
                if (group.complex && stack.length) stack[stack.length - 1].complex = true;
                continue;
            }
            if ((ch === '+' || ch === '*' || ch === '?' || ch === '{') && stack.length) {
                stack[stack.length - 1].complex = true;
            }
        }
        return stack.length === 0 && !inClass;
    }

    // 安全取点路径（'data.error' → frame.data.error；缺字段 → undefined）
    function getPath(obj, path) {
        if (!path) return undefined;
        var parts = String(path).split('.');
        var cur = obj;
        for (var i = 0; i < parts.length; i++) {
            if (cur === null || cur === undefined) return undefined;
            cur = cur[parts[i]];
        }
        return cur;
    }

    // 正则匹配：编译结果缓存（含失败 → null，坏正则不反复编译）；
    // 编译失败 → false，不让手写 settings.yaml 的坏正则炸掉事件流
    function safeRegexTest(pattern, value) {
        var re = regexCache.get(pattern);
        if (re === undefined) {
            if (!isSafeRegexPattern(pattern)) re = null;
            else
                try {
                    re = new RegExp(pattern);
                } catch (e) {
                    re = null;
                }
            if (regexCache.size >= REGEX_CACHE_MAX) regexCache.clear();
            regexCache.set(pattern, re);
        }
        return re ? re.test(value) : false;
    }

    // 单条件匹配。缺失字段语义：eq/ne/contains/regex 一律 false（"字段不存在"
    // 是否算"不等于"有歧义，判存在请用 exists），exists 显式判 undefined。
    // 字符串值先截断（RULE_VALUE_MAX）——约束输入规模。
    function condMatch(c, nframe) {
        if (!c || typeof c.field !== 'string' || !c.field) return false;
        var v = getPath(nframe, c.field);
        if (typeof v === 'string' && v.length > RULE_VALUE_MAX) v = v.slice(0, RULE_VALUE_MAX);
        switch (c.op) {
            case 'exists':
                return v !== undefined;
            case 'eq':
                return String(v) === c.value;
            case 'ne':
                return v !== undefined && String(v) !== c.value;
            case 'contains':
                return typeof v === 'string' && v.indexOf(c.value) !== -1;
            case 'regex':
                return typeof v === 'string' && safeRegexTest(c.value, v);
        }
        return false;
    }

    // 传感器帧 → 规则匹配用规范化帧（统一形状 + toolName 增强：
    // tool/result 帧本身无工具名，从 turn:step 配对表回查上一次 tool/call）
    function ruleFrameOf(frame, lastToolByStep) {
        var ev = (frame && frame.event) || {};
        var n = {
            stream: frame.type || '',
            type: ev.type || (frame && frame.type) || '',
            sessionId: frame.sessionId,
            running: frame.running,
            items: frame.items,
            data: ev.data || {},
        };
        if (ev.type === 'tool/call') {
            n.toolName = ev.data && typeof ev.data.name === 'string' ? ev.data.name : '';
        } else if (ev.type === 'tool/result') {
            var k = toolKey(ev.data || {});
            n.toolName = lastToolByStep[k] || '';
        }
        return n;
    }

    // 规则集匹配（纯函数）：返回 { fired: 命中规则数组, state: 新规则状态 }。
    // state = { lastFired: {id: ts}, lastToolByStep: {'turn:step': name} }。
    // cooldown 在此钳制（双保险：normalizeRule 已钳，手写数据再兜一次）。
    function matchRules(rules, frame, state, now) {
        var st = state || { lastFired: {}, lastToolByStep: {} };
        var nframe = ruleFrameOf(frame, st.lastToolByStep);
        // tool/call 时记账工具名（配对表超 500 项整体重置，防长会话膨胀）
        var nextTool = st.lastToolByStep;
        var ev = frame && frame.type === 'session/event' ? frame.event || null : null;
        if (ev && ev.type === 'tool/call' && ev.data && typeof ev.data.name === 'string') {
            nextTool = Object.assign({}, st.lastToolByStep);
            if (Object.keys(nextTool).length > 500) nextTool = {};
            nextTool[toolKey(ev.data)] = ev.data.name;
        }
        var fired = [];
        var nextLast = st.lastFired;
        var touched = false;
        var list = rules || [];
        for (var i = 0; i < list.length; i++) {
            var r = list[i];
            if (!r || r.enable === false || !Array.isArray(r.when) || !r.when.length) continue;
            var cd = Math.min(
                Math.max(r.cooldownMs || RULE_MIN_COOLDOWN_MS, RULE_MIN_COOLDOWN_MS),
                RULE_MAX_COOLDOWN_MS
            );
            var last = st.lastFired[r.id];
            if (last !== undefined && now - last < cd) continue;
            var ok = true;
            for (var j = 0; j < r.when.length; j++) {
                if (!condMatch(r.when[j], nframe)) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
            if (!touched) {
                nextLast = Object.assign({}, st.lastFired);
                touched = true;
            }
            nextLast[r.id] = now;
            fired.push(r);
        }
        return { fired: fired, state: { lastFired: nextLast, lastToolByStep: nextTool } };
    }

    // 规则清洗（手写 settings.yaml / 旧版数据 → 安全形状）。非法（id 不合规、
    // 条件缺字段、op 不在白名单、regex 编译失败）→ 整条丢弃返回 null。
    // 注意：actions 不按 animEntry 过滤（自定义动作清单可能晚于设置加载），
    // 悬空 id 由运行时 onIntent 的池过滤兜底。
    function normalizeRule(r) {
        if (!r || typeof r !== 'object') return null;
        if (typeof r.id !== 'string' || !RULE_ID_RE.test(r.id)) return null;
        var when = [];
        if (Array.isArray(r.when)) {
            for (var i = 0; i < r.when.length && when.length < 10; i++) {
                var c = r.when[i];
                if (!c || typeof c !== 'object') return null;
                if (typeof c.field !== 'string' || !c.field || c.field.length > 128) return null;
                if (COND_OPS.indexOf(c.op) === -1) return null;
                var val = String(c.value === undefined ? '' : c.value);
                if (val.length > 256) return null;
                if (c.op === 'regex') {
                    try {
                        new RegExp(val);
                    } catch (e) {
                        return null;
                    }
                    if (!isSafeRegexPattern(val)) return null;
                }
                when.push({ field: c.field, op: c.op, value: val });
            }
        }
        if (!when.length) return null;
        var acts = [];
        if (Array.isArray(r.actions)) {
            for (var k = 0; k < r.actions.length && acts.length < 5; k++) {
                var id = normalizeAnimId(String(r.actions[k]));
                if (id && id.length <= 64) acts.push(id);
            }
        }
        var pr = Math.round(Number(r.priority));
        if (!isFinite(pr)) pr = 3;
        var cd = Math.round(Number(r.cooldownMs));
        if (!isFinite(cd)) cd = 30000;
        var hd = Math.round(Number(r.holdMs));
        if (!isFinite(hd)) hd = 3000;
        return {
            id: r.id,
            enable: r.enable !== false,
            name: typeof r.name === 'string' ? r.name.slice(0, 64) : '',
            when: when,
            priority: Math.min(Math.max(pr, 0), 9),
            cooldownMs: Math.min(Math.max(cd, RULE_MIN_COOLDOWN_MS), RULE_MAX_COOLDOWN_MS),
            holdMs: Math.min(Math.max(hd, 0), 60000),
            actions: acts,
            bubble: typeof r.bubble === 'string' ? r.bubble.slice(0, 50) : '',
        };
    }

    function normalizeRules(list) {
        if (!Array.isArray(list)) return [];
        var out = [];
        var seen = {}; // id 去重：重复 id 会让 ruleMeta/冷却记账串扰，保留首条
        for (var i = 0; i < list.length && out.length < RULE_MAX_COUNT; i++) {
            var r = normalizeRule(list[i]);
            if (r && !seen[r.id]) {
                seen[r.id] = true;
                out.push(r);
            }
        }
        return out;
    }

    // 意图优先级查表：内置表 → 规则元数据（rule:<id>）→ -1（未知）
    function intentPriorityOf(id, ruleMeta) {
        var p = INTENT_PRIORITY[id];
        if (p !== undefined) return p;
        if (ruleMeta && id.lastIndexOf(RULE_PREFIX, 0) === 0) {
            var m = ruleMeta[id];
            return m ? Number(m.priority) || 0 : -1;
        }
        return -1;
    }

    // ============================================================================
    // 意图仲裁器（决策层）—— 工厂函数，纯逻辑 + setTimeout 调度
    // ============================================================================
    // 输入：活跃意图集合（感知层持续更新）；输出：当前应播放的意图。
    // 时序语义：
    //   - 升级（更高优先级意图出现）：debounceMs 后应用（工具快速连发不抖动）
    //   - 降级（当前意图消退）：lingerMs 后应用（动作不闪断）
    //   - 调度期间活跃集合再变：用最新集合重算（timer 刷新）
    // 应用时通过 subscribe 监听器通知（播放器抢占动作）。
    function createArbiter(opts) {
        var current = INTENT.IDLE;
        var timer = null;
        var listeners = new Set();
        var active = {};

        var applyNow = () => {
            timer = null;
            var next = highestIntent(active, opts.ruleMeta);
            if (next !== current) {
                current = next;
                listeners.forEach((fn) => fn(next));
            }
        };
        return {
            get current() {
                return current;
            },
            // 感知层每次活跃集合变化时调用
            update(nextActive) {
                active = nextActive;
                var raw = highestIntent(active, opts.ruleMeta);
                if (raw === current) {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    return;
                }
                // 动态读 opts（设置保存后无需重建仲裁器即生效）
                var delay =
                    intentPriorityOf(raw, opts.ruleMeta) > intentPriorityOf(current, opts.ruleMeta)
                        ? opts.debounceMs
                        : opts.lingerMs;
                if (timer) clearTimeout(timer);
                timer = setTimeout(applyNow, delay);
            },
            subscribe(fn) {
                listeners.add(fn);
                return () => listeners.delete(fn);
            },
            dispose() {
                if (timer) clearTimeout(timer);
                timer = null;
                listeners.clear();
            },
        };
    }

    // ============================================================================
    // 活动传感器（感知层）—— 订阅官方事件流，产出意图活跃集合
    // ============================================================================
    // 用 connection 服务的 api.events 双流（host + mux）：
    //   - host 流：会话运行状态翻转、Agent 出错
    //   - mux 流：会话事件透传（tool/call、assistant/chunk…）+ 审批/问答帧
    // 帧 → applyFrame（纯函数）→ 活跃集合 → onState 回调（仲裁器消费）。
    // ERROR 为"脉冲"意图：激活 3 秒后自动消退（errorHoldMs）。
    // 流结束（非主动 abort）→ 2 秒后重开（断线重连）。
    // 返回清理函数：abort 流 + 清定时器。
    // @returns {() => void} dispose
    function startActivitySensor(api, onState, opts) {
        var ctrl = new AbortController();
        var state = emptyIntentState();
        var sessionStates = new Map();
        var ruleStates = new Map();
        var mergeSessions = () => ({
            ...emptyIntentState(),
            active: Object.assign(
                Object.fromEntries(Object.entries(state.active).filter(([key]) => isRuleIntent(key))),
                ...Array.from(sessionStates.values(), (s) => s.active)
            ),
        });
        var reconnectTimer = null;
        var errorTimer = null;
        var disposed = false;
        // 规则状态（matchRules 纯函数维护：lastFired=冷却记账，
        // lastToolByStep=tool/result 的工具名配对表）+ 脉冲摘除定时器
        var ruleState = { lastFired: {}, lastToolByStep: {} };
        var ruleTimers = {};

        var publish = () => {
            if (!disposed) onState(state);
        };
        var clearError = () => {
            errorTimer = null;
            for (const s of sessionStates.values()) delete s.active[INTENT.ERROR];
            if (state.active[INTENT.ERROR]) {
                state = { ...state, active: { ...state.active } };
                delete state.active[INTENT.ERROR];
                publish();
            }
        };
        var handle = (raw) => {
            // 解包 RpcRequest：api.events 流 yield 的是 { rpcId, payload: Frame }，
            // 业务字段（type/sessionId/event）都在 payload 里。
            var frame = raw && raw.payload ? raw.payload : raw;
            if (!frame) return;
            if (frame.type === 'activity/reset') {
                sessionStates.delete(frame.sessionId);
                ruleStates.delete(frame.sessionId);
                state = mergeSessions();
                publish();
                return;
            }
            // 多会话感知范围过滤（scope=current 时只收当前会话帧）
            if (opts.filter && !opts.filter(frame)) return;
            // request/context 携带本次真实 provider/model；assistant/message 携带 usage。
            if (frame.type === 'session/event') {
                var ev0 = frame.event || {};
                if (
                    opts.onModel &&
                    (!frame.snapshot || ev0.type === 'model/selection') &&
                    (ev0.type === 'request/context' || ev0.type === 'model/selection') &&
                    ev0.data
                )
                    opts.onModel(ev0.data, frame.sessionId);
                if (
                    opts.onUsage &&
                    !frame.snapshot &&
                    ev0.type === 'assistant/message' &&
                    ev0.data &&
                    ev0.data.usage
                )
                    opts.onUsage(ev0.data.usage);
            }
            if (api.subscribeActivity) {
                const next = applyFrame(
                    sessionStates.get(frame.sessionId) || emptyIntentState(),
                    frame,
                    Date.now()
                );
                if (frame.snapshot) delete next.active[INTENT.ERROR];
                sessionStates.set(frame.sessionId, next);
                state = mergeSessions();
                if (frame.snapshot) {
                    const restored = matchRules(
                        [],
                        frame,
                        {
                            lastFired: ruleState.lastFired,
                            lastToolByStep: ruleStates.get(frame.sessionId) || {},
                        },
                        Date.now()
                    );
                    ruleStates.set(frame.sessionId, restored.state.lastToolByStep);
                }
            } else state = applyFrame(state, frame, Date.now());
            // 触发规则：applyFrame 之后匹配（读取器函数热更新——设置保存
            // 即生效，无需重建事件流）。命中 → 激活 rule:<id> 意图 + holdMs
            // 脉冲摘除（重触发刷新保持窗口；同 ERROR 的 errorTimer 模式）
            if (opts.rules && !frame.snapshot) {
                var ruleList = typeof opts.rules === 'function' ? opts.rules() : opts.rules;
                if (ruleList && ruleList.length) {
                    var nowMs = Date.now();
                    var scopedRuleState = api.subscribeActivity
                        ? {
                              lastFired: ruleState.lastFired,
                              lastToolByStep: ruleStates.get(frame.sessionId) || {},
                          }
                        : ruleState;
                    var mr = matchRules(ruleList, frame, scopedRuleState, nowMs);
                    ruleState = mr.state;
                    if (api.subscribeActivity) ruleStates.set(frame.sessionId, mr.state.lastToolByStep);
                    for (var fi = 0; fi < mr.fired.length; fi++) {
                        var fr = mr.fired[fi];
                        var iid = RULE_PREFIX + fr.id;
                        state = { ...state, active: { ...state.active, [iid]: nowMs } };
                        if (opts.onRuleFired) opts.onRuleFired(fr.id, nowMs);
                        if (ruleTimers[iid]) clearTimeout(ruleTimers[iid]);
                        ruleTimers[iid] = setTimeout(
                            (function (iid2, holdMs2) {
                                return function () {
                                    delete ruleTimers[iid2];
                                    if (state.active[iid2]) {
                                        state = { ...state, active: { ...state.active } };
                                        delete state.active[iid2];
                                        publish();
                                    }
                                };
                            })(iid, fr.holdMs),
                            fr.holdMs ?? 3000
                        );
                    }
                }
            }
            // ERROR 脉冲：激活后 errorHoldMs 自动消退（动态读 opts；支持函数——
            // 传入 arbOptsRef 读取器，设置自动保存即热生效，无需重建事件流）
            if (state.active[INTENT.ERROR] && !errorTimer) {
                var holdMs = typeof opts.errorHoldMs === 'function' ? opts.errorHoldMs() : opts.errorHoldMs;
                errorTimer = setTimeout(clearError, holdMs ?? 3000);
            }
            publish();
        };
        var consume = async (openStream, gen) => {
            try {
                for await (var frame of openStream()) handle(frame);
            } catch (e) {
                // 流中断（含 abort）：统一走下面的重连判定
            }
            // 本代流已被新一轮 openStreams 取代（或已销毁）：不重连
            if (disposed || gen.signal.aborted) return;
            // 流正常结束或出错：延时重开。共享的重连定时器先清再排——
            // 双流同时断开时这里会各到一次，不清旧定时器会排两个
            // openStreams()，每开一对新流 → 订阅对翻倍（帧重复雪崩）
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                openStreams();
            }, opts.reconnectMs || 2000);
        };
        var openStreams = () => {
            if (disposed) return;
            // abort 上一代流再开新的：单流断开重连时不复制仍健康的另一条
            ctrl.abort();
            ctrl = new AbortController();
            var gen = ctrl;
            consume(() => api.events.host({}, gen.signal), gen);
            consume(() => api.events.mux({}, gen.signal), gen);
        };
        var stopSubscription = api.subscribeActivity
            ? api.subscribeActivity(handle, opts)
            : (openStreams(), null);

        return () => {
            disposed = true;
            if (stopSubscription) stopSubscription();
            ctrl.abort();
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (errorTimer) clearTimeout(errorTimer);
            for (var k in ruleTimers) clearTimeout(ruleTimers[k]);
            ruleTimers = {};
        };
    }

    return {
        INTENT,
        INTENT_PRIORITY,
        TOOL_INTENTS,
        INTENT_ACTIONS,
        emptyIntentState,
        highestIntent,
        applyFrame,
        RULE_PREFIX,
        isRuleIntent,
        intentActionIsOnce,
        COND_OPS,
        isSafeRegexPattern,
        getPath,
        safeRegexTest,
        condMatch,
        ruleFrameOf,
        matchRules,
        normalizeRule,
        normalizeRules,
        intentPriorityOf,
        createArbiter,
        startActivitySensor,
    };
}
