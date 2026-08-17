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
    async update(tabId, patch) {
      return { id: tabId, ...patch };
    }
  },
  windows: {
    async update(windowId, patch) {
      return { id: windowId, ...patch };
    }
  }
};

await import(
  pathToFileURL(
    new URL('../src/background.js', import.meta.url).pathname
  ).href + `?v=${Date.now()}`
);

const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api, 'test API should be exposed');

const callParams = api.callRegistrationParams({
  customerId: '191',
  fields: [
    { name: '_csrf', value: 'csrf-token' },
    { name: 'customer_id', value: '999' },
    { name: 'add_field_sub_category_id', value: '5' },
    { name: 'additional_fields[]', value: '13' },
    { name: 'standart_comment', value: '19' },
    { name: 'comment', value: 'Проверка' },
    { name: 'dopf_13', value: '0441234567' }
  ]
});
assert.equal(callParams.get('customer_id'), '191', 'payload cannot retarget the native form');
assert.equal(callParams.get('_csrf'), 'csrf-token');
assert.deepEqual(callParams.getAll('additional_fields[]'), ['13']);
assert.throws(
  () => api.callRegistrationParams({
    customerId: '191',
    fields: [
      { name: '_csrf', value: 'csrf-token' },
      { name: 'standart_comment', value: '19' },
      { name: 'dopf_13', value: '0441234567' }
    ]
  }),
  /служебное поле телефона/,
  'additional_fields[]=13 remains mandatory'
);

assert.equal(
  api.customerIdFromCallUrl('https://userside.simnet.kiev.ua/customer/54851'),
  '54851'
);
assert.equal(api.callIpv4('10.9.125.135'), '10.9.125.135');
assert.equal(api.callIpv4('999.9.1.1'), '');
assert.equal(
  api.exactCustomerIdFromSearch(`
    <table>
      <tr><td>abon111111 · договор 11111</td><td><a href="/customer/44">Открыть</a></td></tr>
      <tr><td>kundanika · договор 1910</td><td><a href="/customer/191">Открыть</a></td></tr>
    </table>
  `, {
    identity: { login: { value: 'kundanika' }, contract: { value: '1910' } }
  }),
  '191',
  'Billing call registration resolves only the exact UserSide customer'
);

const verboseJournalCase = api.emptyCase('case:verbose-journal');
verboseJournalCase.meta.journalFormat = 1;
verboseJournalCase.journal = [
  {
    id: 'external',
    at: new Date().toISOString(),
    type: 'operator_click',
    message: 'External click',
    details: {
      target: { id: 'native-button', text: 'Открыть' },
      rawTarget: { id: 'native-button', text: 'Открыть' },
      dom: {
        cssPath: 'body > main > button',
        targetHtml: 'x'.repeat(2000),
        parentHtml: 'y'.repeat(3000),
        grandparentHtml: 'z'.repeat(4000)
      }
    },
    signature: `operator_click|${'duplicate'.repeat(3000)}`
  },
  {
    id: 'owned',
    at: new Date().toISOString(),
    type: 'operator_click',
    message: 'Workbench form click',
    details: { target: { id: 'simnet-workbench-call-registration-host' } },
    signature: 'legacy-owned'
  }
];
const compactedJournalCase = api.ensureCaseShape(verboseJournalCase, verboseJournalCase.id);
assert.equal(compactedJournalCase.journal.length, 1, 'Workbench-owned UI actions are not journaled');
assert.match(compactedJournalCase.journal[0].signature, /^j2_[a-z0-9]+$/);
assert.equal('rawTarget' in compactedJournalCase.journal[0].details, false);
assert.ok(compactedJournalCase.journal[0].details.dom.grandparentHtml.length <= 1301);

assert.equal(
  api.validHandoffToken('simnet_wb_abc12345'),
  true,
  'valid handoff token'
);
assert.equal(
  api.validHandoffToken('bad-token'),
  false,
  'invalid handoff token'
);

const handoff = {
  token: 'simnet_wb_abc12345',
  caseId: 'billing:billing:867',
  login: 'abon8670',
  contract: '8670',
  billingId: '867',
  customerId: '',
  subscriberIp: '10.0.0.25',
  purpose: 'userside-tmc',
  sourceTabId: 10
};

