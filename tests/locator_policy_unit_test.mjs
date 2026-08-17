import assert from 'node:assert/strict';
import {
  LocatorObservationType,
  LocatorAction,
  LocatorTermination,
  ensureLocatorShape,
  applyLocatorObservations,
  evaluateLocatorPolicy,
  locatorSnapshot,
  isBindingRejected
} from '../src/core/locator-policy.js';

const fact = value => ({ value, confidence: 0.98 });

function baseCase() {
  const result = {
    id: 'login:abon123456',
    identity: {
      login: fact('abon123456'),
      billingId: fact('12345')
    },
    network: {
      connectionFamily: fact('PON'),
      ip: fact('10.0.0.25'),
      mac: fact('02:11:22:33:44:55')
    },
    pon: {
      oltName: fact('Sim36-OLT-Huawei Huawei'),
      oltIp: fact('172.16.100.10'),
      onuMac: fact('AA:BB:CC:DD:EE:01'),
      onuSerial: fact('FGXP:00112233'),
      pollType: fact('Huawei'),
      pollAction: fact('313')
    },
    profile: {},
    contexts: {
      technical: { pageKind: 'billing_technical' }
    }
  };
  ensureLocatorShape(result);
  result.locator.sourceStatus.juniper = { result: 'online', details: { status: 'online' } };
  return result;
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


const juniperFirst = baseCase();
delete juniperFirst.locator.sourceStatus.juniper;
let firstRec = evaluateLocatorPolicy(juniperFirst);
assert.equal(firstRec.action, LocatorAction.POLL_CURRENT_BINDING, 'Juniper prefetch does not block the ordinary route');
firstRec = observe(juniperFirst, {
  type: LocatorObservationType.JUNIPER_SESSION,
  result: 'online',
  method: 'billing-juniper-prefetch',
  source: 'billing-juniper',
  details: { status: 'online', subscriberIp: '10.0.0.25', subscriberMac: '02:11:22:33:44:55', hasTraffic: true }
});
assert.equal(firstRec.action, LocatorAction.POLL_CURRENT_BINDING, 'after Juniper snapshot the ordinary route continues');

const route = baseCase();
let rec = evaluateLocatorPolicy(route);
assert.equal(rec.action, LocatorAction.POLL_CURRENT_BINDING);

rec = observe(route, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  source: 'billing',
  details: {
    oltName: 'Sim36-OLT-Huawei Huawei',
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    subscriberMac: '02:11:22:33:44:55',
    pollAction: '313',
    technology: 'Huawei'
  }
});
assert.equal(rec.action, LocatorAction.CHECK_TMC);
assert.equal(isBindingRejected(route), true);

rec = observe(route, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'missing',
  method: 'userside_tmc',
  source: 'userside',
  details: {}
});
observe(route, {
  type: LocatorObservationType.CUSTOMER_MACS,
  result: 'found',
  source: 'userside',
  details: {
    macs: [{ mac: '02:11:22:33:44:55' }]
  }
});
rec = evaluateLocatorPolicy(route);
assert.equal(rec.action, LocatorAction.SEARCH_MAC);

rec = observe(route, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  method: 'userside_mac_history',
  source: 'userside',
  searchMode: 'direct',
  searchedMac: '02:11:22:33:44:55',
  details: {
    candidates: [{
      deviceId: '9001',
      oltName: 'BDCOM OLT P3616-2TE',
      interface: 'EPON0/13:39',
      ifIndex: '76',
      subscriberMac: '02:11:22:33:44:55',
      matchedCurrentSubscriber: true
    }]
  }
});
assert.equal(rec.action, LocatorAction.FILL_BILLING_OLT);
assert.equal(rec.params.source, 'mac_name');
assert.equal(rec.params.phase, 'select_by_name');

