# SIMNET Workbench v1.7.29.33 — Replay / Guide transaction / writeback / performance fix

## Scope

Base: `v1.7.29.32-billing-navigation-safety`.

Goal: preserve the working 29.32 parsers/navigation guards while separating diagnostic progress, navigation transactions and Guide presentation; make History Replay fresh/session-safe; make TMC→Technical writeback explicit and verifiable; suppress competing navigation clicks; stop false completion and background scan/Trace churn.

## Baseline

Clean v1.7.29.32 regression run before changes:

- total: 283
- PASS: 276
- SKIP: 6
- FAIL: 1
- the only FAIL was the missing clean unpacked-extension update document.

No old failing functional test was hidden or skipped.

## Root causes found

1. History Replay was completed immediately after `location.assign`, before the destination document could verify `pageKind`/entity.
2. Replay and Guide presentation were still coupled: terminal/old replay state could later be resumed by another document and show the tutorial Focus again.
3. Terminal ActionSession snapshots remained in the persisted active slot, making stale cross-tab resume possible.
4. UserSide→Billing could focus the old Billing source tab but could not always rebuild the requested semantic destination from that tab's current live `pp`.
5. TMC writeback had no explicit persisted `VERIFIED_IN_FORM` stage and partial application could be treated too optimistically.
6. Existing operator-entered Technical values were previously grouped as "already present" without always proving they matched TMC evidence.
7. Navigation ownership was target-local; a rapid click on a different Workbench navigation CTA could supersede the first action.
8. Ordinary DOM mutations incremented the same generation token used to stale active scans, allowing continuous CRM churn to create a scan/re-scan loop.
9. The global scanner/Trace treated several CRM clocks/counters/animations as meaningful changes.
10. Trace's UI mutation filter could record Workbench's own ring/shade/tip mutations.
11. Native `Запрос OLT` visual click could close/complete presentation before validated terminal evidence.

## Main changes

### History Replay

- `DIRECT_REPLAY` is now separate from Guided navigation.
- Navigation commit is not completion.
- Replay completes only after the target document verifies destination system/page/entity.
- Replay uses a fresh semantic route from current Case + current live Billing source-tab session.
- Old `pp`, authenticated URL and click route are not stored/replayed.
- Persisted action lifecycle now writes terminal snapshot to `lastTerminal` and clears `active`.
- A stale tab can consume `lastTerminal` and cannot resurrect the old operation.
- Replay orientation is a lightweight native-element border, not the four-shade tutorial overlay.

### Billing navigation / fresh pp

- Background source-tab routing builds semantic Billing destinations from the CURRENT live source tab URL.
- UserSide does not receive or persist raw `pp`.
- Guide `focus-source` Billing returns and TMC writeback returns use `billingNavigation.navigate()`.
- Remaining generic Guide Billing URLs are detected and routed through the central Billing gateway before generic `location.assign`.
- Missing live session/pp fails closed.

### Navigation transaction lock

- One active Workbench navigation transaction owns navigation.
- Same-target repeat click returns/suppresses the current operation.
- Different navigation CTA while the owner is active is blocked with `NAVIGATION_ACTION_BLOCKED_BY_LOCK`.
- Lock states cover REQUESTED/NAVIGATING/DESTINATION_REACHED/WAITING_TARGET/TARGET_READY/SHOWN for navigation-capable actions.
- Terminal states release ownership.

### Interruption / false completion

- Wrong destination entity => fail with destination Case mismatch.
- Route diversion => INTERRUPTED.
- Terminal sessions cannot accept a later `DESTINATION_REACHED`/Focus resume.
- A failed/interrupted/timeout operation is operation history only; it does not create successful checkpoint evidence.
- Native OLT request click is intent only. Its visual Focus closes without completing ActionSession; validated terminal evidence completes it, timeout/failure terminalizes it.

### Technical → TMC one-shot

- The active Billing→TMC route is one ActionSession.
- After UserSide loads, the existing active `userside.tmc` session continues automatically; no second CTA is required.
- UI explicitly says the first click was accepted and that a second click is not needed.
- A manual `Показать ТМЦ` remains only as fallback when the operator arrived in UserSide independently.

### TMC → Billing Technical writeback

- CTA wording: `Заполнить техданные`.
- Return to Technical uses fresh semantic Billing navigation.
- Workbench fills only confirmed requested fields.
- Existing matching values remain untouched.
- Existing conflicting values are classified as conflict, not mislabeled as matching.
- Subscriber MAC is not used as ONU MAC; serial is not derived from MAC.
- Native Save is highlighted but never programmatically clicked.

Writeback stages:

`FOUND → APPLIED → VERIFIED_IN_FORM → OPERATOR_SAVE → VERIFIED_AFTER_SAVE → SAVED`

`VERIFIED_IN_FORM` now requires a complete form postcondition. Partial application does NOT enter Save-ready state and does not set `tmcWritebackPendingSave`.

### Scanner / idle

