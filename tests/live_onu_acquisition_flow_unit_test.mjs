import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/ui/rail.js'), 'utf8');

let currentCase = {
  id: 'case-220196',
  identity: {
    login: { value: 'abon220196' },
    contract: { value: '220196' },
    billingId: { value: '867' }
  },
  network: { connectionFamily: { value: 'PON' } },
  pon: {},
  juniper: { reviewStatus: 'required', dataStatus: 'available', preview: true },
  workflow: { ponAcquisition: {} },
  diagnostic: {
    stage: 'need-technical-data',
    isPon: true,
    isEthernet: false,
    technicalVisited: false,
    billingMissingTechnical: [],
    readyForOnuPoll: false,
    canAttemptOnuPoll: false,
    subtype: 'GPON',
    locatorAction: 'open_technical'
  },
  locator: { sourceStatus: {} },
  currentContext: { system: 'billing', pageKind: 'billing_user' }
};

let plan = {
  id: 'billing.open-technical',
  title: 'Перейди в технические данные',
  text: 'Сверь технические поля.',
  kind: 'highlight'
};

const WB = {
  version: '1.7.29.13',
  bus: { on: () => () => {} },
  runtime: { guideActive: false, lastContext: currentCase.currentContext },
  store: {
    state: { ui: { section: 'live', open: false }, cases: {} },
    activeCase: () => currentCase,
    patchUi() {},
    async patchWorkflow(namespace, patch) {
      currentCase.workflow ||= {};
      currentCase.workflow[namespace] ||= {};
      Object.assign(currentCase.workflow[namespace], patch);
      return { accepted: true };
    }
  },
  guide: {
    plan: () => plan,
    latestPassiveDiscovery: () => null,
    resolvers: {},
    urls: {
      billingTechnical: caseData => `https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=${String(caseData?.identity?.billingId?.value || caseData?.identity?.billingId || '867')}&tmpl=1`
    }
  },
  handoff: {
    async focusSource() { return { focused: true, navigated: true, sourceTabId: 17 }; }
  },
  billingNavigation: {
    async navigate(options) {
      WB.__lastBillingNavigation = options;
      return { ok: true, method: 'focus-source-tab', navigated: true, expectedPageKind: 'billing_technical' };
    },
    resolveSession() { return { ok: false }; }
  },
  knowledge: { resolve: () => ({ simple: '' }) },
  pollTerminal: { hasResult: () => false }
};

const windowObject = {};
windowObject.top = windowObject;
windowObject.self = windowObject;
windowObject.setTimeout = setTimeout;
windowObject.clearTimeout = clearTimeout;
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

const render = () => WB.rail.liveView();

// 1. The yellow block is only the stable ONU acquisition state. Navigation is
// a separate one-click card; no intermediate "Подсветить" action is exposed.
let html = render();
assert.doesNotMatch(html, /ONU не опрошено/);
assert.match(html, /Перейти в технические данные/);
assert.match(html, /data-action="live-open-technical"/);
assert.match(html, /live-nav-help/);
assert.doesNotMatch(html, /data-action="guide-next"/);

// 2. Once Technical has actually been visited, only real missing required fields
// are shown and the next direct action is TMC.
currentCase.diagnostic.technicalVisited = true;
currentCase.diagnostic.billingMissingTechnical = ['olt', 'onuSerial', 'onuMac'];
currentCase.diagnostic.locatorAction = 'check_tmc';
currentCase.currentContext = { system: 'billing', pageKind: 'billing_technical' };
WB.runtime.lastContext = currentCase.currentContext;
plan = { id: 'billing.return-for-userside', title: 'Вернись', text: '', kind: 'navigate' };
html = render();
assert.doesNotMatch(html, /ONU не опрошено/);
assert.match(html, /Перейти в ТМЦ/);
assert.match(html, /data-action="live-go-tmc"/);

// 3. Passive TMC parsing must not skip the explicit human-visible "Показать ТМЦ"
// stage. On the fully loaded UserSide card the operator chooses when to reveal it.
currentCase.locator.sourceStatus.tmc = { result: 'found' };
currentCase.pon.tmcOltName = { value: 'GPON-SW-17' };
currentCase.pon.tmcOnuSerial = { value: '48575443C7F2' };
currentCase.pon.tmcOnuMac = { value: '00:1B:9E:12:34:56' };
currentCase.currentContext = { system: 'userside', pageKind: 'userside_customer' };
WB.runtime.lastContext = currentCase.currentContext;
plan = { id: 'userside.inspect-tmc:test', title: 'Сверь ТМЦ', text: '', kind: 'highlight' };
html = render();
assert.match(html, /Показать ТМЦ/);
assert.match(html, /data-action="live-show-tmc"/);
assert.doesNotMatch(html, /Обновить технические данные/);

