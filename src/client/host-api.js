// 运行时特性探测，兼容三个宿主世代：
//   - 0.1.0 旧版：connection.api 直接透传
//   - 0.1.2     ：connection.rpc.call → settings/describe|update + sessions/remote/uiSession
//   - 0.2.0     ：无 connection，设置走 typert Remote 子服务 remote.settings（惰性等待）
// 会话活动订阅在任一具备 sessions.list + remote.session 的世代都接线。
function settingsOf(getSettings) {
    try {
        const s = getSettings();
        return s && typeof s.describe === 'function' && typeof s.update === 'function' ? s : null;
    } catch {
        return null;
    }
}

// remote.settings 是远端连接建立后才就绪的子服务，快速重载/刷新时可能晚于 apply。
// 因此收到的是惰性取值函数，真正读写时才轮询等它就绪。
function waitForSettings(getSettings, timeoutMs = 15000) {
    const s = settingsOf(getSettings);
    if (s) return Promise.resolve(s);
    return new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
            const svc = settingsOf(getSettings);
            if (svc) return resolve(svc);
            if (Date.now() - started >= timeoutMs) return resolve(null);
            setTimeout(poll, 250);
        };
        poll();
    });
}

// 0.2.x 的 typert Remote「直接调用」同样把返回值包成 `{ ok, value }` 信封
// （宿主调用失败时 `ok=false` + `error`），而 0.1.x 的旧适配层直接返回裸值。
// 这里统一拆信封，调用方只看到裸结果（如 account.getBalance 的 ready / failed / null）。
function unwrapRemoteResult(result) {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return result;
    if (!Object.prototype.hasOwnProperty.call(result, 'ok')) return result;
    if (result.ok !== true) {
        const error = new Error((result.error && result.error.message) || 'Host remote call failed');
        error.code = (result.error && (result.error.code || result.error.name)) || 'REMOTE_FAILED';
        throw error;
    }
    return result.value;
}

// 0.2.0 typert Remote 子服务适配：direct 方法返回 { ok, value, error } 信封，
// describe() → { ok:true, value:{ writable, hasDocument, namespaces } }。
// 内部契约保持旧形状 { result:{ ok, value:{ namespaces } } }，供 createConfigStore 复用。
function remoteSettingsAdapter(getSettings, timeoutMs) {
    var waitMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000;
    return {
        describe: (_args = {}, _signal) =>
            waitForSettings(getSettings, waitMs).then((svc) => {
                if (!svc) return { result: { ok: false, value: null } };
                return svc.describe().then((r) => ({
                    result: {
                        ok: !!(r && r.ok),
                        value: r && r.ok && r.value ? { namespaces: r.value.namespaces } : null,
                    },
                }));
            }),
        update: (args, _signal) =>
            waitForSettings(getSettings, waitMs).then((svc) => {
                if (!svc) throw new Error('Host settings not ready');
                // host 侧签名 update(ns, patch, expectedRevision) 是严格元数校验，必须显式补足 3 个实参。
                return svc.update(args.ns, args.patch, args.expectedRevision).then((r) => {
                    if (!r || r.ok !== true) {
                        throw new Error((r && r.error && r.error.message) || 'Host settings update failed');
                    }
                    return r.value;
                });
            }),
    };
}

