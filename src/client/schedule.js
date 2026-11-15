/**
 * ============================================================================
 * 日历（节日 / 季节）与回合用量统计 —— 纯函数模块
 * ============================================================================
 *
 * 【为什么单独成文件】
 *   index.js 已经承担 UI 与播放器，这里再塞日历换算会把「可单测的纯逻辑」
 *   和「依赖 DOM 的组件」混在一起。本文件不 import 任何浏览器 API
 *   （Intl 属于 ECMAScript 标准库，node 与浏览器都有），因此可以在
 *   `node --test` 下直接验证节日锚点、季节映射与 usage 归并。
 *
 * 【农历怎么算】
 *   用 ECMAScript 内置的 `Intl.DateTimeFormat('en-u-ca-chinese')`（ICU 数据），
 *   不引入第三方历法表，也不手写闰月表。已验证：
 *   2024-09-17 → 八月十五（中秋）、2024-02-10 → 正月初一（春节）。
 *   ICU 缺失（极简构建）时 `lunarDateOf` 返回 null，农历节日自动失效、
 *   公历节日与季节判断不受影响。
 *
 * 【节日窗口怎么判】
 *   每个节日有一个「锚点日」（今年那一次）与前后窗口天数。
 *   - 公历节日：按年内日序计算，跨年用环形距离（12/25 的窗口能覆盖 1/1）。
 *   - 农历节日：在「今天 ±32 天」的范围内逐日换算农历，找出锚点日
 *     （最多 65 次 Intl 调用，按「今天」缓存一天，成本可忽略）。
 */

/** 月份（1-12）→ 季节 */
export function seasonOfMonth(month) {
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter'; // 12 / 1 / 2
}

/** 季节动画 → 应景季节（只在对应季节出现在随机动作池） */
export const SEASONAL_ANIMS = Object.freeze({
    flying_a_kite: 'spring',
    cooling_with_a_hand_fan: 'summer',
    buried_in_autumn_leaves: 'autumn',
    building_a_snowman: 'winter',
});

/**
 * 节日表：锚点（公历 solar 或农历 lunar）+ 前后窗口天数（window）+ 关联动画。
 * 同一动画可属于多个节日（如可爱小幽灵同时关联万圣节与中元节）。
 */
export const FESTIVALS = Object.freeze([
    Object.freeze({
        key: 'newYear',
        solar: Object.freeze({ month: 1, day: 1 }),
        window: 2,
        anims: Object.freeze(['opening_a_gift', 'setting_off_fireworks']),
    }),
    Object.freeze({
        key: 'springFestival',
        lunar: Object.freeze({ month: 1, day: 1 }),
        window: 5,
        anims: Object.freeze([
            'receiving_a_red_envelope',
            'lion_dance',
            'writing_the_fu_character',
            'setting_off_fireworks',
            'eating_dumplings',
            'eating_rice_cake',
        ]),
    }),
    Object.freeze({
        key: 'lantern',
        lunar: Object.freeze({ month: 1, day: 15 }),
        window: 1,
        anims: Object.freeze(['eating_tangyuan', 'releasing_a_sky_lantern']),
    }),
    Object.freeze({
        key: 'qingming',
        solar: Object.freeze({ month: 4, day: 5 }),
        window: 2,
        anims: Object.freeze(['eating_qingtuan']),
    }),
    Object.freeze({
        key: 'dragonBoat',
        lunar: Object.freeze({ month: 5, day: 5 }),
        window: 1,
        anims: Object.freeze(['eating_zongzi']),
    }),
    Object.freeze({
        key: 'qixi',
        lunar: Object.freeze({ month: 7, day: 7 }),
        window: 1,
        anims: Object.freeze(['qixi_needlework']),
    }),
    Object.freeze({
        key: 'ghost',
        lunar: Object.freeze({ month: 7, day: 15 }),
        window: 1,
        anims: Object.freeze(['releasing_a_river_lantern', 'cute_little_ghost']),
    }),
    Object.freeze({
        key: 'midAutumn',
        lunar: Object.freeze({ month: 8, day: 15 }),
        window: 2,
        anims: Object.freeze(['moon_festival']),
    }),
    Object.freeze({
        key: 'chongyang',
        lunar: Object.freeze({ month: 9, day: 9 }),
        window: 1,
        anims: Object.freeze(['eating_chongyang_cake', 'chongyang_chrysanthemums']),
    }),
    Object.freeze({
        key: 'laba',
        lunar: Object.freeze({ month: 12, day: 8 }),
        window: 1,
        anims: Object.freeze(['eating_laba_congee']),
    }),
    Object.freeze({
        key: 'halloween',
        solar: Object.freeze({ month: 10, day: 31 }),
        window: 3,
        anims: Object.freeze(['halloween_trick_or_treat', 'cute_little_ghost']),
    }),
    Object.freeze({
        key: 'christmas',
        solar: Object.freeze({ month: 12, day: 25 }),
        window: 5,
        anims: Object.freeze(['decorating_a_christmas_tree', 'opening_a_gift']),
    }),
]);

