import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BALANCE_ALERT_STORAGE_KEY,
    QUOTA_ALERT_REMAINING_PCT,
    addDecimal,
    decimalCompare,
    emptyAlertStore,
    evaluateBalanceAlerts,
    evaluateQuotaAlerts,
    formatBalanceAlert,
    formatMoney,
    formatQuotaAlert,
    mergeWalletBalances,
    normalizeDecimal,
    readAlertStore,
    setSourceState,
    sourceKey,
    sourceStateOf,
    thresholdOf,
    writeAlertStore,
} from '../src/client/balance-alert.js';

test('金额规范化支持指数、尾零与负值', () => {
    assert.equal(normalizeDecimal('12.34'), '12.34');
    assert.equal(normalizeDecimal('0E-16'), '0');
    assert.equal(normalizeDecimal('5.0000000000000000'), '5');
    assert.equal(normalizeDecimal('1.2e+3'), '1200');
    assert.equal(normalizeDecimal('-1.2e-2'), '-0.012');
    assert.equal(normalizeDecimal('.5'), '0.5');
    assert.equal(normalizeDecimal('0012.30'), '12.3');
    assert.equal(normalizeDecimal(''), null);
    assert.equal(normalizeDecimal('abc'), null);
    assert.equal(normalizeDecimal('1e9999'), null);
});

test('金额比较与求和精确、不经过 Number', () => {
    assert.equal(decimalCompare('20', '20.00'), 0);
    assert.equal(decimalCompare('19.999', '20'), -1);
    assert.equal(decimalCompare('20.001', '20'), 1);
    assert.equal(decimalCompare('-5', '-3'), -1);
    assert.equal(decimalCompare('-1', '1'), -1);
    assert.equal(decimalCompare('bad', '1'), null);
    assert.equal(addDecimal('0.1', '0.2'), '0.3');
    assert.equal(addDecimal('1.20', '-0.20'), '1');
    assert.equal(addDecimal('0', '0'), '0');
    assert.equal(addDecimal('999999999999999999.99', '0.01'), '1000000000000000000');
});

test('阈值 0 表示关闭该币种', () => {
    assert.equal(thresholdOf({ CNY: 20, USD: 3 }, 'CNY'), 20);
    assert.equal(thresholdOf({ CNY: 0 }, 'CNY'), 0);
    assert.equal(thresholdOf({ CNY: -1 }, 'CNY'), 0);
    assert.equal(thresholdOf(null, 'CNY'), 0);
});

test('低余额状态机：跌破提醒一次、充值复位、再跌破再提醒', () => {
    const thresholds = { CNY: 20, USD: 3 };
    const first = evaluateBalanceAlerts({
        state: {},
        balances: [{ currency: 'CNY', total: '19.99' }],
        thresholds,
        now: 1000,
    });
    assert.equal(first.alerts.length, 1);
    assert.equal(first.alerts[0].currency, 'CNY');
    assert.equal(first.changed, true);
    assert.equal(first.state.CNY.below, true);

    const repeat = evaluateBalanceAlerts({
        state: first.state,
        balances: [{ currency: 'CNY', total: '18.00' }],
        thresholds,
        now: 2000,
    });
    assert.equal(repeat.alerts.length, 0, '持续低于阈值不重复提醒');
    assert.equal(repeat.changed, false);

    const refill = evaluateBalanceAlerts({
        state: repeat.state,
        balances: [{ currency: 'CNY', total: '25.00' }],
        thresholds,
        now: 3000,
    });
    assert.equal(refill.alerts.length, 0);
    assert.equal(refill.state.CNY.below, false);

    const again = evaluateBalanceAlerts({
        state: refill.state,
        balances: [{ currency: 'CNY', total: '19.00' }],
        thresholds,
        now: 4000,
    });
    assert.equal(again.alerts.length, 1);
});

