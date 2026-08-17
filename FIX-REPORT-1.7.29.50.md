# FIX REPORT — v1.7.29.50

## OLT-only TMC writeback exit is terminal

Fixed the production branch where Billing Technical initially missed only OLT, TMC supplied the OLT, Workbench inserted it into the empty OLT control, but an unrelated ONU MAC difference caused aggregate writeback status `partial`. Leaving Technical without native Save therefore failed to persist the operator decision and the route could return to TMC/Technical.

### Contract

- The TMC task scope is anchored to `route.billingTechnicalInitiallyMissing` when TMC was entered to fill missing Billing fields.
- Differences in already-populated fields are evidence only for that task; they cannot expand an OLT-only task into an ONU MAC correction loop.
- If Workbench actually inserted at least one value into a previously-empty Technical field and the operator leaves Technical without native Save, the opportunity becomes durable `declined` even when aggregate comparison status is `partial`.
- A declined writeback cannot reopen TMC/Technical for the same candidate.
- Polling after decline uses a hybrid binding: TMC values for fields that were originally missing, existing Billing values for fields that were already populated. Thus OLT can come from TMC while ONU MAC/Serial remain the operator's current Billing identity.
- Huawei OLT continues to select Billing poll action `313`.

### Regression added

Exact OLT-only production branch covered:

`Billing OLT missing + Billing ONU identity present + TMC Huawei OLT + unrelated TMC MAC mismatch -> fill only OLT -> leave Technical without Save -> declined -> Huawei poll candidate using TMC OLT + Billing ONU identity`.

Also covered Service Worker exit detection when `tmcWritebackPendingSave=false` / `tmcWritebackVerifiedInForm=false` because aggregate state was `partial` but a real OLT prefill occurred.

## Validation

- Regression: 311 total / 305 PASS / 0 FAIL / 6 existing SKIP
- Production JS/MJS syntax: 43/43 PASS
- `setInterval(` in `src`: 0
