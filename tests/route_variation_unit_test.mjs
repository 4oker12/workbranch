import assert from 'node:assert/strict';
import {
  LocatorObservationType,
  LocatorAction,
  ensureLocatorShape,
  applyLocatorObservations,
  evaluateLocatorPolicy
} from '../src/core/locator-policy.js';

const fact = value => ({ value, confidence: 0.98 });

function makeCase({ olt = true, serial = true, onuMac = true, deviceMac = true } = {}) {
  const item = {
    id: 'login:abon2244',
    identity: { login: fact('abon2244'), billingId: fact('26176') },
    network: {
      connectionFamily: fact('PON'),
      ip: fact('10.9.184.32'),
      mac: fact(deviceMac ? 'F4:1E:57:5A:88:FC' : '')
    },
    pon: {
      oltName: fact(olt ? 'Evromisto-GPON BDCOM' : ''),
      oltIp: fact(olt ? '172.16.10.100' : ''),
      onuSerial: fact(serial ? 'FGXP:C852E744' : ''),
      onuMac: fact(onuMac ? '4C:D7:C8:52:E7:43' : ''),
      pollType: fact(olt ? 'GPON' : ''),
      pollAction: fact(olt ? '311' : '')
    },
    profile: {},
    contexts: { technical: { pageKind: 'billing_technical' } },
    route: {}
  };
  ensureLocatorShape(item);
  item.locator.sourceStatus.juniper = { result: 'online', details: { status: 'online' } };
  return item;
}

function observe(caseData, observation) {
  if (observation?.type === LocatorObservationType.POLL_RESULT && observation?.result === 'confirmed') {
    observation = {
      ...observation,
      routeRelation: observation.routeRelation || 'on_route',
      details: {
        pollCompleted: true,
        pollResponded: true,
        requestObserved: true,
        wrongPollTab: false,
        uiStable: true,
        ...(observation.details || {})
      }
    };
  }
  applyLocatorObservations(caseData, [observation], {
    system: observation.source || 'test',
    pageKind: observation.pageKind || 'test'
  });
  return evaluateLocatorPolicy(caseData);
}

function tmcFound(caseData, overrides = {}) {
  return observe(caseData, {
    type: LocatorObservationType.TMC_RESULT,
    result: 'found',
    method: 'userside_tmc',
    source: 'userside',
    details: {
      oltName: 'BDCOM OLT GP3600-16B GPON',
      oltIp: '172.16.10.100',
      onuSerial: 'FGXPC852E744',
      onuMac: '4C:D7:C8:52:E7:43',
      interface: 'gpon0/11:7',
      deviceId: '53738',
      ...overrides
    }
  });
}

const variants = [
  { key: '111', olt: true, serial: true, onuMac: true, missing: [] },
  { key: '110', olt: true, serial: true, onuMac: false, missing: ['onuMac'] },
  { key: '101', olt: true, serial: false, onuMac: true, missing: ['onuSerial'] },
  { key: '011', olt: false, serial: true, onuMac: true, missing: ['olt'] },
  { key: '100', olt: true, serial: false, onuMac: false, missing: ['onuSerial', 'onuMac'] },
  { key: '010', olt: false, serial: true, onuMac: false, missing: ['olt', 'onuMac'] },
  { key: '001', olt: false, serial: false, onuMac: true, missing: ['olt', 'onuSerial'] },
  { key: '000', olt: false, serial: false, onuMac: false, missing: ['olt', 'onuSerial', 'onuMac'] }
];

for (const variant of variants) {
  const item = makeCase(variant);
  let rec = evaluateLocatorPolicy(item);
  if (variant.missing.length === 0) {
    assert.equal(rec.action, LocatorAction.POLL_CURRENT_BINDING, `${variant.key}: complete Billing must poll directly`);
    continue;
  }
  assert.equal(rec.action, LocatorAction.CHECK_TMC, `${variant.key}: incomplete required Billing data must go to TMC before live poll`);
  assert.deepEqual(rec.params.missingBilling, variant.missing, `${variant.key}: exact missing fields`);
  rec = tmcFound(item);
  assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL, `${variant.key}: TMC completes Billing`);
  assert.deepEqual(rec.params.fields, variant.missing, `${variant.key}: fill only missing fields`);
}

