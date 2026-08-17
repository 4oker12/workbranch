import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, '..', 'src/ui/appeals-navigator.js'),
  'utf8'
);
const sandbox = { SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'appeals-navigator.js' });

const appeals = sandbox.SIMNET_WB.appeals;
assert.ok(appeals, 'Appeals Navigator API should load');
assert.deepEqual(
  Array.from(appeals.types, item => item.id),
  ['low_speed', 'no_internet', 'unstable', 'wifi', 'sites']
);

let state = appeals.select('low_speed');
assert.equal(state.nodeId, 'low.scope');
assert.equal(state.status, 'active');

state = appeals.answer(state, 'all');
assert.equal(state.nodeId, 'low.medium.all');
state = appeals.answer(state, 'both');
assert.equal(state.nodeId, 'low.direct');
state = appeals.answer(state, 'low');
assert.equal(state.nodeId, 'low.session');
state = appeals.answer(state, 'online_traffic');
assert.equal(state.nodeId, 'low.access.outcome');
assert.equal(state.status, 'complete');
assert.equal(state.outcomeId, 'low.access.outcome');
assert.equal(state.history.length, 4);
assert.match(appeals.node(state).nextAction, /LIVE/);

const completedPhases = appeals.phaseStates(state);
assert.equal(completedPhases.at(-1).state, 'done');
assert.ok(completedPhases.every(item => item.state === 'done'));

state = appeals.back(state);
assert.equal(state.nodeId, 'low.session');
assert.equal(state.status, 'active');
assert.equal(state.outcomeId, '');

let wifiBranch = appeals.select('low_speed');
wifiBranch = appeals.answer(wifiBranch, 'one');
wifiBranch = appeals.answer(wifiBranch, 'wifi');
wifiBranch = appeals.answer(wifiBranch, '24');
assert.equal(wifiBranch.nodeId, 'low.wifi24.outcome');
assert.equal(appeals.node(wifiBranch).focus, 'wifi');

let noInternet = appeals.select('no_internet');
noInternet = appeals.answer(noInternet, 'all');
noInternet = appeals.answer(noInternet, 'offline');
assert.equal(noInternet.nodeId, 'none.offline.outcome');
assert.equal(noInternet.status, 'complete');

const normalizedForeign = appeals.normalize({
  typeId: 'unknown',
  nodeId: 'anything',
  history: [{ nodeId: 'anything' }]
});
assert.equal(normalizedForeign.status, 'empty');
assert.equal(normalizedForeign.history.length, 0);

const facts = appeals.caseSummary({
  network: {
    connectionFamily: { value: 'ethernet' },
    accessSpeedMbps: { value: '100' }
  },
  juniper: { details: { status: 'online' } },
  diagnostic: { stage: 'ethernet-errors' }
});
assert.deepEqual(
  Array.from(facts, item => `${item.label}:${item.value}`),
  [
    'Подключение:ETHERNET',
    'Сессия:online',
    'Линк:100 Мбит/с',
    'Диагностика:ethernet-errors'
  ]
);

console.log('appeals_navigator_unit_test: PASS');
