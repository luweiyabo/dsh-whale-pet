/**
 * 套餐额度查询：Codex 本地日志、OpenCode Go、GLM Coding（国内 / z.ai 国际）。
 *
 * 设计边界：
 * - 只认固定官方端点，不接受自定义 URL；
 * - Codex 只读本地 rollout 日志，不联网、不读 OAuth token；
 * - 余额（钱）与额度（窗口用量）分开，不把额度百分比当余额；
 * - 没有接口 / 日志里没有 rate_limits 时返回 unavailable，不伪造数字。
 */

import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const QUOTA_CACHE_MS = 60_000;
export const QUOTA_ERROR_CACHE_MS = 15_000;

export const QUOTA_PROVIDERS = Object.freeze({
    // Codex 的窗口来自本地日志里的 rate_limits（无固定窗口元数据），所以不维护
    // 静态 windows 清单；parseQuotaPayload 也只处理 kind === 'http' 的厂商。
    codex: Object.freeze({
        id: 'codex',
        label: 'Codex',
        kind: 'local',
    }),
    'opencode-go': Object.freeze({
        id: 'opencode-go',
        label: 'OpenCode Go',
        kind: 'http',
        url: 'https://opencode.ai/zen/go/v1/usage',
        auth: 'bearer',
        refs: ['OPENCODE_API_KEY'],
        windows: [
            {
                key: 'rolling',
                label: '5h',
                percent: 'usage.rolling.percent',
                resetAt: 'usage.rolling.resetsAt',
            },
            { key: 'weekly', label: '周', percent: 'usage.weekly.percent', resetAt: 'usage.weekly.resetsAt' },
            {
                key: 'monthly',
                label: '月',
                percent: 'usage.monthly.percent',
                resetAt: 'usage.monthly.resetsAt',
            },
        ],
    }),
    'glm-cn': Object.freeze({
        id: 'glm-cn',
        label: 'GLM Coding（国内）',
        kind: 'http',
        url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
        auth: 'raw',
        refs: ['ZAI_CODING_CN_API_KEY'],
        windows: [
            {
                key: 'rolling',
                label: '5h',
                pick: { list: 'data.limits', types: ['TOKENS_LIMIT', 'CREDIT_LIMIT'], unit: 3 },
                percent: 'percentage',
                resetAt: 'nextResetTime',
            },
            {
                key: 'weekly',
                label: '周',
                pick: { list: 'data.limits', types: ['TOKENS_LIMIT', 'CREDIT_LIMIT'], unit: 6 },
                percent: 'percentage',
                resetAt: 'nextResetTime',
            },
        ],
    }),
    'glm-intl': Object.freeze({
        id: 'glm-intl',
        label: 'GLM Coding（z.ai）',
        kind: 'http',
        url: 'https://api.z.ai/api/monitor/usage/quota/limit',
        auth: 'raw',
        refs: ['ZAI_API_KEY'],
        windows: [
            {
                key: 'rolling',
                label: '5h',
                pick: { list: 'data.limits', types: ['TOKENS_LIMIT', 'CREDIT_LIMIT'], unit: 3 },
                percent: 'percentage',
                resetAt: 'nextResetTime',
            },
            {
                key: 'weekly',
                label: '周',
                pick: { list: 'data.limits', types: ['TOKENS_LIMIT', 'CREDIT_LIMIT'], unit: 6 },
                percent: 'percentage',
                resetAt: 'nextResetTime',
            },
        ],
    }),
});

