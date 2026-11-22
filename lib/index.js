/**
 * ============================================================================
 * dsh-whale-pet 宿主半侧（host half）—— 桌宠插件的"后端"部分
 * ============================================================================
 *
 * 【职责】
 *   运行在 DSH 的 Node 服务端。唯一职责：在 DSH 的 Web 服务器上注册一个
 *   `/whale-pet/` 前缀的 HTTP 路由，把插件包内 assets/thumb/ 下的动画 WebM
 *   文件流式返回给浏览器。
 *
 * 【为什么需要它】
 *   DSH 的 `/plugins/` 路由只服务"客户端 JS bundle"，不服务视频等静态资源，
 *   所以浏览器半侧（lib/client.js）要播放动画，必须有一个专门的路由来取文件。
 *   这是 DSH 官方提供的扩展点：ctx.webServer.register()。
 *
 * 【路由结构】
 *   /whale-pet/<动画名>.webm  → 读插件包内 assets/thumb/（640×360 播放变体）
 *   动画名是 URL 编码后的（中文文件名），服务端解码后按名找文件。
 *
 * 【安全性】
 *   路径做"防穿越"校验（resolveAsset）：请求路径规范化后必须仍落在资源根
 *   目录内，否则返回 400。防止 /whale-pet/../../etc/passwd 这类攻击。
 *   文件一律 lstat 校验为常规文件（目录/符号链接 404，防 custom 目录内
 *   symlink 逃逸）；JSON API 经 isAllowedApiRequest 校验 TCP 回环对端与同源
 *   请求（防局域网未授权访问、恶意网页跨站读取与 DNS rebinding）；所有响应
 *   带 X-Content-Type-Options: nosniff。
 *
 * ============================================================================
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBalanceProvider, parseProviderBalances } from './balance-providers.js';
import {
    QUOTA_CACHE_MS,
    QUOTA_ERROR_CACHE_MS,
    QUOTA_PROVIDERS,
    classifyQuotaProvider,
    fetchQuota,
    quotaKeyRefs,
    readCodexQuota,
} from './balance-quota.js';
import {
    balanceErrorMessage,
    balanceErrorCode,
    classifyBalanceSource,
    proxyEnvPresence,
} from './balance-source.js';
// 官方 API：设置命名空间 schema（schemastery，zod 兼容）
import z from '@deepseek-ai/schemastery';

/** 插件行 id（与 cordis.patch.yml 一致） */
const name = 'whale-pet';
/**
 * 需要注入的服务：
 * - webServer：Web 服务器路由注册表（资源路由）
 * - llm：当前 provider 路由到其设置命名空间的注册表
 * - settings：设置命名空间注册。硬依赖注入——loader 会等 settings 服务
 *   ready（fiber state 2）后再执行本行 apply，保证 apply 时可直接注册；
 *   用 ctx.get('settings') 软获取在服务 init 完成前返回 undefined（时序
 *   问题），用 ctx.inject 延迟注册亦不可靠，硬依赖是官方 loader 语义。
 */
const inject = ['webServer', 'settings', 'llm'];

/** 设置命名空间：持久化在 $DSH_HOME/settings.yaml 的 whale-pet 段 */
export const SETTINGS_NS = 'whale-pet';

// ---- 设置 schema 默认值（英文 id，与浏览器侧 ANIMS 清单一致） ----
const ACT_NAMES = [
    'maid_curtsy',
    'big_stretch',
    'gentle_spin',
    'sleepy_yawn',
    'quick_nap',
    'startled_awake',
    'morning_brushing',
    'mirror_check',
    'outfit_color_try_on',
    'taking_notes',
    'coding',
    'deep_thought',
    'solving_a_rubiks_cube',
    'playing_with_a_toy_car',
    'gaming_rage',
    'water_gun_play',
    'rocking_horse',
    'kicking_a_shuttlecock',
    'spinning_a_top',
    'playing_gomoku',
    'playground_swing',
    'carefree_humming',
    'playing_the_violin',
    'elegant_maid_dance',
    'light_sway_dance',
    'cute_otaku_dance',
    'playing_the_flute',
    'eating_snacks',
    'caught_snacking',
    'eating_rice',
    'eating_breakfast',
    'eating_lunch',
    'eating_dinner',
    'melting_ice_cream',
    'eating_watermelon',
    'eating_hotpot',
    'eating_hairy_crab',
    'eating_candied_haw',
    'eating_longevity_noodles',
    'moon_festival',
    'setting_off_fireworks',
    'opening_a_gift',
    'eating_zongzi',
    'eating_tangyuan',
    'eating_dumplings',
    'eating_qingtuan',
    'eating_laba_congee',
    'eating_rice_cake',
    'eating_chongyang_cake',
    'receiving_a_red_envelope',
    'lion_dance',
    'writing_the_fu_character',
    'qixi_needlework',
    'decorating_a_christmas_tree',
    'halloween_trick_or_treat',
    'chongyang_chrysanthemums',
    'releasing_a_river_lantern',
    'cute_little_ghost',
    'releasing_a_sky_lantern',
    'building_a_snowman',
    'cooling_with_a_hand_fan',
    'buried_in_autumn_leaves',
    'flying_a_kite',
    'dove_magic',
    'flower_conjuring',
    'card_magic',
    'inflating_a_balloon',
    'animal_parade',
    'three_ball_juggling',
    'butterflies_and_blossoms',
    'petting_a_cat',
    'jump_and_smash',
    'whale_bubbles',
    'blue_whale_appears',
    'whale_tail_slap',
    'desk_tap',
    'gravity_squash',
    'jump_scare',
    'eating_tokens',
    'yeah_what_should_we_eat',
];
const CLICK_NAMES = ['happy_hop', 'shy_surprise', 'tsundere_pout', 'ticklish_giggle', 'cheerful_wave'];

/**
 * 构造 whale-pet 设置命名空间的 schema（含默认值）。
 * @param zz - schemastery 实例（注入便于测试）
 */
