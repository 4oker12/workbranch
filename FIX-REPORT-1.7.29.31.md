# SIMNET Workbench v1.7.29.31 — Juniper as first-class evidence node

## Изменено

- Juniper automatic read теперь может сразу создать полноценный Case evidence и строку LIVE `✓ Juniper · Online/Offline/сессия не найдена`.
- Automatic read и manual visit разделены:
  - `caseData.juniper.evidence.read` → `JUNIPER_READ`;
  - `caseData.juniper.evidence.opened` → `JUNIPER_OPENED`;
  - `caseData.juniper.evidence.verified` → `JUNIPER_VERIFIED`.
- `operatorOpened` остаётся `false`, пока оператор реально не открыл `billing_juniper`.
- Manual open не создаёт вторую строку LIVE; Juniper агрегируется в один history item.
- `no_session` считается валидным выполненным чтением, а не «не выполнено».
- `error` не создаёт ложный `JUNIPER_READ` milestone.
- Добавлена identity/correlation защита: конфликт наблюдаемого IP/MAC с текущим Case даёт `JUNIPER_RESULT_CASE_MISMATCH` и не мержит сетевые факты.
- `billing.juniper` остаётся semantic target существующего Universal Action Lifecycle; Juniper-specific state machine не создана.
- Graph показывает отдельную Juniper evidence card с source/read/opened/verified metadata.
- Trace получил Juniper system events без сохранения response body.
- Observability различает request timeout / request failure / parse failure / Case mismatch.
- Фоновый read не запускает Focus, не закрывает LIVE и не меняет activeView.

## Изменённый старый тест

Старый regression-invariant v1.7.29.30 требовал, чтобы background Juniper preview **не** считался history milestone до ручного review. Он объективно противоречит новому явному требованию продукта: подтверждённый automatic Juniper result должен сразу быть evidence. Тест не ослаблен, а заменён более строгим контрактом:

- automatic read = Case evidence;
- manual OPENED хранится отдельно;
- PON acquisition остаётся non-blocking;
- никакого обязательного Juniper шага.

## Файлы

- `src/background.js`
- `src/core/juniper-prefetch.js`
- `src/core/evidence-navigator.js`
- `src/graph/graph-studio.js`
- `src/ui/guide.js`
- `tests/evidence_navigation_unit_test.mjs`
- `tests/live_evidence_history_unit_test.mjs`
- `tests/graph_evidence_projection_unit_test.mjs`
- `tests/juniper_evidence_graph_unit_test.mjs`
- `tests/regression_tests.py`
- version/docs metadata