const attached = api.attachHandoffToContext(
  {
    system: 'userside',
    pageKind: 'userside_customer',
    identity: {
      customerId: {
        value: '344',
        confidence: 0.98,
        source: 'url:path'
      }
    },
    network: {},
    pon: {},
    profile: {}
  },
  handoff
);

assert.equal(attached.identity.billingId.value, '867');
assert.equal(attached.identity.customerId.value, '344');
assert.equal(attached.network.ip.value, '10.0.0.25');

const fact = value => ({ value, confidence: 0.98 });
const caseData = api.emptyCase('billing:billing:867');
caseData.identity.billingId = fact('867');
caseData.network.connectionFamily = fact('PON');
caseData.network.ip = fact('10.0.0.25');
caseData.network.mac = fact('AA:BB:CC:DD:EE:01');
caseData.pon.onuSerial = fact('TEST:12345678');
caseData.contexts.technical = { pageKind: 'billing_technical' };
caseData.contexts.userside = { pageKind: 'userside_customer' };
caseData.pon.tmcOltName = fact('Huawei OLT Test');
caseData.pon.tmcOltIp = fact('172.16.0.10');
caseData.locator.sourceStatus.juniper = { result: 'online', details: { status: 'online' } };

let diagnostic = api.diagnosticSnapshot(caseData);
assert.equal(diagnostic.usersideVisited, true);
assert.equal(diagnostic.hasTmcOlt, true);
assert.equal(diagnostic.hasBillingOltName, false);
assert.equal(diagnostic.readyForOnuPoll, false);
assert.equal(diagnostic.nextRequiredSource, 'search_mac');

caseData.pon.oltName = fact('Test-OLT-Huawei Huawei');
caseData.pon.oltIp = fact('172.16.0.10');
caseData.pon.pollType = fact('Huawei');
caseData.pon.pollAction = fact('313');

diagnostic = api.diagnosticSnapshot(caseData);
assert.equal(diagnostic.readyForOnuPoll, false, 'ONU MAC is the mandatory minimum for a poll attempt');
assert.equal(diagnostic.nextRequiredSource, 'search_mac');
assert.equal(diagnostic.pollAction, '313');

// TMC writeback scope is dynamic. A field absent in TMC is not an obligation,
// even when the global Billing diagnostic still reports that field missing.
const partialTmc = api.emptyCase('case:partial-tmc-writeback');
partialTmc.network.connectionFamily = fact('PON');
partialTmc.diagnostic = {
  isPon: true,
  billingMissingTechnical: ['onuMac'],
  billingTechnicalComplete: false
};
partialTmc.pon.tmcOltName = fact('Huawei MA5800-X15');
partialTmc.pon.tmcOltIp = fact('172.16.1.50');
partialTmc.pon.tmcOnuSerial = fact('FGXPC871E2B1');
// Current TMC intentionally has no ONU MAC.
partialTmc.pon.tmcOnuMac = fact('');
partialTmc.pon.oltName = fact('Huawei MA5800-X15');
partialTmc.pon.oltIp = fact('172.16.1.50');
partialTmc.pon.onuSerial = fact('FGXPC871E2B1');
partialTmc.workflow.ponAcquisition.tmcShownAt = '2026-08-17T00:00:00.000Z';
let partialFlow = api.syncPonWritebackWorkflow(partialTmc);
assert.deepEqual(partialFlow.tmcExpectedFields, ['olt', 'onuSerial']);
assert.equal(partialFlow.technicalWritebackVerified, true, 'missing Billing ONU MAC must not block a TMC pass when TMC never supplied ONU MAC');
assert.deepEqual(partialFlow.tmcWritebackConflictFields, []);

const passiveTmc = api.emptyCase('case:passive-partial-tmc');
passiveTmc.network.connectionFamily = fact('PON');
passiveTmc.diagnostic = { isPon: true, billingMissingTechnical: ['onuMac'], billingTechnicalComplete: false };
passiveTmc.pon.tmcOltName = fact('Huawei MA5800-X15');
passiveTmc.pon.oltName = fact('Huawei MA5800-X15');
partialFlow = api.syncPonWritebackWorkflow(passiveTmc);
assert.deepEqual(partialFlow.tmcExpectedFields, ['olt']);
assert.equal(partialFlow.technicalWritebackVerified, false, 'background TMC parsing alone cannot verify writeback before canonical TMC teleport');

