import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'src/graph/conversation/conversation-search-controller.js'), 'utf8');

class FakeClassList {
  constructor(initial = []) { this.values = new Set(initial); }
  add(...items) { items.forEach(item => this.values.add(item)); }
  remove(...items) { items.forEach(item => this.values.delete(item)); }
  contains(item) { return this.values.has(item); }
}
class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, event = {}) { for (const handler of [...(this.listeners.get(type) || [])]) handler(event); }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}
class FakeNode extends FakeEventTarget {
  constructor(kind = 'node') {
    super(); this.kind = kind; this.classList = new FakeClassList(); this.dataset = {}; this.value = ''; this.textContent = '';
    this.isConnected = true; this.searchRow = null; this.input = null; this.status = null; this.tabs = new Map(); this.clouds = new Map();
  }
  closest(selector) { if (selector === '[data-guide-search-input]' && this.dataset.guideSearchInput !== undefined) return this; return null; }
  contains(node) { return node === this.input || node === this.searchRow?.input || node === rootNode?.searchRow?.input || node === this; }
  querySelector(selector) {
    if (selector === '.module' && this.kind === 'shadow') return panel;
    if (selector === '.guide-root' && this.kind === 'panel') return rootNode;
    if (selector === '.guide-tabs' && this.kind === 'root') return tabsNode;
    if (selector === '[data-guide-search-host]' && this.kind === 'root') return this.searchRow;
    if (selector === '[data-guide-search-input]') return this.input || this.searchRow?.input || rootNode.searchRow?.input || null;
    if (selector === '[data-guide-search-status]') return this.status || this.searchRow?.status || rootNode.searchRow?.status || null;
    const topic = selector.match(/^\.guide-tab\[data-topic-id="(.+)"\]$/); if (topic) return panel.tabs.get(topic[1]) || null;
    const cloud = selector.match(/^\.guide-cloud\[data-symptom-id="(.+)"\]$/); if (cloud) return panel.clouds.get(cloud[1]) || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '.guide-tab.search-topic-match') return [...panel.tabs.values()].filter(node => node.classList.contains('search-topic-match'));
    if (selector.includes('.guide-cloud.search-match-high')) return [...panel.clouds.values()].filter(node => ['search-match-high', 'search-match-medium', 'search-match-low'].some(item => node.classList.contains(item)));
    return [];
  }
  insertAdjacentElement(_position, row) { rootNode.searchRow = row; row.isConnected = true; return row; }
}

const panel = new FakeNode('panel'), rootNode = new FakeNode('root'), tabsNode = new FakeNode('tabs'), shadow = new FakeNode('shadow');
const host = { shadowRoot: shadow };
shadow.styleInstalled = false;
shadow.getElementById = () => shadow.styleInstalled ? {} : null;
shadow.appendChild = () => { shadow.styleInstalled = true; };
for (const topicId of ['low_speed', 'no_internet', 'unstable', 'other']) { const node = new FakeNode('tab'); node.dataset.topicId = topicId; panel.tabs.set(topicId, node); }
for (const symptomId of ['logout_or_crash', 'work_software_only', 'regular_internet_ok']) { const node = new FakeNode('cloud'); node.dataset.symptomId = symptomId; panel.clouds.set(symptomId, node); }

let createdSearchRows = 0;
const document = {
  getElementById: id => id === 'simnet-graph-studio-host' ? host : null,
  createElement: tag => {
    assert.equal(tag, 'template');
    const template = { _html: '', content: { firstElementChild: null, cloneNode: () => ({ style: true }) } };
    Object.defineProperty(template, 'innerHTML', {
      get: () => template._html,
      set: value => {
        template._html = value;
        if (String(value).includes('<div class="guide-search-row"')) {
          createdSearchRows += 1;
          const row = new FakeNode('search-row'), input = new FakeNode('input'), status = new FakeNode('status');
          input.dataset.guideSearchInput = ''; row.input = input; row.status = status;
          row.querySelector = selector => selector === '[data-guide-search-input]' ? input : selector === '[data-guide-search-status]' ? status : null;
          template.content.firstElementChild = row;
        }
      }
    });
    return template;
  }
};

const window = new FakeEventTarget();
let runtimeActive = false, activeTopic = 'other', currentCase = { id: 'case-1' };
const busListeners = new Set();
const bus = {
  on(type, handler) { assert.equal(type, 'store:state'); busListeners.add(handler); return () => busListeners.delete(handler); },
  emitStore() { [...busListeners].forEach(handler => handler()); }
};
let searchCalls = 0;
const searchApi = { search(query) { searchCalls += 1; return query.includes('выкидывает') ? [
  { topicId: 'other', symptomId: 'logout_or_crash', score: 0.91, reasons: ['keyword: выкидывает'] },
  { topicId: 'other', symptomId: 'work_software_only', score: 0.51, reasons: ['environment: work_app'] }
] : []; } };

const timerCallbacks = new Map(); let nextTimerId = 1;
const setTimeoutFake = callback => { const id = nextTimerId++; timerCallbacks.set(id, callback); return id; };
const clearTimeoutFake = id => timerCallbacks.delete(id);
const WB = {
  operatorGuideSearch: searchApi,
  conversationGraphRuntime: { isActive: () => runtimeActive, activeTopic: () => activeTopic },
  store: { activeCase: () => currentCase }, bus
};
const sandbox = {
  SIMNET_WB: WB, globalThis: null, window, document, CSS: { escape: value => String(value) }, Object, Array, String, Number, Boolean, Set, Map, Math, console,
  queueMicrotask, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'conversation-search-controller.js' });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

