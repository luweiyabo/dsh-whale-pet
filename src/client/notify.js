/**
 * ============================================================================
 * 回合完成提示 —— 纯逻辑 + 三条通知通道
 * ============================================================================
 *
 * 【为什么单独成文件】
 *   通知的核心是「什么事件、什么状态下、走哪条通道」的判定。这层必须是纯函数，
 *   才能在 `node --test` 里把 Windows/macOS/Linux、Web/Desktop、授权/拒绝、
 *   前台/后台的矩阵全部跑一遍；DOM 与浏览器 API 只在最外层适配器里出现。
 *
 * 【三条通道 + 标题兜底】
 *   system —— `new Notification()`：页面失焦/隐藏时进系统通知中心（跨软件可见）。
 *             要求安全上下文 + 已授权；Desktop 由 DSH 主进程放行。构造成功只代表
 *             已交给平台，展示阶段失败会触发 `onerror`（见 createSystemNotifier.send）。
 *   sound  —— WebAudio 合成短音：系统通知不可用时唯一实时的提示。
 *   bubble —— 页内桌宠上方气泡：页面聚焦时使用；带会话名，点一下切回该会话。
 *   标题 `●` 是 sound 通道的兜底。
 *   页内「通知卡片 / 队列」通道已移除（旧实现不可达且与气泡重复）；运行时只有上述
 *   三条通道 + 标题。index.js 里残留的「通知卡片 / 通知栈」历史注释与 notifyDismiss
 *   等旧文案不代表该通道存在，不要据此恢复卡片 UI。
 *
 * 【边界】
 *   1. 页面/应用关闭后收不到任何事件 —— 事件来自页面内的流；要覆盖需要 Push
 *      服务或宿主推送，超出插件能力。
 *   2. 非安全上下文拿不到 Notifications API —— 浏览器限制，不是实现问题。
 */

import { formatDuration, formatTokens } from './schedule.js';

/** 三类可提示事件（entry.kind 的取值） */
export const NOTIFY_KINDS = ['done', 'error', 'waiting'];

/**
 * 默认配置（与宿主 schema 的默认值保持一致）：只有**一个总开关**。
 * 系统通知与提示音由运行环境决定（安全上下文 / 授权 / 构造函数），不再单独配置；
 * 0.2.0 开发版里的五个细分开关（done/error/waiting/system/sound）不再读取：
 * 它们从未正式发布，保留兼容反而会让旧值成为界面上无法清除的隐藏静音。
 */
export const DEFAULT_NOTIFY = {
    enabled: true,
};

/** 系统通知 tag 长度上限：Windows toast 的 Tag 只有 16 字符，超长会被静默丢弃 */
const TAG_MAX = 16;
/** 系统通知限流：同 tag 3s、全局 10s 内 3 条 */
const TAG_MIN_INTERVAL_MS = 3000;
const GLOBAL_WINDOW_MS = 10000;
const GLOBAL_MAX = 3;
/** 正文里错误摘要的最大长度（provider 可能回整段 HTTP 文本） */
const ERROR_TEXT_MAX = 120;

/**
 * `turn/end` 的 reason → 提示分类。
 * 只提示完成与失败；用户取消/被拦截/恢复补写的事件一律静默。
 * @param {{kind?: string, error?: {message?: string, code?: string}, reason?: object}} reason
 * @returns {{kind: 'done'|'error', limit?: boolean, message?: string} | null}
 */
export function classifyTurnEnd(reason) {
    var r = reason || {};
    var kind = r.kind;
    if (kind === 'completed') return { kind: 'done' };
    if (kind === 'max-tokens') return { kind: 'done', limit: true };
    if (kind === 'error') {
        var err = r.error || {};
        var message = typeof err.message === 'string' ? err.message : '';
        if (!message && typeof err.code === 'string') message = err.code;
        return { kind: 'error', message: message };
    }
    return null;
}

/**
 * 是否安全上下文。浏览器已经算好 `isSecureContext`；注入假对象时允许显式指定。
 * 例外兜底：极旧的壳没有该字段，用 localhost/127.0.0.1 判定。
 * @param {object} scope - window 或测试替身
 */
