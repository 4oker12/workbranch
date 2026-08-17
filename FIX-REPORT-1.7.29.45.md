# SIMNET Workbench v1.7.29.45 — TMC Source-Limited Identity + Huawei Poll Authority

## Reported defect

Recorded Case `abon212163` exposed a valid real-world combination:

- Billing/TMC ONU MAC: `D4:25:CC:1B:48:64`;
- OLT: Huawei, `172.16.1.50`;
- TMC interface: `EPON 0/12/7:13`;
- TMC Serial: absent.

The previous routing model could still require Serial because Huawei normally used the conservative `OLT + Serial + MAC` requirement. It also allowed the EPON interface token to override the Huawei chassis and produce Billing action `310`.

## Correct invariant

1. TMC is source-limited. After the actual TMC semantic teleport, fields absent from the real TMC block are not invented as obligations.
2. If TMC exposes OLT + ONU MAC but no Serial, Serial is optional for that route and does not block polling or Billing completeness.
3. Passive parser evidence cannot waive Serial; `tmcShownAt` remains the progress gate.
4. Poll section is selected by OLT/vendor. Huawei always uses Billing `a=313`; EPON/GPON interface wording is access context only.

## Changes

- `src/core/locator-policy.js`
  - Huawei vendor now outranks EPON interface when selecting poll adapter.
  - Added source-limited TMC requirement logic gated by `tmcShownAt`.
  - Candidate correction/readiness follows the same rule.
  - Exposed one canonical required-field helper to Background to avoid divergent readiness logic.
- `src/core/locator-signals.js`
  - Same vendor-authoritative Huawei classification for page-side parsing.
- `src/background.js`
  - Diagnostic `billingMissingTechnical` now uses the canonical required-field contract.
- `src/adapters/userside-adapter.js`
  - TMC summary only claims fields actually available in TMC.

## Regression contract correction

An older test asserted `Huawei chassis + EPON interface -> a=310`. That assertion encoded the wrong business rule and was explicitly replaced with `Huawei OLT + EPON interface -> Huawei a=313`. This is a contract correction, not an assertion weakening.

New regression verifies:

- before `tmcShownAt`, passive TMC data cannot waive Serial;
- after `tmcShownAt`, OLT + ONU MAC with absent Serial yields required fields `['olt', 'onuMac']`;
- the route advances to poll without demanding Serial;
- Huawei + EPON interface resolves to action `313`.

## Validation

- Full regression: **311 total / 305 PASS / 0 FAIL / 6 existing browser-DOM SKIP**.
- Production JS/MJS syntax: **43/43 PASS**.
- `setInterval` under `src`: **0**.
