import test from 'node:test';
import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';
import { buildSettingsSchema } from '../lib/index.js';

test('位置字段默认未设置（-1）且接受 0-1 的比例坐标', () => {
    const schema = buildSettingsSchema(z);
    const empty = schema({});
    assert.equal(empty.posX, -1);
    assert.equal(empty.posY, -1);
    const placed = schema({ posX: 0.25, posY: 0.75 });
    assert.equal(placed.posX, 0.25);
    assert.equal(placed.posY, 0.75);
    // 越界值被拒绝（避免手写 settings.yaml 把宠物放到屏幕外）
    assert.throws(() => schema({ posX: 1.5 }));
    assert.throws(() => schema({ posY: -2 }));
});

test('日历字段保留用于兼容旧配置（默认开启，schema 仍接受旧值）', () => {
    const schema = buildSettingsSchema(z);
    const defaults = schema({});
    assert.deepEqual(defaults.calendar, { enabled: true, festival: true, seasonal: true });
    // 旧配置里的关闭值仍能通过 schema 校验；客户端 mergeConfig 会统一归一为开启，
    // 配置页也不再暴露这三个开关。
    const legacyOff = schema({ calendar: { enabled: true, festival: false, seasonal: false } });
    assert.equal(legacyOff.calendar.festival, false);
    assert.equal(legacyOff.calendar.seasonal, false);
});

test('旧配置（无 posX/calendar）仍可通过校验并补默认值', () => {
    const schema = buildSettingsSchema(z);
    const legacy = schema({ size: 500, position: 'bottom-left', scope: 'any' });
    assert.equal(legacy.posX, -1);
    assert.equal(legacy.calendar.enabled, true);
});

test('通知开关默认开启，可单独关闭', () => {
    const schema = buildSettingsSchema(z);
    const defaults = schema({});
    assert.deepEqual(defaults.notify, { done: true, error: true, waiting: true, system: true, sound: true });
    const off = schema({ notify: { waiting: false, system: false } });
    assert.equal(off.notify.waiting, false);
    assert.equal(off.notify.system, false);
    assert.equal(off.notify.done, true);
});
