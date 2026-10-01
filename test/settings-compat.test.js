import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { resolveHostApi } from '../src/client/host-api.js';

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

test('旧版 API 原样保留，包括事件流与模型查询', () => {
    const api = { settings: {}, events: {}, sessions: {} };
    assert.equal(resolveHostApi({ api }), api);
    assert.equal(resolveHostApi(null), undefined);
    assert.equal(resolveHostApi({}), undefined);
});

test('新版 RPC 配置读写转换响应，并传递命名空间、配置和取消信号', async () => {
    const calls = [];
    const connection = {
        rpc: {
            async call(...args) {
                assert.equal(this, connection.rpc);
                calls.push(args);
                return { ok: true, value: { namespaces: [{ ns: 'whale-pet', value: { size: 400 } }] } };
            },
        },
    };
    const api = resolveHostApi(connection);
    const signal = new AbortController().signal;
    assert.equal((await api.settings.describe({}, signal)).result.value.namespaces[0].value.size, 400);
    const patch = { ns: 'whale-pet', patch: { size: 450 } };
    await api.settings.update(patch, signal);
    assert.deepEqual(calls, [
        ['/api', 'settings/describe', { args: {} }, signal],
        ['/api', 'settings/update', { args: patch }, signal],
    ]);
});

test('RPC 拒绝保存或网络失败时抛错，不能误报已保存', async () => {
    const rejected = resolveHostApi({
        rpc: { call: async () => ({ ok: false, error: { message: 'read only' } }) },
    });
    await assert.rejects(rejected.settings.update({ ns: 'whale-pet', patch: {} }), /read only/);
    const offline = resolveHostApi({
        rpc: {
            call: async () => {
                throw new Error('offline');
            },
        },
    });
    await assert.rejects(offline.settings.describe(), /offline/);
});

function loadClient() {
    let definition;
    let cursor = 0;
    const state = [];
    const react = {
        createElement: (type, props) => ({ type, props }),
        useEffect() {},
        useRef: (current) => ({ current }),
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [
                state[index],
                (next) => {
                    state[index] = typeof next === 'function' ? next(state[index]) : next;
                },
            ];
        },
    };
    runInNewContext(bundle, {
        window: { __ModuleLoader__: { load: (value) => (definition = value) } },
        fetch: async () => ({ json: async () => ({ ok: true, actions: [] }) }),
    });
    const plugin = definition.factory((id) => {
        if (id === 'react') return react;
        throw new Error('optional dependency unavailable');
    });
    return {
        plugin,
        render(props) {
            cursor = 0;
            return plugin.__internals.SettingsCard(props).props;
        },
    };
}

for (const [label, api] of [
    ['配置服务缺失', undefined],
    ['配置尚未加载', { settings: {} }],
]) {
    test(label + '时卡片仍默认折叠，且可反复展开与收起', () => {
        const client = loadClient();
        let form = client.render({ api });
        assert.equal(form.open, false);
        form.onToggle();
        form = client.render({ api });
        assert.equal(form.open, true);
        form.onToggle();
        assert.equal(client.render({ api }).open, false);
    });
}

test('鲸鱼卡片在官方默认卡片之后，与注册先后无关', () => {
    for (const whaleFirst of [true, false]) {
        const slots = new SlotCore();
        slots.register(
            {
                name: 'root',
                children: {
                    'shell.overlay': { kind: 'list', scope: 'root' },
                    'settings.plugin.item': { kind: 'keyed', scope: 'root' },
                },
            },
            () => {}
        );
        const official = () => slots.register({ name: 'settings.plugin.item', key: 'shell' }, () => {});
        if (!whaleFirst) official();
        loadClient().plugin.apply(
            {
                get: () => undefined,
                slots: {
                    register: (...args) => slots.register(...args),
                    inject(_name, register) {
                        for (const _dispose of register()) {
                            /* 执行注册生成器。 */
                        }
                    },
                },
            },
            {}
        );
        if (whaleFirst) official();
        assert.deepEqual(
            slots.entries('settings.plugin.item').map((entry) => entry.options.key),
            ['shell', 'whale-pet']
        );
    }
});