// EPON uses ONU MAC as its primary ONU identity; an empty GPON serial must not block polling.
const epon = makeCase({ olt: true, serial: false, onuMac: true, deviceMac: true });
epon.pon.oltName = fact('Hotov-EPON');
epon.pon.oltIp = fact('172.16.9.200');
epon.pon.pollType = fact('EPON');
epon.pon.pollAction = fact('310');
let eponRec = evaluateLocatorPolicy(epon);
assert.equal(eponRec.action, LocatorAction.POLL_CURRENT_BINDING);

// OLT mismatch with matching ONU identity is a targeted Billing correction.
const oltMismatch = makeCase();
observe(oltMismatch, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  source: 'billing',
  details: {
    oltName: 'Evromisto-GPON BDCOM',
    oltIp: '172.16.10.100',
    onuSerial: 'FGXP:C852E744',
    onuMac: '4C:D7:C8:52:E7:43',
    pollAction: '311'
  }
});
let rec = tmcFound(oltMismatch, {
  oltName: 'Huawei MA5800-X7',
  oltIp: '172.16.1.10'
});
assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);
assert.deepEqual(rec.params.fields, ['olt']);

// ONU identity mismatch is an explicit TMC -> Billing correction; MAC search is
// reserved for the branches where TMC did not provide the required binding.
const identityConflict = makeCase();
observe(identityConflict, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  source: 'billing',
  details: {
    oltIp: '172.16.10.100',
    onuSerial: 'FGXP:C852E744',
    onuMac: '4C:D7:C8:52:E7:43',
    pollAction: '311'
  }
});
rec = tmcFound(identityConflict, { onuSerial: 'FGXP:DIFFERENT' });
assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);
assert.equal(rec.params.source, 'tmc');
assert.deepEqual(rec.params.fields, ['onuSerial']);
assert.equal(rec.params.expectedTechnical.onuSerial, 'FGXP:DIFFERENT');

// Once the explicit prefill changed the control, route must wait for the native
// Save. A saved marker older than this prefill request cannot satisfy it.
identityConflict.pon.onuSerial = fact('FGXP:DIFFERENT');
identityConflict.workflow = {
  ponAcquisition: {
    tmcWritebackPendingSave: true,
    tmcWritebackRequestedAt: '2026-08-14T12:00:00.000Z',
    tmcWritebackFields: ['onuSerial'],
    expectedTechnicalWriteback: { onuSerial: 'FGXP:DIFFERENT' }
  }
};
identityConflict.locator.sourceStatus.billing_saved = {
  result: 'saved',
  updatedAt: '2026-08-14T11:59:00.000Z'
};
rec = evaluateLocatorPolicy(identityConflict);
assert.equal(rec.ruleId, 'tmc.writeback-await-save');
assert.equal(rec.params.phase, 'save');

// If the operator explicitly declines native Save while already in Technical,
// that decision is terminal for the writeback question. TMC remains valid
// evidence and the route proceeds to the poll candidate without re-opening Save.
identityConflict.workflow.ponAcquisition.tmcWritebackPendingSave = false;
identityConflict.workflow.ponAcquisition.tmcWritebackVerifiedInForm = false;
identityConflict.workflow.ponAcquisition.tmcWritebackLastStatus = 'declined';
identityConflict.workflow.ponAcquisition.tmcWritebackDeclinedAt = '2026-08-14T12:00:05.000Z';
identityConflict.locator.sourceStatus.billing_saved = null;
// Restore a non-conflicting TMC candidate for the declined-save continuation case.
const declinedSave = makeCase({ olt: false, serial: true, onuMac: true, deviceMac: true });
declinedSave.workflow = { ponAcquisition: {
  tmcShownAt: '2026-08-14T12:00:00.000Z',
  tmcWritebackPending: false,
  tmcWritebackPendingSave: false,
  tmcWritebackLastStatus: 'declined',
  tmcWritebackDeclinedAt: '2026-08-14T12:00:05.000Z'
} };
tmcFound(declinedSave);
rec = evaluateLocatorPolicy(declinedSave);
assert.equal(rec.action, LocatorAction.POLL_CANDIDATE);
assert.equal(rec.ruleId, 'tmc.writeback-declined-ready-poll');
assert.equal(rec.params.writeback, 'declined');

