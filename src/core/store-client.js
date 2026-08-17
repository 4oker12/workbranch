(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const MessageType = {
    STORE_GET_STATE: 'STORE_GET_STATE',
    STORE_APPLY_CONTEXT: 'STORE_APPLY_CONTEXT',
    STORE_ADD_EVENT: 'STORE_ADD_EVENT',
    STORE_PATCH_UI: 'STORE_PATCH_UI',
    STORE_PATCH_APPEAL: 'STORE_PATCH_APPEAL',
    STORE_PATCH_WORKFLOW: 'STORE_PATCH_WORKFLOW',
    STORE_RESET_CASE: 'STORE_RESET_CASE',
    HANDOFF_PREPARE: 'HANDOFF_PREPARE',
    HANDOFF_OPEN_TARGET: 'HANDOFF_OPEN_TARGET',
    HANDOFF_FOCUS_EXISTING_CASE: 'HANDOFF_FOCUS_EXISTING_CASE',
    HANDOFF_FAST_CASE_BIND: 'HANDOFF_FAST_CASE_BIND',
    HANDOFF_CLAIM: 'HANDOFF_CLAIM',
    HANDOFF_FOCUS_SOURCE: 'HANDOFF_FOCUS_SOURCE',
    GUIDE_MARK_STEP: 'GUIDE_MARK_STEP',
    POLL_ATTEMPT_UPDATE: 'POLL_ATTEMPT_UPDATE',
    JUNIPER_PREFETCH_STATUS: 'JUNIPER_PREFETCH_STATUS'
  };

  const CORRELATED_TYPES = new Set([
    MessageType.STORE_APPLY_CONTEXT,
    MessageType.GUIDE_MARK_STEP,
    'LOCATOR_APPLY_OBSERVATION',
    MessageType.POLL_ATTEMPT_UPDATE,
    MessageType.JUNIPER_PREFETCH_STATUS
  ]);

  const isExtensionContextInvalidated = error => {
    const message = String(error?.message || error || '');
    return /Extension context invalidated|context invalidated|Receiving end does not exist|Could not establish connection/i.test(message);
  };

  const markExtensionContextInvalidated = error => {
    if (WB.runtime.extensionContextInvalidated) return;
    WB.runtime.extensionContextInvalidated = true;
    const message = String(error?.message || error || 'Extension context invalidated.');
    WB.runtime.invalidateExtensionContext?.(message);
    WB.bus?.emit?.('extension:invalidated', { message });
  };

  const WRITE_TYPES = new Set([
    MessageType.STORE_APPLY_CONTEXT,
    MessageType.STORE_ADD_EVENT,
    MessageType.STORE_PATCH_UI,
    MessageType.STORE_PATCH_APPEAL,
    MessageType.STORE_PATCH_WORKFLOW,
    MessageType.STORE_RESET_CASE,
    MessageType.HANDOFF_PREPARE,
    MessageType.HANDOFF_OPEN_TARGET,
    MessageType.GUIDE_MARK_STEP,
    MessageType.POLL_ATTEMPT_UPDATE,
    MessageType.JUNIPER_PREFETCH_STATUS,
    'LOCATOR_APPLY_OBSERVATION'
  ]);

  const valueOf = raw => raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
  const clean = raw => String(valueOf(raw) ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const digits = raw => String(valueOf(raw) ?? '').replace(/\D+/g, '');
  const mac = raw => {
    const hex = String(valueOf(raw) ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex : '';
  };

  function identityFingerprint(input = {}) {
    const identity = input.identity || input;
    const network = input.network || {};
    return [
      clean(identity.login),
      digits(identity.contract),
      digits(identity.billingId),
      digits(identity.customerId),
      mac(network.mac)
    ].join('|');
  }

  function bindingFingerprint(input = {}) {
    const pon = input.pon || input;
    return [
      clean(pon.oltName),
      clean(pon.oltIp),
      mac(pon.onuMac),
      clean(pon.onuSerial),
      clean(pon.pollAction),
      clean(pon.locatedInterface || pon.interface)
    ].join('|');
  }

  class StoreClient {
    constructor() {
      this.state = null;
      this.localCaseId = '';
      this.ready = false;
      this.lastPublishedRevision = '';
      this.deferredPublish = false;
      this.fastActionSessions = {};
      this.boundStorage = this.onStorageChanged.bind(this);
    }

    stateRevision(state = this.state) {
      return [
        state?.meta?.updatedAt || '',
        state?.activeCaseId || '',
        Object.keys(state?.cases || {}).length
      ].join('|');
    }

    publishState(state = this.state, { force = false } = {}) {
      if (!state) return false;
      const revision = this.stateRevision(state);
      if (!force && revision && revision === this.lastPublishedRevision) return false;
      this.lastPublishedRevision = revision;
      WB.bus.emit('store:state', state);
      return true;
    }

    createEnvelope(type, payload = {}, operation = {}) {
      const context = payload?.context || WB.runtime?.lastContext || {};
      const localAttempt = WB.interactionGuards?.recentPollRequest?.() || null;
      const requestedPollAttemptId = String(
        operation.pollAttemptId
        || payload?.attempt?.pollAttemptId
        || ''
      );
      const isPollResponse = Boolean(
        context?.pageKind === 'billing_onu_poll'
        && context?.meta?.poll?.requestObserved
      );
      const openedPollAction = String(
        context?.meta?.poll?.openedAction
        || context?.subview?.replace(/^a/i, '')
        || ''
      );
      const responseBillingId = String(
        valueOf(context?.identity?.billingId)
        || context?.entityId
        || ''
      );
      const exactColdPollResponse = Boolean(
        isPollResponse
        && localAttempt?.pollAttemptId
        && localAttempt?.caseId
        && (!openedPollAction || openedPollAction === String(localAttempt.action || ''))
        && (!responseBillingId || responseBillingId === String(localAttempt.billingId || ''))
      );

      // A native Billing navigation creates a brand-new content-script
      // instance. On its first scan localCaseId is still empty, while the exact
      // request operation survives in same-tab sessionStorage. Adopt only that
      // validated response attempt and recover its Case from the loaded store;
      // otherwise the envelope loses pollAttemptId and the durable commit is
      // correctly rejected even though the terminal UI already shows output.
      const boundCase = this.activeCase() || null;
      const attemptCase = exactColdPollResponse
        ? this.state?.cases?.[String(localAttempt.caseId || '')] || null
        : null;
      const caseData = boundCase || attemptCase || null;
      const attemptBelongsToCase = Boolean(
        localAttempt
        && String(localAttempt.caseId || '') === String(caseData?.id || this.localCaseId || '')
      );
      const attempt = attemptBelongsToCase ? localAttempt : null;
      const pinnedPoll = (
        exactColdPollResponse
        || (
          type === MessageType.POLL_ATTEMPT_UPDATE
          && requestedPollAttemptId
          && requestedPollAttemptId === String(attempt?.pollAttemptId || attempt?.attemptId || '')
        )
      ) && (attempt?.pollAttemptId || attempt?.attemptId)
        ? attempt
        : null;
      return {
        eventId: globalThis.crypto?.randomUUID?.()
          || `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        type,
        occurredAt: new Date().toISOString(),
        // A response document belongs to the attempt that started it. Never
        // retarget it through the currently active case or tab binding.
        caseId: String(pinnedPoll?.caseId || payload?.caseId || caseData?.id || this.localCaseId || ''),
        episodeId: String(pinnedPoll?.episodeId || caseData?.episodeId || ''),
        caseVersion: Number(pinnedPoll?.caseVersion ?? caseData?.caseVersion ?? 0),
        routeGeneration: Number(pinnedPoll?.routeGeneration ?? caseData?.routeGeneration ?? 0),
        origin: {
          tabId: null,
          frameId: 0,
          documentId: String(WB.runtime?.documentId || ''),
          pageInstanceId: String(WB.runtime?.pageInstanceId || ''),
          pageInstanceStartedAt: Number(WB.runtime?.pageInstanceStartedAt || 0),
          system: String(context.system || ''),
          pageKind: String(context.pageKind || ''),
          url: String(context.url || location.href || '')
        },
        operation: {
          requestId: String(operation.requestId || payload?.requestId || ''),
          pollAttemptId: String(
            requestedPollAttemptId
            || payload?.attempt?.pollAttemptId
            || pinnedPoll?.pollAttemptId
            || pinnedPoll?.attemptId
            || ''
          )
        },
        identityFingerprint: String(
          pinnedPoll?.identityFingerprint
          || (caseData ? identityFingerprint(caseData) : identityFingerprint(context))
        ),
        bindingFingerprint: String(
          pinnedPoll?.bindingFingerprint
          || (caseData ? bindingFingerprint(caseData) : bindingFingerprint(context))
        ),
        payload: {
          observationType: String(payload?.observation?.type || ''),
          pageKind: String(context.pageKind || ''),
          stepId: String(payload?.stepId || '')
        }
      };
    }

    correlation(type, operation = {}, payload = {}) {
      return this.createEnvelope(type, payload, operation);
    }

    async request(type, payload = {}) {
      const finish = WB.performanceMonitor?.begin?.('message', type || 'missing-type');
      try {
        if (!type || typeof type !== 'string') {
          const error = new Error('Workbench message type is missing');
          error.code = 'WB_MESSAGE_TYPE_MISSING';
          throw error;
        }
        if (WB.runtime.extensionContextInvalidated || !chrome?.runtime?.id) {
          const error = new Error('Extension context invalidated. Refresh Billing/UserSide after reloading the extension.');
          error.code = 'EXTENSION_CONTEXT_INVALIDATED';
          throw error;
        }
        const correlatedPayload = CORRELATED_TYPES.has(type) && !payload?.envelope
          ? { ...payload, envelope: this.createEnvelope(type, payload) }
          : payload;
        const response = await chrome.runtime.sendMessage({
          type,
          payload: correlatedPayload
        });

        if (!response?.success) {
          throw new Error(
            response?.error || `Request failed: ${type}`
          );
        }

        if (
          WRITE_TYPES.has(type)
          || (type === MessageType.HANDOFF_CLAIM && response.data?.caseId)
        ) {
          WB.performanceMonitor?.count?.('storageWrites');
        }
        finish?.({ ok: true });
        return response.data;
      } catch (error) {
        finish?.({ ok: false });
        const channelClosed = /message channel closed|asynchronous response/i.test(String(error?.message || error || ''));
        void WB.observability?.report?.({
          severity: 'ERROR',
          code: channelClosed ? 'STORE_MESSAGE_CHANNEL_CLOSED' : `STORE_${String(type || 'REQUEST')}_FAILED`,
          operationType: `MESSAGE_${String(type || 'REQUEST')}`,
          source: 'store-client',
          stage: 'SEND_MESSAGE',
          message: error?.message || String(error),
          error,
          details: { type: String(type || ''), channelClosed }
        });
        if (isExtensionContextInvalidated(error) || error?.code === 'EXTENSION_CONTEXT_INVALIDATED') {
          markExtensionContextInvalidated(error);
          const wrapped = new Error('Расширение было перезагружено. Обнови эту страницу Billing/UserSide и продолжи с сохранённого Case.');
          wrapped.code = 'EXTENSION_CONTEXT_INVALIDATED';
          throw wrapped;
        }
        console.warn(
          '[SIMNET Workbench store]',
          type,
          error
        );
        throw error;
      }
    }

    async init() {
      this.state = await this.request(
        MessageType.STORE_GET_STATE
      );
      this.fastActionSessions = {};
      for (const [caseId, caseData] of Object.entries(this.state?.cases || {})) {
        const workflow = caseData?.workflow?.actionSession;
        if (!workflow) continue;
        this.fastActionSessions[caseId] = {
          active: workflow.active || null,
          lastTerminal: workflow.lastTerminal || null,
          updatedAt: workflow.updatedAt || ''
        };
      }

      chrome.storage.onChanged.addListener(
        this.boundStorage
      );

      this.ready = true;
      if (globalThis.document?.hidden === true) {
        this.deferredPublish = true;
        WB.performanceMonitor?.count?.('hiddenStatePublishesDeferred');
      } else {
        this.publishState(this.state, { force: true });
      }
      return this.state;
    }

    applyFastActionSessions(state = this.state) {
      if (!state?.cases) return state;
      for (const [caseId, workflow] of Object.entries(this.fastActionSessions || {})) {
        const caseData = state.cases[caseId];
        if (!caseData) continue;
        caseData.workflow ||= {};
        caseData.workflow.actionSession = {
          schema: 'simnet-universal-action-session-v1',
          active: workflow?.active || null,
          lastTerminal: workflow?.lastTerminal || null,
          updatedAt: workflow?.updatedAt || ''
        };
      }
      return state;
    }

    onStorageChanged(changes, areaName) {
      if (areaName !== 'local') return;

      const fastKey = WB.actionSessionFastKey || 'simnet_workbench_action_session_fast_v1';
      if (changes[fastKey]) {
        this.fastActionSessions = changes[fastKey].newValue || {};
        if (this.state?.cases) {
          this.applyFastActionSessions(this.state);
          this.publishState(this.state, { force: true });
        }
      }

      if (!changes[WB.stateKey]) return;
      this.state = changes[WB.stateKey].newValue;
      this.applyFastActionSessions(this.state);
      if (globalThis.document?.hidden === true) {
        this.deferredPublish = true;
        WB.performanceMonitor?.count?.('hiddenStatePublishesDeferred');
        return;
      }
      this.publishState(this.state);
    }

    resume() {
      if (!this.state) return false;
      const deferred = this.deferredPublish;
      this.deferredPublish = false;
      return this.publishState(this.state, { force: deferred });
    }

    async applyContext(context) {
      const result = await this.request(
        MessageType.STORE_APPLY_CONTEXT,
        {
          context,
          handoffClaim: WB.runtime.handoffClaim || null
        }
      );

      this.state = result.state;
      this.localCaseId = (
        result.caseId || this.localCaseId
      );

      this.publishState(this.state);
      return result;
    }

    bindCase(caseId) {
      const id = String(caseId || '');
      if (!id || !this.state?.cases?.[id]) return false;
      this.localCaseId = id;
      this.publishState(this.state, { force: true });
      return true;
    }

    rememberCustomerId(caseId, customerId, source = 'userside:resolved-for-call') {
      const id = String(caseId || '');
      const value = String(customerId || '');
      const caseData = this.state?.cases?.[id];
      if (!caseData || !/^\d{1,12}$/.test(value)) return false;
      caseData.identity ||= {};
      caseData.identity.customerId = {
        value,
        source,
        confidence: 0.99,
        observedAt: new Date().toISOString()
      };
      this.localCaseId = id;
      this.publishState(this.state, { force: true });
      return true;
    }

    async addEvent(type, message, details = null) {
      return this.request(
        MessageType.STORE_ADD_EVENT,
        {
          caseId: this.localCaseId,
          type,
          message,
          details
        }
      );
    }

    async patchUi(patch) {
      const state = await this.request(
        MessageType.STORE_PATCH_UI,
        patch
      );
      this.state = state;
      return state;
    }

    async patchAppeal(appeal, transition = {}) {
      const result = await this.request(
        MessageType.STORE_PATCH_APPEAL,
        {
          caseId: this.localCaseId,
          appeal,
          transition
        }
      );
      this.state = result.state || this.state;
      return result;
    }

    async patchWorkflow(namespace, patch = {}) {
      const result = await this.request(
        MessageType.STORE_PATCH_WORKFLOW,
        {
          caseId: this.localCaseId,
          namespace,
          patch
        }
      );
      if (namespace === 'actionSession' && result?.workflow && this.localCaseId) {
        const workflow = result.workflow;
        this.fastActionSessions[this.localCaseId] = {
          active: workflow.active || null,
          lastTerminal: workflow.lastTerminal || null,
          updatedAt: workflow.updatedAt || ''
        };
        const caseData = this.state?.cases?.[this.localCaseId];
        if (caseData) {
          caseData.workflow ||= {};
          caseData.workflow.actionSession = {
            schema: 'simnet-universal-action-session-v1',
            active: workflow.active || null,
            lastTerminal: workflow.lastTerminal || null,
            updatedAt: workflow.updatedAt || ''
          };
        }
      }
      this.state = result.state || this.state;
      return result;
    }

    async dismissTmcWritebackPrompt(reason = 'operator-dismissed-save-prompt') {
      const at = new Date().toISOString();
      // Visual dismissal is intentionally NOT the business decision. While the
      // operator remains in Billing Technical, the writeback stays pending and
      // the semantic status must not advance to ONU polling merely because the
      // Guide card was closed.
      return this.patchWorkflow('ponAcquisition', {
        tmcWritebackPromptDismissedAt: at,
        tmcWritebackPromptDismissReason: String(reason || 'operator-dismissed-save-prompt').slice(0, 120)
      });
    }

    async declineTmcWriteback(reason = 'operator-left-technical-without-save') {
      const at = new Date().toISOString();
      return this.patchWorkflow('ponAcquisition', {
        tmcWritebackPending: false,
        tmcWritebackPendingSave: false,
        tmcWritebackVerifiedInForm: false,
        technicalWritebackVerified: false,
        tmcWritebackLastStatus: 'declined',
        tmcWritebackLastAt: at,
        tmcWritebackDeclinedAt: at,
        tmcWritebackDeclineReason: String(reason || 'operator-left-technical-without-save').slice(0, 120)
      });
    }

    async resetActiveCase() {
      const state = await this.request(
        MessageType.STORE_RESET_CASE,
        {
          caseId: this.localCaseId
        }
      );

      this.state = state;
      this.localCaseId = '';

      queueMicrotask(() =>
        WB.runtime.forceScan?.('case-reset')
      );

      return state;
    }

    async prepareHandoff(payload) {
      return this.request(
        MessageType.HANDOFF_PREPARE,
        {
          ...payload,
          caseId: payload?.caseId || this.localCaseId
        }
      );
    }

    async openHandoffTarget(payload) {
      return this.request(
        MessageType.HANDOFF_OPEN_TARGET,
        {
          ...payload,
          caseId: payload?.caseId || this.localCaseId
        }
      );
    }

    async focusExistingUsersideCase(payload = {}) {
      return this.request(
        MessageType.HANDOFF_FOCUS_EXISTING_CASE,
        {
          ...payload,
          caseId: payload?.caseId || this.localCaseId
        }
      );
    }

    async claimHandoff(payload) {
      return this.request(
        MessageType.HANDOFF_CLAIM,
        payload
      );
    }

    async markGuideStep(stepId, details = null, options = {}) {
      const result = await this.request(
        MessageType.GUIDE_MARK_STEP,
        {
          caseId: this.localCaseId,
          stepId,
          details,
          phase: options?.phase || 'result',
          expected: options?.expected || null
        }
      );
      this.state = result.state || this.state;
      return result;
    }

    async markGuideHint(stepId, details = null, expected = null) {
      return this.markGuideStep(stepId, details, {
        phase: 'hint',
        expected
      });
    }

    async markGuideAction(stepId, details = null, expected = null) {
      return this.markGuideStep(stepId, details, {
        phase: 'action',
        expected
      });
    }

    async focusHandoffSource(payload = {}) {
      return this.request(
        MessageType.HANDOFF_FOCUS_SOURCE,
        payload
      );
    }

    activeCase() {
      return this.localCaseId
        ? (
            this.state?.cases?.[this.localCaseId]
            || null
          )
        : null;
    }

    destroy() {
      chrome.storage.onChanged.removeListener(
        this.boundStorage
      );
    }
  }

  WB.store = new StoreClient();
})();
