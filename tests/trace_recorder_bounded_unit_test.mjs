import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/core/operator-trace.js'), 'utf8');
const storage = {};
const listeners = new Map();
const eventTarget = () => ({
  addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
  removeEventListener() {}
});
const document = Object.assign(eventTarget(), {
  nodeType: 9,
  title: 'Billing',
  referrer: '',
  documentElement: {},
  querySelector() { return null; },
  querySelectorAll() { return []; }
});
const window = Object.assign(eventTarget(), {
  scrollY: 0,
  getSelection() { return null; }
});
window.top = window;
window.self = window;
const currentCase = {
  id: 'login:abon1',
  identity: { login: { value: 'abon1' } },
  currentContext: { system: 'billing', pageKind: 'billing_user', entityId: '1' },
  workflow: { operatorTrace: { enabled: false } }
};
const reports = [];
const WB = {
  version: '1.7.29.30',
  runtime: { lastContext: currentCase.currentContext },
  store: { localCaseId: currentCase.id, activeCase: () => currentCase },
  observability: { async report(entry) { reports.push(entry); } },
  actionLifecycle: { current: () => null, inspect: () => null },
  bus: { on() { return () => {}; } },
  log: { info() {} }
};
const chrome = {
  storage: {
    local: {
      async get(keys) {
        const out = {};
        for (const key of keys || []) if (key in storage) out[key] = structuredClone(storage[key]);
        return out;
      },
      async set(values) { Object.assign(storage, structuredClone(values)); }
    }
  }
};
const sandbox = {
  console, window, document, chrome, Blob, URL, Date, Math, JSON, WeakMap, Map, Set,
  setTimeout, clearTimeout,
  performance: { getEntriesByType() { return [{ type: 'navigate' }]; } },
  location: { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?pp=secret', hash: '' },
  innerWidth: 1280, innerHeight: 800,
  SIMNET_WB: WB,
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const trace = sandbox.SIMNET_WB.operatorTrace;
assert.ok(trace, 'trace API exists');

// OFF means no event queue/storage traffic.
assert.equal(trace.recordSystemEvent('ACTION_STATE', { operationId: 'off' }), false);
assert.equal(storage[trace.storageKey], undefined);

trace.setEnabled(true);
for (let i = 0; i < 10_000; i++) {
  trace.recordSystemEvent('UI_CHANGE', {
    operationId: 'op1', semanticTargetId: 'billing.poll.entry',
    mutationType: 'attributes', attribute: 'class', from: 'closed', to: 'open', index: i
  });
}
// Allow any in-flight event-driven flush to finish, then explicitly drain.
await new Promise(resolve => setTimeout(resolve, 500));
for (let i = 0; i < 8; i++) {
  await trace.flush();
  await new Promise(resolve => setTimeout(resolve, 30));
}
const root = storage[trace.storageKey];
assert.ok(root?.sessions, 'trace storage created');
const sessions = Object.values(root.sessions);
assert.equal(sessions.length, 1);
const session = sessions[0];
assert.ok(session.events.length <= 3000, `events bounded: ${session.events.length}`);
assert.ok(session.droppedEventsCount > 0, 'droppedEventsCount reports bounded-memory/ring trimming');
assert.ok(Buffer.byteLength(JSON.stringify(session), 'utf8') <= 1_250_000, 'trace session remains close to configured byte cap');

trace.setEnabled(false);
await new Promise(resolve => setTimeout(resolve, 80));
await trace.flush();
const countAfterStop = Object.values(storage[trace.storageKey].sessions)[0].events.length;
assert.equal(trace.recordSystemEvent('UI_CHANGE', { index: 10001 }), false, 'STOP disables recording');
await new Promise(resolve => setTimeout(resolve, 50));
assert.equal(Object.values(storage[trace.storageKey].sessions)[0].events.length, countAfterStop, 'no event appended after STOP');
assert.equal(reports.filter(x => x?.code === 'TRACE_STORAGE_WRITE_FAILED').length, 0);
console.log('trace_recorder_bounded_unit_test: PASS');
