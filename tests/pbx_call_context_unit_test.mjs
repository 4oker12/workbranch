import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const stateKey = 'simnet_workbench_state_v5';
const stored = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(key => key in stored).map(key => [key, structuredClone(stored[key])]));
      },
      async set(patch) {
        Object.assign(stored, structuredClone(patch));
      }
    }
  },
  runtime: {
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} }
  },
  tabs: {
    onRemoved: { addListener() {} },
    async update(tabId, patch) { return { id: tabId, ...patch }; }
  },
  windows: { async update(windowId, patch) { return { id: windowId, ...patch }; } }
};

await import(pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href + `?v=${Date.now()}`);
const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api, 'background test API should be exposed');

const durableHistory = api.durableSnapshotFacts({
  events: [{ at: '2026-08-15T10:00:00Z', reason: 'LOS', meta: { source: 'olt', code: 7 } }]
});
assert.doesNotMatch(JSON.stringify(durableHistory), /\[object Object\]/, 'durable LIVE snapshot must keep structured history objects instead of stringifying them as [object Object]');
assert.equal(durableHistory.events[0].reason, 'LOS');

const oldCall = api.normalizePbxCall({
  recordId: '1786000000.100001',
  startedAtMs: Date.now() - (49 * 60 * 60 * 1000),
  observedAt: new Date().toISOString()
});
const pruned = api.prunePbxTelephony({
  calls: { [oldCall.callKey]: oldCall },
  bindings: {}
});
assert.equal(Object.keys(pruned.calls).length, 0, 'old rows cannot stay fresh just because list.php was reopened');

const observedAt = new Date().toISOString();
const startedAtMs = Date.now() - 60_000;
await api.observePbxRecentCalls({
  schema: 'simnet-pbx-recent-calls-v1',
  observedAt,
  calls: [{
    callKey: 'pbx:1786725676.187490',
    recordId: '1786725676.187490',
    date: '2026-08-14',
    time: '19:41:16',
    startedAtMs,
    callerId: '+380441234567',
    contract: '1910',
    subscriberIp: '10.0.0.25',
    duration: '00:00:36',
    durationSeconds: 36,
    agent: '6047 Operator_Test OPW',
    agentExtension: '6047'
  }]
}, {
  url: 'https://pbx.simnet.kiev.ua/fop2/list.php',
  tab: { id: 90, url: 'https://pbx.simnet.kiev.ua/fop2/list.php' }
});

const caseA = api.emptyCase('login:abon1910');
caseA.identity.login = { value: 'abon1910', confidence: 0.99 };
caseA.identity.contract = { value: '1910', confidence: 0.99 };
caseA.identity.customerId = { value: '191', confidence: 0.99 };
caseA.network.ip = { value: '10.0.0.25', confidence: 0.99 };
const caseB = api.emptyCase('login:abon2000');
caseB.identity.login = { value: 'abon2000', confidence: 0.99 };
caseB.identity.contract = { value: '2000', confidence: 0.99 };
caseB.identity.customerId = { value: '200', confidence: 0.99 };
caseB.profile.phone = { value: '+380441234567', confidence: 0.99 };

stored[stateKey].cases = { [caseA.id]: caseA, [caseB.id]: caseB };
stored[stateKey].tabs = {
  11: { tabId: 11, caseId: caseA.id, documentId: 'doc-a' },
  12: { tabId: 12, caseId: caseB.id, documentId: 'doc-b' }
};

const senderA = { tab: { id: 11, windowId: 1, url: 'https://userside.simnet.kiev.ua/customer/191' } };
const senderB = { tab: { id: 12, windowId: 1, url: 'https://userside.simnet.kiev.ua/customer/200' } };
const queried = await api.queryPbxRecentCalls({ caseId: caseA.id, customerId: '191' }, senderA);
assert.equal(queried.calls.length, 1);
assert.deepEqual(queried.calls[0].match.matchedBy, ['contract', 'ip']);

