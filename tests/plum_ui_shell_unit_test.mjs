import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, '..', relative), 'utf8');
const rail = read('src/ui/rail.js');
const call = read('src/ui/call-registration.js');
const graph = read('src/graph/graph-studio.js');

for (const token of [
  "this.activeView = null",
  "this.viewButton('call', 'call-registration'",
  "this.viewButton('graph', 'view-graph'",
  "this.viewButton('live', 'view-live'",
  "this.viewButton('full', 'view-full'",
  "simnet-workbench-module-open",
  "simnet-workbench-module-close",
  "fullNav(section)",
  "--plum:#A50046",
  "view-backdrop"
]) assert.ok(rail.includes(token), `missing shell token: ${token}`);

assert.match(rail, /rail-stack[\s\S]*call-registration[\s\S]*view-graph[\s\S]*view-live/);
assert.match(rail, /view-full/);
assert.doesNotMatch(rail, /this\.hoverOpen && !this\.guideActive/);
assert.doesNotMatch(rail, /document\.body\.style\.paddingRight/);
assert.match(rail, /right: '12px'[\s\S]*bottom: '18px'/);
assert.match(rail, /\.rail\{[\s\S]*background:transparent[\s\S]*box-shadow:none/);
assert.doesNotMatch(rail, /brand-mark\" title=\"SIMNET Workbench/);

for (const token of [
  'place-items:center',
  '--plum:#A50046',
  'simnet-workbench-module-open',
  'simnet-workbench-module-close',
  'UserSide'
]) assert.ok(call.includes(token), `missing call shell token: ${token}`);

for (const token of [
  '--plum:#A50046',
  'width:min(90vw,1540px)',
  'height:88vh',
  'class="backdrop"',
  'simnet-workbench-module-close'
]) assert.ok(graph.includes(token), `missing graph shell token: ${token}`);

// Floating Graph launcher removed: open only via RAIL.
assert.ok(graph.includes('No floating launcher') || graph.includes('state.launcher = null'));
assert.ok(graph.includes("state.shadow?.querySelector('.backdrop')?.classList.add('open')"));
assert.ok(graph.includes("state.shadow?.querySelector('.backdrop')?.classList.remove('open')"));

for (const token of [
  "mode: 'runtime'",
  'renderRuntime',
  'renderRuntimeMinimap',
  'resolveRuntimeGraph',
  "open?.({ mode: 'runtime' })"
]) assert.ok((rail + graph).includes(token), `missing runtime graph token: ${token}`);
// Operator UI must open Diagnostic Graph (runtime), not Studio editor.
assert.ok(rail.includes("mode: 'runtime'"));
assert.ok(!rail.includes("mode: 'studio'"), 'RAIL must not open Graph Studio editor');

console.log('plum_ui_shell_unit_test: PASS');
