/**
 * ============================================================================
 * 余额提示 —— 纯逻辑（金额、阈值状态机、持久化）
 * ============================================================================
 *
 * 为什么单独成文件：余额来源（账户/套餐/钱包）由宿主分类，但「金额怎么比、
 * 什么时候该提醒、提醒过没有」必须能在 node --test 里跑全矩阵，且不能依赖
 * DOM、网络或 React。
 *
 * 两条底线：
 *   1. 金额保持字符串，只用 BigInt 做定点比较/求和，绝不转 Number；
 *   2. 提醒状态按 source:provider 分开，account 与 wallet 的 DeepSeek 余额
 *      不是同一口径，不能互相复位。
 */

export const BALANCE_ALERT_STORAGE_KEY = 'dsh-whale-pet.balanceAlert.v2';
export const BALANCE_REFRESH_OPTIONS = Object.freeze([30000, 60000, 300000, 0]);
export const BALANCE_CURRENCIES = Object.freeze(['CNY', 'USD']);

export const DEFAULT_BALANCE = Object.freeze({
    alert: true,
    thresholds: Object.freeze({ CNY: 5, USD: 1 }),
    refreshMs: 60000,
    turnRefresh: true,
    allowApiKey: true,
    timeoutMs: 12000,
    quotaAlert: Object.freeze({ weeklyPct: 5, monthlyPct: 5 }),
});

// 套餐周/月额度默认剩余阈值；配置里可分别手改 quotaAlert.weeklyPct / monthlyPct。
export const QUOTA_ALERT_REMAINING_PCT = 5;

/**
 * 把服务商/账户返回的十进制字符串规范成普通十进制。
 * 接受 "12.34"、"0E-16"、"-1.2e+3"；非法或指数过大返回 null。
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeDecimal(value) {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string') return null;
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
    if (!m) return null;
    const int = m[2] || '';
    const frac = m[3] || '';
    if (!int && !frac) return null;
    const exp = m[4] === undefined ? 0 : parseInt(m[4], 10);
    if (!Number.isFinite(exp) || Math.abs(exp) > 1000) return null;

    const digits = int + frac;
    const point = int.length + exp;
    let plain;
    if (point <= 0) plain = '0.' + '0'.repeat(-point) + digits;
    else if (point >= digits.length) plain = digits + '0'.repeat(point - digits.length);
    else plain = digits.slice(0, point) + '.' + digits.slice(point);

    const parts = plain.split('.');
    const ip = parts[0].replace(/^0+/, '') || '0';
    const fp = (parts[1] || '').replace(/0+$/, '');
    const normalized = fp ? ip + '.' + fp : ip;
    if (normalized === '0') return '0';
    return (m[1] === '-' ? '-' : '') + normalized;
}

function partsOf(value) {
    const normalized = normalizeDecimal(value);
    if (normalized === null) return null;
    const negative = normalized.charAt(0) === '-';
    const abs = negative ? normalized.slice(1) : normalized;
    const dot = abs.indexOf('.');
    return {
        negative,
        int: dot === -1 ? abs : abs.slice(0, dot),
        frac: dot === -1 ? '' : abs.slice(dot + 1),
    };
}

function scaledBigInt(parts, scale) {
    const n = BigInt(parts.int + parts.frac.padEnd(scale, '0'));
    return parts.negative ? -n : n;
}

/**
 * 精确比较两个十进制字符串。
 * @returns {-1|0|1|null} null 表示任一金额非法
 */