const bound = await api.bindPbxCall({
  caseId: caseA.id,
  customerId: '191',
  callKey: 'pbx:1786725676.187490',
  mode: 'dry-run'
}, senderA);
assert.equal(bound.accepted, true);
assert.equal(bound.binding.caseId, caseA.id);
assert.equal(bound.binding.boundByTabId, 11);
assert.equal(stored[stateKey].cases[caseA.id].telephony.callBindings.length, 1);
assert.equal(stored[stateKey].cases[caseA.id].journal.at(-1).type, 'call_binding');

await assert.rejects(
  () => api.bindPbxCall({
    caseId: caseB.id,
    customerId: '200',
    callKey: 'pbx:1786725676.187490',
    mode: 'dry-run'
  }, senderB),
  /конфликтует.*contract/,
  'a conflicting contract blocks binding before shared-phone or ownership heuristics'
);

await api.observePbxRecentCalls({
  schema: 'simnet-pbx-recent-calls-v1',
  observedAt,
  calls: [{
    callKey: 'pbx:1786725680.187491',
    recordId: '1786725680.187491',
    date: '2026-08-14',
    time: '19:42:00',
    startedAtMs: startedAtMs + 1000,
    callerId: '+380441234567',
    duration: '00:00:22',
    durationSeconds: 22,
    agent: '6047 Operator_Test OPW',
    agentExtension: '6047'
  }]
}, {
  url: 'https://pbx.simnet.kiev.ua/fop2/list.php',
  tab: { id: 90, url: 'https://pbx.simnet.kiev.ua/fop2/list.php' }
});

const queriedB = await api.queryPbxRecentCalls({ caseId: caseB.id, customerId: '200' }, senderB);
const phoneOnly = queriedB.calls.find(call => call.callKey === 'pbx:1786725680.187491');
assert.equal(phoneOnly.match.level, 'supporting');
assert.deepEqual(phoneOnly.match.matchedBy, ['phone']);
await assert.rejects(
  () => api.bindPbxCall({
    caseId: caseB.id,
    customerId: '200',
    callKey: phoneOnly.callKey,
    mode: 'dry-run'
  }, senderB),
  /Одного телефона недостаточно/,
  'the same phone on multiple contracts is never enough for a binding'
);

const overrideBound = await api.bindPbxCall({
  caseId: caseB.id,
  customerId: '200',
  callKey: phoneOnly.callKey,
  mode: 'operator-override',
  operatorOverride: true,
  overrideAcknowledged: true
}, senderB);
assert.equal(overrideBound.accepted, true, 'explicit operator override can bind an otherwise non-strong call');
assert.equal(overrideBound.binding.mode, 'operator-override');
assert.equal(overrideBound.binding.operatorOverride?.acknowledged, true);
assert.equal(typeof overrideBound.binding.operatorOverride?.callSignature, 'string');
assert.ok(overrideBound.binding.operatorOverride.callSignature.length > 10);
assert.deepEqual(
  await api.validateCallSubmissionContext({
    caseId: caseB.id,
    customerId: '200',
    pbxCallKey: phoneOnly.callKey
  }, senderB),
  { caseId: caseB.id, customerId: '200', callKey: phoneOnly.callKey },
  'an acknowledged operator override authorizes this exact immutable PBX call only'
);
const overrideJournal = stored[stateKey].cases[caseB.id].journal.find(item => (
  item.type === 'call_binding' && item.details?.callKey === phoneOnly.callKey
));
assert.equal(overrideJournal?.details?.operatorOverride, true, 'manual responsibility is auditable in the Case journal');

await api.observePbxRecentCalls({
  schema: 'simnet-pbx-recent-calls-v1',
  observedAt,
  calls: [{
    callKey: phoneOnly.callKey,
    recordId: phoneOnly.recordId,
    date: phoneOnly.date,
    time: phoneOnly.time,
    startedAtMs: phoneOnly.startedAtMs,
    callerId: '+380501111111',
    duration: phoneOnly.duration,
    durationSeconds: phoneOnly.durationSeconds,
    agent: phoneOnly.agent,
    agentExtension: phoneOnly.agentExtension
  }]
}, {
  url: 'https://pbx.simnet.kiev.ua/fop2/list.php',
  tab: { id: 90, url: 'https://pbx.simnet.kiev.ua/fop2/list.php' }
});
await assert.rejects(
  () => api.validateCallSubmissionContext({
    caseId: caseB.id,
    customerId: '200',
    pbxCallKey: phoneOnly.callKey
  }, senderB),
  /нет точного совпадения.*нет подтверждённого ручного override/,
  'manual override is invalidated if the underlying PBX call identity changes after acknowledgement'
);

