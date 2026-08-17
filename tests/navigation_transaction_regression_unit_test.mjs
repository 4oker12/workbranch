import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/core/action-lifecycle.js'), 'utf8');
const events = [];
const diagnostics = [];
const counters = Object.create(null);
const currentCase = {
  id: 'login:abon9001',
  currentContext: { system: 'billing', pageKind: 'billing_user', entityId: '9001' },
  workflow: { actionSession: { active: null, lastTerminal: null } }
};
const WB = {
  runtime: { lastContext: currentCase.currentContext },
  store: {
    localCaseId: currentCase.id,
    activeCase: () => currentCase,
    async patchWorkflow(namespace, patch) {
      if (namespace === 'actionSession') Object.assign(currentCase.workflow.actionSession, JSON.parse(JSON.stringify(patch)));
      return { accepted: true };
    }
  },
  performanceMonitor: { count(name) { counters[name] = (counters[name] || 0) + 1; } },
  observability: { async report(entry) { diagnostics.push(entry); return { ok: true }; } },
  operatorTrace: { recordSystemEvent(type, detail) { events.push({ type, detail }); } },
  bus: { emit() {}, on() { return () => {}; } }
};
const win = { setTimeout, clearTimeout }; win.top = win; win.self = win;
let clickListener = null;
const document = {
  addEventListener(type, fn, capture) { if (type === 'click' && capture === true) clickListener = fn; },
  removeEventListener(type, fn) { if (type === 'click' && clickListener === fn) clickListener = null; }
};
const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, window: win, document, globalThis: null, SIMNET_WB: WB };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const life = sandbox.SIMNET_WB.actionLifecycle;

const a = life.start({
  operationType: 'GUIDE_NAVIGATION', intent: 'GUIDED_NAVIGATION', navigationCapable: true,
  caseId: currentCase.id, semanticTargetId: 'userside.tmc', destinationSystem: 'userside', destinationPageKind: 'userside_customer'
});
assert.equal(a.ok, true);
life.navigationStarted(a.session);

const duplicate = life.start({
  operationType: 'GUIDE_NAVIGATION', intent: 'GUIDED_NAVIGATION', navigationCapable: true,
  caseId: currentCase.id, semanticTargetId: 'userside.tmc', destinationSystem: 'userside', destinationPageKind: 'userside_customer'
});
assert.equal(duplicate.ok, true);
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.session.operationId, a.session.operationId);

for (const target of ['billing.technical','billing.juniper','billing.poll.entry','billing.user','billing.poll.huawei','billing.poll.gpon','billing.poll.epon','billing.poll.gcom','userside.other','billing.other']) {
  const blocked = life.start({
    operationType: 'GUIDE_NAVIGATION', intent: 'GUIDED_NAVIGATION', navigationCapable: true,
    caseId: currentCase.id, semanticTargetId: target, destinationSystem: 'billing', destinationPageKind: 'billing_user'
  });
  assert.equal(blocked.ok, false, `${target} must be blocked while owner navigation is active`);
  assert.equal(blocked.reason, 'navigation-locked');
  assert.equal(blocked.ownerSession.operationId, a.session.operationId);
}
assert.ok((counters.navigationActionsSuppressed || 0) >= 10);
assert.ok(events.some(e => e.type === 'NAVIGATION_ACTION_BLOCKED_BY_LOCK'));

life.destinationReached(a.session, { actualResult: 'userside_customer' });
life.complete(a.session, 'TMC_EVIDENCE_VERIFIED', 'userside.tmc');
await life.flushPersistence();
assert.equal(a.session.status, 'COMPLETED');
assert.equal(currentCase.workflow.actionSession.active, null, 'terminal session must not remain active in Case');
assert.equal(currentCase.workflow.actionSession.lastTerminal?.operationId, a.session.operationId);

const b = life.start({
  operationType: 'DIRECT_REPLAY', intent: 'DIRECT_REPLAY', replayOnly: true, navigationCapable: true,
  caseId: currentCase.id, semanticTargetId: 'billing.juniper', destinationSystem: 'billing', destinationPageKind: 'billing_juniper', destinationEntityId: '9001'
});
assert.equal(b.ok, true, 'terminal state releases navigation ownership');
life.navigationStarted(b.session);
life.fail(b.session, 'navigation-failed', { code: 'DIRECT_REPLAY_FAILED' });
assert.equal(b.session.status, 'FAILED');

const c = life.start({
  operationType: 'DIRECT_REPLAY', intent: 'DIRECT_REPLAY', replayOnly: true, navigationCapable: true,
  caseId: currentCase.id, semanticTargetId: 'billing.technical', destinationSystem: 'billing', destinationPageKind: 'billing_technical', destinationEntityId: '9001'
});
assert.equal(c.ok, true, 'FAILED also releases navigation ownership');
life.navigationStarted(c.session);

// Simulate another tab completing the same operation and persisting active:null + lastTerminal.
currentCase.workflow.actionSession = {
  active: null,
  lastTerminal: {
    ...JSON.parse(JSON.stringify(c.session)),
    status: 'COMPLETED',
    completedAt: new Date().toISOString(),
    completionReason: 'direct-replay-destination-verified',
    lastTransitionAt: new Date().toISOString()
  }
};
life.syncFromCase(currentCase);
assert.equal(c.session.status, 'COMPLETED', 'source tab must adopt cross-tab terminal state and release stale lock');
const late = life.destinationReached(c.session, { actualResult: 'billing_technical' });
assert.equal(late.ok, false, 'late destination event cannot resurrect a terminal operation');
assert.equal(c.session.status, 'COMPLETED');

console.log('navigation_transaction_regression_unit_test: PASS');
