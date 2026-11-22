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
    codex: Object.freeze({
        id: 'codex',
        label: 'Codex',
        kind: 'local',
        windows: [
            { key: 'primary', label: '5h' },
            { key: 'secondary', label: '周' },
        ],
    }),
    'opencode-go': Object.freeze({
        id: 'opencode-go',
        label: 'OpenCode Go',
        kind: 'http',
        url: 'https://opencode.ai/zen/go/v1/usage',
        auth: 'bearer',
        refs: ['OPENCODE_GO_API_KEY'],
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
        refs: ['ZHIPU_API_KEY'],
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
        refs: ['ZHIPU_INTL_API_KEY'],
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
    const host = hostOf(baseURL);

    if (route === 'openai-codex' || host === 'chatgpt.com') return 'codex';
    if (route === 'opencode-go' || route === 'opencode' || host === 'opencode.ai') return 'opencode-go';

    if (
        route === 'zai' ||
        route === 'zai-coding-cn' ||
        route === 'zhipu' ||
        host === 'z.ai' ||
        host.endsWith('.z.ai') ||
        host === 'open.bigmodel.cn' ||
        host.endsWith('.bigmodel.cn')
    ) {
        if (host.endsWith('.z.ai') || host === 'z.ai') return 'glm-intl';
        if (host.endsWith('.bigmodel.cn') || host === 'open.bigmodel.cn') return 'glm-cn';
        return route === 'zai' ? 'glm-intl' : 'glm-cn';
    }
    return null;
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

/** Codex rate_limits 窗口 → 统一窗口；字段名跨版本做容错。 */
export function normalizeCodexWindow(raw, label) {
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
    if (seconds !== null && seconds >= 0) resetAt = Date.now() + seconds * 1000;
    else
        resetAt = normalizeReset(
            raw.resets_at ||
                raw.reset_at ||
                raw.reset_time ||
                raw.next_reset ||
                raw.resetAt ||
                raw.nextResetTime
        );
    if (usedPct === null && resetAt === null) return null;
    const minutes = pickNumber(raw, ['window_minutes', 'windowMinutes', 'window', 'period_minutes']);
    return {
        key: label === '周' ? 'weekly' : 'rolling',
        label,
        usedPct,
        resetAt,
        windowMinutes: minutes,
    };
}

/** Codex token_count 的 rate_limits → 统一窗口；优先 primary=5h、secondary=周。 */
export function normalizeCodexRateLimits(rateLimits) {
    if (!rateLimits || typeof rateLimits !== 'object') return null;
    const primary = normalizeCodexWindow(rateLimits.primary, '5h');
    const secondary = normalizeCodexWindow(rateLimits.secondary, '周');
    if (!primary && !secondary) return null;
    return {
        windows: [primary, secondary].filter(Boolean),
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

/** 从一段 JSONL 文本里找最后一个非空 rate_limits。 */
export function findCodexRateLimits(text) {
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
        if (rl && typeof rl === 'object') return rl;
    }
    return null;
}

/**
 * 读 Codex 本地日志里的最新 rate_limits。
 * @returns {Promise<{ok:boolean, status:string, provider:string, windows?:Array, error?:string}>}
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
        const rl = findCodexRateLimits(text);
        if (!rl) continue;
        const normalized = normalizeCodexRateLimits(rl);
        if (normalized && normalized.windows.length) {
            return {
                ok: true,
                status: 'ready',
                provider: 'codex',
                windows: normalized.windows,
                planType: normalized.planType,
                reached: normalized.reached,
                at: Date.now(),
            };
        }
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
    const body = await response.json();
    const windows = parseQuotaPayload(providerId, body);
    if (!response.ok || !windows) {
        const err = new Error('quota request failed');
        err.code = response.status === 401 || response.status === 403 ? 'auth' : 'upstream';
        throw err;
    }
    return { windows, at: Date.now() };
}
