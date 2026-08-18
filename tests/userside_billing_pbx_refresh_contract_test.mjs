import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const backgroundEntry = fs.readFileSync(path.join(root, 'src/background-entry.js'), 'utf8');
const billingFallback = fs.readFileSync(path.join(root, 'src/core/billing-navigation-fallback.js'), 'utf8');
const callRefreshBridge = fs.readFileSync(path.join(root, 'src/ui/call-registration-refresh-bridge.js'), 'utf8');
const pbxObserver = fs.readFileSync(path.join(root, 'src/pbx/pbx-observer.js'), 'utf8');

assert.equal(
  manifest.background.service_worker,
  'src/background-entry.js',
  'service worker wrapper must preserve base background and own cross-tab fallbacks'
);
assert.match(backgroundEntry, /import '\.\/background\.js'/, 'base background remains the source of truth');

const scripts = manifest.content_scripts[0].js;
const handoffIndex = scripts.indexOf('src/core/handoff.js');
const fallbackIndex = scripts.indexOf('src/core/billing-navigation-fallback.js');
const guideIndex = scripts.indexOf('src/ui/guide.js');
const callIndex = scripts.indexOf('src/ui/call-registration.js');
const callBridgeIndex = scripts.indexOf('src/ui/call-registration-refresh-bridge.js');
assert.ok(handoffIndex >= 0 && handoffIndex < fallbackIndex && fallbackIndex < guideIndex,
  'Billing first-entry fallback must wrap navigation after handoff is available and before Guide runs');
assert.ok(callIndex >= 0 && callIndex < callBridgeIndex,
  'PBX refresh bridge must wrap the call-registration instance after it is created');

for (const token of [
  'BILLING_OPEN_SEMANTIC_TARGET',
  "'billing.technical'",
  'chrome.tabs.create',
  'waitForBillingSession',
  'billing-session-not-established',
  'PBX_RECENT_CALLS_REFRESH',
  'SIMNET_WB_PBX_REFRESH_NOW'
]) assert.ok(backgroundEntry.includes(token), `missing cross-tab invariant token: ${token}`);

for (const token of [
  'source-tab-not-found',
  'BILLING_OPEN_SEMANTIC_TARGET',
  'missing-source-tab-opens-or-reuses-safe-billing-target'
]) assert.ok(billingFallback.includes(token), `missing UserSide -> Billing fallback contract: ${token}`);

assert.ok(
  billingFallback.includes("code === 'BILLING_DESTINATION_CASE_MISMATCH'")
  && billingFallback.includes("code === 'BILLING_AUTH_PAGE_REACHED'"),
  'fallback must not bypass case/auth guards'
);

for (const token of [
  'PBX_RECENT_CALLS_REFRESH',
  'originalOpen',
  'await refreshRecentCalls(caseData)',
  'return originalOpen(caseData)'
]) assert.ok(callRefreshBridge.includes(token), `missing call-list refresh-before-open contract: ${token}`);

for (const token of [
  'SIMNET_WB_PBX_REFRESH_NOW',
  "cache: 'no-store'",
  "credentials: 'include'",
  'onMessage?.addListener?.',
  'publish({ force: true, fresh: true })'
]) assert.ok(pbxObserver.includes(token), `missing explicit PBX refresh contract: ${token}`);

for (const forbidden of [
  'MutationObserver',
  'ResizeObserver',
  'setInterval'
]) assert.ok(!pbxObserver.includes(forbidden), `PBX refresh must not use permanent observers/polling: ${forbidden}`);

console.log('userside_billing_pbx_refresh_contract_test: PASS');