export function decimalCompare(a, b) {
    const A = partsOf(a);
    const B = partsOf(b);
    if (!A || !B) return null;
    if (A.negative !== B.negative) return A.negative ? -1 : 1;
    const scale = Math.max(A.frac.length, B.frac.length);
    const left = scaledBigInt(A, scale);
    const right = scaledBigInt(B, scale);
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function formatScaled(value, scale) {
    const negative = value < BigInt(0);
    let text = (negative ? -value : value).toString();
    if (scale > 0) {
        text = text.padStart(scale + 1, '0');
        const cut = text.length - scale;
        text = text.slice(0, cut) + '.' + text.slice(cut);
    }
    const parts = text.split('.');
    const ip = parts[0].replace(/^0+/, '') || '0';
    const fp = (parts[1] || '').replace(/0+$/, '');
    const normalized = fp ? ip + '.' + fp : ip;
    if (normalized === '0') return '0';
    return (negative ? '-' : '') + normalized;
}

/** 精确求和两个十进制字符串；非法输入返回 null。 */
export function addDecimal(a, b) {
    const A = partsOf(a);
    const B = partsOf(b);
    if (!A || !B) return null;
    const scale = Math.max(A.frac.length, B.frac.length);
    return formatScaled(scaledBigInt(A, scale) + scaledBigInt(B, scale), scale);
}

/** 读取某币种阈值；<=0 / 非法 = 关闭该币种。 */
export function thresholdOf(thresholds, currency) {
    const n = Number(thresholds && thresholds[currency]);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
}

/** 提醒状态键：account:deepseek 与 wallet:deepseek 不能混。 */
export function sourceKey(source, provider) {
    return String(source || 'unknown') + ':' + String(provider || 'unknown');
}

/**
 * 金额展示格式：固定两位小数（直接截断，不四舍五入），如 18.25840318 → 18.25、20 → 20.00。
 * 只用于展示；比较/求和仍走 normalizeDecimal + decimalCompare/addDecimal 的全精度字符串。
 * @param {unknown} value
 * @returns {string} 非法金额返回空串
 */
export function formatMoney(value) {
    const normalized = normalizeDecimal(value);
    if (normalized === null) return '';
    const negative = normalized.charAt(0) === '-';
    const abs = negative ? normalized.slice(1) : normalized;
    const dot = abs.indexOf('.');
    const int = dot === -1 ? abs : abs.slice(0, dot);
    const frac = dot === -1 ? '' : abs.slice(dot + 1);
    const minor = BigInt(int + frac.slice(0, 2).padEnd(2, '0'));
    const whole = (minor / BigInt(100)).toString();
    const cents = (minor % BigInt(100)).toString().padStart(2, '0');
    const sign = negative && (whole !== '0' || cents !== '00') ? '-' : '';
    return sign + whole + '.' + cents;
}

export function formatThreshold(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toFixed(2);
}

export function emptyAlertStore() {
    return { v: 2, sources: {} };
}

function sanitizeSourceState(value) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    for (const currency of Object.keys(value)) {
        if (!/^[A-Za-z]{2,8}$/.test(currency)) continue;
        const entry = value[currency];
        if (!entry || typeof entry !== 'object') continue;
        out[currency] = {
            below: entry.below === true,
            at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
        };
    }
    return out;
}

export function readAlertStore(storage, key = BALANCE_ALERT_STORAGE_KEY) {
    try {
        const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
        if (!raw) return emptyAlertStore();
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== 2 || !parsed.sources || typeof parsed.sources !== 'object')
            return emptyAlertStore();
        const store = emptyAlertStore();
        for (const source of Object.keys(parsed.sources).slice(0, 20)) {
            if (typeof source !== 'string' || !source) continue;
            store.sources[source] = sanitizeSourceState(parsed.sources[source]);
        }
        return store;
    } catch (e) {
        return emptyAlertStore();
    }
}

export function writeAlertStore(storage, store, key = BALANCE_ALERT_STORAGE_KEY) {
    try {
        if (!storage || typeof storage.setItem !== 'function') return false;
        storage.setItem(key, JSON.stringify(store || emptyAlertStore()));
        return true;
    } catch (e) {
        return false;
    }
}

export function sourceStateOf(store, key) {
    const source = store && store.sources && store.sources[key];
    return source && typeof source === 'object' ? source : {};
}

export function setSourceState(store, key, state, limit = 20) {
    const base = store && store.sources ? store : emptyAlertStore();
    const sources = { ...base.sources };
    if (state && Object.keys(state).length) sources[key] = state;
    else delete sources[key];
    const keys = Object.keys(sources);
    while (keys.length > limit) delete sources[keys.shift()];
    return { v: 2, sources };
}

/**
 * 每个币种独立判定：低于阈值且上次不低 → 提醒一次；回到阈值以上 → 复位。
 * @param {{state?: object, balances?: Array, thresholds?: object, now?: number}} input
 * @returns {{alerts: Array, state: object, changed: boolean}}
 */
export function evaluateBalanceAlerts(input) {
    const i = input || {};
    const state = i.state && typeof i.state === 'object' ? i.state : {};
    const next = { ...state };
    const alerts = [];
    let changed = false;
    for (const item of i.balances || []) {
        if (!item || typeof item.currency !== 'string') continue;
        const currency = item.currency;
        const threshold = thresholdOf(i.thresholds, currency);
        if (!(threshold > 0)) {
            if (Object.prototype.hasOwnProperty.call(next, currency)) {
                delete next[currency];
                changed = true;
            }
            continue;
        }
        const total = normalizeDecimal(item.total);
        if (total === null) continue;
        const low = decimalCompare(total, threshold.toFixed(2)) < 0;
        const was = !!(next[currency] && next[currency].below);
        if (low && !was) alerts.push({ currency, total, threshold });
        if (low !== was) {
            next[currency] = { below: low, at: Number.isFinite(i.now) ? i.now : Date.now() };
            changed = true;
        }
    }
    return { alerts, state: next, changed };
}

/**
 * 账户钱包（normal + bonus）合并。返回按 CNY/USD 优先排序的金额列表。
 * @param {Array} normal
 * @param {Array} bonus
 */
