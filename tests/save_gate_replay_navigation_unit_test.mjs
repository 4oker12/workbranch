import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const background = read('src/background.js');
const guide = read('src/ui/guide.js');
const rail = read('src/ui/rail.js');
const store_client = read('src/core/store-client.js');

// Logical wall #1: while the Save question is unanswered, prefilled DOM values must not unlock polling.
assert.match(background, /const technicalSavePending = Boolean\([\s\S]*tmcWritebackPendingSave[\s\S]*candidateNeedsBillingSave[\s\S]*\)/, 'diagnostic core must have an explicit pending-save gate');
assert.match(background, /const evidenceReadyForPoll = Boolean\([\s\S]*!technicalSavePending[\s\S]*LocatorTermination\.CONFIRMED/, 'hard evidence readiness must still be blocked by pending Save');
assert.match(background, /const canAttemptOnuPoll = evidenceReadyForPoll[\s\S]*!technicalSavePending/, 'best-effort poll readiness must also be blocked by pending Save');
assert.match(guide, /if \(writebackFlow\.tmcWritebackPendingSave[\s\S]*tmcWritebackAppliedFields[\s\S]*id: 'billing\.save-technical-fields'[\s\S]*resolver: findSaveButton/, 'Guide offers native Save only when TMC actually inserted values into previously-empty fields');
assert.match(rail, /const savePending = Boolean\(flow\.tmcWritebackPending \|\| flow\.tmcWritebackPendingSave\)/, 'LIVE computes pending native Save explicitly');
assert.match(rail, /if \(!pollAchieved && !savePending/, 'LIVE must not render poll CTA while Save is pending');
assert.match(rail, /reason: savePending \? 'technical-save-required' : 'poll-not-ready'/, 'poll click has an execution-time save guard, not only presentation gating');

// Visual wall: native Save remains the real action; Workbench only dims/guides/pulses it.
assert.match(rail, /simnet-wb-native-save-pulse/, 'native Save gets bounded visual pulse');
assert.match(rail, /scheduleNativeSaveGatePrompt[\s\S]*WB\.guide\?\.highlight\?\.\(freshCase\)/, 'successful TMC prefill automatically opens the Guide focus on native Save');
assert.doesNotMatch(rail, /findSaveButton\?\.\(\)\?\.click|findSaveButton\(\)\.click/, 'Workbench must never auto-click Save');

// Exception: a previously successful live poll suppresses the poll CTA entirely.
assert.match(rail, /const hasSuccessfulOnuPoll = caseData =>/);
assert.match(rail, /if \(hasSuccessfulOnuPoll\(currentCase\)\) return '';/, 'successful poll must remove the poll recommendation card');
assert.match(rail, /reason: 'poll-already-confirmed'/, 'successful poll must also block stale/manual CTA execution');


// Explicit operator refusal closes the Save question for this Case instead of looping.
assert.match(guide, /savePlanDismissed[\s\S]*dismissTmcWritebackPrompt/, 'closing the native Save Guide only dismisses the visual prompt; it must not advance the semantic route');
assert.match(background, /function closeTmcWritebackAfterTechnicalExit\(caseData, envelope, nextContext\)/, 'leaving Technical is owned by the durable Service Worker context transition, not by a content-script Rail that can disappear on navigation');
assert.match(background, /latestViewContextForEnvelopeTab\(caseData, envelope\)[\s\S]*previousContext\?\.pageKind[\s\S]*billing_technical[\s\S]*nextContext\?\.pageKind[\s\S]*billing_technical/, 'the no-Save decision compares previous and next contexts from the same tab and never treats a Technical reload as exit');
assert.match(background, /nativeSaveIntentPending[\s\S]*if \(nativeSaveIntentPending\) return false/, 'real native Save intent is protected from being misclassified as decline');
assert.match(background, /tmcWritebackLastStatus = 'declined'[\s\S]*tmcWritebackDeclinedAt = at/, 'no-Save after leaving Technical is persisted before route evaluation');
assert.match(background, /closeTmcWritebackAfterTechnicalExit\(caseData, envelope, nextContext\);[\s\S]*caseData\.currentContext = nextContext[\s\S]*updateRoute\(/, 'exit decision is committed before the destination route is recalculated');
assert.doesNotMatch(rail, /declineTmcWriteback\?\.\('left-technical-without-save'\)/, 'Rail no longer owns the durable leave-Technical transition');
assert.doesNotMatch(rail, /technical-document-arrived-without-save/, 'reload/pageshow while still in Technical must not be treated as leaving the section');
assert.match(store_client, /async dismissTmcWritebackPrompt[\s\S]*tmcWritebackPromptDismissedAt/, 'visual dismissal is persisted separately from the business decision');
const dismissMethod = store_client.match(/async dismissTmcWritebackPrompt[\s\S]*?\n    }\n\n    async declineTmcWriteback/)?.[0] || '';
assert.doesNotMatch(dismissMethod, /forceScan/, 'visual dismissal must not trigger same-page route recalculation');
assert.match(rail, /tmcWritebackPendingSave:\s*verifiedInForm && (?:completed|appliedFields)\.length > 0/, 'native Save gate exists only when Workbench actually inserted at least one previously-empty field');

// Logical wall #2: history arrows are target replays, not page-only navigation.
assert.match(guide, /DIRECT_REPLAY is not complete merely because the correct page opened/, 'replay contract documents page != target');
assert.match(guide, /if \(!resolvedReplay\?\.found\)[\s\S]*scheduleSemanticTargetRetry\(session\)/, 'replay waits/retries until the semantic DOM target exists');
assert.match(guide, /const oriented = showReplayOrientation[\s\S]*if \(!oriented\)[\s\S]*scheduleSemanticTargetRetry\(session\)/, 'replay also waits until the target can actually be oriented/scrolled');
assert.match(guide, /\['billing\.technical', 'userside\.tmc', 'billing\.poll\.entry', 'billing\.juniper'\]/, 'all four replay milestones share the bounded semantic-target retry path');
assert.match(guide, /completeDirect\(session, 'direct-replay-target-oriented'/, 'DIRECT_REPLAY completes only after scroll/orientation succeeds');
assert.match(guide, /ACTION_REPLAY_TARGET_TIMEOUT/, 'bounded replay retries must end in an observable timeout, never silent WAITING_TARGET');

console.log('save_gate_replay_navigation_unit_test: PASS');
