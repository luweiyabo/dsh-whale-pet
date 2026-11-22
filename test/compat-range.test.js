import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 精简版 semver：只实现本包会用到的 `^x.y.z` 与 `||` 组合，外加 npm 的
// 预发布匹配规则（版本带 prerelease 时，比较器里必须有一个同 [major,minor,patch]
// 的 prerelease 比较器，否则不匹配）。用它来验证平台兼容范围。
function parseVersion(value) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value).trim());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || '' };
}

function compareIdentifiers(a, b) {
    const an = /^\d+$/.test(a);
    const bn = /^\d+$/.test(b);
    if (an && bn) return Number(a) - Number(b);
    if (an) return -1;
    if (bn) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (!a.pre && !b.pre) return 0;
    if (!a.pre) return 1; // 正式版 > 同号预发布版
    if (!b.pre) return -1;
    const ap = a.pre.split('.');
    const bp = b.pre.split('.');
    for (let i = 0; i < Math.max(ap.length, bp.length); i += 1) {
        if (ap[i] === undefined) return -1;
        if (bp[i] === undefined) return 1;
        const cmp = compareIdentifiers(ap[i], bp[i]);
        if (cmp !== 0) return cmp;
    }
    return 0;
}

function caretUpperBound(lo) {
    if (lo.major > 0) return { major: lo.major + 1, minor: 0, patch: 0, pre: '' };
    if (lo.minor > 0) return { major: 0, minor: lo.minor + 1, patch: 0, pre: '' };
    return { major: 0, minor: 0, patch: lo.patch + 1, pre: '' };
}

function satisfies(version, range) {
    const ver = parseVersion(version);
    if (!ver) throw new Error('bad version: ' + version);
    return String(range)
        .split('||')
        .map((part) => part.trim())
        .filter(Boolean)
        .some((part) => {
            const m = /^\^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(part);
            if (!m) throw new Error('unsupported range comparator: ' + part);
            const lo = parseVersion(m[1]);
            const hi = caretUpperBound(lo);
            if (compareVersions(ver, lo) < 0) return false;
            if (compareVersions(ver, hi) >= 0) return false;
            if (ver.pre) {
                // npm：预发布版本只在比较器带有同一 [major,minor,patch] 的 prerelease 时匹配
                const sameTuple = lo.major === ver.major && lo.minor === ver.minor && lo.patch === ver.patch;
                return sameTuple && lo.pre !== '';
            }
            return true;
        });
}

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));

const RANGE = packageJson.dsh.compatibility.dsh;
const PRERELEASE = '^0.2.2-rc.1';

test('semver 子集实现自身可用（防止测试假通过）', () => {
    assert.equal(satisfies('1.2.3', '^1.2.0'), true);
    assert.equal(satisfies('2.0.0', '^1.2.0'), false);
    assert.equal(satisfies('0.2.2-rc.3', '^0.2.0-rc.2'), false, 'npm 的预发布规则');
    assert.equal(satisfies('0.2.2-rc.3', '^0.2.2-rc.1'), true);
});

test('平台兼容范围覆盖 0.1.x / 0.2.x 正式版与已知预发布版', () => {
    for (const v of ['0.1.0-rc.6', '0.1.2-rc.1', '0.2.0-rc.2', '0.2.1', '0.2.3']) {
        assert.equal(satisfies(v, RANGE), true, v + ' 应该被支持');
    }
    // 本机 desktop 实际运行的版本（app.asar 里读到 0.2.2-rc.5；rc.3 是旧的记录）
    assert.equal(satisfies('0.2.2-rc.5', RANGE), true, '当前运行版本必须落在声明范围内');
    assert.equal(satisfies('0.3.0', RANGE), false, '超出 0.2.x 不应声明支持');
});

test('compatibility 与全部 dsh peer 依赖都带同一个预发布比较器', () => {
    assert.ok(RANGE.includes(PRERELEASE), 'dsh.compatibility.dsh 缺少 ' + PRERELEASE);
    const dshPeers = Object.entries(packageJson.peerDependencies).filter(([name]) =>
        name.startsWith('@deepseek-ai/dsh-')
    );
    assert.equal(dshPeers.length, 5);
    for (const [name, range] of dshPeers) {
        assert.ok(range.includes(PRERELEASE), name + ' 缺少 ' + PRERELEASE);
        assert.equal(satisfies('0.2.2-rc.3', range), true, name + ' 不覆盖 0.2.2-rc.3');
    }
});

test('package-lock 里的 peer 依赖范围与 package.json 一致', () => {
    const locked = packageLock.packages[''].peerDependencies;
    for (const [name, range] of Object.entries(packageJson.peerDependencies)) {
        assert.equal(locked[name], range, name + ' 的锁文件范围与 package.json 不一致');
    }
    assert.equal(packageLock.version, packageJson.version);
    assert.equal(packageLock.packages[''].version, packageJson.version);
});
