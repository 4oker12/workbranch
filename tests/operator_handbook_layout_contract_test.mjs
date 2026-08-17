import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src/graph/conversation/operator-handbook-layout-fix.js'), 'utf8');

const scripts = manifest.content_scripts[0].js;
const runtimeIndex = scripts.indexOf('src/graph/conversation/conversation-runtime.js');
const fixIndex = scripts.indexOf('src/graph/conversation/operator-handbook-layout-fix.js');
const bridgeIndex = scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js');

assert.ok(runtimeIndex >= 0 && fixIndex > runtimeIndex && bridgeIndex > fixIndex,
  'handbook layout ownership fix must load after runtime and before bridge');
assert.match(source, /\.module\.handbook-mode\s*\{[\s\S]*display:\s*block\s*!important/i,
  'handbook mode must disable the base Graph Studio two-row grid');
assert.match(source, /grid-template-rows:\s*none\s*!important/i,
  'base Graph Studio row contract must not constrain the handbook root');
assert.match(source, />\s*\.handbook-root[\s\S]*height:\s*100%/i,
  'handbook root must own the full panel height');
assert.ok(source.includes('simnet-workbench-module-open'),
  'layout fix must re-apply on Graph open lifecycle');
assert.ok(!source.includes('setInterval'), 'layout fix must remain event-driven');
assert.ok(!source.includes('MutationObserver'), 'layout fix must not observe CRM DOM');

console.log('operator_handbook_layout_contract_test: PASS');
