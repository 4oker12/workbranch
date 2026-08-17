# SIMNET Workbench v1.7.29.41 — Dynamic TMC Writeback Scope

## Invariant

A TMC writeback transaction is defined only by fields actually present in the current TMC payload.

`tmcExpectedFields = available(TMC OLT, TMC ONU Serial, TMC ONU MAC)`

A field missing in Billing but absent in TMC is **not** a TMC writeback obligation and cannot make the TMC writeback step fail.

## Field outcomes

For each `tmcExpectedFields` entry:

- Billing empty → apply TMC value;
- Billing matches TMC → preserve and record as matched;
- Billing conflicts with TMC → do not overwrite silently; record conflict;
- field absent in TMC → outside the transaction.

Form verification requires every expected field to be accounted for by `applied + matched` and zero unresolved/conflict fields.

## Persistence / Save

- If Workbench changed any expected field, native Billing Save remains mandatory.
- If every expected TMC field was already present and matching, `already_present` is a valid success and no Save is requested.
- Post-save verification compares only the actual TMC expected set, not global `billingMissingTechnical`.
- `technicalWritebackVerified` remains gated by canonical `tmcShownAt`; passive TMC parsing cannot complete the workflow.

## Regression

The full regression suite is green: **304 total · 298 PASS · 0 FAIL · 6 existing SKIP**. Production syntax: **41/41 PASS**. `setInterval` in `src`: **0**. A dedicated regression contract verifies that absent current-TMC fields cannot be resurrected from stale locator recommendations and cannot become writeback obligations.
