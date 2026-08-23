import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const clientSource = await readFile(new URL('lib/client.js', root), 'utf8');
const bundlePatch = await readFile(new URL('cordis.patch.yml', root), 'utf8');

test('客户端 bundle 注册已发布的包名', () => {
  const escapedName = packageJson.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    clientSource,
    new RegExp(`window\\.__ModuleLoader__\\.load\\(\\{[\\s\\S]*?id:\\s*['"]${escapedName}['"]`),
  );
});

test('bundle patch 加载已发布的包名', () => {
  assert.match(bundlePatch, /^\s+name:\s*['"]?@luweiyabo\/dsh-whale-pet['"]?\s*(?:#.*)?$/m);
});

test('包公开所有 DSH 发布入口', () => {
  assert.equal(packageJson.exports['.'], './lib/index.js');
  assert.equal(packageJson.exports['./client'], './lib/client.js');
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(packageJson.dsh.client.platform, 'web');
  assert.ok(packageJson.files.includes('lib'));
  assert.ok(packageJson.files.includes('assets'));
  assert.ok(packageJson.files.includes('cordis.patch.yml'));
});
