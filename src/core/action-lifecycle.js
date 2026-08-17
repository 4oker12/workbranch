(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.actionLifecycle) return;

  const TERMINAL = new Set(['COMPLETED', 'INTERRUPTED', 'REJECTED', 'TIMEOUT', 'FAILED', 'DISMISSED']);
  // DIRECT_REPLAY may complete from NAVIGATING / DESTINATION_REACHED (teleport).
  // GUIDED keeps Focus stages. Validator stays strict — no SHOWN→NAVIGATING.
  const ALLOWED = Object.freeze({
    REQUESTED: new Set(['NAVIGATING', 'DESTINATION_REACHED', 'WAITING_TARGET', 'TARGET_READY', 'REJECTED', 'INTERRUPTED', 'FAILED', 'TIMEOUT', 'DISMISSED', 'COMPLETED']),
    NAVIGATING: new Set(['DESTINATION_REACHED', 'WAITING_TARGET', 'TARGET_READY', 'COMPLETED', 'INTERRUPTED', 'FAILED', 'TIMEOUT', 'DISMISSED']),
    DESTINATION_REACHED: new Set(['WAITING_TARGET', 'TARGET_READY', 'COMPLETED', 'INTERRUPTED', 'FAILED', 'TIMEOUT', 'DISMISSED']),
    WAITING_TARGET: new Set(['TARGET_READY', 'COMPLETED', 'INTERRUPTED', 'FAILED', 'TIMEOUT', 'DISMISSED']),
    TARGET_READY: new Set(['SHOWN', 'COMPLETED', 'INTERRUPTED', 'FAILED', 'TIMEOUT', 'DISMISSED']),
    SHOWN: new Set(['COMPLETED', 'INTERRUPTED', 'FAILED', 'TIMEOUT', 'DISMISSED']),
    COMPLETED: new Set(),
    INTERRUPTED: new Set(),
    REJECTED: new Set(),
    TIMEOUT: new Set(),
    FAILED: new Set(),
    DISMISSED: new Set()
  });
  const DIRECT_INTENTS = new Set(['DIRECT_REPLAY', 'DIRECT_NAVIGATION']);
  const NAVIGATION_LOCK_STATES = new Set(['REQUESTED', 'NAVIGATING', 'DESTINATION_REACHED', 'WAITING_TARGET', 'TARGET_READY', 'SHOWN']);

  const DEFAULT_TARGET_TIMEOUT_MS = 12000;
  const REBIND_GRACE_MS = 1600;
  const PERSIST_CAP = 4000;
  const resolvers = new Map();
  const state = {
    current: null,
    timer: null,
    rebindTimer: null,
    interruptionListener: null,
    persistPromise: Promise.resolve(),
    persistDesired: null,
    persistDrainRunning: false,
    syncing: false,
    lastPersisted: ''
  };

  const nowIso = () => new Date().toISOString();
  const compact = (value, max = 300) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };
  const clonePlain = value => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
  };
  const activeCase = () => WB.store?.activeCase?.() || null;
  const activeCaseId = () => String(activeCase()?.id || WB.store?.localCaseId || '');
  const context = () => WB.runtime?.lastContext || activeCase()?.currentContext || {};
  const operationId = prefix => `${prefix || 'action'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

  function semanticForPlanId(planId = '') {
    const id = String(planId || '');
    if (id === 'billing.open-technical' || id === 'billing.resume-technical' || id.startsWith('billing.reopen-technical')) return 'billing.technical';
    if (id === 'userside.find-tmc' || id.startsWith('userside.inspect-tmc:') || id === 'billing.open-userside' || id === 'billing.return-for-userside' || id === 'billing.resume-userside-tmc') return 'userside.tmc';
    if (id === 'billing.open-poll-tab' || id === 'billing.switch-correct-poll-tab' || id === 'billing.return-card-for-poll') return 'billing.poll.entry';
    if (id === 'billing.ask-olt') return 'billing.olt.request';
    if (id === 'billing.open-juniper' || id === 'billing.inspect-juniper') return 'billing.juniper';
    if (id === 'replay.technical') return 'billing.technical';
    if (id === 'replay.tmc') return 'userside.tmc';
    if (id === 'replay.poll') return 'billing.poll.entry';
    if (id === 'replay.juniper') return 'billing.juniper';
    return id ? `guide.${id}` : 'guide.unknown';
  }

  function destinationMatches(session, page = context()) {
    if (!session) return false;
    if (session.destinationSystem && page.system && session.destinationSystem !== page.system) return false;
    if (session.destinationPageKind && page.pageKind && session.destinationPageKind !== page.pageKind) return false;
    const expectedEntity = String(session.destinationEntityId || '');
    if (expectedEntity && page.entityId && expectedEntity !== String(page.entityId)) return false;
    return true;
  }

  function sanitizedSession(session) {
    if (!session) return null;
    const copy = {
      operationId: compact(session.operationId, 100),
      operationType: compact(session.operationType, 100),
      intent: compact(session.intent, 40),
      navigationCapable: Boolean(session.navigationCapable),
      caseId: compact(session.caseId, 140),
      targetType: compact(session.targetType, 80),
      semanticTargetId: compact(session.semanticTargetId, 160),
      sourceSystem: compact(session.sourceSystem, 40),
      sourcePageKind: compact(session.sourcePageKind, 80),
      destinationSystem: compact(session.destinationSystem, 40),
      destinationPageKind: compact(session.destinationPageKind, 80),
      destinationEntityId: compact(session.destinationEntityId, 80),
      status: compact(session.status, 40),
      requestedAt: compact(session.requestedAt, 50),
      navigationStartedAt: compact(session.navigationStartedAt, 50),
      destinationReachedAt: compact(session.destinationReachedAt, 50),
      targetReadyAt: compact(session.targetReadyAt, 50),
      shownAt: compact(session.shownAt, 50),
      completedAt: compact(session.completedAt, 50),
      expectedPostCondition: compact(session.expectedPostCondition, 600),
      actualResult: compact(session.actualResult, 600),
      completionReason: compact(session.completionReason, 160),
      failureReason: compact(session.failureReason, 240),
      sourceAction: compact(session.sourceAction, 100),
      title: compact(session.title, 220),
      text: compact(session.text, 360),
      replayOnly: Boolean(session.replayOnly),
      planId: compact(session.planId, 160),
      targetTimeoutMs: Math.max(0, Math.min(60000, Number(session.targetTimeoutMs || DEFAULT_TARGET_TIMEOUT_MS))),
      showCount: Math.max(0, Number(session.showCount || 0)),
      rebindCount: Math.max(0, Number(session.rebindCount || 0)),
      lastTransitionAt: compact(session.lastTransitionAt, 50),
      terminalDiagnosticRecorded: Boolean(session.terminalDiagnosticRecorded)
    };
    return copy;
  }

  function trace(type, details = {}) {
    try {
      WB.operatorTrace?.recordSystemEvent?.(type, {
        operationId: state.current?.operationId || details.operationId || '',
        semanticTargetId: state.current?.semanticTargetId || details.semanticTargetId || '',
        actionStatus: state.current?.status || details.status || '',
        ...details
      });
    } catch {}
  }

  function diagnostic(severity, code, session, message, details = {}) {
    const payload = {
      severity,
      code,
      operationType: session?.operationType || 'GUIDED_ACTION',
      operationId: session?.operationId || '',
      source: 'action-lifecycle',
      stage: session?.status || '',
      message,
      reason: session?.failureReason || session?.completionReason || '',
      details: {
        caseId: session?.caseId || '',
        semanticTargetId: session?.semanticTargetId || '',
        planId: session?.planId || '',
        status: session?.status || '',
        pageKind: context().pageKind || '',
        documentId: context().documentId || '',
        ...details
      }
    };
    void WB.observability?.report?.(payload).catch?.(() => {});
  }

  function persistedRecord(session = state.current) {
    const snapshot = sanitizedSession(session);
    const terminal = Boolean(snapshot && TERMINAL.has(String(snapshot.status || '')));
    const patch = terminal
      ? { active: null, lastTerminal: snapshot }
      : { active: snapshot };
    return {
      patch,
      raw: JSON.stringify(patch).slice(0, PERSIST_CAP),
      caseId: String(session?.caseId || ''),
      operationId: String(session?.operationId || ''),
      operationType: String(session?.operationType || 'GUIDED_ACTION'),
      status: String(session?.status || ''),
      semanticTargetId: String(session?.semanticTargetId || '')
    };
  }

  async function drainPersistence() {
    if (state.persistDrainRunning) return;
    state.persistDrainRunning = true;
    try {
      while (state.persistDesired) {
        const item = state.persistDesired;
        state.persistDesired = null;
        if (!item?.caseId || !WB.store?.patchWorkflow) continue;
        if (item.raw === state.lastPersisted) continue;
        try {
          await WB.store.patchWorkflow('actionSession', item.patch);
          state.lastPersisted = item.raw;
        } catch (error) {
          void WB.observability?.report?.({
            severity: 'ERROR',
            code: 'ACTION_SESSION_PERSIST_FAILED',
            operationType: item.operationType || 'GUIDED_ACTION',
            operationId: item.operationId || '',
            source: 'action-lifecycle',
            stage: item.status || '',
            message: error?.message || 'Не удалось сохранить lifecycle управляемого действия',
            error,
            details: { caseId: item.caseId || '', semanticTargetId: item.semanticTargetId || '' }
          });
        }
      }
    } finally {
      state.persistDrainRunning = false;
    }
  }

  function persist(session = state.current) {
    if (!session?.caseId || !WB.store?.patchWorkflow) return state.persistPromise;
    const item = persistedRecord(session);
    if (item.raw === state.lastPersisted && !state.persistDesired) return state.persistPromise;

    // Keep only the newest snapshot while a write is queued/in flight. Rapid
    // REQUESTED → NAVIGATING → DESTINATION_REACHED transitions therefore cost
    // one durable Case write instead of serializing every intermediate state.
    state.persistDesired = item;
    if (!state.persistDrainRunning) {
      state.persistPromise = Promise.resolve()
        .then(() => drainPersistence())
        .catch(() => {});
    }
    return state.persistPromise;
  }

  function clearTimers() {
    if (state.timer) clearTimeout(state.timer);
    if (state.rebindTimer) clearTimeout(state.rebindTimer);
    state.timer = null;
    state.rebindTimer = null;
  }

  function armTargetTimeout(session) {
    if (!session || TERMINAL.has(session.status)) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      return;
    }
    if (!['NAVIGATING', 'DESTINATION_REACHED', 'WAITING_TARGET', 'TARGET_READY'].includes(session.status)) {
      // Critical invariant: SHOWN has no TTL. Cancel any acquisition timer
      // inherited from WAITING_TARGET/TARGET_READY as soon as Focus is shown.
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    const started = Date.parse(session.requestedAt || '') || Date.now();
    const timeoutMs = Math.max(1000, Number(session.targetTimeoutMs || DEFAULT_TARGET_TIMEOUT_MS));
    const remaining = Math.max(50, timeoutMs - (Date.now() - started));
    state.timer = setTimeout(() => {
      if (!state.current || state.current.operationId !== session.operationId || TERMINAL.has(state.current.status)) return;
      timeout(state.current, 'target-timeout', {
        expected: state.current.expectedPostCondition || 'semantic target must become ready'
      });
    }, remaining);
  }

  function clearInterruptionGuard() {
    if (!state.interruptionListener || typeof document === 'undefined') {
      state.interruptionListener = null;
      return;
    }
    try { document.removeEventListener('click', state.interruptionListener, true); } catch {}
    state.interruptionListener = null;
  }

  function workbenchOwnedEvent(event) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    const nodes = path.length ? path : [event?.target];
    return nodes.some(node => {
      if (!node || node.nodeType !== 1) return false;
      const id = String(node.getAttribute?.('id') || '');
      if (/^simnet-(?:workbench|graph|data-audit)/i.test(id)) return true;
      return Boolean(node.hasAttribute?.('data-simnet-wb-owned') || node.closest?.('[data-simnet-wb-owned],#simnet-workbench-rail-host,#simnet-workbench-guide-overlay'));
    });
  }

  function armInterruptionGuard(session = state.current) {
    clearInterruptionGuard();
    if (!session || TERMINAL.has(session.status) || session.status === 'SHOWN' || typeof document === 'undefined' || !document.addEventListener) return;
    const opId = session.operationId;
    state.interruptionListener = event => {
      const current = state.current;
      if (!current || current.operationId !== opId || TERMINAL.has(current.status) || current.status === 'SHOWN') return;
      if (workbenchOwnedEvent(event)) return;
      const raw = (typeof event?.composedPath === 'function' ? event.composedPath() : []).find(node => node?.nodeType === 1) || event?.target || null;
      const resolved = resolve(current, activeCase());
      if (resolved?.found && raw && (resolved.element === raw || resolved.element.contains?.(raw))) {
        if (['DESTINATION_REACHED', 'WAITING_TARGET'].includes(current.status)) targetReady(current, { actualResult: 'manual-target-activation' });
        complete(current, 'TARGET_ACTIVATED_MANUALLY', 'operator activated semantic target before Focus');
        return;
      }
      interrupt(current, 'USER_INTERRUPTED');
    };
    try { document.addEventListener('click', state.interruptionListener, true); } catch { state.interruptionListener = null; }
  }

  function isAllowed(from, to) {
    if (!from) return to === 'REQUESTED';
    return Boolean(ALLOWED[from]?.has(to));
  }

  function transition(session, nextStatus, patch = {}, options = {}) {
    if (!session || state.current?.operationId !== session.operationId) return { ok: false, reason: 'foreign-session' };
    const prev = String(session.status || '');
    const next = String(nextStatus || '');
    if (prev === next) return { ok: true, unchanged: true, session };
    if (!isAllowed(prev, next)) {
      diagnostic('ERROR', 'ACTION_ILLEGAL_STATE_TRANSITION', session, `Недопустимый lifecycle transition ${prev} → ${next}`, { previousState: prev, nextState: next });
      trace('ACTION_ILLEGAL_STATE_TRANSITION', { previousState: prev, nextState: next });
      return { ok: false, reason: 'illegal-transition', previousState: prev, nextState: next };
    }

    Object.assign(session, clonePlain(patch) || {});
    session.status = next;
    session.lastTransitionAt = nowIso();
    if (next === 'NAVIGATING') session.navigationStartedAt ||= session.lastTransitionAt;
    if (next === 'DESTINATION_REACHED') session.destinationReachedAt ||= session.lastTransitionAt;
    if (next === 'TARGET_READY') session.targetReadyAt ||= session.lastTransitionAt;
    if (next === 'SHOWN') {
      session.shownAt ||= session.lastTransitionAt;
      session.showCount = Number(session.showCount || 0) + 1;
      if (session.showCount > 1) {
        diagnostic('ERROR', 'ACTION_FOCUS_REOPEN_LOOP', session, 'Одна ActionSession повторно показала Focus без нового explicit action', { showCount: session.showCount });
      }
    }
    if (TERMINAL.has(next)) session.completedAt ||= session.lastTransitionAt;

    trace('ACTION_STATE', { previousState: prev, nextState: next, reason: patch.failureReason || patch.completionReason || '' });
    void persist(session);
    if (TERMINAL.has(next)) {
      clearTimers();
      clearInterruptionGuard();
      if (['FAILED', 'TIMEOUT'].includes(next) && !session.terminalDiagnosticRecorded && !options.deferTerminalDiagnostic) {
        session.terminalDiagnosticRecorded = true;
        diagnostic(next === 'TIMEOUT' ? 'WARNING' : 'ERROR', next === 'TIMEOUT' ? 'ACTION_TARGET_TIMEOUT' : 'ACTION_FAILED', session, next === 'TIMEOUT' ? 'Управляемое действие не достигло ожидаемого состояния вовремя' : 'Управляемое действие завершилось ошибкой');
        void persist(session);
      }
    } else {
      armTargetTimeout(session);
      if (next === 'SHOWN') clearInterruptionGuard();
      else armInterruptionGuard(session);
    }
    WB.bus?.emit?.('action:lifecycle', { session: sanitizedSession(session), previousState: prev, nextState: next });
    return { ok: true, session };
  }

  function start(spec = {}) {
    const caseId = String(spec.caseId || activeCaseId() || '');
    if (!caseId) return { ok: false, reason: 'case-missing' };
    const semanticTargetIdEarly = compact(spec.semanticTargetId || semanticForPlanId(spec.planId), 160);
    const intent = compact(
      spec.intent
      || (spec.replayOnly ? 'DIRECT_REPLAY' : '')
      || (String(spec.operationType || '').includes('DIRECT_REPLAY') ? 'DIRECT_REPLAY' : '')
      || 'GUIDED_NAVIGATION',
      40
    );
    const navigationCapable = spec.navigationCapable !== false
      && ['DIRECT_REPLAY', 'DIRECT_NAVIGATION', 'GUIDED_NAVIGATION'].includes(intent);
    if (
      state.current
      && !TERMINAL.has(state.current.status)
      && String(state.current.caseId || '') === caseId
      && String(state.current.semanticTargetId || '') === semanticTargetIdEarly
    ) {
      try {
        WB.operatorTrace?.recordSystemEvent?.('ACTION_DUPLICATE_SUPPRESSED', {
          operationId: state.current.operationId,
          semanticTargetId: semanticTargetIdEarly,
          status: state.current.status
        });
        WB.observability?.report?.({
          severity: 'INFO',
          code: 'BILLING_NAVIGATION_DUPLICATE_BLOCKED',
          operationType: state.current.operationType || 'ACTION',
          source: 'action-lifecycle',
          stage: 'START',
          message: 'Повторный click подавлен — активна существующая ActionSession',
          operationId: state.current.operationId
        });
      } catch {}
      return { ok: true, session: state.current, duplicate: true };
    }
    if (
      state.current
      && !TERMINAL.has(state.current.status)
      && navigationCapable
      && state.current.navigationCapable !== false
      && NAVIGATION_LOCK_STATES.has(String(state.current.status || ''))
    ) {
      WB.performanceMonitor?.count?.('navigationActionsSuppressed');
      trace('NAVIGATION_ACTION_BLOCKED_BY_LOCK', {
        operationId: state.current.operationId,
        ownerOperationId: state.current.operationId,
        attemptedSemanticTargetId: semanticTargetIdEarly,
        attemptedIntent: intent,
        status: state.current.status
      });
      diagnostic('INFO', 'NAVIGATION_ACTION_BLOCKED_BY_LOCK', state.current, 'Новый Workbench navigation action подавлен: предыдущий переход ещё не завершён', {
        ownerOperationId: state.current.operationId,
        attemptedSemanticTargetId: semanticTargetIdEarly,
        attemptedIntent: intent
      });
      return { ok: false, blocked: true, reason: 'navigation-locked', ownerSession: state.current };
    }
    if (state.current && !TERMINAL.has(state.current.status)) {
      transition(state.current, 'INTERRUPTED', { completionReason: 'ACTION_SUPERSEDED' });
    }
    clearTimers();
    const page = context();
    const session = {
      operationId: spec.operationId || operationId('wbact'),
      operationType: compact(spec.operationType || 'GUIDED_ACTION', 100),
      intent,
      navigationCapable,
      caseId,
      targetType: compact(spec.targetType || 'semantic', 80),
      semanticTargetId: compact(spec.semanticTargetId || semanticForPlanId(spec.planId), 160),
      sourceSystem: compact(spec.sourceSystem || page.system || '', 40),
      sourcePageKind: compact(spec.sourcePageKind || page.pageKind || '', 80),
      destinationSystem: compact(spec.destinationSystem || '', 40),
      destinationPageKind: compact(spec.destinationPageKind || '', 80),
      destinationEntityId: compact(spec.destinationEntityId || '', 80),
      status: 'REQUESTED',
      requestedAt: nowIso(),
      navigationStartedAt: '', destinationReachedAt: '', targetReadyAt: '', shownAt: '', completedAt: '',
      expectedPostCondition: compact(spec.expectedPostCondition || '', 600),
      actualResult: '', completionReason: '', failureReason: '',
      sourceAction: compact(spec.sourceAction || 'guide', 100),
      title: compact(spec.title || '', 220),
      text: compact(spec.text || '', 360),
      replayOnly: Boolean(spec.replayOnly),
      planId: compact(spec.planId || '', 160),
      targetTimeoutMs: Math.max(1000, Math.min(60000, Number(spec.targetTimeoutMs || DEFAULT_TARGET_TIMEOUT_MS))),
      showCount: 0,
      rebindCount: 0,
      lastTransitionAt: nowIso(),
      terminalDiagnosticRecorded: false
    };
    state.current = session;
    state.lastPersisted = '';
    trace('ACTION_REQUESTED', { operationId: session.operationId, semanticTargetId: session.semanticTargetId, status: 'REQUESTED', sourceAction: session.sourceAction });
    void persist(session);
    armTargetTimeout(session);
    armInterruptionGuard(session);
    WB.bus?.emit?.('action:lifecycle', { session: sanitizedSession(session), previousState: '', nextState: 'REQUESTED' });
    return { ok: true, session };
  }

  function navigationStarted(session = state.current, patch = {}) { return transition(session, 'NAVIGATING', patch); }
  function destinationReached(session = state.current, patch = {}) { return transition(session, 'DESTINATION_REACHED', patch); }
  function waitingTarget(session = state.current, patch = {}) {
    if (session?.status === 'WAITING_TARGET') { armTargetTimeout(session); return { ok: true, unchanged: true, session }; }
    return transition(session, 'WAITING_TARGET', patch);
  }
  function targetReady(session = state.current, patch = {}) { return transition(session, 'TARGET_READY', patch); }
  function shown(session = state.current, patch = {}) {
    if (session?.status === 'SHOWN') return { ok: true, unchanged: true, session };
    return transition(session, 'SHOWN', patch);
  }
  function complete(session = state.current, reason = 'TARGET_ACTIVATED', actualResult = '') {
    return transition(session, 'COMPLETED', { completionReason: compact(reason, 160), actualResult: compact(actualResult, 600) });
  }
  /** DIRECT_REPLAY teleport: advance to COMPLETED without Focus/SHOWN. */
  function completeDirect(session = state.current, reason = 'direct-replay-completed', actualResult = '') {
    if (!session || TERMINAL.has(session.status)) return { ok: false, reason: 'session-terminal' };
    if (session.status === 'REQUESTED') {
      transition(session, 'NAVIGATING', { actualResult: compact(actualResult, 600) });
    }
    if (session.status === 'NAVIGATING') {
      transition(session, 'DESTINATION_REACHED', { actualResult: compact(actualResult, 600) });
    }
    if (['DESTINATION_REACHED', 'WAITING_TARGET', 'TARGET_READY', 'SHOWN'].includes(session.status)) {
      return complete(session, reason, actualResult);
    }
    return complete(session, reason, actualResult);
  }
  function dismiss(session = state.current, reason = 'DISMISSED') {
    return transition(session, 'DISMISSED', { completionReason: compact(reason, 160) });
  }
  function interrupt(session = state.current, reason = 'USER_INTERRUPTED', details = {}) {
    return transition(session, 'INTERRUPTED', { completionReason: compact(reason, 160), actualResult: compact(details.actualResult || '', 600) });
  }
  function reject(session = state.current, reason = 'REJECTED', details = {}) {
    return transition(session, 'REJECTED', { completionReason: compact(reason, 160), actualResult: compact(details.actualResult || '', 600) });
  }
  function fail(session = state.current, reason = 'FAILED', details = {}) {
    if (!session || TERMINAL.has(session.status)) return { ok: false, reason: 'session-terminal' };
    const result = transition(session, 'FAILED', { failureReason: compact(reason, 240), actualResult: compact(details.actualResult || '', 600) }, { deferTerminalDiagnostic: true });
    if (result.ok && !session.terminalDiagnosticRecorded) {
      session.terminalDiagnosticRecorded = true;
      diagnostic('ERROR', details.code || 'ACTION_FAILED', session, details.message || `Управляемое действие завершилось ошибкой: ${reason}`, details);
      void persist(session);
    }
    return result;
  }
  function timeout(session = state.current, reason = 'target-timeout', details = {}) {
    if (!session || TERMINAL.has(session.status)) return { ok: false, reason: 'session-terminal' };
    const result = transition(session, 'TIMEOUT', { failureReason: compact(reason, 240), actualResult: compact(details.actualResult || '', 600) }, { deferTerminalDiagnostic: true });
    if (result.ok && !session.terminalDiagnosticRecorded) {
      session.terminalDiagnosticRecorded = true;
      diagnostic('WARNING', details.code || 'ACTION_TARGET_TIMEOUT', session, details.message || `Управляемое действие не достигло target: ${reason}`, details);
      void persist(session);
    }
    return result;
  }

  function unexpectedFocusDrop(session = state.current, reason = 'unknown') {
    if (!session || session.status !== 'SHOWN') return { ok: false, reason: 'not-shown' };
    diagnostic('ERROR', 'ACTION_FOCUS_DROPPED_UNEXPECTEDLY', session, 'Focus Layer исчез без допустимого terminal/dismiss события', { dropReason: reason });
    trace('FOCUS_HIDE_UNEXPECTED', { reason });
    return fail(session, `unexpected-focus-drop:${reason}`, { code: 'ACTION_FOCUS_DROPPED_UNEXPECTEDLY', message: 'Focus Layer исчез без допустимой причины' });
  }

  function beginRebind(session = state.current) {
    if (!session || session.status !== 'SHOWN') return false;
    if (state.rebindTimer) return true;
    trace('DOM_TARGET_DETACHED', { operationId: session.operationId });
    state.rebindTimer = setTimeout(() => {
      state.rebindTimer = null;
      if (!state.current || state.current.operationId !== session.operationId || state.current.status !== 'SHOWN') return;
      diagnostic('ERROR', 'ACTION_TARGET_REBIND_FAILED', session, 'Semantic target не восстановился после замены DOM', { graceMs: REBIND_GRACE_MS });
      fail(session, 'target-rebind-failed', { code: 'ACTION_TARGET_REBIND_FAILED', message: 'Semantic target не удалось перепривязать после DOM replacement' });
      WB.bus?.emit?.('action:rebind-timeout', { session: sanitizedSession(session) });
    }, REBIND_GRACE_MS);
    return true;
  }

  function rebound(session = state.current, metadata = {}) {
    if (!session || session.status !== 'SHOWN') return { ok: false, reason: 'not-shown' };
    if (state.rebindTimer) clearTimeout(state.rebindTimer);
    state.rebindTimer = null;
    session.rebindCount = Number(session.rebindCount || 0) + 1;
    session.lastTransitionAt = nowIso();
    trace('TARGET_REBOUND', { rebindCount: session.rebindCount, ...metadata });
    void persist(session);
    return { ok: true, session };
  }

  function registerResolver(semanticTargetId, resolver, metadata = {}) {
    if (!semanticTargetId || typeof resolver !== 'function') return false;
    resolvers.set(String(semanticTargetId), { resolver, metadata: clonePlain(metadata) || {} });
    return true;
  }

  function resolve(session = state.current, caseData = activeCase()) {
    const entry = resolvers.get(String(session?.semanticTargetId || ''));
    if (!entry) return { found: false, reason: 'resolver-missing', element: null, metadata: {} };
    try {
      const raw = entry.resolver({ session, caseData, context: context() });
      const element = raw instanceof Element ? raw : raw?.element || null;
      return {
        found: Boolean(element?.isConnected),
        element,
        raw,
        identity: raw?.identity || session?.semanticTargetId || '',
        metadata: { ...(entry.metadata || {}), ...(raw?.metadata || {}) }
      };
    } catch (error) {
      diagnostic('ERROR', 'ACTION_TARGET_RESOLVE_FAILED', session, error?.message || 'Target resolver выбросил исключение', { semanticTargetId: session?.semanticTargetId || '', errorName: error?.name || '' });
      return { found: false, reason: 'resolver-error', element: null, error, metadata: entry.metadata || {} };
    }
  }

  function syncFromCase(caseData = activeCase()) {
    if (state.syncing) return state.current;
    const lifecycleStore = caseData?.workflow?.actionSession || {};
    const stored = lifecycleStore.active || null;
    const lastTerminal = lifecycleStore.lastTerminal || null;
    if (!stored?.operationId || TERMINAL.has(String(stored.status || ''))) {
      if (
        state.current
        && !TERMINAL.has(String(state.current.status || ''))
        && lastTerminal?.operationId
        && String(lastTerminal.operationId) === String(state.current.operationId || '')
        && TERMINAL.has(String(lastTerminal.status || ''))
      ) {
        Object.assign(state.current, clonePlain(lastTerminal) || {});
        clearTimers();
        clearInterruptionGuard();
        state.lastPersisted = persistedRecord(state.current).raw;
        trace('ACTION_TERMINAL_SYNCED_FROM_CASE', { operationId: state.current.operationId, status: state.current.status, semanticTargetId: state.current.semanticTargetId });
      }
      return state.current;
    }
    if (String(stored.caseId || '') !== String(caseData?.id || '')) return state.current;
    if (state.current?.operationId === stored.operationId) {
      const localStamp = String(state.current.lastTransitionAt || '');
      const storedStamp = String(stored.lastTransitionAt || '');
      if (storedStamp && storedStamp >= localStamp && String(stored.status || '') !== String(state.current.status || '')) {
        Object.assign(state.current, clonePlain(stored) || {});
        state.lastPersisted = persistedRecord(state.current).raw;
        if (TERMINAL.has(String(state.current.status || ''))) { clearTimers(); clearInterruptionGuard(); }
        else { armTargetTimeout(state.current); armInterruptionGuard(state.current); }
        trace('ACTION_SYNCED_FROM_CASE', { operationId: state.current.operationId, status: state.current.status, semanticTargetId: state.current.semanticTargetId });
      }
      return state.current;
    }
    state.syncing = true;
    try {
      state.current = { ...clonePlain(stored) };
      state.lastPersisted = persistedRecord(state.current).raw;
      armTargetTimeout(state.current);
      armInterruptionGuard(state.current);
      trace('ACTION_RESUMED', { operationId: state.current.operationId, status: state.current.status, semanticTargetId: state.current.semanticTargetId });
      WB.bus?.emit?.('action:resume-needed', { session: sanitizedSession(state.current) });
      return state.current;
    } finally {
      state.syncing = false;
    }
  }

  async function flushPersistence() {
    try {
      await state.persistPromise;
      return true;
    } catch {
      return false;
    }
  }

  function inspect() { return sanitizedSession(state.current); }
  function isTerminal(session = state.current) { return Boolean(session && TERMINAL.has(session.status)); }

  WB.actionLifecycle = {
    states: { TERMINAL: [...TERMINAL], ALLOWED },
    semanticForPlanId,
    destinationMatches,
    start,
    transition,
    navigationStarted,
    destinationReached,
    waitingTarget,
    targetReady,
    shown,
    complete,
    completeDirect,
    dismiss,
    interrupt,
    reject,
    fail,
    timeout,
    unexpectedFocusDrop,
    beginRebind,
    rebound,
    registerResolver,
    resolve,
    syncFromCase,
    flushPersistence,
    current: () => state.current,
    inspect,
    isTerminal,
    trace
  };

  WB.bus?.on?.('store:state', () => syncFromCase());
})();
