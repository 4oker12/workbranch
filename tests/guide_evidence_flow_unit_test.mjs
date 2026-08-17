import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/ui/guide.js', import.meta.url),
  'utf8'
);

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escape = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

const macResultOverlayAction = new Function(
  `${extractFunction('macResultOverlayAction')}; return macResultOverlayAction;`
)();

assert.deepEqual(
  macResultOverlayAction({ oltIp: '' }),
  {
    action: 'open-candidate-device',
    label: 'Открыть OLT и посмотреть IP'
  },
  'missing OLT IP should expose the one useful lookup'
);
assert.deepEqual(
  macResultOverlayAction({ oltIp: '172.16.1.239' }),
  {
    action: 'return-customer',
    label: 'Вернуться к абоненту'
  },
  'known OLT IP should avoid a redundant equipment detour'
);

const shouldPreserveEvidenceOverlay = new Function(
  `${extractFunction('shouldPreserveEvidenceOverlay')}; return shouldPreserveEvidenceOverlay;`
)();

assert.equal(
  shouldPreserveEvidenceOverlay({ stickyEvidence: true }, { isConnected: true }),
  true,
  'a visible MAC/OLT evidence hint must survive a Locator state refresh'
);
assert.equal(
  shouldPreserveEvidenceOverlay({ stickyEvidence: true }, { isConnected: false }),
  false,
  'a genuinely detached DOM target may close the hint'
);
assert.equal(
  shouldPreserveEvidenceOverlay({ stickyEvidence: false }, { isConnected: true }),
  false,
  'ordinary operational hints still follow the active recommendation'
);

const technicalFieldRequirements = new Function(
  `${extractFunction('technicalFieldRequirements')}; return technicalFieldRequirements;`
)();
const byField = (kind, field) => technicalFieldRequirements(kind)
  .find(item => item.field === field);

assert.equal(byField('epon', 'onuMac').required, true);
assert.equal(byField('epon', 'onuSerial').required, false);
assert.equal(byField('gpon', 'onuSerial').required, false);
assert.equal(byField('gpon', 'onuSerial').conditional, true);
assert.equal(byField('gpon', 'onuMac').required, true);
assert.equal(byField('huawei', 'onuSerial').required, false);
assert.equal(byField('huawei', 'onuSerial').conditional, true);
assert.equal(byField('ethernet', 'olt').required, false);
assert.equal(byField('epon', 'subscriberMac').importantIfMissing, true);


const scoreOltOption = new Function(
  `${extractFunction('oltLookupTransliterate')};` +
  `${extractFunction('canonicalOltLookupText')};` +
  `${extractFunction('oltLookupTokens')};` +
  `${extractFunction('oltTechnologyTag')};` +
  `${extractFunction('scoreOltOption')}; return scoreOltOption;`
)();

const hotovCandidate = 'BDCOM OLT P3616-2TE - с. Хотов, ул. Промышленная (с. Хотов), 1/А п.1 (подвал AGG) #1168';
assert.ok(
  scoreOltOption(hotovCandidate, 'Hotov-EPON (172.16.9.200)') >= 60,
  'name-only MAC evidence should be able to resolve the unique Billing OLT alias'
);
assert.equal(
  scoreOltOption(hotovCandidate, 'Metrological-11A-GPON (172.16.13.105)'),
  0,
  'technology mismatch must prevent an unsafe automatic OLT selection'
);

class FakeElement {
  constructor(value = '') {
    this.value = value;
    this.dataset = {};
    this.events = [];
  }
  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}
class FakeEvent {
  constructor(type) { this.type = type; }
}
const applyTechnicalTextValue = new Function(
  'Element',
  'Event',
  `${extractFunction('applyTechnicalTextValue')}; return applyTechnicalTextValue;`
)(FakeElement, FakeEvent);
const serialControl = new FakeElement('OLD-SERIAL');
const serialPrefill = applyTechnicalTextValue(
  serialControl,
  'NEW-SERIAL',
  value => String(value || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
);
assert.equal(serialPrefill.status, 'applied');
assert.equal(serialControl.value, 'NEW-SERIAL');
assert.deepEqual(serialControl.events, ['input', 'change']);
assert.equal(serialControl.dataset.simnetWbTmcPrefill, '1');
assert.ok(
  !serialControl.events.includes('submit'),
  'TMC prefill must update controls without submitting Billing'
);

const rowTarget = extractFunction('rowHighlightTarget');
assert.ok(
  rowTarget.indexOf("closest?.('.table_block')") < rowTarget.indexOf("closest?.('tr')"),
  'UserSide MAC hint should prefer the whole table_block over the magnifier link or a table row'
);

assert.ok(
  source.includes("id: inspectionStepId")
  && source.includes("overlayAction: 'complete-step'")
  && source.includes('fieldSummary: inspection.fields'),
  'Billing technical data must have an explicit field-review step before leaving for TMC'
);
assert.ok(
  source.includes('function refreshEvidenceTrail()')
  && source.includes('clearStaleEvidenceTraces(new Set())')
  && source.includes('function refreshFamiliarReminders()')
  && source.includes('clearStaleFamiliarReminders(new Set())'),
  'completed evidence and familiar targets must no longer glow ambiently on native CRM; replay owns explicit highlighting'
);
assert.ok(
  source.includes("source === 'mac_name'")
  && source.includes('resolveAndApplyOltByName')
  && source.includes("overlayAction: 'return-billing-technical'"),
  'name-only MAC result must return control to Billing and resolve the OLT there before fallback to the device card'
);

console.log('guide_evidence_flow_unit_test: PASS');
