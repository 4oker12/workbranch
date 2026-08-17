import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

globalThis.chrome = {
  storage: { local: { async get() { return {}; }, async set() {} } },
  runtime: {
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} }
  },
  tabs: { onRemoved: { addListener() {} }, async update() {} },
  windows: { async update() {} }
};

await import(pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href + `?v=${Date.now()}`);
const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api, 'background test API should be exposed');

const fact = value => ({ value, confidence: 0.99, source: 'fixture' });
const looknetCase = api.emptyCase('login:abon490127');
looknetCase.identity.login = fact('abon490127');
looknetCase.identity.contract = fact('490127');
looknetCase.identity.customerId = fact('57385');
looknetCase.network.ip = fact('100.64.57.28');
looknetCase.profile.phone = fact('0504438344');

const looknetCall = api.normalizePbxCall({
  recordId: '1786731171.185722',
  callerId: '0504438344',
  providerCode: '1',
  contract: '82225',
  subscriberIp: '100.64.57.28',
  duration: '00:07:26',
  durationSeconds: 446,
  agent: '6047 Zyatev_Andriy OPW',
  agentExtension: '6047'
});

assert.equal(looknetCall.providerCode, '1', 'PBX provider namespace must survive normalization');
const looknetMatch = api.pbxCallMatch(looknetCall, looknetCase);
assert.equal(looknetMatch.level, 'strong', 'LUKNET PBX contract is a different namespace; exact IP must remain strong');
assert.deepEqual(looknetMatch.matchedBy, ['ip']);
assert.deepEqual(looknetMatch.conflicts, []);
assert.equal(looknetMatch.contractComparable, false);

const simnetCall = api.normalizePbxCall({
  recordId: '1786731172.185723',
  callerId: '0504438344',
  providerCode: '2',
  contract: '82225',
  subscriberIp: '100.64.57.28',
  agent: '6047 Zyatev_Andriy OPW'
});
const simnetConflict = api.pbxCallMatch(simnetCall, looknetCase);
assert.equal(simnetConflict.level, 'conflict', 'SIMNET namespace contract disagreement must still fail closed');
assert.ok(simnetConflict.conflicts.includes('contract'));

const looknetPhoneOnly = api.normalizePbxCall({
  recordId: '1786731173.185724',
  callerId: '0504438344',
  providerCode: '1',
  contract: '82225',
  agent: '6047 Zyatev_Andriy OPW'
});
const phoneOnly = api.pbxCallMatch(looknetPhoneOnly, looknetCase);
assert.equal(phoneOnly.level, 'supporting', 'provider namespace exception must never turn phone-only evidence into a strong binding');
assert.deepEqual(phoneOnly.matchedBy, ['phone']);

const looknetWrongIp = api.normalizePbxCall({
  recordId: '1786731174.185725',
  callerId: '0504438344',
  providerCode: '1',
  contract: '82225',
  subscriberIp: '100.64.57.99',
  agent: '6047 Zyatev_Andriy OPW'
});
const wrongIp = api.pbxCallMatch(looknetWrongIp, looknetCase);
assert.equal(wrongIp.level, 'conflict', 'provider namespace exception must not hide an IP contradiction');
assert.ok(wrongIp.conflicts.includes('ip'));

console.log('pbx_provider_namespace_unit_test: PASS');
