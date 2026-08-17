import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, '..', relative), 'utf8');
const rail = read('src/ui/rail.js');
const guide = read('src/ui/guide.js');

// LIVE stays a compact operator layer. Unperformed PON steps are not rendered
// as a standing checklist; only real evidence plus one current recommendation is shown.
assert.match(rail, /LIVE · снимок/);
assert.match(rail, /live-fingerprint/);
assert.doesNotMatch(rail, /pon-live-goal/);
assert.doesNotMatch(rail, /ONU не опрошено/);
assert.match(rail, /Что уже сделано/);
assert.match(rail, /live-context-card/);
assert.match(rail, /diagnostic\.isEthernet/);
assert.doesNotMatch(rail, /Operator Cockpit/);
assert.doesNotMatch(rail, /data-action="juniper-layer"/);

// On Billing's native ONU poll page the endpoint is still the real «Запрос OLT»
// cell, but it now uses the same universal lifecycle/Focus Layer as every other target.
for (const token of [
  'findAskOltLink',
  'askOltHighlightTarget',
  "link?.closest?.('td,th') || link",
  "registerResolver?.('billing.olt.request'",
  "id: 'billing.ask-olt'"
]) assert.ok(guide.includes(token), `missing universal final native poll focus token: ${token}`);
assert.doesNotMatch(rail, /syncPonPollPageHint/);
assert.doesNotMatch(rail, /simnet-live-final-action/);
assert.doesNotMatch(rail, /simnet-live-final-zone/);

// Workbench-owned micro-hints remain subtle in the base page, but when Focus
// Layer is active they rise above the dimming layer instead of becoming useless
// darkened furniture. The rail itself still stays on top.
assert.match(guide, /z-index: 2147483644/);
assert.match(guide, /classList\?\.toggle\('simnet-wb-guide-active'/);
assert.match(rail, /html\.simnet-wb-guide-active \.simnet-live-field-help/);
assert.match(rail, /z-index:2147483645!important/);
assert.match(rail, /opacity:\.72!important/);
assert.match(rail, /data-simnet-help/);
assert.match(rail, /data-help=/);

// The main Juniper card exposes only what matters during the call: session,
// traffic activity and time. IP/MAC/BRAS details remain in Case data, not on the
// first LIVE surface.
for (const token of [
  "snapshotFact('Трафик', traffic)",
  'details.lastEventTime || details.startTime',
  'details.speedRaw',
  'Juniper · только чтение',
  'juniper-essential'
]) assert.ok(rail.includes(token), `missing Juniper LIVE token: ${token}`);
assert.doesNotMatch(rail, /snapshotFact\('IP', details\.subscriberIp\)/);
assert.doesNotMatch(rail, /snapshotFact\('MAC', details\.subscriberMac\)/);
assert.doesNotMatch(rail, /BRAS \$\{bras\}/);

// Juniper stays available as read-only evidence and can still be highlighted
// when explicitly requested, but it must not hard-gate the approved PON
// acquisition flow before Billing technical data.
for (const token of [
  'findJuniperLink',
  'findJuniperStatusTarget',
  'findJuniperRelatedTargets'
]) assert.ok(guide.includes(token), `missing optional Juniper helper token: ${token}`);
assert.doesNotMatch(guide, /const juniperReviewStatus[\s\S]{0,2200}billing\.return-for-juniper/);

// Focus Layer remains guidance only and native CRM controls stay clickable.
assert.match(guide, /related-marker/);
assert.match(guide, /1 · Сейчас/);
assert.match(guide, /background: rgba\(5,10,16,\.22\)/);
assert.match(guide, /border: 2px solid rgba\(165,0,70,\.92\)/);
assert.match(guide, /#\$\{OVERLAY_ID\} \.shade[\s\S]*pointer-events: auto/);
assert.match(guide, /A highlight is guidance only/);
assert.match(guide, /boundShadeClick[\s\S]*?this\.clear\('BACKDROP_CLICK'\)/);

console.log('operator_cockpit_focus_unit_test: PASS');
