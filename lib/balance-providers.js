import { parseDeepSeekBalances } from './deepseek-balance.js';

const PROVIDERS = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/user/balance',
    origin: 'https://api.deepseek.com',
    refs: Object.freeze(['DEEPSEEK_API_KEY']),
    settings: Object.freeze(['llm-deepseek']),
  }),
  moonshot: Object.freeze({
    id: 'moonshot',
    label: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1/users/me/balance',
    origin: 'https://api.moonshot.cn',
    refs: Object.freeze(['MOONSHOT_API_KEY']),
    settings: Object.freeze(['llm-moonshot', 'llm-kimi']),
  }),
  stepfun: Object.freeze({
    id: 'stepfun',
    label: '阶跃星辰',
    endpoint: 'https://api.stepfun.com/v1/accounts',
    origin: 'https://api.stepfun.com',
    refs: Object.freeze(['STEPFUN_API_KEY', 'STEP_API_KEY']),
    settings: Object.freeze(['llm-stepfun', 'llm-step']),
  }),
});

export const BALANCE_PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

export function getBalanceProvider(id) {
  return PROVIDERS[id];
}

export function matchBalanceProviderBaseURL(baseURL) {
  if (typeof baseURL !== 'string' || !baseURL.trim()) return undefined;
  let origin;
  try { origin = new URL(baseURL).origin; } catch { return undefined; }
  return BALANCE_PROVIDER_IDS.find((id) => PROVIDERS[id].origin === origin);
}

export function inferBalanceProviderFromRoute(route) {
  if (typeof route !== 'string') return undefined;
  const value = route.toLowerCase();
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('moonshot') || value.includes('kimi')) return 'moonshot';
  if (value.includes('stepfun') || /(^|[-_])step($|[-_])/.test(value)) return 'stepfun';
  return undefined;
}

function decimalString(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return undefined;
    value = String(value);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  return value;
}

/** Normalize official provider responses without doing token-price estimates. */
export function parseProviderBalances(provider, body) {
  if (provider === 'deepseek') return parseDeepSeekBalances(body);
  if (!body || typeof body !== 'object') return [];
  if (provider === 'moonshot') {
    if (body.status !== true || !body.data || typeof body.data !== 'object') return [];
    const total = decimalString(body.data.available_balance);
    return total === undefined ? [] : [{ currency: 'CNY', total }];
  }
  if (provider === 'stepfun') {
    if (body.object !== 'account') return [];
    const total = decimalString(body.balance);
    return total === undefined ? [] : [{ currency: 'CNY', total }];
  }
  return [];
}
