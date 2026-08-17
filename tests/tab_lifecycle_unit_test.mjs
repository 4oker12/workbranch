import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const storageData = {};
const messageListeners = [];
const removedListeners = [];
const queriedTabs = [{ id: 11 }, { id: 12 }, { id: 22 }];
let storageWrites = 0;

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          list
            .filter(key => key in storageData)
            .map(key => [key, structuredClone(storageData[key])])
        );
      },
      async set(patch) {
        storageWrites += 1;
        for (const [key, value] of Object.entries(patch)) {
          storageData[key] = structuredClone(value);
        }
      }
    }
  },
  runtime: {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onInstalled: { addListener() {} }
  },
  tabs: {
    onRemoved: { addListener(listener) { removedListeners.push(listener); } },
    async query() { return structuredClone(queriedTabs); },
    async update(id, patch) { return { id, ...patch }; }
  },
  windows: { async update(id, patch) { return { id, ...patch }; } }
};

await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href
  + `?tab-lifecycle=${Date.now()}`
);

const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api, 'background test API must be exposed');
assert.equal(removedListeners.length, 1, 'one tabs.onRemoved listener is registered');

const fact = value => ({
  value,
  source: 'test',
  confidence: 0.99,
  observedAt: '2026-08-13T18:00:00.000Z'
});

const caseA = api.emptyCase('login:abon100');
caseA.identity.login = fact('abon100');
caseA.contexts.billing = { pageKind: 'billing_user', durable: true };
caseA.live.oltSnapshot = {
  status: 'online',
  onuMac: '001122334455',
  confirmedAt: '2026-08-13T18:00:00.000Z'
};
caseA.journal.unshift({
  id: 'durable-evidence',
  at: '2026-08-13T18:00:00.000Z',
  type: 'guide_evidence',
  message: 'ONU ответ подтверждён',
  details: { status: 'online' },
  signature: 'durable-evidence'
});
caseA.viewsByTab = {
  11: {
    'doc-a-1': { system: 'billing', pageKind: 'billing_onu_poll', observedAt: '2026-08-13T18:00:01.000Z' },
    'doc-a-2': { system: 'billing', pageKind: 'billing_user', observedAt: '2026-08-13T18:00:02.000Z' }
  },
  12: {
    'doc-a-userside': { system: 'userside', pageKind: 'userside_customer', observedAt: '2026-08-13T18:00:03.000Z' }
  }
};
caseA.operations.poll.current = {
  pollAttemptId: 'poll-tab-11',
  stage: 'REQUEST_STARTED',
  status: 'pending',
  pending: true,
  requestTabId: 11,
  requestDocumentId: 'doc-a-1',
  startedAt: Date.now()
};
caseA.operations.poll.history = [];
caseA.juniper = {
  dataStatus: 'loading',
  reviewStatus: 'required',
  requestId: 'jun-tab-11',
  requestTabId: 11,
  requestDocumentId: 'doc-a-1'
};

const caseB = api.emptyCase('login:abon200');
caseB.identity.login = fact('abon200');
caseB.viewsByTab = {
  22: {
    'doc-b-1': { system: 'billing', pageKind: 'billing_user', observedAt: '2026-08-13T18:00:04.000Z' }
  },
  77: {
    'doc-b-ghost': { system: 'userside', pageKind: 'userside_customer', observedAt: '2026-08-12T18:00:04.000Z' }
  }
};
caseB.live.oltSnapshot = {
  status: 'online',
  onuMac: 'AABBCCDDEEFF',
  confirmedAt: '2026-08-13T18:00:04.000Z'
};
caseB.juniper = {
  dataStatus: 'available',
  reviewStatus: 'reviewed',
  requestId: 'jun-tab-22',
  requestTabId: 22,
  session: { status: 'online', subscriberIp: '10.0.0.200' }
};

const handoffAt = Date.now();

storageData.simnet_workbench_state_v5 = {
  schemaVersion: 5,
  version: '1.7.29.6',
  activeCaseId: caseA.id,
  cases: { [caseA.id]: caseA, [caseB.id]: caseB },
  tabs: {
    11: { tabId: 11, windowId: 1, caseId: caseA.id, documentId: 'doc-a-1', updatedAt: '2026-08-13T18:00:01.000Z' },
    12: { tabId: 12, windowId: 1, caseId: caseA.id, documentId: 'doc-a-userside', updatedAt: '2026-08-13T18:00:03.000Z' },
    22: { tabId: 22, windowId: 1, caseId: caseB.id, documentId: 'doc-b-1', updatedAt: '2026-08-13T18:00:04.000Z' },
    77: { tabId: 77, windowId: 1, caseId: caseB.id, documentId: 'doc-b-ghost', updatedAt: '2026-08-12T18:00:04.000Z' }
  },
  handoffs: {
    pendingFrom11: { token: 'pendingFrom11', caseId: caseA.id, status: 'pending', sourceTabId: 11, targetTabId: null, createdAtMs: handoffAt },
    claimedFrom11: { token: 'claimedFrom11', caseId: caseA.id, status: 'claimed', sourceTabId: 11, sourceWindowId: 1, targetTabId: 12, createdAtMs: handoffAt, claimedAtMs: handoffAt },
    target11: { token: 'target11', caseId: caseA.id, status: 'claimed', sourceTabId: 12, targetTabId: 11, createdAtMs: handoffAt, claimedAtMs: handoffAt }
  },
  experience: { learnedTargets: {}, updatedAt: '' },
  ui: {},
  meta: { createdAt: '2026-08-13T18:00:00.000Z', updatedAt: '2026-08-13T18:00:00.000Z' }
};

