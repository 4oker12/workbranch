import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const originals = {
  window: globalThis.window,
  chrome: globalThis.chrome,
  location: globalThis.location,
  CustomEvent: globalThis.CustomEvent,
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  WB: globalThis.SIMNET_WB
};

const listeners = new Map();
const storageListeners = new Set();
const storageData = {};
let messageMode = 'success';
const messages = [];

try {
  globalThis.window = globalThis;
  globalThis.window.top = globalThis.window;
  globalThis.window.self = globalThis.window;
  globalThis.location = { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=1&pp=SECRET' };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  globalThis.addEventListener = (type, fn) => {
    const set = listeners.get(type) || new Set();
    set.add(fn); listeners.set(type, set);
  };
  globalThis.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  globalThis.dispatchEvent = event => {
    for (const fn of listeners.get(event.type) || []) fn(event);
  };

  globalThis.chrome = {
    runtime: {
      id: 'unit-extension',
      async sendMessage(message) {
        messages.push(message);
        if (messageMode === 'fail') throw new Error('message channel closed before a response was received');
        return { success: true, data: { accepted: true, unreadCount: 1 } };
      }
    },
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) return Object.fromEntries(key.map(k => [k, storageData[k]]));
          return { [key]: storageData[key] };
        },
        async set(values) { Object.assign(storageData, values); }
      },
      onChanged: {
        addListener(fn) { storageListeners.add(fn); },
        removeListener(fn) { storageListeners.delete(fn); }
      }
    }
  };

  delete globalThis.SIMNET_WB;
  vm.runInThisContext(fs.readFileSync(new URL('../src/content/namespace.js', import.meta.url), 'utf8'));
  vm.runInThisContext(fs.readFileSync(new URL('../src/core/observability.js', import.meta.url), 'utf8'));
  const obs = globalThis.SIMNET_WB.observability;
  assert.ok(obs);
  assert.equal(storageListeners.size, 1, 'one diagnostics storage listener should be installed');

  for (let i = 0; i < 250; i += 1) {
    const op = obs.startOperation('SUCCESS_PATH', { i }, { source: 'unit' });
    op.success({ ok: true });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 0, 'successful operations must not persist diagnostics');
  assert.equal(obs.activeCount(), 0);

  const failed = obs.startOperation('WRITEBACK', {}, { source: 'unit', expected: 'field applied' });
  failed.reject('post-condition failed', { code: 'UNIT_POST_CONDITION_FAILED', actual: 'empty' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 1, 'one significant failure should emit one diagnostic message');
  assert.equal(messages[0].type, 'DIAGNOSTICS_REPORT');

  for (let i = 0; i < 120; i += 1) obs.startOperation(`LEAK_${i}`, {}, { source: 'unit' });
  assert.equal(obs.activeCount(), 80, 'unfinished operation map must be hard-bounded');

  messageMode = 'fail';
  await obs.report({ severity: 'ERROR', code: 'RUNTIME_CHANNEL_FAILED', message: 'send failed' });
  assert.ok(Array.isArray(storageData.simnet_workbench_diagnostics_fallback_v1));
  assert.equal(storageData.simnet_workbench_diagnostics_fallback_v1.length, 1);
  assert.equal(storageData.simnet_workbench_diagnostics_fallback_v1[0].url, undefined, 'fallback must not persist raw URL/auth data');

  obs.destroy();
  assert.equal(obs.activeCount(), 0);
  assert.equal(storageListeners.size, 0, 'destroy must remove diagnostics storage listener');
} finally {
  if (originals.window === undefined) delete globalThis.window; else globalThis.window = originals.window;
  if (originals.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = originals.chrome;
  if (originals.location === undefined) delete globalThis.location; else globalThis.location = originals.location;
  if (originals.CustomEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = originals.CustomEvent;
  if (originals.addEventListener === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = originals.addEventListener;
  if (originals.removeEventListener === undefined) delete globalThis.removeEventListener; else globalThis.removeEventListener = originals.removeEventListener;
  if (originals.WB === undefined) delete globalThis.SIMNET_WB; else globalThis.SIMNET_WB = originals.WB;
}

console.log('observability_content_unit_test: PASS');
