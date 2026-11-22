import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    QUOTA_PROVIDERS,
    classifyQuotaProvider,
    fetchQuota,
    findCodexRateLimits,
    normalizeCodexRateLimits,
    parseQuotaPayload,
    pickQuotaEntry,
    quotaKeyRefs,
    readCodexQuota,
} from '../lib/balance-quota.js';

test('额度来源分类：Codex 本地、OpenCode、GLM 国内/国际', () => {
    // baseURL 为空时才允许按 route id 精确映射。
    assert.equal(classifyQuotaProvider({ route: 'openai-codex' }), 'codex');
    assert.equal(classifyQuotaProvider({ route: 'opencode-go' }), 'opencode-go');
    assert.equal(classifyQuotaProvider({ route: 'opencode' }), 'opencode-go');
    assert.equal(classifyQuotaProvider({ route: 'zai' }), 'glm-intl');
    assert.equal(classifyQuotaProvider({ route: 'zai-coding-cn' }), 'glm-cn');
    assert.equal(classifyQuotaProvider({ route: 'zhipu' }), 'glm-cn');
    // 官方 defaultBaseURL / 官方主机：按 host 识别。
    assert.equal(
        classifyQuotaProvider({ route: 'zai-coding-cn', baseURL: 'https://open.bigmodel.cn/api/coding' }),
        'glm-cn'
    );
    assert.equal(classifyQuotaProvider({ route: 'zai', baseURL: 'https://api.z.ai/api/coding' }), 'glm-intl');
    assert.equal(
        classifyQuotaProvider({ route: 'openai-codex', baseURL: 'https://chatgpt.com/backend-api' }),
        'codex'
    );
    assert.equal(
        classifyQuotaProvider({ route: 'custom', baseURL: 'https://opencode.ai/zen/go/v1' }),
        'opencode-go'
    );
    assert.equal(classifyQuotaProvider({ route: 'deepseek-account' }), null);
    assert.equal(classifyQuotaProvider({ route: 'unknown', baseURL: 'https://example.com' }), null);
});

test('自定义中转站 baseURL 不按路由把 key 发去官方端点', () => {
    const relay = 'https://relay.example/v1';
    for (const route of ['zai', 'zai-coding-cn', 'zhipu', 'opencode-go', 'opencode', 'openai-codex']) {
        assert.equal(classifyQuotaProvider({ route, baseURL: relay }), null, route);
    }
    assert.equal(classifyQuotaProvider({ route: 'zai', baseURL: 'not a url' }), null, '非法 URL 不可用');
    assert.equal(
        classifyQuotaProvider({
            route: 'zai-coding-cn',
            baseURL: 'https://open.bigmodel.cn.evil.example/v1',
        }),
        null,
        '后缀伪装的主机不可用'
    );
});

test('额度凭据引用：profile 最优先，fallback 使用 DSH 真实 env 名', () => {
    // DSH 0.2.2-rc.5 PROVIDER_DATA：zai → ZAI_API_KEY，zai-coding-cn →
    // ZAI_CODING_CN_API_KEY，opencode/opencode-go → OPENCODE_API_KEY。
    assert.deepEqual(quotaKeyRefs('glm-intl', {}), ['ZAI_API_KEY']);
    assert.deepEqual(quotaKeyRefs('glm-cn', {}), ['ZAI_CODING_CN_API_KEY']);
    assert.deepEqual(quotaKeyRefs('opencode-go', {}), ['OPENCODE_API_KEY']);
    // 注册表 nativeAuth.env 与固定 fallback 去重，profile.apiKeyEnv 仍排第一。
    assert.deepEqual(
        quotaKeyRefs('glm-cn', {
            apiKeyEnv: 'MY_ZAI_KEY',
            nativeEnv: ['ZAI_CODING_CN_API_KEY', 'MY_ZAI_KEY'],
        }),
        ['MY_ZAI_KEY', 'ZAI_CODING_CN_API_KEY']
    );
    assert.deepEqual(
        quotaKeyRefs('glm-intl', { apiKeyEnv: ' ', nativeEnv: ['BAD-NAME', 42, 'ZAI_API_KEY'] }),
        ['ZAI_API_KEY'],
        '非法/空引用被忽略'
    );
    assert.deepEqual(quotaKeyRefs('unknown-provider', { apiKeyEnv: 'X_API_KEY' }), ['X_API_KEY']);
});

