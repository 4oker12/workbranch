# SIMNET Workbench v1.7.29.35 — transition responsiveness / TMC first-pass fix

## Basis

Source: v1.7.29.34. The change is intentionally limited to navigation-critical orchestration, ActionSession persistence, UserSide handoff reuse, Guide/Focus cleanup, and the first-pass TMC visual. Subscriber parsers, ONU/OLT interpretation, Graph domain logic, Call Registration and native Billing Save semantics were not rewritten.

## Real runtime evidence behind the fix

The abon202982 Case showed that v1.7.29.34 did reuse the already-open UserSide tab (`reusedWithoutReload: true`), but the reuse event still appeared ~5.4 seconds after handoff preparation. The Case also ended with `route.guide.active = billing.open-poll-tab` in `hinted` state while `workflow.actionSession.active = null`. That proved two separate issues:

1. navigation was still blocked by heavy serialized State work before the real tab action;
2. persisted Guide presentation could outlive the actual ActionSession and leave a stale Focus surface.

## Fixes

### 1. Compact ActionSession fast lane

Navigation lifecycle is persisted under a small dedicated durable key instead of forcing a full Case/State write before each transition.

- lifecycle remains durable across documents/tabs;
- response payload is compact and no longer echoes the giant State graph;
- normal State updates re-apply the fast lifecycle snapshot and cannot erase an active navigation lock;
- terminal snapshot is still preserved as `lastTerminal`.

### 2. Service-worker State cache for the single writer

The background service worker is the single writer of the main State key, so it now keeps an in-memory reference/cache after the initial read. Read-only critical paths no longer re-read + clone the whole State before every button action. Durable `chrome.storage` writes are still retained.

### 3. Same-Case UserSide reuse has a true fast path

When the Case already knows `customerId`:

- query exact `https://userside.simnet.kiev.ua/customer/<id>*` tabs;
- if an exact same-Case card is open, activate it directly;
- no page reload;
- no full-State read;
- no new target tab;
- unrelated UserSide subscriber tabs are never hijacked.

A fresh handoff is still used when a new/repurposed page load is actually required.

### 4. One-click TMC route stays one transaction

`Перейти в ТМЦ` remains:

Billing Technical → UserSide current subscriber → wait for correct customer/TMC → final TMC target → first-pass Focus.

Opening UserSide is not itself completion. TMC completes only after the correct Case target/evidence is verified.

### 5. Manual scrolling is not interruption

While waiting for the TMC target, the operator may scroll/read the page. Scroll does not interrupt ActionSession.

Immediately before Workbench centers the final target, a transient scroll-idle guard is installed:

- no scrolling: resolves on next animation frame;
- active scroll: waits for a short quiet gap (bounded);
- then one final `scrollIntoView` is executed;
- listeners are removed immediately;
- no permanent scroll watcher/poller is added.

### 6. Exact v1.7.29.32 TMC first-pass appearance restored

First guided TMC reveal again uses the v1.7.29.32 presentation:

- semantic TMC cutout/Focus target;
- plum point marks for OLT / IP / ONU S/N / ONU MAC (and semantic Interface coverage);
- point marks aligned to the longest highlighted value;
- marks belong only to the first-pass Guide Focus lifecycle.

History Replay does not rerun this teaching presentation; it remains direct navigation + lightweight orientation.

### 7. Orphan Focus cleanup

If the compact lifecycle says the operation is terminal but persisted `route.guide.active` is stale, Guide now tears down the visual Focus surface. This prevents old shade elements (`pointer-events:auto`) from physically intercepting native CRM clicks after the ActionSession is already finished.

### 8. Hint persistence removed from the visual critical path

The visual Focus no longer waits for a heavy Case write of HINT metadata. The target is stabilized and shown first; semantic hint journaling is persisted asynchronously.

### 9. Existing v1.7.29.34 panel rule preserved

Navigation actions collapse the expanded drawer into COMPACT and clear `activeView`; completion of Guide does not automatically reopen the prior LIVE drawer.

## Safety invariants preserved

- fresh Billing session / pp navigation gateway;
- no fallback authenticated URL without pp;
- History Replay never stores/reuses old pp;
- subscriber MAC never substitutes ONU MAC;
- no automatic native Billing Save;
- APPLIED / VERIFIED_IN_FORM / OPERATOR_SAVE / SAVED remain separate;
- terminal ActionSession cannot be resurrected by late context/document events;
- unrelated UserSide subscriber tab is not repurposed;
- no production `setInterval` introduced.

## Regression

Final full suite:

- total: 293
- PASS: 287
- FAIL: 0
- existing SKIP: 6

Additional protected contracts include:

- compact ActionSession fast-lane;
- same-customer UserSide focus without full State read/reload;
- stale Focus teardown after terminal fast-state;
- first-pass exact v1.7.29.32 TMC point-highlight;
- History Replay remains lightweight;
- transient scroll-idle guard and scroll-not-interruption behavior;
- pp sanitization in persisted Guide details.

## Static audit

- all 39 production JS files pass `node --check`;
- no production `setInterval` found;
- authenticated Billing `location.assign` remains centralized in `src/core/billing-navigation.js`;
- no new permanent scroll observer/poller added.

## What still requires live CRM verification

Container tests cannot measure actual UserSide/Billing server latency. v1.7.29.35 removes Workbench-side full-State round trips from the critical path, but the remaining wall-clock time must be measured in the live browser. If a transition is still slow, the next trace should distinguish:

- click → ActionSession REQUESTED/NAVIGATING;
- tab focus/navigation issued;
- document/customer target available;
- TMC target verified/Focus shown.

This makes residual server/browser latency separable from Workbench latency.
