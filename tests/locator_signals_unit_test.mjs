import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/subscriber_locator_route.json', import.meta.url),
    'utf8'
  )
);

globalThis.SIMNET_WB = {};
vm.runInThisContext(
  fs.readFileSync(
    new URL('../src/core/locator-signals.js', import.meta.url),
    'utf8'
  )
);

const signals = globalThis.SIMNET_WB.locatorSignals;
assert.ok(signals, 'locator signals should load');

const activeCase = {
  pon: {
    onuMac: { value: fixture.route.onu_mac },
    locatedInterface: { value: fixture.route.interface }
  },
  network: {
    mac: { value: fixture.route.subscriber_mac }
  }
};

const negative = signals.classifyPollText(
  fixture.negative_poll,
  activeCase
);
assert.equal(negative.result, 'not_found');
assert.equal(negative.strongEvidence, false);

const confirmed = signals.classifyPollText(
  fixture.confirmed_poll,
  activeCase
);
assert.equal(confirmed.result, 'confirmed');
assert.ok(confirmed.matchedBy.includes('interface'));
assert.equal(confirmed.observedOnuMac, fixture.route.onu_mac);
assert.equal(confirmed.observedSubscriberMac, fixture.route.subscriber_mac);

const timeout = signals.classifyPollText(
  'Request timed out. Request timed out.',
  activeCase
);
assert.equal(timeout.result, 'timeout');

const unreachable = signals.classifyPollText(
  'OLT 172.16.100.10 host unreachable. Failed to connect.',
  activeCase
);
assert.equal(unreachable.result, 'olt_unreachable');

const parser = signals.classifyPollText(
  'Fatal error: Uncaught Exception while parsing response',
  activeCase
);
assert.equal(parser.result, 'parser_error');

const conflict = signals.classifyPollText(
  'Interface EPON0/13 has bound 1 active ONUs: EPON0/13:44 AA11.BB22.CC33 auto-configured',
  activeCase
);
assert.equal(conflict.result, 'confirmed');
assert.equal(conflict.identityAssessment, 'mismatch');
assert.ok(conflict.identityConflicts.includes('onuMac'));
assert.equal(conflict.pollResponded, true);

const partial = signals.classifyPollText(
  'Interface EPON0/13 has bound 1 active ONUs. Hardware state is Link-Up.',
  activeCase
);
assert.equal(partial.result, 'confirmed');
assert.equal(partial.pollResponded, true);


// Generic page copy containing the word Online is not ONU response evidence.
const genericOnline = signals.classifyPollText(
  'Online-телебачення в будь-якій точці України. FreeTV. Підключити пакет.',
  activeCase
);
assert.equal(genericOnline.result, 'unknown');
assert.equal(genericOnline.pollResponded, false);

const huaweiCase = {
  pon: {
    onuMac: { value: 'C4:CD:50:12:07:33' },
    onuSerial: { value: 'XPON:50120733' }
  },
  network: {
    mac: { value: 'D4:0D:AB:26:4D:EB' }
  }
};
const huawei = signals.classifyPollText(
  'display ont info by-sn XPON-50120733 F/S/P : 0/1/10 ONT-ID : 19 Run state : online Config state : normal Match state : match Description : GPON0/1/10-XPON-ONT1GEF SN : 58504F4E50120733 (XPON-50120733) display mac-address port 0/1/10 ont 19 214 - gpon d40d-ab26-4deb dynamic 0 /1 /10 19 1 3866 display ont port state 10 19 eth-port all 19 1 GE 1000 full up noloop',
  huaweiCase
);
assert.equal(huawei.result, 'confirmed');
assert.ok(huawei.matchedBy.includes('onuSerial'));
assert.ok(huawei.matchedBy.includes('subscriberMac'));
assert.equal(huawei.observedSubscriberMac, 'D4:0D:AB:26:4D:EB');
assert.equal(huawei.interface, 'GPON0/1/10');
assert.ok(huawei.observedSerialAliases.includes('XPON50120733'));


// Command arguments are not observed evidence: an expected MAC in `exclude` must not match.
const excludeCase = {
  pon: {
    onuMac: { value: '50:5B:11:22:33:44' }
  },
  network: {
    mac: { value: '3C:64:CF:F0:F5:FE' }
  }
};
const excludeOutput = signals.classifyPollText(
  'show mac address-table interface EPON0/4:2 | exclude 3c64.cff0.f5fe\n' +
  'Mac Address Table (Total 1)\n1 f262.546a.aa9b DYNAMIC epon0/4:2\n' +
  'Interface EPON0/4 has bound 1 active ONUs: EPON0/4:2 505b.1122.3344 auto-configured',
  excludeCase
);
assert.equal(excludeOutput.observedSubscriberMac, 'F2:62:54:6A:AA:9B');
assert.equal(excludeOutput.matchedBy.includes('subscriberMac'), false, 'exclude argument cannot fake subscriber-MAC confirmation');
assert.ok(excludeOutput.matchedBy.includes('onuMac'), 'actual ONU output may still confirm ONU identity');

// v1.7.18 Guard Rails: command arguments/profile identity are not a response.
const commandOnly = signals.classifyPollText(
  'Статистика GPON (2.5G) OLT Yabluneva-EPON (172.16.6.90) SN ONU XPON:50120215\n' +
  'display ont info by-sn XPON:50120215\n' +
  'Invalid input detected at ^ marker.',
  activeCase
);
assert.equal(commandOnly.result, 'parser_error');
assert.equal(commandOnly.pollResponded, false, 'CLI command/error must not be mistaken for ONU response');

const interfaceOnly = signals.classifyPollText(
  'show epon active-onu interface EPON0/1 2\nCommand accepted, wait...',
  activeCase
);
assert.notEqual(interfaceOnly.result, 'confirmed');
assert.equal(interfaceOnly.pollResponded, false, 'interface in command text is not response evidence');

const huaweiEpon = signals.technologyFromEvidence(
  'Huawei MA5800-X15',
  'EPON 0/12/3:35',
  ''
);
assert.equal(huaweiEpon.type, 'Huawei');
assert.equal(huaweiEpon.action, '313', 'Huawei OLT vendor must select Billing Huawei action even when the subscriber interface is EPON');

const gcomSuffix = signals.technologyFromName(
  'Vernadsky-24-GPON (172.16.1.250) G-COM'
);
assert.equal(gcomSuffix.type, 'GCOM');
assert.equal(gcomSuffix.action, '312', 'explicit G-COM suffix must override an earlier generic GPON token');

const gcomEvidence = signals.technologyFromEvidence(
  'Vernadsky-24-GPON (172.16.1.250) G COM',
  'GPON0/1/2:3',
  ''
);
assert.equal(gcomEvidence.type, 'GCOM');
assert.equal(gcomEvidence.action, '312', 'G COM vendor marker must outrank generic GPON interface wording');

console.log('locator_signals_unit_test: PASS');