/** 动画 id → 所属节日 key 列表（预计算，避免每次过滤都遍历整张表） */
const ANIM_FESTIVALS = new Map();
for (const f of FESTIVALS) {
    for (const id of f.anims) {
        if (!ANIM_FESTIVALS.has(id)) ANIM_FESTIVALS.set(id, []);
        ANIM_FESTIVALS.get(id).push(f.key);
    }
}

/** 动画 id → 是否属于节日专用动画 */
export function isFestivalAnim(id) {
    return ANIM_FESTIVALS.has(id);
}

/** 动画 id → 所属节日 key 列表（无则空数组） */
export function festivalsOfAnim(id) {
    return ANIM_FESTIVALS.get(id) || [];
}

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 年内日序（1-366，本地时间） */
function dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    const ms = new Date(date.getFullYear(), date.getMonth(), date.getDate()) - start;
    return Math.floor(ms / 86400000) + 1;
}

/** 环形日距（年末与年初相邻） */
function ringDistance(a, b, yearLength) {
    const d = Math.abs(a - b);
    return Math.min(d, yearLength - d);
}

/**
 * 公历日期的「月-日」→ 当年日序；对 2/29 这类该年不存在的日期返回 undefined。
 */
function dayOfYearFor(year, month, day) {
    const probe = new Date(year, month - 1, day);
    if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return undefined;
    return dayOfYear(probe);
}

/**
 * 农历换算：返回 { month, day } 或 null（运行环境无中文历法数据时）。
 * @param {Date} date
 */
export function lunarDateOf(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    let fmt;
    try {
        fmt = new Intl.DateTimeFormat('en-u-ca-chinese', {
            month: 'numeric',
            day: 'numeric',
            timeZone: 'Asia/Shanghai',
        });
    } catch {
        return null;
    }
    try {
        const parts = fmt.formatToParts(date);
        const month = Number((parts.find((p) => p.type === 'month') || {}).value);
        const day = Number((parts.find((p) => p.type === 'day') || {}).value);
        if (!Number.isFinite(month) || !Number.isFinite(day) || month <= 0 || day <= 0) return null;
        return { month, day };
    } catch {
        return null;
    }
}

/** 本地日期键（YYYY-MM-DD），用于按天缓存 */
function dateKey(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + m + '-' + d;
}

const LUNAR_SCAN_DAYS = 32;
let festivalCacheKey = null;
let festivalCacheValue = [];

/**
 * 计算「今天」处于哪些节日的窗口内。
 * - 公历节日：按年内日序做环形距离比较（窗口可跨年）。
 * - 农历节日：今天 ±32 天内逐日换算，命中锚点即视为在窗口内。
 * 结果按日期缓存（同一天内重复调用零成本）。
 * @param {Date} [today]
 * @returns {string[]} 节日 key 列表
 */
export function festivalsOn(today = new Date()) {
    if (!(today instanceof Date) || Number.isNaN(today.getTime())) return [];
    const key = dateKey(today);
    if (festivalCacheKey === key) return festivalCacheValue;
    const year = today.getFullYear();
    const yearLength = isLeapYear(year) ? 366 : 365;
    const todayIndex = dayOfYear(today);
    const hits = [];
    for (const festival of FESTIVALS) {
        if (festival.solar) {
            const anchor = dayOfYearFor(year, festival.solar.month, festival.solar.day);
            // 2/29 这类当年不存在的锚点：退到 3/1 之前，直接跳过窗口判断
            if (anchor === undefined) continue;
            if (ringDistance(todayIndex, anchor, yearLength) <= festival.window) hits.push(festival.key);
            continue;
        }
        if (!festival.lunar) continue;
        // 农历锚点：在 ±32 天里找「农历月日相同」的那天
        for (let offset = -LUNAR_SCAN_DAYS; offset <= LUNAR_SCAN_DAYS; offset += 1) {
            const probe = new Date(year, today.getMonth(), today.getDate() + offset);
            const lunar = lunarDateOf(probe);
            if (!lunar) break; // 环境无历法数据：整类跳过
            if (lunar.month !== festival.lunar.month || lunar.day !== festival.lunar.day) continue;
            const probeIndex = dayOfYear(probe);
            const diff = Math.abs(todayIndex - probeIndex);
            // 用「跨年环形距离」兜底：扫描区间本身已足够短，两者取小更稳
            const dist = Math.min(diff, Math.max(0, yearLength - diff));
            if (dist <= festival.window) {
                hits.push(festival.key);
                break;
            }
        }
    }
    festivalCacheKey = key;
    festivalCacheValue = hits;
    return hits;
}

/** 某天是否处于某个节日的窗口内（便于测试与调试） */
export function isFestivalWindow(key, date = new Date()) {
    return festivalsOn(date).indexOf(key) !== -1;
}

/**
 * 情境化过滤随机动作池：剔除不合季节的四季动画、剔除不在窗口内的节日动画；
 * 命中节日时以 festivalChance 概率只保留当天节日的动画（让「当天真的演」）。
 *
 * 兜底：过滤后为空（用户池子里只有节日/季节动画）→ 原样返回，绝不返回空池。
 *
 * @param {string[]} pool - 候选动画 id（已按自身逻辑过滤过悬空 id）
 * @param {object} opts
 * @param {Date}   [opts.date] - 判定用的日期（默认现在）
 * @param {object} [opts.calendar] - { enabled, festival, seasonal } 开关
 * @param {(id: string) => (string|undefined)} [opts.categoryOf] - 取动画分类
 * @param {() => number} [opts.rand] - 随机源（测试注入）
 * @returns {string[]} 过滤后的候选池（非空）
 */