function lower(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hostOf(baseURL) {
    try {
        return new URL(baseURL).host.toLowerCase();
    } catch {
        return '';
    }
}

/**
 * 从当前模型路由识别额度来源。
 * @param {{route?: string, provider?: string, baseURL?: string}} input
 * @returns {string|null} QUOTA_PROVIDERS 的 key
 */
export function classifyQuotaProvider(input) {
    const i = input || {};
    const route = lower(i.route || i.provider);
    const baseURL = typeof i.baseURL === 'string' ? i.baseURL.trim() : '';
    if (baseURL) {
        // 用户配置了 baseURL 时只按官方主机分类：否则 route='zai' 等会把
        // 自定义中转站的 key 发去官方端点。不是官方主机（含非法 URL）一律不可用。
        const host = hostOf(baseURL);
        if (host === 'chatgpt.com') return 'codex';
        if (host === 'opencode.ai') return 'opencode-go';
        if (host === 'z.ai' || host.endsWith('.z.ai')) return 'glm-intl';
        if (host === 'open.bigmodel.cn' || host.endsWith('.bigmodel.cn')) return 'glm-cn';
        return null;
    }
    // 没有 baseURL 时才允许按 route id 精确映射（不猜字符串子串）。
    if (route === 'openai-codex') return 'codex';
    if (route === 'opencode-go' || route === 'opencode') return 'opencode-go';
    if (route === 'zai') return 'glm-intl';
    if (route === 'zai-coding-cn' || route === 'zhipu') return 'glm-cn';
    return null;
}

const ENV_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 额度查询的凭据引用顺序：profile.apiKeyEnv → 厂商固定 fallback → DSH
 * 注册表 nativeAuth.env（真实安装的环境变量名）。去重、过滤非法名字；
 * 这里只拼引用名，不接触 baseURL，避免把 key 发去非官方主机。
 * @param {string} providerId
 * @param {{apiKeyEnv?: string, nativeEnv?: string[]}} options
 * @returns {string[]}
 */
export function quotaKeyRefs(providerId, options = {}) {
    const def = QUOTA_PROVIDERS[providerId] || {};
    const out = [];
    const add = (ref) => {
        if (typeof ref !== 'string') return;
        const value = ref.trim();
        if (!value || out.indexOf(value) !== -1 || !ENV_REF_RE.test(value)) return;
        out.push(value);
    };
    add(options.apiKeyEnv);
    for (const ref of Array.isArray(def.refs) ? def.refs : []) add(ref);
    for (const ref of Array.isArray(options.nativeEnv) ? options.nativeEnv : []) add(ref);
    return out;
}

/** 只取对象路径的最小子集；不存在返回 undefined。支持 a.b[0].c。 */
export function getPath(value, path) {
    if (typeof path !== 'string' || !path) return undefined;
    return path
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean)
        .reduce((cur, key) => (cur == null ? undefined : cur[key]), value);
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeReset(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value === 'string') {
        if (/^\d+$/.test(value)) {
            const n = Number(value);
            return n < 1e12 ? n * 1000 : n;
        }
        const t = Date.parse(value);
        return Number.isFinite(t) ? t : null;
    }
    return null;
}

/**
 * 把智谱 GLM Coding 的扁平常量数组按 type/unit 选中一条。
 * @param {unknown} data
 * @param {{list?: string, types?: string[], unit?: number}} pick
 */
export function pickQuotaEntry(data, pick) {
    try {
        if (!pick || !pick.list) return null;
        const list = getPath(data, pick.list);
        if (!Array.isArray(list)) return null;
        const types = (pick.types || []).map(String);
        const unit = pick.unit === undefined ? null : Number(pick.unit);
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            if (types.length && types.indexOf(String(item.type)) < 0) continue;
            if (unit !== null && Number(item.unit) !== unit) continue;
            return item;
        }
        return null;
    } catch {
        return null;
    }
}

function windowOf(def, root) {
    const usedRaw = def.percent ? numberOrNull(getPath(root, def.percent)) : null;
    const usedPct = usedRaw === null ? null : Math.max(0, Math.min(100, usedRaw));
    const resetRaw = def.resetAt ? getPath(root, def.resetAt) : null;
    const resetAt = normalizeReset(resetRaw);
    if (usedPct === null && resetAt === null) return null;
    return { key: def.key, label: def.label, usedPct, resetAt };
}

/**
 * 解析额度接口 JSON。返回统一窗口数组；无窗口返回 null。
 * @param {'opencode-go'|'glm-cn'|'glm-intl'} providerId
 * @param {unknown} body
 */
export function parseQuotaPayload(providerId, body) {
    const def = QUOTA_PROVIDERS[providerId];
    if (!def || def.kind !== 'http' || !body || typeof body !== 'object') return null;
    const windows = [];
    for (const w of def.windows) {
        const root = w.pick ? pickQuotaEntry(body, w.pick) : body;
        if (!root) continue;
        const parsed = windowOf(w, root);
        if (parsed) windows.push(parsed);
    }
    return windows.length ? windows : null;
}

function pickNumber(value, keys) {
    for (const key of keys) {
        const n = numberOrNull(value && value[key]);
        if (n !== null) return n;
    }
    return null;
}

/** 默认窗口长度（分钟）：rate_limits 没写 window_minutes 时按窗口标签兜底。 */
const DEFAULT_WINDOW_MINUTES = Object.freeze({ '5h': 5 * 60, 周: 7 * 24 * 60 });

/**
 * Codex rate_limits 窗口 → 统一窗口；字段名跨版本做容错。
 *
 * `nowMs` 是这份 rate_limits 的采样时刻（日志里 rate-limit 事件自身的时间戳，
 * 缺失时用日志文件 mtime）。如果「现在 - 采样时刻」超过窗口自身长度，说明
 * 这条记录属于早已翻篇的窗口，usedPct 不能当当前值展示，返回带 expired 标记
 * 的占位窗口，由 normalizeCodexRateLimits 统一丢弃。
 *
 * @returns {object|null} 无任何可用字段 → null；过期 → { expired: true, ... }
 */