test('多币种合并提醒、未返回币种不复位', () => {
    const state = { CNY: { below: true, at: 1 }, USD: { below: false, at: 0 } };
    const result = evaluateBalanceAlerts({
        state,
        balances: [
            { currency: 'CNY', total: '10.00' },
            { currency: 'USD', total: '1.00' },
        ],
        thresholds: { CNY: 20, USD: 3 },
        now: 10,
    });
    assert.equal(result.alerts.length, 1, 'CNY 已提醒过；USD 新跌破');
    assert.equal(result.alerts[0].currency, 'USD');
    assert.equal(result.state.CNY.below, true, '未返回的币种保持原状态');

    const onlyCny = evaluateBalanceAlerts({
        state: { CNY: { below: true, at: 1 } },
        balances: [{ currency: 'CNY', total: '5' }],
        thresholds: { CNY: 20, USD: 3 },
        now: 20,
    });
    assert.equal(onlyCny.state.CNY.below, true, 'USD 缺失不影响 CNY');
});

test('阈值为 0 时清除该币种状态；非法金额跳过', () => {
    const result = evaluateBalanceAlerts({
        state: { CNY: { below: true, at: 1 } },
        balances: [
            { currency: 'CNY', total: '1' },
            { currency: 'USD', total: 'bad' },
        ],
        thresholds: { CNY: 0, USD: 3 },
        now: 10,
    });
    assert.equal(result.state.CNY, undefined);
    assert.equal(result.alerts.length, 0);
});

test('账户钱包 normal+bonus 合并，按币种排序', () => {
    const merged = mergeWalletBalances(
        [
            { currency: 'CNY', balance: '10.00' },
            { currency: 'USD', balance: '1.00' },
        ],
        [
            { currency: 'CNY', balance: '2.50' },
            { currency: 'USD', balance: '0.50' },
        ]
    );
    assert.deepEqual(merged, [
        { currency: 'CNY', total: '12.5', normal: '10', bonus: '2.5' },
        { currency: 'USD', total: '1.5', normal: '1', bonus: '0.5' },
    ]);
    assert.deepEqual(mergeWalletBalances(null, null), []);
});

test('提醒状态持久化：损坏 JSON / 版本不符 / 抛错都安全', () => {
    const map = new Map();
    const storage = {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, value),
    };
    const store = emptyAlertStore();
    const next = setSourceState(store, sourceKey('account', 'deepseek'), {
        CNY: { below: true, at: 9 },
    });
    assert.equal(writeAlertStore(storage, next), true);
    assert.equal(map.get(BALANCE_ALERT_STORAGE_KEY).includes('account:deepseek'), true);
    assert.equal(readAlertStore(storage).sources['account:deepseek'].CNY.below, true);
    assert.equal(sourceStateOf(readAlertStore(storage), 'account:deepseek').CNY.at, 9);

    map.set(BALANCE_ALERT_STORAGE_KEY, '{oops');
    assert.deepEqual(readAlertStore(storage), { v: 2, sources: {} });
    map.set(BALANCE_ALERT_STORAGE_KEY, JSON.stringify({ v: 1, sources: {} }));
    assert.deepEqual(readAlertStore(storage), { v: 2, sources: {} });
    assert.doesNotThrow(() => readAlertStore(null));
    assert.equal(writeAlertStore(null, store), false);
});

test('金额展示固定两位小数并直接截断', () => {
    assert.equal(formatMoney('18.2584031800000000'), '18.25');
    assert.equal(formatMoney('17.74139186'), '17.74');
    assert.equal(formatMoney('20'), '20.00');
    assert.equal(formatMoney('12.5'), '12.50');
    assert.equal(formatMoney('0.005'), '0.00');
    assert.equal(formatMoney('0.004'), '0.00');
    assert.equal(formatMoney('-0.005'), '0.00');
    assert.equal(formatMoney('0E-16'), '0.00');
    assert.equal(formatMoney('1.2e+3'), '1200.00');
    assert.equal(formatMoney('bad'), '');
});

