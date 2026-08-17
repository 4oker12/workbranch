# SIMNET Workbench v1.7.29.32 — Billing navigation safety + Direct Replay

## Цель
Закрыть класс опасных навигационных ошибок: URL Billing без `pp`, login page как technical, history replay как tutorial, multi-click navigation, lifecycle illegal transitions, формулировка «сверить» вместо «заполнить».

## Что сделано

### 1. Единый Billing Navigation Gateway
- Новый модуль: `src/core/billing-navigation.js`
- API: `navigate({ caseId, semanticTargetId, entityId, intent })`, `resolveSession()`, `buildAuthenticatedUrl()`, `isBillingAuthPage()`, `assertSafeToNavigate()`
- Feature-код не строит authenticated Billing URL самостоятельно
- **Нет fallback URL без `pp`** — navigation REJECTED + `BILLING_SESSION_NOT_CONFIRMED` / `BILLING_NAVIGATION_PP_MISSING`
- С UserSide: сначала `handoff.focusSource` (живая Billing-вкладка); если source tab нет и pp нет — отказ

### 2. Auth-page detector (высший приоритет)
- `context-engine.js`: DOM password/login → `billing_login` **до** разбора `a=dopdata|user|252|310…`
- На `billing_login`: subscriber facts не собираются, Case не уничтожается, активная ActionSession → FAILED (`BILLING_AUTH_PAGE_REACHED`)

### 3. Direct Replay = TELEPORT
- History arrow: `intent/DIRECT_REPLAY`, `completeDirect()` без Focus/SHOWN/tutorial
- Juniper → `billing.juniper` / `billing_juniper` (не billing_user + подсветка)
- Technical → gateway `billing.technical`
- Lifecycle ALLOWED расширен: `NAVIGATING|DESTINATION_REACHED → COMPLETED` для teleport

### 4. Click idempotency
- `action-lifecycle.start()`: повторный click той же `(caseId, semanticTargetId)` → `ACTION_DUPLICATE_SUPPRESSED`, тот же operationId

### 5. Background source-tab safety
- `safeBillingTechnicalTarget(url, sourceTabUrl)`: если в target нет `pp` — берёт из source tab; если `pp` всё равно нет — **не навигирует** (только focus)

### 6. Technical CTA
- «Заполнить техданные» / «Заполнить OLT» вместо «подставить/сверить» как основного CTA
- Autosave по-прежнему запрещён

### 7. Observability
- Коды: `BILLING_SESSION_NOT_CONFIRMED`, `BILLING_NAVIGATION_PP_MISSING`, `BILLING_AUTH_PAGE_REACHED`, `BILLING_NAVIGATION_DUPLICATE_BLOCKED`, `DIRECT_REPLAY_FAILED`
- Trace: `NAVIGATION_REQUESTED`, `BILLING_SESSION_RESOLVED` (без значения pp), `NAVIGATION_URL_BUILT` (redacted), `AUTH_PAGE_DETECTED`, `ACTION_DUPLICATE_SUPPRESSED`

## Файлы
- `src/core/billing-navigation.js` (новый)
- `src/core/context-engine.js`
- `src/core/action-lifecycle.js`
- `src/ui/guide.js`
- `src/ui/rail.js`
- `src/background.js`
- `src/content/namespace.js`
- `manifest.json` → **1.7.29.32**
- `tests/billing_navigation_safety_unit_test.mjs` (новый, 17 PASS)
- `tests/live_onu_acquisition_flow_unit_test.mjs`, `tests/regression_tests.py`

## Regression
- Baseline v1.7.29.31: 268 PASS / 1 FAIL (docs) / 6 SKIP
- После: **276 PASS / 1 FAIL (тот же docs unpacked-extension) / 6 SKIP**
- Новые safety unit tests: **17/17 PASS**
- `universal_action_lifecycle_unit_test`: PASS
- `live_onu_acquisition_flow_unit_test`: PASS

## Оставшиеся ограничения
- `pp` по-прежнему не кэшируется в Case (by design). Replay с UserSide без живой Billing source-tab **отклоняется**, а не строит URL без session.
- Полный DOM e2e auth-page на реальном Billing login HTML зависит от стабильных маркеров формы; детектор покрывает password + типичные login markers.
- Чужой `share-modal.js` не трогался.
