import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { apply, parseRangeHeader } from '../lib/index.js';

test('parseRangeHeader 解析单段范围', () => {
    assert.deepEqual(parseRangeHeader('bytes=0-9', 100), { start: 0, end: 9 });
    assert.deepEqual(parseRangeHeader('bytes=90-', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRangeHeader('bytes=-10', 100), { start: 90, end: 99 });
    // 末尾越界：钳制到文件末尾而不是报错
    assert.deepEqual(parseRangeHeader('bytes=95-200', 100), { start: 95, end: 99 });
});

test('parseRangeHeader 处理非法与不可满足的范围', () => {
    // 无 Range / 非 bytes 单位 / 多段：按无范围处理（整包 200）
    assert.equal(parseRangeHeader(undefined, 100), null);
    assert.equal(parseRangeHeader('', 100), null);
    assert.equal(parseRangeHeader('items=0-1', 100), null);
    assert.equal(parseRangeHeader('bytes=0-1,5-6', 100), null);
    assert.equal(parseRangeHeader('bytes=0-9', 0), null);
    // 越界：416
    assert.equal(parseRangeHeader('bytes=100-', 100), 'unsatisfiable');
    assert.equal(parseRangeHeader('bytes=5-2', 100), 'unsatisfiable');
    assert.equal(parseRangeHeader('bytes=-0', 100), 'unsatisfiable');
});

class Capture extends Writable {
    constructor() {
        super();
        this.status = 0;
        this.headers = {};
        this.chunks = [];
    }
    writeHead(status, headers) {
        this.status = status;
        this.headers = headers || {};
        return this;
    }
    _write(chunk, _encoding, callback) {
        this.chunks.push(Buffer.from(chunk));
        callback();
    }
    body() {
        return Buffer.concat(this.chunks);
    }
}

function createHost() {
    const routes = new Map();
    const ctx = {
        settings: { register() {}, get: () => undefined },
        get: () => undefined,
        effect: (register) => register(),
        webServer: {
            register(route) {
                routes.set(route.path, route.handler);
                return () => {};
            },
        },
    };
    apply(ctx, {});
    return routes;
}

async function requestAsset(handler, path, headers = {}) {
    const req = {
        method: 'GET',
        url: path,
        headers: Object.assign({ host: 'localhost:8123' }, headers),
        socket: { remoteAddress: '127.0.0.1' },
    };
    const res = new Capture();
    const finished = new Promise((resolve) => res.on('finish', resolve));
    await handler(req, res);
    await finished;
    return res;
}

test('内置资源支持 206 字节范围', async () => {
    const handler = createHost().get('/whale-pet');
    const res = await requestAsset(handler, '/whale-pet/turn/looking_around.webm', { range: 'bytes=0-3' });
    assert.equal(res.status, 206);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    const match = /^bytes 0-3\/(\d+)$/.exec(String(res.headers['content-range']));
    assert.ok(match, 'content-range 形状应为 bytes 0-3/<total>');
    assert.ok(Number(match[1]) > 100000, '动画文件应有实际体积');
    assert.equal(Number(res.headers['content-length']), 4);
    assert.equal(res.body().length, 4);
});

test('内置资源整包返回时也声明 accept-ranges', async () => {
    const handler = createHost().get('/whale-pet');
    const res = await requestAsset(handler, '/whale-pet/turn/looking_around.webm');
    assert.equal(res.status, 200);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(Number(res.headers['content-length']), res.body().length);
    assert.ok(res.body().length > 0);
});

test('静态帧按 image/webp 返回，海报按 image/png 返回', async () => {
    const handler = createHost().get('/whale-pet');
    const webp = await requestAsset(handler, '/whale-pet/static/idle/breathing.webp');
    assert.equal(webp.status, 200);
    assert.equal(webp.headers['content-type'], 'image/webp');
    assert.ok(webp.body().length > 1000, '静态帧应有实际体积');

    const poster = await requestAsset(handler, '/whale-pet/poster/idle.png');
    assert.equal(poster.status, 200);
    assert.equal(poster.headers['content-type'], 'image/png');
});

test('越界范围返回 416 且带 content-range', async () => {
    const handler = createHost().get('/whale-pet');
    const res = await requestAsset(handler, '/whale-pet/turn/looking_around.webm', {
        range: 'bytes=999999999-',
    });
    assert.equal(res.status, 416);
    assert.match(String(res.headers['content-range']), /^bytes \*\/\d+$/);
});
