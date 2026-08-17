# SIMNET Workbench v1.7.29.46 — Operator Save Decision + TMC Poll Continuation

## Fixed

The TMC → Billing Technical writeback no longer loops on native Save after the operator declines it.

### Contract

- Workbench may prefill the missing Technical fields and focus native **Save** once.
- Native Save remains manual and is never auto-clicked.
- If the operator clicks Save, normal post-save verification remains unchanged.
- If the operator closes the Save Guide (X / backdrop / Esc), the writeback question is marked **declined** for the current Case.
- If the operator leaves Billing Technical with an unsaved Workbench draft, that is also **declined**, not a reason to reopen Technical. A real native Save submission in flight is excluded from this rule.
- A reload/return that proves the draft was not persisted also closes the question instead of rebuilding the writeback transaction.
- After decline, TMC evidence remains valid and the route may continue to `POLL_CANDIDATE` when there are no identity conflicts and TMC has a valid poll binding.
- Identity conflicts remain protected and are not bypassed by this change.

## Regression

Added coverage for durable decline persistence, close/leave semantics, and TMC poll continuation after declined Save.
