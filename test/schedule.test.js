import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addUsage,
    emptyUsage,
    festivalsOn,
    formatDuration,
    formatTokens,
    lunarDateOf,
    seasonOfMonth,
    situationalPool,
    sanitizeTurnStats,
    summarizeTurn,
    usageTotal,
} from '../src/client/schedule.js';

// 固定时区，避免测试在非 +08:00 环境里把「本地小时」算错
process.env.TZ = 'Asia/Shanghai';

test('季节映射：3-5 春、6-8 夏、9-11 秋、12-2 冬', () => {
    assert.equal(seasonOfMonth(3), 'spring');
    assert.equal(seasonOfMonth(5), 'spring');
    assert.equal(seasonOfMonth(6), 'summer');
    assert.equal(seasonOfMonth(8), 'summer');
    assert.equal(seasonOfMonth(9), 'autumn');
    assert.equal(seasonOfMonth(11), 'autumn');
    assert.equal(seasonOfMonth(12), 'winter');
    assert.equal(seasonOfMonth(1), 'winter');
    assert.equal(seasonOfMonth(2), 'winter');
});

test('农历换算与已知节日日期一致（含闰月标记）', () => {
    // 2024-09-17 = 八月十五（中秋）；2024-02-10 = 正月初一（春节）
    assert.deepEqual(lunarDateOf(new Date(2024, 8, 17, 12)), { month: 8, day: 15, leap: false });
    assert.deepEqual(lunarDateOf(new Date(2024, 1, 10, 12)), { month: 1, day: 1, leap: false });
    assert.equal(lunarDateOf(new Date('not-a-date')), null);
});

test('闰月：ICU 的 "2bis" 剥成基月并标记 leap，闰月日不匹配常规锚点', () => {
    // 2023 年闰二月：2023-02-20 是二月初一，2023-03-22 是闰二月初一
    assert.deepEqual(lunarDateOf(new Date(2023, 1, 20, 12)), { month: 2, day: 1, leap: false });
    assert.deepEqual(lunarDateOf(new Date(2023, 2, 22, 12)), { month: 2, day: 1, leap: true });
    assert.deepEqual(lunarDateOf(new Date(2023, 3, 5, 12)), { month: 2, day: 15, leap: true });
    // 2025 年闰六月：2025-07-25 是闰六月初一
    assert.deepEqual(lunarDateOf(new Date(2025, 6, 25, 12)), { month: 6, day: 1, leap: true });
    // 2028 年闰五月：闰五月初五（06-27）不能当成端午节，常规五月初五（05-28）才算
    assert.deepEqual(lunarDateOf(new Date(2028, 5, 27, 12)), { month: 5, day: 5, leap: true });
    assert.equal(festivalsOn(new Date(2028, 5, 27, 12)).includes('dragonBoat'), false);
    assert.ok(festivalsOn(new Date(2028, 4, 28, 12)).includes('dragonBoat'));
});

test('festivalsOn 命中节日窗口，平时不命中', () => {
    const midAutumn = festivalsOn(new Date(2024, 8, 17, 12));
    assert.ok(midAutumn.includes('midAutumn'), '中秋当天应在窗口内');
    const newYear = festivalsOn(new Date(2025, 0, 1, 12));
    assert.ok(newYear.includes('newYear'), '元旦当天应在窗口内');
    const ordinary = festivalsOn(new Date(2025, 5, 15, 12));
    assert.equal(ordinary.includes('midAutumn'), false);
    assert.equal(ordinary.includes('christmas'), false);
    assert.equal(ordinary.includes('newYear'), false);
});

