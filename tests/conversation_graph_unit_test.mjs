import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const contentSource = fs.readFileSync(path.join(root, 'src/graph/conversation/conversation-content.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'src/graph/conversation/conversation-runtime.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'src/graph/conversation/conversation-mode-bridge.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function loadContent(sandboxExtra = {}) {
  const WB = {};
  const sandbox = { SIMNET_WB: WB, globalThis: null, JSON, Object, Array, String, Set, Map, console, ...sandboxExtra };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(contentSource, sandbox, { filename: 'conversation-content.js' });
  return { WB, sandbox };
}

{
  const { WB } = loadContent();
  const handbook = WB.conversationGraphContent;
  assert.ok(handbook, 'operator handbook content API must load');
  assert.equal(handbook.revision, 'operator-handbook-content-v1');

  const labels = handbook.topics().map(item => item.label);
  for (const expected of ['Нет интернета', 'Медленно', 'Пропадает', 'На телефоне', 'Wi‑Fi', 'Видео / TV', 'Игры', 'Сайты', 'Роутер', 'VPN / DNS', 'Прямое подключение']) {
    assert.ok(labels.includes(expected), `missing handbook topic: ${expected}`);
  }

  assert.ok(handbook.topics('телевизор').some(item => item.id === 'video_tv'), 'search should find TV/video scenario');
  assert.ok(handbook.topics('вечером').some(item => item.id === 'evening'), 'search should find time-of-day scenario');

  const slow = handbook.compose(['slow']);
  assert.ok(slow.questions.some(text => /в ч[её]м именно.*прояв/i.test(text)), 'slow complaint must start from observable manifestation');
  assert.ok(slow.questions.some(text => /другом устройстве/i.test(text)), 'slow complaint should suggest comparison');

  const phone = handbook.compose(['phone']);
  assert.ok(phone.questions.some(text => /другой телефон|другом устройстве|ноутбук/i.test(text)), 'phone topic should offer a second-device comparison');
  assert.ok(phone.questions.some(text => /браузер/i.test(text)), 'phone topic should include browser comparison');
  assert.ok(phone.questions.some(text => /VPN|Private DNS|AdGuard/i.test(text)), 'phone topic should include VPN/DNS checks');
  assert.ok(!phone.checks.some(text => /PoE/i.test(text)), 'irrelevant PoE help must not be globally injected');

  const wifi = handbook.compose(['wifi']);
  assert.ok(wifi.questions.some(text => /5G|5GHz/i.test(text)), 'Wi-Fi topic should explain 5G using SSID language');
  assert.ok(wifi.questions.some(text => /наз.*сет|сеть.*наз/i.test(text)), 'Wi-Fi topic should ask for the visible network name');

  const reboot = handbook.compose(['reboot']);
  assert.ok(reboot.hooks.some(text => /не.*доказ|не 100%/i.test(text)), 'reboot must remain a clue, not a false proof');

  const combined = handbook.compose(['slow', 'phone', 'wifi']);
  assert.ok(combined.questions.length <= 10, 'question arsenal must stay bounded');
  assert.ok(combined.checks.length <= 8, 'check arsenal must stay bounded');
}

const scripts = manifest.content_scripts[0].js;
const studioIndex = scripts.indexOf('src/graph/graph-studio.js');
const contentIndex = scripts.indexOf('src/graph/conversation/conversation-content.js');
const runtimeIndex = scripts.indexOf('src/graph/conversation/conversation-runtime.js');
const bridgeIndex = scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js');
const railIndex = scripts.indexOf('src/ui/rail.js');
assert.ok(
  studioIndex >= 0
  && studioIndex < contentIndex
  && contentIndex < runtimeIndex
  && runtimeIndex < bridgeIndex
  && bridgeIndex < railIndex,
  'operator handbook wraps the existing Graph API before Rail without replacing loader/editor'
);

for (const token of [
  "const HOST_ID = 'simnet-graph-studio-host'",
  'const baseGraphStudio = WB.graphStudio',
  'return baseGraphStudio.open(options)',
  "await baseGraphStudio.open({ mode: 'runtime' })",
  'WB.graphStudio = publicApi',
  'WB.operatorHandbookRuntime = debugApi',
  'Пособие оператора',
  'Что спросить',
  'За что зацепиться',
  'Как сказать проще',
  'handbook-topic',
  'border-radius:999px',
  "document.createElement('template')",
  'state.shadow.appendChild',
  'removeEventListener'
]) assert.ok(runtimeSource.includes(token), `missing handbook runtime contract token: ${token}`);

for (const forbidden of [
  'setInterval',
  'MutationObserver',
  'chrome.storage.local.set',
  'state.shadow.insertAdjacentHTML',
  'WB.store.patchAppeal',
  'WB.appeals?.answer',
  'conv-preview',
  'К ЧЕМУ ВЕДЁТ',
  'РАСШИРЕННАЯ ВЕТКА'
]) assert.ok(!runtimeSource.includes(forbidden), `forbidden handbook runtime token: ${forbidden}`);

for (const token of [
  "const HOST_ID = 'simnet-graph-studio-host'",
  'data-action="runtime-open"',
  "WB.graphStudio?.open?.({ mode: 'runtime' })",
  "panel.addEventListener('click', onPanelClick, true)"
]) assert.ok(bridgeSource.includes(token), `missing mode bridge contract token: ${token}`);
assert.ok(!bridgeSource.includes('setInterval') && !bridgeSource.includes('MutationObserver'), 'mode bridge stays event-driven');

// Minimal DOM lifecycle integration: catches unsupported ShadowRoot APIs and verifies
// that the existing Graph host is actually replaced by the handbook runtime.
{
  class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...items) { items.forEach(item => this.values.add(item)); }
    remove(...items) { items.forEach(item => this.values.delete(item)); }
    contains(item) { return this.values.has(item); }
  }

  const listeners = new Map();
  const panel = {
    innerHTML: '<div>OLD GRAPH RUNTIME</div>',
    classList: new FakeClassList(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    querySelector() { return null; }
  };

  let styleNode = null;
  const shadow = {
    querySelector(selector) { return selector === '.module' ? panel : null; },
    getElementById(id) { return styleNode?.id === id ? styleNode : null; },
    appendChild(node) { styleNode = node; return node; }
  };
  const host = { shadowRoot: shadow };

  const document = {
    getElementById(id) { return id === 'simnet-graph-studio-host' ? host : null; },
    createElement(tag) {
      assert.equal(tag, 'template', 'runtime style mount should use a template');
      const template = { content: { firstElementChild: null } };
      Object.defineProperty(template, 'innerHTML', {
        set(value) {
          const match = String(value).match(/<style id="([^"]+)"/);
          template.content.firstElementChild = { id: match?.[1] || '', textContent: String(value) };
        }
      });
      return template;
    }
  };

  const windowListeners = new Map();
  const window = { addEventListener(type, handler) { windowListeners.set(type, handler); } };
  let baseOpenMode = '';
  let baseClosed = false;
  const unsubscribe = () => {};
  const WB = {
    graphStudio: {
      async open(options) { baseOpenMode = options?.mode || ''; },
      close() { baseClosed = true; },
      isOpen() { return true; },
      mode() { return 'runtime'; }
    },
    store: { activeCase: () => ({ identity: { login: { value: 'abonTEST' } } }) },
    bus: { on: () => unsubscribe }
  };

  const sandbox = { SIMNET_WB: WB, globalThis: null, JSON, Object, Array, String, Set, Map, console, document, window };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(contentSource, sandbox, { filename: 'conversation-content.js' });
  vm.runInContext(runtimeSource, sandbox, { filename: 'conversation-runtime.js' });

  await WB.graphStudio.open({ mode: 'runtime' });
  assert.equal(baseOpenMode, 'runtime', 'handbook must reuse the real Graph Studio runtime host');
  assert.ok(styleNode?.id === 'simnet-operator-handbook-style', 'handbook CSS should mount into ShadowRoot using supported DOM APIs');
  assert.match(panel.innerHTML, /Пособие оператора/);
  assert.match(panel.innerHTML, /Нет интернета/);
  assert.match(panel.innerHTML, /Медленно/);
  assert.match(panel.innerHTML, /Что спросить/);
  assert.ok(!panel.innerHTML.includes('OLD GRAPH RUNTIME'), 'old graph runtime must be replaced');
  assert.equal(WB.graphStudio.mode(), 'runtime');
  assert.equal(WB.operatorHandbookRuntime.revision, 'operator-handbook-runtime-v1');
  assert.deepEqual([...WB.operatorHandbookRuntime.selectedTopics()], ['slow']);
  assert.ok(listeners.has('click') && listeners.has('input'), 'handbook event delegation must be installed');

  const click = listeners.get('click');
  click({
    preventDefault() {}, stopPropagation() {},
    target: { closest: () => ({ dataset: { handbookAction: 'topic', topicId: 'phone' } }) }
  });
  assert.ok(WB.operatorHandbookRuntime.selectedTopics().includes('phone'), 'topic selection should be local and non-linear');
  assert.match(panel.innerHTML, /На телефоне/);
  assert.match(panel.innerHTML, /другом устройстве|другой телефон|ноутбук/i);

  WB.graphStudio.close();
  assert.equal(baseClosed, true, 'close must delegate to the original Graph Studio');
  assert.ok(!listeners.has('click') && !listeners.has('input'), 'handbook listeners must teardown on close');
}

console.log('conversation_graph_unit_test: PASS');
