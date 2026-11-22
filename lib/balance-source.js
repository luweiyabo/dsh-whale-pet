/**
 * 余额来源分类与错误翻译（宿主侧纯函数）。
 *
 * 为什么单独成文件：来源判定是「是否使用 API key」的唯一闸门，必须能在
 * node --test 里把 account / plan / wallet / unsupported 全矩阵跑一遍，
 * 且不能依赖网络、凭据或 Web 服务器。
 *
 * 关键顺序：account → plan → wallet → unsupported。任何一步都不能被
 * route 字符串的模糊匹配绕过，否则会把 A 服务商的 key 发到 B 服务商。
 */

import { matchBalanceProviderBaseURL } from './balance-providers.js';

/** 已知的套餐/订阅路由（DSH 0.2.2-rc.5 的 pi-ai 目录）。 */
export const PLAN_PROVIDER_IDS = Object.freeze([
    'kimi-coding',
    'zai',
    'zai-coding-cn',
    'qwen-token-plan',
    'qwen-token-plan-cn',
    'qwen-token-plan-individual',
    'xiaomi-token-plan-ams',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-sgp',
    'openai-codex',
    'github-copilot',
]);

const PLAN_PROVIDER_SET = new Set(PLAN_PROVIDER_IDS);

/** 套餐/订阅端点的兜底模式；自定义路由指向这些地址时也不查钱包。 */
const PLAN_BASE_URL_PATTERNS = [
    /\/coding(?:\/|$)/i,
    /token-plan/i,
    /chatgpt\.com\/backend-api/i,
    /api\.individual\.githubcopilot\.com/i,
];

/** 已验证的钱包路由（仅在 profile 没有 baseURL 时使用）。 */
const WALLET_ROUTE_PROVIDER = Object.freeze({
    deepseek: 'deepseek',
    'deepseek-official': 'deepseek',
    moonshot: 'moonshot',
    'moonshotai-cn': 'moonshot',
    stepfun: 'stepfun',
});

const CERT_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const NETWORK_CODES = new Set([
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
]);

function lower(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function planKindOf(route, baseURL) {
    const text = lower(route) + ' ' + lower(baseURL);
    if (/token-plan/.test(text)) return 'token-plan';
    if (/codex|copilot|backend-api|oauth/.test(text)) return 'subscription';
    return 'coding-plan';
}

function isPlanRoute(route, baseURL) {
    return PLAN_PROVIDER_SET.has(route) || PLAN_BASE_URL_PATTERNS.some((pattern) => pattern.test(baseURL));
}

/**
 * 判定当前模型路由的余额来源。
 *
 * @param {{route?: string, provider?: string, baseURL?: string}} input
 * @returns {{source: 'account'|'plan'|'wallet'|'unsupported', provider?: string,
 *            planKind?: string, reason?: string}}
 */
export function classifyBalanceSource(input) {
    const i = input || {};
    const route = lower(i.route);
    const provider = lower(i.provider) || route;
    const baseURL = typeof i.baseURL === 'string' ? i.baseURL.trim() : '';

    // 1. DeepSeek 账户路由：使用账户登录态，绝不进入 API-key 钱包分支。
    if (provider === 'deepseek-account' || route === 'deepseek-account') {
        return { source: 'account', provider: 'deepseek', reason: 'account' };
    }

    // 2. 套餐/订阅：没有钱包端点，也不应使用 API key 探测。
    if (isPlanRoute(provider, baseURL) || isPlanRoute(route, baseURL)) {
        return {
            source: 'plan',
            provider,
            planKind: planKindOf(route || provider, baseURL),
            reason: 'plan',
        };
    }

    // 3. 钱包：只认已验证的 origin。存在非空 baseURL 但不在白名单时，
    //    不允许回退到 route 推断——自定义网关的 key 不能发去官方端点。
    const byRoute = WALLET_ROUTE_PROVIDER[provider] || WALLET_ROUTE_PROVIDER[route];
    const byBaseURL = matchBalanceProviderBaseURL(baseURL);
    if (byBaseURL) {
        // 已知钱包路由与 baseURL 指向不同服务商时拒绝：不能把 A 的 key
        // 发去 B 的余额端点。未知自定义路由仍可按 baseURL 使用官方端点。
        if (byRoute && byRoute !== byBaseURL)
            return { source: 'unsupported', reason: 'wallet-route-mismatch' };
        return { source: 'wallet', provider: byBaseURL, reason: 'wallet' };
    }
    if (baseURL) return { source: 'unsupported', reason: 'unverified-base-url' };

    // 没有 baseURL 时才允许精确 route 映射；不做 kimi/moonshot 子串推断。
    if (byRoute) return { source: 'wallet', provider: byRoute, reason: 'wallet-route' };

    return { source: 'unsupported', reason: 'unknown-route' };
}

/**
 * 把 fetch/undici 异常翻译成稳定的错误码。
 * @param {unknown} error
 * @returns {'timeout'|'tls'|'network'|'protocol'}
 */
export function balanceErrorCode(error) {
    const e = error || {};
    const name = typeof e.name === 'string' ? e.name : '';
    const code = String(e.code || (e.cause && e.cause.code) || '').toUpperCase();
    if (
        name === 'TimeoutError' ||
        name === 'AbortError' ||
        code === 'ETIMEDOUT' ||
        code === 'UND_ERR_CONNECT_TIMEOUT'
    )
        return 'timeout';
    if (CERT_CODES.has(code) || /CERT|TLS|SSL/i.test(code)) return 'tls';
    if (NETWORK_CODES.has(code) || /ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/.test(code))
        return 'network';
    return 'protocol';
}

/** 只暴露代理变量是否存在，绝不回传 URL/凭据。 */
export function proxyEnvPresence(env) {
    const e = env || process.env || {};
    const has = (name) => typeof e[name] === 'string' && e[name].trim().length > 0;
    return {
        http: has('HTTP_PROXY') || has('http_proxy'),
        https: has('HTTPS_PROXY') || has('https_proxy'),
        all: has('ALL_PROXY') || has('all_proxy'),
        noProxy: has('NO_PROXY') || has('no_proxy'),
    };
}

/** 用户可见的稳定错误文案；不含 URL/凭据。 */
export function balanceErrorMessage(code, label) {
    const who = label || '服务商';
    if (code === 'timeout') return '余额查询超时（代理或网络较慢）';
    if (code === 'tls') return '代理证书不受信任；需配置 NODE_EXTRA_CA_CERTS 后重启 DSH';
    if (code === 'network') return '余额查询失败（网络/代理不可达）';
    if (code === 'auth') return who + ' 凭据被拒绝，请检查 API key 或重新登录';
    if (code === 'quota') return who + ' 额度不足';
    if (code === 'missing-key') return who + ' API key 未配置';
    if (code === 'upstream') return who + ' 余额接口返回错误';
    return who + ' 余额响应无效';
}
