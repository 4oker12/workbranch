import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const evidenceSource = read('src/core/evidence-navigator.js');
const railSource = read('src/ui/rail.js');

const fact = value => ({ value });
let currentCase = {
  id: 'login:abon478864',
  identity: { login: fact('abon478864'), contract: fact('478864'), billingId: fact('47886') },
  network: { connectionFamily: fact('PON') },
  pon: {},
  contexts: {},
  diagnostic: {
    isPon: true,
    isEthernet: false,
    technicalVisited: false,
    billingMissingTechnical: [],
    readyForOnuPoll: false,
    canAttemptOnuPoll: false,
    locatorAction: 'open_technical',
    stage: 'need-technical-data'
  },
  locator: { sourceStatus: {}, evidence: [] },
  operations: { poll: { current: null, history: [] } },
  workflow: { ponAcquisition: {} },
  route: { guide: { completed: {} } },
  currentContext: { system: 'billing', pageKind: 'billing_user' },
  juniper: { reviewStatus: 'required' }
};
let plan = { id: 'billing.open-technical', title: 'Перейти в технические данные', text: 'Сверить поля', kind: 'highlight' };
const WB = {
  version: '1.7.29.28',
  runtime: { guideActive: false, lastContext: currentCase.currentContext },
  bus: { on: () => () => {} },
  store: { state: { ui: { section: 'live', open: false }, cases: {} }, activeCase: () => currentCase, patchUi() {} },
  guide: { plan: () => plan, latestPassiveDiscovery: () => null },
  knowledge: { resolve: () => ({ simple: '' }) },
  pollTerminal: { hasResult: () => false }
};
const windowObject = { addEventListener() {}, dispatchEvent() {} };
windowObject.top = windowObject;
windowObject.self = windowObject;
windowObject.setTimeout = setTimeout;
windowObject.clearTimeout = clearTimeout;
const sandbox = {
  globalThis: { SIMNET_WB: WB },
  SIMNET_WB: WB,
  window: windowObject,
  console, Intl, Date, URL, Blob, setTimeout, clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(evidenceSource, sandbox);
vm.runInContext(railSource, sandbox);

const render = () => WB.rail.liveView();

// Start: no empty checklist; exactly the current useful CTA is visible.
let html = render();
assert.match(html, /Договор 478864/);
assert.match(html, /Перейти в технические данные/);
assert.doesNotMatch(html, /Не выполнено|ONU не опрошено|ТМЦ\s*·\s*не/i);
assert.doesNotMatch(html, /Что уже сделано/);

// Operator manually visits Technical: history appears from evidence/context,
// even though the Workbench CTA itself was never clicked.
currentCase.contexts.tech = { pageKind: 'billing_technical', observedAt: '2026-08-16T10:00:00Z' };
currentCase.diagnostic.technicalVisited = true;
currentCase.diagnostic.billingMissingTechnical = ['olt'];
currentCase.diagnostic.locatorAction = 'check_tmc';
currentCase.currentContext = { system: 'billing', pageKind: 'billing_technical' };
WB.runtime.lastContext = currentCase.currentContext;
plan = { id: 'billing.return-for-userside', title: 'Перейти в ТМЦ', text: 'Сверить ТМЦ', kind: 'navigate' };
html = render();
assert.match(html, /Что уже сделано/);
assert.match(html, /Техданные/);
assert.match(html, /data-evidence-key="technical"/);
assert.doesNotMatch(html, /data-action="live-open-technical"/);

// Passive TMC parsing on UserSide must not create a completed TMC history row.
currentCase = {
  ...currentCase,
  contexts: { us: { pageKind: 'userside_customer', observedAt: '2026-08-16T10:02:00Z' } },
  diagnostic: { ...currentCase.diagnostic, technicalVisited: false },
  locator: {
    sourceStatus: { tmc: { result: 'found' } },
    evidence: [{ type: 'TMC_RESULT', result: 'found', at: '2026-08-16T10:02:01Z', details: { identityCheck: { isMatch: true } } }]
  },
  workflow: { ...(currentCase.workflow || {}), ponAcquisition: {} },
  currentContext: { system: 'userside', pageKind: 'userside_customer' }
};
WB.runtime.lastContext = currentCase.currentContext;
plan = { id: 'userside.find-tmc', title: 'Показать ТМЦ', text: '', kind: 'highlight' };
html = render();
assert.doesNotMatch(html, /data-evidence-key="tmc"/);
assert.doesNotMatch(html, /data-evidence-key="technical"/);

// The row appears only after the Workbench teleport reached/focused TMC.
currentCase.workflow.ponAcquisition.tmcShownAt = '2026-08-16T10:02:03Z';
plan = { id: 'billing.open-poll-tab', title: 'Перейти к опросу ONU', text: '', kind: 'highlight' };
html = render();
assert.match(html, /ТМЦ/);
assert.match(html, /data-evidence-key="tmc"/);
assert.doesNotMatch(html, /data-evidence-key="technical"/);

// A direct completed poll shows only Poll in history and suppresses repeated Poll CTA.
currentCase = {
  ...currentCase,
  contexts: {},
  diagnostic: { ...currentCase.diagnostic, technicalVisited: false, readyForOnuPoll: true, canAttemptOnuPoll: true, billingMissingTechnical: [] },
  locator: {
    sourceStatus: {},
    evidence: [{ type: 'POLL_RESULT', result: 'not_found', at: '2026-08-16T10:05:00Z' }]
  },
  workflow: { ...(currentCase.workflow || {}), ponAcquisition: {} },
  currentContext: { system: 'billing', pageKind: 'billing_user' }
};
WB.runtime.lastContext = currentCase.currentContext;
html = render();
assert.match(html, /Опрос ONU/);
assert.match(html, /ONU не найдена/);
assert.match(html, /data-evidence-key="poll"/);
assert.doesNotMatch(html, /data-evidence-key="technical"|data-evidence-key="tmc"/);
assert.doesNotMatch(html, /data-action="live-open-poll"/);

// Automatic Juniper evidence appears immediately as one compact row without
// implying operatorOpened. Manual opening later still stays one row.
currentCase = {
  ...currentCase,
  locator: { sourceStatus: { juniperPreview: { result: 'online', details: { status: 'online', preview: true } } }, evidence: [] },
  juniper: {
    dataStatus: 'available', result: 'online', readAt: '2026-08-16T10:01:00Z', readSource: 'automatic', operatorOpened: false,
    evidence: { read: { kind: 'JUNIPER_READ', at: '2026-08-16T10:01:00Z', source: 'automatic', result: 'online' }, opened: null, verified: { kind: 'JUNIPER_VERIFIED', at: '2026-08-16T10:01:00Z' } }
  },
  currentContext: { system: 'billing', pageKind: 'billing_user' }
};
WB.runtime.lastContext = currentCase.currentContext;
plan = { id: 'billing.open-technical', title: 'Перейти в технические данные', text: '', kind: 'highlight' };
html = render();
assert.match(html, /Juniper/);
assert.match(html, /Online/);
assert.equal((html.match(/data-evidence-key="juniper"/g) || []).length, 1);
currentCase.juniper.operatorOpened = true;
currentCase.juniper.openedAt = '2026-08-16T10:04:00Z';
currentCase.juniper.evidence.opened = { kind: 'JUNIPER_OPENED', at: '2026-08-16T10:04:00Z', source: 'operator' };
html = render();
assert.equal((html.match(/data-evidence-key="juniper"/g) || []).length, 1, 'manual open must not duplicate LIVE row');

console.log('live_evidence_history_unit_test: PASS');
