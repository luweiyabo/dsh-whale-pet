import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../lib/index.js';

function createHost() {
  const routes = new Map();
  const ctx = {
    settings: {
      register() {},
      get() { return undefined; },
    },
    get() { return undefined; },
    effect(register) { return register(); },
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

async function invokeJson(handler, { body = '', method = 'POST', url }) {
  const payload = Buffer.from(body);
  const req = Readable.from(payload.length ? [payload] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    host: 'localhost:8123',
    origin: 'http://localhost:8123',
    'sec-fetch-site': 'same-origin',
    'content-length': String(payload.length),
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  let status;
  let headers;
  let responseBody = '';
  const res = {
    setHeader() {},
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(chunk = '') {
      responseBody += String(chunk);
    },
  };
  await handler(req, res);
  return { status, headers, body: JSON.parse(responseBody) };
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
