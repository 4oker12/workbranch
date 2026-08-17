import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const listeners = [];
const storage = {
  simnet_workbench_state_v5: {
    schemaVersion: 5,
    version: '1.7.29.10',
    activeCaseId: 'login:abon220196',
    cases: {
      'login:abon220196': {
        id: 'login:abon220196',
        createdAt: '2026-08-14T07:00:00.000Z',
        updatedAt: '2026-08-14T07:00:00.000Z',
        identity: { login: { value: 'abon220196' }, billingId: { value: '22019' } },
        network: { connectionFamily: { value: 'PON' } },
        pon: {},
        contexts: { technical: { pageKind: 'billing_technical' } },
        route: {},
        locator: {},
        meta: {}
      }
    },
    tabs: {
      '77': { tabId: 77, caseId: 'login:abon220196' }
    },
    handoffs: {},
    experience: { learnedTargets: {}, updatedAt: '' },
    ui: { section: 'live', open: false },
    meta: { createdAt: '2026-08-14T07:00:00.000Z', updatedAt: '2026-08-14T07:00:00.000Z' }
  }
};

const clone = value => JSON.parse(JSON.stringify(value));

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const out = {};
        for (const key of keys || []) if (key in storage) out[key] = clone(storage[key]);
        return out;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values || {})) storage[key] = clone(value);
      }
    }
  },
  runtime: {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} }
  },
  tabs: {
    onRemoved: { addListener() {} },
    async query() { return []; },
    async update(tabId, patch) { return { id: tabId, ...patch }; }
  },
  windows: { async update(windowId, patch) { return { id: windowId, ...patch }; } }
};

await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href + `?workflow=${Date.now()}`
);

assert.equal(listeners.length, 1, 'background message listener installed once');
const listener = listeners[0];

function invoke(type, payload = {}, tabId = 77) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) reject(new Error(`timeout waiting for ${type}`));
    }, 1500);
    const sendResponse = response => {
      settled = true;
      clearTimeout(timeout);
      if (!response?.success) reject(new Error(response?.error || `${type} failed`));
      else resolve(response.data);
    };
    const keep = listener({ type, payload }, { tab: { id: tabId, windowId: 4 } }, sendResponse);
    if (keep === false && !settled) reject(new Error(`${type} unexpectedly synchronous without response`));
  });
}

// First confirmed operator-facing milestone: TMC was explicitly shown.
let result = await invoke('STORE_PATCH_WORKFLOW', {
  caseId: 'login:abon220196',
  namespace: 'ponAcquisition',
  patch: { tmcShownAt: '2026-08-14T07:10:00.000Z' }
});
assert.equal(result.accepted, true);
assert.equal(result.workflow.tmcShownAt, '2026-08-14T07:10:00.000Z');

// Simulate unrelated detour + serialization as happens across page reload/service-worker sleep.
storage.simnet_workbench_state_v5 = clone(storage.simnet_workbench_state_v5);
storage.simnet_workbench_state_v5.cases['login:abon220196'].contexts.detour = {
  pageKind: 'billing_other',
  observedAt: '2026-08-14T07:11:00.000Z'
};
let reloaded = await invoke('STORE_GET_STATE');
let flow = reloaded.cases['login:abon220196'].workflow.ponAcquisition;
assert.equal(flow.tmcShownAt, '2026-08-14T07:10:00.000Z', 'TMC milestone survives detour/reload');

// Guided navigation is persisted by the universal ActionSession rather than
// feature-specific pollRevealPending/oneShot/replay flags.
result = await invoke('STORE_PATCH_WORKFLOW', {
  caseId: 'login:abon220196',
  namespace: 'actionSession',
  patch: {
    active: {
      operationId: 'wbact_poll_1',
      operationType: 'GUIDE_NAVIGATION',
      caseId: 'login:abon220196',
      targetType: 'semantic',
      semanticTargetId: 'billing.poll.entry',
      sourceSystem: 'billing',
      sourcePageKind: 'billing_technical',
      destinationSystem: 'billing',
      destinationPageKind: 'billing_user',
      destinationEntityId: '22019',
      status: 'NAVIGATING',
      requestedAt: '2026-08-14T07:12:00.000Z',
      navigationStartedAt: '2026-08-14T07:12:00.010Z',
      expectedPostCondition: 'native poll entry target becomes ready',
      sourceAction: 'live-open-poll',
      planId: 'billing.open-poll-tab',
      targetTimeoutMs: 12000,
      showCount: 0,
      rebindCount: 0,
      lastTransitionAt: '2026-08-14T07:12:00.010Z'
    }
  }
});
assert.equal(result.workflow.active.semanticTargetId, 'billing.poll.entry');
assert.equal(result.workflow.active.status, 'NAVIGATING');
assert.equal(result.fastLane, true, 'ActionSession uses the small durable fast-lane instead of serializing the whole Case State before navigation');
assert.equal(storage.simnet_workbench_action_session_fast_v1['login:abon220196'].active.operationId, 'wbact_poll_1');
assert.notEqual(storage.simnet_workbench_state_v5.cases['login:abon220196'].workflow?.actionSession?.active?.operationId, 'wbact_poll_1', 'critical navigation lifecycle no longer requires an immediate full-State rewrite');

