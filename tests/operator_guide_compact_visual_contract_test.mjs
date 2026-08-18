import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src/graph/conversation/conversation-visual-compact.js'), 'utf8');

assert.match(source, /@media\(max-height:860px\)/, 'compact mode must be height-responsive');
assert.match(source, /\.guide-board\{min-width:690px;max-width:880px;min-height:390px/, 'board must shrink on constrained height');
assert.match(source, /\.guide-cloud\{width:166px;min-height:82px/, 'clouds must shrink on constrained height');
assert.match(source, /\.guide-core\{width:248px;min-height:142px/, 'central cloud must shrink on constrained height');
assert.ok(!source.includes('.guide-tab{'), 'compact visual override must not restyle tabs');
assert.ok(!source.includes('MutationObserver'), 'compact visual override must not add MutationObserver');
assert.ok(!source.includes('ResizeObserver'), 'compact visual override must not add ResizeObserver');
assert.ok(!source.includes('setInterval'), 'compact visual override must not add polling');
assert.ok(!source.includes('requestAnimationFrame'), 'compact visual override must not add animation loops');
assert.ok(!source.includes('getBoundingClientRect'), 'compact visual override must not measure layout at runtime');

const scripts = manifest.content_scripts[0].js;
const refreshIndex = scripts.indexOf('src/graph/conversation/conversation-visual-refresh.js');
const compactIndex = scripts.indexOf('src/graph/conversation/conversation-visual-compact.js');
const modeBridgeIndex = scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js');
assert.ok(refreshIndex >= 0 && refreshIndex < compactIndex && compactIndex < modeBridgeIndex,
  'compact override must load after visual refresh and before mode bridge');

console.log('operator_guide_compact_visual_contract_test: PASS');
