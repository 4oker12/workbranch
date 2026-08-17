import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  CorrelationVerdict,
  PollAttemptStage,
  bindingFingerprint,
  identityFingerprint,
  makeEventEnvelope,
  nextPollAttempt,
  validateCorrelation,
  validateDiagnosticInvariants
} from '../src/core/correlation.js';
import {
  RouteRelation,
  classifyContextRelation,
  classifyObservationRelation
} from '../src/core/route-controller.js';

const listeners = [];
globalThis.chrome = {
  storage: { local: { async get() { return {}; }, async set() {} } },
  runtime: {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    onInstalled: { addListener() {} }
  },
  tabs: { async update(id, patch) { return { id, ...patch }; } },
  windows: { async update(id, patch) { return { id, ...patch }; } }
};

await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href
  + `?correlation=${Date.now()}`
);
const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api);

const fact = value => ({ value, source: 'test', confidence: 0.99 });
const makeCase = (id, login, billingId) => {
  const item = api.emptyCase(id);
  item.identity.login = fact(login);
  item.identity.billingId = fact(billingId);
  item.network.connectionFamily = fact('PON');
  item.network.mac = fact('AA:BB:CC:DD:EE:01');
  item.pon.oltName = fact('OLT Test');
  item.pon.oltIp = fact('172.16.1.10');
  item.pon.onuMac = fact('001122334455');
  item.pon.pollAction = fact('313');
  item.locator.recommendation = {
    action: 'check_tmc',
    ruleId: 'route.check-tmc',
    reason: 'test',
    params: {}
  };
  item.diagnostic.nextRequiredSource = 'check_tmc';
  item.routeGeneration = 7;
  item.caseVersion = 11;
  return item;
};

// Legacy cases receive a stable episode and initialized correlation state.
const legacyA = { id: 'legacy:42', createdAt: '2025-01-02T03:04:05.000Z' };
const legacyB = structuredClone(legacyA);
api.ensureCaseShape(legacyA, legacyA.id);
api.ensureCaseShape(legacyB, legacyB.id);
assert.ok(legacyA.episodeId);
assert.equal(legacyA.episodeId, legacyB.episodeId);
assert.equal(legacyA.caseVersion, 0);
assert.equal(legacyA.routeGeneration, 0);
assert.deepEqual(legacyA.viewsByTab, {});

// 1. Case A request can never be retargeted to Case B.
const caseA = makeCase('login:abon100', 'abon100', '10');
const caseB = makeCase('login:abon200', 'abon200', '20');
const envelopeA = makeEventEnvelope({
  eventId: 'juniper-A-response',
  caseId: caseA.id,
  episodeId: caseA.episodeId,
  caseVersion: caseA.caseVersion,
  routeGeneration: caseA.routeGeneration,
  identityFingerprint: identityFingerprint(caseA),
  operation: { requestId: 'jun-A' }
}, { type: 'LOCATOR_APPLY_OBSERVATION', caseData: caseA });
assert.equal(validateCorrelation(caseB, envelopeA).verdict, CorrelationVerdict.FOREIGN);
const caseBBefore = JSON.stringify(caseB);
const staleA = { ...caseA, routeGeneration: caseA.routeGeneration + 1 };
assert.equal(
  validateCorrelation(staleA, envelopeA, { requireCurrentRoute: true }).verdict,
  CorrelationVerdict.STALE
);
assert.equal(JSON.stringify(caseB), caseBBefore, 'B is untouched by A correlation');

// 2. Manual Huawei/GPON/Juniper detours do not replace mandatory CHECK_TMC.
for (const context of [
  { system: 'billing', pageKind: 'billing_onu_poll', subview: 'a313', meta: { poll: { openedAction: '313' } } },
  { system: 'billing', pageKind: 'billing_onu_poll', subview: 'a311', meta: { poll: { openedAction: '311' } } },
  { system: 'billing', pageKind: 'billing_juniper', meta: {} }
]) {
  assert.notEqual(classifyContextRelation(caseA, context), RouteRelation.ON_ROUTE);
}
assert.equal(
  classifyObservationRelation(caseA, { type: 'JUNIPER_SESSION' }, { pageKind: 'billing_juniper' }),
  RouteRelation.OFF_ROUTE
);
assert.equal(caseA.locator.recommendation.action, 'check_tmc');