await assert.rejects(
  () => api.validateCallSubmissionContext({
    caseId: caseA.id,
    customerId: '191',
    pbxCallKey: 'pbx:1786725676.187490'
  }, senderB),
  /другому абоненту/,
  'switching to another subscriber tab blocks a stale submit'
);

assert.deepEqual(
  await api.validateCallSubmissionContext({
    caseId: caseA.id,
    customerId: '191',
    pbxCallKey: 'pbx:1786725676.187490'
  }, senderA),
  { caseId: caseA.id, customerId: '191', callKey: 'pbx:1786725676.187490' }
);

await assert.rejects(
  () => api.validateCallSubmissionContext({
    caseId: caseA.id,
    customerId: '191',
    pbxCallKey: ''
  }, senderA),
  /сначала закрепи завершённый PBX-звонок/,
  'UserSide POST is impossible without a bound PBX callid'
);

const claim = await api.claimPbxCallSubmission({
  caseId: caseA.id,
  customerId: '191',
  pbxCallKey: 'pbx:1786725676.187490'
}, senderA);
assert.equal(claim.registrationStatus, 'submitting');
await assert.rejects(
  () => api.claimPbxCallSubmission({
    caseId: caseA.id,
    customerId: '191',
    pbxCallKey: 'pbx:1786725676.187490'
  }, senderA),
  /уже отправляется/,
  'an atomic claim blocks a parallel second tab click'
);

const finalized = await api.finalizePbxCallSubmission({
  ...claim,
  status: 'success'
}, senderA);
assert.equal(finalized.binding.registrationStatus, 'registered');
await assert.rejects(
  () => api.claimPbxCallSubmission({
    caseId: caseA.id,
    customerId: '191',
    pbxCallKey: 'pbx:1786725676.187490'
  }, senderA),
  /уже зарегистрирован/,
  'a registered PBX callid cannot be posted twice'
);

await api.observePbxRecentCalls({
  schema: 'simnet-pbx-recent-calls-v1',
  observedAt,
  calls: [{
    callKey: 'pbx:1786725685.187492',
    recordId: '1786725685.187492',
    date: '2026-08-14',
    time: '19:42:05',
    startedAtMs: startedAtMs + 2000,
    callerId: '+380441234567',
    contract: '2000',
    duration: '00:00:18',
    durationSeconds: 18,
    agent: '6047 Operator_Test OPW',
    agentExtension: '6047'
  }]
}, {
  url: 'https://pbx.simnet.kiev.ua/fop2/list.php',
  tab: { id: 90, url: 'https://pbx.simnet.kiev.ua/fop2/list.php' }
});
await api.bindPbxCall({
  caseId: caseB.id,
  customerId: '200',
  callKey: 'pbx:1786725685.187492',
  mode: 'dry-run'
}, senderB);
const uncertainClaim = await api.claimPbxCallSubmission({
  caseId: caseB.id,
  customerId: '200',
  pbxCallKey: 'pbx:1786725685.187492'
}, senderB);
const uncertain = await api.finalizePbxCallSubmission({
  ...uncertainClaim,
  status: 'unknown'
}, senderB);
assert.equal(uncertain.binding.registrationStatus, 'review_required');
await assert.rejects(
  () => api.claimPbxCallSubmission({
    caseId: caseB.id,
    customerId: '200',
    pbxCallKey: 'pbx:1786725685.187492'
  }, senderB),
  /предыдущей отправки неизвестен/,
  'an uncertain UserSide response blocks blind retries'
);

console.log('pbx_call_context_unit_test: PASS');
