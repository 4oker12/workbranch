(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__billingNavigationFallbackLoaded) return;
  if (!WB.billingNavigation || typeof WB.billingNavigation.navigate !== 'function') return;

  WB.__billingNavigationFallbackLoaded = true;

  const OPEN_MESSAGE = 'BILLING_OPEN_SEMANTIC_TARGET';
  const originalNavigate = WB.billingNavigation.navigate.bind(WB.billingNavigation);
  const valueOf = raw => raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;

  function canFallback(result, options = {}) {
    if (result?.ok) return false;
    const page = WB.runtime?.lastContext || {};
    const semanticTargetId = String(options.semanticTargetId || '');
    const reason = String(result?.reason || '');
    const code = String(result?.code || '');

    if (page.system !== 'userside') return false;
    if (!semanticTargetId.startsWith('billing.')) return false;
    if (['case-mismatch', 'entity-mismatch', 'auth-page'].includes(reason)) return false;
    if (code === 'BILLING_DESTINATION_CASE_MISMATCH' || code === 'BILLING_AUTH_PAGE_REACHED') return false;

    // Missing source handoff is expected when the Case started in UserSide.
    // It must not be a terminal navigation failure.
    return reason === 'source-tab-not-found'
      || reason === 'session-not-confirmed'
      || code === 'BILLING_SESSION_NOT_CONFIRMED';
  }

  async function openFreshBillingTarget(options = {}, originalResult = null) {
    const caseData = WB.store?.activeCase?.() || null;
    const caseId = String(options.caseId || caseData?.id || '');
    const entityId = String(
      options.entityId
      || valueOf(caseData?.identity?.billingId)
      || ''
    );

    WB.operatorTrace?.recordSystemEvent?.('BILLING_NEW_TAB_FALLBACK_REQUESTED', {
      caseId,
      semanticTargetId: String(options.semanticTargetId || ''),
      operationId: String(options.operationId || ''),
      originalReason: String(originalResult?.reason || '')
    });

    try {
      const response = await chrome.runtime.sendMessage({
        type: OPEN_MESSAGE,
        payload: {
          caseId,
          semanticTargetId: String(options.semanticTargetId || ''),
          entityId,
          intent: String(options.intent || 'GUIDED_NAVIGATION'),
          operationId: String(options.operationId || ''),
          sourceAction: String(options.sourceAction || '')
        }
      });

      if (response?.success && response.data?.ok) {
        WB.operatorTrace?.recordSystemEvent?.('BILLING_NEW_TAB_FALLBACK_COMMITTED', {
          caseId,
          semanticTargetId: String(options.semanticTargetId || ''),
          operationId: String(options.operationId || ''),
          method: String(response.data.method || ''),
          targetTabId: response.data.targetTabId ?? null
        });
        return response.data;
      }

      WB.operatorTrace?.recordSystemEvent?.('BILLING_NEW_TAB_FALLBACK_REJECTED', {
        caseId,
        semanticTargetId: String(options.semanticTargetId || ''),
        operationId: String(options.operationId || ''),
        reason: String(response?.data?.reason || response?.error || 'fallback-rejected')
      });
      return null;
    } catch (error) {
      WB.observability?.report?.({
        severity: 'ERROR',
        code: 'BILLING_NEW_TAB_FALLBACK_FAILED',
        operationType: 'BILLING_NAVIGATION',
        source: 'billing-navigation-fallback',
        stage: 'OPEN_TARGET',
        message: error?.message || String(error),
        error,
        details: {
          caseId,
          semanticTargetId: String(options.semanticTargetId || '')
        }
      });
      return null;
    }
  }

  WB.billingNavigation.navigate = async function navigateWithFirstEntryFallback(options = {}) {
    const result = await originalNavigate(options);
    if (!canFallback(result, options)) return result;

    const fallback = await openFreshBillingTarget(options, result);
    if (fallback?.ok) {
      return {
        ...fallback,
        fallbackFrom: String(result?.reason || result?.code || 'source-tab-missing')
      };
    }
    return result;
  };

  WB.billingNavigation.firstEntryFallback = Object.freeze({
    messageType: OPEN_MESSAGE,
    invariant: 'missing-source-tab-opens-or-reuses-safe-billing-target'
  });
})();