export function normalizeCodexWindow(raw, label, nowMs = Date.now()) {
    if (!raw || typeof raw !== 'object') return null;
    let usedPct = pickNumber(raw, [
        'used_percent',
        'usedPercent',
        'percent',
        'used_pct',
        'usage_percent',
        'usagePercent',
    ]);
    const remainPct = pickNumber(raw, [
        'remaining_percent',
        'remainingPercent',
        'left_percent',
        'remaining_pct',
    ]);
    if (usedPct === null && remainPct !== null) usedPct = Math.max(0, 100 - remainPct);
    if (usedPct !== null) usedPct = Math.max(0, Math.min(100, usedPct));
    let resetAt = null;
    const seconds = pickNumber(raw, [
        'resets_in_seconds',
        'resetsInSeconds',
        'reset_after_seconds',
        'reset_in_seconds',
        'seconds_until_reset',
    ]);
    // nowMs 是这份 rate_limits 的采样时刻：相对秒数要先按采样时刻换算成绝对
    // 时间，再判断是否早就过期。
    const sampledMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (seconds !== null && seconds >= 0) resetAt = sampledMs + seconds * 1000;
    else
        resetAt = normalizeReset(
            raw.resets_at ||
                raw.reset_at ||
                raw.reset_time ||
                raw.next_reset ||
                raw.resetAt ||
                raw.nextResetTime
        );
    // 旧日志里的 reset 可能已经过去，不能再显示倒计时。
    if (resetAt !== null && resetAt <= Date.now()) resetAt = null;
    if (usedPct === null && resetAt === null) return null;
    const minutes = pickNumber(raw, ['window_minutes', 'windowMinutes', 'window', 'period_minutes']);
    const key = label === '周' ? 'weekly' : 'rolling';
    const windowMinutes = minutes !== null && minutes > 0 ? minutes : DEFAULT_WINDOW_MINUTES[label];
    // 采样时刻到现在的间隔超过窗口长度 → 该窗口已翻篇，丢弃 usedPct。
    if (windowMinutes && Date.now() - sampledMs > windowMinutes * 60_000) {
        return { key, label, usedPct: null, resetAt: null, windowMinutes, expired: true };
    }
    return {
        key,
        label,
        usedPct,
        resetAt,
        windowMinutes: minutes,
    };
}

/** Codex token_count 的 rate_limits → 统一窗口；优先 primary=5h、secondary=周。 */
export function normalizeCodexRateLimits(rateLimits, options = {}) {
    if (!rateLimits || typeof rateLimits !== 'object') return null;
    const nowMs = Number.isFinite(options && options.nowMs) ? options.nowMs : Date.now();
    const parsed = [
        normalizeCodexWindow(rateLimits.primary, '5h', nowMs),
        normalizeCodexWindow(rateLimits.secondary, '周', nowMs),
    ].filter(Boolean);
    // primary/secondary 都没有 rate_limits 数据：这份日志没有额度信息。
    if (!parsed.length) return null;
    const windows = parsed.filter((item) => !item.expired);
    return {
        windows,
        expiredWindows: parsed.length - windows.length,
        planType: rateLimits.plan_type ? String(rateLimits.plan_type) : '',
        reached: rateLimits.rate_limit_reached_type ? String(rateLimits.rate_limit_reached_type) : '',
    };
}

async function listJsonlFiles(root, depth = 0) {
    if (depth > 5) return [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const out = [];
    for (const entry of entries) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) out.push(...(await listJsonlFiles(full, depth + 1)));
        else if (entry.isFile() && /\.jsonl$/i.test(entry.name)) out.push(full);
    }
    return out;
}

async function readTail(path, maxBytes) {
    let handle;
    try {
        const info = await stat(path);
        const size = Math.min(info.size, maxBytes);
        if (!size) return '';
        handle = await open(path, 'r');
        const buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, Math.max(0, info.size - size));
        return buffer.toString('utf8');
    } catch {
        return '';
    } finally {
        if (handle) await handle.close().catch(() => {});
    }
}

/**
 * 从一段 JSONL 文本里找最后一个非空 rate_limits 及其采样时刻。
 * 采样时刻优先用事件自身的 timestamp（Codex 事件行带顶层 ISO 时间），
 * 缺失/非法时回退到 fallbackMs（通常传日志文件 mtime）。
 * @param {string} text
 * @param {number} [fallbackMs]
 * @returns {{rateLimits: object, sampledMs: number} | null}
 */
