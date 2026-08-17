import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const jsdomModule = process.env.SIMNET_JSDOM_MODULE;
if (!jsdomModule) {
  throw new Error('SIMNET_JSDOM_MODULE must point to jsdom/lib/api.js');
}

const { JSDOM } = await import(pathToFileURL(jsdomModule).href);
const guideSource = fs.readFileSync(
  new URL('../src/ui/guide.js', import.meta.url),
  'utf8'
);

const dom = new JSDOM(`<!doctype html><html><body>
  <div class="table_block" id="mac-result-block">
    <div class="table_data">
      <div class="item">
        <div>10.08.2026 11:46</div>
        <div>
          <a href="/device/47043">BDCOM OLT P3600-16E #12</a>
          <a href="/device/47043/interface_mac_list?if_index=52">epon0/6:8</a>
          VLAN 254
        </div>
      </div>
    </div>
  </div>
</body></html>`, {
  url: 'https://userside.simnet.kiev.ua/customer_list/search_page?search=6C%3AAB%3A05%3A02%3AC3%3A80&find_typer=machistory',
  runScripts: 'outside-only'
});

dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.requestAnimationFrame = callback => dom.window.setTimeout(callback, 0);
dom.window.Element.prototype.getBoundingClientRect = function getRect() {
  if (this.id === 'mac-result-block') {
    return { left: 100, top: 100, right: 600, bottom: 140, width: 500, height: 40 };
  }
  return { left: 210, top: 110, right: 230, bottom: 130, width: 20, height: 20 };
};

const listeners = new Map();
let currentPageKind = 'userside_customer_list';
let currentSystem = 'userside';
let caseData = {
  identity: { customerId: { value: '30655' } },
  network: { mac: { value: '6C:AB:05:02:C3:80' } },
  pon: {},
  route: { guide: { completed: {}, steps: {}, active: null } },
  locator: {
    sourceStatus: {
      mac_direct: { result: 'candidate_found' }
    },
    recommendation: {
      action: 'inspect_device',
      reason: 'MAC найден; проверь найденную точку.',
      params: {
        candidate: {
          deviceId: '47043',
          oltName: 'BDCOM OLT P3600-16E #12',
          oltIp: '',
          interface: 'epon0/6:8',
          vlan: '254'
        }
      }
    },
    candidates: []
  },
  diagnostic: {}
};

dom.window.SIMNET_WB = {
  runtime: { forceScan() {} },
  log: { info() {}, warn() {}, error() {} },
  bus: {
    on(type, handler) {
      const bucket = listeners.get(type) || [];
      bucket.push(handler);
      listeners.set(type, bucket);
      return () => {};
    },
    emit(type, payload) {
      for (const handler of listeners.get(type) || []) handler(payload);
    }
  },
  contextEngine: {
    detectSystem() { return currentSystem; },
    detectPageKind() {
      return { kind: currentPageKind, entityId: '30655', subview: '' };
    }
  },
  store: {
    activeCase() { return caseData; },
    async markGuideHint() { return null; },
    async markGuideAction() { return null; },
    async markGuideStep() { return null; }
  },
  knowledge: { resolve() { return null; } },
  handoff: {
    async focusSource() { return { focused: false }; },
    isUsersideHandoffLink() { return false; }
  },
  pollTerminal: { hasResult() { return false; } },
  interactionGuards: { async waitForUiReady() { return true; } }
};

dom.window.eval(guideSource);
const guide = dom.window.SIMNET_WB.guide;
assert.ok(guide, 'Guide should load in the browser DOM');

let shown = await guide.highlight(caseData);
assert.equal(shown.ok, true);
assert.ok(dom.window.document.getElementById('simnet-workbench-guide-overlay'));
assert.ok(
  parseFloat(dom.window.document.querySelector('#simnet-workbench-guide-overlay .ring').style.width) > 400,
  'the cutout should cover the whole UserSide table_block, not the small link'
);
assert.equal(
  dom.window.document.querySelector('#simnet-workbench-guide-overlay .tip-action').textContent,
  'Открыть OLT и посмотреть IP'
);

caseData.locator.recommendation = {
  action: 'fill_billing_technical',
  reason: 'background recommendation changed',
  params: { fields: ['olt'] }
};
dom.window.SIMNET_WB.bus.emit('store:state', {});
assert.ok(
  dom.window.document.getElementById('simnet-workbench-guide-overlay'),
  'background Locator state must not close a visible MAC/OLT evidence hint'
);
dom.window.SIMNET_WB.bus.emit('context:changed', {});
assert.ok(
  dom.window.document.getElementById('simnet-workbench-guide-overlay'),
  'same-page context refresh must not close a connected evidence target'
);
guide.clear();

caseData.locator.recommendation = {
  action: 'inspect_device',
  reason: 'IP is already known',
  params: {
    candidate: {
      deviceId: '47043',
      oltName: 'BDCOM OLT P3600-16E #12',
      oltIp: '172.16.1.239',
      interface: 'epon0/6:8'
    }
  }
};
shown = await guide.highlight(caseData);
assert.equal(shown.ok, true);
assert.equal(
  dom.window.document.querySelector('#simnet-workbench-guide-overlay .tip-action').textContent,
  'Вернуться к абоненту'
);
guide.clear();

