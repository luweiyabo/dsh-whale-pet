import test from 'node:test';
import assert from 'node:assert/strict';

// 与 client-internals.test.js 相同的 bundle 装载方式：lib/client.js 是 IIFE，
// 需要提供 window.__ModuleLoader__.load 与 react 桩才能取到 __internals。
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

const { condMatch, ruleFrameOf, matchRules, normalizeRule, leaderRecordFresh, customVideoWarnings } =
    plugin.__internals;

test('规则帧带本地时间与星期', () => {
    // 本地时间构造，避免测试机时区影响断言
    const now = new Date(2026, 10, 15, 22, 5, 0).getTime(); // 2026-11-15 是周日
    const frame = ruleFrameOf(
        { type: 'session/event', sessionId: 's1', event: { type: 'turn/end' } },
        {},
        now
    );
    assert.equal(frame.time, '22:05');
    assert.equal(frame.dayOfWeek, '0');
});

test('时间字段支持 gt/lt（按当日分钟数比较）', () => {
    const frame = { time: '22:05', dayOfWeek: '0' };
    assert.equal(condMatch({ field: 'time', op: 'gt', value: '22:00' }, frame), true);
    assert.equal(condMatch({ field: 'time', op: 'lt', value: '22:00' }, frame), false);
    assert.equal(condMatch({ field: 'time', op: 'gt', value: '23:00' }, frame), false);
    assert.equal(condMatch({ field: 'time', op: 'eq', value: '22:05' }, frame), true);
    // 星期 eq / ne
    assert.equal(condMatch({ field: 'dayOfWeek', op: 'eq', value: '0' }, frame), true);
    assert.equal(condMatch({ field: 'dayOfWeek', op: 'ne', value: '0' }, frame), false);
});

test('数值 gt/lt 也适用于其它字段', () => {
    const frame = { running: '1', data: { error: 'boom' } };
    assert.equal(condMatch({ field: 'running', op: 'gt', value: '0' }, frame), true);
    // 非数值字段：比较不成立但不抛错
    assert.equal(condMatch({ field: 'data.error', op: 'gt', value: '1' }, frame), false);
    assert.equal(condMatch({ field: 'missing', op: 'gt', value: '1' }, frame), false);
});

test('normalizeRule 把 time 值补零并保留 gt/lt', () => {
    const rule = normalizeRule({
        id: 'r_late_night',
        when: [{ field: 'time', op: 'gt', value: '9:05' }],
        actions: ['quick_nap'],
        cooldownMs: 60000,
    });
    assert.ok(rule, '应通过清洗');
    assert.deepEqual(rule.when[0], { field: 'time', op: 'gt', value: '09:05' });
    // 未知 op 仍然整条丢弃
    assert.equal(
        normalizeRule({ id: 'r_bad', when: [{ field: 'time', op: 'before', value: '09:05' }] }),
        null
    );
});

test('时间规则可参与 matchRules 并受冷却约束', () => {
    const rule = {
        id: 'r_night',
        enable: true,
        when: [{ field: 'time', op: 'gt', value: '21:00' }],
        priority: 5,
        cooldownMs: 60000,
        holdMs: 3000,
        actions: ['quick_nap'],
        bubble: '',
    };
    const at = new Date(2026, 10, 15, 22, 0, 0).getTime();
    const frame = { type: 'session/event', sessionId: 's1', event: { type: 'turn/end', data: {} } };
    const first = matchRules([rule], frame, null, at);
    assert.equal(first.fired.length, 1);
    // 冷却期内不再触发
    const second = matchRules([rule], frame, first.state, at + 5000);
    assert.equal(second.fired.length, 0);
    // 冷却过后再次触发
    const third = matchRules([rule], frame, first.state, at + 61000);
    assert.equal(third.fired.length, 1);
});

test('主从心跳记录的有效性判定', () => {
    assert.equal(leaderRecordFresh({ id: 'a', ts: 1000 }, 5000, 6000), true);
    assert.equal(leaderRecordFresh({ id: 'a', ts: 1000 }, 8000, 6000), false);
    assert.equal(leaderRecordFresh({ id: '', ts: 1000 }, 2000, 6000), false);
    assert.equal(leaderRecordFresh({ id: 'a', ts: 'oops' }, 2000, 6000), false);
    assert.equal(leaderRecordFresh(null, 2000, 6000), false);
});

test('上传前建议校验：MP4/非 16:9/过长/不可读', () => {
    assert.deepEqual(customVideoWarnings({ width: 640, height: 360, duration: 10 }, { name: 'a.webm' }), []);
    assert.deepEqual(customVideoWarnings({ width: 640, height: 360, duration: 10 }, { name: 'a.mp4' }), [
        'uploadWarnNoAlpha',
    ]);
    assert.deepEqual(customVideoWarnings({ width: 1080, height: 1080, duration: 10 }, { name: 'b.webm' }), [
        'uploadWarnAspect',
    ]);
    assert.deepEqual(customVideoWarnings({ width: 640, height: 360, duration: 30 }, { name: 'c.webm' }), [
        'uploadWarnLong',
    ]);
    assert.deepEqual(customVideoWarnings(null, { name: 'd.webm' }), ['uploadWarnUnreadable']);
});