const conflictingTmc = api.emptyCase('case:tmc-writeback-conflict');
conflictingTmc.network.connectionFamily = fact('PON');
conflictingTmc.diagnostic = { isPon: true, billingMissingTechnical: [], billingTechnicalComplete: true };
conflictingTmc.pon.tmcOnuSerial = fact('SERIAL-NEW');
conflictingTmc.pon.onuSerial = fact('SERIAL-OLD');
conflictingTmc.workflow.ponAcquisition.tmcShownAt = '2026-08-17T00:00:00.000Z';
const conflictFlow = api.syncPonWritebackWorkflow(conflictingTmc);
assert.equal(conflictFlow.technicalWritebackVerified, false);
assert.deepEqual(conflictFlow.tmcWritebackConflictFields, ['onuSerial']);


// Non-terminal evidence may be very complete, but 100% is reserved for explicit termination.
assert.ok(diagnostic.completion < 100, 'non-terminal route must never display 100%');

// A PON ONU's LAN/UNI port is not the provider Ethernet access switch.
const ponLanLegacy = api.emptyCase('case:pon-lan-migration');
ponLanLegacy.network.connectionFamily = fact('PON');
ponLanLegacy.network.accessDeviceId = fact('46184');
ponLanLegacy.network.accessDeviceName = fact('FoxGate ONU G2001R');
ponLanLegacy.network.accessPort = fact('1');
ponLanLegacy.network.accessLinkState = fact('down');
api.ensureCaseShape(ponLanLegacy, ponLanLegacy.id);
assert.equal(ponLanLegacy.network.accessDeviceId, undefined);
assert.equal(ponLanLegacy.network.accessPort, undefined);
assert.equal(ponLanLegacy.pon.onuDeviceId.value, '46184');
assert.equal(ponLanLegacy.pon.onuLanPort.value, '1');
assert.equal(ponLanLegacy.pon.onuLanLinkState.value, 'down');

// OLT response, binding verification and service health are independent dimensions.
const separatedDiagnostic = api.emptyCase('case:diagnostic-dimensions');
separatedDiagnostic.identity.login = fact('abon439108');
separatedDiagnostic.network.connectionFamily = fact('PON');
separatedDiagnostic.locator.termination = {
  status: 'confirmed',
  pollResponded: true,
  pollCompleted: true,
  identityAssessment: 'unverified'
};
separatedDiagnostic.locator.bestCandidate = { matchedCurrentSubscriber: false };
separatedDiagnostic.locator.evidence = [{
  type: 'TMC_RESULT',
  result: 'found',
  details: { identityCheck: { isMatch: true } }
}];
separatedDiagnostic.live.oltSnapshot = { status: 'confirmed', outcome: 'confirmed', onuStatus: 'offline' };
const dimensions = api.diagnosticSnapshot(separatedDiagnostic);
assert.equal(dimensions.completion, 100, 'route completion stays backward compatible');
assert.equal(dimensions.pollResponded, true);
assert.equal(dimensions.bindingVerified, true, 'cross-source TMC identity can verify the binding independently');
assert.equal(dimensions.serviceState, 'offline');
assert.equal(dimensions.serviceHealthy, false, 'a responded OFFLINE ONU must never be interpreted as healthy service');

// Repeated scans of the same rejected fact update one conflict instead of spamming 40 copies.
const conflictDedupe = api.emptyCase('case:conflict-dedupe');
conflictDedupe.network.ip = { value: '10.8.85.171', source: 'billing:userside-handoff-ip', confidence: 0.96 };
api.mergeFacts(conflictDedupe, 'network', {
  ip: { value: '10.9.16.159', source: 'userside:page-ip', confidence: 0.9 }
}, 'userside');
api.mergeFacts(conflictDedupe, 'network', {
  ip: { value: '10.9.16.159', source: 'userside:page-ip', confidence: 0.9 }
}, 'userside');
assert.equal(conflictDedupe.conflicts.length, 1);
assert.equal(conflictDedupe.conflicts[0].count, 2);

