# SIMNET Workbench v1.7.29.42 — TMC Handoff Transaction + Viewport Proof

## Reproduced failure

The exported Case `billing:billing:524` proves the first Billing → UserSide transition itself was fast, while the semantic TMC command was not.

- handoff prepared: `00:52:32.997`;
- handoff claimed by UserSide: `00:52:36.072`;
- `TMC_RESULT=found` with OLT/Serial/MAC already available: `00:52:36.613`;
- first `workbench-teleport-shown`: only `00:53:12.327`.

Therefore the 35+ second gap was not caused by TMC parsing or the UserSide DOM. The ActionSession was not deterministically carried/resumed across the tab/document boundary and could later be recreated/woken by unrelated UI activity.

## Fix

### 1. TMC command is part of handoff transaction

`workflow.actionSession` is copied into the Billing → UserSide handoff envelope, sanitized in background, returned on claim, and hydrated into the exact Case in the target content script. Only a same-Case `userside.tmc` active session may be hydrated.

The already-open `/customer/<id>` fast-focus path carries the same ActionSession in `HANDOFF_FAST_CASE_BIND`.

### 2. First document has an explicit wake point

`handoff.init()` runs before `runtime.forceScan` exists. After the canonical boot scan, bootstrap now calls `resumePendingSemanticHandoff('post-boot-scan')`. The claim path also attempts an immediate semantic continuation; already-loaded UserSide tabs perform one forced scan and resume immediately.

The workflow no longer depends on LIVE opening, Rail render, or a later `store:state` event to wake the TMC Guide.

### 3. Bare UserSide navigation is forbidden

`openTmcSourceDirect()` now requires a live `userside.tmc` ActionSession before handoff. A stale same-Case Guide navigation lock is explicitly superseded by the operator's TMC command, except for an active native `billing.olt.request` action. If a semantic session cannot be started, Workbench does not navigate.

Guide navigation also fails closed with `GUIDE_NAVIGATION_SESSION_MISSING` instead of performing semantic navigation without an ActionSession.

### 4. Lost session can be rebuilt from the handoff command

The target tab keeps a bounded `pendingSemanticHandoffResume`. If the compact session snapshot is unexpectedly missing, `resumeTmcHandoff()` reconstructs exactly the current Case's `userside.tmc` action and continues it. It cannot reconstruct another semantic target or another subscriber's Case.

### 5. Teleport success requires real viewport arrival

A rendered TMC target is not enough. For first-pass TMC:

- `scrollIntoView()` is attempted;
- if the semantic rectangle remains outside viewport, Workbench performs one explicit document scroll fallback;
- if it still does not intersect viewport, the operation fails with `TMC_TELEPORT_VIEWPORT_NOT_REACHED`;
- `tmcShownAt` is written only when the TMC root and every expected available point mark (OLT / Serial / MAC) are actually inside viewport.

## Observability

New handoff journal entries include the carried `operationId` and `semanticTargetId`. Target-side continuation records `TMC_HANDOFF_SEMANTIC_RESUME`, so a future export can show whether the exact original ActionSession survived the boundary.

## Regression

- Full suite: **306 total · 300 PASS · 0 FAIL · 6 existing SKIP**.
- Production JS/MJS syntax: **41/41 PASS**.
- `setInterval` in `src`: **0**.
- Added `tmc_handoff_transaction_unit_test.mjs` and `tmc_viewport_teleport_unit_test.mjs`.
