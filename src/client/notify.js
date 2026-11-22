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
 * 【三条通道】
 *   system —— `new Notification()`：页面失焦/隐藏时进系统通知中心（跨软件可见）。
 *             要求安全上下文 + 已授权；Desktop 由 DSH 主进程放行。
 *   sound  —— WebAudio 合成短音：非安全上下文（局域网 http）下唯一实时的提示。
 *   card   —— 页内右侧卡片：页面聚焦时用；系统通知不可用时回前台补显。
 *   标题 `●` 是降级兜底，任何通道不可用都可以叠上。
 *
 * 【边界】
 *   1. 页面/应用关闭后收不到任何事件 —— 事件来自页面内的流；要覆盖需要 Push
 *      服务或宿主推送，超出插件能力。
 *   2. 非安全上下文拿不到 Notifications API —— 浏览器限制，不是实现问题。
 */

import { formatDuration, formatTokens } from './schedule.js';

/** 三类可提示事件（同时也是配置键） */
export const NOTIFY_KINDS = ['done', 'error', 'waiting'];

/** 默认配置（与宿主 schema 的默认值保持一致） */
export const DEFAULT_NOTIFY = {
    done: true,
    error: true,
    waiting: true,
    system: true,
    sound: true,
};

/** 卡片自动消失时长（ms）；waiting 由 resolved 撤销，超时只是清理兜底 */
const CARD_TTL = { done: 8000, error: 10000, waiting: 15000, balance: 10000 };
/** 同屏卡片上限 / 队列总上限 */
const CARD_MAX_SHOWN = 3;
const CARD_CAP = 6;
/** 系统通知限流：同 tag 3s、全局 10s 内 3 条 */
const TAG_MIN_INTERVAL_MS = 3000;
const GLOBAL_WINDOW_MS = 10000;
const GLOBAL_MAX = 3;

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
 * 输入：kind / notify 配置 / visible / focused / sessionId / currentSessionId /
 *       secure / supported / permission
 * 输出：{ channel, title, card }
 *   channel: 'none' | 'bubble' | 'card' | 'system' | 'sound'
 *   title:   是否叠加标题 `●`
 *   card:    是否入队页内卡片（回前台补显）
 *
 * @param {object} input
 */
export function channelDecision(input) {
    var i = input || {};
    var cfg = i.notify || DEFAULT_NOTIFY;
    var visible = i.visible !== false;
    var focused = i.focused !== false;
    if (visible && focused) {
        // sessionScoped=false：全局提醒（余额）在聚焦时只出气泡，不卡片化。
        if (i.sessionScoped === false) return { channel: 'bubble', title: false, card: false };
        // 正看着 DSH：同一会话只出气泡，别的会话出卡片（不打扰系统通知）
        if (i.sessionId && i.currentSessionId && i.sessionId === i.currentSessionId)
            return { channel: 'bubble', title: false, card: false };
        return { channel: 'card', title: false, card: true };
    }

    var systemReady =
        cfg.system !== false && i.secure === true && i.supported === true && i.permission === 'granted';
    if (systemReady) return { channel: 'system', title: false, card: false };

    // 系统通知不可用：声音是唯一「人不在页面也能感知」的通道；关掉声音则回前台补卡
    if (cfg.sound !== false) return { channel: 'sound', title: true, card: false };
    return { channel: 'none', title: true, card: true };
}

export function notifyDecision(input) {
    var i = input || {};
    var cfg = i.notify || DEFAULT_NOTIFY;
    var kind = i.kind;
    var none = { channel: 'none', title: false, card: false };
    if (NOTIFY_KINDS.indexOf(kind) === -1) return none;
    if (cfg[kind] === false) return none;
    return channelDecision(i);
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
    if (e.kind === 'error') return { title: title, body: e.message || tr('notifyErrorBody') };

    var parts = [];
    var s = e.summary || {};
    if (s.durationMs) parts.push(formatDuration(s.durationMs));
    if (s.steps) parts.push(tr('notifySteps').replace('{n}', s.steps));
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
         * 发送一条系统通知。成功返回 true；不可用/未授权/被限流/抛错返回 false，
         * 由调用方降级到声音或标题。
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
            lastByTag[tag] = at;
            recent.push(at);
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

/** 空队列 */
export function emptyNotifyQueue() {
    return { cards: [] };
}

function shownCount(cards) {
    var n = 0;
    for (var i = 0; i < cards.length; i++) if (cards[i].status === 'shown') n += 1;
    return n;
}

function withStatus(card, status) {
    return card.status === status ? card : Object.assign({}, card, { status: status });
}

/**
 * 通知队列 reducer（纯函数）。
 * 卡片结构：{ id, kind, sessionId, title, session, meta, status: 'shown'|'queued' }
 *
 * action:
 *   { type: 'enqueue', card }      入队；同 id 不重复
 *   { type: 'promote' }            页面回到前台，把排队卡片补到上限
 *   { type: 'dismiss', id }        关闭一张
 *   { type: 'resolve', sessionId } 该会话的 waiting 卡（审批已处理）自动撤下
 *   { type: 'clear' }              清空
 */
export function notifyQueueReducer(state, action, opts) {
    var current = state && Array.isArray(state.cards) ? state : emptyNotifyQueue();
    var max = (opts && opts.max) || CARD_MAX_SHOWN;
    var cap = (opts && opts.cap) || CARD_CAP;
    var cards = current.cards.slice();
    var a = action || {};

    if (a.type === 'clear') return emptyNotifyQueue();

    if (a.type === 'dismiss') {
        return {
            cards: cards.filter(function (c) {
                return c.id !== a.id;
            }),
        };
    }

    if (a.type === 'resolve') {
        return {
            cards: cards.filter(function (c) {
                return !(c.kind === 'waiting' && c.sessionId === a.sessionId);
            }),
        };
    }

    if (a.type === 'promote') {
        var shown = shownCount(cards);
        if (shown >= max) return current;
        var changed = false;
        var promoted = cards.map(function (c) {
            if (c.status === 'queued' && shown < max) {
                shown += 1;
                changed = true;
                return withStatus(c, 'shown');
            }
            return c;
        });
        return changed ? { cards: promoted } : current;
    }

    if (a.type === 'enqueue') {
        var card = a.card;
        if (!card || !card.id) return current;
        for (var i = 0; i < cards.length; i++) if (cards[i].id === card.id) return current;
        // 调用方可以强制排队（页面隐藏时先不显示，回前台再补）
        var status =
            a.status === 'queued' || a.status === 'shown'
                ? a.status
                : shownCount(cards) < max
                  ? 'shown'
                  : 'queued';
        if (status === 'shown' && shownCount(cards) >= max) status = 'queued';
        cards.push(Object.assign({}, card, { status: status }));
        // 超过总上限：先丢最旧的排队卡，再丢最旧的已显示卡
        while (cards.length > cap) {
            var idx = -1;
            for (var j = 0; j < cards.length; j++)
                if (cards[j].status === 'queued') {
                    idx = j;
                    break;
                }
            if (idx === -1) idx = 0;
            cards.splice(idx, 1);
        }
        return { cards: cards };
    }

    return current;
}

/**
 * 稳定短哈希：用于 Windows toast 的 tag（Tag 上限 16 字符）。
 * waiting 类通知需要「同一会话替换而不是新增」，所以 tag 必须稳定。
 */
export function shortHash(value) {
    var s = String(value || '');
    var h = 5381;
    for (var i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36).slice(-8);
}

/** 卡片自动消失时长（waiting 有独立兜底） */
export function cardTtl(kind) {
    return CARD_TTL[kind] || CARD_TTL.done;
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