const reconcileResult = await api.reconcileOpenTabs();
assert.equal(reconcileResult.changed, true);
assert.equal(reconcileResult.cleanedTabs, 1, 'legacy ghost tab is cleaned in one reconciliation');
assert.equal(storageData.simnet_workbench_state_v5.tabs['77'], undefined);
assert.equal(storageData.simnet_workbench_state_v5.cases[caseB.id].viewsByTab['77'], undefined);
assert.ok(storageData.simnet_workbench_state_v5.tabs['11']);
assert.deepEqual(
  storageData.simnet_workbench_state_v5.cases[caseB.id].live.oltSnapshot,
  caseB.live.oltSnapshot,
  'startup reconciliation also preserves confirmed facts'
);

const closeResult = await removedListeners[0](11, { windowId: 1, isWindowClosing: false });
assert.equal(closeResult.changed, true);
assert.equal(closeResult.viewDocumentsRemoved, 2);
assert.equal(closeResult.handoffsRemoved, 2);
assert.equal(closeResult.pendingOperationsStopped, 2, 'poll and loading Juniper are retired');

let state = structuredClone(storageData.simnet_workbench_state_v5);
assert.equal(state.tabs['11'], undefined, 'closed tab binding is removed');
assert.ok(state.tabs['12'] && state.tabs['22'], 'other open tabs remain');
assert.equal(state.cases[caseA.id].viewsByTab['11'], undefined, 'closed tab DOM views are removed');
assert.ok(state.cases[caseA.id].viewsByTab['12'], 'same Case remains open in another tab');
assert.ok(state.cases[caseB.id].viewsByTab['22'], 'foreign subscriber Case is untouched');
assert.deepEqual(state.cases[caseA.id].live.oltSnapshot, caseA.live.oltSnapshot, 'confirmed ONU snapshot survives');
assert.ok(
  state.cases[caseA.id].journal.some(item => item.id === 'durable-evidence'),
  'durable diagnostic evidence survives'
);
assert.deepEqual(state.cases[caseA.id].contexts.billing, caseA.contexts.billing, 'durable Billing context survives');
assert.equal(state.cases[caseA.id].operations.poll.current.pending, false);
assert.equal(state.cases[caseA.id].operations.poll.current.failureReason, 'source-tab-closed');
assert.equal(state.cases[caseA.id].operations.poll.history.at(-1).failureReason, 'source-tab-closed');
assert.equal(state.cases[caseA.id].juniper.dataStatus, 'stale');
assert.equal(state.cases[caseA.id].juniper.failureReason, 'source-tab-closed');
assert.equal(state.cases[caseB.id].juniper.dataStatus, 'available', 'confirmed foreign Juniper remains available');
assert.equal(state.handoffs.pendingFrom11, undefined);
assert.equal(state.handoffs.target11, undefined);
assert.equal(state.handoffs.claimedFrom11.sourceTabId, null, 'accepted target keeps Case without dead focus pointer');
assert.equal(state.handoffs.claimedFrom11.targetTabId, 12);
assert.equal(state.activeCaseId, caseA.id, 'active Case remains while another tab for it is open');
assert.equal(state.meta.tabLifecycle.closedTabsCleaned, 2);
assert.equal(state.meta.tabLifecycle.viewDocumentsRemoved, 3);

await removedListeners[0](12, { windowId: 1, isWindowClosing: false });
state = structuredClone(storageData.simnet_workbench_state_v5);
assert.ok(state.cases[caseA.id], 'closing the final tab does not delete subscriber Case');
assert.deepEqual(state.cases[caseA.id].live.oltSnapshot, caseA.live.oltSnapshot);
assert.equal(state.activeCaseId, caseB.id, 'most recently updated remaining tab becomes active');

await removedListeners[0](22, { windowId: 1, isWindowClosing: false });
state = structuredClone(storageData.simnet_workbench_state_v5);
assert.equal(state.activeCaseId, '', 'no tab means no active tab binding');
assert.ok(state.cases[caseA.id] && state.cases[caseB.id], 'closing tabs never deletes Cases');

const writesBeforeUnrelatedClose = storageWrites;
const lifecycleBeforeUnrelatedClose = structuredClone(state.meta.tabLifecycle);
const unrelated = await removedListeners[0](999, { windowId: 9, isWindowClosing: false });
assert.equal(unrelated.changed, false);
assert.equal(storageWrites, writesBeforeUnrelatedClose, 'unrelated browser tab causes no state write');
assert.deepEqual(
  storageData.simnet_workbench_state_v5.meta.tabLifecycle,
  lifecycleBeforeUnrelatedClose,
  'unrelated tab does not increment cleanup telemetry'
);

const navigationCase = api.emptyCase('login:abon-navigation');
for (let index = 0; index < 10; index += 1) {
  api.storeViewContext(navigationCase, {
    origin: {
      tabId: 31,
      documentId: `doc-${index}`,
      pageInstanceId: `page-${index}`,
      pageInstanceStartedAt: index
    }
  }, {
    system: 'billing',
    pageKind: index % 2 ? 'billing_user' : 'billing_technical',
    observedAt: `2026-08-13T18:00:${String(index).padStart(2, '0')}.000Z`
  });
}
assert.equal(Object.keys(navigationCase.viewsByTab['31']).length, 8, 'Back/Forward history is bounded per tab');
assert.ok(navigationCase.viewsByTab['31']['doc-9'], 'latest document is retained');
assert.equal(navigationCase.viewsByTab['31']['doc-0'], undefined, 'oldest document is discarded');

console.log('tab_lifecycle_unit_test: PASS');
