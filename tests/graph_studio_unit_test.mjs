import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/ui/appeals-navigator.js'), 'utf8');
const storage = {};
const storageListeners = [];
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  SIMNET_WB: { bus: { emit() {} } },
  chrome: {
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const key of keys) if (key in storage) result[key] = structuredClone(storage[key]);
          return result;
        },
        async set(patch) { Object.assign(storage, structuredClone(patch)); }
      },
      onChanged: { addListener(listener) { storageListeners.push(listener); } }
    }
  }
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'appeals-navigator.js' });

const appeals = sandbox.SIMNET_WB.appeals;
await appeals.studio.ready;
const builtin = appeals.studio.builtin();
const builtinCheck = appeals.studio.validate(builtin);
assert.equal(builtinCheck.valid, true);
assert.deepEqual({ ...builtinCheck.stats }, { types: 5, nodes: 50, edges: 60 });

const pinned = appeals.select('low_speed');
assert.equal(pinned.graphRevision, 'builtin-1');
assert.equal(pinned.graphType.id, 'low_speed');

const broken = structuredClone(builtin);
broken.types[0].nodes['low.scope'].options[0].next = 'missing.node';
assert.equal(appeals.studio.validate(broken).valid, false);
assert.match(appeals.studio.validate(broken).errors.join('\n'), /целевой узел/);

const cycle = structuredClone(builtin);
cycle.types[0].nodes['low.scope'].options[0].next = 'low.scope';
assert.equal(appeals.studio.validate(cycle).valid, false);
assert.match(appeals.studio.validate(cycle).errors.join('\n'), /цикл/);

const custom = structuredClone(builtin);
custom.types.push({
  id: 'ethernet_demo',
  label: 'Ethernet demo',
  short: 'Проверка условий перехода',
  first: 'ethernet_demo.start',
  phases: [
    { id: 'check', label: 'Проверка' },
    { id: 'result', label: 'Гипотеза' }
  ],
  nodes: {
    'ethernet_demo.start': {
      id: 'ethernet_demo.start',
      kind: 'question',
      phase: 'check',
      title: 'Тип подключения уже подтверждён?',
      why: 'Условие использует факт кейса.',
      options: [
        {
          id: 'ethernet',
          label: 'Ethernet',
          next: 'ethernet_demo.done',
          hint: 'Идём к порту',
          condition: { fact: 'connectionFamily', operator: 'equals', value: 'ethernet' }
        },
        {
          id: 'unknown',
          label: 'Не определено',
          next: 'ethernet_demo.done',
          hint: 'Уточнить доступ',
          condition: { fact: 'connectionFamily', operator: 'not_exists', value: '' }
        }
      ]
    },
    'ethernet_demo.done': {
      id: 'ethernet_demo.done',
      kind: 'outcome',
      phase: 'result',
      title: 'Проверить Ethernet-порт',
      summary: 'Тип доступа подтверждён.',
      nextAction: 'Открыть LIVE.',
      focus: 'ethernet'
    }
  }
});

const draftResult = await appeals.studio.saveDraft(broken);
assert.equal(draftResult.valid, false, 'invalid draft may be saved for later repair');
assert.equal(appeals.graphRevision(), 'builtin-1', 'draft must not replace runtime graph');

const publishResult = await appeals.studio.publish(custom);
assert.equal(publishResult.published, true);
assert.notEqual(appeals.graphRevision(), 'builtin-1');
assert.ok(appeals.types.some(item => item.id === 'ethernet_demo'));

const current = appeals.select('ethernet_demo');
assert.equal(
  appeals.availableOptions(current, { network: { connectionFamily: { value: 'ethernet' } } })[0].id,
  'ethernet'
);
assert.equal(
  appeals.availableOptions(current, { network: {} })[0].id,
  'unknown'
);

const pinnedAfterPublish = appeals.answer(pinned, 'all');
assert.equal(pinnedAfterPublish.graphRevision, 'builtin-1');
assert.equal(pinnedAfterPublish.graphType.id, 'low_speed');
assert.equal(pinnedAfterPublish.nodeId, 'low.medium.all');

assert.equal(storageListeners.length, 1);
assert.ok(storage[appeals.studio.storageKey].history.length >= 2);

console.log('graph_studio_unit_test: PASS');
