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
