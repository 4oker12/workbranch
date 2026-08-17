import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bindingFingerprint, identityFingerprint } from '../src/core/correlation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/core/store-client.js'), 'utf8');

const caseData = {
  id: 'login:abon380822',
  episodeId: 'episode-abon380822',
  caseVersion: 17,
  routeGeneration: 6,
  identity: {
    login: { value: 'abon380822' },
    billingId: { value: '38082' }
  },
  network: { mac: { value: '80:AF:CA:3B:7F:5B' } },
  pon: {
    oltName: { value: 'Vernadsky-24-GPON (172.16.1.250) G-COM' },
    oltIp: { value: '172.16.1.250' },
    pollAction: { value: '311' }
  }
};

const attempt = {
  attemptId: 'poll-gcom-cold-response',
  pollAttemptId: 'poll-gcom-cold-response',
  action: '312',
  billingId: '38082',
  oltIp: '172.16.1.250',
  caseId: caseData.id,
  episodeId: caseData.episodeId,
  caseVersion: caseData.caseVersion,
  routeGeneration: caseData.routeGeneration,
  identityFingerprint: identityFingerprint(caseData),
  bindingFingerprint: bindingFingerprint(caseData),
  stage: 'REQUEST_STARTED',
  pending: true,
  startedAt: Date.now()
};

const pollContext = {
  system: 'billing',
  pageKind: 'billing_onu_poll',
  entityId: '38082',
  subview: 'a312',
  url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?a=312&id=38082&act=askolt&olt_ip=172.16.1.250',
  identity: { billingId: { value: '38082' } },
  network: {},
  pon: {
    status: { value: 'online', source: 'billing:direct-olt-poll-status', confidence: 0.99 },
    pollType: { value: 'GCOM', source: 'billing:confirmed-poll-adapter', confidence: 0.995 },
    pollAction: { value: '312', source: 'billing:confirmed-poll-action', confidence: 0.995 }
  },
  profile: {},
  meta: {
    poll: {
      openedAction: '312',
      attemptAction: '312',
      expectedPollAction: '312',
      requestObserved: true,
      responseEvidence: true,
      wrongPollTab: false,
      uiStable: true,
      outcome: 'confirmed',
      snapshot: {
        schemaVersion: 1,
        outcome: 'confirmed',
        pollAction: '312',
        pollType: 'GCOM',
        adapter: 'gcom',
        oltName: 'Vernadsky-24-GPON (172.16.1.250) G-COM',
        oltIp: '172.16.1.250',
        onuStatus: 'online',
        observedSubscriberMac: '80:AF:CA:3B:7F:5B',
        learnedMacs: ['80:AF:CA:3B:7F:5B'],
        linkState: 'up',
        speedMbps: 100,
        duplex: 'full',
        rx: '-19.2 dBm',
        evidence: [{
          adapter: 'gcom',
          family: 'mac_address',
          label: 'MAC устройства',
          state: 'normal',
          relation: 'primary',
          visualPriority: 'decisive',
          summary: 'MAC ИЗУЧЕН · 80:AF:CA:3B:7F:5B',
          diagnosticNote: '',
          facts: { macs: ['80:AF:CA:3B:7F:5B'] }
        }]
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
        uiStable: true,
        wrongPollTab: false,
        expectedPollAction: '312',
        pollAction: '312',
        oltIp: '172.16.1.250'
      }
    }]
  },
  quality: { trustedPage: true }
};

const storageData = {};
const backgroundListeners = [];
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
    onMessage: { addListener(fn) { backgroundListeners.push(fn); } },
    onInstalled: { addListener() {} }
  },
  tabs: { async update(id, patch) { return { id, ...patch }; } },
  windows: { async update(id, patch) { return { id, ...patch }; } }
};

await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href
  + `?coldPollIntegration=${Date.now()}`
);
assert.equal(backgroundListeners.length, 1);
const api = globalThis.__SIMNET_WB_TEST_API__;
const storedCase = api.emptyCase(caseData.id);
storedCase.episodeId = caseData.episodeId;
// Recording the poll attempt is itself a Case commit, so the Case can already
// be one version ahead of the envelope pinned at click time.
storedCase.caseVersion = caseData.caseVersion + 1;
storedCase.routeGeneration = caseData.routeGeneration;
storedCase.identity = structuredClone(caseData.identity);
storedCase.network = structuredClone(caseData.network);
storedCase.pon = structuredClone(caseData.pon);
storedCase.locator.recommendation = {
  action: 'poll_current_binding',
  ruleId: 'test.cold-gcom',
  reason: 'exact cold response',
  params: {}
};
storedCase.diagnostic.nextRequiredSource = 'poll_current_binding';
storedCase.operations.poll.current = structuredClone(attempt);
storageData.simnet_workbench_state_v5 = {
  schemaVersion: 5,
  version: '1.7.29.2',
  activeCaseId: storedCase.id,
  cases: { [storedCase.id]: storedCase },
  tabs: {
    '77': {
      caseId: storedCase.id,
      documentId: 'billing-request-source-doc',
      pageInstanceId: 'billing-request-source-page',
      pageInstanceStartedAt: 100
    }
  },
  handoffs: {},
  experience: { learnedTargets: {}, updatedAt: '' },
  ui: {},
  meta: {}
};

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`background timeout: ${message.type}`)), 2000);
    const handled = backgroundListeners[0](message, {
      tab: { id: 77, windowId: 1 },
      frameId: 0,
      documentId: 'cold-gcom-response-doc'
    }, response => {
      clearTimeout(timeout);
      resolve(response);
    });
    if (handled === false) {
      clearTimeout(timeout);
      reject(new Error(`background did not handle: ${message.type}`));
    }
  });
}

