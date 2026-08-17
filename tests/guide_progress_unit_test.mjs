import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const listeners = [];

globalThis.chrome = {
  storage: {
    local: {
      async get() { return {}; },
      async set() {}
    }
  },
  runtime: {
    onMessage: {
      addListener(fn) { listeners.push(fn); }
    },
    onInstalled: {
      addListener() {}
    }
  },
  tabs: {
    async update(tabId, patch) { return { id: tabId, ...patch }; }
  },
  windows: {
    async update(windowId, patch) { return { id: windowId, ...patch }; }
  }
};

await import(
  pathToFileURL(
    new URL('../src/background.js', import.meta.url).pathname
  ).href + `?v=${Date.now()}`
);

const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api, 'test API should be exposed');

const fact = value => ({ value, confidence: 0.98 });

// 1) A target action alone must never complete the step.
const navigationCase = api.emptyCase('case:guide-nav');
const guide = api.ensureGuideShape(navigationCase);
guide.steps['billing.open-technical'] = {
  stepId: 'billing.open-technical',
  status: 'action_confirmed',
  hintedAt: '2026-08-09T12:00:00.000Z',
  actionConfirmedAt: '2026-08-09T12:00:01.000Z',
  expected: {
    type: 'page_kind',
    pageKind: 'billing_technical',
    system: 'billing',
    actionMode: 'click'
  }
};
guide.active = {
  stepId: 'billing.open-technical',
  expected: guide.steps['billing.open-technical'].expected
};

let progress = api.reconcileGuideProgress(navigationCase, {
  system: 'billing',
  pageKind: 'billing_user',
  entityId: '123',
  meta: {}
}, []);
assert.equal(progress, null, 'click/action does not complete before expected context');
assert.equal(Boolean(guide.completed['billing.open-technical']), false);

progress = api.reconcileGuideProgress(navigationCase, {
  system: 'billing',
  pageKind: 'billing_technical',
  entityId: '123',
  meta: {}
}, []);
assert.equal(progress?.status, 'completed');
assert.equal(Boolean(guide.completed['billing.open-technical']), true);
assert.ok(
  navigationCase.journal.some(item => item.type === 'guide_context' && item.message.includes('billing.open-technical')),
  'context evidence should be journaled'
);
assert.ok(
  navigationCase.journal.some(item => item.type === 'guide_result' && item.message.includes('STEP DONE')),
  'step completion should be journaled'
);

// 2) Background data is not allowed to complete anything before the route stage is active.
const tmcCase = api.emptyCase('case:guide-tmc');
const tmcContext = {
  system: 'userside',
  pageKind: 'userside_customer',
  entityId: '32858',
  meta: {
    tmc: {
      checked: true,
      found: true,
      result: 'found',
      oltName: 'BDCOM OLT GP3600-16B',
      oltIp: '172.16.10.100',
      candidateCount: 1
    }
  }
};
assert.equal(
  api.reconcileGuideProgress(tmcCase, tmcContext, []),
  null,
  'background TMC evidence stays latent until a guide step is active'
);

tmcCase.locator.sourceStatus.tmc = {
  result: 'found',
  updatedAt: '2026-08-09T12:00:30.000Z'
};
const tmcGuide = api.ensureGuideShape(tmcCase);
tmcGuide.steps['userside.inspect-tmc:test'] = {
  stepId: 'userside.inspect-tmc:test',
  status: 'hinted',
  hintedAt: '2026-08-09T12:01:00.000Z',
  expected: { type: 'tmc_checked', actionMode: 'context' }
};
tmcGuide.active = {
  stepId: 'userside.inspect-tmc:test',
  expected: { type: 'tmc_checked', actionMode: 'context' }
};
progress = api.reconcileGuideProgress(tmcCase, tmcContext, []);
assert.equal(progress, null, 'passive parser evidence must never complete the TMC operator step');
assert.equal(tmcGuide.steps['userside.inspect-tmc:test'].status, 'hinted');
assert.equal(tmcGuide.completed['userside.inspect-tmc:test'], undefined);

tmcCase.workflow ||= {};
tmcCase.workflow.ponAcquisition ||= {};
tmcCase.workflow.ponAcquisition.tmcShownAt = '2026-08-09T12:01:05.000Z';
progress = api.reconcileGuideProgress(tmcCase, tmcContext, []);
assert.equal(progress?.status, 'completed');
assert.equal(
  tmcGuide.steps['userside.inspect-tmc:test'].action?.method,
  'context-arrival',
  'only the Workbench teleport/focus marker may complete the TMC step'
);
assert.equal(
  tmcGuide.completed['userside.inspect-tmc:test'].details.resolution,
  'workbench-teleport-shown'
);

