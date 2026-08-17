import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const listeners = [];
const storage = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key in storage) result[key] = structuredClone(storage[key]);
        }
        return result;
      },
      async set(patch) {
        Object.assign(storage, structuredClone(patch));
      }
    }
  },
  runtime: {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    onInstalled: { addListener() {} }
  },
  tabs: { async update(tabId, patch) { return { id: tabId, ...patch }; } },
  windows: { async update(windowId, patch) { return { id: windowId, ...patch }; } }
};

await import(
  pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href
  + `?appeals-store=${Date.now()}`
);

assert.equal(listeners.length, 1);
const sender = { tab: { id: 27, windowId: 3 }, documentId: 'doc-appeal-1', frameId: 0 };
const send = (type, payload) => new Promise((resolve, reject) => {
  const accepted = listeners[0]({ type, payload }, sender, response => {
    if (response?.success) resolve(response.data);
    else reject(new Error(response?.error || 'message failed'));
  });
  assert.equal(accepted, true, `${type} should be asynchronous`);
});

const fact = value => ({ value, source: 'test', confidence: 0.99 });
const contextResult = await send('STORE_APPLY_CONTEXT', {
  context: {
    key: 'billing|billing_user|867',
    system: 'billing',
    pageKind: 'billing_user',
    entityId: '867',
    url: 'https://admin.simnet.kiev.ua/adm.pl?a=user&id=867',
    identity: {
      login: fact('abon8670'),
      contract: fact('8670'),
      billingId: fact('867')
    },
    network: {},
    pon: {},
    profile: {},
    meta: {},
    quality: {}
  }
});

const caseId = contextResult.caseId;
assert.ok(caseId);
const beforeRouteGeneration = contextResult.state.cases[caseId].routeGeneration;

const appeal = {
  schemaVersion: 1,
  typeId: 'low_speed',
  nodeId: 'low.medium.all',
  outcomeId: '',
  status: 'active',
  history: [{
    nodeId: 'low.scope',
    answerId: 'all',
    question: 'На скольких устройствах скорость низкая?',
    answer: 'На всех',
    next: 'low.medium.all',
    at: new Date().toISOString()
  }],
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const patched = await send('STORE_PATCH_APPEAL', {
  caseId,
  appeal,
  transition: {
    action: 'answer',
    question: appeal.history[0].question,
    answer: appeal.history[0].answer
  }
});
assert.equal(patched.accepted, true);
assert.equal(patched.appeal.typeId, 'low_speed');
assert.equal(patched.appeal.nodeId, 'low.medium.all');
assert.equal(patched.state.cases[caseId].journal[0].type, 'appeal');
assert.equal(
  patched.state.cases[caseId].routeGeneration,
  beforeRouteGeneration,
  'answering a question must not change the diagnostic route generation'
);

const foreign = await send('STORE_PATCH_APPEAL', {
  caseId: 'login:another-subscriber',
  appeal,
  transition: { action: 'answer', answer: 'Чужой ответ' }
});
assert.equal(foreign.accepted, false);
assert.equal(foreign.reason, 'foreign-case');
assert.equal(foreign.state.cases[caseId].appeal.nodeId, 'low.medium.all');

const reread = await send('STORE_GET_STATE');
assert.equal(reread.cases[caseId].appeal.history.length, 1);
assert.equal(reread.cases[caseId].appeal.history[0].answer, 'На всех');

console.log('appeals_store_integration_test: PASS');
