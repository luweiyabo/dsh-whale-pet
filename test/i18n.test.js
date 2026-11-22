import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

const { ANIMS, LOCALES, SUPPORTED_LOCALES, translateOrFallback } = plugin.__internals;
const LANGS = Object.keys(LOCALES).sort();
const readJson = async (name) => JSON.parse(await readFile(new URL('../' + name, import.meta.url), 'utf8'));

test('所有内置语言词典键集合一致且文案非空', () => {
    const base = Object.keys(LOCALES.en).sort();
    for (const lang of LANGS) {
        assert.deepEqual(Object.keys(LOCALES[lang]).sort(), base, '键集合不一致: ' + lang);
        for (const key of base) {
            assert.equal(typeof LOCALES[lang][key], 'string', lang + '.' + key);
            assert.ok(LOCALES[lang][key].length > 0, lang + '.' + key);
        }
    }
});

test('语言检测支持的语言与词典一致', () => {
    assert.deepEqual([...new Set(SUPPORTED_LOCALES)].sort(), LANGS);
    for (const lang of LANGS) {
        assert.ok(LOCALES[lang].title.length > 0, lang);
        assert.ok(LOCALES[lang].desc.length > 0, lang);
    }
});

test('旧词典缺少新增键时用本地词典兜底', () => {
    const stale = (key) => key;
    for (const lang of LANGS) {
        assert.equal(translateOrFallback(stale, lang, 'secBalance'), LOCALES[lang].secBalance, lang);
    }
    // 语言服务返回了值就直接用服务的结果
    const fresh = (key) => (key === 'secBalance' ? '来自语言服务' : key);
    assert.equal(translateOrFallback(fresh, 'zh', 'secBalance'), '来自语言服务');
    // 服务缺失时也要能取到对应语言
    assert.equal(translateOrFallback(null, 'ja', 'secBalance'), LOCALES.ja.secBalance);
});

test('每个内置动作都有全部语言的名称和描述', () => {
    for (const anim of ANIMS) {
        for (const locale of LANGS) {
            const nameKey = 'animName_' + anim.id;
            const descriptionKey = 'animDescription_' + anim.id;
            assert.equal(typeof LOCALES[locale][nameKey], 'string', locale + '.' + nameKey);
            assert.equal(typeof LOCALES[locale][descriptionKey], 'string', locale + '.' + descriptionKey);
            assert.ok(LOCALES[locale][nameKey].length > 0, locale + '.' + nameKey);
            assert.ok(LOCALES[locale][descriptionKey].length > 0, locale + '.' + descriptionKey);
        }
    }
});

test('配置界面所有字面量翻译键都在所有词典里', async () => {
    const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
    const keys = new Set([...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]));
    assert.ok(keys.size > 100, 'expected the settings UI to use the locale dictionary');
    for (const lang of LANGS) {
        for (const key of keys) {
            assert.equal(typeof LOCALES[lang][key], 'string', lang + ': ' + key);
        }
    }
});

test('插件清单语言资源覆盖所有内置语言且标题与词典一致', async () => {
    const pkg = await readJson('package.json');
    assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
    assert.ok(pkg.files.includes('locale/*.json'));
    for (const lang of LANGS) {
        const meta = await readJson('locale/' + lang + '.json');
        assert.equal(meta.meta.title, LOCALES[lang].title, lang);
        assert.ok(meta.meta.description.length > 0, lang);
        assert.equal(typeof meta.meta.detail, 'undefined', lang);
    }
    const zh = await readJson('locale/zh.json');
    assert.match(zh.meta.title, /[\u4e00-\u9fff]/);
});
