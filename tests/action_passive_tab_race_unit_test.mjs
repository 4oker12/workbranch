import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guide = fs.readFileSync(path.join(here, '..', 'src/ui/guide.js'), 'utf8');

const start = guide.indexOf('async function continueActiveActionSession(caseData =');
const end = guide.indexOf('\n  function ', start + 20);
assert.ok(start >= 0, 'continueActiveActionSession must exist');
const body = guide.slice(start, end > start ? end : start + 9000);

assert.match(body, /ACTION_PASSIVE_TAB_IGNORED/, 'passive same-Case tab must be explicitly read-only for lifecycle');
assert.match(body, /reason: 'passive-tab-ignored'/, 'passive tab branch must return without terminal transition');
const passiveStart = body.indexOf("if (!stillOnSource && page.system && session.sourceSystem && page.system !== session.sourceSystem)");
assert.ok(passiveStart >= 0, 'cross-system passive branch must exist');
const passiveEnd = body.indexOf("if (session.status === 'REQUESTED')", passiveStart);
const passiveBody = body.slice(passiveStart, passiveEnd);
assert.doesNotMatch(passiveBody, /actionLifecycle\.interrupt/, 'passive tab must not interrupt a Case-wide action owned by another tab');

assert.match(guide, /const shownResult = this\.actionSession[\s\S]*actionLifecycle\?\.shown/, 'Focus must inspect lifecycle SHOWN result');
assert.match(guide, /if \(!shownResult\?\.ok\)[\s\S]*ACTION_SESSION_TERMINAL/, 'rejected SHOWN transition must abort visual success');
assert.ok(guide.indexOf('if (!shownResult?.ok)') < guide.indexOf("recordSystemEvent?.('FOCUS_SHOW'"), 'FOCUS_SHOW must only be emitted after lifecycle accepts SHOWN');

console.log('action_passive_tab_race_unit_test: PASS');
