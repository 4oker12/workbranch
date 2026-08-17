# SIMNET Workbench v1.7.29.40 — Strict TMC Teleport Milestone

## Operator invariant

`ТМЦ пройдена` means exactly one thing:

**Workbench semantic teleport `userside.tmc` reached the correct native TMC block → the block was rendered/stable → Focus was accepted as `SHOWN` → the expected TMC OLT / Serial / MAC values were visibly point-highlighted.**

Nothing else is allowed to set operator progress.

## Removed false completion paths

The following remain useful diagnostic/evidence inputs but can no longer count as `TMC visited`:

- merely opening `userside_customer`;
- background `TMC_RESULT`;
- `locator.sourceStatus.tmc`;
- adapter `context.meta.tmc.checked/found`;
- `usersideVisitedAt`;
- legacy passive `route.tmcFoundAt`;
- an old Guide step completed from cached TMC evidence.

`evidenceNavigator.achieved(case, "tmc")` now requires `workflow.ponAcquisition.tmcShownAt`. Its timestamp is the actual teleport/show time, not the earlier parser timestamp.

## Canonical completion point

The milestone write moved out of the Rail button and into the Guide visual lifecycle. `recordTmcTeleportShown()` runs only for a non-replay ActionSession whose semantic target is `userside.tmc`, and only after:

1. destination/Case binding is valid;
2. the real rendered TMC target has been resolved;
3. the target is stable and scrolled into view;
4. first-pass TMC point highlighting has executed;
5. every expected available value kind is visibly marked;
6. ActionLifecycle accepts `SHOWN`.

It then stores `tmcShownAt`, the `operationId`, and the visibly marked field kinds. A missing visual confirmation produces `TMC_TELEPORT_VISUAL_NOT_CONFIRMED` and does **not** create the milestone.

This covers both the first Billing → UserSide one-shot path and the explicit `Показать ТМЦ` action. History Replay remains read-only.

## Guide progress

`tmc_checked` no longer accepts passive `context.meta.tmc` / cached `sourceStatus` as `already_satisfied`. It can complete only after the canonical `tmcShownAt` latch exists (`resolution: workbench-teleport-shown`).

## Regression

- Total: **302**
- PASS: **296**
- FAIL: **0**
- Existing SKIP: **6** (browser/jsdom fixtures unavailable in this environment)
- Production JS/MJS syntax: **41/41 PASS**
- `setInterval` in `src`: **0**

New strict guard: `tests/tmc_teleport_milestone_unit_test.mjs`.
