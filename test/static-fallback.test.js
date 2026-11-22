import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

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

const { isWebKitWithoutAlpha, staticFrameUrl, ANIMS } = plugin.__internals;

const SAFARI_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15';
const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const EDGE_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0';
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';
const ELECTRON_DESKTOP =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) dsh-desktop/0.2.2 Chrome/122.0.6261.156 Electron/29.4.6 Safari/537.36';

test('只对"不认 VP9-alpha"的 WebKit 环境启用静态降级', () => {
    assert.equal(isWebKitWithoutAlpha(SAFARI_MAC), true);
    assert.equal(isWebKitWithoutAlpha(SAFARI_IPHONE), true);
    // iOS 上被套壳的浏览器同样走 WebKit，也会黑底
    assert.equal(isWebKitWithoutAlpha(CHROME_IOS), true);
    assert.equal(isWebKitWithoutAlpha(FIREFOX_IOS), true);
    // 有透明视频支持的实现不能降级
    assert.equal(isWebKitWithoutAlpha(CHROME_MAC), false);
    assert.equal(isWebKitWithoutAlpha(EDGE_WIN), false);
    assert.equal(isWebKitWithoutAlpha(FIREFOX_WIN), false);
    assert.equal(isWebKitWithoutAlpha(ELECTRON_DESKTOP), false);
    // 边界输入
    assert.equal(isWebKitWithoutAlpha(''), false);
    assert.equal(isWebKitWithoutAlpha(undefined), false);
    assert.equal(isWebKitWithoutAlpha(null), false);
});

test('静态帧 URL 指向 webp，未知/自定义动作回退到待机海报', () => {
    assert.equal(staticFrameUrl('breathing'), '/whale-pet/static/idle/breathing.webp');
    assert.equal(staticFrameUrl('coding'), '/whale-pet/static/work/coding.webp');
    assert.equal(staticFrameUrl('lion_dance'), '/whale-pet/static/festivals/lion_dance.webp');
    assert.equal(staticFrameUrl('no-such-anim'), '/whale-pet/poster/idle.png');
});

test('每段内置动画都有对应的静态帧', async () => {
    const root = new URL('../assets/thumb/static/', import.meta.url);
    const dirs = await readdir(root, { withFileTypes: true });
    const categories = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
    assert.ok(categories.length > 0, '静态帧目录为空');

    const present = new Set();
    for (const category of categories) {
        const files = await readdir(new URL(category + '/', root));
        for (const file of files) present.add(category + '/' + file);
    }

    const missing = ANIMS.map((a) => a.category + '/' + a.id + '.webp').filter((rel) => !present.has(rel));
    assert.deepEqual(missing, [], '缺少静态帧：' + missing.join(', '));
    assert.equal(present.size, ANIMS.length, '静态帧数量应与动画目录一致');
});