export function buildSettingsSchema(zz = z) {
    return zz.object({
        visible: zz.boolean().default(true), // 桌宠显示开关
        bubbles: zz.boolean().default(true), // 文字气泡开关
        meter: zz.boolean().default(false), // 账户余额气泡开关
        fx: zz.boolean().default(true), // 交互动效增强（倾斜跟随/呼吸/弹跳/拖拽形变）
        size: zz.number().min(220).max(900).default(462), // 舞台宽度 px
        position: zz
            .union([
                zz.const('bottom-right'),
                zz.const('bottom-left'),
                zz.const('top-right'),
                zz.const('top-left'),
            ])
            .default('bottom-right'),
        scope: zz.union([zz.const('current'), zz.const('any')]).default('current'), // 感知范围
        // 拖拽后的自由位置（视口比例 0-1；-1 = 未设置 → 回落到 position 角落）
        posX: zz.number().min(-1).max(1).default(-1),
        posY: zz.number().min(-1).max(1).default(-1),
        // 日历感知：节日/季节动画只在应景时间出现在随机动作池。
        // 客户端已改为常开（配置页不再暴露开关），这三个字段保留用于兼容旧配置。
        calendar: zz.object({
            enabled: zz.boolean().default(true),
            festival: zz.boolean().default(true),
            seasonal: zz.boolean().default(true),
        }),
        // 回合完成提示：单一总开关（细分粒度已下线，旧配置的 done/error/waiting/
        // system/sound 单键由客户端兼容读取一次，保存后即被整合成 enabled）。
        notify: zz.object({
            enabled: zz.boolean().default(true), // 回合结束/失败/待确认时提示
        }),
        // 余额提示：来源分层 + 低余额阈值 + API-key 授权。
        // 设置页不再暴露 allowApiKey，但配置文件仍可覆盖；默认 true。
        balance: zz.object({
            // 0.3 起设置页只暴露「低余额提醒」开关；其余字段不再显示，但仍保留
            // 在配置文件里，便于手动改 cordis.patch.yml / settings.yaml 后重启生效。
            alert: zz.boolean().default(true),
            thresholds: zz.object({
                CNY: zz.number().min(0).max(1e9).default(5),
                USD: zz.number().min(0).max(1e9).default(1),
            }),
            refreshMs: zz
                .union([zz.const(30000), zz.const(60000), zz.const(300000), zz.const(0)])
                .default(60000),
            turnRefresh: zz.boolean().default(true),
            allowApiKey: zz.boolean().default(true),
            timeoutMs: zz.number().min(3000).max(60000).default(12000),
            // 设置页不暴露，但可在配置文件里手改：周/月额度剩余百分比提醒阈值。
            quotaAlert: zz.object({
                weeklyPct: zz.number().min(0).max(100).default(5),
                monthlyPct: zz.number().min(0).max(100).default(5),
            }),
        }),
        behavior: zz.object({
            idleProb: zz.number().min(0).max(1).default(0.3),
            turnProb: zz.number().min(0).max(1).default(0.1),
            actProb: zz.number().min(0).max(1).default(0.4),
            moveProb: zz.number().min(0).max(1).default(0.2),
            debounceMs: zz.number().min(0).max(5000).default(500),
            lingerMs: zz.number().min(0).max(10000).default(1500),
            errorHoldMs: zz.number().min(0).max(15000).default(3000),
        }),
        intents: zz.object({
            working: zz.array(zz.string()).default(['eating_tokens']),
            coding: zz.array(zz.string()).default(['coding']),
            reading: zz.array(zz.string()).default(['taking_notes']),
            researching: zz.array(zz.string()).default(['taking_notes']),
            thinking: zz.array(zz.string()).default(['deep_thought']),
            waitingUser: zz.array(zz.string()).default(['looking_around']),
            listening: zz.array(zz.string()).default(['attentive_listening']),
            error: zz.array(zz.string()).default(['jump_scare']),
        }),
        pools: zz.object({
            acts: zz.array(zz.string()).default(ACT_NAMES),
            moves: zz.array(zz.string()).default(['crab_walk', 'floating_steps', 'running_trip']),
            clicks: zz.array(zz.string()).default(CLICK_NAMES),
        }),
        // 触发规则：事件帧匹配 → 播放动作池。声明式条件（field/op/value），
        // 求值全部在浏览器侧（纯函数 matchRules）；宿主只负责持久化。
        // 字段级钳制（优先级 0-9、冷却 1s-1h）由 schema min/max 强制；
        // 语义校验（op 白名单、regex 可编译）由客户端 normalizeRules 兜底。
        // 字符串长度上限与客户端 normalizeRule 的截断值对齐（防绕过 UI 写入
        // 超长 regex/name 落盘）。
        rules: zz
            .array(
                zz.object({
                    id: zz.string().max(64).required(),
                    enable: zz.boolean().default(true),
                    name: zz.string().max(64).default(''),
                    when: zz
                        .array(
                            zz.object({
                                field: zz.string().max(128).required(),
                                op: zz.string().max(16).required(),
                                value: zz.string().max(256).default(''),
                            })
                        )
                        .default([]),
                    priority: zz.number().min(0).max(9).default(3),
                    cooldownMs: zz.number().min(1000).max(3600000).default(30000),
                    holdMs: zz.number().min(0).max(60000).default(3000),
                    actions: zz.array(zz.string().max(64)).default([]),
                    bubble: zz.string().max(50).default(''),
                })
            )
            .default([]),
    });
}

/**
 * 插件 Config schema。0.2.0 起设置命名空间由「静态 Config + loader 条目 id
 * （cordis.patch.yml 的 id: whale-pet）」派生；根节点 .volatile() 让整份配置
 * 作为单一实时可编辑单元（applies: live）。0.1.x 仍走 ctx.settings.register。
 */
const Config = buildSettingsSchema().volatile();

/** 本包根目录（import.meta.url 指向 lib/，上一级即包根） */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** 动画资源根目录：assets/thumb/ */
const ASSET_ROOT = join(PACKAGE_ROOT, 'assets', 'thumb');
/** 路由前缀：/whale-pet/<分类>/<英文 id>.webm */
const ROUTE_PREFIX = '/whale-pet';

// ============================================================================
// 资源层：用户自定义动作目录
// ============================================================================
// 目录约定：$DSH_HOME/whale-pet/actions/<动作名>.webm|mp4
// 用户把自备动画（640×360 画布、脚底 y=330 的透明视频，与内置动作同规格）
// 放进该目录，即可在设置卡片中选入动作池/意图映射。
// 目录不存在时启动即创建（失败忽略，扫描按空处理）。

/**
 * 解析 DSH 主目录：$DSH_HOME 优先（空白视为未设置，与官方 dsh-home-paths
 * 语义一致），缺省 ~/.dsh。每次调用时读取环境变量（DSH_HOME 允许在模块
 * 导入后才被启动器设置，不能在模块加载期固化）。
 */
export function resolveDshHomeDir() {
    const fromEnv = process.env.DSH_HOME;
    const base = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh');
    return resolve(base);
}

/**
 * 用户自定义动作目录（绝对路径）。惰性解析（见 resolveDshHomeDir）。
 */
export function customActionsDir() {
    return join(resolveDshHomeDir(), 'whale-pet', 'actions');
}

