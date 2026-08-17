# SIMNET Workbench v1.7.29.30 — Universal Action Lifecycle + Diagnostic Trace

## Изменённые production-файлы

- `manifest.json` — версия 1.7.29.30, подключён `src/core/action-lifecycle.js`.
- `src/content/namespace.js` — runtime version.
- `src/background.js` — Case `workflow.actionSession`, validation/persistence, migration/pruning deprecated guided flags, Trace mode timestamps.
- `src/core/action-lifecycle.js` — новый единый lifecycle engine.
- `src/core/operator-trace.js` — manual Trace v2, bounded storage/memory queue, system timeline, Focus/UI-change trace.
- `src/ui/guide.js` — semantic target registry, ActionSession-aware Focus, rebind, explicit dismiss reasons, cross-page continuation.
- `src/ui/rail.js` — Technical/TMC/Poll/replay migrated to universal ActionSession; manual Trace controls; old final Ask OLT persistent highlight removed.

## Universal state machine

`REQUESTED → NAVIGATING → DESTINATION_REACHED → WAITING_TARGET → TARGET_READY → SHOWN → COMPLETED`

Terminal alternatives:

`INTERRUPTED / REJECTED / TIMEOUT / FAILED / DISMISSED`.

Один `operationId` не может повторно делать логический SHOW. DOM rebind не считается новым SHOW.

## Target registry

Текущие semantic targets:

- `billing.technical`
- `userside.tmc`
- `billing.poll.entry`
- `billing.olt.request`
- `billing.juniper`

Target-specific код отвечает только за `resolve()`. Lifecycle/invariants/observability/Trace общие.

## Исправляемый класс багов

### TMC первый клик

Cross-page session переживает Billing → UserSide. Перед фактическим `location.assign`/handoff lifecycle дожидается сохранения `actionSession`, чтобы CGI navigation не убила intent. Попадание на `userside_customer` ещё не считается `SHOWN`: lifecycle ждёт semantic TMC target. Второй feature-specific one-shot intent больше не нужен.

### Huawei/GPON/EPON/GCOM мигание

После `SHOWN` pending navigation consumed, а acquisition timer принудительно отменяется. Если native DOM node заменён, resolver делает `TARGET_REBOUND`; render/store/context не создают второй logical SHOW.

### Необъяснимое исчезновение Focus

`GuideOverlay.clear()` требует reason. Unexpected clear из `SHOWN` становится `ACTION_FOCUS_DROPPED_UNEXPECTEDLY`.

### Ask OLT

Отдельный persistent page glow удалён. Последний нативный action тоже использует universal Focus. Target остаётся крупным: resolver берёт `td/th` ячейку с `Запрос OLT`.

## Evidence не подменяется action

`CTA clicked` != `milestone completed`.

ActionSession может стать `INTERRUPTED`, а evidence не появится. До SHOWN временный interruption guard распознаёт ручной native click и завершает guide-сессию вместо борьбы с оператором. Если оператор сам дошёл до semantic result, evidence может быть зафиксирован независимо от CTA.

## Diagnostics

Universal engine автоматически регистрирует lifecycle violations. FAILED/TIMEOUT несут тот же operationId в diagnostic entry. Existing observability emergency fallback остаётся нижним транспортным уровнем, если Service Worker message path недоступен.

## Manual Diagnostic Trace

More → Diagnostic Trace:

- `Начать запись`;
- `Остановить и экспортировать`;
- `Экспорт текущего Trace`.

При RECORDING пишутся clicks, selections, navigation, ActionSession state, Focus show/hide/rebind и ограниченные UI changes.

Для UI changes сохраняются структурированные поля: mutation type, attribute, before/after, semantic target, operationId, CSS path, visibility/display/rect. Полный DOM snapshot не создаётся.

Trace OFF не запускает дополнительный UI observer и не пишет Trace events.

## Deprecated runtime state

Удалено из активной Guide/Rail логики:

- `pollRevealPending`;
- `oneShotFocusTarget`;
- `evidenceReplayTarget`;
- отдельный `pollFinalHintPending` highlight.

Background при shape/migration удаляет stale legacy fields из старых Case.

## Tests

Добавлены/переработаны:

- `universal_action_lifecycle_unit_test.mjs`
- `universal_action_guide_contract_test.mjs`
- `trace_recorder_v2_contract_test.mjs`
- `trace_recorder_bounded_unit_test.mjs`
- evidence focus lifecycle contract
- one-shot TMC contract
- PON workflow persistence now verifies `actionSession`
- operator cockpit Focus contract now verifies universal Ask OLT target

Final regression: **274 total · 268 PASS · 0 FAIL · 6 existing SKIP**.

6 SKIP — существующие browser-DOM fixtures, потому что `SIMNET_JSDOM_MODULE` недоступен в текущем окружении. Новых SKIP не добавлено.
