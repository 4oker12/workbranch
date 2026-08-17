# SIMNET Workbench v1.7.29.38 — Save Gate + Universal Replay Navigation

## Failures reproduced from the operator flow

### 1. Technical DOM prefill was incorrectly treated as saved Billing state
After TMC writeback the native Technical form already contained OLT/ONU values and the Billing Save control was still waiting for the operator. LIVE could nevertheless render `Готово к живому опросу` and expose `Перейти к опросу ONU`.

That state is invalid: form mutation is transient DOM state; it is not persisted Billing evidence.

**Fix:** poll readiness now has an explicit `technicalSavePending` hard gate in the diagnostic core. `tmcWritebackPending`, `tmcWritebackPendingSave`, or a Locator save-phase recommendation all block both `evidenceReadyForPoll` and `canAttemptOnuPoll`. Presentation and click execution have the same guard, so a stale optimistic diagnostic flag cannot bypass it.

### 2. Native Save is now the mandatory visual checkpoint
When TMC values are successfully applied and verified in the live Technical form, Workbench keeps the real Billing Save as the only write action.

**Fix:** Guide immediately resolves `billing.save-technical-fields`, dims the rest of the CRM with the existing Focus Layer, explains that prefilled values are not saved yet, and applies a plum pulse to the native Save control. Workbench does not create a duplicate Save and never auto-clicks the native control. Poll readiness can appear only after the existing post-save pipeline has confirmed persistence on a fresh Billing document and cleared the pending-save flag.

### 3. A successful ONU poll is terminal regardless of route order
The operator may manually enter the native poll page and obtain a valid OLT result before following the normal Technical/TMC acquisition path.

**Fix:** confirmed Locator termination, confirmed live OLT snapshot, or successful `POLL_RESULT` evidence suppresses the poll recommendation card entirely. `requestPollReveal()` repeats the same guard at execution time, so a stale visible/queued CTA cannot start another poll navigation.

### 4. History arrows completed on page arrival instead of target arrival
`Что уже сделано` replay could navigate to the right Billing/UserSide document but finish the ActionSession before the actual native section/control existed. The operator therefore landed on the page without the promised scroll/highlight.

**Fix:** `DIRECT_REPLAY` now follows a strict contract:

`navigate -> destination matched -> WAITING_TARGET -> semantic native target found -> visible geometry -> scroll/orientation -> COMPLETED`

The destination page alone is never completion. The bounded target retry path covers:
- `billing.technical`
- `userside.tmc`
- `billing.poll.entry`
- `billing.juniper`

If a replay page opens but its real native target still cannot be acquired after the finite retry window, the ActionSession ends as an observable `ACTION_REPLAY_TARGET_TIMEOUT` instead of silently remaining in `WAITING_TARGET`.

## Safety invariants preserved

- Native Billing Save is never auto-clicked.
- Native `Запрос OLT` is never auto-clicked.
- No permanent `setInterval` or background polling loop was added.
- v1.7.29.35+ fast tab reuse/navigation remains intact.
- Successful poll evidence wins over stale acquisition recommendations.
- Replay completion requires a connected, visible native target rather than a page URL match.
- Failed target acquisition becomes a diagnosable lifecycle result.

## Regression

- Total: 300
- PASS: 294
- FAIL: 0
- Existing SKIP: 6 (`jsdom` browser-DOM fixtures unavailable in this build environment)
- Production JS/MJS syntax: 41/41 PASS
- Targeted non-jsdom navigation/PON/Guide tests: 25/25 PASS
- `setInterval` in `src`: 0

New/strengthened guards:
- `save_gate_replay_navigation_unit_test.mjs`
- `live_onu_acquisition_flow_unit_test.mjs` now explicitly verifies `prefill + pending Save != poll-ready`, then `post-save confirmed -> poll-ready`
- `history_replay_writeback_contract_test.mjs` now requires native target orientation before replay completion
