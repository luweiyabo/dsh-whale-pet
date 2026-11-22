import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceCacheTtl } from '../lib/index.js';

// 与 client-internals/client-extras 相同的 bundle 装载方式
let plugin;
globalThis.window = {
    __ModuleLoader__: {
        load(definition) {
            plugin = definition.factory((id) => {
                if (id === 'react') {
                    return {
                        createElement() {},
                        useState() {},
                        useEffect() {},
                        useRef() {},
                        useCallback() {},
                    };
                }
                throw new Error('unavailable test dependency: ' + id);
            });
        },
    },
};
await import('../lib/client.js');
delete globalThis.window;

const { balanceDue, balanceRetryDelay, formatMeterText, meterAmountText, formatClock } = plugin.__internals;

const LABELS = {
    balance: '余额 ',
    waiting: '等待模型调用…',
    unsupported: '当前服务商暂不支持',
    failed: '查询失败',
    stale: '（上次 {time}，刷新失败）',
};

test('失败重试走指数退避阶梯', () => {
    assert.equal(balanceRetryDelay(0), 5000);
    assert.equal(balanceRetryDelay(1), 5000);
    assert.equal(balanceRetryDelay(2), 15000);
    assert.equal(balanceRetryDelay(3), 60000);
    assert.equal(balanceRetryDelay(4), 300000);
    assert.equal(balanceRetryDelay(99), 300000, '超出阶梯后固定上限');
});

test('balanceDue 区分正常轮询与失败退避', () => {
    const now = 1_000_000;
    assert.equal(balanceDue({ at: 0, failures: 0 }, now), true, '从没查过：立刻查');
    assert.equal(balanceDue({ at: now - 29000, failures: 0 }, now), false, '未到 30s');
    assert.equal(balanceDue({ at: now - 31000, failures: 0 }, now), true, '超过 30s');
    // 第 1 次失败：5 秒后允许
    assert.equal(balanceDue({ at: now - 4000, failures: 1 }, now), false);
    assert.equal(balanceDue({ at: now - 6000, failures: 1 }, now), true);
    // 第 3 次失败：60 秒后允许
    assert.equal(balanceDue({ at: now - 30000, failures: 3 }, now), false);
    assert.equal(balanceDue({ at: now - 61000, failures: 3 }, now), true);
    // 时间戳在将来（时钟回拨）时不发请求
    assert.equal(balanceDue({ at: now + 5000, failures: 0 }, now), false);
});

test('失败时保留上次余额并标注时间', () => {
    const clock = formatClock(new Date(2026, 10, 16, 9, 41, 0).getTime());
    assert.equal(clock, '09:41');

    const stale = formatMeterText(
        {
            status: 'error',
            providerLabel: 'DeepSeek',
            balances: [{ currency: 'US$', total: '12.34' }],
            failures: 2,
            updatedAt: new Date(2026, 10, 16, 9, 41, 0).getTime(),
        },
        LABELS
    );
    assert.equal(stale, '余额 DeepSeek · US$ 12.34 （上次 09:41，刷新失败）');

    const fresh = formatMeterText(
        {
            status: 'ready',
            providerLabel: 'DeepSeek',
            balances: [{ currency: 'US$', total: '12.34' }],
        },
        LABELS
    );
    assert.equal(fresh, '余额 DeepSeek · US$ 12.34');

    const never = formatMeterText({ status: 'error', providerLabel: 'DeepSeek', balances: null }, LABELS);
    assert.equal(never, '余额 DeepSeek · 查询失败', '没有历史值时才显示查询失败');

    assert.equal(
        formatMeterText({ status: 'waiting', providerLabel: null, balances: null }, LABELS),
        '余额 等待模型调用…'
    );
    assert.equal(
        formatMeterText({ status: 'unsupported', providerLabel: null, balances: null }, LABELS),
        '余额 当前服务商暂不支持'
    );
});

test('金额文案支持多币种', () => {
    assert.equal(meterAmountText(null), '');
    assert.equal(meterAmountText([]), '');
    assert.equal(
        meterAmountText([
            { currency: 'US$', total: '1.00' },
            { currency: 'CNY', total: '7.00' },
        ]),
        'US$ 1.00 · CNY 7.00'
    );
});

test('宿主侧失败结果也会缓存（15s），避免重试打爆上游', () => {
    assert.equal(balanceCacheTtl({ ok: true }), 30_000);
    assert.equal(balanceCacheTtl({ ok: false }), 15_000);
    assert.equal(balanceCacheTtl(undefined), 15_000);
});