test('闰月不中断农历扫描：2025 七夕/中元/中秋窗口仍命中', () => {
    // 2025 年闰六月（07-25 ~ 08-22）落在 ±32 天扫描范围内：
    // 旧实现 Number('6bis') 得 NaN → lunarDateOf 返回 null → 整段扫描 break，
    // 七夕与中元的窗口因此整段丢失。
    assert.ok(festivalsOn(new Date(2025, 7, 29, 12)).includes('qixi'), '七夕当天');
    assert.ok(festivalsOn(new Date(2025, 7, 28, 12)).includes('qixi'), '七夕前一天（窗口内）');
    assert.ok(festivalsOn(new Date(2025, 8, 6, 12)).includes('ghost'), '中元节当天');
    assert.ok(festivalsOn(new Date(2025, 8, 7, 12)).includes('ghost'), '中元节后一天（窗口内）');
    assert.ok(festivalsOn(new Date(2025, 9, 6, 12)).includes('midAutumn'), '中秋当天');
    // 闰六月本身不是任何农历节日
    assert.equal(festivalsOn(new Date(2025, 7, 1, 12)).includes('qixi'), false);
});

test('农历窗口与本地时区/时钟时刻无关：00:30 与 12:00 命中一致', () => {
    // 复现场景：TZ=Asia/Tokyo 时本地 2026-06-18 00:30 对应上海 06-17 23:30。
    // 旧实现用「本地午夜」构造探针，会被格式化成前一个农历日，端午窗口整段丢失。
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
        const midnight = festivalsOn(new Date(2026, 5, 18, 0, 30));
        const noon = festivalsOn(new Date(2026, 5, 18, 12, 0));
        assert.deepEqual(midnight.slice().sort(), noon.slice().sort());
        assert.ok(midnight.includes('dragonBoat'), '东京本地 00:30 应命中端午窗口');
        assert.ok(noon.includes('dragonBoat'), '东京本地 12:00 应命中端午窗口');
    } finally {
        process.env.TZ = previous || 'Asia/Shanghai';
    }
});

test('四季动画只在对应季节进入随机池', () => {
    const pool = ['building_a_snowman', 'cooling_with_a_hand_fan', 'coding'];
    const calendar = { enabled: true, festival: true, seasonal: true };
    // 七月：保留夏季的摇扇，剔除冬季的堆雪人
    assert.deepEqual(situationalPool(pool, { date: new Date(2025, 6, 1, 12), calendar }), [
        'cooling_with_a_hand_fan',
        'coding',
    ]);
    assert.deepEqual(situationalPool(pool, { date: new Date(2025, 0, 10, 12), calendar }), [
        'building_a_snowman',
        'coding',
    ]);
    // 关闭四季过滤 → 原样返回
    assert.deepEqual(
        situationalPool(pool, {
            date: new Date(2025, 6, 1, 12),
            calendar: { enabled: true, seasonal: false },
        }),
        pool
    );
});

test('节日动画只在窗口内进入随机池，节日当天可被优先选中', () => {
    const pool = ['moon_festival', 'coding'];
    const calendar = { enabled: true, festival: true, seasonal: true };
    // 中秋当天：随机数高 → 保留池；随机数低 → 只留节日动画（提升当天演出概率）
    assert.deepEqual(
        situationalPool(pool, { date: new Date(2024, 8, 17, 12), calendar, rand: () => 0.99 }).sort(),
        ['coding', 'moon_festival']
    );
    assert.deepEqual(situationalPool(pool, { date: new Date(2024, 8, 17, 12), calendar, rand: () => 0.1 }), [
        'moon_festival',
    ]);
    // 普通日子：节日动画被剔除
    assert.deepEqual(situationalPool(pool, { date: new Date(2025, 5, 15, 12), calendar }), ['coding']);
});

test('过滤后为空时回退原池（用户池里只有节日动画也不会卡死）', () => {
    const pool = ['moon_festival'];
    assert.deepEqual(
        situationalPool(pool, { date: new Date(2025, 5, 15, 12), calendar: { enabled: true } }),
        pool
    );
});

