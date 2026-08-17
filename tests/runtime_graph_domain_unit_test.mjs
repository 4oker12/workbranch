import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/ui/appeals-navigator.js'), 'utf8');

const WB = { version: '1.7.29.13' };
const sandbox = {
  SIMNET_WB: WB,
  globalThis: { SIMNET_WB: WB, chrome: undefined },
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Boolean,
  Number,
  Set,
  Map
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

assert.ok(WB.appeals, 'WB.appeals must exist');
assert.equal(typeof WB.appeals.contextCoverage, 'function');
assert.equal(typeof WB.appeals.resolveRuntimeGraph, 'function');
assert.equal(typeof WB.appeals.buildDiagnosticSnapshot, 'function');
assert.equal(typeof WB.appeals.formatDiagnosticSummary, 'function');

// Empty appeal → symptom selection view-model
{
  const empty = WB.appeals.empty();
  const vm = WB.appeals.resolveRuntimeGraph({ appeal: empty, caseData: {} });
  assert.equal(vm.status, 'empty');
  assert.ok(Array.isArray(vm.types) && vm.types.length >= 1);
  assert.equal(vm.currentNode, null);
}

// Select no_internet and answer first question
{
  const started = WB.appeals.select('no_internet');
  assert.equal(started.typeId, 'no_internet');
  assert.equal(started.status, 'active');
  assert.ok(started.graphRevision);
  assert.ok(started.graphType);

  const caseData = {
    id: 'login:abon-test',
    identity: { login: { value: 'abon-test' }, contract: { value: '100' } },
    network: { connectionFamily: { value: 'PON' }, ip: { value: '' } },
    diagnostic: {
      technicalVisited: true,
      billingTechnicalComplete: true,
      usersideVisited: true,
      family: 'pon'
    },
    pon: {
      oltName: { value: 'OLT-1' },
      onuMac: { value: 'AABBCCDDEEFF' }
    },
    live: { oltSnapshot: { status: 'confirmed', onuStatus: 'online', capturedAt: '2026-08-14T10:00:00.000Z' } },
    appeal: started
  };

  const coverage = WB.appeals.contextCoverage(caseData);
  assert.ok(coverage.confirmed.some(item => item.id === 'billing'), 'billing complete → confirmed');
  assert.ok(coverage.confirmed.some(item => item.id === 'onu_olt'), 'LIVE confirmed → onu confirmed');
  // Visit alone is not enough:
  const visitOnly = WB.appeals.contextCoverage({
    identity: { login: { value: 'x' } },
    diagnostic: { technicalVisited: true }
  });
  assert.equal(visitOnly.items.find(i => i.id === 'billing').status, 'stale');
  assert.ok(Array.isArray(coverage.conflicts));

  const options = WB.appeals.availableOptions(started, caseData);
  assert.ok(options.length >= 1, 'first node must expose options');
  const answered = WB.appeals.answer(started, options[0].id, caseData, { source: 'operator' });
  assert.equal(answered.history.length, 1);
  assert.equal(answered.history[0].source, 'operator');
  assert.notEqual(answered.nodeId, started.nodeId);

  const vm = WB.appeals.resolveRuntimeGraph({
    appeal: answered,
    appealType: WB.appeals.typeForState(answered),
    caseData
  });
  assert.equal(vm.status, 'active');
  assert.equal(vm.root.typeId, 'no_internet');
  assert.ok(vm.currentNode);
  assert.ok(vm.traversedNodes.includes(answered.history[0].nodeId));
  assert.ok(vm.contextCoverage.confirmed.length >= 1);

  // Back restores previous node
  const backed = WB.appeals.back(answered);
  assert.equal(backed.nodeId, started.nodeId);
  assert.equal(backed.history.length, 0);

  // Snapshot is structured and works for partial path
  caseData.appeal = answered;
  const snap = WB.appeals.buildDiagnosticSnapshot(caseData);
  assert.equal(snap.typeId, 'no_internet');
  assert.equal(snap.graphRevision, answered.graphRevision);
  assert.equal(snap.path.length, 1);
  assert.ok(Array.isArray(snap.evidence));
  assert.ok(snap.evidence.every(item => !JSON.stringify(item).includes('innerHTML')));
  const summary = WB.appeals.formatDiagnosticSummary(snap);
  assert.match(summary, /Нет интернета|интернет/i);
  assert.doesNotMatch(summary, /undefined/);
}

// Missing evidence is not confirmed
{
  const coverage = WB.appeals.contextCoverage({});
  assert.ok(coverage.confirmed.length === 0 || coverage.missing.length > 0);
  assert.ok(coverage.items.every(item => item.status !== 'confirmed' || item.detail));
  const billing = coverage.items.find(item => item.id === 'billing');
  assert.equal(billing.status, 'missing');
}

console.log('runtime_graph_domain_unit_test: PASS');
