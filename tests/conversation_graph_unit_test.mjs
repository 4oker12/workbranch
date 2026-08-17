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

assert.ok(WB.conversationGraphContent, 'conversation presentation API must load');
const scope = WB.conversationGraphContent.presentNode({
  id: 'low.scope',
  kind: 'question',
  title: 'old technical title',
  why: 'old why'
}, 'low_speed');
assert.equal(scope.title, 'На одном устройстве или на всех?');
assert.match(scope.ask, /одном устройстве|на всех/i);

const wifi = WB.conversationGraphContent.presentNode({
  id: 'low.wifi.band',
  kind: 'question',
  title: 'old'
}, 'low_speed');
assert.match(wifi.ask, /5G/i);

const advanced = WB.conversationGraphContent.presentNode({
  id: 'low.direct',
  kind: 'question',
  title: 'old'
}, 'low_speed');
assert.equal(advanced.level, 'advanced');

const rare = WB.conversationGraphContent.presentOption('low.medium.all', {
  id: 'both',
  label: 'both',
  next: 'low.direct'
}, 'low_speed');
assert.equal(rare.tier, 'rare', 'deep control tests stay secondary/rare in the presentation');

const helpers = WB.conversationGraphContent.helperCards({ id: 'low.wifi.band', kind: 'question' }, 'low_speed');
assert.ok(helpers.some(item => item.id === 'ask-simple'));
assert.ok(helpers.some(item => item.id === 'wifi-bands'));
assert.ok(helpers.some(item => item.id === 'smart-connect'));
assert.ok(helpers.some(item => item.id === 'router'));
assert.ok(helpers.length <= 5, 'helper remains compact');

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
  'conversation presentation wraps the existing Graph API before Rail without replacing the loader/editor'
);

for (const token of [
  "const HOST_ID = 'simnet-graph-studio-host'",
  'const baseGraphStudio = WB.graphStudio',
  'return baseGraphStudio.open(options)',
  "await baseGraphStudio.open({ mode: 'runtime' })",
  'WB.graphStudio = publicApi',
  'WB.store.patchAppeal',
  'WB.appeals?.answer',
  'ResizeObserver',
  'disconnect',
  'removeEventListener',
  'cancelAnimationFrame',
  'conv-helper',
  'conv-edges',
  'data-conv-action="rewind"',
  'Смысловая карта',
  'Помощник оператора'
]) assert.ok(runtimeSource.includes(token), `missing runtime contract token: ${token}`);

for (const token of [
  "const HOST_ID = 'simnet-graph-studio-host'",
  'data-action="runtime-open"',
  "WB.graphStudio?.open?.({ mode: 'runtime' })",
  "panel.addEventListener('click', onPanelClick, true)"
]) assert.ok(bridgeSource.includes(token), `missing mode bridge contract token: ${token}`);

assert.ok(!runtimeSource.includes('setInterval'), 'conversation runtime must not poll');
assert.ok(!runtimeSource.includes('MutationObserver'), 'conversation runtime must not observe the CRM DOM');
assert.ok(!runtimeSource.includes('chrome.storage.local.set'), 'answer clicks must not spam UI storage directly');
assert.ok(!runtimeSource.includes("document.createElement('div')"), 'runtime must reuse the existing Graph Studio host');
assert.ok(!runtimeSource.includes('TMC_') && !runtimeSource.includes('poll_current_binding'), 'conversation runtime must not own PON/TMC routing');
assert.ok(!bridgeSource.includes('setInterval') && !bridgeSource.includes('MutationObserver'), 'mode bridge stays event-driven');

console.log('conversation_graph_unit_test: PASS');