test('calendar.enabled=false 完全保持旧行为', () => {
    const pool = ['building_a_snowman', 'moon_festival', 'coding'];
    assert.deepEqual(
        situationalPool(pool, { date: new Date(2025, 6, 1, 12), calendar: { enabled: false } }),
        pool
    );
});

test('usage 归并兼容两种命名，并且不重复计 cacheRead', () => {
    // OpenAI / DeepSeek 风格
    const a = addUsage(emptyUsage(), {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        prompt_cache_hit_tokens: 400,
    });
    assert.equal(a.input, 1000);
    assert.equal(a.output, 200);
    assert.equal(a.cacheRead, 400);
    assert.equal(a.total, 1200);
    assert.equal(a.calls, 1);
    // DSH / Anthropic 风格（缺 total 时用 input+output）
    const b = addUsage(a, { input: 500, output: 100, cacheRead: 50, total: 600 });
    assert.equal(b.input, 1500);
    assert.equal(b.output, 300);
    assert.equal(b.total, 1800);
    assert.equal(b.calls, 2);
    assert.equal(usageTotal(b), 1800);
    // 坏数据不炸
    assert.equal(addUsage(emptyUsage(), null).calls, 0);
    assert.equal(usageTotal(null), 0);
});

test('耗时与 token 格式化', () => {
    assert.equal(formatDuration(45000), '45s');
    assert.equal(formatDuration(200000), '3m20s');
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(3720000), '1h02m');
    // 先取整到秒再拆分：进位不能产生「1m60s」「59m60s」
    assert.equal(formatDuration(119500), '2m');
    assert.equal(formatDuration(3599600), '1h00m');
    assert.equal(formatDuration(7199600), '2h00m');
    assert.equal(formatDuration(59960), '1m');
    assert.equal(formatDuration(60500), '1m01s');
    assert.equal(formatTokens(842), '842');
    assert.equal(formatTokens(8432), '8.4k');
    assert.equal(formatTokens(12345), '12k');
    assert.equal(formatTokens(15000), '15k');
    assert.equal(formatTokens(1234567), '1.2M');
    // 999.5k 起进位到 M，避免 999999 显示成 "1000k"
    assert.equal(formatTokens(999999), '1.0M');
    assert.equal(formatTokens(999500), '1.0M');
    assert.equal(formatTokens(999499), '999k');
});

test('summarizeTurn 由起止时间与 usage 得到摘要', () => {
    const summary = summarizeTurn({
        startedAt: 1000,
        endedAt: 61000,
        steps: 12,
        usage: { input: 8000, output: 432, total: 8432, calls: 3 },
    });
    assert.equal(summary.durationMs, 60000);
    assert.equal(summary.steps, 12);
    assert.equal(summary.tokens, 8432);
    assert.equal(summary.calls, 3);
    // 旧口径字段（tools）仍可被读取，避免升级瞬间统计归零
    assert.equal(summarizeTurn({ steps: undefined, tools: 4 }).steps, 4);
});

test('未结束回合的持久化统计可恢复，已结束/坏数据返回 null', () => {
    const restored = sanitizeTurnStats({
        v: 1,
        turn: 9,
        startedAt: 1000,
        endedAt: 0,
        steps: 26,
        usage: { input: 25155, output: 21561, cacheRead: 16146560, total: 16193276, calls: 26 },
    });
    assert.equal(restored.turn, 9);
    assert.equal(restored.steps, 26);
    assert.equal(restored.usage.total, 16193276);

    // 已结束的回合不再恢复（避免重放通知/重复累计）
    assert.equal(sanitizeTurnStats({ v: 1, turn: 9, endedAt: 5000 }), null);
    // 版本/回合号/类型不合法
    assert.equal(sanitizeTurnStats({ v: 2, turn: 9 }), null);
    assert.equal(sanitizeTurnStats({ v: 1, turn: 0 }), null);
    assert.equal(sanitizeTurnStats(null), null);
    assert.equal(sanitizeTurnStats('x'), null);
});
