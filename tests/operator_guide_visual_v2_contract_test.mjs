import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const source = read('src/graph/conversation/conversation-guide-visual-v2.js');
const manifest = JSON.parse(read('manifest.json'));

new vm.Script(source, { filename: 'conversation-guide-visual-v2.js' });

for (const token of [
  '--accent:#A50046',
  '.guide-cloud.search-match-high:not(.active)',
  '.guide-cloud.active',
  '.guide-side.guide-ux-side',
  '.guide-ux-panel-inner',
  '.guide-ux-recommended'
]) {
  assert.ok(source.includes(token), `visual v2 must include ${token}`);
}

for (const forbidden of ['MutationObserver', 'ResizeObserver', 'setInterval', 'requestAnimationFrame', 'getBoundingClientRect', 'fetch(', 'chrome.storage']) {
  assert.ok(!source.includes(forbidden), `visual-only layer must not use ${forbidden}`);
}

const scripts = manifest.content_scripts[0].js;
const accordionIndex = scripts.indexOf('src/graph/conversation/conversation-guide-accordion.js');
const visualV2Index = scripts.indexOf('src/graph/conversation/conversation-guide-visual-v2.js');
const bridgeIndex = scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js');
assert.ok(accordionIndex >= 0 && accordionIndex < visualV2Index && visualV2Index < bridgeIndex,
  'visual v2 must override approved accordion/legacy visual CSS before the mode bridge');

assert.ok(!source.includes("title: '"), 'visual-only layer must not define or replace guidance content');
assert.ok(!source.includes('data-guide-ux-toggle'), 'visual-only layer must not own accordion interaction mechanics');

console.log('operator_guide_visual_v2_contract_test: PASS');