// After Billing resolves the network name to one native OLT option and the operator saves,
// the same candidate becomes Billing-ready without forcing an equipment/IP detour.
route.pon.oltName = fact('Hotov-EPON');
route.pon.oltIp = fact('172.16.9.200');
route.pon.pollType = fact('EPON');
route.pon.pollAction = fact('310');
rec = observe(route, {
  type: LocatorObservationType.BILLING_OLT_SAVE_INTENT,
  result: 'intent',
  source: 'billing',
  details: {
    deviceId: '9001', oltName: 'Hotov-EPON', oltIp: '172.16.9.200',
    technology: 'EPON', pollAction: '310', resolvedBy: 'billing_olt_name', sourceDocumentId: 'doc-before-name-save'
  }
});
assert.equal(rec.action, LocatorAction.WAIT_CONTEXT);
rec = observe(route, {
  type: LocatorObservationType.BILLING_OLT_SAVED,
  result: 'saved',
  source: 'billing',
  details: {
    deviceId: '9001', oltName: 'Hotov-EPON', oltIp: '172.16.9.200',
    technology: 'EPON', pollAction: '310', resolvedBy: 'billing_olt_name'
  }
});
assert.equal(rec.action, LocatorAction.POLL_CANDIDATE);

// Multiple MAC-history candidates still require interface confirmation; the name shortcut is only for one unambiguous hit.
const ambiguousMac = baseCase();
observe(ambiguousMac, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  source: 'billing',
  details: { oltIp: '172.16.100.10', onuSerial: 'FGXP:00112233', pollAction: '313' }
});
observe(ambiguousMac, { type: LocatorObservationType.TMC_RESULT, result: 'missing', source: 'userside', details: {} });
rec = observe(ambiguousMac, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  method: 'userside_mac_history',
  source: 'userside',
  searchMode: 'direct',
  searchedMac: '02:11:22:33:44:55',
  details: { candidates: [
    { deviceId: '9001', oltName: 'BDCOM OLT P3616-2TE', interface: 'EPON0/13:39', subscriberMac: '02:11:22:33:44:55', matchedCurrentSubscriber: true },
    { deviceId: '9002', oltName: 'BDCOM OLT P3616-2TE reserve', interface: 'EPON0/13:40', subscriberMac: '02:11:22:33:44:55', matchedCurrentSubscriber: true }
  ] }
});
assert.equal(rec.action, LocatorAction.INSPECT_INTERFACE);

rec = observe(ambiguousMac, {
  type: LocatorObservationType.INTERFACE_CONFIRMATION,
  result: 'confirmed',
  method: 'userside_interface_mac_list',
  source: 'userside',
  details: {
    deviceId: '9001',
    oltName: 'BDCOM OLT P3616-2TE',
    interface: 'EPON0/13:39',
    ifIndex: '76',
    subscriberMac: '02:11:22:33:44:55',
    matchedCurrentSubscriber: true
  }
});
assert.equal(rec.action, LocatorAction.INSPECT_DEVICE);

rec = observe(ambiguousMac, {
  type: LocatorObservationType.DEVICE_DETAILS,
  result: 'found',
  method: 'userside_device_card',
  source: 'userside',
  details: {
    deviceId: '9001',
    oltName: 'BDCOM OLT P3616-2TE',
    oltIp: '172.16.200.20',
    interface: 'EPON0/13:39',
    technology: 'EPON',
    pollAction: '310'
  }
});
assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);

ambiguousMac.pon.oltName = fact('BDCOM OLT P3616-2TE EPON');
ambiguousMac.pon.oltIp = fact('172.16.200.20');
ambiguousMac.pon.pollType = fact('EPON');
ambiguousMac.pon.pollAction = fact('310');
rec = evaluateLocatorPolicy(ambiguousMac);
// Billing already holds a complete core binding — do not demand a redundant save
// merely because the route once remembered initially-missing fields.
assert.ok(
  [LocatorAction.POLL_CURRENT_BINDING, LocatorAction.POLL_CANDIDATE].includes(rec.action),
  `complete binding should advance to poll, got ${rec.action}`
);
assert.equal(isBindingRejected(ambiguousMac), false, 'new binding is not globally rejected');

rec = observe(ambiguousMac, {
  type: LocatorObservationType.BILLING_OLT_SAVE_INTENT,
  result: 'intent',
  method: 'native-save-click',
  source: 'billing',
  details: {
    deviceId: '9001',
    oltName: 'BDCOM OLT P3616-2TE EPON',
    oltIp: '172.16.200.20',
    interface: 'EPON0/13:39',
    technology: 'EPON',
    pollAction: '310',
    sourceDocumentId: 'doc-old'
  }
});
assert.equal(rec.action, LocatorAction.WAIT_CONTEXT);

