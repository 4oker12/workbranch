(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const POLL_ACTIONS = new Set(['310', '311', '312', '313']);
  // Physical debounce only. The durable pending PollAttempt is the real lock.
  const POLL_LOCK_MS = 900;
  const GUIDE_ACTION_LOCK_MS = 1400;
  const UI_QUIET_MS = 90;
  const UI_READY_TIMEOUT_MS = 900;
  const GESTURE_MAX_AGE_MS = 1800;
  // This timeout protects only the gap between the native click and the askolt
  // navigation. The OLT response itself may legitimately take much longer.
  const POLL_INTENT_TIMEOUT_MS = 12000;
  const POLL_STALE_TIMEOUT_MS = 90000;
  const POLL_LATE_RESPONSE_MAX_AGE_MS = 180000;
  const RECOVERABLE_POLL_TIMEOUT_REASONS = new Set([
    'poll-request-document-not-opened',
    'poll-attempt-stale'
  ]);

  let lastExternalMutationAt = performance.now();
  let domEpoch = 0;
  const pollLocks = new Map();
  const actionLocks = new Map();
  let lastPollPointerDown = null;
  let pollIntentTimer = null;

  function isWorkbenchNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE
      ? node
      : node?.parentElement;
    if (!element) return false;
    return Boolean(
      element.closest?.(
        '#simnet-workbench-rail-host,' +
        '#simnet-workbench-guide-overlay,' +
        '[data-simnet-guide-overlay],' +
        '.simnet-workbench-guide-overlay,' +
        '.simnet-wb-poll-command-block,' +
        '[data-simnet-wb-owned]'
      )
    );
  }

  function isWorkbenchMutation(mutation) {
    if (!mutation) return false;
    if (isWorkbenchNode(mutation.target)) return true;
    const nodes = [
      ...(mutation.addedNodes || []),
      ...(mutation.removedNodes || [])
    ];
    return Boolean(nodes.length && nodes.every(node => isWorkbenchNode(node)));
  }


  function isVolatileCrmMutation(mutation) {
    if (!mutation) return false;
    const element = mutation.target?.nodeType === Node.ELEMENT_NODE
      ? mutation.target
      : mutation.target?.parentElement;
    if (!element) return false;

    // If a guided action is actively acquiring TMC, do not suppress mutations in
    // that target region: the first meaningful TMC appearance must wake the Guide.
    const action = WB.actionLifecycle?.current?.() || null;
    const tmcAcquisitionActive = Boolean(
      action
      && !WB.actionLifecycle?.isTerminal?.(action)
      && action.semanticTargetId === 'userside.tmc'
    );

    // UserSide/Billing widgets below are known to animate/update counters or clocks
    // without changing subscriber identity or diagnostic route.
    if (element.closest?.('#to_top,[id^="ifaceLastTimeInfo"],[id^="ifTrafficInfo"],[id^="ifTrafficIn"],[id^="ifTrafficOut"],#labelPollerTaskWaitId')) {
      return true;
    }
    if (element.closest?.('span[id^="spanOnuRx"][id$="Id"] i')) return true;

    // The TMC cell itself is rewritten when only the live ONU timestamp changes.
    // Once the TMC checkpoint is already available, that periodic rewrite must not
    // keep the whole Case scanner alive. During active TMC acquisition it remains observable.
    const tmcCell = element.closest?.('td[id^="td_"][id$="_Id"]');
    if (!tmcAcquisitionActive && tmcCell && /Найдено на OLT|ONU Rx\s*\(dBm\)/i.test(String(tmcCell.textContent || ''))) {
      return true;
    }

    return false;
  }

  function meaningfulMutation(mutation) {
    if (!mutation || isWorkbenchMutation(mutation) || isVolatileCrmMutation(mutation)) return false;
    if (mutation.type === 'attributes') {
      return ['href', 'disabled', 'style', 'class', 'hidden', 'aria-disabled']
        .includes(String(mutation.attributeName || ''));
    }
    if (mutation.type === 'characterData') return true;
    const nodes = [
      ...(mutation.addedNodes || []),
      ...(mutation.removedNodes || [])
    ];
    if (nodes.length) return nodes.some(node => !isWorkbenchNode(node));
    return true;
  }

  const observer = new MutationObserver(mutations => {
    if (!mutations.some(meaningfulMutation)) return;
    domEpoch += 1;
    lastExternalMutationAt = performance.now();
  });

  try {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'disabled', 'style', 'class', 'hidden', 'aria-disabled']
    });
  } catch {}

  function isDocumentReady() {
    return document.readyState === 'interactive' || document.readyState === 'complete';
  }

  function isUiReady({ quietMs = UI_QUIET_MS } = {}) {
    return Boolean(
      isDocumentReady()
      && performance.now() - lastExternalMutationAt >= quietMs
    );
  }

  async function waitForUiReady({
    timeoutMs = UI_READY_TIMEOUT_MS,
    quietMs = UI_QUIET_MS
  } = {}) {
    const started = performance.now();
    while (performance.now() - started <= timeoutMs) {
      if (isUiReady({ quietMs })) return true;
      await new Promise(resolve => setTimeout(resolve, 24));
    }
    // Legacy Billing/UserSide can keep cosmetic mutations running for a long time.
    // After the bounded wait, DOMContentLoaded/interactive is enough for read-only
    // parsing; destructive poll clicks still use strict isUiReady() checks.
    return isDocumentReady();
  }

  function isElementUsable(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && !element.matches?.('[disabled],[aria-disabled="true"]');
  }

  function compactText(value, max = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function elementFingerprint(element) {
    if (!(element instanceof Element)) return '';
    const href = element.closest?.('a[href]')?.getAttribute?.('href') || element.getAttribute?.('href') || '';
    return JSON.stringify({
      tag: String(element.tagName || '').toLowerCase(),
      id: String(element.getAttribute?.('id') || ''),
      name: String(element.getAttribute?.('name') || ''),
      type: String(element.getAttribute?.('type') || ''),
      href: String(href || ''),
      text: compactText(element.innerText || element.textContent || element.value || '')
    });
  }

  function captureElementState(element) {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    return {
      element,
      domEpoch,
      capturedAt: performance.now(),
      fingerprint: elementFingerprint(element),
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }
    };
  }

  function rectMoved(a, b, tolerance = 2) {
    if (!a || !b) return true;
    return ['left', 'top', 'width', 'height']
      .some(key => Math.abs(Number(a[key] || 0) - Number(b[key] || 0)) > tolerance);
  }

  function validateElementState(element, snapshot, { requireQuiet = true, allowMovement = false } = {}) {
    if (!(element instanceof Element) || !snapshot) {
      return { ok: false, reason: 'missing-element-snapshot' };
    }
    if (!isElementUsable(element)) {
      return { ok: false, reason: 'element-detached-or-hidden' };
    }
    if (snapshot.element !== element) {
      return { ok: false, reason: 'element-replaced' };
    }
    if (elementFingerprint(element) !== snapshot.fingerprint) {
      return { ok: false, reason: 'element-identity-changed' };
    }
    const rect = element.getBoundingClientRect();
    const currentRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    if (!allowMovement && rectMoved(snapshot.rect, currentRect)) {
      return { ok: false, reason: 'element-moved-during-gesture' };
    }
    if (requireQuiet && !isUiReady({ quietMs: 60 })) {
      return { ok: false, reason: 'dom-mutating-during-gesture' };
    }
    return {
      ok: true,
      domChanged: snapshot.domEpoch !== domEpoch,
      domEpoch
    };
  }

  async function waitForStableElement(element, {
    timeoutMs = UI_READY_TIMEOUT_MS,
    quietMs = UI_QUIET_MS,
    sampleMs = 45
  } = {}) {
    const ready = await waitForUiReady({ timeoutMs, quietMs });
    if (!ready || !isElementUsable(element)) return false;
    const first = captureElementState(element);
    await new Promise(resolve => setTimeout(resolve, sampleMs));
    const second = captureElementState(element);
    if (!second) return false;
    return Boolean(
      first.fingerprint === second.fingerprint
      && !rectMoved(first.rect, second.rect)
      && isUiReady({ quietMs: Math.min(quietMs, 90) })
    );
  }

  function pollRequestFromAnchor(anchor) {
    if (!(anchor instanceof Element)) return null;
    const link = anchor.closest?.('a[href]');
    if (!link) return null;
    let url = null;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin || !/\/stat\.pl$/i.test(url.pathname)) return null;
    const action = String(url.searchParams.get('a') || '');
    const act = String(url.searchParams.get('act') || '');
    if (!POLL_ACTIONS.has(action) || act !== 'askolt') return null;
    const billingId = String(url.searchParams.get('id') || '');
    const oltIp = String(url.searchParams.get('olt_ip') || '');
    return {
      link,
      url,
      action,
      billingId,
      oltIp,
      key: `${billingId}|${action}|${oltIp}|${url.pathname}`
    };
  }

  function factValue(raw) {
    return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
  }

  function pollBindingVerdict(info) {
    const caseData = WB.store?.activeCase?.() || null;
    if (!caseData) return { ok: false, reason: 'poll-case-unavailable' };
    const caseId = String(caseData.id || WB.store?.localCaseId || '');
    const expectedBillingId = String(factValue(caseData.identity?.billingId) || '');
    const expectedAction = String(factValue(caseData.pon?.pollAction) || '');
    const expectedOltIp = String(factValue(caseData.pon?.oltIp) || '');
    if (!caseId) return { ok: false, reason: 'poll-case-unavailable' };
    if (expectedBillingId && expectedBillingId !== String(info?.billingId || '')) {
      return { ok: false, reason: 'poll-billing-mismatch', caseId };
    }
    if (expectedAction && expectedAction !== String(info?.action || '')) {
      return { ok: false, reason: 'poll-action-mismatch', caseId };
    }
    if (expectedOltIp && info?.oltIp && expectedOltIp !== String(info.oltIp)) {
      return { ok: false, reason: 'poll-olt-mismatch', caseId };
    }
    return { ok: true, caseId };
  }

  function persistPollAttempt(attempt) {
    if (!attempt) return;
    WB.runtime.pollAttempt = attempt;
    try {
      sessionStorage.setItem('simnet_wb_poll_attempt_v1', JSON.stringify(attempt));
    } catch {}
  }

  function notifyPollAttempt(attempt) {
    const caseId = String(attempt?.caseId || '');
    if (!caseId || !attempt?.episodeId || !attempt?.pollAttemptId) return;
    const envelope = {
      eventId: globalThis.crypto?.randomUUID?.()
        || `poll_evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'POLL_ATTEMPT_UPDATE',
      occurredAt: new Date().toISOString(),
      caseId,
      episodeId: String(attempt.episodeId || ''),
      caseVersion: Number(attempt.caseVersion || 0),
      routeGeneration: Number(attempt.routeGeneration || 0),
      origin: {
        tabId: null,
        frameId: 0,
        documentId: String(WB.runtime?.documentId || attempt.documentId || ''),
        pageInstanceId: String(WB.runtime?.pageInstanceId || ''),
        pageInstanceStartedAt: Number(WB.runtime?.pageInstanceStartedAt || 0),
        system: 'billing',
        pageKind: 'billing_onu_poll',
        url: location.href
      },
      operation: {
        requestId: '',
        pollAttemptId: String(attempt.pollAttemptId || '')
      },
      identityFingerprint: String(attempt.identityFingerprint || ''),
      bindingFingerprint: String(attempt.bindingFingerprint || ''),
      payload: { stage: String(attempt.stage || '') }
    };
    void chrome.runtime.sendMessage({
      type: 'POLL_ATTEMPT_UPDATE',
      payload: { caseId, attempt, envelope }
    }).then(response => {
      if (!response?.success) throw new Error(response?.error || 'POLL_ATTEMPT_UPDATE rejected');
    }).catch(error => {
      void WB.observability?.report?.({
        severity: 'ERROR',
        code: 'POLL_ATTEMPT_UPDATE_FAILED',
        operationType: 'OLT_POLL',
        source: 'interaction-guards',
        stage: String(attempt?.stage || 'UPDATE'),
        message: error?.message || String(error),
        error,
        details: { pollAttemptId: attempt?.pollAttemptId || '', caseId }
      });
    });
  }

  function finishPollAttempt(attempt, outcome = 'timeout', reason = 'poll-intent-timeout') {
    if (!attempt?.pollAttemptId || attempt.pending === false) return attempt || null;
    const resolved = {
      ...attempt,
      status: outcome === 'timeout' ? 'timeout' : 'failed',
      stage: outcome === 'timeout' ? 'TIMEOUT' : 'FAILED',
      pending: false,
      outcome,
      failureReason: reason,
      resolvedAt: Date.now(),
      updatedAt: new Date().toISOString()
    };
    persistPollAttempt(resolved);
    WB.bus?.emit?.('poll:attempt-resolved', resolved);
    notifyPollAttempt(resolved);
    void WB.observability?.report?.({
      severity: outcome === 'timeout' ? 'WARNING' : 'ERROR',
      code: outcome === 'timeout' ? 'OLT_POLL_ATTEMPT_TIMEOUT' : 'OLT_POLL_ATTEMPT_FAILED',
      operationType: 'OLT_POLL',
      source: 'interaction-guards',
      stage: resolved.stage,
      message: outcome === 'timeout' ? 'Запрос OLT не получил подтверждённый ответ в ожидаемое время' : 'Запрос OLT завершился ошибкой',
      reason,
      actual: { outcome, status: resolved.status },
      details: { pollAttemptId: resolved.pollAttemptId || '', caseId: resolved.caseId || '' }
    });
    return resolved;
  }

  function schedulePollIntentRecovery(attempt, event) {
    clearTimeout(pollIntentTimer);
    // A later target listener (Guide) can still cancel the same native click.
    // Detect that after propagation and release the logical lock immediately.
    setTimeout(() => {
      const current = recentPollRequest({ expire: false });
      if (!current || current.pollAttemptId !== attempt.pollAttemptId || current.pending === false) return;
      if (event?.defaultPrevented) {
        finishPollAttempt(current, 'failed', 'native-navigation-cancelled');
        return;
      }
      const started = {
        ...current,
        stage: 'REQUEST_STARTED',
        status: 'pending',
        pending: true,
        updatedAt: new Date().toISOString()
      };
      persistPollAttempt(started);
      WB.bus?.emit?.('poll:attempt-started', started);
      notifyPollAttempt(started);
    }, 0);

    pollIntentTimer = setTimeout(() => {
      const current = recentPollRequest({ expire: false });
      if (!current || current.pollAttemptId !== attempt.pollAttemptId || current.pending === false) return;
      const params = new URLSearchParams(location.search);
      const requestDocument = params.get('act') === 'askolt'
        && params.get('a') === String(current.action || '')
        && params.get('id') === String(current.billingId || '');
      if (!requestDocument) {
        finishPollAttempt(current, 'timeout', 'poll-request-document-not-opened');
      }
    }, POLL_INTENT_TIMEOUT_MS);
  }

  function preservePollAttemptForNativeNavigation() {
    const current = recentPollRequest({ expire: false });
    if (!current?.pollAttemptId || current.pending === false) return;
    clearTimeout(pollIntentTimer);
    pollIntentTimer = null;
    if (Number(current.navigationStartedAt || 0)) return;
    const advanced = {
      ...current,
      stage: current.stage === 'INTENT_RECORDED'
        ? 'REQUEST_STARTED'
        : current.stage,
      status: 'pending',
      pending: true,
      navigationStartedAt: Number(current.navigationStartedAt || Date.now()),
      updatedAt: new Date().toISOString()
    };
    persistPollAttempt(advanced);
    WB.bus?.emit?.('poll:attempt-started', advanced);
    notifyPollAttempt(advanced);
  }

  function rememberPollRequest(info) {
    const pollAttemptId = globalThis.crypto?.randomUUID?.()
      || `poll_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const caseId = String(WB.store?.localCaseId || '');
    const envelope = WB.store?.correlation?.(
      'POLL_ATTEMPT_UPDATE',
      { pollAttemptId },
      { caseId }
    ) || null;
    const payload = {
      attemptId: pollAttemptId,
      pollAttemptId,
      action: info.action,
      billingId: info.billingId,
      oltIp: info.oltIp,
      href: info.url.href,
      startedAt: Date.now(),
      status: 'pending',
      stage: 'INTENT_RECORDED',
      pending: true,
      caseId,
      episodeId: String(envelope?.episodeId || ''),
      caseVersion: Number(envelope?.caseVersion || 0),
      routeGeneration: Number(envelope?.routeGeneration || 0),
      identityFingerprint: String(envelope?.identityFingerprint || ''),
      bindingFingerprint: String(envelope?.bindingFingerprint || ''),
      documentId: String(WB.runtime?.documentId || '')
    };
    persistPollAttempt(payload);
    WB.bus?.emit?.('poll:attempt-started', payload);
    if (envelope?.caseId && envelope?.episodeId) {
      void chrome.runtime.sendMessage({
        type: 'POLL_ATTEMPT_UPDATE',
        payload: {
          caseId,
          attempt: payload,
          envelope
        }
      }).then(response => {
        if (!response?.success) throw new Error(response?.error || 'POLL_ATTEMPT_UPDATE rejected');
      }).catch(error => {
        void WB.observability?.report?.({
          severity: 'ERROR',
          code: 'POLL_ATTEMPT_START_PERSIST_FAILED',
          operationType: 'OLT_POLL',
          source: 'interaction-guards',
          stage: 'INTENT_RECORDED',
          message: error?.message || String(error),
          error,
          details: { pollAttemptId, caseId }
        });
      });
    }
    return payload;
  }

  function recentPollRequest({ expire = true } = {}) {
    const runtime = WB.runtime?.pollAttempt;
    let attempt = runtime?.startedAt ? runtime : null;
    try {
      const parsed = JSON.parse(sessionStorage.getItem('simnet_wb_poll_attempt_v1') || 'null');
      if (!attempt?.startedAt && parsed?.startedAt) attempt = parsed;
    } catch {}
    if (!attempt) return null;

    const currentCaseId = String(WB.store?.localCaseId || WB.store?.activeCase?.()?.id || '');
    if (currentCaseId && String(attempt.caseId || '') !== currentCaseId) {
      // Keep the persisted operation for its own case, but never expose it to
      // envelopes/parsers of the subscriber currently open in this tab.
      if (WB.runtime?.pollAttempt === attempt) WB.runtime.pollAttempt = null;
      return null;
    }
    if (
      expire
      && attempt.pending !== false
      && Number(attempt.startedAt || 0)
      && Date.now() - Number(attempt.startedAt || 0) > POLL_STALE_TIMEOUT_MS
    ) {
      return finishPollAttempt(attempt, 'timeout', 'poll-attempt-stale');
    }
    return attempt;
  }

  function pollAttemptMatchesBinding(attempt, {
    action = '',
    billingId = '',
    oltIp = '',
    maxAgeMs = POLL_LATE_RESPONSE_MAX_AGE_MS
  } = {}) {
    if (!attempt?.pollAttemptId) return false;
    if (action && String(attempt.action || '') !== String(action)) return false;
    if (billingId && String(attempt.billingId || '') !== String(billingId)) return false;
    if (oltIp && attempt.oltIp && String(attempt.oltIp) !== String(oltIp)) return false;
    const ageMs = Date.now() - Number(attempt.startedAt || 0);
    return Boolean(
      Number(attempt.startedAt || 0)
      && ageMs >= 0
      && ageMs <= Number(maxAgeMs || POLL_LATE_RESPONSE_MAX_AGE_MS)
    );
  }

  function isRecoverableLatePollResponse({
    action = '',
    billingId = '',
    oltIp = '',
    maxAgeMs = POLL_LATE_RESPONSE_MAX_AGE_MS,
    responseEvidence = false
  } = {}) {
    if (!responseEvidence) return false;
    const params = new URLSearchParams(location.search);
    if (params.get('act') !== 'askolt') return false;
    if (action && params.get('a') !== String(action)) return false;
    if (billingId && params.get('id') !== String(billingId)) return false;
    if (oltIp && params.get('olt_ip') && params.get('olt_ip') !== String(oltIp)) return false;
    const attempt = recentPollRequest({ expire: false });
    return Boolean(
      attempt
      && attempt.pending === false
      && String(attempt.stage || '') === 'TIMEOUT'
      && RECOVERABLE_POLL_TIMEOUT_REASONS.has(String(attempt.failureReason || ''))
      && pollAttemptMatchesBinding(attempt, { action, billingId, oltIp, maxAgeMs })
    );
  }

  function pollRequestMatches({
    action = '',
    billingId = '',
    oltIp = '',
    maxAgeMs = POLL_LATE_RESPONSE_MAX_AGE_MS,
    responseEvidence = false
  } = {}) {
    // A remembered click is NOT enough to confirm a poll. The current document
    // itself must represent the askolt request. This prevents stale attempts from
    // turning a later plain Huawei/GPON/GCOM tab into POLL COMPLETE.
    const currentParams = new URLSearchParams(location.search);
    if (currentParams.get('act') !== 'askolt') return false;
    if (action && currentParams.get('a') !== String(action)) return false;
    if (billingId && currentParams.get('id') !== String(billingId)) return false;
    if (oltIp && currentParams.get('olt_ip') && currentParams.get('olt_ip') !== String(oltIp)) return false;
    let attempt = recentPollRequest({ expire: false });
    if (!attempt || !pollAttemptMatchesBinding(attempt, { action, billingId, oltIp, maxAgeMs })) {
      return false;
    }
    if (attempt.pending === false) {
      const alreadyConfirmed = Boolean(
        responseEvidence
        && String(attempt.stage || '') === 'CONFIRMED'
        && String(attempt.outcome || '') === 'confirmed'
      );
      if (alreadyConfirmed) return true;
      if (!isRecoverableLatePollResponse({
        action,
        billingId,
        oltIp,
        maxAgeMs,
        responseEvidence
      })) return false;
      attempt = {
        ...attempt,
        lateResponseRecovery: true,
        lateResponseDetectedAt: Date.now(),
        responseDocumentId: String(WB.runtime?.documentId || '')
      };
      persistPollAttempt(attempt);
    }
    if (attempt.stage === 'INTENT_RECORDED') {
      const advanced = {
        ...attempt,
        stage: 'RESPONSE_DOCUMENT',
        status: 'pending',
        pending: true,
        responseDocumentId: String(WB.runtime?.documentId || '')
      };
      persistPollAttempt(advanced);
      WB.bus?.emit?.('poll:attempt-started', advanced);
      notifyPollAttempt(advanced);
    }
    return true;
  }

  function resolvePollRequest({ action = '', billingId = '', outcome = '' } = {}) {
    const attempt = recentPollRequest();
    if (!attempt) return false;
    if (action && String(attempt.action || '') !== String(action)) return false;
    if (billingId && String(attempt.billingId || '') !== String(billingId)) return false;
    const resolved = {
      ...attempt,
      status: 'resolved',
      stage: outcome === 'confirmed'
        ? 'CONFIRMED'
        : outcome === 'timeout'
          ? 'TIMEOUT'
          : 'FAILED',
      pending: false,
      outcome: String(outcome || ''),
      resolvedAt: Date.now()
    };
    persistPollAttempt(resolved);
    WB.bus?.emit?.('poll:attempt-resolved', resolved);
    return true;
  }

  function recordGuard(event, reason, details = {}, { cancel = false } = {}) {
    if (cancel && event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
    const target = event?.target instanceof Element ? event.target : null;
    const journalDetails = {
      reason,
      ...details,
      eventType: String(event?.type || ''),
      pointer: {
        x: Number(event?.clientX || 0),
        y: Number(event?.clientY || 0)
      },
      target: target ? {
        tag: String(target.tagName || '').toLowerCase(),
        text: compactText(target.innerText || target.textContent || target.value || '', 180),
        fingerprint: elementFingerprint(target)
      } : null,
      url: location.href
    };
    WB.log?.warn?.('GUARD', reason, journalDetails);
    WB.bus?.emit?.('guard:blocked', journalDetails);
    void WB.store?.addEvent?.(
      'interaction_guard',
      `GUARD BLOCK · ${reason}`,
      journalDetails
    ).catch?.(() => {});
  }

  function blockEvent(event, reason, details = {}) {
    return recordGuard(event, reason, details, { cancel: true });
  }

  function acquireActionLock(key, lockMs = GUIDE_ACTION_LOCK_MS) {
    const normalized = String(key || '');
    if (!normalized) return true;
    const now = Date.now();
    const lockedAt = Number(actionLocks.get(normalized) || 0);
    if (lockedAt && now - lockedAt < lockMs) return false;
    actionLocks.set(normalized, now);
    setTimeout(() => {
      if (actionLocks.get(normalized) === now) actionLocks.delete(normalized);
    }, lockMs + 50);
    return true;
  }

  function guardLogicalAction(event, key, {
    snapshot = null,
    target = null,
    lockMs = GUIDE_ACTION_LOCK_MS,
    requireQuiet = true,
    cancelOnStale = true
  } = {}) {
    const element = target instanceof Element ? target : event?.target;
    if (snapshot) {
      const validation = validateElementState(element, snapshot, { requireQuiet });
      if (!validation.ok) {
        if (event) {
          if (cancelOnStale) blockEvent(event, 'stale-guide-click', { key, validation: validation.reason });
          else recordGuard(event, 'stale-guide-click-pass-through', { key, validation: validation.reason });
        }
        return { ok: false, reason: validation.reason };
      }
    } else if (requireQuiet && !isUiReady({ quietMs: 60 })) {
      if (event) {
        if (cancelOnStale) blockEvent(event, 'guide-click-before-ui-ready', { key });
        else recordGuard(event, 'guide-click-before-ui-ready-pass-through', { key });
      }
      return { ok: false, reason: 'ui-not-ready' };
    }
    if (!acquireActionLock(key, lockMs)) {
      if (event) blockEvent(event, 'duplicate-guide-click', { key, lockMs });
      return { ok: false, reason: 'duplicate-action' };
    }
    return { ok: true };
  }

  document.addEventListener('pointerdown', event => {
    const info = pollRequestFromAnchor(event.target);
    if (!info) return;
    lastPollPointerDown = {
      key: info.key,
      at: performance.now(),
      state: captureElementState(info.link)
    };
  }, true);

  window.addEventListener('beforeunload', preservePollAttemptForNativeNavigation, true);
  window.addEventListener('pagehide', preservePollAttemptForNativeNavigation, true);

  document.addEventListener('click', event => {
    const info = pollRequestFromAnchor(event.target);
    if (!info) return;

    if (!isDocumentReady() || !isElementUsable(info.link)) {
      blockEvent(event, 'poll-page-not-ready', {
        action: info.action,
        billingId: info.billingId
      });
      return;
    }

    const binding = pollBindingVerdict(info);
    if (!binding.ok) {
      blockEvent(event, binding.reason, {
        action: info.action,
        billingId: info.billingId,
        caseId: binding.caseId || ''
      });
      return;
    }

    const gesture = lastPollPointerDown;
    if (
      gesture
      && gesture.key === info.key
      && performance.now() - gesture.at <= GESTURE_MAX_AGE_MS
    ) {
      const validation = validateElementState(info.link, gesture.state, {
        // Billing may continuously update counters unrelated to the request row.
        // Exact href/action/billing/OLT binding and a connected target are the
        // strict semantic guard; whole-document silence is not required.
        requireQuiet: false,
        allowMovement: true
      });
      if (!validation.ok) {
        blockEvent(event, 'poll-click-target-mutated', {
          action: info.action,
          billingId: info.billingId,
          reason: validation.reason
        });
        return;
      }
    }

    const now = Date.now();
    const lockedAt = Number(pollLocks.get(info.key) || 0);
    const previousAttempt = recentPollRequest();
    const samePreviousAttempt = Boolean(
      previousAttempt
      && previousAttempt.pending !== false
      && String(previousAttempt.action || '') === info.action
      && String(previousAttempt.billingId || '') === info.billingId
      && String(previousAttempt.oltIp || '') === info.oltIp
    );

    if (
      (lockedAt && now - lockedAt < POLL_LOCK_MS)
      || samePreviousAttempt
    ) {
      blockEvent(event, 'duplicate-poll-click', {
        action: info.action,
        billingId: info.billingId,
        ageMs: lockedAt ? now - lockedAt : Math.max(0, now - Number(previousAttempt?.startedAt || now))
      });
      return;
    }

    pollLocks.set(info.key, now);
    const attempt = rememberPollRequest(info);
    schedulePollIntentRecovery(attempt, event);
    setTimeout(() => {
      if (pollLocks.get(info.key) === now) pollLocks.delete(info.key);
    }, POLL_LOCK_MS + 250);
  }, true);

  document.addEventListener('dblclick', event => {
    const info = pollRequestFromAnchor(event.target);
    if (!info) return;
    blockEvent(event, 'duplicate-poll-dblclick', {
      action: info.action,
      billingId: info.billingId
    });
  }, true);

  WB.interactionGuards = {
    isDocumentReady,
    isUiReady,
    waitForUiReady,
    isElementUsable,
    isWorkbenchNode,
    isWorkbenchMutation,
    isVolatileCrmMutation,
    elementFingerprint,
    captureElementState,
    validateElementState,
    waitForStableElement,
    acquireActionLock,
    guardLogicalAction,
    recentPollRequest,
    pollRequestMatches,
    isRecoverableLatePollResponse,
    resolvePollRequest,
    pollRequestFromAnchor,
    pollBindingVerdict,
    finishPollAttempt,
    domEpoch: () => domEpoch,
    constants: {
      pollLockMs: POLL_LOCK_MS,
      pollIntentTimeoutMs: POLL_INTENT_TIMEOUT_MS,
      pollStaleTimeoutMs: POLL_STALE_TIMEOUT_MS,
      guideActionLockMs: GUIDE_ACTION_LOCK_MS,
      uiQuietMs: UI_QUIET_MS
    }
  };
})();