// Parent GPON interface and the specific ONT suffix are hierarchical evidence, not a conflict.
const interfaceCase = api.emptyCase('case:interface-hierarchy');
interfaceCase.pon.locatedInterface = { value: 'GPON0/1/0:49', source: 'billing:direct-olt-poll-interface', confidence: 0.99 };
api.mergeFacts(interfaceCase, 'pon', {
  locatedInterface: { value: 'GPON 0/1/0', source: 'userside:mac-search-interface', confidence: 0.62 }
}, 'userside');
assert.equal(interfaceCase.conflicts.length, 0);
assert.equal(interfaceCase.pon.locatedInterface.value, 'GPON0/1/0:49');

console.log('background_unit_test: PASS');

const resumable = api.emptyCase('login:abon111408');
resumable.identity.login = fact('abon111408');
resumable.identity.billingId = fact('11140');
resumable.identity.customerId = fact('14194');
resumable.diagnostic.stage = 'candidate-found';
resumable.locator.recommendation = {
  action: 'fill_billing_olt',
  ruleId: 'candidate.fill-billing',
  reason: 'OLT найдена в ТМЦ.',
  params: {
    phase: 'select',
    candidate: { id: '42477|gpon0/6/12:31|C4CD501204D3' }
  }
};

assert.equal(
  api.shouldContinueTabCase(resumable, {
    system: 'billing',
    pageKind: 'billing_other',
    entityId: '11140',
    identity: {}
  }),
  true,
  'subscriber payment/other Billing page keeps the current case'
);
assert.equal(
  api.shouldContinueTabCase(resumable, {
    system: 'billing',
    pageKind: 'billing_other',
    entityId: '99999',
    identity: {}
  }),
  false,
  'different subscriber entity cannot inherit the case'
);
assert.equal(
  api.shouldContinueTabCase(resumable, {
    system: 'billing',
    pageKind: 'billing_user_list',
    entityId: '',
    identity: {}
  }),
  true,
  'temporary neutral navigation keeps route state'
);
assert.equal(
  api.shouldContinueTabCase(resumable, {
    system: 'billing',
    pageKind: 'billing_user',
    entityId: '22222',
    identity: { login: fact('abon222228') }
  }),
  false,
  'a newly identified subscriber starts/resolves another case'
);

api.updateRouteCheckpoint(resumable, {
  system: 'billing',
  pageKind: 'billing_other'
});
assert.equal(resumable.route.resume.action, 'fill_billing_olt');
assert.equal(resumable.route.resume.phase, 'select');
assert.equal(resumable.route.checkpoints.length, 1);

api.updateRouteCheckpoint(resumable, {
  system: 'billing',
  pageKind: 'billing_technical'
});
assert.equal(
  resumable.route.checkpoints.length,
  1,
  'same unresolved step is not duplicated by unrelated navigation'
);

const stateWithResumeCase = {
  cases: {
    [resumable.id]: resumable
  }
};
assert.equal(
  api.resolveCaseId(stateWithResumeCase, {
    system: 'billing',
    pageKind: 'billing_other',
    entityId: '11140',
    identity: {}
  }),
  resumable.id,
  'entity id on a neutral Billing page resolves the existing subscriber case'
);

// TMC writeback no-Save decision must survive full Billing document navigation.
// The old content script can be destroyed before it sees the destination, so
// background context history for the same tab is the source of truth.
const writebackExit = api.emptyCase('login:abon382037');
writebackExit.viewsByTab = {
  '77': {
    TECH: {
      pageKind: 'billing_technical',
      observedAt: '2026-08-17T04:01:55.000Z',
      pageInstanceStartedAt: 100
    }
  }
};
writebackExit.workflow = {
  ponAcquisition: {
    tmcShownAt: '2026-08-17T04:01:10.000Z',
    tmcWritebackRequestedAt: '2026-08-17T04:01:53.000Z',
    tmcWritebackPendingSave: true,
    tmcWritebackVerifiedInForm: true,
    tmcWritebackAppliedFields: ['olt'],
    tmcWritebackMatchedFields: ['onuSerial', 'onuMac']
  }
};
writebackExit.locator = { sourceStatus: {} };
assert.equal(
  api.closeTmcWritebackAfterTechnicalExit(
    writebackExit,
    { origin: { tabId: 77 } },
    { pageKind: 'billing_user' }
  ),
  true,
  'leaving Billing Technical without Save closes the one-shot writeback opportunity'
);
assert.equal(writebackExit.workflow.ponAcquisition.tmcWritebackPendingSave, false);
assert.equal(writebackExit.workflow.ponAcquisition.tmcWritebackLastStatus, 'declined');
assert.ok(writebackExit.workflow.ponAcquisition.tmcWritebackDeclinedAt);
assert.equal(
  writebackExit.workflow.ponAcquisition.tmcShownAt,
  '2026-08-17T04:01:10.000Z',
  'declining Save does not erase the completed TMC milestone'
);