storage.simnet_workbench_state_v5 = clone(storage.simnet_workbench_state_v5);
reloaded = await invoke('STORE_GET_STATE');
const action = reloaded.cases['login:abon220196'].workflow.actionSession.active;
flow = reloaded.cases['login:abon220196'].workflow.ponAcquisition;
assert.equal(action.operationId, 'wbact_poll_1', 'universal action session survives page reload');
assert.equal(action.semanticTargetId, 'billing.poll.entry');
assert.equal(action.status, 'NAVIGATING');
assert.equal(flow.pollRevealPending, undefined, 'deprecated feature-specific poll reveal flag is pruned');
assert.equal(flow.tmcShownAt, '2026-08-14T07:10:00.000Z');

// Explicit TMC -> Billing prefill intent and its expected fields must survive
// the cross-tab handoff before Billing controls are available.
result = await invoke('STORE_PATCH_WORKFLOW', {
  caseId: 'login:abon220196',
  namespace: 'ponAcquisition',
  patch: {
    tmcWritebackPending: true,
    tmcWritebackPendingSave: false,
    tmcWritebackRequestedAt: '2026-08-14T07:11:30.000Z',
    tmcWritebackFields: ['olt', 'onuSerial', 'onuMac', 'forbidden'],
    expectedTechnicalWriteback: {
      oltName: 'GPON-SW-17',
      oltIp: '172.16.9.17',
      onuSerial: '48575443C7F2',
      onuMac: '4C:D7:C8:71:E2:B0'
    }
  }
});
assert.equal(result.workflow.tmcWritebackPending, true);
assert.deepEqual(result.workflow.tmcWritebackFields, ['olt', 'onuSerial', 'onuMac']);

storage.simnet_workbench_state_v5 = clone(storage.simnet_workbench_state_v5);
reloaded = await invoke('STORE_GET_STATE');
flow = reloaded.cases['login:abon220196'].workflow.ponAcquisition;
assert.equal(flow.tmcWritebackPending, true, 'TMC prefill intent survives UserSide -> Billing handoff');
assert.equal(flow.expectedTechnicalWriteback.onuSerial, '48575443C7F2');

// Explicit operator refusal is durable: once declined, reloads must not revive
// pending Save or the old writeback question.
result = await invoke('STORE_PATCH_WORKFLOW', {
  caseId: 'login:abon220196',
  namespace: 'ponAcquisition',
  patch: {
    tmcWritebackPending: false,
    tmcWritebackPendingSave: false,
    tmcWritebackVerifiedInForm: false,
    technicalWritebackVerified: false,
    tmcWritebackLastStatus: 'declined',
    tmcWritebackLastAt: '2026-08-14T07:11:45.000Z',
    tmcWritebackDeclinedAt: '2026-08-14T07:11:45.000Z',
    tmcWritebackDeclineReason: 'save-guide-close_button'
  }
});
assert.equal(result.workflow.tmcWritebackPendingSave, false);
assert.equal(result.workflow.tmcWritebackLastStatus, 'declined');
assert.equal(result.workflow.tmcWritebackDeclinedAt, '2026-08-14T07:11:45.000Z');
storage.simnet_workbench_state_v5 = clone(storage.simnet_workbench_state_v5);
reloaded = await invoke('STORE_GET_STATE');
flow = reloaded.cases['login:abon220196'].workflow.ponAcquisition;
assert.equal(flow.tmcWritebackPendingSave, false, 'declined Save stays closed after reload');
assert.equal(flow.tmcWritebackLastStatus, 'declined');
assert.equal(flow.tmcWritebackDeclineReason, 'save-guide-close_button');

// A foreign tab bound to another Case must never move this workflow forward.
storage.simnet_workbench_state_v5.tabs['88'] = { tabId: 88, caseId: 'other-case' };
storage.simnet_workbench_state_v5.cases['other-case'] = {
  id: 'other-case', identity: {}, network: {}, pon: {}, contexts: {}, route: {}, locator: {}, meta: {}
};
const foreign = await invoke('STORE_PATCH_WORKFLOW', {
  caseId: 'login:abon220196',
  namespace: 'ponAcquisition',
  patch: { tmcShownAt: 'SHOULD-NOT-WRITE' }
}, 88);
assert.equal(foreign.accepted, false);
assert.equal(foreign.reason, 'foreign-case');
reloaded = await invoke('STORE_GET_STATE');
assert.equal(
  reloaded.cases['login:abon220196'].workflow.ponAcquisition.tmcShownAt,
  '2026-08-14T07:10:00.000Z',
  'foreign subscriber tab cannot overwrite persisted progress'
);

console.log('pon_workflow_persistence_unit_test: PASS');
