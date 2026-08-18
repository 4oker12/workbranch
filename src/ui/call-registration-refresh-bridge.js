(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__callRegistrationRefreshBridgeLoaded) return;
  const registration = WB.callRegistration;
  if (!registration || typeof registration.open !== 'function') return;

  WB.__callRegistrationRefreshBridgeLoaded = true;

  const REFRESH_MESSAGE = 'PBX_RECENT_CALLS_REFRESH';
  const originalOpen = registration.open.bind(registration);
  const valueOf = raw => raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;

  async function refreshRecentCalls(caseData = null) {
    const current = caseData || WB.store?.activeCase?.() || null;
    if (!current?.id) return { ok: false, reason: 'case-missing' };

    try {
      const response = await chrome.runtime.sendMessage({
        type: REFRESH_MESSAGE,
        payload: {
          caseId: String(current.id || ''),
          customerId: String(valueOf(current?.identity?.customerId) || '')
        }
      });
      return response?.success
        ? (response.data || { ok: false, reason: 'empty-refresh-response' })
        : { ok: false, reason: String(response?.error || 'pbx-refresh-failed') };
    } catch (error) {
      // Refresh is best-effort. Cached PBX calls are still usable and the call
      // form must not become unavailable just because the PBX tab is closed.
      return { ok: false, reason: String(error?.message || error || 'pbx-refresh-failed') };
    }
  }

  registration.open = async function openWithFreshPbx(caseData = WB.store?.activeCase?.() || null) {
    const refreshed = await refreshRecentCalls(caseData);
    WB.operatorTrace?.recordSystemEvent?.('PBX_CALL_LIST_REFRESH_ON_OPEN', {
      caseId: String(caseData?.id || ''),
      refreshed: Boolean(refreshed?.refreshed),
      callCount: Number(refreshed?.callCount || 0),
      reason: String(refreshed?.reason || '')
    });
    return originalOpen(caseData);
  };

  registration.refreshRecentCalls = refreshRecentCalls;
})();
