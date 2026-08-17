import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/ui/guide.js'), 'utf8');

assert.match(source, /#\$\{OVERLAY_ID\} \.shade[\s\S]*?pointer-events:\s*auto/, 'backdrop must be clickable to dismiss Focus');
assert.match(source, /this\.boundShadeClick[\s\S]*?this\.clear\('BACKDROP_CLICK'\)/, 'backdrop click must clear Focus with explicit reason');
assert.match(source, /event\.key === 'Escape'\) this\.clear\('ESC'\)/, 'Esc must clear Focus with explicit reason');
assert.match(source, /function keepLatchedOverlayOrClear/, 'Focus lifecycle must be explicitly latched');
assert.match(source, /WB\.bus\.on\('context:changed'[\s\S]*?keepLatchedOverlayOrClear\('context:changed'\)/, 'context updates must keep latched Focus');
assert.match(source, /WB\.bus\.on\('store:state'[\s\S]*?keepLatchedOverlayOrClear\('store:state'\)/, 'store updates must keep latched Focus');
assert.doesNotMatch(source, /forceScan\?\.\('guide-hint-evaluate'\)/, 'showing a hint must not trigger the scan that invalidates it');
assert.match(source, /tryRebindTarget\(\)/, 'detached DOM node must attempt semantic rebind');
assert.match(source, /ACTION_SUPERSEDED/, 'superseded Focus must have an explicit lifecycle reason');
assert.match(source, /currentPlan\?\.replayOnly \? null : guideExpectation/, 'replay pointer must not alter Guide progress');
assert.match(source, /function refreshFamiliarReminders\(\)[\s\S]*?clearStaleFamiliarReminders\(new Set\(\)\)/, 'ambient familiar highlights must stay disabled');
assert.match(source, /function refreshEvidenceTrail\(\)[\s\S]*?clearStaleEvidenceTraces\(new Set\(\)\)/, 'completed history must not keep native CRM controls glowing');
console.log('evidence_focus_lifecycle_unit_test: PASS');