export function isSecureScope(scope) {
    if (!scope) return false;
    if (typeof scope.isSecureContext === 'boolean') return scope.isSecureContext;
    try {
        var host = scope.location && scope.location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch (e) {
        return false;
    }
}

/** 当前环境的通知能力快照（页面组件与设置卡片共用） */
export function notificationEnvironment(scope) {
    var Ctor = scope && scope.Notification;
    return {
        secure: isSecureScope(scope),
        supported: typeof Ctor === 'function',
        permission: Ctor && typeof Ctor.permission === 'string' ? Ctor.permission : 'unsupported',
    };
}

/**
 * 通道判定（纯函数，全部输入显式传入）。
 *
 * 输入：kind / notify 配置 / visible / focused / secure / supported / permission /
 *       preferSystem。
 * 输出：{ channel, title }
 *   channel: 'none' | 'bubble' | 'system' | 'sound'
 *   title:   是否叠加标题 `●`（仅 sound 通道使用）
 *
 * 判定顺序：低余额等「立刻要知道」的事件优先系统通知；页面可见且聚焦时一律走
 * 页内气泡（当前会话与其它会话都是气泡，后者带会话名并可点回）；页面不可见时
 * 系统通知可用就发系统通知；否则退化为提示音 + 标题圆点。
 *
 * @param {object} input
 */
export function channelDecision(input) {
    var i = input || {};
    var visible = i.visible !== false;
    var focused = i.focused !== false;
    var systemReady = i.secure === true && i.supported === true && i.permission === 'granted';
    // preferSystem：重要且罕见的事件（低余额）不等用户切走，系统通知可用就直接发。
    if (i.preferSystem === true && systemReady) return { channel: 'system', title: false };
    if (visible && focused) return { channel: 'bubble', title: false };
    if (systemReady) return { channel: 'system', title: false };
    // 系统通知不可用：声音是唯一「人不在页面也能感知」的通道
    return { channel: 'sound', title: true };
}

/**
 * 事件级判定：总开关 + 事件类型过滤，再交给通道判定。
 * 旧开发版的 done/error/waiting/system/sound 细分开关不再兼容读取（见 DEFAULT_NOTIFY 注释）。
 * @param {object} input - 同 channelDecision，另加 kind / notify
 */
export function notifyDecision(input) {
    var i = input || {};
    var cfg = i.notify || DEFAULT_NOTIFY;
    var kind = i.kind;
    if (cfg.enabled === false) return { channel: 'none', title: false };
    if (NOTIFY_KINDS.indexOf(kind) === -1) return { channel: 'none', title: false };
    return channelDecision(i);
}

function truncateText(value, limit) {
    var text = String(value == null ? '' : value);
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(0, limit - 1)) + '…';
}

/**
 * 组装一条通知的标题/正文。会话名由调用方补，避免这里依赖会话服务。
 * @param {{kind: string, summary?: object, limit?: boolean, message?: string}} entry
 * @param {(key: string) => string} t - 翻译函数
 * @returns {{title: string, body: string}}
 */
export function formatNotifyText(entry, t) {
    var e = entry || {};
    var tr =
        typeof t === 'function'
            ? t
            : function (k) {
                  return k;
              };
    var title = tr(
        e.kind === 'error' ? 'notifyError' : e.kind === 'waiting' ? 'notifyWaiting' : 'notifyDone'
    );
    if (e.kind === 'waiting') return { title: title, body: tr('notifyWaitBody') };
    if (e.kind === 'error')
        return { title: title, body: truncateText(e.message, ERROR_TEXT_MAX) || tr('notifyErrorBody') };

    var parts = [];
    var s = e.summary || {};
    if (s.durationMs) parts.push(formatDuration(s.durationMs));
    if (s.steps) {
        var stepsText = s.steps === 1 ? tr('notifyStepOne') : tr('notifySteps');
        parts.push(stepsText.replace('{n}', s.steps));
    }
    if (s.tokens) parts.push(formatTokens(s.tokens) + ' tokens');
    if (e.limit) parts.push(tr('notifyLimit'));
    return { title: title, body: parts.join(' · ') };
}

/**
 * 系统通知适配器。
 * 依赖注入（scope / Notification / now）便于单测覆盖授权、拒绝、不支持、限流。
 */
