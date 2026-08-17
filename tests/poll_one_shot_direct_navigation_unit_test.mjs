import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rail = fs.readFileSync(path.join(here, '..', 'src/ui/rail.js'), 'utf8');
const guide = fs.readFileSync(path.join(here, '..', 'src/ui/guide.js'), 'utf8');

const start = rail.indexOf('async requestPollReveal()');
const end = rail.indexOf('async maybeContinuePollReveal()', start);
assert.ok(start >= 0 && end > start, 'requestPollReveal must exist');
const body = rail.slice(start, end);

for (const [action, semantic] of [
  ['310', 'billing.poll.epon'],
  ['311', 'billing.poll.gpon'],
  ['312', 'billing.poll.gcom'],
  ['313', 'billing.poll.huawei']
]) {
  assert.match(body, new RegExp(`'${action}': '${semantic.replaceAll('.', '\\.')}'`), `poll action ${action} must route to ${semantic}`);
}
assert.match(body, /semanticTargetId: 'billing\.olt\.request'/, 'one-shot action must terminate at native askOLT target');
assert.match(body, /destinationPageKind: 'billing_onu_poll'/, 'destination must be the poll page, not Billing card');
assert.match(body, /planId: 'billing\.ask-olt'/, 'final Focus must use askOLT plan');
assert.match(body, /WB\.billingNavigation\?\.navigate\?\./, 'CTA itself must navigate to exact native poll page');
assert.doesNotMatch(body, /navigateToBillingCardForAction\(currentCase\)/, 'poll CTA must not stop on Billing card and require a second click');

const askStart = guide.indexOf('function askOltHighlightTarget(caseData)');
const askEnd = guide.indexOf('\n  function ', askStart + 10);
const askBody = guide.slice(askStart, askEnd > askStart ? askEnd : askStart + 2500);
assert.match(askBody, /authoritativePollAction\(caseData\)/, 'askOLT resolver must use authoritative current technology');
assert.match(askBody, /expectedAction !== currentAction/, 'askOLT resolver must reject a wrong poll technology page');

console.log('poll_one_shot_direct_navigation_unit_test: PASS');