test('OpenCode Go 解析 rolling / weekly / monthly 三个窗口', () => {
    const body = {
        usage: {
            rolling: { percent: 62.4, resetsAt: '2026-11-22T12:00:00Z' },
            weekly: { percent: 31, resetsAt: 1764000000 },
            monthly: { percent: 18 },
        },
    };
    const windows = parseQuotaPayload('opencode-go', body);
    assert.deepEqual(
        windows.map((item) => [item.key, item.label, item.usedPct]),
        [
            ['rolling', '5h', 62.4],
            ['weekly', '周', 31],
            ['monthly', '月', 18],
        ]
    );
    assert.equal(windows[0].resetAt, Date.parse('2026-11-22T12:00:00Z'));
    assert.equal(windows[1].resetAt, 1764000000000);
});

test('GLM 国内/国际按 type+unit 选 5h 与周窗口，不依赖数组顺序', () => {
    const body = {
        data: {
            limits: [
                { type: 'TIME_LIMIT', unit: 3, percentage: 99 },
                { type: 'TOKENS_LIMIT', unit: 6, percentage: 27, nextResetTime: 1764000000000 },
                { type: 'TOKENS_LIMIT', unit: 3, percentage: 64, nextResetTime: '2026-11-22T18:00:00Z' },
            ],
        },
    };
    for (const provider of ['glm-cn', 'glm-intl']) {
        const windows = parseQuotaPayload(provider, body);
        assert.deepEqual(
            windows.map((item) => [item.key, item.usedPct]),
            [
                ['rolling', 64],
                ['weekly', 27],
            ],
            provider
        );
    }
    assert.equal(
        pickQuotaEntry(body, { list: 'data.limits', types: ['TOKENS_LIMIT'], unit: 6 }).percentage,
        27
    );
});

test('Codex rate_limits 字段容错：used/remaining/reset 秒与绝对时间', () => {
    const nowMs = Date.now();
    const futureSeconds = Math.floor((nowMs + 86_400_000) / 1000);
    const windows = normalizeCodexRateLimits(
        {
            primary: { used_percent: 42, resets_in_seconds: 3600 },
            secondary: { remaining_percent: 70, resets_at: futureSeconds },
            plan_type: 'plus',
        },
        { nowMs }
    );
    assert.equal(windows.planType, 'plus');
    assert.equal(windows.windows[0].usedPct, 42);
    assert.equal(windows.windows[0].resetAt, nowMs + 3_600_000, '相对秒数按采样时刻换算');
    assert.equal(windows.windows[1].usedPct, 30);
    assert.equal(windows.windows[1].resetAt, futureSeconds * 1000);
});

test('Codex 旧日志的 resetAt 已过期时置空，不显示假倒计时', () => {
    const now = Date.now();
    const stale = normalizeCodexRateLimits(
        {
            primary: { used_percent: 42, resets_in_seconds: 60 },
            secondary: { used_percent: 10, resets_at: Math.floor((now - 3_600_000) / 1000) },
        },
        { nowMs: now - 2 * 3_600_000 }
    );
    assert.equal(stale.windows[0].usedPct, 42);
    assert.equal(stale.windows[0].resetAt, null, '两小时前的日志里 60 秒的 reset 已过期');
    assert.equal(stale.windows[1].resetAt, null, '绝对 reset 时间已过期');
    // 采样时刻很新时仍保留 reset。
    const fresh = normalizeCodexRateLimits({ primary: { used_percent: 5, resets_in_seconds: 600 } });
    assert.ok(fresh.windows[0].resetAt > Date.now());
});

