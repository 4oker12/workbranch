import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const guide = fs.readFileSync(path.join(root, 'src/ui/guide.js'), 'utf8');
const rail = fs.readFileSync(path.join(root, 'src/ui/rail.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

// Visual wall: an OLT auto-choice must close the Selectize dropdown instead of
// leaving its option list over the native Save button / Guide focus.
assert.match(guide, /function closeSelectizeLookup\(select\)/, 'Selectize close helper must exist');
assert.match(guide, /instance\.close\(\)/, 'prefer the native Selectize close API');
assert.match(guide, /instance\.blur\?\.\(\)/, 'blur the Selectize instance after programmatic choice');
assert.match(guide, /function settleSelectizeAfterProgrammaticSelection\(select\)/, 'programmatic OLT choice must have a bounded settle helper');
assert.match(guide, /parkFocusAwayFromSelectize\(select\)/, 'after auto-choice keyboard focus must be parked away from the Selectize input');
assert.match(guide, /requestAnimationFrame[\s\S]*window\.setTimeout\(settle, 60\)[\s\S]*window\.setTimeout\(settle, 180\)/, 'close/blur is repeated only through a short bounded legacy-widget repaint window');
assert.match(guide, /instance\.isOpen = false/, 'stale Selectize API open-state is forcibly normalized');
assert.match(guide, /instance\.\$dropdown\?\.removeClass\?\.\('active'\)\.hide\?\.\(\)/, 'the live Selectize dropdown is hidden even when it is mounted outside the table row');
assert.match(guide, /selectizeFocusSinkTimer[\s\S]*450/, 'focus sink survives the entire bounded settle window instead of disappearing in a microtask');
assert.match(guide, /data-simnet-wb-focus-sink|simnetWbFocusSink/, 'focus parking must use a Workbench-owned temporary sink');

// Logical wall: destination context, not opening LIVE, must resume the pending
// TMC -> Billing writeback transaction.
assert.match(rail, /WB\.bus\.on\('context:changed',[\s\S]*continueWorkflowAfterContext/, 'Rail must resume workflow from context commits');
assert.match(rail, /pageKind === 'userside_customer'[\s\S]*maybeContinueOneShotFocus/, 'UserSide arrival resumes the one-shot TMC focus');
assert.match(rail, /pageKind !== 'billing_technical'[\s\S]*flow\.tmcWritebackPending[\s\S]*maybeApplyPendingTmcWriteback/, 'Billing Technical arrival applies pending TMC writeback without opening LIVE');
assert.doesNotMatch(rail, /technical-document-arrived-without-save/, 'reload/pageshow while still in Billing Technical must not close the Save question');
assert.match(background, /function closeTmcWritebackAfterTechnicalExit[\s\S]*String\(previousContext\?\.pageKind[\s\S]*billing_technical[\s\S]*String\(nextContext\?\.pageKind[\s\S]*billing_technical/, 'no-Save becomes a decline only after the same Billing tab actually leaves Technical');
assert.match(background, /closeTmcWritebackAfterTechnicalExit\(caseData, envelope, nextContext\);[\s\S]*updateRoute\(/, 'the destination route sees the persisted decline immediately, even across a full document reload');

// First-transition wall: connected-but-hidden UserSide clones are not valid TMC
// targets, and a bounded mutation observer wakes the action as soon as real AJAX
// markup is rendered.
assert.match(guide, /function isRenderedTmcElement\(element\)/, 'rendered TMC predicate must exist');
assert.match(guide, /function renderedTmcTarget\(element\)/, 'hidden candidate must be lifted to a rendered semantic ancestor or rejected');
assert.match(guide, /parserBlocks\.map\(renderedTmcTarget\)\.filter\(Boolean\)/, 'canonical parser candidates must be visibility-filtered');
assert.match(guide, /const targetMutationWatchState = new Map\(\)/, 'bounded target mutation watch must exist');
assert.match(guide, /observer\.observe\(document\.documentElement,[\s\S]*childList: true[\s\S]*subtree: true/, 'TMC AJAX appearance must wake acquisition immediately');
assert.match(guide, /setTimeout\(\(\) => clearSemanticTargetMutationWatch\(operationId\), timeoutMs\)/, 'mutation observer must self-destruct after the action timeout');
assert.doesNotMatch(guide, /setInterval\(/, 'Guide may not introduce a permanent polling loop');

console.log('workflow_resume_selectize_tmc_visibility_unit_test: PASS');
