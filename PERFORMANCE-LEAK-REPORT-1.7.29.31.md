# v1.7.29.31 — Performance / leak report

## Production source comparison

| Metric | v1.7.29.30 | v1.7.29.31 |
|---|---:|---:|
| `setInterval(` | 0 | 0 |
| `setTimeout(` | 55 | 55 |
| `MutationObserver(` | 4 | 4 |
| `addEventListener(` | 149 | 149 |

## Juniper-specific lifecycle

- Новый Juniper fetch не добавлен.
- Existing `a=252` prefetch используется повторно.
- Existing in-flight + `already-read` guards сохранены.
- LIVE/Graph не инициируют дополнительный Juniper request.
- Новый постоянный timer отсутствует.
- Новый MutationObserver отсутствует.
- Новый permanent listener отсутствует; используется существующий EventBus callback `context:changed` внутри уже загружаемого Juniper module.
- Trace события добавляются только если manual Diagnostic Trace включён, потому что `recordSystemEvent` сам no-op при Trace OFF.
- Response body/HTML в Trace/diagnostics не сохраняется.
- Juniper evidence имеет фиксированную структуру `read/opened/verified`, без unbounded history array.

## Case isolation

Automatic request остаётся pinned к `caseId/episodeId/requestId`. Background correlation проверяется до canonical mutation. Дополнительно IP/MAC conflict блокирует merge и создаёт diagnostic `JUNIPER_RESULT_CASE_MISMATCH`.