test('提醒文案多币种合并、最多两个', () => {
    const text = formatBalanceAlert(
        [
            { currency: 'CNY', total: '12.34', threshold: 20 },
            { currency: 'USD', total: '1.2', threshold: 3 },
        ],
        'DeepSeek 账户',
        (key) =>
            ({
                balanceAlertTitle: '余额偏低',
                balanceAlertLine: '{amount}（阈值 {threshold}）',
            })[key] || key
    );
    assert.equal(text.title, '余额偏低');
    assert.equal(text.body, 'DeepSeek 账户 · CNY 12.34（阈值 20.00） · USD 1.20（阈值 3.00）');
});

test('套餐额度提醒：只认周/月，剩余 ≤5% 提醒一次，恢复后复位', () => {
    assert.equal(QUOTA_ALERT_REMAINING_PCT, 5);
    const windows = [
        { key: 'rolling', label: '5h', usedPct: 99 },
        { key: 'weekly', label: '周', usedPct: 95 },
        { key: 'monthly', label: '月', usedPct: 95.5 },
    ];
    const first = evaluateQuotaAlerts({ state: {}, windows, thresholdPct: 5, now: 1000 });
    assert.deepEqual(
        first.alerts.map((a) => a.key),
        ['weekly', 'monthly']
    );
    assert.equal(first.alerts[0].remainingPct, 5);
    assert.equal(first.changed, true);
    assert.equal(first.state.weekly.below, true);

    const repeat = evaluateQuotaAlerts({
        state: first.state,
        windows,
        thresholdPct: 5,
        now: 2000,
    });
    assert.equal(repeat.alerts.length, 0, '持续不足不重复提醒');
    assert.equal(repeat.changed, false);

    const recovered = evaluateQuotaAlerts({
        state: repeat.state,
        windows: [
            { key: 'weekly', label: '周', usedPct: 20 },
            { key: 'monthly', label: '月', usedPct: 30 },
        ],
        thresholdPct: 5,
        now: 3000,
    });
    assert.equal(recovered.alerts.length, 0);
    assert.equal(recovered.changed, true);
    assert.equal(recovered.state.weekly.below, false);

    const again = evaluateQuotaAlerts({
        state: recovered.state,
        windows: [{ key: 'weekly', label: '周', usedPct: 96 }],
        thresholdPct: 5,
        now: 4000,
    });
    assert.equal(again.alerts.length, 1);
    assert.equal(again.alerts[0].key, 'weekly');

    // 缺少 usedPct 的窗口不能被当成 0% 使用而误复位。
    const unknown = evaluateQuotaAlerts({
        state: again.state,
        windows: [{ key: 'weekly', label: '周', usedPct: null }],
        thresholdPct: 5,
        now: 5000,
    });
    assert.equal(unknown.changed, false);
    assert.equal(unknown.state.weekly.below, true);
});

test('套餐额度提醒支持周/月独立阈值', () => {
    const result = evaluateQuotaAlerts({
        state: {},
        windows: [
            { key: 'weekly', label: '周', usedPct: 96 },
            { key: 'monthly', label: '月', usedPct: 92 },
        ],
        thresholds: { weekly: 5, monthly: 8 },
        now: 1000,
    });
    assert.deepEqual(
        result.alerts.map((a) => a.key),
        ['weekly', 'monthly']
    );
});

test('套餐额度提醒文案：窗口名走词条，剩余百分比向下取整', () => {
    const t = (key) =>
        ({
            quotaAlertTitle: '套餐额度不足',
            quotaAlertLine: '{window}额度剩余 {remaining}%',
            quotaWindowWeek: '周',
            quotaWindowMonth: '月',
        })[key] || key;
    const text = formatQuotaAlert(
        [
            { key: 'weekly', remainingPct: 4.96 },
            { key: 'monthly', remainingPct: 5 },
        ],
        'Codex',
        t
    );
    assert.equal(text.title, '套餐额度不足');
    assert.equal(text.body, 'Codex · 周额度剩余 4.9% · 月额度剩余 5%');
});
