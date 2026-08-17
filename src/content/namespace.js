(() => {
  'use strict';
  if (window.top !== window.self) return;

  const existing = globalThis.SIMNET_WB;
  if (existing?.version === '1.7.29.50') return;

  const pageInstanceStartedAt = Date.now();

  const importantLogState = new Map();
  const writeImportantLog = (level, scope, event, details = null) => {
    const method = ['info', 'warn', 'error'].includes(level) ? level : 'info';
    const prefix = `[SIMNET WB][${String(scope || 'APP').toUpperCase()}] ${event}`;
    if (details && typeof details === 'object' && Object.keys(details).length) {
      console[method](prefix, details);
    } else {
      console[method](prefix);
    }
  };

  globalThis.SIMNET_WB = {
    version: '1.7.29.50',
    stateKey: 'simnet_workbench_state_v5',
    actionSessionFastKey: 'simnet_workbench_action_session_fast_v1',
    adapters: {},
    utils: {},
    log: {
      info(scope, event, details) {
        writeImportantLog('info', scope, event, details);
      },
      warn(scope, event, details) {
        writeImportantLog('warn', scope, event, details);
      },
      error(scope, event, details) {
        writeImportantLog('error', scope, event, details);
      },
      changed(key, signature, scope, event, details) {
        const normalizedKey = String(key || 'event');
        const normalizedSignature = String(signature ?? '');
        if (importantLogState.get(normalizedKey) === normalizedSignature) return false;
        importantLogState.set(normalizedKey, normalizedSignature);
        writeImportantLog('info', scope, event, details);
        return true;
      }
    },
    runtime: {
      booted: false,
      destroyed: false,
      lastContext: null,
      handoffClaim: null,
      pageInstanceId: (
        globalThis.crypto?.randomUUID?.()
        || `page_${pageInstanceStartedAt.toString(36)}_${Math.random().toString(36).slice(2)}`
      ),
      pageInstanceStartedAt,
      documentId: (
        globalThis.crypto?.randomUUID?.()
        || `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
      )
    }
  };
})();
