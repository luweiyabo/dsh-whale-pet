import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';
import {
    balanceErrorCode,
    balanceErrorMessage,
    classifyBalanceSource,
    planKindOf,
    proxyEnvPresence,
} from '../lib/balance-source.js';

function entry(provider, displayName, defaultBaseURL, settingsNs = 'llm-pi-ai') {
    return {
        provider,
        displayName,
        settingsNs,
        settingsPath: ['providers', provider],
        defaultBaseURL,
    };
}

const PROVIDERS = [
    entry('deepseek-account', 'DeepSeek Account', 'https://api.deepseek.com', 'llm-deepseek-account'),
    entry('deepseek-official', 'DeepSeek', 'https://api.deepseek.com', 'llm-deepseek'),
    entry('kimi-coding', 'Kimi Coding', 'https://api.kimi.com/coding/v1'),
    entry('zai', 'GLM Coding', 'https://api.z.ai/api/coding/paas/v4'),
    entry('qwen-token-plan', 'Qwen Token Plan', 'https://token-plan.example/v1'),
    entry('openai-codex', 'ChatGPT Codex', 'https://chatgpt.com/backend-api'),
    entry('moonshotai-cn', 'Kimi', 'https://api.moonshot.cn/v1', 'llm-moonshot'),
    entry('custom-gateway', 'Relay', 'https://relay.example/v1'),
];

