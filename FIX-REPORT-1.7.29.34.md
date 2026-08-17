# SIMNET Workbench v1.7.29.34 — transition responsiveness / panel / TMC highlight fix

## Source baseline

Base: `v1.7.29.33-replay-guide-performance-fix`.

Runtime case used for correlation: `abon326855`.

Observed before this fix in the supplied runtime case:

- `meta.scans = 23`, `meta.observations = 14`: the infinite scan churn from earlier builds is no longer present.
- three separate Billing → UserSide TMC handoffs created three different target tabs;
- prepare → claim delays were approximately 3.817 s, 5.494 s and 7.320 s;
- the same Case already knew its UserSide `customerId`, but revisits still created/opened another target tab;
- expanded LIVE could become visible again after Guide finished because Guide only hid the drawer while `activeView='live'` remained selected;
- a destination/context event could be dropped while `continueActiveActionSession()` was already busy;
- guided TMC could reach/advance the route without reapplying the proven point highlights to OLT/IP/Serial/MAC;
- persisted Guide action/hint details could contain a native Billing `targetHref` carrying the live `pp` parameter.

## Changes

### 1. Expanded panel now collapses permanently for navigation

Added a single `collapseForNavigation()` shell operation.

Before any navigation-capable action it clears:

- `activeView`;
- hover-open state;
- hover-close timer.

Applied to:

- Guide highlight/navigation;
- run-next Guide;
- Billing Technical direct navigation;
- TMC source navigation;
- TMC writeback;
- MAC search;
- return to Technical;
- History Replay;
- `Перейти к опросу`.

The drawer therefore does not reopen automatically when Guide changes from active → completed.

### 2. Guided TMC restores the v1.7.29.32 visual presentation

The original TMC point-highlight CSS/mechanism is preserved exactly:

- OLT/IP/Serial/MAC values;
- plum background/outline;
- longest marked row width alignment.

The fix is in continuation timing: when `userside.tmc` is actually resolved, `highlightTmcValues()` is explicitly applied before the route can advance.

### 3. Busy action continuation is coalesced, not lost

If a destination/context event arrives while action continuation or Focus setup is already running:

- it no longer silently returns and waits for another random event/timeout;
- one trailing continuation is queued;
- duplicate bursts are coalesced into that single retry.

This removes an artificial source of delayed Guide transitions.

### 4. Known UserSide customer bypasses `gotouser.php`

When `Case.identity.customerId` is already known, repeat transitions use canonical:

`https://userside.simnet.kiev.ua/customer/<customerId>`

instead of another IP → `gotouser.php` redirect/search hop.

The first discovery can still use the existing IP-based path when `customerId` is unknown.

### 5. Reuse an already-open UserSide tab for the same Case

Before opening another UserSide tab, background now resolves reusable tabs in this order:

1. an already-open `/customer/<customerId>` tab for the exact same Case;
2. a previous Workbench-owned UserSide target tab attached to the same Case;
3. otherwise fall back to the existing proven new-tab handoff path.

An arbitrary UserSide tab belonging to another subscriber is never hijacked.

If the exact same customer card is already open:

- no document reload is required;
- only the one-shot handoff hash token changes;
- `hashchange` claims the fresh handoff;
- one explicit semantic scan is requested after claim.

### 6. Handoff persistence happens before opening/reusing target

The handoff is durably prepared first, then target reuse/open is attempted. This removes the race where a very fast target boots before background knows the token.

### 7. Guide persisted URLs redact Billing `pp`

New Guide hint/action/result details are sanitized before durable storage.

Older persisted Guide records are also repaired when the Case shape is normalized.

No plaintext Billing `pp` should remain in exported Guide target URLs.

## Timeout note

The universal ActionSession target timeout remains 12 seconds as a failure/safety ceiling. It is **not** used as a successful-transition delay.

The responsiveness fixes target the real artificial waits:

- repeated new UserSide tab/server redirect;
- dropped continuation events;
- lack of immediate rescan after same-document handoff claim.

## Regression

Final official regression run:

- Total: **293**
- Passed: **287**
- Skipped: **6** (pre-existing environment-dependent skips)
- Failed: **0**

No old regression was deleted or weakened to hide a failure.

## Files changed vs v1.7.29.33

Production:

- `manifest.json`
- `src/background.js`
- `src/content/namespace.js`
- `src/core/handoff.js`
- `src/core/store-client.js`
- `src/shared/messages.js`
- `src/ui/guide.js`
- `src/ui/rail.js`

Tests/report:

- `tests/billing_navigation_safety_unit_test.mjs`
- `tests/regression_tests.py`
- `tests/transition_responsiveness_panel_privacy_unit_test.mjs`
- `tests/last_report.json`
- `tests/last_report.md`
- `FIX-REPORT-1.7.29.34.md`

## Real-browser verification targets

After installing `1.7.29.34` verify:

1. Open LIVE expanded → press `Перейти к опросу` → panel becomes COMPACT and stays closed after Huawei/EPON/GPON/GCOM destination is reached.
2. Repeat the same scenario twice; panel must not reopen on Guide completion.
3. Open same subscriber UserSide once, return to Billing, then request TMC again → existing same-customer UserSide tab should be focused/reused rather than creating another tab.
4. TMC first-pass Guide must show the original per-value OLT/IP/Serial/MAC plum highlights.
5. Export Case and confirm Guide target URLs contain `[redacted]` rather than a live Billing `pp`.
