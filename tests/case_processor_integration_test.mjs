import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { bindingFingerprint, identityFingerprint } from '../src/core/correlation.js';

const storageData = {};
const listeners = [];
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(key => key in storageData).map(key => [key, structuredClone(storageData[key])]));
      },
      async set(patch) {
        for (const [key, value] of Object.entries(patch)) storageData[key] = structuredClone(value);
      }
    }
  },
  runtime: {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    onInstalled: { addListener() {} }
  },
  tabs: { async update(id, patch) { return { id, ...patch }; } },
  windows: { async update(id, patch) { return { id, ...patch }; } }
};

await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href
  + `?integration=${Date.now()}`
);
assert.equal(listeners.length, 1);

function sendVia(listenerIndex, type, payload, sender) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout: ${type}`)), 2000);
    const handled = listeners[listenerIndex]({ type, payload }, sender, response => {
      clearTimeout(timeout);
      if (!response?.success) reject(new Error(response?.error || type));
      else resolve(response.data);
    });
    assert.equal(handled, true, `${type} must be async-handled`);
  });
}

function send(type, payload, sender) {
  return sendVia(0, type, payload, sender);
}

const fact = value => ({ value, source: 'test', confidence: 0.99 });
const contextFor = (login, billingId, documentId) => ({
  key: `billing|billing_user|${billingId}||${login}`,
  system: 'billing',
  pageKind: 'billing_user',
  entityId: billingId,
  subview: '',
  url: `https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=${billingId}`,
  identity: {
    login: fact(login),
    contract: fact(login.replace(/^abon/, '')),
    billingId: fact(billingId)
  },
  network: { connectionFamily: fact('PON'), mac: fact('AA:BB:CC:DD:EE:01') },
  pon: {},
  profile: {},
  meta: { documentId },
  quality: { trustedPage: true }
});

const senderA = { tab: { id: 1, windowId: 1 }, frameId: 0, documentId: 'doc-A' };
const senderB = { tab: { id: 2, windowId: 1 }, frameId: 0, documentId: 'doc-B' };
await send('STORE_APPLY_CONTEXT', {
  context: contextFor('abon1000', '100', 'doc-A'),
  envelope: {
    eventId: 'context-A', type: 'STORE_APPLY_CONTEXT', occurredAt: new Date().toISOString(),
    origin: { documentId: 'doc-A', pageInstanceId: 'page-A', pageInstanceStartedAt: 100 }
  }
}, senderA);
await send('STORE_APPLY_CONTEXT', {
  context: contextFor('abon2000', '200', 'doc-B'),
  envelope: {
    eventId: 'context-B', type: 'STORE_APPLY_CONTEXT', occurredAt: new Date().toISOString(),
    origin: { documentId: 'doc-B', pageInstanceId: 'page-B', pageInstanceStartedAt: 200 }
  }
}, senderB);

let state = structuredClone(storageData.simnet_workbench_state_v5);
const caseAId = Object.keys(state.cases).find(id => id.includes('abon1000'));
const caseBId = Object.keys(state.cases).find(id => id.includes('abon2000'));
assert.ok(caseAId && caseBId);
const caseBVersionBefore = state.cases[caseBId].caseVersion;
const caseBBefore = JSON.stringify(state.cases[caseBId]);
const caseA = state.cases[caseAId];
const requestId = 'juniper-request-A';
const pinA = {
  caseId: caseAId,
  episodeId: caseA.episodeId,
  caseVersion: caseA.caseVersion,
  routeGeneration: caseA.routeGeneration,
  identityFingerprint: identityFingerprint(caseA),
  bindingFingerprint: bindingFingerprint(caseA),
  origin: { documentId: 'doc-A', pageInstanceId: 'page-A', pageInstanceStartedAt: 100 },
  operation: { requestId }
};

await send('JUNIPER_PREFETCH_STATUS', {
  caseId: caseAId,
  status: 'loading',
  envelope: { ...pinA, eventId: 'jun-load-A', type: 'JUNIPER_PREFETCH_STATUS' }
}, senderA);
state = structuredClone(storageData.simnet_workbench_state_v5);
const currentA = state.cases[caseAId];
await send('LOCATOR_APPLY_OBSERVATION', {
  caseId: caseAId,
  envelope: {
    ...pinA,
    eventId: 'jun-response-A',
    type: 'LOCATOR_APPLY_OBSERVATION',
    // caseVersion intentionally predates the loading commit; request/route pin remains valid.
    caseVersion: caseA.caseVersion
  },
  observation: {
    type: 'JUNIPER_SESSION',
    result: 'online',
    method: 'billing-juniper-prefetch',
    source: 'billing-juniper',
    routeRelation: 'on_route',
    details: {
      preview: true,
      subscriberIp: '10.0.0.100',
      subscriberMac: 'AA:BB:CC:DD:EE:01',
      status: 'online'
    }
  }
}, senderA);

state = structuredClone(storageData.simnet_workbench_state_v5);
assert.equal(state.cases[caseAId].juniper.dataStatus, 'available');
assert.equal(state.cases[caseAId].network.ip.value, '10.0.0.100');
assert.equal(state.cases[caseBId].caseVersion, caseBVersionBefore);
assert.equal(JSON.stringify(state.cases[caseBId]), caseBBefore, 'late A response cannot enrich B');

// A stale poll response from attempt #1 is passive and cannot confirm active attempt #2.
state.cases[caseAId].locator.recommendation = {
  action: 'poll_current_binding', ruleId: 'test.poll', reason: 'test', params: {}
};
state.cases[caseAId].diagnostic.nextRequiredSource = 'poll_current_binding';
state.cases[caseAId].pon.oltName = fact('OLT Test');
state.cases[caseAId].pon.oltIp = fact('172.16.1.10');
state.cases[caseAId].pon.onuMac = fact('001122334455');
state.cases[caseAId].pon.pollAction = fact('313');
state.cases[caseAId].operations.poll.current = {
  pollAttemptId: 'poll-2', stage: 'INTENT_RECORDED', pending: true,
  bindingFingerprint: bindingFingerprint(state.cases[caseAId])
};
storageData.simnet_workbench_state_v5 = structuredClone(state);
const beforePoll = structuredClone(state.cases[caseAId]);
const stalePollEnvelope = {
  eventId: 'late-poll-1', type: 'STORE_APPLY_CONTEXT', occurredAt: new Date().toISOString(),
  caseId: caseAId,
  episodeId: beforePoll.episodeId,
  caseVersion: beforePoll.caseVersion,
  routeGeneration: beforePoll.routeGeneration,
  identityFingerprint: identityFingerprint(beforePoll),
  bindingFingerprint: bindingFingerprint(beforePoll),
  origin: { documentId: 'poll-doc-1', pageInstanceId: 'poll-page-1', pageInstanceStartedAt: 300 },
  operation: { pollAttemptId: 'poll-1' }
};
const pollResult = await send('STORE_APPLY_CONTEXT', {
  caseId: caseAId,
  envelope: stalePollEnvelope,
  context: {
    ...contextFor('abon1000', '100', 'poll-doc-1'),
    key: 'billing|billing_onu_poll|100|a313|abon1000',
    pageKind: 'billing_onu_poll',
    subview: 'a313',
    pon: { status: fact('online'), rx: fact('-18 dBm') },
    meta: {
      documentId: 'poll-doc-1',
      poll: {
        openedAction: '313', expectedPollAction: '313', requestObserved: true,
        outcome: 'confirmed', uiStable: true, wrongPollTab: false
      },
      locatorObservations: [{
        type: 'POLL_RESULT', result: 'confirmed', method: 'direct_olt_poll', source: 'billing',
        details: {
          pollCompleted: true, pollResponded: true, requestObserved: true,
          uiStable: true, wrongPollTab: false, pollAction: '313'
        }
      }]
    }
  }
}, { tab: { id: 1, windowId: 1 }, frameId: 0, documentId: 'poll-doc-1' });
assert.equal(pollResult.applied, false);
assert.equal(pollResult.correlation.reason, 'stale-poll-attempt');
state = structuredClone(storageData.simnet_workbench_state_v5);
assert.equal(state.cases[caseAId].operations.poll.current.pollAttemptId, 'poll-2');
assert.notEqual(state.cases[caseAId].locator.termination?.status, 'confirmed');
assert.notEqual(state.cases[caseAId].pon.status?.value, 'online');

// A legacy/suspended INTENT cannot lock Ask OLT forever. The next deliberate
// retry retires an attempt older than the bounded stale window in one Case
// Processor commit and becomes the only current logical operation.
state = structuredClone(storageData.simnet_workbench_state_v5);
state.cases[caseAId].operations.poll.current = {
  pollAttemptId: 'poll-stuck',
  attemptId: 'poll-stuck',
  caseId: caseAId,
  episodeId: state.cases[caseAId].episodeId,
  routeGeneration: state.cases[caseAId].routeGeneration,
  stage: 'INTENT_RECORDED',
  status: 'pending',
  pending: true,
  startedAt: Date.now() - 100000
};
storageData.simnet_workbench_state_v5 = structuredClone(state);
const retryCase = state.cases[caseAId];
await send('POLL_ATTEMPT_UPDATE', {
  caseId: caseAId,
  attempt: {
    pollAttemptId: 'poll-retry',
    attemptId: 'poll-retry',
    action: '313',
    billingId: '100',
    caseId: caseAId,
    episodeId: retryCase.episodeId,
    routeGeneration: retryCase.routeGeneration,
    stage: 'INTENT_RECORDED',
    status: 'pending',
    pending: true,
    startedAt: Date.now()
  },
  envelope: {
    eventId: 'poll-retry-intent',
    type: 'POLL_ATTEMPT_UPDATE',
    occurredAt: new Date().toISOString(),
    caseId: caseAId,
    episodeId: retryCase.episodeId,
    caseVersion: retryCase.caseVersion,
    routeGeneration: retryCase.routeGeneration,
    identityFingerprint: identityFingerprint(retryCase),
    bindingFingerprint: bindingFingerprint(retryCase),
    origin: { documentId: 'doc-A', pageInstanceId: 'page-A', pageInstanceStartedAt: 100 },
    operation: { pollAttemptId: 'poll-retry' }
  }
}, senderA);
state = structuredClone(storageData.simnet_workbench_state_v5);
assert.equal(state.cases[caseAId].operations.poll.current.pollAttemptId, 'poll-retry');
assert.equal(state.cases[caseAId].operations.poll.current.pending, true);
assert.ok(state.cases[caseAId].operations.poll.history.some(item => (
  item.pollAttemptId === 'poll-stuck'
  && item.stage === 'TIMEOUT'
  && item.pending === false
)));

// Real Billing failure reproduced on abon158747: the old document marked the
// attempt TIMEOUT after 12 seconds, but the exact Huawei askolt response arrived
// later with ONU/MAC/link evidence. Strong late evidence must upgrade that same
// attempt to CONFIRMED and remain latched after browser Back navigation.
state = structuredClone(storageData.simnet_workbench_state_v5);
const lateCase = state.cases[caseAId];
lateCase.locator.recommendation = {
  action: 'poll_current_binding', ruleId: 'test.late-poll', reason: 'late response', params: {}
};
lateCase.diagnostic.nextRequiredSource = 'poll_current_binding';
lateCase.pon.oltName = fact('Teremkovskaya-3A-OLT-Huawei');
lateCase.pon.oltIp = fact('172.16.1.10');
lateCase.pon.onuMac = fact('6C:68:A4:93:B7:84');
lateCase.pon.onuSerial = fact('FGXP0093B785');
lateCase.pon.pollAction = fact('313');
const lateAttemptId = 'poll-late-huawei';
const timedOutAttempt = {
  pollAttemptId: lateAttemptId,
  attemptId: lateAttemptId,
  action: '313',
  billingId: '100',
  oltIp: '172.16.1.10',
  caseId: caseAId,
  episodeId: lateCase.episodeId,
  routeGeneration: lateCase.routeGeneration,
  bindingFingerprint: bindingFingerprint(lateCase),
  stage: 'TIMEOUT',
  status: 'timeout',
  pending: false,
  outcome: 'timeout',
  failureReason: 'poll-request-document-not-opened',
  startedAt: Date.now() - 15000,
  resolvedAt: Date.now() - 3000
};
lateCase.operations.poll.current = structuredClone(timedOutAttempt);
lateCase.operations.poll.history.push(structuredClone(timedOutAttempt));
storageData.simnet_workbench_state_v5 = structuredClone(state);

const lateResponseCase = state.cases[caseAId];
const lateResponseDocument = 'poll-doc-late-huawei';
const lateResponseUrl = 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?pp=protected&a=313&id=100&act=askolt&olt_ip=172.16.1.10';
const lateResponse = await send('STORE_APPLY_CONTEXT', {
  caseId: caseAId,
  envelope: {
    eventId: 'late-huawei-response',
    type: 'STORE_APPLY_CONTEXT',
    occurredAt: new Date().toISOString(),
    caseId: caseAId,
    episodeId: lateResponseCase.episodeId,
    caseVersion: lateResponseCase.caseVersion,
    routeGeneration: lateResponseCase.routeGeneration,
    identityFingerprint: identityFingerprint(lateResponseCase),
    bindingFingerprint: bindingFingerprint(lateResponseCase),
    origin: {
      documentId: lateResponseDocument,
      pageInstanceId: 'poll-page-late-huawei',
      pageInstanceStartedAt: 500,
      system: 'billing',
      pageKind: 'billing_onu_poll',
      url: lateResponseUrl
    },
    operation: { pollAttemptId: lateAttemptId }
  },
  context: {
    ...contextFor('abon1000', '100', lateResponseDocument),
    key: 'billing|billing_onu_poll|100|a313|abon1000',
    pageKind: 'billing_onu_poll',
    subview: 'a313',
    url: lateResponseUrl,
    pon: {
      status: fact('online'),
      locatedInterface: fact('gpon0/2/9:14')
    },
    meta: {
      documentId: lateResponseDocument,
      poll: {
        openedAction: '313',
        expectedPollAction: '313',
        requestObserved: true,
        outcome: 'confirmed',
        uiStable: true,
        wrongPollTab: false,
        responseEvidence: true,
        lateResponseRecovery: true,
        snapshot: {
          schemaVersion: 1,
          outcome: 'confirmed',
          pollAction: '313',
          pollType: 'Huawei',
          adapter: 'huawei',
          oltName: 'Teremkovskaya-3A-OLT-Huawei',
          oltIp: '172.16.1.10',
          onuStatus: 'online',
          onuMac: '6C:68:A4:93:B7:84',
          onuSerial: 'FGXP0093B785',
          observedOnuSerial: 'FGXP0093B785',
          observedSubscriberMac: '84:D8:1B:49:E3:6C',
          learnedMacs: ['84:D8:1B:49:E3:6C'],
          interface: 'GPON0/2/9:14',
          rx: '-18.4 dBm',
          tx: '2.1 dBm',
          distance: '1240 m',
          linkState: 'up',
          speedMbps: 1000,
          duplex: 'full',
          identityAssessment: 'matched',
          matchedBy: ['onuSerial'],
          evidence: [
            {
              adapter: 'huawei', family: 'mac_address', label: 'MAC устройства',
              state: 'normal', relation: 'primary', visualPriority: 'decisive',
              summary: 'MAC ИЗУЧЕН · 84:D8:1B:49:E3:6C', diagnosticNote: '',
              facts: { macs: ['84:D8:1B:49:E3:6C'] }
            },
            {
              adapter: 'huawei', family: 'ont_port_state', label: 'Ethernet-порт',
              state: 'normal', relation: 'primary', visualPriority: 'decisive',
              summary: 'LINK UP · 1 Гбит/с · Full-Duplex', diagnosticNote: '',
              facts: { linkState: 'up', speedMbps: 1000, duplex: 'full' }
            }
          ]
        }
      },
      locatorObservations: [{
        type: 'POLL_RESULT',
        result: 'confirmed',
        method: 'direct_olt_poll',
        source: 'billing',
        details: {
          pollCompleted: true,
          pollResponded: true,
          requestObserved: true,
          responseEvidence: true,
          lateResponseRecovery: true,
          uiStable: true,
          wrongPollTab: false,
          expectedPollAction: '313',
          pollAction: '313',
          oltIp: '172.16.1.10',
          observedOnuSerial: 'FGXP0093B785',
          observedSubscriberMac: '84:D8:1B:49:E3:6C',
          interface: 'gpon0/2/9:14'
        },
        summary: 'Huawei OLT вернула ONU online, изученный MAC и LINK UP.'
      }]
    }
  }
}, { tab: { id: 1, windowId: 1 }, frameId: 0, documentId: lateResponseDocument });
assert.equal(lateResponse.pollTransition?.recovered, true);
state = structuredClone(storageData.simnet_workbench_state_v5);
const recoveredCase = state.cases[caseAId];
assert.equal(recoveredCase.locator.termination?.status, 'confirmed');
assert.equal(recoveredCase.diagnostic.stage, 'confirmed');
assert.equal(recoveredCase.operations.poll.current.pollAttemptId, lateAttemptId);
assert.equal(recoveredCase.operations.poll.current.stage, 'CONFIRMED');
assert.equal(recoveredCase.operations.poll.current.lateResponseRecovery, true);
assert.equal(recoveredCase.operations.poll.current.recoveredFromReason, 'poll-request-document-not-opened');
assert.equal(recoveredCase.live.oltSnapshot.status, 'confirmed');
assert.equal(recoveredCase.live.oltSnapshot.pollAttemptId, lateAttemptId);
assert.equal(recoveredCase.live.oltSnapshot.pollAction, '313');
assert.equal(recoveredCase.live.oltSnapshot.observedSubscriberMac, '84:D8:1B:49:E3:6C');
assert.equal(recoveredCase.live.oltSnapshot.linkState, 'up');
assert.equal(recoveredCase.live.oltSnapshot.speedMbps, 1000);
assert.equal(recoveredCase.live.oltSnapshot.evidence.length, 2);
assert.ok(recoveredCase.operations.poll.history.some(item => (
  item.pollAttemptId === lateAttemptId
  && item.stage === 'CONFIRMED'
  && item.lateResponseRecovery === true
)));

const backDocument = 'billing-doc-after-back';
await send('STORE_APPLY_CONTEXT', {
  context: contextFor('abon1000', '100', backDocument),
  envelope: {
    eventId: 'billing-back-after-late-response',
    type: 'STORE_APPLY_CONTEXT',
    occurredAt: new Date().toISOString(),
    origin: {
      documentId: backDocument,
      pageInstanceId: 'billing-page-after-back',
      pageInstanceStartedAt: 600,
      system: 'billing',
      pageKind: 'billing_user',
      url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=100'
    }
  }
}, { tab: { id: 1, windowId: 1 }, frameId: 0, documentId: backDocument });
state = structuredClone(storageData.simnet_workbench_state_v5);
const afterBack = state.cases[caseAId];
assert.equal(afterBack.locator.termination?.status, 'confirmed');
assert.equal(afterBack.diagnostic.stage, 'confirmed');
assert.deepEqual(
  afterBack.live.oltSnapshot,
  recoveredCase.live.oltSnapshot,
  'Billing Back navigation must preserve the complete confirmed LIVE snapshot'
);
assert.equal(state.cases[caseBId].live.oltSnapshot, null, 'OLT snapshot must never leak to another subscriber Case');
assert.notEqual(afterBack.locator.recommendation?.action, 'poll_current_binding');
assert.notEqual(afterBack.locator.recommendation?.action, 'poll_candidate');

// A later failed/timeout document is not allowed to erase the last confirmed
// technical evidence for this subscriber.
const confirmedSnapshot = structuredClone(afterBack.live.oltSnapshot);
const rejectedSnapshot = globalThis.__SIMNET_WB_TEST_API__.commitConfirmedOltSnapshot(
  afterBack,
  {
    operation: { pollAttemptId: lateAttemptId },
    origin: { documentId: 'failed-response-doc' }
  },
  {
    pageKind: 'billing_onu_poll',
    url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?a=313&act=askolt&id=100',
    meta: {
      poll: {
        outcome: 'timeout',
        openedAction: '313',
        requestObserved: true,
        responseEvidence: false,
        wrongPollTab: false,
        snapshot: { outcome: 'timeout', pollAction: '313', evidence: [] }
      }
    }
  },
  { attempt: afterBack.operations.poll.current }
);
assert.equal(rejectedSnapshot.stored, false);
assert.deepEqual(afterBack.live.oltSnapshot, confirmedSnapshot, 'failed result must not clear the confirmed LIVE snapshot');

// chrome.storage must hold a fully serializable copy: no live DOM nodes,
// functions or page-instance objects may be required to restore it.
assert.deepEqual(
  JSON.parse(JSON.stringify(recoveredCase.live.oltSnapshot)),
  recoveredCase.live.oltSnapshot,
  'confirmed LIVE snapshot must survive a storage serialization round trip'
);

// Simulate Chrome terminating and recreating the MV3 service worker. The new
// module instance has no access to the old module closure and must rebuild the
// full snapshot from chrome.storage alone.
await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href
  + `?workerRestart=${Date.now()}`
);
assert.equal(listeners.length, 2, 'a fresh service-worker instance must register independently');
const restartedState = await sendVia(1, 'STORE_GET_STATE', {}, {
  tab: { id: 1, windowId: 1 },
  frameId: 0,
  documentId: 'billing-doc-after-worker-restart'
});
assert.deepEqual(
  restartedState.cases[caseAId].live.oltSnapshot,
  recoveredCase.live.oltSnapshot,
  'a fresh service worker must restore the complete confirmed snapshot from chrome.storage'
);

// A newly loaded ordinary Billing page has no terminal DOM at all. Applying
// that page through the restarted worker must keep the stored OLT evidence.
const restartDocument = 'billing-doc-after-worker-restart';
await sendVia(1, 'STORE_APPLY_CONTEXT', {
  context: contextFor('abon1000', '100', restartDocument),
  envelope: {
    eventId: 'billing-page-after-worker-restart',
    type: 'STORE_APPLY_CONTEXT',
    occurredAt: new Date().toISOString(),
    origin: {
      documentId: restartDocument,
      pageInstanceId: 'billing-page-after-worker-restart',
      pageInstanceStartedAt: 700,
      system: 'billing',
      pageKind: 'billing_user',
      url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=100'
    }
  }
}, { tab: { id: 1, windowId: 1 }, frameId: 0, documentId: restartDocument });
const afterWorkerRestart = structuredClone(storageData.simnet_workbench_state_v5);
assert.deepEqual(
  afterWorkerRestart.cases[caseAId].live.oltSnapshot,
  recoveredCase.live.oltSnapshot,
  'a new non-terminal page must not clear evidence restored from storage'
);

console.log('case_processor_integration_test: PASS');
