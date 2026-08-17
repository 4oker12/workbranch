import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const handoff = fs.readFileSync(path.join(here, '..', 'src/core/handoff.js'), 'utf8');
const guide = fs.readFileSync(path.join(here, '..', 'src/ui/guide.js'), 'utf8');

const claimStart = handoff.indexOf('async function claimOnUserside');
const claimEnd = handoff.indexOf('\n  function ', claimStart + 20);
assert.ok(claimStart >= 0, 'claimOnUserside must exist');
const claimBody = handoff.slice(claimStart, claimEnd > claimStart ? claimEnd : claimStart + 12000);
assert.match(claimBody, /continueActiveActionSession\?\.\(activeCase\)/, 'first UserSide claim must directly resume pending semantic action');
assert.match(claimBody, /queueMicrotask/, 'resume must not depend solely on bootstrap forceScan timing');

assert.match(guide, /const TARGET_RETRY_DELAYS_MS = Object\.freeze\(\[/, 'semantic target acquisition must have a bounded retry schedule');
assert.match(guide, /\['userside\.tmc', 'billing\.olt\.request'\]/, 'bounded retry must cover first-pass TMC target');
const retryStart = guide.indexOf('function scheduleSemanticTargetRetry(session)');
const retryEnd = guide.indexOf('\n  function ', retryStart + 20);
const retryBody = guide.slice(retryStart, retryEnd > retryStart ? retryEnd : retryStart + 4500);
assert.match(retryBody, /setTimeout/, 'retry may use bounded delayed attempts');
assert.doesNotMatch(retryBody, /setInterval/, 'no permanent polling loop may be introduced');

const tmcStart = guide.indexOf('function tmcCandidates()');
const tmcEnd = guide.indexOf('\n  function ', tmcStart + 20);
assert.ok(tmcStart >= 0, 'tmcCandidates must exist');
const tmcBody = guide.slice(tmcStart, tmcEnd > tmcStart ? tmcEnd : tmcStart + 3500);
assert.match(tmcBody, /WB\.tmcParser\?\.findBlocks\?\.\(document\)/, 'Guide must prefer canonical TMC parser blocks before fallback DOM heuristics');
assert.match(tmcBody, /parserBlocks\.map\(renderedTmcTarget\)\.filter\(Boolean\)/, 'all parser candidates must pass the rendered semantic-target guard');
const renderedStart = guide.indexOf('function renderedTmcTarget(element)');
const renderedEnd = guide.indexOf('\n  function ', renderedStart + 20);
assert.ok(renderedStart >= 0, 'renderedTmcTarget must exist');
const renderedBody = guide.slice(renderedStart, renderedEnd > renderedStart ? renderedEnd : renderedStart + 4000);
assert.match(renderedBody, /!element\.isConnected/, 'detached TMC nodes must still be rejected');
assert.match(renderedBody, /isRenderedTmcElement/, 'connected-but-hidden/zero-size TMC nodes must also be rejected or lifted to a visible ancestor');

console.log('tmc_first_transition_retry_unit_test: PASS');
