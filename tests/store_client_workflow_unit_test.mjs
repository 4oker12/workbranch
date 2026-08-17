import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sent = [];
const counters = {};
globalThis.document = { hidden: false };
globalThis.location = { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&id=22019&tmpl=1' };
globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    async sendMessage(message) {
      sent.push(message);
      if (message.type === 'STORE_GET_STATE') {
        return {
          success: true,
          data: {
            meta: { updatedAt: 'v1' },
            activeCaseId: 'case:1',
            cases: { 'case:1': { id: 'case:1', workflow: { ponAcquisition: {} } } }
          }
        };
      }
      assert.equal(message.type, 'STORE_PATCH_WORKFLOW', 'workflow patch must have an explicit message type');
      assert.deepEqual(message.payload, {
        caseId: 'case:1',
        namespace: 'ponAcquisition',
        patch: {
          pollRevealPending: true,
          pollRevealRequestedAt: '2026-08-14T08:20:00.000Z'
        }
      });
      return {
        success: true,
        data: {
          accepted: true,
          state: {
            meta: { updatedAt: 'v2' },
            activeCaseId: 'case:1',
            cases: {
              'case:1': {
                id: 'case:1',
                workflow: { ponAcquisition: { pollRevealPending: true } }
              }
            }
          },
          workflow: { pollRevealPending: true }
        }
      };
    }
  },
  storage: {
    onChanged: {
      addListener() {},
      removeListener() {}
    }
  }
};
globalThis.SIMNET_WB = {
  stateKey: 'simnet_workbench_state_v5',
  runtime: {},
  bus: { emit() {} },
  performanceMonitor: { count(name) { counters[name] = (counters[name] || 0) + 1; } }
};

vm.runInThisContext(fs.readFileSync(new URL('../src/core/store-client.js', import.meta.url), 'utf8'));
await globalThis.SIMNET_WB.store.init();
assert.equal(globalThis.SIMNET_WB.store.bindCase('case:1'), true);
await globalThis.SIMNET_WB.store.patchWorkflow('ponAcquisition', {
  pollRevealPending: true,
  pollRevealRequestedAt: '2026-08-14T08:20:00.000Z'
});

assert.equal(sent.length, 2);
assert.equal(sent[1].type, 'STORE_PATCH_WORKFLOW');
assert.equal(globalThis.SIMNET_WB.store.state.cases['case:1'].workflow.ponAcquisition.pollRevealPending, true);
assert.equal(counters.storageWrites, 1, 'workflow patch is a storage write');


await assert.rejects(
  () => globalThis.SIMNET_WB.store.request(undefined, {}),
  /message type is missing/,
  'undefined message type must be rejected before sendMessage'
);
assert.equal(sent.length, 2, 'missing message type must never reach runtime.sendMessage');

let invalidatedCalled = 0;
globalThis.SIMNET_WB.runtime.invalidateExtensionContext = () => { invalidatedCalled += 1; };
delete globalThis.chrome.runtime.id;
await assert.rejects(
  () => globalThis.SIMNET_WB.store.request('STORE_GET_STATE', {}),
  error => error?.code === 'EXTENSION_CONTEXT_INVALIDATED',
  'stale content script must become an explicit refresh-required state'
);
assert.equal(invalidatedCalled, 1, 'extension invalidation is announced once');

console.log('store_client_workflow_unit_test: PASS');
