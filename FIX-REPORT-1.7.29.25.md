# SIMNET Workbench v1.7.29.25 — TMC → Billing Selectize writeback fix

## Observed failure

The abon382037 Case proves that the route and TMC collection worked:

- Billing Technical still reported `billingMissingTechnical: ["olt"]`.
- TMC had a confirmed candidate `Huawei MA5800-X15`, IP `172.16.1.50`, matching ONU serial/MAC.
- `tmcWritebackRequestedAt` was recorded and `tmcWritebackFields` contained `olt`.
- Afterwards `tmcWritebackPending=false`, `tmcWritebackPendingSave=false`, and `tmcWritebackAppliedAt` stayed empty.

So the failure was between "arrived at Billing Technical" and "selected the OLT control", not in TMC discovery or Case handoff.

## Fix

`src/ui/guide.js`

- Added a Selectize-aware OLT resolver.
- Exact TMC OLT IP is still the first criterion.
- When the backing `select[name=dopfield_29]` contains only a placeholder, Workbench opens the visible Selectize control and searches it using the exact TMC IP/name.
- While Selectize options are loading, resolver returns `not_ready`, allowing the existing bounded retry loop to wait instead of declaring a final miss.
- A dropdown choice is accepted only through an actual Billing `data-value` / native option. No OLT IDs are invented.

`src/ui/rail.js`

- A failed writeback now persists `tmcWritebackLastStatus` / timestamp.
- LIVE shows `Подстановка не завершена` and `Повторить подстановку` instead of silently returning to the same unresolved state.
- Retry reuses the already-confirmed TMC candidate and does not start TMC/MAC discovery again.

`src/background.js`

- Added stable workflow fields for the last writeback status/time.

## Safety

- No automatic Billing Save.
- Existing non-empty operator values are not overwritten in missing-only mode.
- OLT is chosen only from Billing's real Selectize/native options.
- PON polling, Case routing, Juniper, PBX and Audit logic are unchanged.

## Regression

- Total: 252
- PASS: 246
- FAIL: 0
- SKIP: 6
