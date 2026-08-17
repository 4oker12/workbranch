import assert from 'node:assert/strict';
import {
  LocatorObservationType,
  LocatorAction,
  ensureLocatorShape,
  applyLocatorObservations,
  evaluateLocatorPolicy,
  __test
} from '../src/core/locator-policy.js';

const fact = value => ({ value, confidence: 0.98 });

function makeCase({ tmcShown = false } = {}) {
  const caseData = {
    id: 'login:abon212163',
    identity: {
      login: fact('abon212163'),
      billingId: fact('21216')
    },
    network: {
      connectionFamily: fact('PON'),
      ip: fact('10.8.2.4'),
      mac: fact('08:55:31:2D:C4:50')
    },
    pon: {
      oltName: fact('Sim36-OLT-Huawei Huawei'),
      oltIp: fact('172.16.1.50'),
      onuMac: fact('D4:25:CC:1B:48:64'),
      // Deliberately no Serial: this is the real source-limited TMC shape.
      pollType: fact('Huawei'),
      pollAction: fact('313'),
      tmcOnuMac: fact('D4:25:CC:1B:48:64'),
      tmcOltName: fact('Huawei MA5800-X15'),
      tmcOltIp: fact('172.16.1.50'),
      tmcPort: fact('EPON 0/12/7:13')
    },
    workflow: {
      ponAcquisition: {
        tmcShownAt: tmcShown ? '2026-08-17T03:36:59.151Z' : ''
      }
    },
    contexts: {
      technical: { pageKind: 'billing_technical' },
      userside: { pageKind: 'userside_customer' }
    }
  };
  ensureLocatorShape(caseData);
  caseData.locator.sourceStatus.juniper = { result: 'online', details: { status: 'online' } };
  return caseData;
}

// Vendor is authoritative for the Billing poll adapter; EPON remains only an
// access/interface description in this combination.
const vendorRoute = __test.technologyFromEvidence(
  'Huawei MA5800-X15',
  'EPON 0/12/7:13',
  'EPON'
);
assert.equal(vendorRoute.type, 'Huawei');
assert.equal(vendorRoute.action, '313');
assert.equal(vendorRoute.derivedBy, 'olt-vendor');

// Before the actual TMC teleport milestone, the old conservative requirement
// remains in force: passive/background TMC parsing must not silently waive Serial.
const beforeVisit = makeCase({ tmcShown: false });
applyLocatorObservations(beforeVisit, [{
  type: LocatorObservationType.TMC_RESULT,
  result: 'found',
  method: 'userside_tmc',
  source: 'userside',
  details: {
    oltName: 'Huawei MA5800-X15',
    oltIp: '172.16.1.50',
    interface: 'EPON 0/12/7:13',
    onuMac: 'D4:25:CC:1B:48:64',
    onuSerial: '',
    technology: 'Huawei',
    pollAction: '313',
    matchedCurrentSubscriber: true
  }
}], { system: 'userside', pageKind: 'userside_customer' });
let technical = __test.billingTechnicalState(beforeVisit, beforeVisit.locator);
assert.ok(technical.requiredFields.includes('onuSerial'), 'passive TMC evidence must not waive Serial before TMC is actually shown');

// After the semantic TMC visit, the TMC payload defines its own field scope.
// OLT + ONU MAC with no Serial means Serial is not an obligation for this route.
beforeVisit.workflow.ponAcquisition.tmcShownAt = '2026-08-17T03:36:59.151Z';
technical = __test.billingTechnicalState(beforeVisit, beforeVisit.locator);
assert.deepEqual(technical.requiredFields, ['olt', 'onuMac']);
assert.equal(technical.missingBilling.includes('onuSerial'), false);
assert.equal(technical.remainingAfterTmc.includes('onuSerial'), false);
assert.equal(technical.technology.action, '313');

const rec = evaluateLocatorPolicy(beforeVisit);
assert.ok(
  [LocatorAction.POLL_CURRENT_BINDING, LocatorAction.POLL_CANDIDATE].includes(rec.action),
  `source-limited Huawei binding should advance to poll, got ${rec.action}`
);

console.log('tmc_source_limited_poll_contract_unit_test: PASS');