export function situationalPool(pool, opts = {}) {
    if (!Array.isArray(pool) || pool.length === 0) return [];
    const calendar = opts.calendar || {};
    if (calendar.enabled === false) return pool.slice();
    const date = opts.date instanceof Date ? opts.date : new Date();
    const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    const categoryOf = typeof opts.categoryOf === 'function' ? opts.categoryOf : () => undefined;
    const season = seasonOfMonth(date.getMonth() + 1);
    const activeFestivals = calendar.festival === false ? [] : festivalsOn(date);
    const festivalOnly = [];
    const kept = [];
    for (const id of pool) {
        // 四季动画：只在对应季节出现
        const animSeason = SEASONAL_ANIMS[id];
        if (animSeason !== undefined) {
            if (calendar.seasonal === false || animSeason === season) kept.push(id);
            continue;
        }
        // 节日动画：只在对应节日窗口出现
        const fest = ANIM_FESTIVALS.get(id);
        if (fest) {
            const active = fest.filter((k) => activeFestivals.indexOf(k) !== -1);
            if (active.length === 0) continue;
            kept.push(id);
            festivalOnly.push(id);
            continue;
        }
        // 其余（含 daily/work/food/games 等）：分类不作为过滤条件，原样保留
        void categoryOf;
        kept.push(id);
    }
    if (kept.length === 0) return pool.slice();
    // 节日当天：以一定概率只演节日动画（60%），其余情况仍可随机到节日动画
    if (festivalOnly.length && rand() < 0.6) return festivalOnly;
    return kept;
}

// ============================================================================
// 回合用量统计
// ============================================================================

/** 空用量累加器 */
export function emptyUsage() {
    return { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0, calls: 0 };
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 把一个 usage 对象累加进累加器（返回新对象）。
 * 兼容两种命名：DSH/Anthropic 风格（input/output/cacheRead/reasoning）
 * 与 OpenAI/DeepSeek 风格（prompt_tokens/completion_tokens/…_cache_hit_tokens）。
 * 缺字段一律按 0，坏数据不抛错（usage 帧是外部输入）。
 */
export function addUsage(acc, usage) {
    const base = acc || emptyUsage();
    if (!usage || typeof usage !== 'object') return base;
    const details = usage.completion_tokens_details || usage.output_tokens_details || {};
    const input = num(usage.input ?? usage.inputTokens ?? usage.prompt_tokens);
    const output = num(usage.output ?? usage.outputTokens ?? usage.completion_tokens);
    const cacheRead = num(
        usage.cacheRead ?? usage.cache_read ?? usage.cachedInputTokens ?? usage.prompt_cache_hit_tokens
    );
    const reasoning = num(usage.reasoning ?? usage.reasoningTokens ?? details.reasoning_tokens);
    const declared = num(usage.total ?? usage.totalTokens ?? usage.total_tokens);
    return {
        input: base.input + input,
        output: base.output + output,
        cacheRead: base.cacheRead + cacheRead,
        reasoning: base.reasoning + reasoning,
        // 未声明 total 时用 input+output（cacheRead 已包含在 input 里，不重复计）
        total: base.total + (declared || input + output),
        calls: base.calls + 1,
    };
}

/** 累计 token 总量（用于气泡展示） */
export function usageTotal(usage) {
    if (!usage) return 0;
    return num(usage.total) || num(usage.input) + num(usage.output);
}

/** 毫秒 → "3m20s" / "45s" / "1h02m"（通用符号，不做本地化） */
export function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
    if (total < 60) return Math.round(total) + 's';
    const minutes = Math.floor(total / 60);
    const seconds = Math.round(total % 60);
    if (minutes < 60) return seconds ? minutes + 'm' + String(seconds).padStart(2, '0') + 's' : minutes + 'm';
    const hours = Math.floor(minutes / 60);
    return hours + 'h' + String(minutes % 60).padStart(2, '0') + 'm';
}

/** token 数 → "8.4k" / "1.2M" / "842" */
export function formatTokens(count) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
    return (n / 1000000).toFixed(1) + 'M';
}

/**
 * 回合统计摘要（供气泡展示；文本组装交给调用方做 i18n）。
 * @param {{startedAt?: number, endedAt?: number, tools?: number, usage?: object}} stats
 */
export function summarizeTurn(stats) {
    const s = stats || {};
    const durationMs =
        s.endedAt && s.startedAt ? Math.max(0, s.endedAt - s.startedAt) : Math.max(0, s.durationMs || 0);
    return {
        durationMs,
        tools: Math.max(0, Math.round(Number(s.tools) || 0)),
        tokens: usageTotal(s.usage),
        calls: s.usage && s.usage.calls ? s.usage.calls : 0,
    };
}
