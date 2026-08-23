import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeekBalances } from '../lib/deepseek-balance.js';

test('将所有官方余额金额保留为精确十进制字符串', () => {
  assert.deepEqual(parseDeepSeekBalances({
    balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00' },
      { currency: 'USD', total_balance: '0.00000001', granted_balance: '0' },
    ],
  }), [
    { currency: 'CNY', total: '110.00' },
    { currency: 'USD', total: '0.00000001' },
  ]);
});

test('不显示格式错误或无文档依据的余额值', () => {
  assert.deepEqual(parseDeepSeekBalances({ balance_infos: [
    { currency: 'EUR', total_balance: '1.00' },
    { currency: 'CNY', total_balance: 1 },
    { currency: 'USD', total_balance: 'NaN' },
  ] }), []);
  assert.deepEqual(parseDeepSeekBalances(null), []);
});