// 3) Field edit completes on observed value, not on a click on the highlighted row.
const fieldCase = api.emptyCase('case:guide-field');
fieldCase.pon.onuSerial = fact('FGXP:C852E744');
const fieldGuide = api.ensureGuideShape(fieldCase);
fieldGuide.steps['billing.fill-technical:onuSerial'] = {
  stepId: 'billing.fill-technical:onuSerial',
  status: 'action_confirmed',
  hintedAt: '2026-08-09T12:02:00.000Z',
  actionConfirmedAt: '2026-08-09T12:02:01.000Z',
  expected: {
    type: 'technical_fields_match',
    fields: ['onuSerial'],
    expectedTechnical: { onuSerial: 'FGXP:C852E744' },
    actionMode: 'change'
  }
};
fieldGuide.active = {
  stepId: 'billing.fill-technical:onuSerial',
  expected: fieldGuide.steps['billing.fill-technical:onuSerial'].expected
};
progress = api.reconcileGuideProgress(fieldCase, {
  system: 'billing',
  pageKind: 'billing_technical',
  entityId: '123',
  meta: {}
}, []);
assert.equal(progress?.status, 'completed');

// 4) Save intent is not success; post-navigation verification is the result.
const saveCase = api.emptyCase('case:guide-save');
const saveGuide = api.ensureGuideShape(saveCase);
saveGuide.steps['billing.save-technical-fields'] = {
  stepId: 'billing.save-technical-fields',
  status: 'action_confirmed',
  hintedAt: '2026-08-09T12:03:00.000Z',
  actionConfirmedAt: '2026-08-09T12:03:01.000Z',
  expected: {
    type: 'billing_save_verified',
    fields: ['olt', 'onuSerial'],
    actionMode: 'click'
  }
};
saveGuide.active = {
  stepId: 'billing.save-technical-fields',
  expected: saveGuide.steps['billing.save-technical-fields'].expected
};

progress = api.reconcileGuideProgress(saveCase, {
  system: 'billing',
  pageKind: 'billing_technical',
  entityId: '123',
  meta: {}
}, []);
assert.equal(progress, null, 'save click alone does not complete');

progress = api.reconcileGuideProgress(saveCase, {
  system: 'billing',
  pageKind: 'billing_technical',
  entityId: '123',
  meta: {}
}, [{ observation: {
  type: api.LocatorObservationType.BILLING_OLT_SAVED,
  result: 'saved',
  summary: 'fields verified'
} }]);
assert.equal(progress?.status, 'completed');

// 5) Poll click completes only when a terminal poll response is parsed.
const pollCase = api.emptyCase('case:guide-poll');
const pollGuide = api.ensureGuideShape(pollCase);
pollGuide.steps['billing.ask-olt'] = {
  stepId: 'billing.ask-olt',
  status: 'action_confirmed',
  hintedAt: '2026-08-09T12:04:00.000Z',
  actionConfirmedAt: '2026-08-09T12:04:01.000Z',
  expected: {
    type: 'poll_terminal',
    outcomes: ['confirmed', 'not_found', 'timeout', 'partial'],
    actionMode: 'click'
  }
};
pollGuide.active = {
  stepId: 'billing.ask-olt',
  expected: pollGuide.steps['billing.ask-olt'].expected
};

assert.equal(
  api.reconcileGuideProgress(pollCase, {
    system: 'billing',
    pageKind: 'billing_onu_poll',
    meta: { poll: { pending: true, outcome: 'pending' } }
  }, []),
  null,
  'pending poll is not a completed route step'
);
pollCase.locator.sourceStatus.poll = {
  result: 'partial',
  partialSinceAt: new Date().toISOString(),
  partialGraceMs: 3000
};
assert.equal(
  api.reconcileGuideProgress(pollCase, {
    system: 'billing',
    pageKind: 'billing_onu_poll',
    meta: { poll: { pending: false, outcome: 'partial', matchedBy: [], interface: 'gpon0/11:7' } }
  }, []),
  null,
  'fresh partial is provisional and cannot finish the poll step'
);
progress = api.reconcileGuideProgress(pollCase, {
  system: 'billing',
  pageKind: 'billing_onu_poll',
  meta: { poll: { pending: false, outcome: 'confirmed', matchedBy: ['onuSerial'], interface: 'gpon0/11:7' } }
}, []);
assert.equal(progress?.status, 'completed');
assert.equal(pollGuide.completed['billing.ask-olt'].details.outcome, 'confirmed');

console.log('guide_progress_unit_test: PASS');
