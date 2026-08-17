import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const source = fs.readFileSync(path.join(root, 'src/content/bootstrap.js'), 'utf8');

const counters = Object.create(null);
const emissions = [];
let observerCallback = null;
let applyCount = 0;
let holdExternal = false;
let releaseHeld = null;
let contextSerial = 0;

class MutationObserver {
  constructor(cb) { observerCallback = cb; }
  observe() {}
  disconnect() {}
}
class HTMLInputElement {}
class HTMLSelectElement {}
class HTMLTextAreaElement {}

const eventListeners = new Map();
const window = {
  top: null,
  self: null,
  addEventListener(type, fn) {
    const list = eventListeners.get(type) || [];
    list.push(fn);
    eventListeners.set(type, list);
  }
};
window.top = window;
window.self = window;

const documentListeners = new Map();
const document = {
  hidden: false,
  documentElement: {},
  addEventListener(type, fn) {
    const list = documentListeners.get(type) || [];
    list.push(fn);
    documentListeners.set(type, list);
  }
};

const WB = {
  runtime: { booted: false, destroyed: false, documentId: 'doc-A' },
  performanceMonitor: {
    begin() { return () => {}; },
    count(name, amount = 1) { counters[name] = (counters[name] || 0) + amount; },
    mark() {}
  },
  interactionGuards: {
    async waitForUiReady() { return true; },
    isWorkbenchMutation(m) { return Boolean(m.self); },
    isVolatileCrmMutation() { return false; }
  },
  pollTerminal: { scan() {} },
  contextEngine: {
    detect() {
      contextSerial += 1;
      return {
        key: `ctx-${contextSerial}`,
        identity: { login: `abon${contextSerial}` },
        network: {}, pon: {}, profile: {}, meta: {}, quality: {},
        system: 'userside', pageKind: 'userside_customer', entityId: String(contextSerial)
      };
    }
  },
  store: {
    state: {},
    async init() {},
    async applyContext(context) {
      applyCount += 1;
      if (holdExternal && applyCount >= 2) {
        holdExternal = false;
        await new Promise(resolve => { releaseHeld = resolve; });
      }
      return { contextKey: context.key };
    },
    activeCase() { return null; },
    resume() {}, destroy() {}
  },
  handoff: { async init() {} },
  operatorTrace: { init() {}, destroy() {} },
  callRegistration: { destroy() {} },
  rail: { mount() {}, destroy() {}, notifyExtensionContextInvalidated() {} },
  bus: { emit(type, payload) { emissions.push({ type, payload }); } },
  juniper: { maybePrefetch: async () => {} },
  log: { info() {}, warn() {}, error() {}, changed() {} }
};

const sandbox = {
  SIMNET_WB: WB,
  globalThis: null,
  window,
  document,
  location: { hostname: 'userside.simnet.kiev.ua', pathname: '/customer/1' },
  MutationObserver,
  HTMLInputElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Map,
  Set,
  Promise
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await sleep(20);
assert.equal(typeof observerCallback, 'function', 'bootstrap must install its MutationObserver');
assert.equal(counters.scansStarted, 1, 'boot performs exactly one initial scan');
assert.equal(counters.scansCommitted, 1, 'boot scan commits');

// Workbench-owned DOM churn must never schedule a page scan.
const generationBeforeSelf = WB.runtime.scanGeneration();
observerCallback([{ self: true, target: {} }]);
await sleep(180);
assert.equal(WB.runtime.scanGeneration(), generationBeforeSelf, 'Workbench self mutation must not invalidate scan generation');

// Start one external scan and hold it inside applyContext.
holdExternal = true;
observerCallback([{ target: {} }]);
await sleep(165);
assert.ok(releaseHeld, 'external mutation must start a scan');
const emissionsBeforeBurst = emissions.length;

// Twenty more invalidations while RUNNING must collapse to one pending scan.
for (let i = 0; i < 20; i += 1) observerCallback([{ target: { burst: i } }]);
assert.ok((counters.scansCoalesced || 0) >= 19, 'burst invalidations must be coalesced while scan is in flight');
releaseHeld();
await sleep(340);

assert.equal(counters.scansStarted, 3, 'boot + one in-flight scan + one coalesced follow-up only');
assert.equal(counters.scansCommitted, 3, 'ordinary DOM churn must not invalidate the already-running scan');
assert.equal(emissions.length, emissionsBeforeBurst + 2, 'in-flight scan and one trailing scan may both publish distinct contexts');
assert.equal(counters.scansStaleBeforePublish || 0, 0, 'ordinary DOM mutation must not stale a scan; only document invalidation may do so');
assert.equal(counters.scansFailed || 0, 0, 'coalescing must not turn normal stale work into failures');

console.log('scan_scheduler_coalescing_unit_test: PASS');
