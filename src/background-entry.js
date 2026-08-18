import './background.js';

const STATE_KEY = 'simnet_workbench_state_v5';
const BILLING_OPEN_MESSAGE = 'BILLING_OPEN_SEMANTIC_TARGET';
const PBX_REFRESH_MESSAGE = 'PBX_RECENT_CALLS_REFRESH';
const PBX_CONTENT_REFRESH_MESSAGE = 'SIMNET_WB_PBX_REFRESH_NOW';
const BILLING_SESSION_WAIT_MS = 9000;
const PBX_REFRESH_WAIT_MS = 3000;

const BILLING_HOSTS = new Set([
  'admin.simnet.kiev.ua',
  'admin.looknet.kiev.ua'
]);

const BILLING_TAB_PATTERNS = [
  'https://admin.simnet.kiev.ua/*',
  'https://admin.looknet.kiev.ua/*'
];

const BILLING_ROUTES = Object.freeze({
  'billing.technical': Object.freeze({
    path: '/cgi-bin/adm/adm.pl',
    a: 'dopdata',
    pageKind: 'billing_technical',
    tmpl: '1',
    parent_type: '0'
  }),
  'billing.user': Object.freeze({
    path: '/cgi-bin/adm/adm.pl',
    a: 'user',
    pageKind: 'billing_user'
  }),
  'billing.juniper': Object.freeze({
    path: '/cgi-bin/adm/stat.pl',
    a: '252',
    pageKind: 'billing_juniper'
  }),
  'billing.poll.entry': Object.freeze({
    path: '/cgi-bin/adm/adm.pl',
    a: 'user',
    pageKind: 'billing_user'
  }),
  'billing.poll.huawei': Object.freeze({
    path: '/cgi-bin/adm/stat.pl',
    a: '313',
    pageKind: 'billing_onu_poll'
  }),
  'billing.poll.epon': Object.freeze({
    path: '/cgi-bin/adm/stat.pl',
    a: '310',
    pageKind: 'billing_onu_poll'
  }),
  'billing.poll.gpon': Object.freeze({
    path: '/cgi-bin/adm/stat.pl',
    a: '311',
    pageKind: 'billing_onu_poll'
  }),
  'billing.poll.gcom': Object.freeze({
    path: '/cgi-bin/adm/stat.pl',
    a: '312',
    pageKind: 'billing_onu_poll'
  })
});

const rawFactValue = raw => (
  raw && typeof raw === 'object' && 'value' in raw
    ? raw.value
    : raw
);

function responseError(error) {
  return String(error?.message || error || 'Unknown extension error');
}

function caseBillingId(caseData) {
  const value = String(rawFactValue(caseData?.identity?.billingId) || '').trim();
  return /^\d+$/.test(value) ? value : '';
}

function billingOriginFromUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' || !BILLING_HOSTS.has(url.hostname)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function preferredBillingOrigin(caseData = null) {
  const urls = [];
  if (caseData?.currentContext?.url) urls.push(caseData.currentContext.url);
  for (const context of Object.values(caseData?.contexts || {})) {
    if (context?.url) urls.push(context.url);
  }
  for (const documents of Object.values(caseData?.viewsByTab || {})) {
    for (const view of Object.values(documents || {})) {
      if (view?.url) urls.push(view.url);
    }
  }
  for (const raw of urls) {
    const origin = billingOriginFromUrl(raw);
    if (origin) return origin;
  }
  return 'https://admin.simnet.kiev.ua';
}

function billingSessionFromUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' || !BILLING_HOSTS.has(url.hostname)) return null;
    const pp = String(url.searchParams.get('pp') || '');
    if (pp.length <= 3) return null;
    return {
      origin: url.origin,
      pp,
      uu: String(url.searchParams.get('uu') || '')
    };
  } catch {
    return null;
  }
}