function createHost({ balance = {}, credentials = null, providers = PROVIDERS } = {}) {
    const routes = new Map();
    const ctx = {
        settings: {
            register() {},
            get(ns) {
                if (ns === 'whale-pet') return { balance };
                return undefined;
            },
        },
        get(name) {
            if (name === 'llm') return { listConfigurableProviders: () => providers };
            if (name === 'credentials') return credentials;
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

async function invokeJson(handler, url) {
    const req = Readable.from([]);
    req.method = 'GET';
    req.url = url;
    req.headers = {
        host: 'localhost:8123',
        origin: 'http://localhost:8123',
        'sec-fetch-site': 'same-origin',
    };
    req.socket = { remoteAddress: '127.0.0.1' };
    let status;
    let body = '';
    const res = {
        writeHead(nextStatus) {
            status = nextStatus;
        },
        end(chunk = '') {
            body += String(chunk);
        },
    };
    await handler(req, res);
    return { status, body: JSON.parse(body) };
}

test('来源分类：account 先于钱包、coding plan 先于 wallet', () => {
    assert.deepEqual(
        classifyBalanceSource({
            route: 'deepseek-account',
            baseURL: 'https://api.deepseek.com',
        }),
        { source: 'account', provider: 'deepseek', reason: 'account' }
    );
    assert.equal(
        classifyBalanceSource({
            route: 'kimi-coding',
            baseURL: 'https://api.kimi.com/coding/v1',
        }).source,
        'plan'
    );
    assert.equal(classifyBalanceSource({ route: 'zai' }).source, 'plan');
    assert.equal(classifyBalanceSource({ route: 'qwen-token-plan' }).source, 'plan');
    assert.equal(classifyBalanceSource({ route: 'openai-codex' }).source, 'plan');
    assert.equal(classifyBalanceSource({ route: 'github-copilot' }).source, 'plan');
    assert.equal(
        classifyBalanceSource({ route: 'relay', baseURL: 'https://relay.example/coding/v1' }).source,
        'plan'
    );
});

test('钱包只认已验证 origin；未知自定义 baseURL 不猜', () => {
    assert.deepEqual(
        classifyBalanceSource({
            route: 'deepseek-official',
            baseURL: 'https://api.deepseek.com',
        }).source,
        'wallet'
    );
    assert.equal(classifyBalanceSource({ route: 'deepseek-official', baseURL: '' }).source, 'wallet');
    assert.equal(
        classifyBalanceSource({ route: 'moonshotai-cn', baseURL: 'https://api.moonshot.cn/v1' }).source,
        'wallet'
    );
    assert.equal(
        classifyBalanceSource({ route: 'moonshotai', baseURL: 'https://api.moonshot.ai/v1' }).source,
        'unsupported'
    );
    assert.equal(
        classifyBalanceSource({
            route: 'deepseek-official',
            baseURL: 'https://api.moonshot.cn/v1',
        }).source,
        'unsupported',
        '已知钱包路由不能把 key 发去另一个服务商'
    );
    assert.equal(
        classifyBalanceSource({ route: 'relay', baseURL: 'https://relay.example/v1' }).source,
        'unsupported'
    );
    assert.equal(classifyBalanceSource({ route: 'kimi' }).source, 'unsupported');
});

test('planKind 与错误码/代理变量只返回稳定摘要', () => {
    assert.equal(planKindOf('qwen-token-plan', ''), 'token-plan');
    assert.equal(planKindOf('openai-codex', ''), 'subscription');
    assert.equal(planKindOf('kimi-coding', ''), 'coding-plan');
    assert.equal(balanceErrorCode({ name: 'TimeoutError' }), 'timeout');
    assert.equal(balanceErrorCode({ cause: { code: 'ECONNREFUSED' } }), 'network');
    assert.equal(balanceErrorCode({ cause: { code: 'CERT_HAS_EXPIRED' } }), 'tls');
    assert.equal(balanceErrorCode(new Error('x')), 'protocol');
    assert.ok(balanceErrorMessage('timeout').includes('超时'));
    const env = {
        HTTPS_PROXY: 'http://user:secret@proxy:8080',
        http_proxy: '',
    };
    assert.deepEqual(proxyEnvPresence(env), {
        http: false,
        https: true,
        all: false,
        noProxy: false,
    });
    assert.equal(JSON.stringify(proxyEnvPresence(env)).includes('secret'), false);
});

test('meta 分类不解析凭据：account / plan / wallet 未授权', async () => {
    const calls = [];
    const credentials = {
        resolve(ref) {
            calls.push(ref);
            return Promise.resolve(undefined);
        },
    };
    const routes = createHost({
        balance: { allowApiKey: false },
        credentials,
    });
    const handler = routes.get('/whale-pet/api/balance');

    const account = await invokeJson(
        handler,
        '/whale-pet/api/balance?mode=meta&route=deepseek-account&model=deepseek-flash'
    );
    assert.equal(account.status, 200);
    assert.equal(account.body.source, 'account');
    assert.equal(account.body.requiresConsent, false);

    const plan = await invokeJson(
        handler,
        '/whale-pet/api/balance?mode=meta&route=kimi-coding&model=kimi-k2'
    );
    assert.equal(plan.body.source, 'plan');
    assert.equal(plan.body.planKind, 'coding-plan');

    const wallet = await invokeJson(
        handler,
        '/whale-pet/api/balance?mode=meta&route=deepseek-official&model=deepseek-chat'
    );
    assert.equal(wallet.body.source, 'wallet');
    assert.equal(wallet.body.requiresConsent, true);

    const data = await invokeJson(
        handler,
        '/whale-pet/api/balance?route=deepseek-official&model=deepseek-chat'
    );
    assert.equal(data.status, 200);
    assert.equal(data.body.status, 'consent-required');
    assert.deepEqual(calls, [], 'meta 和未授权数据请求都不能碰 credentials.resolve');
});

test('account/plan 数据端点不进入 key 分支，未知路由明确 unsupported', async () => {
    const calls = [];
    const routes = createHost({
        balance: { allowApiKey: true },
        credentials: {
            resolve(ref) {
                calls.push(ref);
                return Promise.resolve(undefined);
            },
        },
    });
    const handler = routes.get('/whale-pet/api/balance');

    const account = await invokeJson(
        handler,
        '/whale-pet/api/balance?route=deepseek-account&model=deepseek-flash'
    );
    assert.equal(account.body.status, 'use-account-remote');
    assert.equal(account.body.ok, false);

    const plan = await invokeJson(handler, '/whale-pet/api/balance?route=openai-codex&model=gpt-5');
    assert.equal(plan.body.status, 'plan');
    assert.equal(plan.body.ok, false);

    const unknown = await invokeJson(handler, '/whale-pet/api/balance?route=relay&model=x');
    assert.equal(unknown.body.status, 'unsupported');
    assert.equal(unknown.body.unsupported, true);
    assert.deepEqual(calls, []);
});

test('钱包已授权时才会进入 credentials.resolve', async () => {
    const calls = [];
    const routes = createHost({
        balance: { allowApiKey: true },
        credentials: {
            resolve(ref) {
                calls.push(ref);
                return Promise.resolve(undefined);
            },
        },
    });
    const handler = routes.get('/whale-pet/api/balance');
    const result = await invokeJson(
        handler,
        '/whale-pet/api/balance?route=deepseek-official&model=deepseek-chat'
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.source, 'wallet');
    assert.equal(result.body.status, 'error');
    assert.equal(result.body.errorCode, 'missing-key');
    assert.ok(calls.length > 0, '授权后才解析 key');
});
