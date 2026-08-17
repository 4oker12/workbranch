import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const eventListeners = new Map();
globalThis.window = globalThis;
globalThis.top = globalThis;
globalThis.self = globalThis;
globalThis.location = {
  hostname: 'pbx.simnet.kiev.ua',
  href: 'https://pbx.simnet.kiev.ua/fop2/list.php'
};
globalThis.addEventListener = (type, handler) => eventListeners.set(type, handler);
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.chrome = {
  runtime: {
    async sendMessage() { return { success: true }; }
  }
};

const element = attributes => ({
  getAttribute(name) { return attributes[name] || ''; }
});
const cell = (text, { html = '', attributes = {}, descendants = [] } = {}) => ({
  textContent: text,
  innerHTML: html,
  getAttribute(name) { return attributes[name] || ''; },
  querySelectorAll() { return descendants; }
});
const row = cells => ({ cells, querySelectorAll() { return cells; } });

const headers = [
  '#', 'Date', 'Time', 'callerId', 'prov', 'ip', 'contract', 'fio',
  'adr_name_street', 'adr_house', 'adr_room', 'holdtime', 'duration',
  'QN', 'queue', 'agent', 'extension', 'fwd', 'callid'
].map(value => cell(value));
const callRow = ({ time, recordId, agent = '6047 Operator_Test OPW', prov = '2' }) => row([
  cell('1'), cell('2026-08-14'), cell(time), cell('0441234567'), cell(prov),
  cell('10.0.0.25'), cell('1910'), cell(''), cell(''), cell(''), cell(''),
  cell('5'), cell('00:00:36'), cell(''), cell('9001'), cell(agent), cell(''),
  cell(''),
  cell('', {
    descendants: [element({ id: `textid-${recordId}` })]
  })
]);
const table = {
  rows: [
    row(headers),
    callRow({ time: '19:41:16', recordId: '1786725676.187490', prov: '1' }),
    callRow({ time: '19:37:29', recordId: '1786725370.187477', agent: '6013 Other_Operator OPW' })
  ],
  querySelectorAll() { return this.rows; }
};
globalThis.document = {
  documentElement: {},
  querySelectorAll(selector) { return selector === 'table' ? [table] : []; }
};

await import(pathToFileURL(new URL('../src/pbx/pbx-observer.js', import.meta.url).pathname).href + `?v=${Date.now()}`);
const api = globalThis.__SIMNET_WB_PBX_TEST_API__;
assert.ok(api, 'PBX parser test API should be exposed');

const calls = api.parsePbxRecentCalls(globalThis.document);
assert.equal(calls.length, 2);
assert.equal(calls[0].callKey, 'pbx:1786725676.187490');
assert.equal(calls[0].callerId, '0441234567');
assert.equal(calls[0].providerCode, '1');
assert.equal(calls[0].contract, '1910');
assert.equal(calls[0].subscriberIp, '10.0.0.25');
assert.equal(calls[0].agentExtension, '6047');
assert.equal(calls[0].durationSeconds, 36);
assert.equal(calls[1].callerId, calls[0].callerId, 'same phone remains two different calls');
assert.notEqual(calls[1].callKey, calls[0].callKey, 'callid, not phone, is the unique key');
assert.match(calls[0].recordUrl, /getrec\.php\?id=1786725676\.187490$/);
assert.equal('audio' in calls[0], false, 'audio bytes are never captured');

eventListeners.get('pagehide')?.();
console.log('pbx_observer_unit_test: PASS');
