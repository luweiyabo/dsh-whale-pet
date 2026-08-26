import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const {
    ANIMS,
    INTENT,
    animUrl,
    animFacingTransform,
    createArbiter,
    createConfigStore,
    characterCollisionBounds,
    FLING,
    FLING_START_SEC,
    GROUND_FRICTION_TAU,
    INERTIA_STOP_SPEED,
    INERTIA_TAU,
    BOUNCE_RESTITUTION,
    GREET_ANIM,
    isSafeRegexPattern,
    intentActionIsOnce,
    mergeConfig,
    normalizeRule,
    setCustomAnims,
    startActivitySensor,
    TARGET_MOVE_ANIM,
} = plugin.__internals;

test('包含文字的动画始终不镜像', () => {
    for (const id of ['deep_thought', 'quick_nap', 'writing_the_fu_character', 'yeah_what_should_we_eat']) {
        assert.equal(animFacingTransform(id, 'right'), '', id);
        assert.equal(animFacingTransform(id, 'left'), '', id);
    }
    assert.equal(animFacingTransform('coding', 'right'), 'scaleX(-1)');
    assert.equal(animFacingTransform('coding', 'left'), '');
});

test('客户端意图默认值与宿主默认值一致', () => {
    assert.deepEqual(mergeConfig().intents, {
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

test('即使意图持续激活，所有事件意图动作也只播放一次', () => {
    assert.equal(intentActionIsOnce('rule:turn-end', ['happy_hop']), true);
    assert.equal(intentActionIsOnce(INTENT.LISTENING, ['attentive_listening']), true);
    assert.equal(intentActionIsOnce(INTENT.THINKING, ['deep_thought']), true);
});

test('配置草稿在持久化前立即发布', () => {
    const store = createConfigStore(null);
    const seen = [];
    const unsubscribe = store.subscribe((config) => seen.push(config.position));
    store.set({ position: 'top-left' });
    unsubscribe();
    assert.equal(store.get().position, 'top-left');
    assert.deepEqual(seen, ['top-left']);
});

test('95 个内置动画条目都有对应的打包资源', async () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    assert.equal(ANIMS.length, 95);
    await Promise.all(
        ANIMS.map((anim) => access(join(packageRoot, 'assets', 'thumb', anim.category, anim.id + '.webm')))
    );
});

test('惯性甩出使用变球动画和人物边界碰撞', () => {
    assert.equal(FLING, 'turn_into_ball');
    assert.equal(animUrl(FLING), '/whale-pet/drag/turn_into_ball.webm?v=20260826-1');
    assert.equal(FLING_START_SEC, 2);
    assert.equal(INERTIA_TAU, 700);
    assert.equal(INERTIA_STOP_SPEED, 0.015);
    assert.equal(BOUNCE_RESTITUTION, 0.78);
    assert.equal(GROUND_FRICTION_TAU, 1800);
    assert.deepEqual(characterCollisionBounds(1000, 800, 640), {
        minX: 120,
        maxX: 880,
        minY: 130,
        maxY: 645,
    });
});

test('迁移持久化动作池、意图和规则中的所有已移除动画 ID', () => {
    const removed = ['searching', 'reading_book', 'confused_head_shake', 'helpless_shrug', 'celebration'];
    const expected = ['deep_thought', 'taking_notes', 'deep_thought', 'gravity_squash', 'happy_hop'];
    const config = mergeConfig({
        intents: { working: removed },
        pools: { acts: removed },
        rules: [
            {
                id: 'removed-actions',
                when: [{ field: 'type', op: 'eq', value: 'turn/end' }],
                actions: removed,
            },
        ],
    });
    assert.deepEqual(config.intents.working, expected);
    assert.deepEqual(config.pools.acts, expected);
    assert.deepEqual(config.rules[0].actions, expected.slice(0, 5));
});

test('自定义动画 URL 使用修改时间刷新缓存', () => {
    setCustomAnims([{ id: 'wave', ext: 'webm', mtime: 123456 }]);
    assert.equal(animUrl('wave'), '/whale-pet/custom/wave.webm?v=123456');
});

test('目标移动使用替换后的奔跑和抵达资源', () => {
    assert.equal(TARGET_MOVE_ANIM, 'target_point_run');
    assert.equal(GREET_ANIM, 'arrival_wave');
    assert.match(animUrl(TARGET_MOVE_ANIM), /^\/whale-pet\/moves\/target_point_run\.webm\?v=/);
    assert.match(animUrl(GREET_ANIM), /^\/whale-pet\/clicks\/arrival_wave\.webm\?v=/);
    assert.match(animUrl('attentive_listening'), /^\/whale-pet\/daily\/attentive_listening\.webm\?v=/);
});

test('拒绝存在歧义的量词正则表达式并保留普通模式', () => {
    assert.equal(isSafeRegexPattern('(a|aa)+$'), false);
    assert.equal(isSafeRegexPattern('(a+)+$'), false);
    assert.equal(isSafeRegexPattern('^(ab)+$'), true);
    assert.equal(isSafeRegexPattern('^(foo|bar)$'), true);
    assert.equal(
        normalizeRule({
            id: 'unsafe',
            when: [{ field: 'data.text', op: 'regex', value: '(a|aa)+$' }],
        }),
        null
    );
});

test('高优先级规则使用防抖延迟而非驻留延迟', async () => {
    const seen = [];
    const arbiter = createArbiter({
        debounceMs: 5,
        lingerMs: 200,
        ruleMeta: { 'rule:urgent': { priority: 9 } },
    });
    arbiter.subscribe((intent) => seen.push(intent));
    arbiter.update({ 'rule:urgent': Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 30));
    arbiter.dispose();
    assert.deepEqual(seen, ['rule:urgent']);
});

test('规则和错误保持时间为零时立即过期', async () => {
    const states = [];
    const waitForAbort = (signal) =>
        new Promise((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', resolve, { once: true });
        });
    const api = {
        events: {
            async *host(_input, signal) {
                yield { type: 'host/agent-error' };
                await waitForAbort(signal);
            },
            async *mux(_input, signal) {
                await waitForAbort(signal);
            },
        },
    };
    const stop = startActivitySensor(api, (state) => states.push({ ...state.active }), {
        reconnectMs: 1000,
        errorHoldMs: () => 0,
        rules: () => [
            {
                id: 'instant',
                enable: true,
                when: [{ field: 'type', op: 'eq', value: 'host/agent-error' }],
                cooldownMs: 1000,
                holdMs: 0,
                actions: [],
            },
        ],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    assert.ok(states.some((state) => state[INTENT.ERROR] && state['rule:instant']));
    assert.equal(states.at(-1)[INTENT.ERROR], undefined);
    assert.equal(states.at(-1)['rule:instant'], undefined);
});