// 4. If TMC was explicitly shown and the locator detects an identity conflict,
// LIVE uses the resolved TMC values for an explicit Billing prefill action.
currentCase.workflow.ponAcquisition.tmcShownAt = '2026-08-14T07:00:00.000Z';
currentCase.pon.onuSerial = { value: 'FGXPC871E2B0' };
currentCase.pon.tmcOnuSerial = { value: 'FGXPC871E2B1' };
currentCase.pon.onuMac = { value: '4C:D7:C8:71:E2:B0' };
currentCase.pon.tmcOnuMac = { value: '4C:D7:C8:71:E2:B0' };
currentCase.diagnostic.locatorAction = 'fill_billing_technical';
currentCase.locator.recommendation = {
  action: 'fill_billing_technical',
  params: {
    source: 'tmc',
    fields: ['onuSerial', 'olt'],
    conflicts: [{ field: 'onuSerial' }],
    expectedTechnical: {
      oltName: 'GPON-SW-17',
      onuSerial: 'FGXPC871E2B1',
      onuMac: '4C:D7:C8:71:E2:B0'
    }
  }
};
currentCase = JSON.parse(JSON.stringify(currentCase));
WB.runtime.lastContext = currentCase.currentContext;
html = render();
assert.match(html, /Есть расхождение Billing ↔ ТМЦ/);
assert.match(html, /Заполнить техданные/);
assert.match(html, /data-action="live-apply-tmc"/);
assert.doesNotMatch(html, /live-search-mac/);
assert.doesNotMatch(html, /Обновить технические данные/);

// 5. Without a conflict, the same explicit TMC -> Billing prefill route remains.
currentCase.diagnostic.locatorAction = 'check_tmc';
currentCase.locator.recommendation.params.conflicts = [];
html = render();
assert.match(html, /Данные найдены в ТМЦ/);
assert.match(html, /data-action="live-apply-tmc"/);
assert.doesNotMatch(html, /Показать ТМЦ/);

// 5b. Screenshot case: Billing lacks only OLT while TMC already has the exact
// OLT binding. LIVE must say where the gap is and offer one unambiguous prefill.
currentCase.diagnostic.billingMissingTechnical = ['olt'];
currentCase.locator.recommendation.params.fields = ['olt'];
currentCase.locator.recommendation.params.expectedTechnical = {
  oltName: 'Huawei MA5800-X15',
  oltIp: '172.16.1.50'
};
currentCase.pon.tmcOltName = { value: 'Huawei MA5800-X15' };
currentCase.pon.tmcOltIp = { value: '172.16.1.50' };
// This TMC fixture really contains only OLT. Old recommendation/cache values
// must not manufacture Serial/MAC obligations that are absent in current TMC.
currentCase.pon.tmcOnuSerial = { value: '' };
currentCase.pon.tmcOnuMac = { value: '' };
html = render();
assert.match(html, /OLT найден в ТМЦ/);
assert.match(html, /Huawei MA5800-X15 · 172\.16\.1\.50/);
assert.match(html, /Заполнить OLT/);
assert.match(html, /Сначала откроем Billing → Технические данные/);
assert.match(html, /Только после загрузки формы Workbench подставит: OLT/);