rec = observe(ambiguousMac, {
  type: LocatorObservationType.BILLING_OLT_SAVED,
  result: 'saved',
  method: 'post-navigation-verification',
  source: 'billing',
  details: {
    deviceId: '9001',
    oltName: 'BDCOM OLT P3616-2TE EPON',
    oltIp: '172.16.200.20',
    interface: 'EPON0/13:39',
    technology: 'EPON',
    pollAction: '310'
  }
});
assert.equal(rec.action, LocatorAction.POLL_CANDIDATE);

rec = observe(ambiguousMac, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'confirmed',
  method: 'direct_olt_poll',
  source: 'billing',
  matchedBy: ['onuMac', 'subscriberMac', 'interface'],
  details: {
    oltName: 'BDCOM OLT P3616-2TE EPON',
    oltIp: '172.16.200.20',
    onuMac: 'AA:BB:CC:DD:EE:01',
    subscriberMac: '02:11:22:33:44:55',
    interface: 'EPON0/13:39',
    technology: 'EPON',
    pollAction: '310'
  }
});
assert.equal(rec.action, LocatorAction.COMPLETE_CONFIRMED);
assert.equal(locatorSnapshot(ambiguousMac).termination.status, LocatorTermination.CONFIRMED);

// A timeout does not reject the current binding and is retried once.
const timeoutCase = baseCase();
rec = observe(timeoutCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'timeout',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
assert.equal(rec.action, LocatorAction.RETRY_POLL);
assert.equal(isBindingRejected(timeoutCase), false);

// Same OLT can be reconsidered with another ONU/interface binding.
const scopedRejection = baseCase();
observe(scopedRejection, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
scopedRejection.pon.onuMac = fact('AA:BB:CC:DD:EE:FF');
assert.equal(isBindingRejected(scopedRejection), false);


// A TMC OLT is accepted even when ONU identity rows differ.
// Serial/MAC remain supplemental evidence and do not block Billing return.
const tmcMismatchCase = baseCase();
observe(tmcMismatchCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
observe(tmcMismatchCase, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'identity_mismatch',
  method: 'userside_tmc',
  details: {
    identityCheck: {
      mac: 'match',
      serial: 'mismatch'
    },
    bestObserved: {
      oltName: 'BDCOM OLT P3616',
      oltIp: '172.16.200.20',
      deviceId: '1693',
      interface: 'EPON0/13:39',
      onuMac: 'AA:BB:CC:DD:EE:01',
      onuSerial: 'WRONG-SERIAL'
    }
  }
});
rec = evaluateLocatorPolicy(tmcMismatchCase);
assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);
assert.equal(rec.params.source, 'tmc');
assert.ok(rec.params.fields.includes('onuSerial'));
assert.equal(rec.params.expectedTechnical.onuSerial, 'WRONG-SERIAL');
assert.equal(tmcMismatchCase.locator.candidates.length, 1);
assert.equal(tmcMismatchCase.locator.sourceStatus.tmc.result, 'found');
assert.equal(
  tmcMismatchCase.locator.candidates[0].oltIp,
  '172.16.200.20'
);

// Exhausted TMC + direct MAC + topology search terminates as not_found.
const notFoundCase = baseCase();
observe(notFoundCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
observe(notFoundCase, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'missing',
  details: {}
});
observe(notFoundCase, {
  type: LocatorObservationType.CUSTOMER_MACS,
  result: 'found',
  details: { macs: [{ mac: '02:11:22:33:44:55' }] }
});
observe(notFoundCase, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'not_found',
  searchMode: 'direct',
  searchedMac: '02:11:22:33:44:55',
  details: { candidates: [] }
});
rec = observe(notFoundCase, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'not_found',
  searchMode: 'uplink_downlink',
  searchedMac: '02:11:22:33:44:55',
  details: { candidates: [] }
});
assert.equal(rec.action, LocatorAction.COMPLETE_NOT_FOUND);
assert.equal(locatorSnapshot(notFoundCase).termination.status, LocatorTermination.NOT_FOUND);

// Conflicting direct poll is terminal inconclusive, not confirmed/not_found.
const conflictCase = baseCase();
rec = observe(conflictCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'conflict',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    expected: { onuMac: 'AA:BB:CC:DD:EE:01' },
    observed: { onuMac: 'AA:BB:CC:DD:EE:FF' }
  }
});
assert.equal(rec.action, LocatorAction.RESOLVE_CONFLICT);
assert.equal(locatorSnapshot(conflictCase).termination.status, LocatorTermination.INCONCLUSIVE);

