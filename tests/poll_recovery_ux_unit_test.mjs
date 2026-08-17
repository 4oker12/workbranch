import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const guardSource = read('src/core/interaction-guards.js');
const guideSource = read('src/ui/guide.js');
const storeSource = read('src/core/store-client.js');
const railSource = read('src/ui/rail.js');
const knowledgeSource = read('src/ui/knowledge-base.js');
const juniperSource = read('src/core/juniper-prefetch.js');

// The strict Poll guard is semantic and target-scoped. Continuous unrelated
// Billing mutations cannot make Ask OLT permanently unclickable.
assert.match(guardSource, /function pollBindingVerdict/);
assert.match(guardSource, /requireQuiet:\s*false/);
assert.match(guardSource, /poll-request-document-not-opened/);
assert.match(guardSource, /POLL_STALE_TIMEOUT_MS\s*=\s*90000/);
assert.match(guardSource, /POLL_LATE_RESPONSE_MAX_AGE_MS\s*=\s*180000/);
assert.match(guardSource, /function preservePollAttemptForNativeNavigation/);
assert.match(guardSource, /beforeunload/);
assert.match(guardSource, /function isRecoverableLatePollResponse/);
assert.match(guardSource, /responseEvidence/);
assert.match(guideSource, /cancelOnStale:\s*false/);
assert.match(guideSource, /requireQuiet:\s*false/);

// Store envelopes do not inherit a PollAttempt from another subscriber merely
// because the same browser tab still has that old sessionStorage record.
const events = [];
const wb = {
  runtime: { lastContext: {}, documentId: 'doc-B', pageInstanceId: 'page-B', pageInstanceStartedAt: 2 },
  interactionGuards: {},
  bus: { emit(...args) { events.push(args); } },
  stateKey: 'state'
};
const storeSandbox = {
  globalThis: { SIMNET_WB: wb, crypto: globalThis.crypto },
  window: {},
  chrome: {
    runtime: { id: 'test-extension', async sendMessage() { return { success: true, data: {} }; } },
    storage: { onChanged: { addListener() {}, removeListener() {} } }
  },
  location: { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=200' },
  console,
  queueMicrotask
};
storeSandbox.window.top = storeSandbox.window;
storeSandbox.window.self = storeSandbox.window;
vm.createContext(storeSandbox);
vm.runInContext(storeSource, storeSandbox);

const caseB = {
  id: 'login:abon200', episodeId: 'episode-B', caseVersion: 8, routeGeneration: 3,
  identity: { login: { value: 'abon200' }, billingId: { value: '200' } },
  network: { mac: { value: 'AA:BB:CC:DD:EE:02' } },
  pon: { pollAction: { value: '313' }, oltIp: { value: '172.16.1.2' } }
};
wb.store.state = { cases: { [caseB.id]: caseB } };
wb.store.localCaseId = caseB.id;
wb.interactionGuards.recentPollRequest = () => ({
  caseId: 'login:abon100', episodeId: 'episode-A', pollAttemptId: 'poll-A',
  caseVersion: 4, routeGeneration: 2, pending: true
});
const ordinaryEnvelope = wb.store.createEnvelope('LOCATOR_APPLY_OBSERVATION', {}, {});
assert.equal(ordinaryEnvelope.caseId, caseB.id);
assert.equal(ordinaryEnvelope.operation.pollAttemptId, '');

wb.interactionGuards.recentPollRequest = () => ({
  caseId: caseB.id, episodeId: caseB.episodeId, pollAttemptId: 'poll-B',
  caseVersion: caseB.caseVersion, routeGeneration: caseB.routeGeneration,
  identityFingerprint: 'abon200|200|200||AABBCCDDEE02',
  bindingFingerprint: '|||313||', pending: true
});
const responseEnvelope = wb.store.createEnvelope('STORE_APPLY_CONTEXT', {
  context: {
    system: 'billing', pageKind: 'billing_onu_poll',
    meta: { poll: { requestObserved: true } }
  }
}, {});
assert.equal(responseEnvelope.operation.pollAttemptId, 'poll-B');
assert.equal(responseEnvelope.caseId, caseB.id);

// Juniper prefetch decodes the legacy Billing charset before parsing. This is
// the exact class of corruption that produced ���� and false no_session in both logs.
const juniperWb = { utils: {} };
const juniperSandbox = {
  globalThis: { SIMNET_WB: juniperWb, crypto: globalThis.crypto },
  window: {},
  location: { hostname: 'admin.simnet.kiev.ua' },
  document: { querySelectorAll() { return []; }, querySelector() { return null; } },
  TextDecoder,
  URL,
  console
};
juniperSandbox.window.top = juniperSandbox.window;
juniperSandbox.window.self = juniperSandbox.window;
vm.createContext(juniperSandbox);
vm.runInContext(juniperSource, juniperSandbox);
const cp1251 = Uint8Array.from([
  0x4a,0x75,0x6e,0x69,0x70,0x65,0x72,0x20,
  0xd1,0xf2,0xe0,0xf2,0xf3,0xf1,0x20,0xf1,0xe5,0xf1,0xb3,0xbf,
  0x20,0x2d,0x20,0x6f,0x6e,0x6c,0x69,0x6e,0x65,0x20,0x42,0x52,0x41,0x53
]);
const decoded = juniperWb.juniper.decodeHtmlBytes(
  cp1251,
  'text/html; charset=windows-1251'
);
assert.match(decoded.text, /Статус сесії/);
assert.match(decoded.text, /online BRAS/);
assert.doesNotMatch(decoded.text, /�/);

// Microlearning stays compact: knowledge still holds simple explanations,
// but Focus Layer UI shows only title + short action (no What/Why walls).
assert.match(knowledgeSource, /billing\.juniper-session/);
assert.match(knowledgeSource, /simple:\s*'BRAS/);
assert.match(guideSource, /Compact Focus Layer/);
assert.match(guideSource, /\.tip-what[\s\S]{0,200}display:\s*none/);
assert.match(railSource, /Что уже сделано/);
assert.match(railSource, /evidenceNavigator\?\.trail/);
assert.doesNotMatch(railSource, /<div class="label">Сейчас<\/div>/);
assert.match(railSource, /OLT · запрос выполняется/);
assert.match(railSource, /stageLabel\(stage/);

console.log('poll_recovery_ux_unit_test: PASS');
