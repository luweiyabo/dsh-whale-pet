import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedApiRequest } from '../lib/index.js';

const req = (headers, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } });

test('允许浏览器同源请求', () => {
  assert.equal(isAllowedApiRequest(req({ 'sec-fetch-site': 'same-origin', host: 'localhost:8123', origin: 'http://localhost:8123' })), true);
  assert.equal(isAllowedApiRequest(req({ 'sec-fetch-site': 'same-origin', host: '127.0.0.1:8123', origin: 'http://127.0.0.1:8123' })), true);
  // 地址栏直接打开（顶层导航）
  assert.equal(isAllowedApiRequest(req({ 'sec-fetch-site': 'none', host: '[::1]:8123' })), true);
});

test('允许缺少 Fetch 元数据的非浏览器客户端（Electron IPC 或 curl）', () => {
  assert.equal(isAllowedApiRequest(req({ host: '127.0.0.1:9000' })), true);
  assert.equal(isAllowedApiRequest(req({ host: '[::1]:9000' })), true);
  assert.equal(isAllowedApiRequest(req({ host: '192.168.1.5:9000' })), true);
});

test('即使伪造回环 Host 请求头也拒绝远程客户端', () => {
  assert.equal(isAllowedApiRequest(req({ host: '127.0.0.1:9000' }, '192.168.1.50')), false);
  assert.equal(isAllowedApiRequest(req({ host: '[::1]:9000' }, '2001:db8::10')), false);
  assert.equal(isAllowedApiRequest({ headers: { host: '127.0.0.1:9000' } }), false);
});

test('拒绝浏览器跨站和同站请求', () => {
  assert.equal(isAllowedApiRequest(req({ 'sec-fetch-site': 'cross-site', host: 'localhost:8123' })), false);
  assert.equal(isAllowedApiRequest(req({ 'sec-fetch-site': 'same-site', host: 'localhost:8123' })), false);
});

test('拒绝不匹配或格式错误的 Origin', () => {
  assert.equal(isAllowedApiRequest(req({ host: 'localhost:8123', origin: 'http://evil.example' })), false);
  assert.equal(isAllowedApiRequest(req({ host: 'localhost:8123', origin: 'null' })), false);
  assert.equal(isAllowedApiRequest(req({ host: 'localhost:8123', origin: 'not a url' })), false);
});

test('即使 Origin 匹配也拒绝非字面量 Host（DNS 重绑定攻击面）', () => {
  assert.equal(isAllowedApiRequest(req({ 'sec-fetch-site': 'same-origin', host: 'evil.example:8123', origin: 'http://evil.example:8123' })), false);
  assert.equal(isAllowedApiRequest(req({ host: 'myhost.local:8123' })), false);
});

test('拒绝缺失或格式错误的 Host', () => {
  assert.equal(isAllowedApiRequest(req({})), false);
  assert.equal(isAllowedApiRequest(req({ host: '' })), false);
  assert.equal(isAllowedApiRequest(req({ host: '[' })), false);
});