export function mergeWalletBalances(normal, bonus) {
    const by = {};
    const add = (list, field) => {
        for (const wallet of list || []) {
            if (!wallet || typeof wallet.currency !== 'string') continue;
            const amount = normalizeDecimal(wallet.balance);
            if (amount === null) continue;
            if (!by[wallet.currency]) {
                by[wallet.currency] = { currency: wallet.currency, total: '0', normal: '0', bonus: '0' };
            }
            by[wallet.currency][field] = addDecimal(by[wallet.currency][field], amount);
        }
    };
    add(normal, 'normal');
    add(bonus, 'bonus');
    const order = (currency) => {
        const at = BALANCE_CURRENCIES.indexOf(currency);
        return at === -1 ? BALANCE_CURRENCIES.length : at;
    };
    return Object.keys(by)
        .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
        .map((currency) => {
            const row = by[currency];
            return {
                currency,
                total: addDecimal(row.normal, row.bonus) || '0',
                normal: row.normal,
                bonus: row.bonus,
            };
        });
}

/**
 * 套餐周/月额度不足判定：每个窗口只在首次跌破阈值时提醒，恢复后重新武装。
 * 5h 窗口不参与（用户只要求周/月）；金额与百分比都只用于展示，不参与钱包比较。
 * @param {{state?: object, windows?: Array, thresholdPct?: number, now?: number}} input
 * @returns {{alerts: Array, state: object, changed: boolean}}
 */
export function evaluateQuotaAlerts(input) {
    const i = input || {};
    const state = i.state && typeof i.state === 'object' ? i.state : {};
    const next = { ...state };
    const alerts = [];
    let changed = false;
    const rawThreshold = Number(i.thresholdPct);
    const fallback = Number.isFinite(rawThreshold)
        ? Math.max(0, Math.min(100, rawThreshold))
        : QUOTA_ALERT_REMAINING_PCT;
    const configured = i.thresholds && typeof i.thresholds === 'object' ? i.thresholds : {};
    const thresholdFor = (key) => {
        const n = Number(configured[key]);
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
    };
    for (const window of i.windows || []) {
        if (!window || typeof window !== 'object') continue;
        const rawKey = String(window.key || '').toLowerCase();
        const key =
            rawKey === 'monthly' || window.label === '月'
                ? 'monthly'
                : rawKey === 'weekly' || window.label === '周'
                  ? 'weekly'
                  : null;
        if (!key) continue;
        const threshold = thresholdFor(key);
        if (window.usedPct === null || window.usedPct === undefined || window.usedPct === '') continue;
        const used = Number(window.usedPct);
        if (!Number.isFinite(used)) continue;
        const remaining = Math.max(0, 100 - Math.max(0, Math.min(100, used)));
        const low = remaining <= threshold + 1e-9;
        const was = !!(next[key] && next[key].below);
        if (low && !was) alerts.push({ key, remainingPct: remaining });
        if (low !== was) {
            next[key] = { below: low, at: Number.isFinite(i.now) ? i.now : Date.now() };
            changed = true;
        }
    }
    return { alerts, state: next, changed };
}

/** 额度不足提醒文案；窗口名走词条，避免在非中文界面里出现「周/月」。 */
export function formatQuotaAlert(alerts, providerLabel, t) {
    const tr =
        typeof t === 'function'
            ? t
            : function (key) {
                  return key;
              };
    const list = (alerts || []).slice(0, 2).map((alert) => {
        const windowLabel = tr(alert.key === 'monthly' ? 'quotaWindowMonth' : 'quotaWindowWeek');
        const remaining = Math.max(0, Math.floor(Number(alert.remainingPct) * 10) / 10);
        return tr('quotaAlertLine')
            .replace('{window}', windowLabel)
            .replace('{remaining}', String(remaining));
    });
    if ((alerts || []).length > 2) list.push('…');
    return {
        title: tr('quotaAlertTitle'),
        body: (providerLabel ? providerLabel + ' · ' : '') + list.join(' · '),
    };
}

/**
 * 低余额提醒文案。多币种合并，最多列 2 个。
 * @param {Array} alerts
 * @param {string} providerLabel
 * @param {(key: string) => string} t
 */
export function formatBalanceAlert(alerts, providerLabel, t) {
    const tr =
        typeof t === 'function'
            ? t
            : function (key) {
                  return key;
              };
    const list = (alerts || []).slice(0, 2).map((alert) => {
        const line = tr('balanceAlertLine');
        return line
            .replace('{amount}', alert.currency + ' ' + (formatMoney(alert.total) || alert.total))
            .replace('{threshold}', formatThreshold(alert.threshold));
    });
    if ((alerts || []).length > 2) list.push('…');
    return {
        title: tr('balanceAlertTitle'),
        body: (providerLabel ? providerLabel + ' · ' : '') + list.join(' · '),
    };
}
