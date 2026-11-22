import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    QUOTA_PROVIDERS,
    classifyQuotaProvider,
    findCodexRateLimits,
    normalizeCodexRateLimits,
    readCodexQuota,
    parseQuotaPayload,
    pickQuotaEntry,
} from '../lib/balance-quota.js';

test('额度来源分类：Codex 本地、OpenCode、GLM 国内/国际', () => {
    assert.equal(classifyQuotaProvider({ route: 'openai-codex' }), 'codex');
    assert.equal(classifyQuotaProvider({ route: 'opencode-go' }), 'opencode-go');
    assert.equal(
        classifyQuotaProvider({ route: 'custom', baseURL: 'https://opencode.ai/zen/go/v1' }),
        'opencode-go'
    );
    assert.equal(
        classifyQuotaProvider({ route: 'zai-coding-cn', baseURL: 'https://open.bigmodel.cn/api/coding' }),
        'glm-cn'
    );
    assert.equal(classifyQuotaProvider({ route: 'zai', baseURL: 'https://api.z.ai/api/coding' }), 'glm-intl');
    assert.equal(classifyQuotaProvider({ route: 'deepseek-account' }), null);
    assert.equal(classifyQuotaProvider({ route: 'unknown', baseURL: 'https://example.com' }), null);
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
    const windows = normalizeCodexRateLimits({
        primary: { used_percent: 42, resets_in_seconds: 3600 },
        secondary: { remaining_percent: 70, resets_at: 1764000000 },
        plan_type: 'plus',
    });
    assert.equal(windows.planType, 'plus');
    assert.equal(windows.windows[0].usedPct, 42);
    assert.ok(windows.windows[0].resetAt > Date.now());
    assert.equal(windows.windows[1].usedPct, 30);
    assert.equal(windows.windows[1].resetAt, 1764000000000);
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
