import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const pageWindow = {};
pageWindow.top = pageWindow;
pageWindow.self = pageWindow;
globalThis.window = pageWindow;

const juniperHref = 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?pp=test&id=22624&a=252';
globalThis.location = new URL('https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?pp=test&a=user&id=22624');
globalThis.document = {
  querySelectorAll() {
    return [{ href: juniperHref, textContent: 'Juniper (NEW)' }];
  },
  querySelector() {
    return { href: juniperHref, textContent: 'Juniper (NEW)' };
  }
};

const caseData = {
  id: 'login:abon226247',
  episodeId: 'episode-test',
  caseVersion: 2,
  routeGeneration: 3,
  identity: { login: { value: 'abon226247' }, billingId: { value: '22624' } },
  network: {},
  pon: {},
  currentContext: { system: 'billing', pageKind: 'billing_user' },
  locator: {
    recommendation: { action: 'open_technical' },
    sourceStatus: {}
  },
  juniper: { dataStatus: 'missing', updatedAt: '' }
};

const messages = [];
globalThis.chrome = {
  runtime: {
    async sendMessage(message) {
      messages.push(message);
      if (message.type === 'JUNIPER_PREFETCH_STATUS') {
        caseData.juniper.dataStatus = message.payload.status;
        caseData.juniper.requestId = message.payload.envelope.operation.requestId;
        caseData.juniper.updatedAt = new Date().toISOString();
      }
      if (message.type === 'LOCATOR_APPLY_OBSERVATION') {
        const observation = message.payload.observation;
        caseData.juniper.dataStatus = observation.result === 'error' ? 'error' : 'available';
        caseData.locator.sourceStatus.juniperPreview = {
          result: observation.result,
          details: observation.details,
          preview: true
        };
      }
      return { success: true, data: { applied: true } };
    }
  }
};

let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount += 1;
  return new Response('<html><body>Juniper Статус сесії</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};

globalThis.SIMNET_WB = {
  runtime: {
    lastContext: { system: 'billing', pageKind: 'billing_user' }
  },
  store: {
    localCaseId: caseData.id,
    activeCase() { return caseData; },
    correlation(type, operation) {
      return {
        eventId: 'pin-1',
        type,
        occurredAt: new Date().toISOString(),
        caseId: caseData.id,
        episodeId: caseData.episodeId,
        caseVersion: caseData.caseVersion,
        routeGeneration: caseData.routeGeneration,
        origin: { documentId: 'doc-1', pageKind: 'billing_user', system: 'billing' },
        operation: { requestId: operation.requestId },
        identityFingerprint: 'abon226247|226247|22624||',
        bindingFingerprint: ''
      };
    }
  },
  juniperParser: {
    version: 'test',
    parseHtml() {
      return {
        parserVersion: 'test',
        result: 'online',
        sessions: [],
        session: {
          subscriberIp: '10.8.194.30',
          subscriberMac: '1C:3B:F3:08:C3:6B',
          status: 'online',
          hasTraffic: false
        },
        summary: 'online'
      };
    }
  },
  performanceMonitor: {
    begin() { return () => {}; },
    mark() {},
    count() {}
  },
  utils: { safeUrl: value => value },
  log: { info() {}, warn() {} }
};

await import(
  pathToFileURL(new URL('../src/core/juniper-prefetch.js', import.meta.url).pathname).href
  + `?test=${Date.now()}`
);

const result = await globalThis.SIMNET_WB.juniper.maybePrefetch('unit-test');
assert.equal(result.ok, true);
assert.equal(fetchCount, 1, 'Billing card starts one immediate read');
assert.equal(caseData.juniper.dataStatus, 'available');
assert.equal(caseData.locator.sourceStatus.juniperPreview.result, 'online');
assert.deepEqual(messages.map(item => item.type), [
  'JUNIPER_PREFETCH_STATUS',
  'LOCATOR_APPLY_OBSERVATION'
]);

const duplicate = await globalThis.SIMNET_WB.juniper.maybePrefetch('unit-test-repeat');
assert.equal(duplicate.skipped, true);
assert.equal(duplicate.reason, 'already-read');
assert.equal(fetchCount, 1, 'saved snapshot prevents a duplicate GET');

delete caseData.locator.sourceStatus.juniperPreview;
caseData.juniper = {
  dataStatus: 'loading',
  updatedAt: new Date(Date.now() - 30000).toISOString()
};
const staleLease = await globalThis.SIMNET_WB.juniper.maybePrefetch('stale-loading-recovery');
assert.equal(staleLease.ok, true);
assert.equal(fetchCount, 2, 'stale loading state is retried automatically');

console.log('juniper_prefetch_unit_test: PASS');