assert.ok(WB.operatorGuideSearchUi, 'search UI lifecycle API must load');
assert.equal(window.listenerCount('simnet-workbench-module-open'), 1);
assert.equal(window.listenerCount('simnet-workbench-module-close'), 1);
runtimeActive = true;
window.dispatch('simnet-workbench-module-open', { detail: { module: 'graph', mode: 'runtime' } });
await flush();

let stats = WB.operatorGuideSearchUi.stats();
assert.equal(stats.active, true); assert.equal(stats.hasInputListener, true); assert.equal(stats.hasClickListener, true); assert.equal(stats.hasStoreSubscription, true);
assert.equal(panel.listenerCount('input'), 1); assert.equal(panel.listenerCount('click'), 1); assert.equal(busListeners.size, 1); assert.equal(createdSearchRows, 1);

const input = rootNode.searchRow.input;
input.value = 'рабочая программа выкидывает'; panel.dispatch('input', { target: input });
assert.equal(timerCallbacks.size, 1, 'only one debounce timer may be pending');
assert.equal(WB.operatorGuideSearchUi.stats().debouncePending, true);
const staleCallback = [...timerCallbacks.values()][0];
input.value = 'рабочая программа выкидывает снова'; panel.dispatch('input', { target: input });
assert.equal(timerCallbacks.size, 1, 'new input must cancel the previous debounce timer');
const searchCallsBeforeStale = searchCalls; staleCallback();
assert.equal(searchCalls, searchCallsBeforeStale, 'stale generation must not execute an old search');
const latestCallback = [...timerCallbacks.values()][0]; timerCallbacks.clear(); latestCallback();
assert.equal(searchCalls, searchCallsBeforeStale + 1); assert.equal(WB.operatorGuideSearchUi.stats().resultCount, 2);
assert.ok(panel.clouds.get('logout_or_crash').classList.contains('search-match-high'));
assert.ok(panel.tabs.get('other').classList.contains('search-topic-match'));
assert.equal(createdSearchRows, 1, 'typing must not create additional persistent DOM nodes');

for (let index = 0; index < 100; index += 1) {
  input.value = `рабочая программа выкидывает ${index}`; panel.dispatch('input', { target: input });
  const callback = [...timerCallbacks.values()][0]; timerCallbacks.clear(); callback();
}
assert.equal(createdSearchRows, 1, '100 UI searches must reuse the same search DOM');
assert.equal(panel.listenerCount('input'), 1); assert.equal(panel.listenerCount('click'), 1);

input.value = ''; panel.dispatch('input', { target: input });
assert.equal(timerCallbacks.size, 0); assert.equal(WB.operatorGuideSearchUi.stats().resultCount, 0);
assert.equal(panel.clouds.get('logout_or_crash').classList.contains('search-match-high'), false);
assert.equal(panel.tabs.get('other').classList.contains('search-topic-match'), false);

input.value = 'рабочая программа выкидывает'; panel.dispatch('input', { target: input });
const pending = [...timerCallbacks.values()][0]; timerCallbacks.clear(); pending();
assert.equal(WB.operatorGuideSearchUi.stats().resultCount, 2);
currentCase = { id: 'case-2' }; bus.emitStore(); await flush();
stats = WB.operatorGuideSearchUi.stats();
assert.equal(stats.queryLength, 0, 'Case change must forget the query'); assert.equal(stats.resultCount, 0, 'Case change must clear results'); assert.equal(stats.debouncePending, false);
assert.equal(panel.clouds.get('logout_or_crash').classList.contains('search-match-high'), false);

window.dispatch('simnet-workbench-module-close', { detail: { module: 'graph' } });
stats = WB.operatorGuideSearchUi.stats();
assert.equal(stats.active, false); assert.equal(stats.queryLength, 0); assert.equal(stats.resultCount, 0); assert.equal(stats.debouncePending, false);
assert.equal(stats.hasInputListener, false); assert.equal(stats.hasClickListener, false); assert.equal(stats.hasStoreSubscription, false);
assert.equal(panel.listenerCount('input'), 0); assert.equal(panel.listenerCount('click'), 0); assert.equal(busListeners.size, 0); assert.equal(timerCallbacks.size, 0);

runtimeActive = true;
window.dispatch('simnet-workbench-module-open', { detail: { module: 'graph', mode: 'runtime' } });
await flush();
stats = WB.operatorGuideSearchUi.stats();
assert.equal(stats.active, true); assert.equal(stats.queryLength, 0, 'reopen must start with a fresh query'); assert.equal(stats.resultCount, 0);
assert.equal(panel.listenerCount('input'), 1, 'open-close-open must not grow input listeners');
assert.equal(panel.listenerCount('click'), 1, 'open-close-open must not grow click listeners');
assert.equal(busListeners.size, 1, 'open-close-open must not grow store subscriptions');

for (const forbiddenToken of ['MutationObserver', 'ResizeObserver', 'setInterval', 'requestAnimationFrame', 'getBoundingClientRect', 'fetch(', 'chrome.storage', 'runtime.sendMessage', 'WB.graphStudio =', 'WB.bus.emit', 'WB.log.']) assert.ok(!source.includes(forbiddenToken), `search UI must not contain ${forbiddenToken}`);
assert.equal((source.match(/setTimeout\(/g) || []).length, 1, 'search UI may own only the debounce timeout');
assert.ok(source.includes("removeEventListener('input'")); assert.ok(source.includes("removeEventListener('click'")); assert.ok(source.includes('generation !== state.generation'));
assert.ok(source.includes('UI_MAX_RESULTS = 4')); assert.ok(source.includes('HIGH_THRESHOLD')); assert.ok(source.includes('MEDIUM_THRESHOLD')); assert.ok(source.includes('LOW_THRESHOLD'));

console.log('operator_guide_search_lifecycle_test: PASS');