currentPageKind = 'billing_technical';
currentSystem = 'billing';
dom.reconfigure({
  url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=24324&tmpl=1'
});
dom.window.document.body.innerHTML = `
  <form><table>
    <tr><td>Тип подключения абонента</td><td><input value="PON EPON"></td></tr>
    <tr><td>Мак-адрес абонента</td><td><input value="6C:AB:05:02:C3:80"></td></tr>
    <tr><td>OLT</td><td><select name="dopfield_29"><option selected>CH-Borschagivska-28A-EPON (172.16.1.239)</option></select></td></tr>
    <tr><td>EPON ONU Мак-адрес</td><td><input name="dopfield_19" value="80:07:1B:B5:DB:68"></td></tr>
    <tr><td>GPON ONT Серийный ID</td><td><input name="dopfield_38" value=""></td></tr>
  </table></form>
`;
caseData = {
  identity: { billingId: { value: '24324' } },
  network: {
    connectionFamily: { value: 'PON' },
    connectionRaw: { value: 'PON EPON' },
    mac: { value: '6C:AB:05:02:C3:80' }
  },
  pon: {
    oltName: { value: 'CH-Borschagivska-28A-EPON' },
    oltIp: { value: '172.16.1.239' },
    onuMac: { value: '80:07:1B:B5:DB:68' },
    onuSerial: { value: '' },
    pollType: { value: 'EPON' }
  },
  route: { guide: { completed: {}, steps: {}, active: null } },
  locator: {
    sourceStatus: {},
    recommendation: {
      action: 'poll_current_binding',
      reason: 'current binding is ready',
      params: {}
    }
  },
  diagnostic: { technicalVisited: true }
};

const technicalPlan = guide.plan(caseData);
assert.ok(technicalPlan.id.startsWith('billing.inspect-technical:'));
assert.equal(technicalPlan.fieldSummary.length, 5);
assert.equal(
  technicalPlan.fieldSummary.find(field => field.field === 'onuMac').status,
  'ok'
);
assert.equal(
  technicalPlan.fieldSummary.find(field => field.field === 'onuSerial').status,
  'optional',
  'GPON serial must not be reported as a blocking omission for an EPON route'
);

// Explicit TMC -> Billing prefill updates native controls, including Selectize's
// backing select, but never submits the form automatically.
const oltSelect = dom.window.document.querySelector('select[name="dopfield_29"]');
oltSelect.innerHTML = `
  <option value="old" selected>CH-Borschagivska-28A-EPON (172.16.1.239)</option>
  <option value="tmc">GPON-SW-17 Huawei (172.16.9.17)</option>
`;
caseData.pon.tmcOltName = { value: 'GPON-SW-17 Huawei' };
caseData.pon.tmcOltIp = { value: '172.16.9.17' };
caseData.pon.tmcOnuSerial = { value: '48575443C7F2' };
caseData.pon.tmcOnuMac = { value: '4C:D7:C8:71:E2:B0' };
caseData.locator.recommendation = {
  action: 'fill_billing_technical',
  reason: 'Use resolved TMC evidence',
  params: {
    source: 'tmc',
    fields: ['olt', 'onuSerial', 'onuMac'],
    candidate: { oltName: 'GPON-SW-17 Huawei', oltIp: '172.16.9.17' },
    expectedTechnical: {
      oltName: 'GPON-SW-17 Huawei',
      oltIp: '172.16.9.17',
      onuSerial: '48575443C7F2',
      onuMac: '4C:D7:C8:71:E2:B0'
    }
  }
};
let submitted = false;
dom.window.document.querySelector('form').addEventListener('submit', event => {
  submitted = true;
  event.preventDefault();
});
const prefill = guide.resolvers.applyTmcTechnicalValues(caseData, ['olt', 'onuSerial', 'onuMac']);
assert.equal(prefill.ok, true);
assert.equal(prefill.status, 'applied');
assert.equal(oltSelect.value, 'tmc');
assert.equal(dom.window.document.querySelector('input[name="dopfield_38"]').value, '48575443C7F2');
assert.equal(dom.window.document.querySelector('input[name="dopfield_19"]').value, '4C:D7:C8:71:E2:B0');
assert.equal(submitted, false, 'prefill must leave native Save under operator control');

// Automatic prefill is missing-only: an operator-entered value must never be overwritten.
const serialControl = dom.window.document.querySelector('input[name="dopfield_38"]');
serialControl.value = 'OPERATOR123';
const safeExisting = guide.resolvers.applyMissingTmcTechnicalValues(caseData, ['onuSerial']);
assert.equal(safeExisting.status, 'already_present');
assert.equal(serialControl.value, 'OPERATOR123');
assert.deepEqual(safeExisting.skippedExisting, ['onuSerial']);
serialControl.value = '';
const safeMissing = guide.resolvers.applyMissingTmcTechnicalValues(caseData, ['onuSerial']);
assert.equal(safeMissing.ok, true);
assert.equal(serialControl.value, '48575443C7F2');
assert.equal(submitted, false, 'automatic missing-only prefill must never submit Billing');

guide.refreshEvidenceTrail(caseData);
assert.equal(
  dom.window.document.querySelectorAll('[data-simnet-wb-trace]').length,
  0,
  'diagnostic trail must stay hidden while the route is still active'
);

caseData.locator.termination = { status: 'confirmed' };
caseData.diagnostic.completion = 100;
caseData.route.guide.completed[technicalPlan.id] = {
  at: new Date().toISOString(),
  details: {
    fields: technicalPlan.fieldSummary.map(field => ({
      field: field.field,
      status: field.status,
      value: field.value
    }))
  }
};
guide.refreshEvidenceTrail(caseData);
assert.equal(
  dom.window.document.querySelectorAll('[data-simnet-wb-trace]').length,
  5,
  'only after route completion should reviewed technical fields leave a quiet trace'
);

const completedPlan = guide.plan(caseData);
assert.equal(completedPlan.id, 'result.confirmed');
assert.equal(completedPlan.kind, 'none');
assert.doesNotMatch(completedPlan.text, /Juniper|техническ|UserSide/i);

console.log('guide_evidence_dom_integration_test: PASS');
