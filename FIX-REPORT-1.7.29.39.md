# SIMNET Workbench v1.7.29.39 — Destination Resume + Visible TMC + Selectize Close

## Failures reproduced from the operator flow

### 1. Correct OLT selected, but Selectize dropdown stayed open
The TMC writeback correctly resolved the Billing OLT, but the resolver had to open/search the legacy Selectize widget. A synthetic/programmatic choice could update the backing `<select>` while leaving the visual dropdown open over native Save and the Guide focus.

**Fix:** OLT writeback now prefers the live Selectize instance API when available, then explicitly closes/blurs the widget. A one-frame bounded second close handles the legacy widget's own delayed visual update. Fallback Escape/blur/class cleanup is used only when the Selectize API is unavailable. No Billing option/value is fabricated.

### 2. Returning to Billing Technical did nothing until LIVE was opened
The pending TMC writeback was still resumed from `RailPanel.render()`. Opening LIVE caused a render and accidentally became the event that made the workflow continue.

That violates the Workbench architecture: presentation state must not drive diagnostic/navigation state.

**Fix:** `context:changed` is now the destination wake-up signal. When `billing_technical` is committed for the current Case, an existing `tmcWritebackPending` transaction immediately continues, even with the rail compact and LIVE never opened. UserSide destination commits likewise resume the pending one-shot Focus transaction.

### 3. Discarded unsaved prefill left stale workflow state
If the operator left/reloaded Billing without native Save, a fresh Technical document legitimately contained the old saved values while workflow memory could still say that the prefilled draft was waiting for Save.

**Fix:** on a fresh Billing Technical document (`boot/pageshow/bfcache restore`) the live form is compared against `expectedTechnicalWriteback`. If the draft is gone, stale `pendingSave` is converted back to `tmcWritebackPending` and the same explicit writeback transaction is resumed. Workbench still never clicks Save.

### 4. First TMC transition could stop on the UserSide card
The canonical TMC parser previously filtered only detached nodes. UserSide can keep connected, zero-size or hidden clones while the real AJAX block is still being rendered. Such a clone is not a valid scroll/Focus target.

**Fix:** `userside.tmc` target acquisition now requires real rendered geometry and visibility. Hidden/zero-size candidates are rejected; only a bounded semantic ancestor that still contains the TMC phrase + device link may be used as a replacement.

In addition, the active `userside.tmc` ActionSession arms a temporary DOM MutationObserver. The first real AJAX appearance wakes `continueActiveActionSession()` immediately. The observer is destroyed when the action completes, becomes terminal, or reaches its bounded target timeout.

## Preserved invariants

- Native Billing Save is never auto-clicked.
- Native `Запрос OLT` is never auto-clicked.
- OLT IDs/options are never invented.
- LIVE/open drawer state is presentation-only and cannot be required to continue workflow.
- Same-Case fast UserSide/Billing reuse is preserved.
- TMC acquisition remains bounded; no permanent timer, polling loop, or `setInterval` was added.
- Hidden/zero-size CRM clones cannot complete semantic navigation.

## Regression

- Total: 301
- PASS: 295
- FAIL: 0
- Existing SKIP: 6 (`jsdom` browser-DOM fixtures unavailable in this environment)
- Production JS/MJS syntax: 41/41 PASS
- `setInterval` in `src`: 0

New/strengthened guard:
- `workflow_resume_selectize_tmc_visibility_unit_test.mjs`
- `tmc_first_transition_retry_unit_test.mjs` now verifies the stricter rendered-target contract instead of only a direct `isConnected` check.