// Parser failure is a distinct manual-review terminal, not a negative poll.
const parserCase = baseCase();
rec = observe(parserCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'parser_error',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
assert.equal(rec.action, LocatorAction.MANUAL_REVIEW);
assert.equal(
  locatorSnapshot(parserCase).termination.status,
  LocatorTermination.MANUAL_REVIEW
);

// Repeated poll failure plus unavailable alternate sources ends as blocked.
const blockedCase = baseCase();
observe(blockedCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'timeout',
  method: 'direct_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
observe(blockedCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'timeout',
  method: 'retry_olt_poll',
  details: {
    oltIp: '172.16.100.10',
    onuMac: 'AA:BB:CC:DD:EE:01',
    pollAction: '313'
  }
});
observe(blockedCase, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'blocked',
  method: 'userside_tmc',
  details: { reason: 'source_unavailable' }
});
observe(blockedCase, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'blocked',
  searchMode: 'direct',
  method: 'userside_mac_history',
  details: { candidates: [] }
});
rec = observe(blockedCase, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'blocked',
  searchMode: 'uplink_downlink',
  method: 'userside_mac_topology',
  details: { candidates: [] }
});
assert.equal(rec.action, LocatorAction.MANUAL_REVIEW);
assert.equal(
  locatorSnapshot(blockedCase).termination.status,
  LocatorTermination.BLOCKED
);


// A transient partial result must stabilize before it can trigger a fallback.
const partialCase = baseCase();
rec = observe(partialCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'partial',
  method: 'direct_olt_poll',
  source: 'billing',
  details: {
    oltIp: '172.16.100.10',
    onuSerial: 'FGXP:00112233',
    interface: 'GPON0/1/0:19',
    pollAction: '313'
  }
});
assert.equal(rec.action, LocatorAction.WAIT_POLL, 'fresh partial stays in stabilization window');
partialCase.locator.sourceStatus.poll.partialSinceAt = new Date(Date.now() - 5000).toISOString();
rec = evaluateLocatorPolicy(partialCase);
assert.equal(rec.action, LocatorAction.CHECK_TMC, 'stable partial may advance to the next independent source');

// Once a direct poll confirms the route, later UserSide/MAC observations are passive.
const latchedCase = baseCase();
rec = observe(latchedCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'confirmed',
  method: 'direct_olt_poll',
  source: 'billing',
  matchedBy: ['onuSerial', 'subscriberMac'],
  details: {
    oltIp: '172.16.100.10',
    onuSerial: 'FGXP:00112233',
    subscriberMac: '02:11:22:33:44:55',
    interface: 'GPON0/1/0:19',
    pollAction: '313',
    technology: 'Huawei'
  }
});
assert.equal(rec.action, LocatorAction.COMPLETE_CONFIRMED);
assert.equal(latchedCase.locator.termination.pollCompleted, true);
assert.deepEqual(latchedCase.locator.termination.confirmedBy, ['onu_response']);
const terminationAt = latchedCase.locator.termination.completedAt;
applyLocatorObservations(latchedCase, [{
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  method: 'userside_mac_history',
  source: 'userside',
  searchMode: 'direct',
  details: {
    candidates: [{ deviceId: '9999', oltName: 'Other device', interface: 'Ethernet1', subscriberMac: '02:11:22:33:44:55' }]
  }
}], { system: 'userside', pageKind: 'userside_customer_list' });
rec = evaluateLocatorPolicy(latchedCase);
assert.equal(rec.action, LocatorAction.COMPLETE_CONFIRMED, 'post-confirmation browsing cannot reopen the route');
assert.equal(latchedCase.locator.state, 'confirmed');
assert.equal(latchedCase.locator.termination.completedAt, terminationAt);
assert.equal(latchedCase.locator.evidence[0].passive, true, 'post-confirmation evidence is kept as passive audit context');

