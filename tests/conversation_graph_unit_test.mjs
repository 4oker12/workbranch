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

const WB = {};
const sandbox = { SIMNET_WB: WB, globalThis: null, JSON, Object, Array, String, Set, Map, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(contentSource, sandbox, { filename: 'conversation-content.js' });

assert.ok(WB.conversationGraphContent, 'operator guide content API must load');
assert.equal(WB.conversationGraphContent.revision, 'operator-guide-tabs-v2');

const topics = WB.conversationGraphContent.topics();
assert.deepEqual(
  topics.map(item => item.id),
  ['low_speed', 'no_internet', 'unstable', 'other'],
  'approved top-level complaint tabs must stay stable'
);

const slow = WB.conversationGraphContent.topic('low_speed');
assert.equal(slow.label, 'Медленная скорость');
assert.match(slow.complaint, /Медленная/);
assert.ok(slow.variants.some(item => /медленно|тупит/i.test(item)), 'slow-speed tab contains subscriber wording variants');
assert.ok(slow.questions.some(item => /устройств/i.test(item)), 'slow-speed tab contains scope question');
assert.ok(slow.meaning.length >= 3, 'slow-speed tab explains why questions matter');

const none = WB.conversationGraphContent.topic('no_internet');
assert.equal(none.label, 'Нет интернета');
assert.ok(none.variants.some(item => /ничего не открывается/i.test(item)), 'no-internet tab has its own complaint cloud wording');
assert.ok(none.questions.some(item => /Wi‑Fi|Wi-Fi/i.test(item)), 'no-internet tab has its own question set');
assert.notDeepEqual(none.questions, slow.questions, 'switching tab must materially change the scenario');

assert.equal(WB.conversationGraphContent.normalizeTopicId('missing'), 'low_speed');

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
  'operator guide wraps the existing Graph host before Rail without replacing the loader/editor'
);

for (const token of [
  "const HOST_ID = 'simnet-graph-studio-host'",
  'const baseGraphStudio = WB.graphStudio',
  "await baseGraphStudio.open({ mode: 'runtime' })",
  'WB.graphStudio = publicApi',
  'data-guide-action="topic"',
  'guide-tabs',
  'guide-cloud',
  'guide-core',
  'Что спросить',
  'Что это нам даёт',
  'Пособие оператора',
  'Это не диагностический граф',
  'removeEventListener',
  "document.createElement('template')",
  'state.shadow.appendChild'
]) assert.ok(runtimeSource.includes(token), `missing operator-guide contract token: ${token}`);

for (const forbidden of [
  'WB.store.patchAppeal',
  'WB.appeals?.answer',
  'data-conv-action="answer"',
  'data-conv-action="rewind"',
  'Шаг ',
  'Следующий шаг'
]) assert.ok(!runtimeSource.includes(forbidden), `operator guide must not lead diagnostics: ${forbidden}`);

for (const token of [
  "const HOST_ID = 'simnet-graph-studio-host'",
  'data-action="runtime-open"',
  "WB.graphStudio?.open?.({ mode: 'runtime' })",
  "panel.addEventListener('click', onPanelClick, true)"
]) assert.ok(bridgeSource.includes(token), `missing mode bridge contract token: ${token}`);

assert.ok(!runtimeSource.includes('setInterval'), 'operator guide must not poll');
assert.ok(!runtimeSource.includes('MutationObserver'), 'operator guide must not observe CRM DOM');
assert.ok(!runtimeSource.includes('chrome.storage.local.set'), 'tab clicks are UI-only and must not spam storage');
assert.ok(!runtimeSource.includes("document.createElement('div')"), 'runtime must reuse the existing Graph Studio host');
assert.ok(!runtimeSource.includes('TMC_') && !runtimeSource.includes('poll_current_binding'), 'operator guide must not own PON/TMC routing');

console.log('conversation_graph_unit_test: PASS');