function buildBillingTarget(semanticTargetId, entityId, session) {
  const spec = BILLING_ROUTES[String(semanticTargetId || '')] || null;
  const id = String(entityId || '').trim();
  if (!spec || !/^\d+$/.test(id) || !session?.pp || !BILLING_HOSTS.has(new URL(session.origin).hostname)) {
    return '';
  }
  const url = new URL(spec.path, session.origin);
  url.searchParams.set('pp', session.pp);
  if (session.uu) url.searchParams.set('uu', session.uu);
  url.searchParams.set('a', spec.a);
  url.searchParams.set('id', id);
  if (spec.tmpl) url.searchParams.set('tmpl', spec.tmpl);
  if (spec.parent_type != null) url.searchParams.set('parent_type', spec.parent_type);
  return url.href;
}

function isExactBillingTarget(rawUrl, semanticTargetId, entityId) {
  const spec = BILLING_ROUTES[String(semanticTargetId || '')] || null;
  if (!spec) return false;
  try {
    const url = new URL(String(rawUrl || ''));
    return BILLING_HOSTS.has(url.hostname)
      && url.pathname === spec.path
      && url.searchParams.get('a') === spec.a
      && url.searchParams.get('id') === String(entityId || '')
      && (!spec.tmpl || url.searchParams.get('tmpl') === spec.tmpl)
      && (spec.parent_type == null || url.searchParams.get('parent_type') === spec.parent_type)
      && Boolean(billingSessionFromUrl(url.href));
  } catch {
    return false;
  }
}

async function readCaseForNavigation(payload = {}) {
  const caseId = String(payload.caseId || '').trim();
  if (!caseId) return { ok: false, reason: 'case-missing', code: 'BILLING_DESTINATION_CASE_MISMATCH' };

  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored?.[STATE_KEY] || null;
  const caseData = state?.cases?.[caseId] || null;
  if (!caseData) return { ok: false, reason: 'case-not-found', code: 'BILLING_DESTINATION_CASE_MISMATCH' };
  if (state?.activeCaseId && String(state.activeCaseId) !== caseId) {
    return { ok: false, reason: 'case-not-active', code: 'BILLING_DESTINATION_CASE_MISMATCH' };
  }

  const billingId = caseBillingId(caseData);
  const requestedId = String(payload.entityId || billingId).trim();
  if (!billingId || !/^\d+$/.test(requestedId) || requestedId !== billingId) {
    return { ok: false, reason: 'entity-mismatch', code: 'BILLING_DESTINATION_CASE_MISMATCH' };
  }
  if (!BILLING_ROUTES[String(payload.semanticTargetId || '')]) {
    return { ok: false, reason: 'unknown-semantic-target', code: 'BILLING_DESTINATION_MISMATCH' };
  }

  return { ok: true, state, caseData, caseId, billingId };
}

async function focusTab(tab) {
  if (!tab?.id) return false;
  await chrome.tabs.update(tab.id, { active: true });
  if (Number.isInteger(tab.windowId)) {
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  }
  return true;
}

function waitForBillingSession(tabId, timeoutMs = BILLING_SESSION_WAIT_MS) {
  return new Promise(resolve => {
    let settled = false;
    let timer = null;

    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(value || '');
    };

    const inspect = async tab => {
      const url = String(tab?.url || '');
      if (billingSessionFromUrl(url)) finish(url);
    };

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.url && billingSessionFromUrl(changeInfo.url)) {
        finish(changeInfo.url);
        return;
      }
      if (changeInfo.status === 'complete') void inspect(tab);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    timer = setTimeout(() => finish(''), timeoutMs);
    void chrome.tabs.get(tabId).then(inspect).catch(() => finish(''));
  });
}

