import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const rail = read('src/ui/rail.js');
const guide = read('src/ui/guide.js');
const billing = read('src/core/billing-navigation.js');
const background = read('src/background.js');
const handoff = read('src/core/handoff.js');
const lifecycle = read('src/core/action-lifecycle.js');
const trace = read('src/core/operator-trace.js');
const bootstrap = read('src/content/bootstrap.js');

assert.match(rail, /operationType:\s*'DIRECT_REPLAY'[\s\S]*sourceAction:\s*'live-history-replay'/, 'History arrow must create DIRECT_REPLAY');
assert.match(rail, /Navigation commit is NOT completion/, 'navigation commit cannot complete replay');
assert.match(guide, /session\.intent === 'DIRECT_REPLAY'[\s\S]*showReplayOrientation[\s\S]*completeDirect\(session, 'direct-replay-target-oriented'/, 'DIRECT_REPLAY completes only after the real native target is oriented');

const replayStart = guide.indexOf('async function replayMilestone');
const replayEnd = guide.indexOf('async function navigate(caseData)', replayStart);
const replayBody = guide.slice(replayStart, replayEnd);
assert.doesNotMatch(replayBody, /overlay\.show/, 'History orientation must not revive tutorial overlay');
assert.match(replayBody, /showReplayOrientation/, 'History may use lightweight orientation only');
assert.match(guide, /#simnet-wb-replay-orientation-rect[\s\S]*border: 3px solid #A50046/, 'orientation is a lightweight Workbench-owned border');
const orientationStart = guide.indexOf('function showReplayOrientation');
const orientationEnd = guide.indexOf('async function replayMilestone', orientationStart);
const orientationBody = guide.slice(orientationStart, orientationEnd);
assert.doesNotMatch(orientationBody, /shade-top|shade-left|shade-right|shade-bottom|tip-close/, 'History orientation does not revive the tutorial Focus shades/tip');

assert.match(billing, /handoff\.focusSource\(activeCase, \{[\s\S]*semanticTargetId,[\s\S]*entityId: billingId/, 'UserSide replay asks source tab for fresh semantic route');
assert.match(background, /function safeBillingSemanticTarget\([\s\S]*source\.searchParams\.get\('pp'\)/, 'background obtains pp from live Billing source tab URL');
assert.match(background, /BILLING_SEMANTIC_ROUTES/, 'source tab can build all semantic Billing destinations');
assert.match(handoff, /semanticTargetId: String\(options\?\.semanticTargetId/, 'handoff carries semantic destination, not an old pp');
assert.doesNotMatch(handoff, /pp\s*:/, 'handoff payload must never persist pp');

assert.match(rail, /sourceAction:\s*'tmc-writeback-return-technical'/, 'TMC return uses central Billing gateway');
assert.match(rail, /const verifiedInForm = Boolean\([\s\S]*result\.ok[\s\S]*unresolvedFields\.length === 0[\s\S]*expectedFields\.every\(field => accountedFields\.has\(field\)\)/, 'VERIFIED_IN_FORM requires every actual TMC expected field to be applied or already matched; absent TMC fields are outside the transaction');
assert.match(rail, /tmcWritebackPendingSave:\s*verifiedInForm/, 'partial writeback must not enter native Save-ready state');
assert.match(guide, /conflictingExisting[\s\S]*status: 'conflict'/, 'existing conflicting values are not mislabeled as already matching');
assert.match(rail, /simnet-wb-native-save-attention/, 'native Billing Save is highlighted after verified autofill');
assert.doesNotMatch(rail, /\.click\(\)[^\n]*Сохранить|findSaveButton\(\)\.click/, 'Workbench must not click native Save programmatically');
assert.match(background, /tmcWritebackPendingSave[\s\S]*billingSaved\.result === 'saved'/, 'SAVED still requires post-save evidence');

assert.match(lifecycle, /NAVIGATION_ACTION_BLOCKED_BY_LOCK/, 'global navigation ownership is enforced');
assert.match(lifecycle, /\{ active: null, lastTerminal: snapshot \}/, 'terminal operation is removed from active slot');
assert.match(lifecycle, /ACTION_TERMINAL_SYNCED_FROM_CASE/, 'other tabs can consume terminal state instead of keeping stale navigation lock');

assert.match(trace, /if \(isWorkbenchElement\(element\)\) return null;/, 'Trace ignores Workbench-owned UI mutations');
assert.match(trace, /isVolatileTraceElement/, 'Trace filters animation/counter churn');
assert.match(bootstrap, /let documentGeneration = 0;/, 'document invalidation is separate from scan count');
assert.doesNotMatch(bootstrap, /generation !== scanGeneration/, 'ordinary scan generation is no longer a DOM invalidation token');
assert.match(bootstrap, /quiescentMutationsSuppressed/, 'idle scanner suppresses irrelevant background mutations');
assert.match(bootstrap, /volatileMutationsSuppressed/, 'volatile CRM changes are counted and suppressed');

console.log('history_replay_writeback_contract_test: PASS');