// A real ONU response closes the diagnostic route even when identity differs.
// Identity mismatch is preserved as a finding for Terminal Interpretation, not a fallback trigger.
const respondedMismatchCase = baseCase();
rec = observe(respondedMismatchCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'confirmed',
  method: 'direct_olt_poll',
  source: 'billing',
  matchedBy: [],
  details: {
    pollResponded: true,
    identityAssessment: 'mismatch',
    identityConflicts: ['subscriberMac'],
    oltIp: '172.16.100.10',
    onuSerial: 'FGXP:00112233',
    subscriberMac: 'AA:AA:AA:AA:AA:AA',
    interface: 'GPON0/1/0:19',
    pollAction: '313',
    technology: 'Huawei',
    expected: { subscriberMac: '02:11:22:33:44:55' },
    observed: { subscriberMac: 'AA:AA:AA:AA:AA:AA' }
  }
});
assert.equal(rec.action, LocatorAction.COMPLETE_CONFIRMED);
assert.equal(respondedMismatchCase.locator.termination.status, LocatorTermination.CONFIRMED);
assert.equal(respondedMismatchCase.locator.termination.identityAssessment, 'mismatch');
assert.deepEqual(respondedMismatchCase.locator.termination.identityConflicts, ['subscriberMac']);
assert.equal(Boolean(respondedMismatchCase.locator.candidates[0].matchedCurrentSubscriber), false);

// EPON Serial discovered in TMC is supplemental: only the missing OLT is actionable.
const eponOptionalSerial = baseCase();
eponOptionalSerial.pon.oltName = fact('');
eponOptionalSerial.pon.oltIp = fact('');
eponOptionalSerial.pon.pollType = fact('EPON');
eponOptionalSerial.pon.pollAction = fact('310');
eponOptionalSerial.pon.onuMac = fact('AA:BB:CC:DD:EE:01');
eponOptionalSerial.pon.onuSerial = fact('');
rec = observe(eponOptionalSerial, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'found',
  method: 'userside_tmc',
  source: 'userside',
  details: {
    oltName: 'BDCOM OLT P3616-2TE',
    oltIp: '172.16.200.20',
    onuMac: 'AA:BB:CC:DD:EE:01',
    onuSerial: 'FGXP:OPTIONAL123',
    technology: 'EPON',
    pollAction: '310',
    matchedCurrentSubscriber: true
  }
});
assert.equal(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);
assert.deepEqual(rec.params.fields, ['olt'], 'EPON route must not force supplemental ONU Serial into Billing');


// Upgrade recovery: a v1.7.13 case that lost termination but kept direct_confirmed evidence is relatched.
const recoveredCase = baseCase();
recoveredCase.locator.termination = null;
recoveredCase.locator.state = 'candidate_found';
recoveredCase.locator.candidates = [{
  id: '172.16.100.10|gpon0/1/0:19|AABBCCDDEE01',
  status: 'direct_confirmed',
  oltIp: '172.16.100.10',
  onuMac: 'AABBCCDDEE01',
  interface: 'GPON0/1/0:19',
  updatedAt: '2026-08-10T16:11:50.410Z'
}];
recoveredCase.locator.attempts = [{
  type: LocatorObservationType.POLL_RESULT,
  result: 'confirmed',
  at: '2026-08-10T16:11:50.410Z',
  details: { matchedBy: ['onuMac'] }
}];
rec = evaluateLocatorPolicy(recoveredCase);
assert.equal(rec.action, LocatorAction.COMPLETE_CONFIRMED);
assert.equal(recoveredCase.locator.termination?.status, LocatorTermination.CONFIRMED);
assert.equal(recoveredCase.locator.termination?.recovered, true);

console.log('locator_policy_unit_test: PASS');


// v1.7.29.10: incomplete required Billing data is a hard acquisition gate.
// A known ONU MAC/poll type no longer permits a speculative first poll; the
// missing OLT/Serial data is recovered through TMC before live polling.
const minimalPoll = baseCase();
delete minimalPoll.pon.oltName;
delete minimalPoll.pon.oltIp;
delete minimalPoll.pon.onuSerial;
let minimalRec = evaluateLocatorPolicy(minimalPoll);
assert.equal(minimalRec.action, LocatorAction.CHECK_TMC);
assert.equal(minimalRec.ruleId, 'billing.incomplete-check-tmc');

// v1.7.16: observations seen outside the requested route can be stored passively and later
// promoted by the exact same signature without creating a duplicate.
const passiveCase = baseCase();
const passiveObservation = {
  type: LocatorObservationType.TMC_RESULT,
  result: 'found',
  method: 'userside_tmc',
  source: 'userside',
  passive: true,
  details: { oltName: 'Huawei MA5800-X2', oltIp: '172.16.8.8', onuMac: 'AA:BB:CC:DD:EE:01' }
};
let passiveApplied = applyLocatorObservations(passiveCase, [passiveObservation], { system: 'userside', pageKind: 'userside_customer' });
assert.equal(passiveApplied[0].passive, true);
assert.equal(passiveCase.locator.sourceStatus.tmc, undefined);
const passiveEvidenceCount = passiveCase.locator.evidence.length;
passiveApplied = applyLocatorObservations(passiveCase, [{ ...passiveObservation, passive: false }], { system: 'userside', pageKind: 'userside_customer' });
assert.equal(passiveApplied[0].passive, undefined);
assert.equal(passiveCase.locator.evidence.length, passiveEvidenceCount);
assert.equal(passiveCase.locator.sourceStatus.tmc.result, 'found');

