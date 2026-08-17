# SIMNET Workbench v1.7.29.36 — Poll Target + TMC Fast-Bind Fix

## Live issues reproduced from operator feedback

1. `Перейти к опросу ONU` could point at the wrong native Billing poll tab.
2. `Перейти в ТМЦ` could focus an already-open UserSide subscriber card and stop there without scrolling to the TMC block.

## Root cause 1 — poll navigation used a different source of truth than readiness

`diagnostic.readyForOnuPoll` is based on the current Case PON binding and `caseData.pon.pollAction`. However `Guide.findPollTab()` previously preferred `recommendedCandidate(caseData).pollAction`. A locator candidate can remain from an older/fallback branch even after Billing/TMC has established the current binding.

Result: LIVE correctly reached the ready state, but the Focus resolver could target a stale technology tab.

### Fix

A single `authoritativePollAction(caseData)` now defines poll navigation priority:

1. current `diagnostic.pollAction`;
2. current `pon.pollAction`;
3. recommendation-level pollAction fallback;
4. locator candidate fallback.

Only native Billing actions `310/311/312/313` are accepted. `findPollTab()` and terminal expected-action validation use this same resolver.

## Root cause 2 — zero-reload UserSide reuse had no explicit target-tab bind

The v1.7.29.35 fast path correctly focused an already-open exact `/customer/<id>` tab without a full State round-trip or reload. But a pure `chrome.tabs.update(..., {active:true})` does not guarantee a document event (`hashchange`, `pageshow`, navigation) that binds the source Case and continues the pending `userside.tmc` ActionSession in that already-loaded content script.

Result: the operator reached the correct UserSide card very quickly, but Workbench could stop before final TMC target resolution/scroll.

### Fix

After exact-tab focus the Service Worker sends a lightweight `HANDOFF_FAST_CASE_BIND` message to that tab. The target content script accepts it only when:

- current URL customer ID equals the requested customer ID;
- requested Case exists in the local Store snapshot;
- Case customer ID equals the page customer ID.

Then it:

- binds the exact Case locally;
- wakes one semantic scan;
- directly continues the pending Universal ActionSession.

Fast reuse is considered complete only after this acknowledgement. If acknowledgement fails, the code falls through to the established token/hash handoff path rather than falsely reporting navigation complete.

## Preserved invariants

- no full-State read was added to the exact UserSide focus fast path;
- no reload when the fast bind succeeds;
- unrelated UserSide subscribers cannot be rebound because customer identity is checked on both URL and Case;
- one-click TMC remains one ActionSession;
- History Replay semantics unchanged;
- Billing `pp` safety unchanged;
- native Billing Save remains operator-controlled;
- no new permanent timer/poller/scroll watcher.

## Regression

Full suite after the patch:

- total: 294
- PASS: 288
- FAIL: 0
- existing SKIP: 6

New protected contract: `poll_target_priority_unit_test.mjs`. Existing TMC responsiveness tests were extended to require explicit fast Case binding before exact-tab reuse can short-circuit.