- `documentGeneration` is separate from scan sequencing.
- Ordinary DOM mutations do not stale an in-flight scan.
- Mutations during a scan coalesce into at most one trailing scan.
- After repeated unchanged scans with no active work the scanner enters QUIESCENT.
- Volatile CRM mutations remain suppressed while idle.
- Meaningful TMC/Technical/poll changes wake the scanner.
- Poll terminal parsing is gated to relevant poll context.
- Juniper prefetch is keyed to meaningful identity change instead of every committed Billing scan.

### Trace noise

Filtered/coalesced from normal Trace:

- Workbench ring/shades/tip/backdrop positioning;
- `to_top` animation;
- interface last-time clocks;
- traffic counters;
- poll wait counters;
- periodic ONU timestamp churn.

Meaningful operator actions/navigation/lifecycle/evidence remain traceable.

## Navigation audit

Production navigation sites were reviewed.

- Authenticated Billing semantic navigation: central `src/core/billing-navigation.js` and background source-tab semantic builder.
- `chrome.tabs.update` in `background.js`: source-tab handoff/gateway, builds target from live Billing tab session.
- `location.assign` left in `rail.js`: UserSide MAC search native URL only.
- `location.assign` left in `guide.js`: generic non-Billing path after known Billing semantic URLs are intercepted by the central gateway; explicit UserSide customer/device utility navigation remains local.
- `window.open` in Guide: native UserSide handoff/new-target behavior, not stored authenticated Billing replay.
- `src/audit/audit.js` Technical URL is a read-only Data Audit `runtimeFetch`, not browser navigation/History Replay.
- Operator Trace references to `a=252/310..313` only classify observed native URLs/actions.

No feature fallback was retained that intentionally navigates authenticated Billing without confirmed current session/pp.

## Performance / leak audit

Reviewed `MutationObserver`, timers, animation frames and event listeners.

- Action lifecycle target/rebind timers are cleared on terminal state.
- Action interruption document listener is removed on terminal state.
- Replay orientation has one replaceable 1.8s timer and removes its class/target reference.
- No new permanent MutationObserver was added.
- Existing global scan observer remains event-driven but now filters Workbench/volatile CRM mutations and enters QUIESCENT rather than continuously rescanning.
- TMC writeback retries remain bounded (max 10 × 200ms).
- Poll request tracking remains bounded by existing poll attempt lifecycle.
- Guide overlay scroll/resize/target listeners are removed on clear.

## Tests added / strengthened

New executable/contract tests:

- `tests/navigation_transaction_regression_unit_test.mjs`
- `tests/scan_quiescent_unit_test.mjs`
- `tests/history_replay_writeback_contract_test.mjs`

Strengthened:

- `tests/scan_scheduler_coalescing_unit_test.mjs`
- `tests/billing_navigation_safety_unit_test.mjs`
- `tests/live_onu_acquisition_flow_unit_test.mjs`
- `tests/one_shot_tmc_focus_unit_test.mjs`
- structural invariants in `tests/regression_tests.py`

Old assertions that encoded the obsolete model were changed only where the new requirement is stricter (for example, DOM mutation must NOT stale the active scan; Replay must NOT complete on navigation commit). No test was weakened to conceal a runtime regression.

## Final regression result

v1.7.29.33:

- total: 286
- PASS: 280
- SKIP: 6
- FAIL: 0

The six SKIP entries are the pre-existing conditional/skipped cases from the suite; no new skip was introduced to obtain green status.

## Performance proof available in the automated environment

Synthetic regression now proves:

- 100 volatile mutations do not become 100 scans;
- mutations during active scan coalesce to at most one trailing scan;
- unchanged page reaches QUIESCENT;
- irrelevant idle mutation does not wake it;
- meaningful TMC mutation wakes it;
- Workbench-owned overlay mutation is filtered from Trace.

A real CPU/scan-rate before/after number cannot be honestly produced in the container because UserSide/Billing live DOM is not running here. Runtime counters were added so the next real operator trace can verify the reduction quantitatively.

## Files changed from clean v1.7.29.32

Runtime:

- `manifest.json`
- `src/background.js`
- `src/content/bootstrap.js`
- `src/content/namespace.js`
- `src/core/action-lifecycle.js`
- `src/core/billing-navigation.js`
- `src/core/handoff.js`
- `src/core/interaction-guards.js`
- `src/core/operator-trace.js`
- `src/ui/guide.js`
- `src/ui/rail.js`

Tests/docs:

- `INSTALL-UPDATE.txt`
- `FIX-REPORT-1.7.29.33.md`
- `tests/billing_navigation_safety_unit_test.mjs`
- `tests/live_onu_acquisition_flow_unit_test.mjs`
- `tests/one_shot_tmc_focus_unit_test.mjs`
- `tests/regression_tests.py`
- `tests/scan_scheduler_coalescing_unit_test.mjs`
- `tests/navigation_transaction_regression_unit_test.mjs`
- `tests/scan_quiescent_unit_test.mjs`
- `tests/history_replay_writeback_contract_test.mjs`
- generated `tests/last_report.json` / `tests/last_report.md`

## Known limitation / runtime verification

The changes are regression-green and structurally audited, but the final confirmation of perceived UI smoothness must be made on the real UserSide/Billing pages. The new performance counters and reduced Trace noise are specifically intended for that verification.