export function findCodexRateLimitSample(text, fallbackMs) {
    const lines = String(text || '').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line) continue;
        let item;
        try {
            item = JSON.parse(line);
        } catch {
            continue;
        }
        const payload = item && item.payload ? item.payload : item;
        const rl = (payload && payload.rate_limits) || (item && item.rate_limits) || null;
        if (!rl || typeof rl !== 'object') continue;
        let sampledMs = Number.isFinite(fallbackMs) ? fallbackMs : Date.now();
        const rawTime = item && (item.timestamp || item.time || item.created_at);
        if (typeof rawTime === 'string' || typeof rawTime === 'number') {
            const parsed =
                typeof rawTime === 'number'
                    ? rawTime < 1e12
                        ? rawTime * 1000
                        : rawTime
                    : Date.parse(rawTime);
            if (Number.isFinite(parsed) && parsed > 0) sampledMs = parsed;
        }
        return { rateLimits: rl, sampledMs };
    }
    return null;
}

/** 从一段 JSONL 文本里找最后一个非空 rate_limits。 */
export function findCodexRateLimits(text) {
    const sample = findCodexRateLimitSample(text);
    return sample ? sample.rateLimits : null;
}

/**
 * 读 Codex 本地日志里的最新 rate_limits。
 * 每个窗口用「采样时刻 + 窗口长度」判断是否过期（见 normalizeCodexWindow）；
 * 全部过期时返回 windows: [] + expired: true + at（采样时刻），不把过期
 * 百分比当当前值。
 * @returns {Promise<{ok:boolean, status:string, provider:string, windows?:Array, at?:number, expired?:boolean, error?:string}>}
 */
export async function readCodexQuota() {
    const home = (process.env.CODEX_HOME || join(homedir(), '.codex')).trim();
    const root = join(home, 'sessions');
    const archived = join(home, 'archived_sessions');
    const files = [...(await listJsonlFiles(root)), ...(await listJsonlFiles(archived))];
    if (!files.length) {
        return { ok: false, status: 'unavailable', provider: 'codex', error: '未找到 Codex 本地会话日志' };
    }
    const withStats = [];
    for (const file of files) {
        try {
            const info = await stat(file);
            withStats.push({ file, mtime: info.mtimeMs });
        } catch {
            /* 文件已删除 */
        }
    }
    withStats.sort((a, b) => b.mtime - a.mtime);
    for (const item of withStats.slice(0, 20)) {
        const text = await readTail(item.file, 512 * 1024);
        // 采样时刻：优先 rate-limit 事件自身时间戳，缺失时回退日志文件 mtime。
        const sample = findCodexRateLimitSample(text, item.mtime);
        if (!sample) continue;
        const normalized = normalizeCodexRateLimits(sample.rateLimits, { nowMs: sample.sampledMs });
        if (!normalized) continue;
        const at = Math.round(sample.sampledMs);
        if (normalized.windows.length) {
            return {
                ok: true,
                status: 'ready',
                provider: 'codex',
                windows: normalized.windows,
                planType: normalized.planType,
                reached: normalized.reached,
                at,
            };
        }
        // rate_limits 存在但所有窗口都已超过各自的窗口长度（例如最新日志还是
        // 好几周前的）：不把过期百分比当当前值，返回空窗口 + 采样时刻，让客户端
        // 显示「无数据/已过期」。更旧的日志只会更旧，无需继续扫描。
        return {
            ok: true,
            status: 'ready',
            provider: 'codex',
            windows: [],
            expired: true,
            planType: normalized.planType,
            reached: normalized.reached,
            at,
        };
    }
    return {
        ok: false,
        status: 'unavailable',
        provider: 'codex',
        error: 'Codex 日志中没有可用的 rate_limits（仅 ChatGPT 订阅账号会写入）',
    };
}

export async function fetchQuota(providerId, key, options = {}) {
    const def = QUOTA_PROVIDERS[providerId];
    if (!def || def.kind !== 'http') return null;
    if (!key) return null;
    const timeoutMs = Math.max(3000, Math.min(60000, Number(options.timeoutMs) || 12000));
    const response = await fetch(def.url, {
        headers: { Authorization: (def.auth === 'bearer' ? 'Bearer ' : '') + key },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
    });
    // 先记状态码，再防御性解析：HTML 错误页/损坏 JSON 不能让 401、402
    // 之类的上游状态退化成「协议错误」。
    const status = response.status;
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    const failed = (code) => {
        const err = new Error('quota request failed');
        err.code = code;
        return err;
    };
    if (status === 401 || status === 403) throw failed('auth');
    if (status === 402) throw failed('quota');
    if (!response.ok) throw failed('upstream');
    const windows = parseQuotaPayload(providerId, body);
    if (!windows) throw failed('protocol');
    return { windows, at: Date.now() };
}
