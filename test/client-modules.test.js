import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createAnimationCatalog } from '../src/client/animations.js';
import { createActivitySystem } from '../src/client/activity.js';

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

test('生成的客户端在普通脚本环境加载，保留宿主依赖并隔离每次实例的动作注册表', () => {
    let definition;
    runInNewContext(bundle, {
        window: { __ModuleLoader__: { load: (value) => (definition = value) } },
    });
    const requested = [];
    const require = (id) => {
        requested.push(id);
        if (id !== 'react') throw new Error('Optional host module unavailable: ' + id);
        return {};
    };
    const first = definition.factory(require);
    const second = definition.factory(require);
    assert.deepEqual(requested, [
        'react',
        '@deepseek-ai/dsh-client-ui-primitives',
        'react',
        '@deepseek-ai/dsh-client-ui-primitives',
    ]);
    assert.equal(first.name, 'whale-pet');
    assert.equal(typeof first.apply, 'function');
    first.__internals.setCustomAnims([{ id: 'private-action', ext: 'mp4', mtime: 42 }]);
    assert.equal(first.__internals.animUrl('private-action'), '/whale-pet/custom/private-action.mp4?v=42');
    assert.equal(second.__internals.animUrl('private-action'), '');
    assert.equal(first.__internals.ANIMS.length, 95);
});

test('独立源码模块能迁移动作规则并将命中的规则交给意图仲裁', () => {
    const catalog = createAnimationCatalog();
    const activity = createActivitySystem(catalog);
    const rule = activity.normalizeRule({
        id: 'write-response',
        when: [{ field: 'toolName', op: 'eq', value: 'write' }],
        actions: ['celebration'],
        priority: 9,
        cooldownMs: 1000,
    });
    assert.deepEqual(rule.actions, ['happy_hop']);
    const frame = {
        type: 'session/event',
        event: { type: 'tool/call', data: { name: 'write', turn: 't1', step: 1 } },
    };
    const state = activity.applyFrame(activity.emptyIntentState(), frame, 10000);
    const matched = activity.matchRules([rule], frame, undefined, 10000);
    assert.equal(matched.fired.length, 1);
    const intent = 'rule:' + matched.fired[0].id;
    assert.equal(activity.highestIntent({ ...state.active, [intent]: 10000 }, { [intent]: rule }), intent);
    assert.equal(activity.matchRules([rule], frame, matched.state, 10500).fired.length, 0);
});

test('安静模式不再自主移动：预设概率封顶，旧版安静配置合并时迁移', () => {
    let definition;
    runInNewContext(bundle, {
        window: { __ModuleLoader__: { load: (value) => (definition = value) } },
    });
    const internals = definition.factory((id) => {
        if (id === 'react') return {};
        throw new Error('Optional host module unavailable: ' + id);
    }).__internals;

    // 安静预设前三项概率之和 ≥ 1，使 pickNext 的移动分支不可达，动作只在原地播放
    const quiet = internals.ACTIVITY_PRESETS.quiet;
    assert.equal(quiet.moveProb, 0);
    assert.ok(quiet.idleProb + quiet.turnProb + quiet.actProb >= 1);

    // bundle 运行在 vm 沙箱，跨 realm 对象原型不同，行为字段需逐项比较
    const probsOf = (b) => [b.idleProb, b.turnProb, b.actProb, b.moveProb];

    // 旧版安静配置（带 moveProb 0.1）合并时迁移为新预设，避免老用户继续漫游
    const migrated = internals.mergeConfig({ behavior: { ...internals.LEGACY_QUIET_BEHAVIOR } });
    assert.deepEqual(probsOf(migrated.behavior), probsOf({ ...internals.DEFAULT_CONFIG.behavior, ...quiet }));

    // 其余预设与手动微调的概率不受迁移影响
    const balanced = internals.mergeConfig({ behavior: { ...internals.ACTIVITY_PRESETS.balanced } });
    assert.deepEqual(probsOf(balanced.behavior), probsOf(internals.DEFAULT_CONFIG.behavior));
    const tuned = internals.mergeConfig({ behavior: { moveProb: 0.1, idleProb: 0.2 } });
    assert.equal(tuned.behavior.moveProb, 0.1);
    assert.equal(tuned.behavior.idleProb, 0.2);
});
