import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const loaderSource = fs.readFileSync(path.join(root, 'src/graph/graph-loader.js'), 'utf8');
const studioSource = fs.readFileSync(path.join(root, 'src/graph/graph-studio.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

assert.ok(manifest.content_scripts[0].js.includes('src/graph/graph-loader.js'));
assert.ok(!manifest.content_scripts[0].js.includes('src/graph/graph-studio.js'));
assert.ok(
  manifest.web_accessible_resources[0].resources.includes('src/graph/graph-studio.js'),
  'studio must be web-accessible for fetch'
);

const WB = {
  version: '1.7.29.13',
  appeals: {
    studio: {
      ready: Promise.resolve(),
      bundle: () => ({ draft: { types: [] }, published: { types: [] } }),
      current: () => ({ types: [] })
    },
    graphSnapshot: () => ({ types: [] }),
    normalize: () => ({ status: 'empty', history: [] }),
    typeForState: () => null,
    resolveRuntimeGraph: () => ({ status: 'empty', types: [] })
  },
  store: { activeCase: () => null }
};
const sandbox = {
  SIMNET_WB: WB,
  globalThis: null,
  window: { top: null, self: null, addEventListener() {}, dispatchEvent() {} },
  document: {
    documentElement: {
      appendChild() { return null; }
    },
    createElement: () => {
      const el = {
        style: {},
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        dataset: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        querySelector: () => el,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
        attachShadow: () => ({
          innerHTML: '',
          querySelector: () => el,
          querySelectorAll: () => []
        })
      };
      return el;
    },
    addEventListener() {}
  },
  console,
  fetch: async () => ({
    ok: true,
    status: 200,
    text: async () => studioSource
  }),
  chrome: {
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`
    },
    storage: { local: { get: async () => ({}), set: async () => {} } }
  },
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Boolean,
  Number,
  Set,
  Map,
  Promise,
  clearTimeout() {},
  setTimeout: (fn) => { fn(); return 0; },
  requestAnimationFrame: (fn) => { fn(); return 0; },
  CSS: { escape: (s) => String(s) },
  URL,
  Blob: class Blob { constructor() {} },
  eval: null
};
sandbox.window.top = sandbox.window;
sandbox.window.self = sandbox.window;
sandbox.globalThis = sandbox;
sandbox.eval = (code) => vm.runInContext(code, sandbox);

vm.createContext(sandbox);
vm.runInContext(loaderSource, sandbox);

assert.equal(WB.graphStudio.__lazy, true);
assert.equal(typeof WB.graphStudio.open, 'function');
assert.equal(typeof WB.graphStudio.ensure, 'function');
assert.equal(WB.__graphStudioLoaded, undefined);

// Ensure loads studio and replaces API
await WB.graphStudio.ensure();
assert.equal(WB.__graphStudioLoaded, true);
assert.notEqual(WB.graphStudio.__lazy, true);
assert.equal(typeof WB.graphStudio.open, 'function');
assert.equal(typeof WB.graphStudio.close, 'function');

console.log('graph_loader_unit_test: PASS');