export function resolveHostApi(connection, services = {}) {
    if (connection?.api) return connection.api;

    const { sessions, remote, remoteAccount, uiSession, getSettings, modern, modelDirectories } = services;

    let call = null;
    let settings;
    if (modern === true && typeof getSettings === 'function') {
        // 0.2.0：连接已改协议，设置必须走 typert Remote 子服务 remote.settings。
        settings = remoteSettingsAdapter(getSettings, services.settingsTimeoutMs);
    } else if (typeof connection?.rpc?.call === 'function') {
        // 0.1.2：宿主 RPC 转发设置读写。
        call = async (endpoint, payload, signal) => {
            const result = await connection.rpc.call('/api', endpoint, { args: payload }, signal);
            if (!result?.ok) {
                throw new Error(result?.error?.message || 'Host request failed');
            }
            return { result };
        };
        settings = {
            describe: (_args = {}, signal) => call('settings/describe', {}, signal),
            update: (args, signal) => call('settings/update', args, signal),
        };
    } else if (typeof getSettings === 'function') {
        settings = remoteSettingsAdapter(getSettings, services.settingsTimeoutMs);
    } else {
        return undefined;
    }

    // remote.session 子服务在 0.2.0 需按服务名取（ctx.get('remote.session')），
    // 直接读 remote.session 属性会被 cordis 的 inject 守卫拒绝。0.1.x 回落属性访问。
    let remoteSession = services.remoteSession;
    if (remoteSession === undefined && remote) {
        try {
            remoteSession = remote.session;
        } catch {
            remoteSession = undefined;
        }
    }

    const api = { settings };
    if (uiSession && uiSession.current && typeof uiSession.current.getSnapshot === 'function') {
        api.uiSession = uiSession;
    }
    // 子代理（subagent）会话判定：宿主把子代理实现成独立的子会话，它们会出现在
    // 会话列表里（flattenLineage 按 parentId 缩进）、也会各自发 turn/end，
    // 但「用户在对话的会话」只有父会话 —— 子代理完成不该弹任何提示。
    // 依据两条，任一命中即算子代理：
    //   1. 列表行 origin === 'subagent'（宿主 SessionSummary 的官方标记）；
    //   2. sessions.subagentAddress(id)：按父会话的 subagentCatalog 派生（子代理
    //      刚结束、目录尚未刷新时仍能认出来）。
    // 注意不能用 parentId 判断：普通 fork 也会带 parentId。
    if (sessions) {
        api.isSubagentSession = (sessionId) => {
            if (!sessionId) return false;
            try {
                if (typeof sessions.subagentAddress === 'function') {
                    if (sessions.subagentAddress(sessionId) !== undefined) return true;
                }
            } catch {
                // 旧宿主没有该方法：继续用列表行判定
            }
            try {
                const row = sessions.list?.getSnapshot?.()?.byId?.[sessionId];
                return !!(row && row.origin === 'subagent');
            } catch {
                return false;
            }
        };
    }
    // account 余额走 Remote（账户登录态），不经过 API-key 路由；
    // 软获取失败时不暴露该方法，由宠物侧显示 account-unavailable。
    // 最近版 typert Remote 的直接调用返回 `{ ok, value }` 信封（旧宿主返回裸值）；
    // 这里拆掉信封，避免把 `{ ok, value }` 误判成 `{ status: 'failed' }` 而报"账户查询失败"。
    if (remoteAccount && typeof remoteAccount.getBalance === 'function') {
        api.account = {
            getBalance(metadata) {
                return Promise.resolve(remoteAccount.getBalance(metadata)).then(unwrapRemoteResult);
            },
        };
    }
    if (sessions?.list) {
        api.sessionList = sessions.list;
        api.sessions = {
            async models({ sessionId }, signal) {
                // 官方 model directory 同时合并「会话选择」与「目录默认模型」。
                // 新会话的 modelSelection 投影为空，但用户已经选了模型时，current 只在这里。
                if (modelDirectories && typeof modelDirectories.directoryFor === 'function') {
                    try {
                        const directory = modelDirectories.directoryFor(sessionId);
                        if (directory && typeof directory.load === 'function') await directory.load();
                        const state =
                            directory && directory.store && directory.store.getSnapshot
                                ? directory.store.getSnapshot()
                                : null;
                        const chosen =
                            state && state.current && state.current.provider && state.current.model
                                ? state.current
                                : state && state.pending && state.pending.provider && state.pending.model
                                  ? state.pending
                                  : null;
                        if (chosen) return { result: { ok: true, value: { current: chosen } } };
                    } catch {
                        /* 子代理/旧宿主没有可用目录：继续读投影 */
                    }
                }
                // 会话刚打开时 modelSelection 投影可能还没拉取。先让宿主补投影，
                // 否则 0.2.x 会一直停在"等待模型调用"，哪怕会话早已选好模型。
                if (typeof sessions.refreshProjections === 'function') {
                    try {
                        await sessions.refreshProjections(sessionId);
                    } catch {
                        /* 离线/旧宿主：继续读现有投影 */
                    }
                }
                let projection;
                try {
                    projection = sessions
                        .binding?.(sessionId)
                        ?.session.projections.faceOf('modelSelection')
                        .getSnapshot();
                } catch {
                    projection = undefined;
                }
                const current = projection?.next || projection?.lastUsed;
                if (current) return { result: { ok: true, value: { current } } };
                // 官方 modelCatalog 同时给出目录默认模型：新会话/投影尚未落盘时，
                // 这里就是 UI 当前显示的选择，不需要等一次模型调用。
                if (remoteSession && typeof remoteSession.modelCatalog === 'function') {
                    try {
                        const response = await remoteSession.modelCatalog();
                        if (response && response.ok && response.value && response.value.default) {
                            return { result: { ok: true, value: { current: response.value.default } } };
                        }
                    } catch {
                        /* 目录尚未就绪：继续旧宿主 RPC */
                    }
                }
                if (!call) return { result: { ok: true, value: { current: undefined } } };
                const response = await call('session/modelCatalog', {}, signal);
                return { result: { ok: true, value: { current: response.result.value.default } } };
            },
        };
        if (remoteSession) {
            api.subscribeActivity = (emit, options) =>
                subscribeSessionActivity({ ...services, remoteSession }, emit, options);
        }
    }
    return api;
}

