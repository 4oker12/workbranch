import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/ui/rail.js'), 'utf8');

const currentCase = {
  id: 'case-415146',
  identity: {
    login: { value: 'abon415146' },
    contract: { value: '415146' },
    customerId: { value: '98765' }
  },
  network: {
    ip: { value: '10.20.30.40' },
    mac: { value: '00:11:22:33:44:55' },
    connectionFamily: { value: 'PON' }
  },
  pon: {
    oltName: { value: 'OLT-KYIV-01' },
    onuMac: { value: 'AA:BB:CC:DD:EE:FF' },
    onuSerial: { value: '48575443AABBCCDD' },
    pollType: { value: 'GPON' }
  },
  juniper: {
    reviewStatus: 'reviewed',
    dataStatus: 'available',
    preview: false
  },
  diagnostic: {
    stage: 'ready-for-poll',
    isEthernet: false,
    technicalVisited: true,
    billingMissingTechnical: [],
    readyForOnuPoll: true,
    canAttemptOnuPoll: true,
    subtype: 'GPON'
  },
  locator: {
    sourceStatus: {
      juniper: {
        result: 'online',
        details: {
          status: 'online',
          hasTraffic: true,
          speedRaw: 'RX 1.2 / TX 0.4 Mbit/s',
          subscriberIp: '10.20.30.40',
          subscriberMac: '00:11:22:33:44:55',
          startTime: '2026-08-13 12:00:00',
          brasName: 'BRAS-1'
        }
      }
    }
  },
  currentContext: { system: 'billing', pageKind: 'billing_user' }
};

const subscriptions = [];
const WB = {
  version: '1.7.29.10',
  bus: {
    on() {
      const unsubscribe = () => {};
      subscriptions.push(unsubscribe);
      return unsubscribe;
    }
  },
  runtime: { guideActive: false, lastContext: currentCase.currentContext },
  store: {
    state: { ui: { section: 'live', open: false }, cases: {} },
    activeCase: () => currentCase,
    patchUi() {}
  },
  guide: {
    plan: () => ({
      id: 'billing.open-poll-tab',
      title: 'Открой GPON-опрос',
      text: 'Тип определён по названию OLT.',
      kind: 'highlight'
    }),
    latestPassiveDiscovery: () => null
  },
  knowledge: { resolve: () => ({ simple: '' }) },
  pollTerminal: { hasResult: () => false }
};

const windowObject = {};
windowObject.top = windowObject;
windowObject.self = windowObject;
const sandbox = {
  SIMNET_WB: WB,
  window: windowObject,
  console,
  Intl,
  Date,
  URL,
  Blob,
  setTimeout,
  clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const live = WB.rail.liveView();
for (const token of [
  'compact-identity',
  'Договор 415146',
  'Online',
  'RX 1.2 / TX 0.4 Mbit/s',
  '2026-08-13 12:00:00',
  'Готово к живому опросу',
  'Перейти к опросу ONU'
]) assert.match(live, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

for (const hiddenOnMain of [
  '10.20.30.40',
  '00:11:22:33:44:55',
  'BRAS-1'
]) assert.doesNotMatch(live, new RegExp(hiddenOnMain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

for (const obsolete of [
  'Operator Cockpit',
  'role="tablist"',
  'route-map',
  'progress-label',
  'Простыми словами:',
  'data-action="rescan"'
]) assert.doesNotMatch(live, new RegExp(obsolete.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

currentCase.locator.termination = { status: 'confirmed' };
currentCase.pon.status = { value: 'online' };
currentCase.live = {
  oltSnapshot: {
    schemaVersion: 1,
    status: 'confirmed',
    outcome: 'confirmed',
    pollAttemptId: 'poll-gcom-1',
    pollAction: '312',
    pollType: 'GCOM',
    onuStatus: 'online',
    observedSubscriberMac: '80:AF:CA:3B:7F:5B',
    learnedMacs: ['80:AF:CA:3B:7F:5B'],
    linkState: 'up',
    speedMbps: 1000,
    duplex: 'full',
    rx: '-19.2 dBm',
    tx: '2.4 dBm',
    capturedAt: '2026-08-13T14:50:00.000Z',
    historySummary: 'Power off: нет; Link changes: 0',
    evidence: []
  }
};
currentCase.currentContext = { system: 'billing', pageKind: 'billing_user' };
WB.runtime.lastContext = currentCase.currentContext;
WB.pollTerminal.hasResult = () => false;
const completed = WB.rail.liveView();
assert.match(completed, /Живой опрос ONU/);
assert.match(completed, /ONU online/);
assert.match(completed, /MAC ИЗУЧЕН · 80:AF:CA:3B:7F:5B/);
assert.match(completed, /LINK UP · 1000 Мбит\/с · Full-Duplex/);
assert.match(completed, /Power off: нет; Link changes: 0/);
assert.doesNotMatch(completed, /ONU не опрошено/);
assert.doesNotMatch(completed, /ONU Rx -19\.2 dBm/);
assert.doesNotMatch(completed, /a=312/);

assert.ok(subscriptions.length >= 7, 'rail event subscriptions initialized');
console.log('live_snapshot_unit_test: PASS');
