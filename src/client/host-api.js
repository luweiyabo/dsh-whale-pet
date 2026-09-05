// 保留旧版 API；新版通过官方 Remote 和 Session 服务适配，复用宿主鉴权及流传输。
export function resolveHostApi(connection, services = {}) {
    if (connection?.api) return connection.api;
    if (typeof connection?.rpc?.call !== 'function') return undefined;

    const call = async (endpoint, payload, signal) => {
        const result = await connection.rpc.call('/api', endpoint, { args: payload }, signal);
        if (!result?.ok) {
            throw new Error(result?.error?.message || 'Host request failed');
        }
        return { result };
    };
    const api = {
        settings: {
            describe: (_args = {}, signal) => call('settings/describe', {}, signal),
            update: (args, signal) => call('settings/update', args, signal),
        },
    };
    const { sessions, remote } = services;
    if (sessions?.list && remote?.session) {
        api.sessionList = sessions.list;
        api.sessions = {
            async models({ sessionId }, signal) {
                const projection = sessions
                    .binding(sessionId)
                    ?.session.projections.faceOf('modelSelection')
                    .getSnapshot();
                const current = projection?.next || projection?.lastUsed;
                if (current) return { result: { ok: true, value: { current } } };
                const response = await call('session/modelCatalog', {}, signal);
                return { result: { ok: true, value: { current: response.result.value.default } } };
            },
        };
        api.subscribeActivity = (emit, options) => subscribeSessionActivity(services, emit, options);
    }
    return api;
}

// control 流由 sessions 服务维护。仅为当前/正在运行的会话开只读 follow，
// 不下载全部历史，不激活 Agent，也不参与审批/问答的回答链。
export function subscribeSessionActivity({ sessions, remote, uiSession }, emit, options = {}) {
    const watches = new Map();
    let disposed = false;
    const pending = uiSession?.pendingInteractions;
    const send = (frame) => {
        if (!disposed) emit(frame);
    };
    const interaction = (id, snapshot = true) => {
        if (!pending) return;
        const watch = watches.get(id);
        const current = pending.getSnapshot().get(id);
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
            for await (const frame of remote.session.follow({ address, maxMessages: 1 }, controller.signal)) {
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
        const ids = new Set(list.current ? [list.current] : []);
        if (options.scope !== 'current')
            for (const id of list.ids || []) {
                if (list.byId[id]?.running) ids.add(id);
            }
        for (const [id, watch] of watches)
            if (!ids.has(id)) {
                // control 的 idle 可能先于 follow 的 turn/end 到达，留出收尾窗口。
                if (options.scope === 'current' || !list.byId[id]) stopWatch(id, watch);
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
                    const update = () => {
                        const snapshot = session.getSnapshot();
                        if (snapshot.queue !== queue) {
                            queue = snapshot.queue;
                            send({ type: 'session/queue', sessionId: id, items: queue });
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
            const running = !!list.byId[id]?.running;
            if (watch.running !== running) {
                watch.running = running;
                send({ type: 'host/session-status', sessionId: id, running });
            }
        }
    };
    const unsubscribe = sessions.list.subscribe(reconcile);
    const unsubscribePending = pending?.subscribe(() => {
        for (const id of watches.keys()) interaction(id, false);
    });
    reconcile();
    return () => {
        disposed = true;
        unsubscribe();
        unsubscribePending?.();
        for (const [id, watch] of watches) stopWatch(id, watch);
    };
}
