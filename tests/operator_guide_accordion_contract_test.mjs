import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const source = read('src/graph/conversation/conversation-guide-accordion.js');
const softSearch = read('src/graph/conversation/conversation-search-soft-match.js');
const manifest = JSON.parse(read('manifest.json'));

new vm.Script(source, { filename: 'conversation-guide-accordion.js' });
new vm.Script(softSearch, { filename: 'conversation-search-soft-match.js' });

for (const token of ['Что спросить', 'Что сделать', 'Зачем спрашиваем', 'Последовательность', 'Проверки и действия', 'data-guide-ux-toggle']) {
  assert.ok(source.includes(token), `accordion UX must include ${token}`);
}

assert.ok(source.includes('queueMicrotask'), 'runtime enhancement should re-apply after synchronous guide rerenders');
assert.ok(source.includes("WB.bus.on('store:state'"), 'runtime enhancement must follow Case-driven rerenders');
assert.ok(source.includes('aria-expanded'), 'accordion must expose disclosure state accessibly');
assert.ok(source.includes('hidden'), 'collapsed content must be removed from visual flow');

for (const forbidden of ['MutationObserver', 'ResizeObserver', 'setInterval', 'requestAnimationFrame', 'getBoundingClientRect', 'fetch(', 'chrome.storage']) {
  assert.ok(!source.includes(forbidden), `accordion enhancement must not use ${forbidden}`);
  assert.ok(!softSearch.includes(forbidden), `soft search enhancement must not use ${forbidden}`);
}

const scripts = manifest.content_scripts[0].js;
const engineIndex = scripts.indexOf('src/graph/conversation/conversation-search-engine.js');
const softIndex = scripts.indexOf('src/graph/conversation/conversation-search-soft-match.js');
const runtimeIndex = scripts.indexOf('src/graph/conversation/conversation-runtime.js');
const controllerIndex = scripts.indexOf('src/graph/conversation/conversation-search-controller.js');
const compactIndex = scripts.indexOf('src/graph/conversation/conversation-visual-compact.js');
const accordionIndex = scripts.indexOf('src/graph/conversation/conversation-guide-accordion.js');
const bridgeIndex = scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js');

assert.ok(engineIndex >= 0 && engineIndex < softIndex && softIndex < runtimeIndex && runtimeIndex < controllerIndex,
  'soft generic search must wrap the engine before the UI controller captures the API');
assert.ok(compactIndex >= 0 && compactIndex < accordionIndex && accordionIndex < bridgeIndex,
  'accordion visual layer must load after approved visual/compact CSS and before the mode bridge');

console.log('operator_guide_accordion_contract_test: PASS');
