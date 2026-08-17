import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/audit/audit.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Function ${name} not found`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let templateDepth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') { templateDepth += 1; i += 1; depth += 1; continue; }
      if (quote === '`' && ch === '}' && templateDepth > 0) { templateDepth -= 1; depth -= 1; continue; }
      if (ch === quote && templateDepth === 0) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

const names = [
  'normalizeCompare', 'normalizeOltName', 'normalizeMac', 'validIpv4',
  'extractIpv4FromText', 'oltValuesEqual', 'normalizeSerial', 'ponReadinessAssessment'
];
const context = { compact: (value, max = 300) => { const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0,max)}…` : text; } };
vm.createContext(context);
vm.runInContext(`${names.map(extractFunction).join('\n')}\nthis.api={ponReadinessAssessment};`, context);
const assess = context.api.ponReadinessAssessment;

function row(billing = {}, tmc = {}, extra = {}) {
  return { billing, tmc, ...extra };
}

let a = assess(row(
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP:15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E' },
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'ready');
assert.equal(a.nextAction, 'poll_ready');

a = assess(row(
  { olt: 'Metrological-11A-EPON (172.16.13.105) BDCOM', onuSerial: 'FGXP:15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E' },
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'olt_mismatch');
assert.equal(a.nextAction, 'update_billing');
assert.match(a.advice, /Исправить OLT/i);

a = assess(row(
  { onuMac: 'B4:64:15:A2:CB:5E' },
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'needs_fields');
assert.deepEqual(Array.from(a.missingBilling), ['OLT', 'S/N']);
assert.equal(a.nextAction, 'update_billing');

a = assess(row(
  { olt: 'Huawei MA5800-X7 (172.16.1.10)' },
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'needs_fields');
assert.deepEqual(Array.from(a.missingBilling), ['S/N', 'ONU MAC']);

a = assess(row(
  { onuSerial: 'FGXP15A2CB5F' },
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'needs_fields');
assert.deepEqual(Array.from(a.missingBilling), ['OLT', 'ONU MAC']);

a = assess(row(
  { onuMac: 'B4:64:15:A2:CB:5E' },
  { tmcParseStatus: 'missing', tmcBlockFound: false }
));
assert.equal(a.status, 'tmc_insufficient');
assert.equal(a.nextAction, 'search_mac');
assert.match(a.advice, /поиск MAC/i);

a = assess(row(
  { onuMac: 'B4:64:15:A2:CB:5E' },
  {},
  { tmcLookupError: 'UserSide карточка не найдена' }
));
assert.equal(a.status, 'tmc_unavailable');
assert.equal(a.nextAction, 'search_mac');

a = assess(row(
  {},
  { olt: 'Huawei MA5800-X7 (172.16.1.10)', onuSerial: 'FGXP15A2CB5F', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'needs_fields');
assert.deepEqual(Array.from(a.missingBilling), ['OLT', 'S/N', 'ONU MAC']);

a = assess(row(
  { olt: 'Old OLT (172.16.13.105)', onuSerial: 'AAAAAAAAAAAA', onuMac: 'B4:64:15:A2:CB:5E' },
  { olt: 'New OLT (172.16.1.10)', onuSerial: 'BBBBBBBBBBBB', onuMac: 'B4:64:15:A2:CB:5E', tmcParseStatus: 'found', tmcBlockFound: true }
));
assert.equal(a.status, 'multiple_conflicts');
assert.equal(a.nextAction, 'review_identity');

console.log('audit_readiness_unit_test: PASS');
