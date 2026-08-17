import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const rail = read('src/ui/rail.js');
const guide = read('src/ui/guide.js');
const handoff = read('src/core/handoff.js');
const background = read('src/background.js');
const storeClient = read('src/core/store-client.js');

assert.match(handoff, /await WB\.store\.prepareHandoff\(payload\)/,
  'fallback handoff must still be persisted before opening a new or repurposed target tab');
assert.match(handoff, /await WB\.store\.openHandoffTarget\(/,
  'prepared handoff should try to reuse a safe existing UserSide tab before opening another one');
assert.match(handoff, /if \(reused\?\.opened\)[\s\S]*reusedWithoutReload/,
  'exact same-case UserSide reuse must short-circuit the new-tab path');
assert.match(handoff, /window\.addEventListener\('hashchange'[\s\S]*claimOnUserside\(\)/,
  'same-customer tab reuse must claim a fresh handoff without requiring a document reload');
assert.match(handoff, /const useDirectCustomer = \^?\/\\d\+\$\/\.test\(customerId\)|const useDirectCustomer = \/\^\\d\+\$\/\.test\(customerId\)/,
  'known customerId must be eligible for direct UserSide card navigation');
assert.match(handoff, /new URL\(`\/customer\/\$\{customerId\}`/,
  'known UserSide customer is opened directly instead of through gotouser redirect');
assert.ok(background.includes('/\\/customer\\/\\d+\\/?$/i.test(url.pathname)'),
  'handoff allowlist accepts canonical /customer/<id> target');
assert.match(background, /url: `https:\/\/userside\.simnet\.kiev\.ua\/customer\/\$\{requestedCustomerId\}\*`/,
  'fast reuse queries the canonical exact customer URL directly');
const fastFocusStart = background.indexOf('async function focusExistingUsersideCase');
const fastFocusEnd = background.indexOf('async function openHandoffTarget', fastFocusStart);
const fastFocusBody = background.slice(fastFocusStart, fastFocusEnd);
assert.doesNotMatch(fastFocusBody, /await readState\(\)/,
  'exact same-customer focus must never read the giant Workbench State before switching tabs');
assert.match(fastFocusBody, /chrome\.tabs\.update\(targetTab\.id, \{ active: true \}\)/,
  'same-customer reuse focuses the existing tab without URL mutation/reload');
assert.match(background, /chrome\.tabs\.sendMessage\(targetTab\.id[\s\S]*HANDOFF_FAST_CASE_BIND/,
  'same-customer fast focus must explicitly wake/bind the already-loaded UserSide content script');
assert.match(handoff, /acceptFastCaseBind\(payload[\s\S]*WB\.store\.bindCase\?\.\(caseId\)[\s\S]*continueActiveActionSession/,
  'fast-focused UserSide tab must bind the exact Case and continue the pending semantic ActionSession');
assert.match(handoff, /existing\?\.focused && existing\?\.caseBound === true/,
  'fast reuse may short-circuit only after the target tab acknowledges Case binding');
assert.match(background, /Never hijack an arbitrary UserSide tab belonging to another[\s\S]*subscriber/,
  'reuse must not overwrite an unrelated operator UserSide tab');

assert.match(rail, /collapseForNavigation\(\) \{[\s\S]*this\.activeView = null;[\s\S]*this\.hoverOpen = false;/,
  'navigation collapse clears drawer state rather than temporarily hiding it');
for (const method of ['requestPollReveal', 'replayEvidence', 'returnToTechnical', 'openTmcSourceDirect', 'requestTmcWriteback']) {
  const start = rail.indexOf(`async ${method}`);
  assert.ok(start >= 0, `${method} exists`);
  const body = rail.slice(start, start + 900);
  assert.match(body, /collapseForNavigation\(\)/, `${method} must collapse expanded Workbench before action`);
}

assert.match(guide, /let actionContinuationQueued = false;/,
  'busy continuation events must be coalesced, not dropped');
assert.match(guide, /actionContinuationQueued = true;[\s\S]*queued: true/,
  'busy continuation records one trailing retry');
assert.match(guide, /if \(actionContinuationQueued\)[\s\S]*queueMicrotask\([\s\S]*continueActiveActionSession/,
  'trailing continuation reruns after current continuation completes');
assert.match(guide, /function tmcHighlightTarget\(caseData\)[\s\S]*document\.createRange\(\)[\s\S]*range\.getClientRects\(\)[\s\S]*unionRects\(rects\)/,
  'guided TMC restores the historical semantic cutout geometry');
assert.match(guide, /span\.dataset\.simnetWbTmcValue[\s\S]*--simnet-wb-tmc-mark-width/,
  'first-pass TMC Guide restores the exact v29.32 per-value plum marks and equal-width alignment');
assert.match(guide, /!currentPlan\?\.replayOnly[\s\S]*highlightTmcValues/,
  'History Replay must stay lightweight and must not rerun the first-pass TMC teaching marks');
assert.match(background, /let mainStateCache = null;[\s\S]*async function ensureMainStateCache\(\)[\s\S]*if \(mainStateCache\) return mainStateCache;/,
  'service worker caches the single-writer main State instead of re-reading it before each button action');
assert.match(background, /async function readStateReference\(\)[\s\S]*return ensureMainStateCache\(\)/,
  'read-only critical paths can use the in-memory State reference without cloning the full Case graph');

assert.match(background, /async function patchActionSessionFast[\s\S]*workflow: clone\(applied\.workflow\)[\s\S]*fastLane: true/,
  'fast ActionSession response is compact and does not send the giant main State back through the message channel');
const fastActionStart = background.indexOf('async function patchActionSessionFast');
const fastActionEnd = background.indexOf('async function patchWorkflow', fastActionStart);
assert.doesNotMatch(background.slice(fastActionStart, fastActionEnd), /state: await stateWithFastActionSessions/,
  'ActionSession critical response must not serialize the whole State');
assert.match(storeClient, /namespace === 'actionSession'[\s\S]*this\.fastActionSessions\[this\.localCaseId\]/,
  'StoreClient applies compact ActionSession responses locally without waiting for a full State echo');
assert.match(guide, /lastTerminal[\s\S]*ACTION_SESSION_TERMINAL/,
  'terminal fast-lane state tears down a latched Focus overlay even if persisted Guide hint memory remains');
assert.match(guide, /visualOnly = new Set\(\['TARGET_ACTIVATED_PENDING_RESULT','ACTION_SESSION_TERMINAL'\]\)/,
  'terminal Focus teardown is visual-only and cannot resurrect or re-terminalize the ActionSession');

assert.match(background, /STATE_WRITE_SLOW/,
  'slow durable State commits are observable instead of looking like dead buttons');
assert.match(background, /ACTION_SESSION_FAST_KEY = 'simnet_workbench_action_session_fast_v1'/,
  'navigation lifecycle has a small durable fast-lane separate from the giant Case State');
assert.match(background, /async function patchActionSessionFast[\s\S]*writeFastActionSession/,
  'ActionSession persistence bypasses the serialized full-State enqueue path');
assert.match(storeClient, /applyFastActionSessions\(this\.state\)/,
  'ordinary main-State updates reapply the fast lifecycle snapshot instead of erasing an active navigation lock');


assert.match(guide, /async waitForOperatorScrollIdle\(requestId,[\s\S]*window\.removeEventListener\('wheel',[\s\S]*window\.addEventListener\('wheel'/,
  'TMC/Guide auto-focus uses only a transient scroll-idle guard and removes it after focus preparation');
assert.match(guide, /await this\.waitForOperatorScrollIdle\(requestId\)[\s\S]*scrollIntoView/,
  'manual scrolling may continue while the route waits; Workbench scrolls to the final target only after scroll idle');
assert.match(guide, /const validInterrupt = new Set\(\['PAGE_NAVIGATION','CASE_CHANGED','USER_INTERRUPTED','ACTION_SUPERSEDED','TARGET_SEMANTICALLY_INVALID'\]\)/,
  'operator scrolling is not an ActionSession interruption condition');
assert.match(background, /function sanitizeGuidePersistedDetails/,
  'Guide persistence has a dedicated secret sanitizer');
assert.match(background, /sanitizeGuidePersistedDetails\(payload\.details\)/,
  'new Guide hint/action details are sanitized before durable storage');
assert.match(background, /step\.action = sanitizeGuidePersistedDetails\(step\.action\)/,
  'older persisted Guide actions are repaired on read');
assert.match(background, /searchParams\.set\('pp', '\[redacted\]'\)/,
  'persisted Guide URLs redact Billing pp');

console.log('transition_responsiveness_panel_privacy_unit_test: PASS');
