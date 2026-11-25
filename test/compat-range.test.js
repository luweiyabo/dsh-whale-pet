import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 兼容性契约（DSH 0.2.2-rc.5 实测）：
// DSH 判定插件兼容性时只看 `engines.dsh`，否则逐个校验 `@deepseek-ai/dsh*` 的
// peer 范围（plugin-compatibility.ts）；`dsh.compatibility` 字段 DSH 不读。
// 这里用硬编码的期望值锁定声明，不做 semver 求值（求值归 DSH 本体），
// 防止声明与发布配置悄悄漂移。
const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

const EXPECTED_DSH_RANGE = '^0.1.0-rc.6 || ^0.1.2-rc.1 || ^0.2.0-rc.2 || ^0.2.2-rc.1';

test('engines.dsh 等于约定的兼容范围（DSH 唯一读取的兼容字段）', () => {
    assert.equal(packageJson.engines?.dsh, EXPECTED_DSH_RANGE);
});

test('peerDependencies 不再声明 DSH 安装中不存在的包', () => {
    const peers = Object.keys(packageJson.peerDependencies || {});
    assert.equal(peers.includes('@deepseek-ai/dsh-client-runtime'), false);
    assert.equal(peers.includes('@deepseek-ai/dsh-client-ui-slots'), false);
});

test('遗留的 dsh.compatibility 已删除，dsh.client 只保留平台声明', () => {
    assert.equal('compatibility' in (packageJson.dsh || {}), false);
    assert.equal(packageJson.dsh?.client?.platform, 'web');
    assert.equal('inject' in (packageJson.dsh?.client || {}), false);
});
