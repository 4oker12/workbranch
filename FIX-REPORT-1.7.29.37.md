# SIMNET Workbench v1.7.29.37 — Navigation Race + TMC First-Pass Fix

## Recorded failures reproduced from evidence

### 1. `Перейти к опросу ONU` was not actually a one-shot navigation
The recorded ActionSession reached `billing.poll.entry` on the Billing subscriber card and showed Focus on the native technology link (for the recorded case: `HUAWEI OLT`, `a=313`). The operator still had to perform another click. The CTA therefore contradicted its own “Перейти” contract.

**Fix:** `requestPollReveal()` resolves authoritative `pollAction` and navigates directly through `billing-navigation` to the exact native poll route (`a=310/311/312/313`). The same universal ActionSession now targets `billing.olt.request` on `billing_onu_poll`, where Focus is shown on native `Запрос OLT`. The actual OLT request remains an explicit native operator click.

### 2. Same-Case passive UserSide tab could kill a Billing ActionSession
The recording showed a Billing poll action reaching `TARGET_READY`, while a UserSide tab of the same Case resumed that shared action and changed it to `INTERRUPTED`. Billing then attempted `INTERRUPTED -> SHOWN`, producing `ACTION_ILLEGAL_STATE_TRANSITION`.

**Fix:** a same-Case tab that is neither the action source nor its matching destination is lifecycle read-only. It records `ACTION_PASSIVE_TAB_IGNORED` and cannot terminalize the shared ActionSession. Focus is emitted only if the lifecycle accepts `SHOWN`.

### 3. First Billing -> UserSide -> TMC transition could stop on the UserSide card
The first token/hash handoff can complete before bootstrap installs `runtime.forceScan`, while UserSide native TMC fragments can render asynchronously. That left the semantic action waiting without a deterministic continuation trigger.

**Fix:** successful UserSide handoff directly resumes the pending ActionSession after Case claim. `userside.tmc` has a bounded target-acquisition retry schedule using finite `setTimeout` attempts. The Guide now prefers the canonical `tmcParser.findBlocks(document)` result and only then falls back to DOM heuristics.

## Safety invariants preserved

- No permanent `setInterval` or background poller was added.
- Existing v1.7.29.35/.36 fast tab-reuse path remains in place.
- Native `Запрос OLT` is not auto-clicked.
- Wrong poll technology pages cannot satisfy `billing.olt.request`.
- TMC target must be a connected native DOM block.
- Terminal ActionSession cannot emit a false `FOCUS_SHOW`.

## Regression

- Total: 297
- PASS: 291
- FAIL: 0
- Existing SKIP: 6
- Production JS/MJS syntax: 41/41 PASS
- `setInterval` in `src`: 0

New dedicated guards:
- `poll_one_shot_direct_navigation_unit_test.mjs`
- `action_passive_tab_race_unit_test.mjs`
- `tmc_first_transition_retry_unit_test.mjs`