const emitted = [];
const WB = {
  stateKey: 'simnet_workbench_state_v5',
  runtime: {
    documentId: 'cold-gcom-response-doc',
    pageInstanceId: 'cold-gcom-response-page',
    pageInstanceStartedAt: Date.now(),
    lastContext: pollContext
  },
  interactionGuards: { recentPollRequest: () => attempt },
  bus: { emit(type, payload) { emitted.push({ type, payload }); } }
};

const sandbox = {
  SIMNET_WB: WB,
  location: { href: pollContext.url },
  crypto: globalThis.crypto,
  chrome: {
    runtime: { id: 'test-extension', sendMessage: sendToBackground },
    storage: {
      onChanged: { addListener() {}, removeListener() {} }
    }
  },
  console,
  queueMicrotask
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

// This is the critical real-navigation state: store.init loaded chrome.storage,
// but the first applyContext has not yet populated localCaseId in this new
// content-script instance.
WB.store.state = {
  activeCaseId: caseData.id,
  cases: { [caseData.id]: caseData }
};
assert.equal(WB.store.localCaseId, '');
assert.equal(WB.store.activeCase(), null);

const envelope = WB.store.createEnvelope('STORE_APPLY_CONTEXT', { context: pollContext });
assert.equal(envelope.caseId, caseData.id);
assert.equal(envelope.episodeId, caseData.episodeId);
assert.equal(envelope.caseVersion, caseData.caseVersion);
assert.equal(envelope.routeGeneration, caseData.routeGeneration);
assert.equal(envelope.operation.pollAttemptId, attempt.pollAttemptId);
assert.equal(envelope.identityFingerprint, attempt.identityFingerprint);
assert.equal(envelope.bindingFingerprint, attempt.bindingFingerprint);

// Merely loading a poll tab, or a response for another Billing subscriber,
// must never borrow the remembered operation.
const plainTab = structuredClone(pollContext);
plainTab.meta.poll.requestObserved = false;
const plainEnvelope = WB.store.createEnvelope('STORE_APPLY_CONTEXT', { context: plainTab });
assert.equal(plainEnvelope.caseId, '');
assert.equal(plainEnvelope.operation.pollAttemptId, '');

const foreignResponse = structuredClone(pollContext);
foreignResponse.entityId = '99999';
foreignResponse.identity.billingId.value = '99999';
const foreignEnvelope = WB.store.createEnvelope('STORE_APPLY_CONTEXT', { context: foreignResponse });
assert.equal(foreignEnvelope.caseId, '');
assert.equal(foreignEnvelope.operation.pollAttemptId, '');

// Full cold-start path: StoreClient has no localCaseId, creates the exact
// envelope, Case Processor validates it, confirms the attempt and writes the
// complete snapshot to chrome.storage.
WB.interactionGuards.recentPollRequest = () => attempt;
await WB.store.init();
assert.equal(WB.store.localCaseId, '');
const applied = await WB.store.applyContext(pollContext);
assert.equal(applied.caseId, caseData.id);
assert.equal(WB.store.localCaseId, caseData.id);
const committed = storageData.simnet_workbench_state_v5.cases[caseData.id];
assert.equal(committed.operations.poll.current.stage, 'CONFIRMED');
assert.equal(committed.live.oltSnapshot.pollAttemptId, attempt.pollAttemptId);
assert.equal(committed.live.oltSnapshot.pollType, 'GCOM');
assert.equal(committed.live.oltSnapshot.pollAction, '312');
assert.equal(committed.live.oltSnapshot.observedSubscriberMac, '80:AF:CA:3B:7F:5B');
assert.equal(committed.live.oltSnapshot.linkState, 'up');
assert.equal(committed.live.oltSnapshot.speedMbps, 100);

console.log('store_client_cold_poll_response_unit_test: PASS');