// 5c. The explicit UserSide action is a real two-stage bridge. The transaction
// scope comes ONLY from current TMC payload, not from Billing's absolute missing
// list and not from a stale recommendation. Here Billing misses 3 fields but TMC
// actually has only OLT + Serial, so ONU MAC must be outside the transaction.
currentCase.diagnostic.billingMissingTechnical = ['olt', 'onuSerial', 'onuMac'];
currentCase.pon.tmcOnuSerial = { value: 'FGXPC871E2B1' };
currentCase.pon.tmcOnuMac = { value: '' };
currentCase.locator.recommendation.params.fields = ['olt'];
currentCase.locator.recommendation.params.conflicts = [];
currentCase.locator.recommendation.params.expectedTechnical = {
  oltName: 'Huawei MA5800-X15',
  oltIp: '172.16.1.50',
  onuSerial: 'FGXPC871E2B1',
  // Deliberately stale: current TMC fact above is empty and must win.
  onuMac: '4C:D7:C8:71:E2:B0'
};
WB.__lastBillingNavigation = null;
const bridgeResult = await WB.rail.requestTmcWriteback();
assert.equal(bridgeResult.ok, true);
assert.equal(bridgeResult.method, 'focus-source-tab');
assert.equal(WB.__lastBillingNavigation?.caseId, currentCase.id);
assert.equal(WB.__lastBillingNavigation?.semanticTargetId, 'billing.technical');
assert.equal(WB.__lastBillingNavigation?.entityId, '867');
assert.deepEqual(
  [...currentCase.workflow.ponAcquisition.tmcExpectedFields].sort(),
  ['olt', 'onuSerial'].sort(),
  'only fields actually present in current TMC are obligations'
);
assert.deepEqual(
  [...currentCase.workflow.ponAcquisition.tmcWritebackFields].sort(),
  ['olt', 'onuSerial'].sort(),
  'absent TMC ONU MAC must not be queued even when Billing reports it missing'
);
assert.equal(currentCase.workflow.ponAcquisition.tmcWritebackMode, 'missing-only');

// Restore the broader writeback fixture for the remaining checks.
currentCase.diagnostic.billingMissingTechnical = ['onuSerial', 'olt'];
currentCase.locator.recommendation.params.fields = ['onuSerial', 'olt'];
currentCase.locator.recommendation.params.expectedTechnical = {
  oltName: 'GPON-SW-17',
  onuSerial: 'FGXPC871E2B1',
  onuMac: '4C:D7:C8:71:E2:B0'
};
currentCase.pon.tmcOltName = { value: 'GPON-SW-17' };
currentCase.pon.tmcOltIp = { value: '' };
currentCase.pon.tmcOnuSerial = { value: 'FGXPC871E2B1' };
currentCase.pon.tmcOnuMac = { value: '4C:D7:C8:71:E2:B0' };

// 6. Back on Technical: prefill status, no navigation loop and no auto-save.
currentCase.currentContext = { system: 'billing', pageKind: 'billing_technical' };
WB.runtime.lastContext = currentCase.currentContext;
html = render();
assert.match(html, /Подставляем данные ТМЦ/);
assert.doesNotMatch(html, /data-action="live-return-technical"/);

