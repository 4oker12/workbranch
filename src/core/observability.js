(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.observability) return;

  const activeOperations = new Map();
  const MAX_ACTIVE = 80;
  const localFallback = [];
  const MAX_FALLBACK = 24;
  const FALLBACK_KEY = 'simnet_workbench_diagnostics_fallback_v1';
  let reporting = false;

  const valueOf = value => value && typeof value === 'object' && 'value' in value ? value.value : value;
  const compact = (value, max = 600) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
  };
  const errorLike = error => ({
    message: compact(error?.message || error || '', 700),
    stack: compact(error?.stack || '', 4200),
    name: compact(error?.name || '', 120)
  });
  const currentMeta = () => {
    const currentCase = WB.store?.activeCase?.() || null;
    const context = WB.runtime?.lastContext || currentCase?.currentContext || {};
    return {
      caseId: String(currentCase?.id || WB.store?.localCaseId || ''),
      subscriber: String(valueOf(currentCase?.identity?.login) || valueOf(currentCase?.identity?.contract) || ''),
      system: String(context.system || ''),
      pageKind: String(context.pageKind || ''),
      documentId: String(WB.runtime?.documentId || ''),
      pageInstanceId: String(WB.runtime?.pageInstanceId || ''),
      version: String(WB.version || ''),
      url: String(context.url || location.href || '')
    };
  };
  const consoleMethod = severity => severity === 'CRITICAL' || severity === 'ERROR'
    ? 'error'
    : severity === 'WARNING'
      ? 'warn'
      : 'info';

  function safeFallbackEntry(entry = {}) {
    return {
      severity: compact(entry.severity || 'ERROR', 20),
      code: compact(entry.code || 'WORKBENCH_FAILURE', 140),
      operationType: compact(entry.operationType || '', 120),
      operationId: compact(entry.operationId || '', 160),
      source: compact(entry.source || 'content-fallback', 120),
      stage: compact(entry.stage || '', 120),
      message: compact(entry.message || entry.reason || 'Workbench failure', 700),
      reason: compact(entry.reason || '', 700),
      caseId: compact(entry.caseId || '', 160),
      subscriber: compact(entry.subscriber || '', 120),
      system: compact(entry.system || '', 80),
      pageKind: compact(entry.pageKind || '', 100),
      documentId: compact(entry.documentId || '', 160),
      pageInstanceId: compact(entry.pageInstanceId || '', 160),
      version: compact(entry.version || '', 60),
      stack: compact(entry.error?.stack || entry.stack || '', 2400),
      timestamp: entry.timestamp || new Date().toISOString()
    };
  }

  async function persistFallback(entry) {
    try {
      if (!globalThis.chrome?.storage?.local) return;
      const stored = await chrome.storage.local.get(FALLBACK_KEY);
      const current = Array.isArray(stored?.[FALLBACK_KEY]) ? stored[FALLBACK_KEY] : [];
      const next = [safeFallbackEntry(entry), ...current].slice(0, MAX_FALLBACK);
      await chrome.storage.local.set({ [FALLBACK_KEY]: next });
    } catch {}
  }

  function rememberFallback(entry) {
    const safe = safeFallbackEntry(entry);
    localFallback.unshift(safe);
    if (localFallback.length > MAX_FALLBACK) localFallback.length = MAX_FALLBACK;
    void persistFallback(safe);
  }

  function runtimeAvailable() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id && !WB.runtime?.extensionContextInvalidated);
    } catch {
      return false;
    }
  }

  async function sendEntry(entry) {
    if (!runtimeAvailable()) {
      rememberFallback(entry);
      return { accepted: false, reason: 'runtime-unavailable' };
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DIAGNOSTICS_REPORT',
        payload: { entry }
      });
      if (!response?.success) throw new Error(response?.error || 'Diagnostic report rejected');
      const data = response.data || { accepted: true };
      window.dispatchEvent?.(new CustomEvent('simnet-workbench-diagnostics-changed', { detail: data }));
      return data;
    } catch (error) {
      rememberFallback({ ...entry, reporterFailure: errorLike(error) });
      return { accepted: false, reason: compact(error?.message || error, 300) };
    }
  }

  function report(raw = {}) {
    if (reporting) return Promise.resolve({ accepted: false, reason: 'recursion-guard' });
    reporting = true;
    let entry;
    try {
      const severity = String(raw.severity || 'ERROR').toUpperCase();
      entry = {
        ...currentMeta(),
        ...raw,
        severity,
        timestamp: new Date().toISOString(),
        error: raw.error ? errorLike(raw.error) : undefined
      };
      const method = consoleMethod(severity);
      try {
        const code = entry.code || entry.operationType || 'WORKBENCH_FAILURE';
        const message = compact(entry.message || entry.reason || '', 420);
        const suffix = [
          message,
          entry.caseId ? `case=${entry.caseId}` : '',
          entry.stage ? `stage=${entry.stage}` : ''
        ].filter(Boolean).join(' · ');
        // Keep the ERROR/WARNING line text-only so chrome://extensions → Errors is
        // readable instead of showing a useless trailing "[object Object]".
        console[method](`[SIMNET WB][OBS][${severity}] ${code}${suffix ? ` · ${suffix}` : ''}`);
        if (entry.details || entry.expected != null || entry.actual != null || entry.error) {
          console.debug('[SIMNET WB][OBS][DETAILS]', {
            operationId: entry.operationId || '',
            expected: entry.expected,
            actual: entry.actual,
            details: entry.details || undefined,
            error: entry.error || undefined
          });
        }
      } catch {}
    } finally {
      reporting = false;
    }
    return Promise.resolve(sendEntry(entry));
  }

  function operationId(type) {
    return `op_${String(type || 'operation').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function evictActiveIfNeeded() {
    while (activeOperations.size >= MAX_ACTIVE) {
      const oldest = activeOperations.keys().next().value;
      const item = activeOperations.get(oldest);
      if (item?.timer) clearTimeout(item.timer);
      activeOperations.delete(oldest);
    }
  }

  function startOperation(type, details = {}, options = {}) {
    const normalizedType = String(type || 'WORKBENCH_OPERATION').toUpperCase();
    const id = String(options.operationId || operationId(normalizedType));
    evictActiveIfNeeded();
    const state = {
      id,
      type: normalizedType,
      source: compact(options.source || details.source || 'content', 120),
      stage: compact(options.stage || 'START', 120),
      startedAt: Date.now(),
      expected: options.expected ?? details.expected ?? null,
      details: details && typeof details === 'object' ? { ...details } : { value: details },
      timer: null,
      finished: false
    };
    const timeoutMs = Math.max(0, Math.min(120000, Number(options.timeoutMs || 0)));
    if (timeoutMs) {
      state.timer = setTimeout(() => {
        if (state.finished) return;
        state.finished = true;
        activeOperations.delete(id);
        void report({
          severity: 'ERROR',
          code: `${normalizedType}_TIMEOUT`,
          operationType: normalizedType,
          operationId: id,
          source: state.source,
          stage: state.stage,
          message: `Операция ${normalizedType} не завершилась за ${timeoutMs} мс`,
          expected: state.expected,
          actual: 'timeout',
          details: state.details
        });
      }, timeoutMs);
    }
    activeOperations.set(id, state);

    const finish = (outcome, payload = {}) => {
      if (state.finished) return false;
      state.finished = true;
      if (state.timer) clearTimeout(state.timer);
      activeOperations.delete(id);
      if (outcome === 'SUCCESS') return true;
      const severity = outcome === 'REJECTED' ? 'WARNING' : outcome === 'TIMEOUT' ? 'ERROR' : String(payload.severity || 'ERROR');
      void report({
        ...payload,
        severity,
        code: payload.code || `${normalizedType}_${outcome}`,
        operationType: normalizedType,
        operationId: id,
        source: payload.source || state.source,
        stage: payload.stage || state.stage,
        expected: payload.expected ?? state.expected,
        details: { ...state.details, ...(payload.details || {}) }
      });
      return true;
    };

    return Object.freeze({
      id,
      type: normalizedType,
      checkpoint(stage, detailsPatch = {}) {
        if (state.finished) return false;
        state.stage = compact(stage || state.stage, 120);
        if (detailsPatch && typeof detailsPatch === 'object') Object.assign(state.details, detailsPatch);
        return true;
      },
      success(actual = null, detailsPatch = {}) {
        return finish('SUCCESS', { actual, details: detailsPatch });
      },
      reject(reason, payload = {}) {
        return finish('REJECTED', { ...payload, reason: compact(reason, 700), message: payload.message || compact(reason, 700) });
      },
      timeout(payload = {}) {
        return finish('TIMEOUT', { ...payload, actual: payload.actual ?? 'timeout' });
      },
      error(error, payload = {}) {
        return finish('ERROR', { ...payload, error, message: payload.message || compact(error?.message || error, 700) });
      }
    });
  }

  async function directDiagnosticsState() {
    const keys = ['simnet_workbench_diagnostics_v1', FALLBACK_KEY];
    const stored = await chrome.storage.local.get(keys);
    const primary = stored?.simnet_workbench_diagnostics_v1;
    const fallback = Array.isArray(stored?.[FALLBACK_KEY]) ? stored[FALLBACK_KEY] : [];
    const state = primary && typeof primary === 'object'
      ? { ...primary, entries: Array.isArray(primary.entries) ? [...primary.entries] : [] }
      : { schemaVersion: 1, entries: [], unreadCount: 0, updatedAt: '' };
    // When the worker is unavailable the emergency fallback is intentionally
    // visible even before it has been merged by background.js.
    if (fallback.length) {
      const known = new Set(state.entries.map(item => `${item.code || ''}|${item.timestamp || item.lastSeenAt || ''}|${item.message || ''}`));
      for (const item of fallback) {
        const key = `${item.code || ''}|${item.timestamp || ''}|${item.message || ''}`;
        if (known.has(key)) continue;
        state.entries.unshift({
          ...item,
          firstSeenAt: item.firstSeenAt || item.timestamp || new Date().toISOString(),
          lastSeenAt: item.lastSeenAt || item.timestamp || new Date().toISOString(),
          count: Number(item.count || 1),
          unread: true,
          emergencyFallback: true
        });
        known.add(key);
      }
      state.unreadCount = state.entries.filter(item => item.unread !== false).length;
    }
    state.entries = state.entries.slice(0, 200);
    return state;
  }

  async function getDiagnostics() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSTICS_GET', payload: {} });
      if (!response?.success) throw new Error(response?.error || 'Diagnostics read failed');
      const data = response.data;
      window.dispatchEvent?.(new CustomEvent('simnet-workbench-diagnostics-changed', { detail: data }));
      return data;
    } catch {
      const data = await directDiagnosticsState();
      window.dispatchEvent?.(new CustomEvent('simnet-workbench-diagnostics-changed', { detail: data }));
      return data;
    }
  }

  async function markRead() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSTICS_MARK_READ', payload: {} });
      if (!response?.success) throw new Error(response?.error || 'Diagnostics mark-read failed');
      const data = response.data;
      window.dispatchEvent?.(new CustomEvent('simnet-workbench-diagnostics-changed', { detail: data }));
      return data;
    } catch {
      const state = await directDiagnosticsState();
      state.entries = state.entries.map(item => ({ ...item, unread: false }));
      state.unreadCount = 0;
      state.updatedAt = new Date().toISOString();
      await chrome.storage.local.set({ simnet_workbench_diagnostics_v1: state });
      await chrome.storage.local.remove(FALLBACK_KEY);
      return state;
    }
  }

  async function clear() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSTICS_CLEAR', payload: {} });
      if (!response?.success) throw new Error(response?.error || 'Diagnostics clear failed');
      const data = response.data;
      window.dispatchEvent?.(new CustomEvent('simnet-workbench-diagnostics-changed', { detail: data }));
      return data;
    } catch {
      const state = { schemaVersion: 1, entries: [], unreadCount: 0, updatedAt: new Date().toISOString() };
      await chrome.storage.local.set({ simnet_workbench_diagnostics_v1: state });
      await chrome.storage.local.remove(FALLBACK_KEY);
      return state;
    }
  }

  async function exportBundle() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSTICS_EXPORT', payload: {} });
      if (!response?.success) throw new Error(response?.error || 'Diagnostics export failed');
      return response.data;
    } catch (error) {
      const diagnostics = await directDiagnosticsState();
      const stateStored = await chrome.storage.local.get(['simnet_workbench_state_v5']);
      const state = stateStored?.simnet_workbench_state_v5 || {};
      const active = state?.cases?.[state?.activeCaseId] || null;
      return {
        schema: 'simnet-workbench-emergency-diagnostics-export-v1',
        workbenchVersion: String(WB.version || ''),
        exportedAt: new Date().toISOString(),
        serviceWorkerAvailable: false,
        reporterFailure: compact(error?.message || error, 500),
        activeCaseId: String(state?.activeCaseId || ''),
        activeCase: active ? {
          caseId: String(active.id || ''),
          login: String(valueOf(active?.identity?.login) || ''),
          contract: String(valueOf(active?.identity?.contract) || ''),
          currentContext: active?.currentContext ? {
            system: String(active.currentContext.system || ''),
            pageKind: String(active.currentContext.pageKind || ''),
            entityId: String(active.currentContext.entityId || '')
          } : null
        } : null,
        diagnostics
      };
    }
  }

  const extensionSource = filename => {
    const text = String(filename || '');
    if (!text) return true;
    return text.startsWith('chrome-extension://') || text.includes('/src/');
  };

  const onError = event => {
    if (!extensionSource(event?.filename)) return;
    void report({
      severity: 'ERROR',
      code: 'CONTENT_UNHANDLED_ERROR',
      operationType: 'CONTENT_RUNTIME',
      source: 'window.error',
      stage: 'UNHANDLED',
      message: compact(event?.message || event?.error?.message || 'Unhandled content error', 700),
      error: event?.error || null,
      details: { filename: event?.filename || '', lineno: event?.lineno || 0, colno: event?.colno || 0 }
    });
  };
  const onUnhandledRejection = event => {
    const reason = event?.reason;
    void report({
      severity: 'ERROR',
      code: 'CONTENT_UNHANDLED_REJECTION',
      operationType: 'CONTENT_RUNTIME',
      source: 'unhandledrejection',
      stage: 'UNHANDLED',
      message: compact(reason?.message || reason || 'Unhandled content rejection', 700),
      error: reason instanceof Error ? reason : null
    });
  };
  const onStorageChanged = (changes, areaName) => {
    if (areaName !== 'local' || !changes?.simnet_workbench_diagnostics_v1) return;
    const state = changes.simnet_workbench_diagnostics_v1.newValue;
    if (!state || typeof state !== 'object') return;
    window.dispatchEvent?.(new CustomEvent('simnet-workbench-diagnostics-changed', { detail: state }));
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  chrome.storage?.onChanged?.addListener?.(onStorageChanged);

  WB.observability = Object.freeze({
    report,
    startOperation,
    getDiagnostics,
    markRead,
    clear,
    exportBundle,
    localFallback: () => localFallback.slice(),
    activeCount: () => activeOperations.size,
    destroy() {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      chrome.storage?.onChanged?.removeListener?.(onStorageChanged);
      for (const item of activeOperations.values()) if (item?.timer) clearTimeout(item.timer);
      activeOperations.clear();
    }
  });
})();
