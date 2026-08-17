import assert from 'node:assert/strict';

globalThis.SIMNET_WB = {};
await import('../src/core/tmc-match.js');

const match = globalThis.SIMNET_WB.tmcMatch;
const fact = value => ({ value });
const caseData = {
  pon: {
    onuMac: fact('4C:D7:C8:2C:91:D4'),
    onuSerial: fact('FGXP:C82C91D5')
  }
};

let result = match.compare({
  mac: '4c-d7-c8-2c-91-d4',
  serial: 'FGXPC82C91D5'
}, caseData);
assert.equal(result.isMatch, true);
assert.equal(result.mac, 'match');
assert.equal(result.serial, 'match');
assert.equal(result.required, 2);

result = match.compare({
  mac: '4C:D7:C8:2C:91:D4',
  serial: 'WRONG-SERIAL'
}, caseData);
assert.equal(result.isMatch, false);
assert.equal(result.mac, 'match');
assert.equal(result.serial, 'mismatch');
assert.equal(match.resultLabel(result), 'identity_mismatch');

result = match.compare({
  mac: '4C:D7:C8:2C:91:D4',
  serial: ''
}, caseData);
assert.equal(result.isMatch, false);
assert.equal(result.isPartial, true);
assert.equal(match.resultLabel(result), 'identity_incomplete');

const serialOnlyCase = {
  pon: { onuSerial: fact('FGXP:C82C91D5') }
};
result = match.compare({
  mac: '00:11:22:33:44:55',
  serial: 'FGXPC82C91D5'
}, serialOnlyCase);
assert.equal(result.isMatch, true);
assert.equal(result.required, 1);

console.log('tmc_match_unit_test: PASS');
