/**
 * DeepSeek 余额解析。
 *
 * 注意：请求端点不在这里解析——端点固定为官方白名单
 * （balance-providers.js 的 PROVIDERS 表），配置的 baseURL 只用于
 * 匹配服务商、绝不参与请求，因此无需按 baseURL 解析端点。
 */

/**
 * 原样保留官方余额字符串，不转换为 JavaScript 数字，避免小数精度损失。
 *
 * @param {unknown} body - DeepSeek /user/balance 响应体
 * @returns {{ currency: 'CNY' | 'USD', total: string }[]} 规范化余额列表
 */
export function parseDeepSeekBalances(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.balance_infos)) return [];
    return body.balance_infos.flatMap((info) => {
        if (!info || typeof info !== 'object') return [];
        const currency = info.currency;
        const total = info.total_balance;
        if (
            (currency !== 'CNY' && currency !== 'USD') ||
            typeof total !== 'string' ||
            !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(total)
        )
            return [];
        return [{ currency, total }];
    });
}
