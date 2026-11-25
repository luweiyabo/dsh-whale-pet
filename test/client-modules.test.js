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
        event: {
            type: 'tool/call',
            data: { turn: 't1', step: 1, callId: 'c1', name: 'write', arguments: {} },
        },
    };
    const state = activity.applyFrame(activity.emptyIntentState(), frame, 10000);
    const matched = activity.matchRules([rule], frame, undefined, 10000);
    assert.equal(matched.fired.length, 1);
    const intent = 'rule:' + matched.fired[0].id;
    assert.equal(activity.highestIntent({ ...state.active, [intent]: 10000 }, { [intent]: rule }), intent);
    assert.equal(activity.matchRules([rule], frame, matched.state, 10500).fired.length, 0);
});

test('规则清洗不设数量上限：12 个条件、6 个动作与 60 条规则都原样保留', () => {
    const catalog = createAnimationCatalog();
    const activity = createActivitySystem(catalog);
    const when = Array.from({ length: 12 }, (_, i) => ({
        field: 'data.k' + i,
        op: 'eq',
        value: String(i),
    }));
    // 旧实现静默截断到 10 条件 / 5 动作，保存后用户会丢配置；宿主 schema 无上限
    const actions = [
        'coding',
        'taking_notes',
        'deep_thought',
        'eating_tokens',
        'attentive_listening',
        'looking_around',
    ];
    const rule = activity.normalizeRule({ id: 'many', when, actions });
    assert.equal(rule.when.length, 12, '条件数不能被静默截断到 10');
    assert.deepEqual(rule.actions, actions, '动作数不能被静默截断到 5');

    // 规则总数同样不截断（旧实现最多 50 条）；逐条校验仍生效
    const many = Array.from({ length: 60 }, (_, i) => ({
        id: 'r' + i,
        when: [{ field: 'type', op: 'eq', value: 'turn/end' }],
    }));
    assert.equal(activity.normalizeRules(many).length, 60);
    assert.equal(activity.normalizeRule({ id: 'bad', when: [{ field: '', op: 'eq', value: 'x' }] }), null);
    // id 去重仍然保留首条（不是数量截断）
    assert.equal(activity.normalizeRules([many[0], many[0]]).length, 1);
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
