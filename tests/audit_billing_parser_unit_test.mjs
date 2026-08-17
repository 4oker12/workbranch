import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcherPath = path.join(here, '..', 'src', 'audit', 'launcher.js');
const source = fs.readFileSync(launcherPath, 'utf8');

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

const fnSource = extractFunction('parseBillingListDocument');
const parseBillingListDocument = new Function(
  'sanitizeUrl',
  `${fnSource}; return parseBillingListDocument;`
)(value => String(value || ''));

function anchor(href) {
  return { getAttribute: name => name === 'href' ? href : '' };
}
function row(text, hrefs = []) {
  return {
    innerText: text,
    textContent: text,
    querySelectorAll: selector => selector === 'a[href]' ? hrefs.map(anchor) : []
  };
}
function doc(rows, bodyText = '') {
  return {
    body: { innerText: bodyText, textContent: bodyText },
    querySelectorAll: selector => selector === 'tr' ? rows : []
  };
}

const base = 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=listuser';

// 1) Bare abon mention in a service/note row must not become a subscriber.
{
  const result = parseBillingListDocument(doc([
    row('Примечание по abon154078')
  ], 'Примечание по abon154078'), base);
  assert.deepEqual(result, []);
}

// 2) A genuine row with a real Billing subscriber link must be accepted.
{
  const result = parseBillingListDocument(doc([
    row('abon236395 Иванов', ['/cgi-bin/adm/adm.pl?a=user&id=23639'])
  ]), base);
  assert.equal(result.length, 1);
  assert.equal(result[0].login, 'abon236395');
  assert.equal(result[0].contract, '236395');
  assert.equal(result[0].billingId, '23639');
}

// 3) A note first and a genuine row later must still produce the genuine record.
{
  const result = parseBillingListDocument(doc([
    row('История: abon236395 смена оборудования'),
    row('abon236395 Иванов', ['/cgi-bin/adm/adm.pl?a=user&id=23639'])
  ]), base);
  assert.equal(result.length, 1);
  assert.equal(result[0].billingId, '23639');
}

// 4) Technical-data link is also a valid row-level subscriber proof.
{
  const result = parseBillingListDocument(doc([
    row('abon777777', ['/cgi-bin/adm/adm.pl?a=dopdata&id=77777'])
  ]), base);
  assert.equal(result.length, 1);
  assert.equal(result[0].billingId, '77777');
}

// 5) Invalid/non-numeric ids are rejected.
{
  const result = parseBillingListDocument(doc([
    row('abon888888', ['/cgi-bin/adm/adm.pl?a=user&id=bad'])
  ]), base);
  assert.deepEqual(result, []);
}

console.log('audit_billing_parser_unit_test: PASS');