async function openBillingSemanticTarget(payload = {}) {
  const resolved = await readCaseForNavigation(payload);
  if (!resolved.ok) return resolved;

  const semanticTargetId = String(payload.semanticTargetId || '');
  const expectedPageKind = BILLING_ROUTES[semanticTargetId]?.pageKind || '';
  const tabs = await chrome.tabs.query({ url: BILLING_TAB_PATTERNS });

  const preferredOrigin = preferredBillingOrigin(resolved.caseData);
  const exact = tabs.find(tab => (
    billingOriginFromUrl(tab.url) === preferredOrigin
    && isExactBillingTarget(tab.url, semanticTargetId, resolved.billingId)
  ));
  if (exact) {
    await focusTab(exact);
    return {
      ok: true,
      method: 'reuse-billing-target',
      openedNewTab: false,
      targetTabId: exact.id,
      expectedPageKind,
      deferredVerification: true
    };
  }

  const authenticatedTabs = tabs
    .map(tab => ({ tab, session: billingSessionFromUrl(tab.url) }))
    .filter(item => item.session);
  const sessionSource = authenticatedTabs.find(item => item.session.origin === preferredOrigin) || null;

  if (sessionSource) {
    const targetUrl = buildBillingTarget(semanticTargetId, resolved.billingId, sessionSource.session);
    if (!targetUrl) return { ok: false, reason: 'target-build-failed', code: 'BILLING_NAVIGATION_BUILD_FAILED' };
    const target = await chrome.tabs.create({ url: targetUrl, active: true });
    return {
      ok: true,
      method: 'new-billing-tab',
      openedNewTab: true,
      targetTabId: target.id,
      expectedPageKind,
      deferredVerification: true
    };
  }

  // No prior source tab is a normal first-entry case. Open Billing itself and
  // wait only for a live authenticated session URL; never copy/fabricate pp.
  const bootstrap = await chrome.tabs.create({
    url: `${preferredOrigin}/cgi-bin/adm/adm.pl`,
    active: true
  });
  if (!bootstrap?.id) {
    return { ok: false, reason: 'billing-tab-create-failed', code: 'BILLING_NAVIGATION_COMMIT_FAILED' };
  }

  const authenticatedUrl = await waitForBillingSession(bootstrap.id);
  const session = billingSessionFromUrl(authenticatedUrl);
  if (!session || session.origin !== preferredOrigin) {
    return {
      ok: false,
      reason: 'billing-session-not-established',
      code: 'BILLING_SESSION_NOT_CONFIRMED',
      openedNewTab: true,
      targetTabId: bootstrap.id
    };
  }

  const targetUrl = buildBillingTarget(semanticTargetId, resolved.billingId, session);
  if (!targetUrl) {
    return {
      ok: false,
      reason: 'target-build-failed',
      code: 'BILLING_NAVIGATION_BUILD_FAILED',
      targetTabId: bootstrap.id
    };
  }
  await chrome.tabs.update(bootstrap.id, { url: targetUrl, active: true });
  return {
    ok: true,
    method: 'new-billing-tab-after-session',
    openedNewTab: true,
    targetTabId: bootstrap.id,
    expectedPageKind,
    deferredVerification: true
  };
}

function withTimeout(promise, timeoutMs, fallback) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    Promise.resolve(promise).then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

async function refreshPbxRecentCalls() {
  const tabs = await chrome.tabs.query({ url: 'https://pbx.simnet.kiev.ua/*' });
  if (!tabs.length) {
    return { ok: false, refreshed: false, reason: 'pbx-tab-not-found' };
  }

  const ordered = [...tabs].sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active)));
  for (const tab of ordered) {
    if (!tab?.id) continue;
    const result = await withTimeout(
      chrome.tabs.sendMessage(tab.id, { type: PBX_CONTENT_REFRESH_MESSAGE }),
      PBX_REFRESH_WAIT_MS,
      null
    );
    if (result?.ok) {
      return {
        ok: true,
        refreshed: Boolean(result.refreshed),
        callCount: Number(result.callCount || 0),
        source: String(result.source || 'pbx-tab'),
        targetTabId: tab.id
      };
    }
  }

  return { ok: false, refreshed: false, reason: 'pbx-refresh-unavailable' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (type !== BILLING_OPEN_MESSAGE && type !== PBX_REFRESH_MESSAGE) return false;

  const operation = type === BILLING_OPEN_MESSAGE
    ? openBillingSemanticTarget(message?.payload || {})
    : refreshPbxRecentCalls();

  Promise.resolve(operation).then(data => {
    sendResponse({ success: true, data });
  }).catch(error => {
    sendResponse({ success: false, error: responseError(error) });
  });
  return true;
});