// v1.7.17: a MAC-history first hop on an aggregation switch is topology evidence,
// not an OLT name that can be written into Billing.
const transitCase = baseCase();
let transitRec = observe(transitCase, {
  type: LocatorObservationType.POLL_RESULT,
  result: 'not_found',
  method: 'direct_olt_poll',
  source: 'billing',
  details: { oltName: 'Sim36-OLT-Huawei Huawei', oltIp: '172.16.100.10', onuMac: 'AA:BB:CC:DD:EE:01', pollAction: '313', technology: 'Huawei' }
});
transitRec = observe(transitCase, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'missing',
  method: 'userside_tmc',
  source: 'userside',
  details: {}
});
observe(transitCase, {
  type: LocatorObservationType.CUSTOMER_MACS,
  result: 'found',
  source: 'userside',
  details: { macs: [{ mac: '02:11:22:33:44:55' }] }
});
transitRec = observe(transitCase, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  method: 'userside_mac_history',
  source: 'userside',
  searchMode: 'direct',
  searchedMac: '02:11:22:33:44:55',
  details: {
    candidates: [{
      deviceId: '33694',
      oltName: 'Arista DCS-7280QRA-C36S-M-F - server room',
      interface: 'Port-Channel3',
      ifIndex: '1000003',
      subscriberMac: '02:11:22:33:44:55',
      matchedCurrentSubscriber: true
    }]
  }
});
assert.notEqual(transitRec.action, LocatorAction.FILL_BILLING_OLT, 'aggregation switch must never be treated as OLT');
assert.equal(transitRec.action, LocatorAction.INSPECT_INTERFACE);

// v1.7.18 Guard Rails: an incidental MAC result cannot outrun TMC.
const macBeforeTmc = baseCase();
let guardRec = observe(macBeforeTmc, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  method: 'userside_mac_history',
  source: 'userside',
  searchMode: 'direct',
  searchedMac: '02:11:22:33:44:55',
  details: {
    candidates: [{
      deviceId: '33694',
      oltName: 'Arista DCS-7280QRA-C36S-M-F',
      interface: 'Port-Channel3',
      subscriberMac: '02:11:22:33:44:55',
      matchedCurrentSubscriber: true
    }]
  }
});
assert.equal(guardRec.action, LocatorAction.CHECK_TMC);
assert.equal(guardRec.ruleId, 'guard.tmc-before-network');

// Huawei OLT vendor selects the Billing poll adapter even when the access
// interface is EPON. The actual TMC visit also makes an absent Serial optional
// when TMC exposes only OLT + ONU MAC.
const huaweiEponCase = baseCase();
huaweiEponCase.pon.onuSerial = fact('');
huaweiEponCase.workflow = { ponAcquisition: { tmcShownAt: '2026-08-17T03:36:59.151Z' } };
guardRec = observe(huaweiEponCase, {
  type: LocatorObservationType.TMC_RESULT,
  result: 'found',
  method: 'userside_tmc',
  source: 'userside',
  details: {
    oltName: 'Huawei MA5800-X15',
    oltIp: '172.16.100.10',
    interface: 'EPON 0/12/3:35',
    onuMac: 'AA:BB:CC:DD:EE:01',
    onuSerial: '',
    matchedCurrentSubscriber: true
  }
});
const tmcCandidate = huaweiEponCase.locator.candidates.find(item => item.source === 'userside-tmc');
assert.equal(tmcCandidate?.technology, 'Huawei');
assert.equal(tmcCandidate?.pollAction, '313');
assert.equal(guardRec.action, LocatorAction.POLL_CANDIDATE);
assert.equal(guardRec.ruleId, 'tmc.ready-poll');