/**
 * 扫描自定义动作目录（导出便于测试）。
 * 只收形如 <id>.webm / <id>.mp4 的普通文件（id 任意非空、不含路径分隔符），
 * 返回按 id 排序的动作清单（含大小/修改时间元数据）；目录不存在/不可读 → []。
 * @param {string} [dir] - 要扫描的目录（默认用户自定义动作目录）
 * @returns {Promise<Array<{id: string, ext: string, file: string, size: number, mtime: number}>>}
 */
export async function scanCustomActions(dir) {
    if (dir === undefined) dir = customActionsDir();
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return []; // 目录不存在/不可读：视为空
    }
    const out = [];
    for (const ent of entries) {
        if (!ent.isFile()) continue;
        const m = /^(.+)\.(webm|mp4)$/i.exec(ent.name);
        if (!m) continue;
        const id = m[1];
        if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\') || id.includes('\0'))
            continue;
        let size = 0;
        let mtime = 0;
        try {
            const st = await stat(join(dir, ent.name));
            size = st.size;
            mtime = Math.round(st.mtimeMs);
        } catch {
            /* 统计失败：元数据置零，文件仍列出 */
        }
        out.push({ id, ext: m[2].toLowerCase(), file: ent.name, size, mtime, category: 'custom' });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
}

/** 校验上传动作文件名；只允许安全的 WebM/MP4 文件名。 */
export function validateCustomActionFileName(name) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 96) return undefined;
    for (let i = 0; i < name.length; i += 1) {
        const code = name.charCodeAt(i);
        // 控制字符 + 路径分隔符（/ \）+ Windows 保留字符（" * : < > ? |）
        if (
            code < 32 ||
            code === 47 ||
            code === 92 ||
            code === 34 ||
            code === 42 ||
            code === 58 ||
            code === 60 ||
            code === 62 ||
            code === 63 ||
            code === 124
        )
            return undefined;
    }
    const dot = name.lastIndexOf('.');
    const id = dot > 0 ? name.slice(0, dot) : '';
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!id || id.length > 80 || id === '.' || id === '..' || id.startsWith('.upload-')) return undefined;
    if (ext !== 'webm' && ext !== 'mp4') return undefined;
    return { id, ext, file: id + '.' + ext, category: 'custom' };
}

/** 扩展名 → Content-Type 映射 */
const MIME = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

/**
 * Host 是否为回环名或 IP 字面量（可带端口）。
 * DNS 域名（可被 rebinding：先解析到攻击者、再解析到 127.0.0.1）一律不算。
 */
function isLoopbackOrIpLiteralHost(host) {
    let h = host;
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        if (end === -1) return false;
        h = h.slice(1, end); // IPv6 字面量：[::1]:port → ::1
    } else {
        const colon = h.lastIndexOf(':');
        if (colon !== -1) h = h.slice(0, colon); // 去端口
    }
    if (h === '') return false;
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 字面量（含 127.0.0.0/8）
    return h.includes(':'); // 去括号后的 IPv6 字面量
}

/** TCP 对端必须是真正的回环地址；Host 头本身可被远程客户端伪造。 */
function isLoopbackRemoteAddress(address) {
    if (typeof address !== 'string') return false;
    const value = address.toLowerCase().split('%')[0];
    return (
        value === '::1' ||
        value === '0:0:0:0:0:0:0:1' ||
        value.startsWith('127.') ||
        value.startsWith('::ffff:127.') ||
        value.startsWith('0:0:0:0:0:ffff:127.')
    );
}

/**
 * API 请求同源守卫：宿主 webServer 不带鉴权/Origin 校验，插件的 JSON API
 * 需自守，拦截恶意网页的跨站读取（drive-by）与 DNS rebinding：
 *   1. TCP 对端必须是回环地址，不能只信可伪造的 Host 头
 *   2. sec-fetch-site 标记 cross-site / same-site → 拒绝（Fetch Metadata；
 *      same-site 也是跨端口跨源，同样拒绝）
 *   3. Host 必须是回环名或 IP 字面量 → 拒绝（DNS rebinding 场景下 origin
 *      与 host 文本一致、sec-fetch-site 也为 same-origin，唯有 Host 字面量
 *      校验可拦截——域名可重解析，IP 字面量不会经过 DNS）
 *   4. 带 Origin 头时必须与 Host 同 host（旧浏览器跨站防线；Origin: null
 *      或不可解析 → 拒绝）
 * 非浏览器客户端（Electron IPC 桥、curl）无 Origin/Fetch Metadata 头，
 * Host 为回环或 IP 字面量即放行。代价：以非回环域名访问 DSH 的部署
 * （如 http://mypc.local:port）将用不了本插件 API（动画播放不受影响）。
 * @param {import('node:http').IncomingMessage} req
 */