const writebackReload = api.emptyCase('login:abon-reload');
writebackReload.viewsByTab = {
  '78': {
    TECH: {
      pageKind: 'billing_technical',
      observedAt: '2026-08-17T04:01:55.000Z',
      pageInstanceStartedAt: 100
    }
  }
};
writebackReload.workflow = { ponAcquisition: {
  tmcWritebackRequestedAt: '2026-08-17T04:01:53.000Z',
  tmcWritebackPendingSave: true,
  tmcWritebackVerifiedInForm: true,
  tmcWritebackAppliedFields: ['olt']
} };
writebackReload.locator = { sourceStatus: {} };
assert.equal(
  api.closeTmcWritebackAfterTechnicalExit(
    writebackReload,
    { origin: { tabId: 78 } },
    { pageKind: 'billing_technical' }
  ),
  false,
  'reloading/staying in Technical is not a no-Save decision'
);
assert.equal(writebackReload.workflow.ponAcquisition.tmcWritebackPendingSave, true);

const writebackSaving = api.emptyCase('login:abon-save');
writebackSaving.viewsByTab = {
  '79': {
    TECH: {
      pageKind: 'billing_technical',
      observedAt: '2026-08-17T04:01:55.000Z',
      pageInstanceStartedAt: 100
    }
  }
};
writebackSaving.workflow = { ponAcquisition: {
  tmcShownAt: '2026-08-17T04:01:10.000Z',
  tmcWritebackRequestedAt: '2026-08-17T04:01:53.000Z',
  tmcWritebackPendingSave: true,
  tmcWritebackVerifiedInForm: true,
  tmcWritebackAppliedFields: ['olt']
} };
writebackSaving.locator = { sourceStatus: {
  billing_save_intent: {
    result: 'intent',
    updatedAt: '2026-08-17T04:01:56.000Z'
  }
} };
assert.equal(
  api.closeTmcWritebackAfterTechnicalExit(
    writebackSaving,
    { origin: { tabId: 79 } },
    { pageKind: 'billing_user' }
  ),
  false,
  'native Save navigation remains pending verification and is never converted to decline'
);
assert.equal(writebackSaving.workflow.ponAcquisition.tmcWritebackPendingSave, true);

const writebackPartialExit = api.emptyCase('login:abon-olt-only-partial');
writebackPartialExit.viewsByTab = {
  '80': {
    TECH: {
      pageKind: 'billing_technical',
      observedAt: '2026-08-17T04:52:49.000Z',
      pageInstanceStartedAt: 100
    }
  }
};
writebackPartialExit.workflow = { ponAcquisition: {
  tmcShownAt: '2026-08-17T04:52:33.453Z',
  tmcWritebackRequestedAt: '2026-08-17T04:52:44.482Z',
  // Production bug: OLT was inserted, but an unrelated comparison left the
  // aggregate result "partial", therefore old code had pendingSave=false.
  tmcWritebackPendingSave: false,
  tmcWritebackVerifiedInForm: false,
  tmcWritebackAppliedFields: ['olt'],
  tmcWritebackConflictFields: ['onuMac'],
  tmcWritebackLastStatus: 'partial'
} };
writebackPartialExit.locator = { sourceStatus: {} };
assert.equal(
  api.closeTmcWritebackAfterTechnicalExit(
    writebackPartialExit,
    { origin: { tabId: 80 } },
    { pageKind: 'billing_user' }
  ),
  true,
  'leaving Technical closes the opportunity when a real OLT prefill occurred even if an unrelated comparison made the aggregate result partial'
);
assert.equal(writebackPartialExit.workflow.ponAcquisition.tmcWritebackLastStatus, 'declined');
assert.ok(writebackPartialExit.workflow.ponAcquisition.tmcWritebackDeclinedAt);

console.log('background_unit_test: PASS');
