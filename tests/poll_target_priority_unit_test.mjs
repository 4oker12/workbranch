import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guide = fs.readFileSync(path.join(here, '..', 'src/ui/guide.js'), 'utf8');

const start = guide.indexOf('function authoritativePollAction(caseData)');
const end = guide.indexOf('function findPollTab(caseData)', start);
assert.ok(start >= 0 && end > start, 'authoritativePollAction helper must exist before findPollTab');
const body = guide.slice(start, end);
const diagnosticPos = body.indexOf('caseData?.diagnostic?.pollAction');
const ponPos = body.indexOf('caseData?.pon?.pollAction');
const recommendationPos = body.indexOf('recommendation(caseData)?.params?.pollAction');
const candidatePos = body.indexOf('recommendedCandidate(caseData)?.pollAction');
assert.ok(diagnosticPos >= 0 && ponPos > diagnosticPos,
  'current diagnostic/current PON binding must be consulted first');
assert.ok(recommendationPos > ponPos && candidatePos > recommendationPos,
  'locator recommendation/candidate are fallback-only for poll navigation');
assert.match(body, /VALID_POLL_ACTIONS\.has\(action\)/,
  'poll target must be limited to native Billing poll actions 310..313');

const findBody = guide.slice(end, guide.indexOf('function pollRows(caseData)', end));
assert.match(findBody, /const action = authoritativePollAction\(caseData\)/,
  'native poll tab resolver must use authoritative current binding');
assert.doesNotMatch(findBody, /recommendedCandidate\(caseData\)\?\.pollAction/,
  'findPollTab must not independently prefer a stale locator candidate');

const expectedStart = guide.indexOf('function expectedGuidePollAction(caseData)');
const expectedBody = guide.slice(expectedStart, guide.indexOf('function hasExpectedTerminalResult', expectedStart));
assert.match(expectedBody, /return authoritativePollAction\(caseData\)/,
  'terminal validation and navigation must agree on the same poll action');

console.log('poll_target_priority_unit_test: PASS');