// 7. Once TMC has been explicitly shown, a still-empty Billing field is
// filled automatically from the resolved TMC value. The operator still owns Save.
let autoPrefillFields = null;
let autoScanCount = 0;
WB.runtime.forceScan = () => { autoScanCount += 1; };
WB.guide.resolvers.applyMissingTmcTechnicalValues = (_caseData, fields) => {
  autoPrefillFields = [...fields];
  return {
    ok: true,
    status: 'applied',
    fields: [...fields],
    completed: [...fields],
    unresolved: [],
    expected: { onuSerial: 'FGXPC871E2B1', oltName: '', oltIp: '', onuMac: '' }
  };
};
WB.rail.toast = () => {};
WB.rail.render = () => {};
currentCase.diagnostic.billingMissingTechnical = ['onuSerial'];
// Auto-prefill fixture: TMC actually exposes only Serial. Global Billing may
// miss anything else; absent TMC values must not be requested by this pass.
currentCase.pon.tmcOltName = { value: '' };
currentCase.pon.tmcOltIp = { value: '' };
currentCase.pon.tmcOnuSerial = { value: 'FGXPC871E2B1' };
currentCase.pon.tmcOnuMac = { value: '' };
currentCase.workflow.ponAcquisition.tmcWritebackPending = false;
currentCase.workflow.ponAcquisition.tmcWritebackPendingSave = false;
currentCase.workflow.ponAcquisition.technicalWritebackVerified = false;
currentCase.workflow.ponAcquisition.instructionAcknowledged = false;
WB.rail.tmcAutoPrefillKey = '';
const autoPrefill = await WB.rail.maybeAutoPrefillMissingTmcTechnical(
  currentCase,
  currentCase.diagnostic,
  ['onuSerial']
);
assert.equal(autoPrefill.ok, true);
assert.deepEqual(autoPrefillFields, ['onuSerial']);
assert.equal(currentCase.workflow.ponAcquisition.tmcWritebackPendingSave, true);
assert.deepEqual([...currentCase.workflow.ponAcquisition.tmcExpectedFields], ['onuSerial']);
assert.deepEqual([...currentCase.workflow.ponAcquisition.tmcWritebackFields], ['onuSerial']);
assert.equal(currentCase.workflow.ponAcquisition.instructionAcknowledged, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(autoScanCount, 1);
assert.doesNotMatch(source, /Нужно обновить технические данные/, 'large in-table writeback banner must stay removed');

// 8. Prefill is NOT persistence: even a stale/optimistic diagnostic readiness flag
// must not expose poll navigation while native Billing Save is still pending.
currentCase.diagnostic.billingMissingTechnical = [];
currentCase.diagnostic.readyForOnuPoll = true;
currentCase.diagnostic.canAttemptOnuPoll = true;
currentCase.diagnostic.locatorAction = 'poll_current_binding';
currentCase.diagnostic.technicalVisited = true;
currentCase.workflow.ponAcquisition.technicalWritebackVerified = true;
currentCase.pon.pollType = { value: 'GPON' };
plan = { id: 'billing.return-card-for-poll', title: 'Вернись на карточку', text: '', kind: 'navigate' };
html = render();
assert.match(html, /Данные подставлены/);
assert.doesNotMatch(html, /Готово к живому опросу/);
assert.doesNotMatch(html, /data-action="live-open-poll"/);
assert.doesNotMatch(html, /Перейти к опросу ONU/);

// 8b. Only after post-save persistence has cleared the pending-save flag may
// the existing one-click poll navigation appear.
currentCase.workflow.ponAcquisition.tmcWritebackPendingSave = false;
currentCase.workflow.ponAcquisition.tmcWritebackPending = false;
html = render();
assert.doesNotMatch(html, /ONU не опрошено/);
assert.match(html, /Готово к живому опросу/);
assert.match(html, /data-action="live-open-poll"/);
assert.match(html, /Перейти к опросу ONU/);

// 9. On the native Billing poll page, Workbench stops duplicating Billing.
// The final UI points at the native «Запрос OLT» and exposes no second CTA/help marker.
currentCase.currentContext = { system: 'billing', pageKind: 'billing_onu_poll' };
WB.runtime.lastContext = currentCase.currentContext;
plan = { id: 'billing.ask-olt', title: 'Запусти запрос OLT', text: '', kind: 'highlight' };
html = render();
assert.doesNotMatch(html, /ONU не опрошено/);
assert.match(html, /Финальный шаг · Запрос OLT/);
assert.match(html, /Workbench только выделяет нужную ссылку/);
assert.doesNotMatch(html, /Готово к живому опросу/);
assert.doesNotMatch(html, /data-action="live-open-poll"/);
assert.doesNotMatch(html, /Перейти к опросу ONU/);
assert.doesNotMatch(html, /live-nav-help/);

// 10. Once the native request is already pending, pre-poll UI disappears.
// One current visual state remains: the request is running; repeat click is unnecessary.
currentCase.operations = {
  poll: {
    current: {
      caseId: currentCase.id,
      stage: 'REQUEST_STARTED',
      pending: true
    }
  }
};
html = render();
assert.match(html, /OLT · запрос выполняется/);
assert.match(html, /Запрос OLT отправляется…/);
assert.match(html, /Повторный клик не нужен/);
assert.doesNotMatch(html, /ONU не опрошено/);
assert.doesNotMatch(html, /Финальный шаг · Запрос OLT/);
assert.doesNotMatch(html, /Готово к живому опросу/);
assert.doesNotMatch(html, /data-action="live-open-poll"/);

// 11. Only an actual confirmed live response replaces acquisition state with facts.
currentCase.operations = {};
currentCase.locator.termination = { status: 'confirmed' };
currentCase.live = {
  oltSnapshot: {
    status: 'confirmed',
    onuStatus: 'online',
    observedSubscriberMac: '80:AF:CA:3B:7F:5B',
    linkState: 'up',
    speedMbps: 1000,
    duplex: 'full',
    historySummary: 'Power off: нет',
    capturedAt: '2026-08-14T06:20:00.000Z',
    evidence: []
  }
};
html = render();
assert.doesNotMatch(html, /pon-live-goal/);
assert.match(html, /Живой опрос ONU/);
assert.match(html, /ONU online/);
assert.match(html, /1000 Мбит\/с/);
assert.match(html, /Power off: нет/);

console.log('live_onu_acquisition_flow_unit_test: PASS');
