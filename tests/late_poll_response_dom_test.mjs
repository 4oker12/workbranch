import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const jsdomModule = process.env.SIMNET_JSDOM_MODULE;
if (!jsdomModule) throw new Error('SIMNET_JSDOM_MODULE must point to jsdom/lib/api.js');
const { JSDOM } = await import(pathToFileURL(jsdomModule).href);
const source = fs.readFileSync(
  new URL('../src/core/interaction-guards.js', import.meta.url),
  'utf8'
);
const signalSource = fs.readFileSync(
  new URL('../src/core/locator-signals.js', import.meta.url),
  'utf8'
);
const billingSource = fs.readFileSync(
  new URL('../src/adapters/billing-adapter.js', import.meta.url),
  'utf8'
);

const url = 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?pp=protected&a=313&id=15874&act=askolt&olt_ip=172.16.1.10';
const dom = new JSDOM('<!doctype html><html><body>Huawei OLT response</body></html>', {
  url,
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const caseData = {
  id: 'login:abon158747',
  episodeId: 'episode-abon158747',
  caseVersion: 9,
  routeGeneration: 4,
  identity: { billingId: { value: '15874' } },
  pon: { pollAction: { value: '313' }, oltIp: { value: '172.16.1.10' } }
};
const emitted = [];
dom.window.SIMNET_WB = {
  adapters: {},
  runtime: {
    documentId: 'huawei-response-document',
    pageInstanceId: 'huawei-response-page',
    pageInstanceStartedAt: Date.now()
  },
  store: {
    localCaseId: caseData.id,
    activeCase: () => caseData,
    correlation: () => ({
      caseId: caseData.id,
      episodeId: caseData.episodeId,
      caseVersion: caseData.caseVersion,
      routeGeneration: caseData.routeGeneration,
      identityFingerprint: 'abon158747|158747|15874||',
      bindingFingerprint: 'teremkovskaya|172.16.1.10|6C68A493B784|FGXP0093B785|313|'
    }),
    async addEvent() {}
  },
  bus: { emit(type, payload) { emitted.push({ type, payload }); } },
  log: { warn() {} }
};
dom.window.chrome = {
  runtime: { async sendMessage() { return { success: true }; } }
};

const timedOutAttempt = {
  attemptId: 'poll-abon158747',
  pollAttemptId: 'poll-abon158747',
  action: '313',
  billingId: '15874',
  oltIp: '172.16.1.10',
  href: url,
  startedAt: Date.now() - 15000,
  status: 'timeout',
  stage: 'TIMEOUT',
  pending: false,
  outcome: 'timeout',
  failureReason: 'poll-request-document-not-opened',
  caseId: caseData.id,
  episodeId: caseData.episodeId
};
dom.window.sessionStorage.setItem('simnet_wb_poll_attempt_v1', JSON.stringify(timedOutAttempt));
dom.window.eval(source);

const guard = dom.window.SIMNET_WB.interactionGuards;
assert.ok(guard, 'interaction guard initialized');
const exactResponse = {
  action: '313',
  billingId: '15874',
  oltIp: '172.16.1.10',
  maxAgeMs: 180000,
  responseEvidence: true
};
assert.equal(guard.isRecoverableLatePollResponse(exactResponse), true);
assert.equal(guard.pollRequestMatches(exactResponse), true);
let stored = guard.recentPollRequest({ expire: false });
assert.equal(stored.lateResponseRecovery, true);
assert.equal(stored.responseDocumentId, 'huawei-response-document');
assert.equal(guard.pollRequestMatches({ ...exactResponse, responseEvidence: false }), false);
assert.equal(guard.pollRequestMatches({ ...exactResponse, billingId: '99999' }), false);

// Verify the actual Billing adapter bridge, not only the guard helper: strong
// Huawei output must become a correlated POLL_RESULT with recovery metadata.
dom.window.SIMNET_WB.pollTerminal = {
  snapshot: () => [
    {
      responseEvidence: true,
      adapter: 'huawei', family: 'mac_address', state: 'normal', relation: 'primary',
      visualPriority: 'decisive', summary: 'MAC ИЗУЧЕН · 84:D8:1B:49:E3:6C',
      facts: { macs: ['84:D8:1B:49:E3:6C'] }
    },
    {
      responseEvidence: true,
      adapter: 'huawei', family: 'ont_port_state', state: 'normal', relation: 'primary',
      visualPriority: 'decisive', summary: 'LINK UP · 1 Гбит/с · Full-Duplex',
      facts: { linkState: 'up', speedMbps: 1000, duplex: 'full' }
    }
  ]
};
guard.isUiReady = () => true;
dom.window.eval(signalSource);
dom.window.eval(billingSource);
const pollText = `
  [17:17:20 13-08-2026] ====== OLT 172.16.1.10 ======
  pon_port_by_onu = 0/2/9
  ontid_by_onu = 14
  onu_by_onu = gpon0/2/9:14
  onu gpon0/2/9:14 is - online
  display ont-learned-mac 0/2/9 14
  0/2/9 14 ETH 1 84d8-1b49-e36c
  Hardware state is Link-Up
  Speed is 1000Mbps
  Duplex is Full-Duplex
`;
const compact = (value, max = 300) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const parsed = dom.window.SIMNET_WB.adapters.billing.collect({
  pageInfo: { kind: 'billing_onu_poll', entityId: '15874', subview: 'a313' },
  text: pollText,
  fact: (value, sourceName, confidence) => value
    ? { value, source: sourceName, confidence }
    : null,
  normalizeMac: value => String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase(),
  validIp: value => String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '',
  compact,
  controlValue: () => '',
  activeCase: caseData
});
assert.equal(parsed.meta.poll.outcome, 'confirmed');
assert.equal(parsed.meta.poll.requestObserved, true);
assert.equal(parsed.meta.poll.responseEvidence, true);
assert.equal(parsed.meta.poll.lateResponseRecovery, true);
assert.equal(parsed.meta.locatorObservations[0].result, 'confirmed');
assert.equal(parsed.meta.locatorObservations[0].details.pollResponded, true);
assert.equal(parsed.meta.poll.snapshot.outcome, 'confirmed');
assert.equal(parsed.meta.poll.snapshot.pollAction, '313');
assert.equal(parsed.meta.poll.snapshot.observedSubscriberMac, '84:D8:1B:49:E3:6C');

assert.equal(guard.resolvePollRequest({
  action: '313',
  billingId: '15874',
  outcome: 'confirmed'
}), true);
stored = guard.recentPollRequest({ expire: false });
assert.equal(stored.stage, 'CONFIRMED');
assert.equal(stored.pending, false);
assert.equal(stored.lateResponseRecovery, true);

// Once native navigation begins, the 12-second intent watchdog must stop
// judging a slow server response as “page did not open”.
const navigatingAttempt = {
  ...timedOutAttempt,
  pollAttemptId: 'poll-native-navigation',
  attemptId: 'poll-native-navigation',
  stage: 'INTENT_RECORDED',
  status: 'pending',
  pending: true,
  outcome: '',
  failureReason: '',
  startedAt: Date.now()
};
dom.window.SIMNET_WB.runtime.pollAttempt = navigatingAttempt;
dom.window.sessionStorage.setItem('simnet_wb_poll_attempt_v1', JSON.stringify(navigatingAttempt));
dom.window.dispatchEvent(new dom.window.Event('beforeunload'));
stored = guard.recentPollRequest({ expire: false });
assert.equal(stored.stage, 'REQUEST_STARTED');
assert.equal(stored.pending, true);
assert.ok(Number(stored.navigationStartedAt) > 0);
assert.ok(emitted.some(event => event.type === 'poll:attempt-started'));

// Real GCOM naming: the exact request/action and explicit G-COM suffix must
// override a stale generic GPON fact already stored in the Case.
dom.reconfigure({
  url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?pp=protected&a=312&id=15874&act=askolt&olt_ip=172.16.1.250'
});
caseData.pon = {
  oltName: { value: 'Vernadsky-24-GPON (172.16.1.250) G-COM' },
  oltIp: { value: '172.16.1.250' },
  pollType: { value: 'GPON' },
  pollAction: { value: '311' }
};
const gcomAttempt = {
  ...navigatingAttempt,
  pollAttemptId: 'poll-gcom-312',
  attemptId: 'poll-gcom-312',
  action: '312',
  oltIp: '172.16.1.250',
  stage: 'REQUEST_STARTED',
  navigationStartedAt: Date.now(),
  startedAt: Date.now()
};
dom.window.SIMNET_WB.runtime.pollAttempt = gcomAttempt;
dom.window.sessionStorage.setItem('simnet_wb_poll_attempt_v1', JSON.stringify(gcomAttempt));
dom.window.document.body.innerHTML = `
  <table><tbody><tr>
    <td>Vernadsky-24-GPON (172.16.1.250) G-COM</td>
    <td><a href="/cgi-bin/adm/stat.pl?a=312&id=15874&act=askolt&olt_ip=172.16.1.250">Запрос OLT</a></td>
  </tr></tbody></table>
`;
dom.window.SIMNET_WB.pollTerminal = {
  snapshot: () => [
    {
      responseEvidence: true,
      adapter: 'gcom', family: 'mac_address', state: 'normal', relation: 'primary',
      visualPriority: 'decisive', summary: 'MAC ИЗУЧЕН · 80:AF:CA:3B:7F:5B',
      facts: { macs: ['80:AF:CA:3B:7F:5B'], vlan: 343 }
    },
    {
      responseEvidence: true,
      adapter: 'gcom', family: 'ont_port_state', state: 'normal', relation: 'primary',
      visualPriority: 'decisive', summary: 'LINK UP · 100 Мбит/с · Full-Duplex',
      facts: { linkState: 'up', speedMbps: 100, duplex: 'full' }
    }
  ]
};
const gcomParsed = dom.window.SIMNET_WB.adapters.billing.collect({
  pageInfo: { kind: 'billing_onu_poll', entityId: '15874', subview: 'a312' },
  text: 'show ont brief sn string-hex FGXP-C852C051\nONT SN Device-type Up/Down-time Status W/S\n0/3/21 FGXP-C852C051 - 2d online working\nRun state : online',
  fact: (value, sourceName, confidence) => value ? { value, source: sourceName, confidence } : null,
  normalizeMac: value => String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase(),
  validIp: value => String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '',
  compact,
  controlValue: () => '',
  activeCase: caseData
});
assert.equal(gcomParsed.meta.poll.outcome, 'confirmed');
assert.equal(gcomParsed.meta.poll.expectedPollAction, '312');
assert.equal(gcomParsed.meta.poll.wrongPollTab, false);
assert.equal(gcomParsed.meta.poll.snapshot.pollType, 'GCOM');
assert.equal(gcomParsed.meta.poll.snapshot.pollAction, '312');
assert.equal(gcomParsed.meta.poll.snapshot.observedSubscriberMac, '80:AF:CA:3B:7F:5B');
assert.equal(gcomParsed.meta.poll.snapshot.linkState, 'up');
assert.equal(gcomParsed.meta.poll.snapshot.speedMbps, 100);
assert.equal(gcomParsed.facts.pon.pollAction.value, '312');
assert.equal(gcomParsed.facts.pon.pollType.value, 'GCOM');

console.log('late_poll_response_dom_test: PASS');