export function isAllowedApiRequest(req) {
    const headers = (req && req.headers) || {};
    const remoteAddress = req && req.socket && req.socket.remoteAddress;
    if (!isLoopbackRemoteAddress(remoteAddress)) return false;
    const site = headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return false;
    const host = headers.host;
    if (typeof host !== 'string' || !isLoopbackOrIpLiteralHost(host)) return false;
    const origin = headers.origin;
    if (origin === undefined) return true; // 非浏览器客户端（Electron IPC / curl）
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

/**
 * 规范化并校验请求路径，确保它仍落在资源根目录内（防路径穿越）。
 * @param root - 资源根目录（绝对路径）
 * @param rel  - 解码后的、路由前缀之后的路径片段
 * @returns 规范化后的绝对文件路径；非法（穿越）时返回 undefined
 */
function resolveAsset(root, rel) {
    if (!rel || rel.length === 0) return undefined;
    const candidate = normalize(join(root, rel));
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
    return candidate;
}

/**
 * 解析单段 Range 请求头（仅 bytes 单位）。
 *
 * 为什么需要：Safari 内核在缺少 206/字节范围支持时会拒绝或整包下载媒体，
 * Chromium 对未缓冲区域 seek（甩出动画定位到第 2 秒）也会退化为整包重下。
 *
 * 多段 Range（`bytes=0-1,5-6`）不做支持：按无 Range 处理返回整包 200，
 * 符合 RFC 9110 允许服务器忽略 Range 的语义，也避免 multipart/byteranges。
 *
 * @param {string|undefined} header - Range 头原文
 * @param {number} size - 资源总字节数
 * @returns {{start: number, end: number} | null | 'unsatisfiable'}
 *   null = 无 Range 或语法不可用（按整包 200 返回）；'unsatisfiable' = 范围越界（416）
 */
export function parseRangeHeader(header, size) {
    if (typeof header !== 'string' || !Number.isFinite(size) || size <= 0) return null;
    // 多段 Range、非 bytes 单位、无法解析的写法：忽略（整包返回）
    const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
    if (!m) return null;
    const rawStart = m[1];
    const rawEnd = m[2];
    if (rawStart === '' && rawEnd === '') return null;
    let start;
    let end;
    if (rawStart === '') {
        // 后缀范围：bytes=-N 表示最后 N 字节
        const suffix = Number(rawEnd);
        if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(rawStart);
        end = rawEnd === '' ? size - 1 : Number(rawEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (start > end) return 'unsatisfiable';
        if (start >= size) return 'unsatisfiable';
        if (end >= size) end = size - 1;
    }
    return { start, end };
}

// 余额查询的缓存时长：成功 30 s；失败也要缓存（客户端失败后会按退避重试，
// 若宿主每次都打上游，未配 key / 上游 401 / 断网时会变成持续外呼）。
const BALANCE_CACHE_MS = 30_000;
const BALANCE_ERROR_CACHE_MS = 15_000;
// 强制刷新只缩短成功缓存到 3s；失败缓存仍按 15s，避免未配 key/401 时持续外呼。
const BALANCE_FORCE_MIN_MS = 3_000;

/** 余额响应的缓存时长：成功 30 s，失败 15 s（导出便于单测） */
export function balanceCacheTtl(data) {
    return data && data.ok ? BALANCE_CACHE_MS : BALANCE_ERROR_CACHE_MS;
}

/**
 * 宿主插件主体：注册设置命名空间 + /whale-pet 前缀路由。
 * @param ctx    - 插件上下文；ctx.webServer 是 Web 服务器服务
 * @param config - 本行配置（来自 patch 树；当前仅 size/position，host 侧暂不使用）
 */
function apply(ctx, config) {
    // 资源层：初始化用户自定义动作目录（尽力而为，失败由扫描按空处理）
    mkdir(customActionsDir(), { recursive: true }).catch(() => {});
    // 设置命名空间注册。0.1.x：手动注册，patch 配置（size/position）作为 base 层
    // （优先级 = schema 默认 < patch < 用户设置）。0.2.0：register 已移除，命名空间
    // 由静态 Config + loader 条目 id 自动派生，此处跳过即可。
    if (ctx.settings && typeof ctx.settings.register === 'function') {
        ctx.settings.register(SETTINGS_NS, buildSettingsSchema(z), {
            applies: 'live',
            base:
                config && typeof config.size === 'number'
                    ? { size: config.size, position: config.position }
                    : undefined,
        });
    }
    // ctx.effect 包裹：插件卸载时自动注销路由（官方生命周期管理）
    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'prefix', // 前缀路由：匹配 /whale-pet 及 /whale-pet/xxx
                path: ROUTE_PREFIX,
                handler: async (req, res) => {
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    // 去掉 /whale-pet/ 前缀并 URL 解码（中文文件名是编码后的）。
                    // 非法百分号编码（如 %.webm）会让 decodeURIComponent 抛 URIError，
                    // 需就地转 400，不能依赖外层 dispatcher 兜底刷警告日志
                    let fileName;
                    try {
                        fileName = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
                    } catch {
                        res.writeHead(400, {
                            'content-type': 'text/plain; charset=utf-8',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: invalid path');
                        return;
                    }
                    // 资源层：custom/<动作名>.webm → 用户自定义动作目录；其余 → 内置资源根
                    const isCustom = fileName.startsWith('custom/');
                    const rel = isCustom ? fileName.slice('custom/'.length) : fileName;
                    const root = isCustom ? customActionsDir() : ASSET_ROOT;
                    // 自定义动作属于用户本地数据，不作为公开静态资源暴露。与管理 API
                    // 使用同一守卫，阻断远程访问、跨站读取和 DNS rebinding。
                    if (isCustom && !isAllowedApiRequest(req)) {
                        res.writeHead(403, {
                            'content-type': 'text/plain; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: forbidden');
                        return;
                    }
                    // 防穿越校验
                    const file = resolveAsset(root, rel);
                    if (file === undefined) {
                        res.writeHead(400, {
                            'content-type': 'text/plain; charset=utf-8',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: invalid path');
                        return;
                    }
                    // 单次 lstat 同时完成：存在性、常规文件校验（目录/符号链接一律 404，
                    // 防 custom 目录内 symlink 逃逸到任意文件）、Content-Length。
                    // 相比 existsSync→stat 两步缩小了检查与读取之间的竞态窗口。
                    let st;
                    try {
                        st = await lstat(file);
                    } catch {
                        st = null;
                    }
                    if (!st || !st.isFile()) {
                        res.writeHead(404, {
                            'content-type': 'text/plain; charset=utf-8',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: asset not found');
                        return;
                    }
                    // 按扩展名定 Content-Type，附 Content-Length（浏览器可显示加载进度）
                    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
                    const contentType = MIME[ext] ?? 'application/octet-stream';
                    const versionedCustom = isCustom && url.searchParams.has('v');
                    const cacheControl = isCustom
                        ? versionedCustom
                            ? 'public, max-age=31536000, immutable'
                            : 'no-store'
                        : 'public, max-age=3600';
                    // 单段字节范围：Safari 需要 206 才肯流式播放，Chromium 在
                    // 未缓冲区域 seek 时也能只取需要的片段（见 parseRangeHeader）
                    const total = st.size;
                    const parsedRange = parseRangeHeader(req.headers && req.headers.range, total);
                    if (parsedRange === 'unsatisfiable') {
                        res.writeHead(416, {
                            'content-range': 'bytes */' + total,
                            'content-type': 'text/plain; charset=utf-8',
                            'accept-ranges': 'bytes',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end();
                        return;
                    }
                    const rangeStart = parsedRange ? parsedRange.start : 0;
                    const rangeEnd = parsedRange ? parsedRange.end : total - 1;
                    const partial = !!parsedRange;
                    res.writeHead(partial ? 206 : 200, {
                        'content-type': contentType,
                        'content-length': total === 0 ? 0 : rangeEnd - rangeStart + 1,
                        'accept-ranges': 'bytes',
                        ...(partial
                            ? { 'content-range': 'bytes ' + rangeStart + '-' + rangeEnd + '/' + total }
                            : {}),
                        // 动画是静态文件：缓存 1 小时，重复播放直接命中缓存
                        'cache-control': cacheControl,
                        'x-content-type-options': 'nosniff',
                    });
                    if (total === 0) {
                        res.end();
                        return;
                    }
                    // 流式返回（大文件不占内存；有范围时只读该片段）
                    const stream = createReadStream(file, { start: rangeStart, end: rangeEnd });
                    stream.on('error', () => {
                        res.destroy();
                    });
                    stream.pipe(res);
                },
            }),
        'dsh-whale-pet: /whale-pet asset route'
    );

    // 资源层：自定义动作清单 API（短 TTL 缓存——卡片打开/刷新时拉取，
    // 文件增删后在 TTL 过期或下次刷新时同步消失）
    const ACTIONS_CACHE_MS = 2_000;
    let actionsCache = { at: 0, data: null };

    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'exact',
                path: '/whale-pet/api/actions',
                handler: async (req, res) => {
                    if (req.method !== 'GET') {
                        res.writeHead(405, {
                            allow: 'GET',
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
                        return;
                    }
                    if (!isAllowedApiRequest(req)) {
                        res.writeHead(403, {
                            'content-type': 'text/plain; charset=utf-8',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: forbidden');
                        return;
                    }
                    const send = (body) => {
                        res.writeHead(200, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify(body));
                    };
                    const now = Date.now();
                    if (actionsCache.data && now - actionsCache.at < ACTIONS_CACHE_MS) {
                        send(actionsCache.data);
                        return;
                    }
                    const actions = await scanCustomActions();
                    const data = {
                        ok: true,
                        // 注意：不回传绝对路径（dir 字段曾泄漏 $DSH_HOME 完整路径），仅给展示用说明
                        display: '$DSH_HOME/whale-pet/actions',
                        count: actions.length,
                        actions,
                    };
                    actionsCache = { at: now, data };
                    send(data);
                },
            }),
        'dsh-whale-pet: /whale-pet/api/actions'
    );

    // 自定义动作上传：同源 POST 原始文件体，最大 64 MiB；临时文件写完后原子落盘。
    const MAX_ACTION_UPLOAD_BYTES = 64 * 1024 * 1024;
    const MAX_ACTION_STORAGE_BYTES = 512 * 1024 * 1024;
    let reservedUploadBytes = 0;
    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'exact',
                path: '/whale-pet/api/actions/upload',
                handler: async (req, res) => {
                    const send = (status, body) => {
                        res.writeHead(status, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify(body));
                    };
                    if (req.method !== 'POST') {
                        res.setHeader('allow', 'POST');
                        send(405, { ok: false, error: 'method-not-allowed' });
                        return;
                    }
                    if (!isAllowedApiRequest(req)) {
                        send(403, { ok: false, error: 'forbidden' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    const action = validateCustomActionFileName(url.searchParams.get('name'));
                    if (!action) {
                        send(400, { ok: false, error: 'invalid-file-name' });
                        return;
                    }
                    const declared = Number(req.headers['content-length']);
                    const hasDeclaredSize = Number.isFinite(declared);
                    if (hasDeclaredSize && (declared <= 0 || declared > MAX_ACTION_UPLOAD_BYTES)) {
                        send(413, {
                            ok: false,
                            error: 'invalid-file-size',
                            maxBytes: MAX_ACTION_UPLOAD_BYTES,
                        });
                        return;
                    }
                    const dir = customActionsDir();
                    await mkdir(dir, { recursive: true });
                    const target = join(dir, action.file);
                    // 快速拒绝常见的同名上传；最终 link 仍是并发竞态下的权威排他检查。
                    try {
                        await lstat(target);
                        send(409, { ok: false, error: 'file-exists' });
                        return;
                    } catch (error) {
                        if (error && error.code !== 'ENOENT') {
                            send(400, { ok: false, error: 'upload-failed' });
                            return;
                        }
                    }
                    const existingActions = await scanCustomActions(dir);
                    const storedBytes = existingActions.reduce((sum, item) => sum + item.size, 0);
                    const availableBytes = MAX_ACTION_STORAGE_BYTES - storedBytes - reservedUploadBytes;
                    if (availableBytes <= 0) {
                        send(413, {
                            ok: false,
                            error: 'storage-quota-exceeded',
                            maxStorageBytes: MAX_ACTION_STORAGE_BYTES,
                        });
                        return;
                    }
                    // 为本次请求预留其最多可写容量；并发上传不能共同越过总配额。
                    // 已声明长度的请求只预留其实际额度，并用同一上限阻止伪造小长度后超额写入。
                    const uploadBudget = Math.min(
                        MAX_ACTION_UPLOAD_BYTES,
                        availableBytes,
                        hasDeclaredSize ? declared : MAX_ACTION_UPLOAD_BYTES
                    );
                    reservedUploadBytes += uploadBudget;
                    const temp = join(dir, '.upload-' + randomUUID() + '.tmp');
                    let received = 0;
                    const limiter = new Transform({
                        transform(chunk, encoding, callback) {
                            received += chunk.length;
                            callback(received > uploadBudget ? new Error('upload-too-large') : null, chunk);
                        },
                    });
                    try {
                        await pipeline(req, limiter, createWriteStream(temp, { flags: 'wx' }));
                        if (received === 0) throw new Error('upload-empty');
                        // link 是排他提交：目标已存在时返回 EEXIST，不会像 rename 一样覆盖。
                        await link(temp, target);
                        await unlink(temp).catch(() => {});
                        actionsCache = { at: 0, data: null };
                        send(201, { ok: true, action: { ...action, size: received } });
                    } catch (error) {
                        await unlink(temp).catch(() => {});
                        if (error && error.code === 'EEXIST') {
                            send(409, { ok: false, error: 'file-exists' });
                            return;
                        }
                        const tooLarge = error && error.message === 'upload-too-large';
                        send(tooLarge ? 413 : 400, {
                            ok: false,
                            error:
                                tooLarge && uploadBudget < MAX_ACTION_UPLOAD_BYTES
                                    ? 'storage-quota-exceeded'
                                    : tooLarge
                                      ? 'invalid-file-size'
                                      : 'upload-failed',
                            ...(tooLarge && uploadBudget < MAX_ACTION_UPLOAD_BYTES
                                ? { maxStorageBytes: MAX_ACTION_STORAGE_BYTES }
                                : {}),
                        });
                    } finally {
                        reservedUploadBytes -= uploadBudget;
                    }
                },
            }),
        'dsh-whale-pet: /whale-pet/api/actions/upload'
    );

    // 自定义动作删除：校验安全文件名、同源请求，并且只删除常规文件。
    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'exact',
                path: '/whale-pet/api/actions/delete',
                handler: async (req, res) => {
                    const send = (status, body) => {
                        res.writeHead(status, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify(body));
                    };
                    if (req.method !== 'DELETE') {
                        res.setHeader('allow', 'DELETE');
                        send(405, { ok: false, error: 'method-not-allowed' });
                        return;
                    }
                    if (!isAllowedApiRequest(req)) {
                        send(403, { ok: false, error: 'forbidden' });
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    const action = validateCustomActionFileName(url.searchParams.get('name'));
                    if (!action) {
                        send(400, { ok: false, error: 'invalid-file-name' });
                        return;
                    }
                    const target = join(customActionsDir(), action.file);
                    let st;
                    try {
                        st = await lstat(target);
                    } catch {
                        st = null;
                    }
                    if (!st || !st.isFile() || st.isSymbolicLink()) {
                        send(404, { ok: false, error: 'file-not-found' });
                        return;
                    }
                    try {
                        await unlink(target);
                        actionsCache = { at: 0, data: null };
                        send(200, { ok: true, action });
                    } catch {
                        send(500, { ok: false, error: 'delete-failed' });
                    }
                },
            }),
        'dsh-whale-pet: /whale-pet/api/actions/delete'
    );
    // 当前会话模型解析：客户端 projection/目录都可能尚未就绪，Host 已存档的
    // requestHeader 与 requestContext 是同一会话的权威来源；只返回 provider/model。
    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'exact',
                path: '/whale-pet/api/model',
                handler: async (req, res) => {
                    if (req.method !== 'GET') {
                        res.writeHead(405, {
                            allow: 'GET',
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
                        return;
                    }
                    if (!isAllowedApiRequest(req)) {
                        res.writeHead(403, {
                            'content-type': 'text/plain; charset=utf-8',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: forbidden');
                        return;
                    }
                    let sessionId = '';
                    try {
                        sessionId =
                            new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId') || '';
                    } catch {
                        sessionId = '';
                    }
                    let current = null;
                    try {
                        const sessions = ctx.get('sessions');
                        let session =
                            sessionId && sessions && typeof sessions.get === 'function'
                                ? sessions.get(sessionId)
                                : undefined;
                        // Desktop 没有可用的 current session 选择器时，客户端可能拿不到
                        // sessionId；退回最近有请求头的 live session（通常就是当前打开的那个）。
                        if (!session && sessions && typeof sessions.list === 'function') {
                            const live = sessions.list();
                            const candidates = live.filter((item) => {
                                try {
                                    return item && item.header && item.header.origin !== 'subagent';
                                } catch {
                                    return false;
                                }
                            });
                            candidates.sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
                            session = candidates[0];
                        }
                        const header =
                            session && typeof session.requestHeader === 'function'
                                ? session.requestHeader()
                                : undefined;
                        const context =
                            session && typeof session.requestContext === 'function'
                                ? session.requestContext()
                                : undefined;
                        const config = header && header.config;
                        if (config && config.provider && config.model) {
                            current = { provider: config.provider, model: config.model };
                        } else if (context && context.provider && context.model) {
                            current = { provider: context.provider, model: context.model };
                        }
                    } catch {
                        current = null;
                    }
                    if (!current) {
                        try {
                            const defaults = ctx.get('agentDefaultModel');
                            const picked =
                                defaults && typeof defaults.currentSelection === 'function'
                                    ? defaults.currentSelection()
                                    : null;
                            if (picked && picked.provider && picked.model)
                                current = { provider: picked.provider, model: picked.model };
                        } catch {
                            current = null;
                        }
                    }
                    res.writeHead(200, {
                        'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store',
                        'x-content-type-options': 'nosniff',
                    });
                    res.end(JSON.stringify(current ? { ok: true, current } : { ok: false, current: null }));
                },
            }),
        'dsh-whale-pet: /whale-pet/api/model'
    );

    // 余额来源分类与查询路由。设计见 docs/design-balance-notify.md v2：
    // - mode=meta 只分类，不解析凭据；
    // - account 由客户端走 remote.account.getBalance，本路由不碰 key；
    // - plan 不查钱包；
    // - wallet 只有 allowApiKey=true 才解析 key；
    // - 代理由 DSH 的 dsh-http-proxy 全局 dispatcher 负责，这里只用普通 fetch。
    const balanceCache = new Map();
    const quotaCache = new Map();

    // 额度缓存判定：成功缓存可被 force=1 缩短到 3 s；失败缓存仍按 15 s，
    // 避免未配置 key / 401 时被客户端强制刷新打爆上游。
    function quotaCacheFresh(cached, force, now) {
        if (!cached) return false;
        const ttl = cached.data && cached.data.ok && force ? BALANCE_FORCE_MIN_MS : cached.ttl;
        return now - cached.at < ttl;
    }

    /** 当前路由的额度来源；只按固定厂商端点/本地 Codex 日志分类。 */
    function resolveQuotaConfig(route, model) {
        let entry;
        let profile;
        try {
            const llm = ctx.get('llm');
            const list =
                llm && typeof llm.listConfigurableProviders === 'function'
                    ? llm.listConfigurableProviders()
                    : [];
            entry = list.find((item) => item && item.provider === route);
            if (entry) {
                profile = readSettingsValue(entry.settingsNs);
                for (const part of entry.settingsPath || []) profile = profile && profile[part];
            }
        } catch {
            /* 注册表未就绪：仍可按 route 精确分类 */
        }
        const baseURL =
            (profile && (profile.baseURL || profile.baseUrl)) || (entry && entry.defaultBaseURL) || '';
        const provider = classifyQuotaProvider({
            route,
            provider: entry && entry.provider,
            baseURL,
        });
        // DSH 注册表报告的真实环境变量名（env-auth 用户没有 profile.apiKeyEnv 时靠它）。
        const nativeEnv =
            entry && entry.nativeAuth && Array.isArray(entry.nativeAuth.env) ? entry.nativeAuth.env : [];
        return {
            provider,
            baseURL,
            route,
            model,
            profile,
            nativeEnv,
            providerLabel: (entry && entry.displayName) || (QUOTA_PROVIDERS[provider] || {}).label || route,
        };
    }

    // 设置命名空间读取：0.1.x 有 get(ns)；0.2.0 已移除 get，改用 describe()
    // 返回的数组按 ns 查找实时投影值。读不到时返回 undefined（上游回退）。
    function readSettingsValue(ns) {
        try {
            if (ctx.settings && typeof ctx.settings.get === 'function') return ctx.settings.get(ns);
            const rows =
                ctx.settings && typeof ctx.settings.describe === 'function' ? ctx.settings.describe() : [];
            const row = Array.isArray(rows) ? rows.find((item) => item && item.ns === ns) : undefined;
            return row ? row.value : undefined;
        } catch {
            return undefined;
        }
    }

    function readBalanceSettings() {
        const settings = readSettingsValue(SETTINGS_NS);
        return settings && settings.balance && typeof settings.balance === 'object' ? settings.balance : {};
    }

    function resolveBalanceConfig(route, model) {
        if (typeof route !== 'string' || !route) {
            return { source: 'unsupported', unsupported: true, route: '', model, reason: 'no-route' };
        }
        let entry;
        let profile;
        try {
            const llm = ctx.get('llm');
            const list =
                llm && typeof llm.listConfigurableProviders === 'function'
                    ? llm.listConfigurableProviders()
                    : [];
            entry = list.find((item) => item && item.provider === route);
            if (entry) {
                profile = readSettingsValue(entry.settingsNs);
                for (const part of entry.settingsPath || []) profile = profile && profile[part];
            }
        } catch {
            /* 注册表未就绪：仍可按 route 精确分类 */
        }

        // 关键：profile 没写 baseURL 时用注册表的 defaultBaseURL；否则
        // kimi-coding 之类的路由会掉进 route 子串推断，把 key 发去错误端点。
        const baseURL =
            (profile && (profile.baseURL || profile.baseUrl)) || (entry && entry.defaultBaseURL) || '';
        const classified = classifyBalanceSource({
            route,
            provider: entry && entry.provider,
            baseURL,
        });
        const providerLabel = (entry && entry.displayName) || route;

        if (classified.source === 'account') {
            return {
                source: 'account',
                provider: 'deepseek',
                providerLabel: 'DeepSeek 账户',
                route,
                model,
            };
        }
        if (classified.source === 'plan') {
            return {
                source: 'plan',
                provider: classified.provider || route,
                providerLabel,
                planKind: classified.planKind,
                route,
                model,
            };
        }
        if (classified.source === 'unsupported') {
            return {
                source: 'unsupported',
                unsupported: true,
                route,
                model,
                reason: classified.reason,
            };
        }

        const provider = getBalanceProvider(classified.provider);
        if (!provider) {
            return {
                source: 'unsupported',
                unsupported: true,
                route,
                model,
                reason: 'unknown-provider',
            };
        }
        const refs = [...provider.refs];
        if (profile && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.trim()) {
            refs.unshift(profile.apiKeyEnv.trim());
        } else {
            for (const ns of provider.settings) {
                try {
                    const cfg = readSettingsValue(ns);
                    if (cfg && typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv.trim()) {
                        refs.unshift(cfg.apiKeyEnv.trim());
                        break;
                    }
                } catch {
                    /* 尝试下一个命名空间 */
                }
            }
        }
        return {
            source: 'wallet',
            provider: provider.id,
            providerLabel: provider.label,
            endpoint: provider.endpoint,
            refs,
            route,
            model,
        };
    }

    async function resolveApiKey(refs) {
        const credentials = ctx.get('credentials');
        for (const ref of refs) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) continue;
            if (credentials) {
                try {
                    const hit = await credentials.resolve(ref);
                    if (hit && hit.value) return hit.value;
                } catch {
                    /* 回落环境变量 */
                }
            }
            if (process.env[ref]) return process.env[ref];
        }
        return undefined;
    }

    ctx.effect(
        () =>
            ctx.webServer.register({
                kind: 'exact',
                path: '/whale-pet/api/balance',
                handler: async (req, res) => {
                    if (req.method !== 'GET') {
                        res.writeHead(405, {
                            allow: 'GET',
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
                        return;
                    }
                    if (!isAllowedApiRequest(req)) {
                        res.writeHead(403, {
                            'content-type': 'text/plain; charset=utf-8',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end('dsh-whale-pet: forbidden');
                        return;
                    }
                    const send = (body) => {
                        res.writeHead(200, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                            'x-content-type-options': 'nosniff',
                        });
                        res.end(JSON.stringify(body));
                    };
                    const now = Date.now();
                    let cacheKey = '';
                    try {
                        const url = new URL(req.url ?? '/', 'http://localhost');
                        const mode = url.searchParams.get('mode') || '';
                        const force = url.searchParams.get('force') === '1';
                        const route = url.searchParams.get('route') || '';
                        const model = url.searchParams.get('model') || '';
                        const config = resolveBalanceConfig(route, model);
                        const balanceSettings = readBalanceSettings();
                        // 设置页不再暴露授权开关，但配置文件里的 allowApiKey 仍然生效。
                        const allowApiKey = balanceSettings.allowApiKey === true;
                        const proxyEnv = proxyEnvPresence(process.env);

                        // 套餐额度：Codex 读本地日志；其余只认官方端点，未授权不解析 key。
                        if (mode === 'quota') {
                            const quota = resolveQuotaConfig(route, model);
                            if (!quota.provider) {
                                send({
                                    ok: false,
                                    source: 'plan',
                                    status: 'unavailable',
                                    provider: null,
                                    providerLabel: quota.providerLabel,
                                    route,
                                    model,
                                    error: '当前套餐没有可用的额度接口',
                                });
                                return;
                            }
                            if (quota.provider === 'codex') {
                                const codexKey = 'quota:codex';
                                const cachedCodex = quotaCache.get(codexKey);
                                if (quotaCacheFresh(cachedCodex, force, now)) {
                                    send(cachedCodex.data);
                                    return;
                                }
                                const data = await readCodexQuota();
                                const payload = {
                                    ...data,
                                    source: 'plan',
                                    provider: quota.provider,
                                    providerLabel: quota.providerLabel,
                                    route,
                                    model,
                                };
                                quotaCache.set(codexKey, {
                                    at: now,
                                    ttl: data.ok ? QUOTA_CACHE_MS : QUOTA_ERROR_CACHE_MS,
                                    data: payload,
                                });
                                send(payload);
                                return;
                            }
                            if (!allowApiKey) {
                                send({
                                    ok: false,
                                    source: 'plan',
                                    status: 'consent-required',
                                    provider: quota.provider,
                                    providerLabel: quota.providerLabel,
                                    route,
                                    model,
                                    error: '额度查询未授权（需要在配置文件中允许使用 API key）',
                                });
                                return;
                            }
                            // profile.apiKeyEnv 最优先；固定 refs 与注册表 nativeAuth.env
                            // 去重后依次尝试（env-auth 用户没有 profile 时靠后两者）。
                            const refs = quotaKeyRefs(quota.provider, {
                                apiKeyEnv: quota.profile && quota.profile.apiKeyEnv,
                                nativeEnv: quota.nativeEnv,
                            });
                            const cacheKey = 'quota:' + quota.provider + ':' + refs.join('|');
                            const cached = quotaCache.get(cacheKey);
                            if (quotaCacheFresh(cached, force, now)) {
                                send(cached.data);
                                return;
                            }
                            const key = await resolveApiKey(refs);
                            if (!key) {
                                const data = {
                                    ok: false,
                                    source: 'plan',
                                    status: 'error',
                                    provider: quota.provider,
                                    providerLabel: quota.providerLabel,
                                    route,
                                    model,
                                    windows: [],
                                    errorCode: 'missing-key',
                                    error: balanceErrorMessage('missing-key', quota.providerLabel),
                                };
                                quotaCache.set(cacheKey, { at: now, ttl: QUOTA_ERROR_CACHE_MS, data });
                                send(data);
                                return;
                            }
                            try {
                                const result = await fetchQuota(quota.provider, key, {
                                    timeoutMs: balanceSettings.timeoutMs,
                                });
                                const data = {
                                    ok: true,
                                    source: 'plan',
                                    status: 'ready',
                                    provider: quota.provider,
                                    providerLabel: quota.providerLabel,
                                    route,
                                    model,
                                    windows: result.windows,
                                    at: result.at,
                                };
                                quotaCache.set(cacheKey, { at: now, ttl: QUOTA_CACHE_MS, data });
                                send(data);
                            } catch (e) {
                                const errorCode =
                                    e && e.code === 'auth'
                                        ? 'auth'
                                        : e && e.code === 'quota'
                                          ? 'quota'
                                          : e && e.code === 'upstream'
                                            ? 'upstream'
                                            : balanceErrorCode(e);
                                const data = {
                                    ok: false,
                                    source: 'plan',
                                    status: 'error',
                                    provider: quota.provider,
                                    providerLabel: quota.providerLabel,
                                    route,
                                    model,
                                    windows: [],
                                    errorCode,
                                    error: balanceErrorMessage(errorCode, quota.providerLabel),
                                };
                                quotaCache.set(cacheKey, { at: now, ttl: QUOTA_ERROR_CACHE_MS, data });
                                send(data);
                            }
                            return;
                        }

                        // 分类只读注册表/设置；不解析 key、不发网络请求。
                        if (mode === 'meta') {
                            send({
                                ok: true,
                                source: config.source,
                                provider: config.provider || null,
                                providerLabel: config.providerLabel || null,
                                planKind: config.planKind || null,
                                requiresConsent: config.source === 'wallet' && !allowApiKey,
                                allowApiKey,
                                proxyEnv,
                                route,
                                model,
                                reason: config.reason,
                            });
                            return;
                        }

                        if (config.source === 'account') {
                            send({
                                ok: false,
                                source: 'account',
                                status: 'use-account-remote',
                                provider: 'deepseek',
                                providerLabel: 'DeepSeek 账户',
                                route,
                                model,
                                error: '账户余额由客户端 Remote 读取',
                            });
                            return;
                        }
                        if (config.source === 'plan') {
                            send({
                                ok: false,
                                source: 'plan',
                                status: 'plan',
                                provider: config.provider,
                                providerLabel: config.providerLabel,
                                planKind: config.planKind,
                                route,
                                model,
                                error: '套餐/订阅计费，不提供钱包余额',
                            });
                            return;
                        }
                        if (config.source === 'unsupported') {
                            send({
                                ok: false,
                                source: 'unsupported',
                                status: 'unsupported',
                                unsupported: true,
                                route,
                                model,
                                error: '当前模型服务商不支持官方余额查询',
                            });
                            return;
                        }

                        // 关键闸门：未授权时绝不进入 resolveApiKey。
                        if (!allowApiKey) {
                            send({
                                ok: false,
                                source: 'wallet',
                                status: 'consent-required',
                                provider: config.provider,
                                providerLabel: config.providerLabel,
                                route,
                                model,
                                error: '余额查询未授权（需要允许使用 API key）',
                            });
                            return;
                        }

                        cacheKey = config.provider + ':' + config.refs.join('|');
                        const cached = balanceCache.get(cacheKey);
                        if (cached) {
                            // 成功缓存可被 force 缩短到 3s；失败缓存始终 15s。
                            const ttl =
                                cached.data && cached.data.ok && force ? BALANCE_FORCE_MIN_MS : cached.ttl;
                            if (now - cached.at < ttl) {
                                send(cached.data);
                                return;
                            }
                        }

                        const key = await resolveApiKey(config.refs);
                        if (!key) {
                            const data = {
                                ok: false,
                                source: 'wallet',
                                status: 'error',
                                provider: config.provider,
                                providerLabel: config.providerLabel,
                                route,
                                model,
                                balances: [],
                                balance: null,
                                errorCode: 'missing-key',
                                error: balanceErrorMessage('missing-key', config.providerLabel),
                            };
                            balanceCache.set(cacheKey, {
                                at: now,
                                ttl: balanceCacheTtl(data),
                                data,
                            });
                            send(data);
                            return;
                        }

                        const rawTimeout = Number(balanceSettings.timeoutMs);
                        const timeoutMs = Number.isFinite(rawTimeout)
                            ? Math.min(60_000, Math.max(3_000, rawTimeout))
                            : 12_000;
                        const r = await fetch(config.endpoint, {
                            headers: { Authorization: 'Bearer ' + key },
                            redirect: 'error',
                            signal: AbortSignal.timeout(timeoutMs),
                        });
                        // 上游错误页可能是 HTML：解析失败必须当 body=null，不能
                        // 让 JSON 异常落进外层 catch 变成笼统的协议错误。
                        let body = null;
                        try {
                            body = await r.json();
                        } catch {
                            body = null;
                        }
                        const balances = parseProviderBalances(config.provider, body);
                        const upstreamError =
                            body && typeof body === 'object' ? body.error || body.message : undefined;
                        let errorCode;
                        if (r.status === 401 || r.status === 403) errorCode = 'auth';
                        else if (r.status === 402) errorCode = 'quota';
                        else if (!r.ok) errorCode = 'upstream';
                        else if (balances.length === 0) errorCode = 'protocol';
                        const data = {
                            ok: r.ok && balances.length > 0,
                            source: 'wallet',
                            status: r.ok && balances.length > 0 ? 'ready' : 'error',
                            provider: config.provider,
                            providerLabel: config.providerLabel,
                            route,
                            model,
                            balances,
                            // 保留单余额字段，兼容旧版客户端。
                            balance: balances[0] || null,
                            errorCode: errorCode || null,
                            error:
                                errorCode === 'auth' || errorCode === 'quota'
                                    ? balanceErrorMessage(errorCode, config.providerLabel)
                                    : upstreamError
                                      ? String(upstreamError.message || upstreamError)
                                      : errorCode
                                        ? balanceErrorMessage(errorCode, config.providerLabel)
                                        : undefined,
                        };
                        balanceCache.set(cacheKey, { at: now, ttl: balanceCacheTtl(data), data });
                        send(data);
                    } catch (e) {
                        const errorCode = balanceErrorCode(e);
                        const data = {
                            ok: false,
                            source: 'wallet',
                            status: 'error',
                            errorCode,
                            error: balanceErrorMessage(errorCode),
                        };
                        // 网络/解析异常同样缓存，避免客户端退避重试时反复外呼
                        if (cacheKey)
                            balanceCache.set(cacheKey, {
                                at: now,
                                ttl: balanceCacheTtl(data),
                                data,
                            });
                        send(data);
                    }
                },
            }),
        'dsh-whale-pet: /whale-pet/api/balance'
    );
}

// 导出插件三件套（Cordis Loader 需要）
export { apply, inject, name, Config };
