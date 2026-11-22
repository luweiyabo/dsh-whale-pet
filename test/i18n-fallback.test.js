import test from 'node:test';
import assert from 'node:assert/strict';

let plugin;
globalThis.document = {
    documentElement: { lang: 'en-US' },
    querySelector() {
        return {};
    },
};
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
delete globalThis.document;

const { detectLocale, createLocaleBridge, normalizeLocaleTag } = plugin.__internals;

test('宿主页面的 <html lang="en"> 不能压过真实界面语言', () => {
    // DSH 的 index.html 静态写死 lang="en"，只有语言服务启动后才会改成真实语言。
    // 插件模块可能在服务就绪前执行，因此检测必须优先看浏览器/宿主语言。
    assert.equal(detectLocale(['zh-CN', 'zh', 'en-US', 'en']), 'zh');
    assert.equal(detectLocale(['en-US', 'zh-CN']), 'en');
    assert.equal(detectLocale(['ja-JP', 'ja', 'en-US']), 'ja');
    assert.equal(detectLocale(['de-DE']), 'de');
    assert.equal(detectLocale(['pt-BR']), 'pt');
    // 认不出任何支持语言时回插件主语言（中文），而不是英文。
    assert.equal(detectLocale(['fr-CA', 'xx']), 'fr');
    assert.equal(detectLocale(['xx-YY']), 'zh');
    assert.equal(normalizeLocaleTag('zh-Hans-CN'), 'zh');
    assert.equal(normalizeLocaleTag('en'), 'en');
    assert.equal(normalizeLocaleTag('ko'), null);
});

test('语言服务晚于插件就绪：桥接补注册词典并通知组件重渲染', () => {
    let service = null;
    const registered = [];
    const subscribed = [];
    const fakeService = {
        active: 'zh',
        register(ns, dicts) {
            registered.push({ ns, langs: Object.keys(dicts).sort() });
            return () => {
                registered.disposed = (registered.disposed || 0) + 1;
            };
        },
        getSnapshot() {
            return { active: fakeService.active, revision: 1, locales: [] };
        },
        subscribe(fn) {
            subscribed.push(fn);
            return () => {};
        },
        bind(ns) {
            return (key) => `${ns}:${fakeService.active}:${key}`;
        },
    };
    const ctx = {
        get(name) {
            return name === 'locale' ? service : undefined;
        },
    };
    const bridge = createLocaleBridge(ctx);
    const seen = [];
    bridge.subscribe(() => seen.push(bridge.getSnapshot() && bridge.getSnapshot().active));

    // 服务未就绪：取值退回 null，由调用方走 detectLocale 兜底。
    assert.equal(bridge.getSnapshot(), null);
    assert.equal(bridge.bind('whale-pet'), null);
    assert.deepEqual(seen, []);

    // 服务就绪后接入：注册全部词典、订阅语言切换、通知已渲染组件。
    service = fakeService;
    bridge.attach();
    assert.equal(registered.length, 1);
    assert.equal(registered[0].ns, 'whale-pet');
    assert.deepEqual(registered[0].langs, Object.keys(plugin.__internals.LOCALES).sort());
    assert.equal(subscribed.length, 1);
    assert.deepEqual(seen, ['zh']);
    assert.equal(bridge.getSnapshot().active, 'zh');
    assert.equal(bridge.bind('whale-pet')('secParams'), 'whale-pet:zh:secParams');

    // 宿主切换语言：服务订阅触发桥的监听者，组件据此重新取值。
    fakeService.active = 'en';
    subscribed[0]();
    assert.deepEqual(seen, ['zh', 'en']);
    assert.equal(bridge.getSnapshot().active, 'en');
    assert.equal(bridge.bind('whale-pet')('secParams'), 'whale-pet:en:secParams');

    // 插件卸载：释放词典并停止一切后续访问（否则热更新后旧词典占着命名空间）。
    service = null;
    bridge.destroy();
    assert.equal(registered.disposed, 1);
    assert.equal(bridge.getSnapshot(), null);
    assert.equal(bridge.bind('whale-pet'), null);
});