// Exact production branch: only OLT was missing in Billing. TMC may expose a
// different ONU MAC, but that unrelated difference must not expand the task
// from "fill OLT" into a MAC correction loop. If the operator leaves Technical
// without Save, the TMC/Technical step is closed and polling uses a hybrid
// binding: TMC OLT + the existing Billing ONU identity.
const oltOnlyDecline = makeCase({ olt: false, serial: true, onuMac: true, deviceMac: true });
oltOnlyDecline.route.billingTechnicalInitiallyMissing = ['olt'];
rec = tmcFound(oltOnlyDecline, {
  oltName: 'Huawei MA5800-X15',
  oltIp: '172.16.1.50',
  interface: 'GPON 0/5/4:13',
  onuSerial: 'FGXPC852E744',
  onuMac: '4C:D7:C8:52:E7:44'
});
assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);
assert.deepEqual(rec.params.fields, ['olt'], 'an unrelated existing ONU MAC mismatch must not hijack an OLT-only TMC task');
oltOnlyDecline.workflow = { ponAcquisition: {
  tmcShownAt: '2026-08-17T04:52:33.453Z',
  tmcWritebackAppliedFields: ['olt'],
  tmcWritebackPendingSave: false,
  tmcWritebackVerifiedInForm: false,
  tmcWritebackLastStatus: 'declined',
  tmcWritebackDeclinedAt: '2026-08-17T04:53:00.000Z'
} };
rec = evaluateLocatorPolicy(oltOnlyDecline);
assert.equal(rec.action, LocatorAction.POLL_CANDIDATE);
assert.equal(rec.ruleId, 'tmc.writeback-declined-ready-poll');
assert.equal(rec.params.candidate.oltIp, '172.16.1.50');
assert.equal(rec.params.candidate.pollAction, '313');
assert.equal(rec.params.candidate.onuMac, '4C:D7:C8:52:E7:43', 'declining TMC corrections keeps the already-present Billing ONU MAC');
assert.equal(rec.params.candidate.onuSerial, 'FGXP:C852E744', 'declining TMC corrections keeps the already-present Billing ONU serial');

// TMC missing -> direct device MAC search; direct miss -> UPLINK/DOWNLINK.
const noTmc = makeCase({ olt: false, serial: false, onuMac: false, deviceMac: true });
assert.equal(evaluateLocatorPolicy(noTmc).action, LocatorAction.CHECK_TMC);
rec = observe(noTmc, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'missing',
  method: 'userside_tmc',
  source: 'userside',
  details: {}
});
assert.equal(rec.action, LocatorAction.SEARCH_MAC);
rec = observe(noTmc, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'not_found',
  searchMode: 'direct',
  searchedMac: 'F4:1E:57:5A:88:FC',
  source: 'userside',
  details: { candidates: [] }
});
assert.equal(rec.action, LocatorAction.SEARCH_UPLINK_DOWNLINK);

// If MAC finds OLT/port but ONU S/N + ONU MAC are still unknown, stop and ask to inspect ONU details.
const macRoute = makeCase({ olt: false, serial: false, onuMac: false, deviceMac: true });
observe(macRoute, { type: LocatorObservationType.TMC_RESULT, result: 'missing', source: 'userside', details: {} });
observe(macRoute, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  searchMode: 'direct',
  searchedMac: 'F4:1E:57:5A:88:FC',
  source: 'userside',
  details: {
    candidates: [{
      deviceId: '53738',
      oltName: 'BDCOM OLT GP3600-16B',
      interface: 'gpon0/11:7',
      ifIndex: '120',
      subscriberMac: 'F4:1E:57:5A:88:FC',
      matchedCurrentSubscriber: true
    }]
  }
});
observe(macRoute, {
  type: LocatorObservationType.INTERFACE_CONFIRMATION,
  result: 'confirmed',
  source: 'userside',
  details: {
    deviceId: '53738',
    oltName: 'BDCOM OLT GP3600-16B',
    interface: 'gpon0/11:7',
    ifIndex: '120',
    subscriberMac: 'F4:1E:57:5A:88:FC',
    matchedCurrentSubscriber: true
  }
});
rec = observe(macRoute, {
  type: LocatorObservationType.DEVICE_DETAILS,
  result: 'found',
  source: 'userside',
  details: {
    deviceId: '53738',
    oltName: 'BDCOM OLT GP3600-16B GPON',
    oltIp: '172.16.10.100',
    interface: 'gpon0/11:7',
    technology: 'GPON',
    pollAction: '311'
  }
});
assert.equal(rec.action, LocatorAction.INSPECT_ONU_DETAILS);
assert.deepEqual(rec.params.missingBilling.sort(), ['onuMac', 'onuSerial']);

console.log('route_variation_unit_test: PASS');
