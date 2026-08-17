import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/core/evidence-navigator.js'), 'utf8');
const WB = {};
const sandbox = { globalThis: { SIMNET_WB: WB }, console, Date };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const nav = WB.evidenceNavigator;
assert.ok(nav, 'evidence navigator must register');

const fact = value => ({ value });
const base = () => ({
  id: 'login:abon100',
  identity: { login: fact('abon100') },
  contexts: {},
  diagnostic: {},
  locator: { evidence: [], sourceStatus: {} },
  operations: { poll: { current: null, history: [] } },
  workflow: { ponAcquisition: {} },
  route: { guide: { completed: {} } },
  juniper: {}
});
const keys = c => Array.from(nav.trail(c), item => item.key);

// Empty Case means empty history: no pre-created "not done" checklist.
let c = base();
assert.deepEqual(keys(c), []);

// Manual Technical visit is independent evidence.
c = base();
c.contexts.tech = { pageKind: 'billing_technical', observedAt: '2026-08-16T10:00:00Z' };
c.diagnostic.technicalVisited = true;
assert.deepEqual(keys(c), ['technical']);

// Opening UserSide + passive TMC parsing is NOT an operator TMC visit.
c = base();
c.contexts.us = { pageKind: 'userside_customer', observedAt: '2026-08-16T10:02:00Z' };
c.locator.evidence.push({ type: 'TMC_RESULT', result: 'found', at: '2026-08-16T10:02:01Z', details: { identityCheck: { isMatch: true } } });
assert.deepEqual(keys(c), []);
assert.equal(nav.recommendationAllowed(c, { id: 'userside.find-tmc' }), true);

// Only the Workbench semantic teleport/focus marker creates the TMC milestone.
c.workflow.ponAcquisition.tmcShownAt = '2026-08-16T10:02:02Z';
assert.deepEqual(keys(c), ['tmc']);
assert.equal(nav.trail(c)[0].status, 'сверено');
assert.equal(nav.trail(c)[0].at, '2026-08-16T10:02:02Z');

// A completed poll alone is a valid direct path; no Tech/TMC are invented.
c = base();
c.locator.evidence.push({ type: 'POLL_RESULT', result: 'confirmed', at: '2026-08-16T10:05:00Z', details: { onuStatus: 'online' } });
assert.deepEqual(keys(c), ['poll']);

// A negative terminal poll is still a performed poll milestone.
c = base();
c.locator.evidence.push({ type: 'POLL_RESULT', result: 'not_found', at: '2026-08-16T10:05:00Z' });
assert.deepEqual(keys(c), ['poll']);
assert.equal(nav.trail(c)[0].status, 'ONU не найдена');

// A running request is transient and must not be written into "Что уже сделано".
c = base();
c.operations.poll.current = { stage: 'REQUEST_STARTED', pending: true, startedAt: '2026-08-16T10:05:00Z' };
assert.deepEqual(keys(c), []);

// A terminal attempt without parsed snapshot still counts as a performed attempt.
c.operations.poll.current = { stage: 'TIMEOUT', pending: false, updatedAt: '2026-08-16T10:06:00Z' };
assert.deepEqual(keys(c), ['poll']);
assert.equal(nav.trail(c)[0].status, 'timeout');

// TMC + Poll reflects only actual milestones and remains chronological.
c = base();
c.contexts.us = { pageKind: 'userside_customer', observedAt: '2026-08-16T10:02:00Z' };
c.locator.evidence.push(
  { type: 'TMC_RESULT', result: 'found', at: '2026-08-16T10:02:01Z', details: { identityCheck: { isMatch: true } } },
  { type: 'POLL_RESULT', result: 'confirmed', at: '2026-08-16T10:05:00Z', details: { onuStatus: 'online' } }
);
c.workflow.ponAcquisition.tmcShownAt = '2026-08-16T10:02:02Z';
assert.deepEqual(keys(c), ['tmc', 'poll']);

// One-shot recommendation: once the corresponding milestone exists, CTA is suppressed.
assert.equal(nav.recommendationAllowed(c, { id: 'userside.find-tmc' }), false);
assert.equal(nav.recommendationAllowed(c, { id: 'billing.open-poll-tab' }), false);
assert.equal(nav.recommendationAllowed(c, { id: 'billing.open-technical' }), true);

// A correlated background Juniper read is already diagnostic evidence. It may
// appear in LIVE without pretending the operator manually opened Juniper.
c = base();
c.locator.sourceStatus.juniperPreview = { result: 'online', details: { preview: true }, observedAt: '2026-08-16T10:01:00Z' };
c.juniper = {
  dataStatus: 'available',
  result: 'online',
  readAt: '2026-08-16T10:01:00Z',
  readSource: 'automatic',
  operatorOpened: false,
  evidence: {
    read: { kind: 'JUNIPER_READ', at: '2026-08-16T10:01:00Z', source: 'automatic', result: 'online' },
    opened: null,
    verified: { kind: 'JUNIPER_VERIFIED', at: '2026-08-16T10:01:00Z', result: 'online' }
  }
};
assert.deepEqual(keys(c), ['juniper']);
assert.equal(nav.trail(c)[0].status, 'Online');
assert.equal(nav.trail(c)[0].opened, false);
assert.equal(nav.recommendationAllowed(c, { id: 'billing.open-juniper' }), false, 'automatic read suppresses redundant Juniper CTA');

// Manual OPENED is separate evidence but must aggregate into the same one row.
c.juniper.operatorOpened = true;
c.juniper.openedAt = '2026-08-16T10:04:00Z';
c.juniper.evidence.opened = { kind: 'JUNIPER_OPENED', at: '2026-08-16T10:04:00Z', source: 'operator' };
assert.deepEqual(keys(c), ['juniper']);
assert.equal(nav.trail(c)[0].opened, true);

// no_session is a valid performed read, not "not done".
c.juniper.result = 'no_session';
c.locator.sourceStatus.juniperPreview.result = 'no_session';
assert.equal(nav.trail(c)[0].status, 'сессия не найдена');

// A failed request/parser must not create a false JUNIPER_READ milestone.
c = base();
c.juniper = { dataStatus: 'error', result: 'error', failureReason: 'parse-error', evidence: { read: null, opened: null, verified: null } };
assert.deepEqual(keys(c), []);

// Passive/background TMC lookup alone must not masquerade as an operator visit.
c = base();
c.locator.sourceStatus.tmc = { result: 'found', details: { identityCheck: { isMatch: true } } };
c.locator.evidence.push({ type: 'TMC_RESULT', result: 'found', at: '2026-08-16T10:02:01Z', details: { identityCheck: { isMatch: true } } });
assert.deepEqual(keys(c), []);

// Repeated parser evidence never changes milestone time; teleport time is authoritative.
c = base();
c.contexts.us = { pageKind: 'userside_customer', observedAt: '2026-08-16T10:02:00Z' };
c.locator.evidence.push(
  { type: 'TMC_RESULT', result: 'found', at: '2026-08-16T10:02:01Z', details: {} },
  { type: 'TMC_RESULT', result: 'found', at: '2026-08-16T10:03:01Z', details: { identityCheck: { isMatch: true } } }
);
assert.deepEqual(keys(c), []);
c.workflow.ponAcquisition.tmcShownAt = '2026-08-16T10:04:00Z';
assert.deepEqual(keys(c), ['tmc']);
assert.equal(nav.trail(c)[0].at, '2026-08-16T10:04:00Z');

console.log('evidence_navigation_unit_test: PASS');
