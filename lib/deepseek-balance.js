/**
 * DeepSeek 余额解析。
 *
 * 注意：请求端点不在这里解析——端点固定为官方白名单
 * （balance-providers.js 的 PROVIDERS 表），配置的 baseURL 只用于
 * 匹配服务商、绝不参与请求，因此无需按 baseURL 解析端点。
 */

/**
 * Preserve the official balance strings verbatim. In particular, do not turn
 * monetary values into JavaScript numbers: doing so can round decimal values.
 *
 * @param {unknown} body - DeepSeek /user/balance response body
 * @returns {{ currency: 'CNY' | 'USD', total: string }[]}
 */
export function parseDeepSeekBalances(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.balance_infos)) return [];
  return body.balance_infos.flatMap((info) => {
    if (!info || typeof info !== 'object') return [];
    const currency = info.currency;
    const total = info.total_balance;
    if (
      (currency !== 'CNY' && currency !== 'USD')
      || typeof total !== 'string'
      || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(total)
    ) return [];
    return [{ currency, total }];
  });
}