// The central policy must recognize the exact Billing display name too. The
// suffix G-COM is more specific than the earlier generic GPON token.
const gcomNameCase = baseCase();
observe(gcomNameCase, {
  type: LocatorObservationType.MAC_SEARCH_RESULT,
  result: 'candidate_found',
  method: 'userside_mac_history',
  source: 'userside',
  searchMode: 'direct',
  searchedMac: '02:11:22:33:44:55',
  details: {
    candidates: [{
      deviceId: 'gcom-312',
      oltName: 'Vernadsky-24-GPON (172.16.1.250) G-COM',
      interface: 'GPON 0/1/2:50',
      subscriberMac: '02:11:22:33:44:55',
      matchedCurrentSubscriber: true
    }]
  }
});
const gcomNameCandidate = gcomNameCase.locator.candidates.find(item => item.deviceId === 'gcom-312');
assert.equal(gcomNameCandidate?.technology, 'GCOM');
assert.equal(gcomNameCandidate?.pollAction, '312');

// --- abon457445 regression: complete Billing + matching TMC must not stick on fill_billing_technical ---
{
  const abon = baseCase();
  abon.id = 'login:abon457445';
  abon.identity.login = fact('abon457445');
  abon.pon = {
    oltName: fact('V_Pokotilova-7-2-GPON (172.16.13.185) BDCOM'),
    oltIp: fact('172.16.13.185'),
    onuMac: fact('B4:64:15:A2:CE:D6'),
    onuSerial: fact('FGXP15A2CED7'),
    pollType: fact('GPON'),
    pollAction: fact('311'),
    tmcOltName: fact('BDCOM OLT GP3600-16B'),
    tmcOltIp: fact('172.16.13.185'),
    tmcOnuMac: fact('B4:64:15:A2:CE:D6'),
    tmcOnuSerial: fact('FGXP15A2CED7')
  };
  observe(abon, {
    type: LocatorObservationType.TMC_RESULT,
    result: 'found',
    method: 'userside_tmc',
    source: 'userside',
    details: {
      oltName: 'BDCOM OLT GP3600-16B',
      oltIp: '172.16.13.185',
      interface: 'gpon0/4:20',
      onuMac: 'B4:64:15:A2:CE:D6',
      onuSerial: 'FGXP15A2CED7',
      matchedCurrentSubscriber: true
    }
  });
  const snap = locatorSnapshot(abon);
  assert.notEqual(snap.recommendation?.action, LocatorAction.FILL_BILLING_TECHNICAL,
    'complete matching binding must not recommend fill_billing_technical');
  assert.ok(
    [LocatorAction.POLL_CURRENT_BINDING, LocatorAction.POLL_CANDIDATE].includes(snap.recommendation?.action),
    `expected poll action, got ${snap.recommendation?.action}`
  );
}

// OLT identity: Billing site label + IP vs TMC vendor model + same IP must not conflict
{
  const mismatchName = baseCase();
  mismatchName.pon.oltName = fact('V_Pokotilova-7-2-GPON (172.16.13.185) BDCOM');
  mismatchName.pon.oltIp = fact('172.16.13.185');
  mismatchName.pon.onuMac = fact('B4:64:15:A2:CE:D6');
  mismatchName.pon.onuSerial = fact('FGXP15A2CED7');
  mismatchName.pon.pollType = fact('GPON');
  mismatchName.pon.pollAction = fact('311');
  mismatchName.pon.tmcOltName = fact('BDCOM OLT GP3600-16B');
  mismatchName.pon.tmcOltIp = fact('172.16.13.185');
  mismatchName.pon.tmcOnuMac = fact('B4:64:15:A2:CE:D6');
  mismatchName.pon.tmcOnuSerial = fact('FGXP15A2CED7');
  observe(mismatchName, {
    type: LocatorObservationType.TMC_RESULT,
    result: 'found',
    method: 'userside_tmc',
    source: 'userside',
    details: {
      oltName: 'BDCOM OLT GP3600-16B',
      oltIp: '172.16.13.185',
      onuMac: 'B4:64:15:A2:CE:D6',
      onuSerial: 'FGXP15A2CED7',
      matchedCurrentSubscriber: true
    }
  });
  const rec = evaluateLocatorPolicy(mismatchName);
  assert.notEqual(rec.action, LocatorAction.FILL_BILLING_TECHNICAL);
  assert.notEqual(rec.action, LocatorAction.RESOLVE_CONFLICT);
}

console.log('locator_policy_unit_test: ok');
