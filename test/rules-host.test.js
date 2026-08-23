import test from 'node:test';
import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';
import { buildSettingsSchema, validateCustomActionFileName } from '../lib/index.js';

test('规则字段默认为空数组', () => {
  const schema = buildSettingsSchema(z);
  const out = schema({});
  assert.deepEqual(out.rules, []);
});

test('宿主意图默认值符合约定的事件动作映射', () => {
  const out = buildSettingsSchema(z)({});
  assert.deepEqual(out.intents, {
    working: ['eating_tokens'],
    coding: ['coding'],
    reading: ['taking_notes'],
    researching: ['taking_notes'],
    thinking: ['deep_thought'],
    waitingUser: ['looking_around'],
    listening: ['attentive_listening'],
    error: ['jump_scare'],
  });
});

test('规则条目按字段默认值完成规范化', () => {
  const schema = buildSettingsSchema(z);
  const out = schema({
    rules: [{
      id: 'r_git_dance',
      when: [{ field: 'type', op: 'eq', value: 'tool/call' }],
      priority: 6,
      actions: ['act_celebrate'],
    }],
  });
  assert.equal(out.rules.length, 1);
  const r = out.rules[0];
  assert.equal(r.id, 'r_git_dance');
  assert.equal(r.enable, true);
  assert.equal(r.name, '');
  assert.deepEqual(r.when, [{ field: 'type', op: 'eq', value: 'tool/call' }]);
  assert.equal(r.priority, 6);
  assert.equal(r.cooldownMs, 30000);
  assert.equal(r.holdMs, 3000);
  assert.deepEqual(r.actions, ['act_celebrate']);
  assert.equal(r.bubble, '');
});

test('保存时拒绝超出范围的规则数值', () => {
  const schema = buildSettingsSchema(z);
  assert.throws(() => schema({ rules: [{ id: 'x', priority: 99 }] }));
  assert.throws(() => schema({ rules: [{ id: 'x', cooldownMs: 10 }] }));
  assert.throws(() => schema({ rules: [{ id: 'x', holdMs: 999999 }] }));
});

test('保存时拒绝过长的规则字符串', () => {
  const schema = buildSettingsSchema(z);
  assert.throws(() => schema({ rules: [{ id: 'x'.repeat(65), when: [{ field: 'type', op: 'eq', value: 'y' }] }] }));
  assert.throws(() => schema({ rules: [{ id: 'x', name: 'n'.repeat(65), when: [{ field: 'type', op: 'eq', value: 'y' }] }] }));
  assert.throws(() => schema({ rules: [{ id: 'x', when: [{ field: 'f'.repeat(129), op: 'eq', value: 'y' }] }] }));
  assert.throws(() => schema({ rules: [{ id: 'x', when: [{ field: 'type', op: 'eq', value: 'v'.repeat(257) }] }] }));
  assert.throws(() => schema({ rules: [{ id: 'x', bubble: 'b'.repeat(51), when: [{ field: 'type', op: 'eq', value: 'y' }] }] }));
});

test('位置设置接受屏幕的四个角落', () => {
  const schema = buildSettingsSchema(z);
  for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left']) {
    assert.equal(schema({ position }).position, position);
  }
  assert.throws(() => schema({ position: 'center' }));
});

test('自定义动作上传仅接受安全的 WebM 或 MP4 文件名并使用自定义分类', () => {
  assert.deepEqual(validateCustomActionFileName("my-dance.webm"), { id: "my-dance", ext: "webm", file: "my-dance.webm", category: "custom" });
  assert.deepEqual(validateCustomActionFileName("鲸鱼挥手.MP4"), { id: "鲸鱼挥手", ext: "mp4", file: "鲸鱼挥手.mp4", category: "custom" });
  assert.equal(validateCustomActionFileName("../escape.webm"), undefined);
  assert.equal(validateCustomActionFileName("nested/action.mp4"), undefined);
  assert.equal(validateCustomActionFileName("action.txt"), undefined);
  assert.equal(validateCustomActionFileName(".upload-hidden.webm"), undefined);
  // Windows 保留字符（" * : < > ? |）与反斜杠在跨平台文件名中不安全，一律拒绝
  assert.equal(validateCustomActionFileName('bad"name.webm'), undefined);
  assert.equal(validateCustomActionFileName("bad*name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad:name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad<name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad>name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad?name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad|name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad\\name.webm"), undefined);
  assert.equal(validateCustomActionFileName("bad\x01name.webm"), undefined);
});