// 3. A late response from attempt #1 cannot finish attempt #2.
const attempt1 = nextPollAttempt(null, {
  pollAttemptId: 'poll-1', stage: PollAttemptStage.INTENT_RECORDED
});
assert.equal(attempt1.accepted, true);
const completed1 = nextPollAttempt(attempt1.attempt, {
  pollAttemptId: 'poll-1', stage: PollAttemptStage.FAILED
});
assert.equal(completed1.attempt.pending, false);
assert.equal(completed1.attempt.status, 'failed', 'terminal poll state cannot remain status=pending');
const confirmedSeed = nextPollAttempt(null, {
  pollAttemptId: 'poll-confirmed', stage: PollAttemptStage.INTENT_RECORDED, status: 'pending'
});
const confirmedTerminal = nextPollAttempt(confirmedSeed.attempt, {
  pollAttemptId: 'poll-confirmed', stage: PollAttemptStage.CONFIRMED, status: 'pending', outcome: 'confirmed'
});
assert.equal(confirmedTerminal.attempt.pending, false);
assert.equal(confirmedTerminal.attempt.status, 'resolved', 'CONFIRMED poll is normalized to resolved instead of stale pending status');
const attempt2 = nextPollAttempt(completed1.attempt, {
  pollAttemptId: 'poll-2', stage: PollAttemptStage.INTENT_RECORDED
});
assert.equal(attempt2.accepted, true);
const lateRestart1 = nextPollAttempt(completed1.attempt, {
  pollAttemptId: 'poll-1', stage: PollAttemptStage.RESPONSE_DOCUMENT
});
assert.equal(lateRestart1.accepted, false);
assert.equal(lateRestart1.reason, 'finished-poll-cannot-return-to-running');
const latePollEnvelope = makeEventEnvelope({
  caseId: caseA.id,
  episodeId: caseA.episodeId,
  routeGeneration: caseA.routeGeneration,
  identityFingerprint: identityFingerprint(caseA),
  bindingFingerprint: bindingFingerprint(caseA),
  operation: { pollAttemptId: 'poll-1' }
}, { type: 'STORE_APPLY_CONTEXT', caseData: caseA });
assert.equal(validateCorrelation(caseA, latePollEnvelope, {
  requirePollAttempt: true,
  currentPollAttemptId: attempt2.attempt.pollAttemptId
}).reason, 'stale-poll-attempt');

// 4. Triple click produces one logical pending operation.
const click1 = nextPollAttempt(null, { pollAttemptId: 'triple', stage: PollAttemptStage.INTENT_RECORDED });
const click2 = nextPollAttempt(click1.attempt, { pollAttemptId: 'triple', stage: PollAttemptStage.INTENT_RECORDED });
const click3 = nextPollAttempt(click1.attempt, { pollAttemptId: 'triple', stage: PollAttemptStage.INTENT_RECORDED });
assert.equal(click1.accepted, true);
assert.equal(click2.duplicate, true);
assert.equal(click3.duplicate, true);

// 5. Billing and UserSide views of one case coexist by tab/document.
const multiView = makeCase('login:abon300', 'abon300', '30');
api.storeViewContext(multiView, {
  origin: { tabId: 10, documentId: 'billing-doc', pageInstanceId: 'p1', pageInstanceStartedAt: 100 }
}, { system: 'billing', pageKind: 'billing_user', observedAt: '2026-08-11T10:00:00Z' });
api.storeViewContext(multiView, {
  origin: { tabId: 20, documentId: 'userside-doc', pageInstanceId: 'p2', pageInstanceStartedAt: 200 }
}, { system: 'userside', pageKind: 'userside_customer', observedAt: '2026-08-11T10:00:01Z' });
assert.equal(multiView.viewsByTab['10']['billing-doc'].pageKind, 'billing_user');
assert.equal(multiView.viewsByTab['20']['userside-doc'].pageKind, 'userside_customer');

// 6. Old MutationObserver/document callbacks are stale after navigation.
const oldDocumentEnvelope = makeEventEnvelope({
  caseId: caseA.id,
  episodeId: caseA.episodeId,
  routeGeneration: caseA.routeGeneration,
  identityFingerprint: identityFingerprint(caseA),
  origin: { documentId: 'old-doc', pageInstanceStartedAt: 100 }
}, { type: 'GUIDE_MARK_STEP', caseData: caseA });
const oldDocumentVerdict = validateCorrelation(caseA, oldDocumentEnvelope, {
  requireCurrentDocument: true,
  currentDocument: { documentId: 'new-doc', pageInstanceStartedAt: 200 }
});
assert.equal(oldDocumentVerdict.reason, 'stale-document');

// 7. Safe navigation bookkeeping can fail without canceling the native click.
const guideSource = await readFile(new URL('../src/ui/guide.js', import.meta.url), 'utf8');
const guardSource = await readFile(new URL('../src/core/interaction-guards.js', import.meta.url), 'utf8');
assert.ok(guideSource.includes('cancelOnStale: false'));
assert.ok(guideSource.includes('requireQuiet: false'));
assert.ok(guardSource.includes('stale-guide-click-pass-through'));

// 8. FINISHED is a one-way latch; late enrichment remains passive evidence.
const finished = makeCase('login:abon400', 'abon400', '40');
finished.locator.termination = { status: 'confirmed', reason: 'direct_olt_poll_completed' };
finished.locator.state = 'confirmed';
const afterLate = structuredClone(finished);
afterLate.locator.evidence.unshift({ type: 'JUNIPER_SESSION', passive: true });
assert.deepEqual(validateDiagnosticInvariants(finished, afterLate), []);
afterLate.locator.termination = null;
afterLate.locator.state = 'searching';
assert.ok(validateDiagnosticInvariants(finished, afterLate).includes('finished-cannot-return-to-running'));

// Case Processor versions every accepted commit and increments routeGeneration only for NEXT changes.
const versionedState = { cases: { [caseA.id]: structuredClone(caseA) } };
const previousState = structuredClone(versionedState);
versionedState.cases[caseA.id].journal.unshift({ id: 'evidence-only' });
api.finalizeCaseCommits(versionedState, previousState);
assert.equal(versionedState.cases[caseA.id].caseVersion, caseA.caseVersion + 1);
assert.equal(versionedState.cases[caseA.id].routeGeneration, caseA.routeGeneration);

console.log('correlation_hardening_unit_test: PASS');
