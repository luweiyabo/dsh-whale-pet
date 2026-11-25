import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply, scanCustomActions } from '../lib/index.js';

function createHost() {
    const routes = new Map();
    const ctx = {
        settings: {
            register() {},
            get() {
                return undefined;
            },
        },
        get() {
            return undefined;
        },
        effect(register) {
            return register();
        },
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

async function invokeJson(handler, { body = '', method = 'POST', url, headers = {}, remoteAddress } = {}) {
    const payload = Buffer.from(body);
    const req = Readable.from(payload.length ? [payload] : []);
    req.method = method;
    req.url = url;
    req.headers = {
        host: 'localhost:8123',
        origin: 'http://localhost:8123',
        'sec-fetch-site': 'same-origin',
        'content-length': String(payload.length),
        ...headers,
    };
    req.socket = { remoteAddress: remoteAddress ?? '127.0.0.1' };
    let status;
    let responseHeaders;
    let responseBody = '';
    const res = {
        setHeader() {},
        writeHead(nextStatus, nextHeaders) {
            status = nextStatus;
            responseHeaders = nextHeaders || {};
        },
        end(chunk = '') {
            responseBody += String(chunk);
        },
    };
    await handler(req, res);
    const isJson = String(responseHeaders && responseHeaders['content-type']).includes('application/json');
    return {
        status,
        headers: responseHeaders,
        body: isJson && responseBody ? JSON.parse(responseBody) : responseBody,
    };
}

async function invokeAsset(handler, url, request = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let status;
        let headers;
        const res = new Writable({
            write(chunk, _encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });
        res.writeHead = (nextStatus, nextHeaders) => {
            status = nextStatus;
            headers = nextHeaders;
        };
        res.on('finish', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
        const req = {
            url,
            headers: {
                host: 'localhost:8123',
                origin: 'http://localhost:8123',
                'sec-fetch-site': 'same-origin',
                ...request.headers,
            },
            socket: { remoteAddress: request.remoteAddress ?? '127.0.0.1' },
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

test('只读 API 拒绝非 GET 请求', async () => {
    const routes = createHost();
    for (const path of ['/whale-pet/api/actions', '/whale-pet/api/balance']) {
        const result = await invokeJson(routes.get(path), { method: 'POST', url: path });
        assert.equal(result.status, 405);
        assert.equal(result.body.error, 'method-not-allowed');
    }
});

test('上传采用独占提交、执行总配额限制并为自定义资源添加版本', async () => {
    const root = await mkdtemp(join(tmpdir(), 'whale-pet-actions-'));
    const previousDshHome = process.env.DSH_HOME;
    process.env.DSH_HOME = root;
    try {
        const routes = createHost();
        const upload = routes.get('/whale-pet/api/actions/upload');
        const asset = routes.get('/whale-pet');

        const results = await Promise.all([
            invokeJson(upload, { body: 'first', url: '/whale-pet/api/actions/upload?name=race.webm' }),
            invokeJson(upload, { body: 'second', url: '/whale-pet/api/actions/upload?name=race.webm' }),
        ]);
        assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
        const created = results.find((result) => result.status === 201);
        assert.equal(created.body.action.url, '/whale-pet/custom/race.webm', '上传响应带真实文件 url');
        const stored = await readFile(join(root, 'whale-pet', 'actions', 'race.webm'), 'utf8');
        assert.ok(stored === 'first' || stored === 'second');

        const unversioned = await invokeAsset(asset, '/whale-pet/custom/race.webm');
        assert.equal(unversioned.status, 200);
        assert.equal(unversioned.headers['cache-control'], 'no-store');
        const versioned = await invokeAsset(asset, '/whale-pet/custom/race.webm?v=123');
        assert.equal(versioned.status, 200);
        assert.equal(versioned.headers['cache-control'], 'public, max-age=31536000, immutable');

        const remote = await invokeAsset(asset, '/whale-pet/custom/race.webm', {
            remoteAddress: '192.168.1.50',
            headers: { host: '127.0.0.1:8123', origin: 'http://127.0.0.1:8123' },
        });
        assert.equal(remote.status, 403);
        assert.equal(remote.headers['cache-control'], 'no-store');

        const crossSite = await invokeAsset(asset, '/whale-pet/custom/race.webm', {
            headers: { 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' },
        });
        assert.equal(crossSite.status, 403);

        const tinyUploads = await Promise.all(
            Array.from({ length: 12 }, (_, index) =>
                invokeJson(upload, {
                    body: 'x',
                    url: '/whale-pet/api/actions/upload?name=tiny-' + index + '.webm',
                })
            )
        );
        assert.deepEqual(
            tinyUploads.map((result) => result.status),
            Array(12).fill(201)
        );

        const actionsDir = join(root, 'whale-pet', 'actions');
        await mkdir(actionsDir, { recursive: true });
        const quotaFile = join(actionsDir, 'quota.webm');
        await writeFile(quotaFile, '');
        await truncate(quotaFile, 512 * 1024 * 1024);
        const quotaResult = await invokeJson(upload, {
            body: 'x',
            url: '/whale-pet/api/actions/upload?name=over-quota.webm',
        });
        assert.equal(quotaResult.status, 413);
        assert.equal(quotaResult.body.error, 'storage-quota-exceeded');
    } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
        await rm(root, { recursive: true, force: true });
    }
});

test('自定义动作清单用文件真实名生成 url，且该 url 可直接播放', async () => {
    const root = await mkdtemp(join(tmpdir(), 'whale-pet-url-'));
    const previousDshHome = process.env.DSH_HOME;
    process.env.DSH_HOME = root;
    try {
        const routes = createHost();
        const dir = join(root, 'whale-pet', 'actions');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'Dance.MP4'), 'mp4-body');
        await writeFile(join(dir, '鲸鱼 挥手.webm'), 'webm-body');

        const actions = await scanCustomActions();
        const dance = actions.find((item) => item.file === 'Dance.MP4');
        const wave = actions.find((item) => item.file === '鲸鱼 挥手.webm');
        assert.ok(dance, '应列出大写扩展名的文件');
        assert.ok(wave, '应列出中文文件名');
        assert.equal(dance.ext, 'mp4', 'ext 仍小写用于其他逻辑');
        assert.equal(dance.file, 'Dance.MP4', 'file 保持真实文件名');
        assert.equal(dance.url, '/whale-pet/custom/Dance.MP4', 'url 用文件真实名拼接，大小写敏感盘也能命中');
        assert.equal(wave.url, '/whale-pet/custom/' + encodeURIComponent('鲸鱼 挥手.webm'));

        const asset = routes.get('/whale-pet');
        const mp4 = await invokeAsset(asset, dance.url);
        assert.equal(mp4.status, 200);
        assert.equal(mp4.body.toString('utf8'), 'mp4-body');
        const webm = await invokeAsset(asset, wave.url);
        assert.equal(webm.status, 200);
        assert.equal(webm.body.toString('utf8'), 'webm-body');
    } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
        await rm(root, { recursive: true, force: true });
    }
});

test('删除自定义动作：成功 / 404 / 403 / 符号链接', async () => {
    const root = await mkdtemp(join(tmpdir(), 'whale-pet-delete-'));
    const previousDshHome = process.env.DSH_HOME;
    process.env.DSH_HOME = root;
    try {
        const routes = createHost();
        const remove = routes.get('/whale-pet/api/actions/delete');
        const dir = join(root, 'whale-pet', 'actions');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'gone.webm'), 'x');
        await writeFile(join(dir, 'keep.mp4'), 'y');
        const outside = join(root, 'outside.webm');
        await writeFile(outside, 'secret');
        await symlink(outside, join(dir, 'link.webm'));

        const removed = await invokeJson(remove, {
            method: 'DELETE',
            url: '/whale-pet/api/actions/delete?name=gone.webm',
        });
        assert.equal(removed.status, 200);
        assert.equal(removed.body.ok, true);
        assert.equal(removed.body.action.file, 'gone.webm');
        assert.equal(removed.body.action.url, '/whale-pet/custom/gone.webm');
        await assert.rejects(lstat(join(dir, 'gone.webm')), '成功删除后文件应消失');

        const missing = await invokeJson(remove, {
            method: 'DELETE',
            url: '/whale-pet/api/actions/delete?name=missing.webm',
        });
        assert.equal(missing.status, 404);
        assert.equal(missing.body.error, 'file-not-found');

        // 动作目录内的符号链接一律 404，且不能删到链接指向的真实文件
        const linked = await invokeJson(remove, {
            method: 'DELETE',
            url: '/whale-pet/api/actions/delete?name=link.webm',
        });
        assert.equal(linked.status, 404);
        assert.equal((await lstat(join(dir, 'link.webm'))).isSymbolicLink(), true);
        assert.equal(await readFile(outside, 'utf8'), 'secret');

        const forbidden = await invokeJson(remove, {
            method: 'DELETE',
            url: '/whale-pet/api/actions/delete?name=keep.mp4',
            remoteAddress: '192.168.1.20',
        });
        assert.equal(forbidden.status, 403);
        assert.equal(forbidden.body.error, 'forbidden');

        const invalid = await invokeJson(remove, {
            method: 'DELETE',
            url: '/whale-pet/api/actions/delete?name=' + encodeURIComponent('../escape.webm'),
        });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.body.error, 'invalid-file-name');

        const wrongMethod = await invokeJson(remove, {
            method: 'GET',
            url: '/whale-pet/api/actions/delete?name=keep.mp4',
        });
        assert.equal(wrongMethod.status, 405);
        assert.equal(await readFile(join(dir, 'keep.mp4'), 'utf8'), 'y', '被拒绝的请求不能删文件');
    } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
        await rm(root, { recursive: true, force: true });
    }
});
