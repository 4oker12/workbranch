import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src/graph/conversation/conversation-visual-refresh.js'), 'utf8');

const scripts = manifest.content_scripts[0].js;
const runtimeIndex = scripts.indexOf('src/graph/conversation/conversation-runtime.js');
const visualIndex = scripts.indexOf('src/graph/conversation/conversation-visual-refresh.js');
const bridgeIndex = scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js');
assert.ok(runtimeIndex >= 0 && runtimeIndex < visualIndex && visualIndex < bridgeIndex,
  'visual refresh must load after runtime and before the final graph mode bridge');

for (const required of [
  '.guide-core:before,.guide-core:after',
  '.guide-cloud{width:184px',
  '.guide-brand b{font-size:20px',
  '.guide-side-context{margin-bottom:16px',
  '.guide-question{gap:12px',
  '.layout-scatter:before',
  "revision: 'approved-cloud-visual-v1'"
]) assert.ok(source.includes(required), `missing approved visual token: ${required}`);

for (const forbidden of [
  'MutationObserver',
  'ResizeObserver',
  'setInterval',
  'requestAnimationFrame',
  'getBoundingClientRect'
]) assert.ok(!source.includes(forbidden), `visual-only refresh must stay event-driven: ${forbidden}`);

assert.ok(!source.includes('.guide-tab{'), 'existing tab styling must remain untouched');
assert.ok(!source.includes('.guide-tab.active'), 'existing active tab styling must remain untouched');
assert.ok(!source.includes('.guide-tabs{'), 'existing tab layout must remain untouched');

console.log('operator_guide_visual_refresh_contract_test: PASS');
