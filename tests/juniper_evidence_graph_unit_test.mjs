import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const background = read('src/background.js');
const prefetch = read('src/core/juniper-prefetch.js');
const evidence = read('src/core/evidence-navigator.js');
const guide = read('src/ui/guide.js');
const rail = read('src/ui/rail.js');
const graph = read('src/graph/graph-studio.js');

// One canonical Case Juniper evidence shape: READ / OPENED / VERIFIED are separate.
assert.match(background, /kind:\s*'JUNIPER_READ'/);
assert.match(background, /kind:\s*'JUNIPER_OPENED'/);
assert.match(background, /kind:\s*'JUNIPER_VERIFIED'/);
assert.match(background, /operatorOpened/);
assert.match(background, /readSource/);
assert.match(background, /JUNIPER_RESULT_CASE_MISMATCH/);
assert.match(background, /asynchronousJuniper/);
assert.match(background, /requireCase:\s*true/);
assert.match(prefetch, /Freeze the case\/episode\/route at request start/);

// Automatic read is a real evidence fact but does not imply a manual open/focus.
assert.match(evidence, /background snapshot is already a diagnostic fact/i);
assert.match(prefetch, /JUNIPER_REQUEST_START/);
assert.match(prefetch, /JUNIPER_RESPONSE/);
assert.match(prefetch, /JUNIPER_PARSED/);
assert.match(prefetch, /JUNIPER_EVIDENCE_ADDED/);
assert.doesNotMatch(prefetch, /\.runNext\?\.|\.highlight\?\.|FOCUS_SHOW/, 'automatic read must not invoke Guide/Focus');

// Explicit failure classes are visible to diagnostics instead of being false reads.
assert.match(prefetch, /JUNIPER_REQUEST_TIMEOUT/);
assert.match(prefetch, /JUNIPER_REQUEST_FAILED/);
assert.match(prefetch, /JUNIPER_PARSE_FAILED/);

// Juniper already uses the universal semantic target/resolver rather than its own lifecycle.
assert.match(guide, /registerResolver\?\.\('billing\.juniper'/);
assert.match(guide, /semanticTargetId === 'billing\.juniper'/);
assert.match(rail, /semanticTargetId:\s*'billing\.juniper'/);
assert.match(rail, /replayEvidence\(key\)/);
assert.doesNotMatch(guide, /JuniperActionSession|TmcFocusSession|HuaweiSession/);

// Graph exposes automatic-vs-operator evidence details; LIVE uses canonical trail.
assert.match(graph, /Juniper · evidence node/);
assert.match(graph, /Источник чтения/);
assert.match(graph, /Оператор открывал/);
assert.match(evidence, /sourceStatus\?\.juniperPreview/);
assert.match(prefetch, /JUNIPER_OPENED/);
assert.match(prefetch, /recordSystemEvent/);

console.log('juniper_evidence_graph_unit_test: PASS');
