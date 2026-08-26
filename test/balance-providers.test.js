import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BALANCE_PROVIDER_IDS,
    getBalanceProvider,
    inferBalanceProviderFromRoute,
    matchBalanceProviderBaseURL,
    parseProviderBalances,
} from '../lib/balance-providers.js';

test('只公开固定的官方余额端点', () => {
    assert.deepEqual(BALANCE_PROVIDER_IDS, ['deepseek', 'moonshot', 'stepfun']);
    assert.equal(getBalanceProvider('deepseek').endpoint, 'https://api.deepseek.com/user/balance');
    assert.equal(getBalanceProvider('moonshot').endpoint, 'https://api.moonshot.cn/v1/users/me/balance');
    assert.equal(getBalanceProvider('stepfun').endpoint, 'https://api.stepfun.com/v1/accounts');
    assert.equal(getBalanceProvider('zhipu'), undefined);
});

test('按实际供应商路由和官方基础地址映射，不根据模型名称猜测', () => {
    assert.equal(inferBalanceProviderFromRoute('llm-deepseek'), 'deepseek');
    assert.equal(inferBalanceProviderFromRoute('team-kimi'), 'moonshot');
    assert.equal(inferBalanceProviderFromRoute('stepfun-prod'), 'stepfun');
    assert.equal(inferBalanceProviderFromRoute('siliconflow'), undefined);
    assert.equal(matchBalanceProviderBaseURL('https://api.moonshot.cn/v1'), 'moonshot');
    assert.equal(matchBalanceProviderBaseURL('https://api.stepfun.com/v1'), 'stepfun');
    assert.equal(matchBalanceProviderBaseURL('https://proxy.example/v1'), undefined);
});

test('解析 Kimi 可用余额且不估算 Token 成本', () => {
    assert.deepEqual(
        parseProviderBalances('moonshot', {
            status: true,
            data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
        }),
        [{ currency: 'CNY', total: '49.58894' }]
    );
    assert.deepEqual(
        parseProviderBalances('moonshot', { status: false, data: { available_balance: 10 } }),
        []
    );
});

test('解析阶跃星辰可用余额并拒绝格式错误的值', () => {
    assert.deepEqual(
        parseProviderBalances('stepfun', {
            object: 'account',
            type: 'prepaid',
            balance: 26.0,
        }),
        [{ currency: 'CNY', total: '26' }]
    );
    assert.deepEqual(parseProviderBalances('stepfun', { object: 'account', balance: -1 }), []);
    assert.deepEqual(parseProviderBalances('unknown', {}), []);
});
