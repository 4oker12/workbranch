# FIX REPORT — v1.7.29.49

## Durable Technical Exit + Selectize Hard Close

### 1. Leaving Technical without Save is a durable business decision

The previous implementation tried to detect `billing_technical -> other page` inside `Rail.continueWorkflowAfterContext()`. That is not reliable for Billing because navigation replaces the document and destroys the old content script before Rail can always observe the destination.

The decision is now committed in `background.js` during `STORE_APPLY_CONTEXT`:

- previous context is resolved from `viewsByTab` for the **same tab**;
- `billing_technical -> billing_technical` is not an exit, so reload/pageshow keeps Save pending;
- `billing_technical -> any other page` with a real TMC-applied field and no native Save intent records `tmcWritebackLastStatus=declined`;
- `tmcShownAt`, TMC candidate/evidence, matched fields and the completed TMC milestone are retained;
- decline is committed before `updateRoute()`, so the destination immediately evaluates `tmc.writeback-declined-ready-poll` instead of restarting `CHECK_TMC`;
- a real `BILLING_OLT_SAVE_INTENT` newer than the writeback request still protects the native Save verification flow.

This makes the intended semantic rule durable across full Billing navigation and later page refresh: **TMC was already visited; Save was offered; the operator skipped it; do not send the operator to TMC again.**

### 2. OLT Selectize no longer stays focused/open after auto-prefill

The previous close helper could miss Billing builds where Selectize mounts its live dropdown outside the native table row or restores focus after a delayed repaint.

The bounded settle now:

- uses live Selectize `$control_input`, `$control` and `$dropdown` nodes when available;
- calls native `close()` and `blur()`;
- normalizes `instance.isOpen = false`;
- triggers blur on the live control input;
- removes `active/focus/input-active/dropdown-active` classes;
- hides the live dropdown even when it is mounted outside the row;
- parks keyboard focus on a Workbench-owned off-screen sink for the entire bounded settle window;
- repeats close at RAF + 60 ms + 180 ms only; no interval/permanent observer was added.

### Regression

- 311 total
- 305 PASS
- 0 FAIL
- 6 existing browser-DOM SKIP
- production JS/MJS syntax: verified separately
- `setInterval` in `src`: 0