export function createSystemNotifier(deps) {
    var d = deps || {};
    var scope = d.scope || (typeof window !== 'undefined' ? window : null);
    var now = typeof d.now === 'function' ? d.now : () => Date.now();
    var lastByTag = {};
    var recent = [];

    function ctor() {
        if (Object.prototype.hasOwnProperty.call(d, 'Notification')) return d.Notification;
        return scope ? scope.Notification : undefined;
    }
    function permission() {
        var C = ctor();
        return C && typeof C.permission === 'string' ? C.permission : 'unsupported';
    }
    return {
        supported() {
            return typeof ctor() === 'function';
        },
        permission() {
            return permission();
        },
        secureContext() {
            return isSecureScope(scope);
        },
        /** 必须在用户手势里调用（浏览器要求）；Desktop 直接返回 granted */
        requestPermission() {
            var C = ctor();
            if (!C || typeof C.requestPermission !== 'function') return Promise.resolve(permission());
            try {
                return Promise.resolve(C.requestPermission()).catch(function () {
                    return permission();
                });
            } catch (e) {
                return Promise.resolve(permission());
            }
        },
        /**
         * 发送一条系统通知。同步成功返回 true；不可用/未授权/被限流/构造抛错返回 false，
         * 由调用方降级到声音或标题。
         *
         * 构造成功不等于已展示：平台在展示阶段失败（权限被收回、页面已关、系统丢弃
         * toast）会触发 `notification.onerror`。此时把本次结果标记为未发送、回滚限流
         * 记账（不占同 tag/全局配额），并异步调用可选的 `onFail()` 让调用方补降级
         * （提示音 / 标题圆点）。不传 `onFail` 时只回滚记账，不抛错。
         * 环境不支持 `onerror`（赋值抛错）时保持原同步行为。
         */
        send(opts) {
            var o = opts || {};
            if (!this.supported() || permission() !== 'granted') return false;
            var tag = o.tag || 'whale-pet';
            var at = now();
            if (lastByTag[tag] !== undefined && at - lastByTag[tag] < TAG_MIN_INTERVAL_MS) return false;
            recent = recent.filter(function (ts) {
                return at - ts < GLOBAL_WINDOW_MS;
            });
            if (recent.length >= GLOBAL_MAX) return false;
            var Ctor = ctor();
            var notification;
            try {
                notification = new Ctor(o.title, {
                    body: o.body,
                    icon: o.icon,
                    tag: tag,
                    requireInteraction: !!o.requireInteraction,
                    silent: false,
                });
            } catch (e) {
                return false;
            }
            var prevTagAt = lastByTag[tag];
            lastByTag[tag] = at;
            recent.push(at);
            // 异步失败回调：只执行一次；回滚本次限流记账后再触发调用方降级。
            var pending = true;
            var markFailed = function () {
                if (!pending) return;
                pending = false;
                if (lastByTag[tag] === at) {
                    if (prevTagAt === undefined) delete lastByTag[tag];
                    else lastByTag[tag] = prevTagAt;
                }
                var atIndex = recent.indexOf(at);
                if (atIndex !== -1) recent.splice(atIndex, 1);
                if (typeof o.onFail === 'function') {
                    try {
                        o.onFail();
                    } catch (e) {
                        /* 降级回调异常不能影响通知层 */
                    }
                }
            };
            try {
                notification.onerror = markFailed;
            } catch (e) {
                /* 环境不支持 onerror：保持同步返回行为 */
            }
            if (typeof o.onClick === 'function') {
                notification.onclick = function () {
                    try {
                        o.onClick();
                    } finally {
                        try {
                            notification.close();
                        } catch (e) {
                            /* 已关闭 */
                        }
                    }
                };
            }
            return true;
        },
    };
}

/**
 * 提示音适配器（WebAudio 合成，无素材）。
 * 浏览器要求音频上下文由用户手势创建/resume；调用方在点击宠物等手势里 `prime()`。
 */
export function createNotifierSound(deps) {
    var d = deps || {};
    var scope = d.scope || (typeof window !== 'undefined' ? window : null);
    var ctx = null;

    function AudioCtor() {
        if (Object.prototype.hasOwnProperty.call(d, 'AudioContext')) return d.AudioContext;
        if (!scope) return undefined;
        return scope.AudioContext || scope.webkitAudioContext;
    }
    function ensure() {
        var C = AudioCtor();
        if (!C) return null;
        try {
            if (!ctx) ctx = new C();
            if (ctx.state === 'suspended') {
                var p = ctx.resume();
                if (p && typeof p.catch === 'function') p.catch(function () {});
            }
            return ctx;
        } catch (e) {
            return null;
        }
    }
    return {
        prime() {
            return !!ensure();
        },
        play() {
            var audio = ensure();
            if (!audio) return false;
            try {
                var t0 = audio.currentTime;
                var osc = audio.createOscillator();
                var gain = audio.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, t0);
                gain.gain.setValueAtTime(0.0001, t0);
                // 峰值音量：0.12 → 0.18（约 +3.5 dB，仍保持短促不刺耳）
                gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
                osc.connect(gain);
                gain.connect(audio.destination);
                osc.start(t0);
                osc.stop(t0 + 0.32);
                return true;
            } catch (e) {
                return false;
            }
        },
    };
}

/**
 * 稳定短哈希：用于 Windows toast 的 tag 与会话去重键。
 * @param {unknown} value
 * @returns {string} 8 位 base36
 */
export function shortHash(value) {
    var s = String(value || '');
    var h = 5381;
    for (var i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36).slice(-8);
}

/**
 * 系统通知的 toast tag（<=16 字符）。
 * waiting 用会话稳定 tag（同一会话重复提醒替换而不是叠加）；done/error 用
 * 会话短哈希 + kind + 事件序，避免不同会话同 seq 时 tag 碰撞导致通知被替换/限流丢弃。
 * @param {{kind?: string, sessionId?: string, seq?: number}} entry
 * @returns {string}
 */
export function systemTagFor(entry) {
    var e = entry || {};
    var session = shortHash(e.sessionId || '');
    if (e.kind === 'waiting') return ('wpw' + session).slice(0, TAG_MAX);
    var kind = e.kind === 'error' ? 'e' : 'd';
    var seq = e.seq === undefined || e.seq === null ? '' : String(e.seq).slice(-4);
    return ('wp' + kind + session.slice(0, 6) + seq).slice(0, TAG_MAX);
}

/**
 * 标题标记：0 → ''，1 → '●'，多条 → '●(3)'。
 * @param {number} count
 */
export function titleMark(count) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n) return '';
    return n === 1 ? '●' : '●(' + n + ')';
}
