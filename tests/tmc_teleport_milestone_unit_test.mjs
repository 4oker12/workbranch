import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const evidenceSource = fs.readFileSync(path.join(root, 'src/core/evidence-navigator.js'), 'utf8');
const guideSource = fs.readFileSync(path.join(root, 'src/ui/guide.js'), 'utf8');
const railSource = fs.readFileSync(path.join(root, 'src/ui/rail.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

const WB = {};
const sandbox = { globalThis: { SIMNET_WB: WB }, console, Date };
vm.createContext(sandbox);
vm.runInContext(evidenceSource, sandbox);
const nav = WB.evidenceNavigator;
assert.ok(nav, 'evidence navigator registers');

const c = {
  id: 'login:abon211125',
  contexts: {
    us: { pageKind: 'userside_customer', observedAt: '2026-08-17T00:00:00Z' }
  },
  locator: {
    sourceStatus: { tmc: { result: 'found', details: { identityCheck: { isMatch: true } } } },
    evidence: [{ type: 'TMC_RESULT', result: 'found', at: '2026-08-17T00:00:01Z', details: { identityCheck: { isMatch: true } } }]
  },
  route: {
    usersideVisitedAt: '2026-08-17T00:00:00Z',
    tmcFoundAt: '2026-08-17T00:00:01Z',
    guide: {
      completed: {
        'userside.find-tmc': { at: '2026-08-17T00:00:02Z', details: { resolution: 'cached-evidence' } }
      }
    }
  },
  workflow: { ponAcquisition: {} },
  diagnostic: {}
};

assert.equal(nav.achieved(c, 'tmc'), false, 'UserSide visit + parser + legacy tmcFoundAt + old Guide completion must not count');
assert.equal(nav.recommendationAllowed(c, { id: 'userside.find-tmc' }), true, 'teleport CTA remains available until real show');

c.workflow.ponAcquisition.tmcShownAt = '2026-08-17T00:00:03Z';
c.workflow.ponAcquisition.tmcShownFields = ['olt', 'serial', 'mac'];
assert.equal(nav.achieved(c, 'tmc'), true, 'only tmcShownAt creates the operator milestone');
assert.equal(nav.trail(c).find(item => item.key === 'tmc')?.at, '2026-08-17T00:00:03Z', 'milestone time is teleport/show time');
assert.equal(nav.recommendationAllowed(c, { id: 'userside.find-tmc' }), false, 'teleport CTA is suppressed only after the real milestone');

assert.match(guideSource, /function recordTmcTeleportShown\(/, 'Guide owns canonical TMC teleport completion');
assert.match(guideSource, /if \(!visual\?\.confirmed\)/, 'TMC milestone requires visual confirmation');
assert.match(guideSource, /tmcTeleportVisualConfirmation\(caseData, tmcVisualRoot\)/, 'visual confirmation is computed from the real target');
assert.match(guideSource, /tmcShownAt: at/, 'Guide persists tmcShownAt only after confirmed show');
assert.match(guideSource, /TMC_TELEPORT_CONFIRMED/, 'confirmed teleport is traceable');

assert.doesNotMatch(
  railSource.slice(railSource.indexOf('async showTmcBlock()'), railSource.indexOf('async maybeAutoPrefillMissingTmcTechnical')),
  /patchWorkflow\?\.\('ponAcquisition',\s*\{\s*tmcShownAt/,
  'Rail button itself cannot mark TMC visited'
);
assert.match(backgroundSource, /const shownAt = String\(caseData\?\.workflow\?\.ponAcquisition\?\.tmcShownAt/, 'tmc_checked expectation is gated by teleport marker');
assert.doesNotMatch(backgroundSource, /caseData\.route\.tmcFoundAt\s*\|\|=/, 'passive parser cannot persist route-level TMC reached milestone');
assert.match(backgroundSource, /delete caseData\.route\.tmcFoundAt/, 'legacy passive tmcFoundAt is actively removed');

console.log('tmc_teleport_milestone_unit_test: PASS');
