import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { apply, commitUploadFile, resolveDshHomeDir, validateCustomActionFileName } from '../lib/index.js';

// 整个测试文件共享一个临时 DSH_HOME：apply 会尽力创建自定义动作目录，
// 用临时目录避免污染真实用户主目录。
const TMP_ROOT = await mkdtemp(join(tmpdir(), 'wp-host-fixes-'));
const PREVIOUS_DSH_HOME = process.env.DSH_HOME;
process.env.DSH_HOME = TMP_ROOT;

after(async () => {
    if (PREVIOUS_DSH_HOME === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = PREVIOUS_DSH_HOME;
    await rm(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// fake 宿主：计数 describe、收集 effect 注销器与事件监听
// ---------------------------------------------------------------------------
function createHost(options = {}) {
    const routes = new Map();
    const unregistered = [];
    const listeners = new Map();
    const disposers = [];
    const ctx = {
        settings: options.settings,
        get(name) {
            const services = options.services || {};
            if (Object.prototype.hasOwnProperty.call(services, name)) return services[name];
            if (name === 'llm') {
                return options.providers ? { listConfigurableProviders: () => options.providers } : undefined;
            }
            return undefined;
        },
        effect(register) {
            const disposer = register();
            if (typeof disposer === 'function') disposers.push(disposer);
            return disposer;
        },
        on(event, listener) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(listener);
            return () => {
                const set = listeners.get(event);
                if (set) set.delete(listener);
            };
        },
        webServer: {
            register(route) {
                routes.set(route.path, route.handler);
                return () => {
                    routes.delete(route.path);
                    unregistered.push(route.path);
                };
            },
        },
        logger: options.logger,
    };
    apply(ctx, {});
    return { ctx, routes, unregistered, listeners, disposers };
}

async function invokeJson(handler, { body = '', method = 'GET', url, headers = {}, remoteAddress } = {}) {
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

// ---------------------------------------------------------------------------
// 1. describe() 缓存：TTL 内复用 + 事件失效 + 单请求只 describe 一次
// ---------------------------------------------------------------------------
const DEEPSEEK_PROVIDER = {
    provider: 'deepseek-official',
    displayName: 'DeepSeek',
    settingsNs: 'llm-deepseek',
    settingsPath: [],
    defaultBaseURL: 'https://api.deepseek.com',
};
const CODEX_PROVIDER = {
    provider: 'openai-codex',
    displayName: 'ChatGPT Codex',
    settingsNs: 'llm-codex',
    settingsPath: [],
    defaultBaseURL: 'https://chatgpt.com/backend-api',
};
const META_URL = '/whale-pet/api/balance?mode=meta&route=deepseek-official&model=deepseek-chat';

function settingsRows(allowApiKey = true) {
    return [
        { ns: 'llm-deepseek', value: { baseURL: 'https://api.deepseek.com' } },
        { ns: 'whale-pet', value: { balance: { allowApiKey, timeoutMs: 12000 } } },
    ];
}

test('余额请求在 describe 缓存 TTL 内只调用一次 describe', async () => {
    let describeCalls = 0;
    const host = createHost({
        providers: [DEEPSEEK_PROVIDER],
        settings: {
            register() {},
            describe() {
                describeCalls += 1;
                return settingsRows();
            },
        },
    });
    const handler = host.routes.get('/whale-pet/api/balance');

    const first = await invokeJson(handler, { url: META_URL });
    assert.equal(first.status, 200);
    assert.equal(first.body.source, 'wallet');
    assert.equal(first.body.allowApiKey, true);
    assert.equal(describeCalls, 1, '一次请求里的多处设置读取共用一次 describe');

    const second = await invokeJson(handler, { url: META_URL });
    assert.equal(second.status, 200);
    assert.equal(describeCalls, 1, 'TTL 内的第二次请求仍复用缓存');
});

test('settings/document-updated 与 app-boot/config-reload 立即失效 describe 缓存', async () => {
    let allowApiKey = true;
    let describeCalls = 0;
    const host = createHost({
        providers: [DEEPSEEK_PROVIDER],
        settings: {
            register() {},
            describe() {
                describeCalls += 1;
                return settingsRows(allowApiKey);
            },
        },
    });
    const handler = host.routes.get('/whale-pet/api/balance');

    assert.equal((await invokeJson(handler, { url: META_URL })).body.allowApiKey, true);
    allowApiKey = false;
    assert.equal((await invokeJson(handler, { url: META_URL })).body.allowApiKey, true, 'TTL 内仍读缓存值');

    const onDocumentUpdated = [...host.listeners.get('settings/document-updated')][0];
    onDocumentUpdated();
    assert.equal((await invokeJson(handler, { url: META_URL })).body.allowApiKey, false);

    allowApiKey = true;
    const onConfigReload = [...host.listeners.get('app-boot/config-reload')][0];
    onConfigReload();
    assert.equal((await invokeJson(handler, { url: META_URL })).body.allowApiKey, true);
    assert.equal(describeCalls, 3, '每次失效后重新 describe 一次');
});

test('一次额度请求内多处读取设置只 describe 一次', async () => {
    let describeCalls = 0;
    const host = createHost({
        providers: [CODEX_PROVIDER],
        settings: {
            register() {},
            describe() {
                describeCalls += 1;
                return settingsRows();
            },
        },
    });
    const previousCodexHome = process.env.CODEX_HOME;
    const codexHome = await mkdtemp(join(tmpdir(), 'wp-codex-empty-'));
    process.env.CODEX_HOME = codexHome;
    try {
        const result = await invokeJson(host.routes.get('/whale-pet/api/balance'), {
            url: '/whale-pet/api/balance?mode=quota&route=openai-codex&model=gpt-5',
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.provider, 'codex');
        assert.equal(result.body.status, 'unavailable');
        assert.equal(
            describeCalls,
            1,
            'resolveBalanceConfig / readBalanceSettings / resolveQuotaConfig 共用一次'
        );
    } finally {
        if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previousCodexHome;
        await rm(codexHome, { recursive: true, force: true });
    }
});

test('0.1.x 的 settings.get 路径保持原样，不调用 describe', async () => {
    const getCalls = [];
    let describeCalls = 0;
    const host = createHost({
        providers: [DEEPSEEK_PROVIDER],
        settings: {
            register() {},
            get(ns) {
                getCalls.push(ns);
                if (ns === 'whale-pet') return { balance: { allowApiKey: true } };
                return { baseURL: 'https://api.deepseek.com' };
            },
            describe() {
                describeCalls += 1;
                return settingsRows();
            },
        },
    });
    const result = await invokeJson(host.routes.get('/whale-pet/api/balance'), { url: META_URL });
    assert.equal(result.body.source, 'wallet');
    assert.equal(result.body.allowApiKey, true);
    assert.ok(getCalls.includes('whale-pet'));
    assert.equal(describeCalls, 0, 'get 存在时完全不碰 describe');
});

test('ctx.effect 注销：卸载时注销全部路由并移除设置失效监听', async () => {
    const host = createHost({
        providers: [],
        settings: { register() {}, describe: () => [] },
    });
    const routePaths = [...host.routes.keys()].sort();
    assert.deepEqual(routePaths, [
        '/whale-pet',
        '/whale-pet/api/actions',
        '/whale-pet/api/actions/delete',
        '/whale-pet/api/actions/upload',
        '/whale-pet/api/balance',
        '/whale-pet/api/model',
    ]);
    assert.equal(host.listeners.get('settings/document-updated').size, 1);
    assert.equal(host.listeners.get('app-boot/config-reload').size, 1);

    for (const dispose of host.disposers) dispose();

    assert.deepEqual([...host.routes.keys()], [], 'dispose 后所有路由都应注销');
    assert.deepEqual(host.unregistered.sort(), routePaths);
    assert.equal(host.listeners.get('settings/document-updated').size, 0);
    assert.equal(host.listeners.get('app-boot/config-reload').size, 0);
});

// ---------------------------------------------------------------------------
// 3. resolveDshHomeDir：与官方 dsh-home-paths 一样展开 ~ 前缀
// ---------------------------------------------------------------------------
test('resolveDshHomeDir 展开 ~ / ~\\ 前缀，并保留空白视为未设置', async () => {
    const restore = () => {
        process.env.DSH_HOME = TMP_ROOT;
    };
    try {
        delete process.env.DSH_HOME;
        assert.equal(resolveDshHomeDir(), resolve(join(homedir(), '.dsh')));

        process.env.DSH_HOME = '   ';
        assert.equal(resolveDshHomeDir(), resolve(join(homedir(), '.dsh')), '空白视为未设置');

        process.env.DSH_HOME = '~';
        assert.equal(resolveDshHomeDir(), resolve(homedir()));

        process.env.DSH_HOME = '~/whale-home-test';
        assert.equal(resolveDshHomeDir(), resolve(join(homedir(), 'whale-home-test')));

        process.env.DSH_HOME = '~\\whale-home-test';
        assert.equal(resolveDshHomeDir(), resolve(join(homedir(), 'whale-home-test')));

        process.env.DSH_HOME = '~/a/../whale-home-test';
        assert.equal(resolveDshHomeDir(), resolve(join(homedir(), 'whale-home-test')), '展开后仍 resolve');

        process.env.DSH_HOME = '/tmp/whale-home-abs';
        assert.equal(resolveDshHomeDir(), resolve('/tmp/whale-home-abs'));
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------------------
// 4. commitUploadFile：link 不可用时回退排他创建，绝不被不支持硬链接的盘卡死
// ---------------------------------------------------------------------------
function linkFails(code) {
    return async () => {
        const error = new Error('link unavailable');
        error.code = code;
        throw error;
    };
}

test('commitUploadFile 优先硬链接并清理临时文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wp-commit-link-'));
    try {
        const temp = join(dir, '.upload-a.tmp');
        const target = join(dir, 'dance.webm');
        await writeFile(temp, 'linked-payload');
        const method = await commitUploadFile(temp, target);
        assert.equal(method, 'linked');
        assert.equal(await readFile(target, 'utf8'), 'linked-payload');
        await assert.rejects(lstat(temp), '成功后临时文件应被删除');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('commitUploadFile 在 link 抛 EPERM 时回退为排他复制', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wp-commit-copy-'));
    try {
        const temp = join(dir, '.upload-b.tmp');
        const target = join(dir, 'dance.webm');
        await writeFile(temp, 'copied-payload');
        const method = await commitUploadFile(temp, target, { link: linkFails('EPERM') });
        assert.equal(method, 'copied');
        assert.equal(await readFile(target, 'utf8'), 'copied-payload');
        await assert.rejects(lstat(temp), '回退成功后同样删除临时文件');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('commitUploadFile 在目标已存在时仍返回 EEXIST，不覆盖旧文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wp-commit-exists-'));
    try {
        const temp = join(dir, '.upload-c.tmp');
        const target = join(dir, 'dance.webm');
        await writeFile(temp, 'new-payload');
        await writeFile(target, 'old-payload');
        const warnings = [];
        await assert.rejects(
            commitUploadFile(temp, target, {
                link: linkFails('EPERM'),
                logger: { warn: (message) => warnings.push(message) },
            }),
            (error) => error && error.code === 'EEXIST'
        );
        assert.equal(await readFile(target, 'utf8'), 'old-payload', '目标文件不能被覆盖');
        assert.equal((await lstat(temp)).isFile(), true, '失败时临时文件留给调用方清理');
        assert.deepEqual(warnings, [], '目标已存在是并发冲突，不是回退失败');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('commitUploadFile 的 link 直接返回 EEXIST 时不回退也不告警', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wp-commit-race-'));
    try {
        const temp = join(dir, '.upload-d.tmp');
        const target = join(dir, 'dance.webm');
        await writeFile(temp, 'payload');
        const warnings = [];
        await assert.rejects(
            commitUploadFile(temp, target, {
                link: linkFails('EEXIST'),
                logger: { warn: (message) => warnings.push(message) },
            }),
            (error) => error && error.code === 'EEXIST'
        );
        assert.deepEqual(warnings, [], '目标已存在是并发冲突，不算回退失败');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('commitUploadFile 回退也失败时记录 error.code 的告警且不留半成品', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wp-commit-fail-'));
    try {
        const temp = join(dir, '.upload-e.tmp');
        const target = join(dir, 'missing-dir', 'dance.webm');
        await writeFile(temp, 'payload');
        const warnings = [];
        await assert.rejects(
            commitUploadFile(temp, target, {
                link: linkFails('EOPNOTSUPP'),
                logger: { warn: (message) => warnings.push(message) },
            }),
            (error) => error && error.code === 'ENOENT'
        );
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /ENOENT/);
        await assert.rejects(lstat(target), '失败时不能留下目标文件');
        assert.equal((await lstat(temp)).isFile(), true);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 5. Windows 保留设备名
// ---------------------------------------------------------------------------
test('validateCustomActionFileName 拒绝 Windows 保留设备名', () => {
    for (const name of [
        'con.webm',
        'CON.MP4',
        'prn.webm',
        'aux.mp4',
        'nul.webm',
        'com1.webm',
        'COM9.MP4',
        'lpt1.webm',
        'lpt9.mp4',
        'con.foo.webm',
    ]) {
        assert.equal(validateCustomActionFileName(name), undefined, name + ' 是保留设备名');
    }
    for (const name of ['console.webm', 'com10.webm', 'lpt0.webm', 'con-extra.webm', 'auxiliary.mp4']) {
        assert.ok(validateCustomActionFileName(name), name + ' 不是保留设备名');
    }
});

// ---------------------------------------------------------------------------
// 7. /api/model：会话投影命中 vs 回退 seq 最大会话
// ---------------------------------------------------------------------------
function modelSession({ seq = 1, provider = 'p', model = 'm', origin = 'main', headerConfig } = {}) {
    return {
        seq,
        header: { origin },
        requestHeader() {
            if (headerConfig === undefined) return { config: { provider, model } };
            return headerConfig;
        },
        requestContext() {
            return {};
        },
    };
}

test('/api/model 命中指定 sessionId 时不带 fallback 标记', async () => {
    const target = modelSession({ seq: 1, provider: 'deepseek', model: 'deepseek-chat' });
    const host = createHost({
        settings: { register() {}, describe: () => [] },
        services: {
            sessions: {
                get: (id) => (id === 's-hit' ? target : undefined),
                list: () => [],
            },
        },
    });
    const result = await invokeJson(host.routes.get('/whale-pet/api/model'), {
        url: '/whale-pet/api/model?sessionId=s-hit',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
        ok: true,
        current: { provider: 'deepseek', model: 'deepseek-chat' },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(result.body, 'fallback'), false);
});

test('/api/model 无 sessionId 时回退 seq 最大会话并标记 fallback', async () => {
    const host = createHost({
        settings: { register() {}, describe: () => [] },
        services: {
            sessions: {
                get: () => undefined,
                list: () => [
                    modelSession({ seq: 3, provider: 'provider-a', model: 'model-a' }),
                    modelSession({ seq: 9, provider: 'provider-b', model: 'model-b' }),
                    // subagent 会话即使 seq 最大也不能被当成当前会话
                    modelSession({ seq: 99, provider: 'provider-c', model: 'model-c', origin: 'subagent' }),
                ],
            },
        },
    });
    const result = await invokeJson(host.routes.get('/whale-pet/api/model'), {
        url: '/whale-pet/api/model',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
        ok: true,
        current: { provider: 'provider-b', model: 'model-b' },
        fallback: true,
    });
});

test('/api/model 拒绝非 GET 与跨站来源', async () => {
    const host = createHost({
        settings: { register() {}, describe: () => [] },
        services: { sessions: { get: () => undefined, list: () => [] } },
    });
    const handler = host.routes.get('/whale-pet/api/model');
    const wrongMethod = await invokeJson(handler, { method: 'POST', url: '/whale-pet/api/model' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.body.error, 'method-not-allowed');

    const remote = await invokeJson(handler, {
        url: '/whale-pet/api/model',
        remoteAddress: '192.168.1.9',
    });
    assert.equal(remote.status, 403);
});
