import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/core/action-lifecycle.js'), 'utf8');
const diagnostics = [];
const persisted = [];
const events = [];
const currentCase = { id: 'login:abon1', currentContext: { system: 'billing', pageKind: 'billing_user', entityId: '1' }, workflow: {} };
const WB = {
  runtime: { lastContext: currentCase.currentContext },
  store: {
    localCaseId: currentCase.id,
    activeCase: () => currentCase,
    async patchWorkflow(namespace, patch) {
      persisted.push({ namespace, patch: JSON.parse(JSON.stringify(patch)) });
      currentCase.workflow.actionSession ||= { active: null };
      if (namespace === 'actionSession') currentCase.workflow.actionSession.active = patch.active;
      return { accepted: true };
    }
  },
  observability: { async report(entry) { diagnostics.push(entry); return { ok: true }; } },
  operatorTrace: { recordSystemEvent(type, detail) { events.push({ type, detail }); } },
  bus: { emit() {}, on() { return () => {}; } }
};
const win = { setTimeout, clearTimeout };
win.top = win; win.self = win;
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
assert.ok(life, 'lifecycle API must exist');

const started = life.start({
  operationType: 'GUIDE_HIGHLIGHT', caseId: currentCase.id,
  semanticTargetId: 'billing.poll.entry', destinationSystem: 'billing', destinationPageKind: 'billing_user',
  expectedPostCondition: 'poll target visible', sourceAction: 'test', planId: 'billing.open-poll-tab'
});
assert.equal(started.ok, true);
assert.equal(started.session.status, 'REQUESTED');
await life.flushPersistence();
assert.ok(persisted.some(x => x.namespace === 'actionSession' && x.patch.active?.operationId === started.session.operationId && x.patch.active?.status === 'REQUESTED'), 'standalone REQUESTED is durable when explicitly flushed');
assert.equal(life.destinationReached(started.session).ok, true);
assert.equal(life.waitingTarget(started.session).ok, true);
assert.equal(life.targetReady(started.session).ok, true);
assert.equal(life.shown(started.session).ok, true);
assert.equal(life.complete(started.session, 'TARGET_ACTIVATED').ok, true);
assert.equal(started.session.status, 'COMPLETED');
await life.flushPersistence();
assert.ok(persisted.some(x => x.namespace === 'actionSession' && x.patch.lastTerminal?.operationId === started.session.operationId && x.patch.lastTerminal?.status === 'COMPLETED'), 'terminal snapshot is durable');

const illegal = life.shown(started.session);
assert.equal(illegal.ok, false, 'terminal session cannot return to SHOWN');
assert.ok(diagnostics.some(x => x.code === 'ACTION_ILLEGAL_STATE_TRANSITION'));

const failed = life.start({ operationType: 'GUIDE_NAVIGATION', caseId: currentCase.id, semanticTargetId: 'userside.tmc', destinationSystem: 'userside', destinationPageKind: 'userside_customer' }).session;
life.navigationStarted(failed);
life.fail(failed, 'navigation-failed', { code: 'ACTION_NAVIGATION_FAILED' });
assert.equal(failed.status, 'FAILED');
assert.ok(diagnostics.some(x => x.operationId === failed.operationId), 'FAILED must create diagnostics with same operationId');

const dropped = life.start({ operationType: 'GUIDE_HIGHLIGHT', caseId: currentCase.id, semanticTargetId: 'billing.technical' }).session;
life.targetReady(dropped);
life.shown(dropped);
life.unexpectedFocusDrop(dropped, 'store-render');
assert.equal(dropped.status, 'FAILED');
assert.ok(diagnostics.some(x => x.code === 'ACTION_FOCUS_DROPPED_UNEXPECTEDLY' && x.operationId === dropped.operationId));

const timed = life.start({ operationType: 'GUIDE_NAVIGATION', caseId: currentCase.id, semanticTargetId: 'userside.tmc' }).session;
life.waitingTarget(timed);
life.timeout(timed, 'target-timeout');
assert.equal(timed.status, 'TIMEOUT');
assert.ok(diagnostics.some(x => x.operationId === timed.operationId));

// A target acquisition timer must be cancelled once Focus reaches SHOWN.
const latched = life.start({ operationType: 'GUIDE_HIGHLIGHT', caseId: currentCase.id, semanticTargetId: 'billing.technical', targetTimeoutMs: 1000 }).session;
life.navigationStarted(latched);
life.waitingTarget(latched);
life.targetReady(latched);
life.shown(latched);
await new Promise(resolve => setTimeout(resolve, 1100));
assert.equal(latched.status, 'SHOWN', 'SHOWN has no acquisition TTL');
life.dismiss(latched, 'BACKDROP_CLICK');

// While guidance is still pre-SHOWN, an unrelated manual page click interrupts
// the ActionSession instead of making Workbench fight the operator.
const interrupted = life.start({ operationType: 'GUIDE_NAVIGATION', caseId: currentCase.id, semanticTargetId: 'userside.tmc', destinationSystem: 'userside', destinationPageKind: 'userside_customer' }).session;
life.navigationStarted(interrupted);
assert.equal(typeof clickListener, 'function');
const pageNode = { nodeType: 1, getAttribute() { return ''; }, hasAttribute() { return false; }, closest() { return null; } };
clickListener({ target: pageNode, composedPath() { return [pageNode]; } });
assert.equal(interrupted.status, 'INTERRUPTED');
assert.equal(interrupted.completionReason, 'USER_INTERRUPTED');

// A rapid cross-page burst may coalesce REQUESTED into NAVIGATING, but the
// explicit flush before navigation must durably contain the latest safe state.
const beforeBurstWrites = persisted.length;
const burst = life.start({ operationType: 'GUIDE_NAVIGATION', caseId: currentCase.id, semanticTargetId: 'billing.juniper', destinationSystem: 'billing', destinationPageKind: 'billing_juniper' }).session;
life.navigationStarted(burst, { actualResult: 'billing.juniper' });
await life.flushPersistence();
const burstWrites = persisted.slice(beforeBurstWrites).filter(x => x.namespace === 'actionSession');
assert.ok(burstWrites.length <= 2, 'REQUESTED/NAVIGATING burst is coalesced instead of serializing every transition');
assert.ok(burstWrites.some(x => x.patch.active?.operationId === burst.operationId && x.patch.active?.status === 'NAVIGATING'), 'latest NAVIGATING state is durable before cross-page dispatch');
life.interrupt(burst, 'test-finish');
await life.flushPersistence();

assert.ok(events.some(x => x.type === 'ACTION_STATE'));
console.log('universal_action_lifecycle_unit_test: PASS');