test('从 Codex JSONL 末尾取最新非空 rate_limits', () => {
    const text = [
        JSON.stringify({ type: 'event', payload: { rate_limits: null } }),
        JSON.stringify({
            type: 'event',
            payload: { rate_limits: { primary: { used_percent: 10, resets_in_seconds: 60 } } },
        }),
        JSON.stringify({ type: 'event', payload: {} }),
    ].join('\n');
    const rl = findCodexRateLimits(text);
    assert.equal(rl.primary.used_percent, 10);
    assert.equal(findCodexRateLimits('not json\n{}'), null);
});

test('Codex 本地日志目录：读取最新 rate_limits，不联网', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-codex-'));
    const dir = join(root, 'sessions', '2026', '11', '22');
    await mkdir(dir, { recursive: true });
    await writeFile(
        join(dir, 'rollout-test.jsonl'),
        [
            JSON.stringify({ type: 'event' }),
            JSON.stringify({
                type: 'event',
                payload: {
                    rate_limits: {
                        primary: { used_percent: 55, resets_in_seconds: 120 },
                        secondary: { used_percent: 20 },
                    },
                },
            }),
        ].join('\n')
    );
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
        const result = await readCodexQuota();
        assert.equal(result.ok, true);
        assert.equal(result.windows[0].usedPct, 55);
        assert.equal(result.windows[1].usedPct, 20);
    } finally {
        if (previous === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previous;
        await rm(root, { recursive: true, force: true });
    }
});

test('Codex 日志文件 mtime 很旧时丢弃已过期的 reset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-codex-stale-'));
    const dir = join(root, 'sessions', '2026', '11', '22');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'rollout-stale.jsonl');
    await writeFile(
        file,
        JSON.stringify({
            type: 'event',
            payload: { rate_limits: { primary: { used_percent: 42, resets_in_seconds: 60 } } },
        })
    );
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(file, old, old);
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
        const result = await readCodexQuota();
        assert.equal(result.ok, true);
        assert.equal(result.windows[0].usedPct, 42);
        assert.equal(result.windows[0].resetAt, null);
    } finally {
        if (previous === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previous;
        await rm(root, { recursive: true, force: true });
    }
});

test('额度接口先按 HTTP 状态分类错误，非 JSON 正文不抛解析异常', async () => {
    const original = globalThis.fetch;
    const respond =
        (status, body, throwJson = false) =>
        async () => ({
            status,
            ok: status >= 200 && status < 300,
            json: async () => {
                if (throwJson) throw new SyntaxError('Unexpected token <');
                return body;
            },
        });
    try {
        globalThis.fetch = respond(401, null, true);
        await assert.rejects(fetchQuota('glm-cn', 'sk-test'), (e) => e.code === 'auth', 'HTML 401 仍是 auth');
        globalThis.fetch = respond(403, {});
        await assert.rejects(fetchQuota('glm-intl', 'sk-test'), (e) => e.code === 'auth');
        globalThis.fetch = respond(402, {});
        await assert.rejects(fetchQuota('glm-cn', 'sk-test'), (e) => e.code === 'quota');
        globalThis.fetch = respond(500, null, true);
        await assert.rejects(fetchQuota('opencode-go', 'sk-test'), (e) => e.code === 'upstream');
        globalThis.fetch = respond(200, null, true);
        await assert.rejects(fetchQuota('opencode-go', 'sk-test'), (e) => e.code === 'protocol');
        globalThis.fetch = respond(200, { usage: { rolling: { percent: 10 } } });
        const result = await fetchQuota('opencode-go', 'sk-test');
        assert.equal(result.windows[0].usedPct, 10);
    } finally {
        globalThis.fetch = original;
    }
});

test('所有额度厂商都有固定端点和至少一个窗口定义', () => {
    for (const [id, def] of Object.entries(QUOTA_PROVIDERS)) {
        assert.equal(def.id, id);
        assert.ok(def.label);
        assert.ok(Array.isArray(def.windows) && def.windows.length > 0);
        if (def.kind === 'http') {
            assert.match(def.url, /^https:\/\//);
            assert.ok(Array.isArray(def.refs) && def.refs.length > 0);
        }
    }
});