// control 流由 sessions 服务维护。仅为当前/正在运行的会话开只读 follow，
// 不下载全部历史，不激活 Agent，也不参与审批/问答的回答链。
export function subscribeSessionActivity({ sessions, remote, remoteSession, uiSession }, emit, options = {}) {
    // 0.2.0：remote.session 经 ctx.get('remote.session') 服务名取得（见 resolveHostApi）。
    const follow = remoteSession ?? (remote ? remote.session : undefined);
    const watches = new Map();
    let disposed = false;
    // 0.1.2：uiSession.pendingInteractions（Map<id,{key,kind}>）。
    // 0.2.0：uiSession.sessionStatus（Map<id,{running,pendingInteraction:{key,kind}}>）。
    const pending = uiSession?.pendingInteractions ?? uiSession?.sessionStatus;
    const statusStore = uiSession?.sessionStatus;
    // running 判定：0.2.0 以 uiSession.sessionStatus（Map<id,{running,...}>）为准；
    // 0.1.2 回落到 sessions.list.byId[id].running。
    const runningOf = (id, listSnapshot) => {
        if (statusStore && typeof statusStore.getSnapshot === 'function') {
            const snap = statusStore.getSnapshot();
            const entry = snap && typeof snap.get === 'function' ? snap.get(id) : undefined;
            if (entry && typeof entry.running === 'boolean') return entry.running;
        }
        const list = listSnapshot ?? sessions?.list?.getSnapshot?.();
        return !!list?.byId?.[id]?.running;
    };
    const send = (frame) => {
        if (!disposed) emit(frame);
    };
    const interaction = (id, snapshot = true) => {
        if (!pending) return;
        const watch = watches.get(id);
        const raw = pending.getSnapshot().get(id);
        // 0.2.0：sessionStatus 条目是 {running,pendingInteraction,...}，交互在 pendingInteraction；
        // 0.1.2：pendingInteractions 条目本身就是交互 {key,kind}。
        const current = statusStore ? raw?.pendingInteraction : raw;
        if (!snapshot && watch.pending === current?.key) return;
        const kind = (current?.kind || watch.pendingKind) === 'approval' ? 'approval' : 'question';
        watch.pending = current?.key;
        watch.pendingKind = current?.kind;
        send({ type: kind + (current ? '/requested' : '/resolved'), sessionId: id, snapshot });
    };
    const stopWatch = (id, watch) => {
        watches.delete(id);
        watch.controller?.abort();
        watch.unsubscribe?.();
        clearTimeout(watch.timer);
        clearTimeout(watch.retireTimer);
        send({ type: 'activity/reset', sessionId: id });
    };
    const open = async (id, watch) => {
        const controller = new AbortController();
        watch.controller = controller;
        try {
            const child = sessions.subagentAddress?.(id);
            const address = child ? { kind: 'subagent', ...child } : { kind: 'session', sessionId: id };
            for await (const frame of follow.follow(
                { address, assistantStream: true, maxMessages: 1 },
                controller.signal
            )) {
                if (disposed || controller.signal.aborted || watches.get(id) !== watch) break;
                if (frame.type === 'snapshot') {
                    watch.cursor = frame.cursor;
                    send({ type: 'activity/reset', sessionId: id });
                    // 只恢复当前未结束回合的状态；历史不触发规则、用量查询或错误气泡。
                    const records = frame.records || [];
                    let start = -1;
                    for (let i = 0; i < records.length; i++) {
                        if (records[i].event?.type === 'turn/start') start = i;
                        if (records[i].event?.type === 'turn/end') start = -1;
                    }
                    if (start >= 0 && watch.running)
                        for (const record of records.slice(start)) {
                            if (record.type === 'event')
                                send({
                                    type: 'session/event',
                                    sessionId: id,
                                    event: record.event,
                                    snapshot: true,
                                });
                        }
                    const model = frame.projections?.values?.modelSelection;
                    if (model?.next || model?.lastUsed)
                        send({
                            type: 'session/event',
                            sessionId: id,
                            event: { type: 'model/selection', data: model.next || model.lastUsed },
                            snapshot: true,
                        });
                    send({
                        type: 'host/session-status',
                        sessionId: id,
                        running: watch.running,
                        snapshot: true,
                    });
                    interaction(id);
                } else if (frame.type === 'assistant-stream') {
                    // 0.2.0 的模型流式输出走独立的 assistant-stream 帧（非 session/event）；
                    // 归一化为既有的 assistant/chunk 会话事件，交由事件动作映射处理。
                    send({
                        type: 'session/event',
                        sessionId: id,
                        event: { type: 'assistant/chunk', data: frame.frame || {} },
                    });
                } else if (frame.type === 'event' && frame.event.seq > watch.cursor) {
                    watch.cursor = frame.event.seq;
                    send({ type: 'session/event', sessionId: id, event: frame.event });
                    const alias = {
                        'approval/asked': 'approval/requested',
                        'approval/decided': 'approval/resolved',
                    }[frame.event.type];
                    if (alias) send({ type: alias, sessionId: id });
                    if (frame.event.type === 'turn/end' && frame.event.data?.reason?.kind === 'error')
                        send({ type: 'host/agent-error', sessionId: id });
                }
            }
        } catch {
            // Remote 负责鉴权及宿主代际；本订阅在流结束后重新获取权威快照。
        }
        if (!disposed && !controller.signal.aborted && watches.get(id) === watch) {
            send({ type: 'activity/reset', sessionId: id });
            watch.timer = setTimeout(() => open(id, watch), options.reconnectMs ?? 2000);
        }
    };
    const reconcile = () => {
        const list = sessions.list.getSnapshot();
        // 0.1.2：list 快照含 current；0.2.0：list 不再含 current，改由 uiSession.current 提供。
        const currentId = list.current ?? uiSession?.current?.getSnapshot?.()?.key;
        const ids = new Set(currentId ? [currentId] : []);
        // watchAllRunning：完成提示要收到的后台会话事件不受 scope 限制。
        // 只 follow「正在运行」的会话，idle 会话不订阅，避免无意义的历史拉取。
        const watchAll = options.watchAllRunning === true;
        if (options.scope !== 'current' || watchAll)
            for (const id of list.ids || []) {
                if (runningOf(id, list)) ids.add(id);
            }
        for (const [id, watch] of watches)
            if (!ids.has(id)) {
                // control 的 idle 可能先于 follow 的 turn/end 到达，留出收尾窗口。
                // watchAllRunning 时即使 scope=current 也不能立刻停掉后台会话——
                // 那正是「切走会话后完成提示」依赖的事件来源。
                if ((!watchAll && options.scope === 'current') || !list.byId[id]) stopWatch(id, watch);
                else if (!watch.retireTimer) watch.retireTimer = setTimeout(() => stopWatch(id, watch), 4000);
            }
        for (const id of ids) {
            let watch = watches.get(id);
            if (!watch) {
                watch = { cursor: -1, running: undefined };
                watches.set(id, watch);
                const session = sessions.binding?.(id)?.session;
                if (session?.subscribe) {
                    let queue;
                    let queueKey;
                    const update = () => {
                        const snapshot = session.getSnapshot();
                        // 0.1.2：snapshot.queue；0.2.0：queue 并入 pendingSubmissions
                        // （placement === 'queued' 表示排队中的用户消息）。
                        if (snapshot.queue !== undefined) {
                            if (snapshot.queue !== queue) {
                                queue = snapshot.queue;
                                send({ type: 'session/queue', sessionId: id, items: queue });
                            }
                            return;
                        }
                        const pendingSubmissions = Array.isArray(snapshot.pendingSubmissions)
                            ? snapshot.pendingSubmissions
                            : [];
                        const queued = pendingSubmissions.filter(
                            (echo) => echo && echo.placement === 'queued'
                        );
                        const key = queued.map((echo) => echo.requestId).join(',');
                        if (key !== queueKey) {
                            queueKey = key;
                            send({ type: 'session/queue', sessionId: id, items: queued });
                        }
                    };
                    watch.unsubscribe = session.subscribe(update);
                    update();
                }
                void open(id, watch);
                interaction(id);
            }
            clearTimeout(watch.retireTimer);
            watch.retireTimer = null;
            const running = runningOf(id, list);
            if (watch.running !== running) {
                watch.running = running;
                send({ type: 'host/session-status', sessionId: id, running });
            }
        }
    };
    const unsubscribe = sessions.list.subscribe(reconcile);
    // 0.2.0：running 变更经 sessionStatus 发布，未必触发 sessions.list；需订阅它重算。
    const unsubscribeStatus =
        statusStore && typeof statusStore.subscribe === 'function'
            ? statusStore.subscribe(() => reconcile())
            : null;
    const unsubscribePending = pending?.subscribe(() => {
        for (const id of watches.keys()) interaction(id, false);
    });
    reconcile();
    return () => {
        disposed = true;
        unsubscribe();
        unsubscribeStatus?.();
        unsubscribePending?.();
        for (const [id, watch] of watches) stopWatch(id, watch);
    };
}
