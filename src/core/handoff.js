(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const TOKEN_PREFIX = 'simnet_wb_';
  const HASH_KEY = 'simnet-wb-handoff';
  const CLAIM_RETRIES = 14;
  const CLAIM_DELAY_MS = 220;

  const valueOf = fact =>
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function clonePlain(value) {
    if (value == null) return null;
    try { return structuredClone(value); } catch {}
    try { return JSON.parse(JSON.stringify(value)); } catch {}
    return null;
  }

  function actionWorkflowSnapshot(caseData = WB.store?.activeCase?.() || null) {
    const workflow = caseData?.workflow?.actionSession || null;
    if (!workflow) return null;
    const active = clonePlain(workflow.active);
    const lastTerminal = clonePlain(workflow.lastTerminal);
    if (!active && !lastTerminal) return null;
    return {
      schema: 'simnet-universal-action-session-v1',
      active,
      lastTerminal,
      updatedAt: String(workflow.updatedAt || '')
    };
  }

  function hydrateActionWorkflow(caseId, workflow = null) {
    const id = String(caseId || '');
    const caseData = WB.store?.state?.cases?.[id] || null;
    const active = workflow?.active && typeof workflow.active === 'object'
      ? clonePlain(workflow.active)
      : null;
    if (!caseData || !active?.operationId) return false;
    if (String(active.caseId || '') !== id) return false;
    // A Billing -> UserSide TMC handoff may only seed its own semantic action.
    // Never let a stale/foreign action hitch a ride into the target tab.
    if (String(active.semanticTargetId || '') !== 'userside.tmc') return false;
    caseData.workflow ||= {};
    caseData.workflow.actionSession = {
      schema: 'simnet-universal-action-session-v1',
      active,
      lastTerminal: clonePlain(workflow?.lastTerminal),
      updatedAt: String(workflow?.updatedAt || active.lastTransitionAt || '')
    };
    if (WB.store?.fastActionSessions) {
      WB.store.fastActionSessions[id] = {
        active: clonePlain(active),
        lastTerminal: clonePlain(workflow?.lastTerminal),
        updatedAt: String(workflow?.updatedAt || active.lastTransitionAt || '')
      };
    }
    WB.actionLifecycle?.syncFromCase?.(caseData);
    return true;
  }

  function queueSemanticHandoffResume({ caseId = '', purpose = '', actionWorkflow = null } = {}) {
    const id = String(caseId || '');
    if (!id) return false;
    if (actionWorkflow) hydrateActionWorkflow(id, actionWorkflow);
    WB.runtime.pendingSemanticHandoffResume = {
      caseId: id,
      purpose: String(purpose || ''),
      semanticTargetId: String(actionWorkflow?.active?.semanticTargetId || (String(purpose || '').startsWith('userside-tmc') ? 'userside.tmc' : '')),
      queuedAt: Date.now()
    };
    return true;
  }

  async function resumePendingSemanticHandoff(reason = 'handoff-resume') {
    const pending = WB.runtime.pendingSemanticHandoffResume || null;
    if (!pending?.caseId) return { ok: false, reason: 'no-pending-handoff-resume' };
    const caseData = WB.store?.activeCase?.() || null;
    if (!caseData?.id || String(caseData.id) !== String(pending.caseId)) {
      return { ok: false, reason: 'handoff-case-not-active' };
    }
    const pageCustomerId = currentUsersideCustomerId();
    const caseCustomerId = String(valueOf(caseData?.identity?.customerId) || '').replace(/\D+/g, '');
    if (!pageCustomerId || (caseCustomerId && pageCustomerId !== caseCustomerId)) {
      return { ok: false, reason: 'handoff-customer-mismatch' };
    }

    let result = await WB.guide?.continueActiveActionSession?.(caseData)
      || { ok: false, reason: 'guide-unavailable' };

    // The handoff itself is the operator command. If a previous implementation
    // lost the tiny ActionSession snapshot between tabs, rebuild exactly the
    // userside.tmc semantic action here instead of waiting for LIVE/render/store
    // traffic to accidentally create a new Guide action later.
    if (
      !result?.ok
      && String(pending.semanticTargetId || '') === 'userside.tmc'
      && ['no-active-action', 'action-session-unavailable', 'target-not-ready', 'resolver-missing'].includes(String(result?.reason || ''))
    ) {
      result = await WB.guide?.resumeTmcHandoff?.(caseData, {
        sourceAction: `handoff:${reason}`
      }) || result;
    }

    WB.operatorTrace?.recordSystemEvent?.('TMC_HANDOFF_SEMANTIC_RESUME', {
      caseId: caseData.id || '',
      semanticTargetId: String(pending.semanticTargetId || ''),
      resumeReason: String(reason || ''),
      result: String(result?.reason || (result?.ok ? 'ok' : 'unknown')),
      operationId: String(result?.session?.operationId || WB.actionLifecycle?.current?.()?.operationId || '')
    });
    if (result?.ok || result?.queued || ['target-not-ready', 'replay-target-not-ready'].includes(String(result?.reason || ''))) {
      if (result?.ok) WB.runtime.pendingSemanticHandoffResume = null;
      return result;
    }
    return result;
  }

  function createToken() {
    const random = crypto?.randomUUID?.()
      || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

    return `${TOKEN_PREFIX}${random.replace(/[^a-z0-9_-]/gi, '')}`;
  }

  function extractToken() {
    const name = String(window.name || '');
    if (name.startsWith(TOKEN_PREFIX)) return name;

    const hash = String(location.hash || '');
    const params = new URLSearchParams(
      hash.startsWith('#') ? hash.slice(1) : hash
    );
    const token = params.get(HASH_KEY) || '';

    return token.startsWith(TOKEN_PREFIX)
      ? token
      : '';
  }

  function decorateUrl(rawUrl, token) {
    try {
      const url = new URL(rawUrl, location.href);
      const hash = new URLSearchParams(
        url.hash.startsWith('#')
          ? url.hash.slice(1)
          : url.hash
      );

      hash.set(HASH_KEY, token);
      url.hash = hash.toString();
      return url.href;
    } catch {
      return rawUrl;
    }
  }

  function subscriberIpFromLink(anchor) {
    try {
      return new URL(
        anchor.href,
        location.href
      ).searchParams.get('ip') || '';
    } catch {
      return '';
    }
  }

  function extractPageIp() {
    const candidates = [
      location.href,
      document.documentElement?.innerHTML || ''
    ].join('\n');

    const patterns = [
      /(?:gotouser\.php|reload_ping_data)[^"'<>]{0,160}[?&]ip=((?:\d{1,3}\.){3}\d{1,3})/i,
      /(?:^|[^\d])ip\s*[:=]\s*((?:\d{1,3}\.){3}\d{1,3})(?:[^\d]|$)/i
    ];

    for (const pattern of patterns) {
      const match = candidates.match(pattern);
      if (match?.[1]) return match[1];
    }

    return '';
  }

  function currentCaseIdentity() {
    const currentCase = WB.store.activeCase?.()
      || WB.store.state?.cases?.[
        WB.store.localCaseId
        || WB.store.state?.activeCaseId
      ]
      || null;

    return {
      caseId: (
        WB.store.localCaseId
        || WB.store.state?.activeCaseId
        || ''
      ),
      subscriberIp: valueOf(currentCase?.network?.ip) || '',
      login: valueOf(currentCase?.identity?.login) || '',
      contract: valueOf(currentCase?.identity?.contract) || '',
      billingId: valueOf(currentCase?.identity?.billingId) || '',
      customerId: valueOf(currentCase?.identity?.customerId) || ''
    };
  }

  async function prepareFromAnchor(anchor) {
    if (!anchor?.href) return null;

    const identity = currentCaseIdentity();
    if (!identity.caseId) return null;

    const token = createToken();
    const subscriberIp = (
      subscriberIpFromLink(anchor)
      || identity.subscriberIp
    );

    // Фрагмент не отправляется серверу и служит только резервным каналом.
    anchor.href = decorateUrl(anchor.href, token);

    // Уникальное window.name переживает открытие новой вкладки/окна.
    if (
      !anchor.target
      || anchor.target === '_blank'
    ) {
      anchor.target = token;
    }

    const payload = {
      token,
      purpose: 'userside-tmc',
      targetUrl: anchor.href,
      subscriberIp,
      login: identity.login,
      contract: identity.contract,
      billingId: identity.billingId,
      customerId: identity.customerId,
      actionSession: actionWorkflowSnapshot(WB.store?.activeCase?.() || null)
    };

    WB.runtime.pendingHandoff = payload;

    try {
      // Persist the handoff before opening UserSide. Otherwise a very fast target
      // tab can boot before the background state contains the token and must burn
      // retry cycles before it can bind the Case.
      await WB.store.prepareHandoff(payload);
    } catch (error) {
      console.warn(
        '[SIMNET Workbench handoff] prepare failed',
        error
      );
      return null;
    }

    return payload;
  }

  async function openUsersideForCase(caseData = null) {
    const identity = currentCaseIdentity();
    const subscriberIp = String(
      valueOf(caseData?.network?.ip)
      || identity.subscriberIp
      || ''
    );
    const customerId = String(
      valueOf(caseData?.identity?.customerId)
      || identity.customerId
      || ''
    );
    if (!subscriberIp && !customerId) {
      return { ok: false, reason: 'userside-identity-missing' };
    }

    // Fastest safe path: if this exact Case is already open in UserSide, focus
    // that tab before creating/persisting a new handoff. This avoids joining the
    // serialized full-State write queue and avoids any UserSide reload.
    if (/^\d+$/.test(customerId) && WB.store?.focusExistingUsersideCase) {
      try {
        const existing = await WB.store.focusExistingUsersideCase({
          caseId: identity.caseId,
          customerId,
          actionSession: actionWorkflowSnapshot(caseData || WB.store?.activeCase?.() || null)
        });
        if (existing?.focused && existing?.caseBound === true) {
          return {
            ok: true,
            reused: true,
            reusedWithoutReload: true,
            existingCaseTab: true,
            fastCaseBound: true,
            targetTabId: existing.targetTabId ?? null,
            customerId
          };
        }
        // If the exact tab was focused but its content script could not prove
        // and bind the requested Case, do not stop on the UserSide card. Fall
        // through to the established token/hash claim path, which rebinds the
        // tab and preserves the one-click TMC transaction.
      } catch (error) {
        // Fast reuse is optional. The proven handoff path below remains the
        // fallback for a missing/stale tab or a temporary messaging failure.
        console.warn('[SIMNET Workbench handoff] exact Case tab focus failed', error);
      }
    }

    const anchor = document.createElement('a');
    // Once the Case already knows the exact UserSide customer, skip gotouser.php.
    // The redirect-by-IP is required only for the first discovery. Replays and
    // revisits can open the canonical customer card directly and avoid a full
    // extra server redirect/search hop.
    const useDirectCustomer = /^\d+$/.test(customerId);
    const url = useDirectCustomer
      ? new URL(`/customer/${customerId}`, 'https://userside.simnet.kiev.ua')
      : new URL('/script/gotouser.php', 'https://userside.simnet.kiev.ua');
    if (!useDirectCustomer && subscriberIp) url.searchParams.set('ip', subscriberIp);
    anchor.href = url.href;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);

    const prepared = await prepareFromAnchor(anchor);
    if (!prepared) {
      anchor.remove();
      return { ok: false, reason: 'handoff-prepare-failed' };
    }

    try {
      const reused = await WB.store.openHandoffTarget({
        token: prepared.token,
        caseId: identity.caseId,
        targetUrl: prepared.targetUrl
      });
      if (reused?.opened) {
        anchor.remove();
        return {
          ok: true,
          token: prepared.token,
          targetUrl: prepared.targetUrl,
          reused: true,
          reusedWithoutReload: Boolean(reused.reusedWithoutReload),
          targetTabId: reused.targetTabId ?? null
        };
      }
    } catch (error) {
      // Reuse is an optimization only. Failure must preserve the proven
      // new-tab handoff path rather than making navigation unavailable.
      console.warn('[SIMNET Workbench handoff] target reuse failed', error);
    }

    // Keep the Billing technical page alive as the source tab. The UserSide
    // card opens in the handoff target tab, so "Обновить технические данные"
    // can return to the exact Billing tab without rebuilding an authenticated URL.
    anchor.click();
    anchor.remove();
    return { ok: true, token: prepared.token, targetUrl: prepared.targetUrl };
  }

  async function claimOnUserside() {
    if (location.hostname !== 'userside.simnet.kiev.ua') {
      return null;
    }

    const token = extractToken();
    const subscriberIp = extractPageIp();

    // Без одноразового токена делаем ровно одну проверку. Повторные полные
    // чтения/записи тяжёлого Case не должны задерживать обычную карточку UserSide.
    const retries = token
      ? CLAIM_RETRIES
      : 1;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const claim = await WB.store.claimHandoff({
          token,
          subscriberIp,
          currentUrl: location.href,
          pageKindHint: /^\/customer\/\d+/i.test(location.pathname)
            ? 'userside_customer'
            : 'userside_other'
        });

        if (claim?.caseId) {
          WB.runtime.handoffClaim = claim;
          WB.store.bindCase?.(claim.caseId);
          hydrateActionWorkflow(claim.caseId, claim.actionSession || null);
          queueSemanticHandoffResume({
            caseId: claim.caseId,
            purpose: claim.purpose,
            actionWorkflow: claim.actionSession || null
          });
          WB.store.resume?.();

          // First document boot happens before bootstrap exposes forceScan. In
          // that path bootstrap performs one canonical scan and then explicitly
          // resumes this pending semantic handoff. An already-loaded/hash-reused
          // UserSide tab *does* have forceScan, so refresh its Case evidence now
          // and continue immediately. No LIVE/render/store event is required.
          // Try the carried semantic action immediately as well. The DOM resolver
          // can often see the native TMC row before the first adapter scan; if it
          // cannot, ActionLifecycle's bounded target retry remains armed. The
          // post-boot canonical scan below is still the deterministic safety net.
          queueMicrotask(() => {
            const activeCase = WB.store.activeCase?.() || null;
            if (activeCase?.id === claim.caseId) {
              void WB.guide?.continueActiveActionSession?.(activeCase);
            }
          });

          if (typeof WB.runtime.forceScan === 'function') {
            queueMicrotask(async () => {
              try { await WB.runtime.forceScan('handoff-claimed'); } catch {}
              await resumePendingSemanticHandoff('claimed-live-document');
            });
          }

          // После подтверждения одноразовый маркер больше не нужен.
          if (token && window.name === token) {
            try {
              window.name = '';
            } catch {}
          }

          if (token && location.hash.includes(HASH_KEY)) {
            try {
              const url = new URL(location.href);
              const hash = new URLSearchParams(
                url.hash.startsWith('#')
                  ? url.hash.slice(1)
                  : url.hash
              );
              hash.delete(HASH_KEY);
              url.hash = hash.toString();
              history.replaceState(
                history.state,
                '',
                url.href
              );
            } catch {}
          }

          return claim;
        }
      } catch (error) {
        if (attempt === retries - 1) {
          console.warn(
            '[SIMNET Workbench handoff] claim failed',
            error
          );
        }
      }

      if (attempt < retries - 1) await sleep(CLAIM_DELAY_MS);
    }

    return null;
  }

  window.addEventListener('hashchange', () => {
    if (
      location.hostname !== 'userside.simnet.kiev.ua'
      || !extractToken()
    ) {
      return;
    }
    // Reusing an already-open exact customer tab changes only the hash, so no
    // document boot occurs. Claim the fresh handoff explicitly and wake the
    // semantic scanner once; this is not a polling loop.
    void claimOnUserside();
  });

  function currentUsersideCustomerId() {
    if (location.hostname !== 'userside.simnet.kiev.ua') return '';
    return location.pathname.match(/^\/customer\/(\d+)\/?$/i)?.[1] || '';
  }

  async function acceptFastCaseBind(payload = {}) {
    const caseId = String(payload?.caseId || '');
    const requestedCustomerId = String(payload?.customerId || '').replace(/\D+/g, '');
    const pageCustomerId = currentUsersideCustomerId();
    if (!caseId || !requestedCustomerId || !pageCustomerId || pageCustomerId !== requestedCustomerId) {
      return { accepted: false, reason: 'customer-mismatch' };
    }

    const caseData = WB.store?.state?.cases?.[caseId] || null;
    const caseCustomerId = String(valueOf(caseData?.identity?.customerId) || '').replace(/\D+/g, '');
    if (!caseData || !caseCustomerId || caseCustomerId !== requestedCustomerId) {
      return { accepted: false, reason: 'case-identity-not-confirmed' };
    }
    if (!WB.store.bindCase?.(caseId)) {
      return { accepted: false, reason: 'case-bind-failed' };
    }

    WB.runtime.handoffClaim = {
      caseId,
      customerId: requestedCustomerId,
      purpose: String(payload?.purpose || 'userside-fast-focus'),
      fastFocus: true
    };
    hydrateActionWorkflow(caseId, payload?.actionSession || null);
    queueSemanticHandoffResume({
      caseId,
      purpose: String(payload?.purpose || 'userside-tmc'),
      actionWorkflow: payload?.actionSession || null
    });

    // No reload, no full-State round trip: scan the already-loaded target once,
    // then execute the carried semantic command. Awaiting the scan is important:
    // it gives the Guide the current TMC OLT/SN/MAC values before visual
    // confirmation and prevents a later LIVE render from becoming the wake-up.
    WB.store.resume?.();
    queueMicrotask(async () => {
      try { await WB.runtime.forceScan?.('handoff-fast-case-bind'); } catch {}
      const activeCase = WB.store.activeCase?.() || null;
      if (activeCase?.id === caseId) {
        await WB.guide?.continueActiveActionSession?.(activeCase);
      }
      await resumePendingSemanticHandoff('fast-case-bind');
    });

    return { accepted: true, caseId, customerId: requestedCustomerId };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'HANDOFF_FAST_CASE_BIND') return undefined;
    Promise.resolve(acceptFastCaseBind(message?.payload || {}))
      .then(sendResponse)
      .catch(error => sendResponse({ accepted: false, reason: error?.message || String(error) }));
    return true;
  });

  function isUsersideHandoffLink(anchor) {
    if (!anchor?.href) return false;

    try {
      const url = new URL(anchor.href, location.href);
      return (
        url.hostname === 'userside.simnet.kiev.ua'
        && /\/script\/gotouser\.php$/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  document.addEventListener(
    'click',
    event => {
      if (
        location.hostname !== 'admin.simnet.kiev.ua'
        && location.hostname !== 'admin.looknet.kiev.ua'
      ) {
        return;
      }

      const anchor = event.target.closest?.('a[href]');
      if (!isUsersideHandoffLink(anchor)) return;

      // Не блокируем штатный клик. Claim на целевой странице имеет retry.
      prepareFromAnchor(anchor);
    },
    true
  );

  WB.handoff = {
    init: claimOnUserside,
    prepareFromAnchor,
    openUsersideForCase,
    focusSource: (caseData = null, options = {}) => WB.store.focusHandoffSource({
      token: WB.runtime.handoffClaim?.token || extractToken(),
      caseId: WB.runtime.handoffClaim?.caseId || String(caseData?.id || ''),
      targetUrl: String(options?.targetUrl || ''),
      semanticTargetId: String(options?.semanticTargetId || ''),
      entityId: String(options?.entityId || valueOf(caseData?.identity?.billingId) || '')
    }),
    extractToken,
    extractPageIp,
    isUsersideHandoffLink,
    resumePendingSemanticHandoff,
    actionWorkflowSnapshot
  };
})();
