# SIMNET Workbench v1.7.29.31 — Juniper Evidence Graph audit

## До изменения

| Область | Текущее поведение v1.7.29.30 | Проблема |
|---|---|---|
| Background Juniper read | `juniper-prefetch.js` читает `a=252` read-only и сохраняет preview | факт уже известен, но `evidence-navigator` не считает его milestone до ручного review |
| Manual Juniper page | Billing adapter парсит `billing_juniper` и даёт `JUNIPER_SESSION` | ручное посещение и сетевой результат не были представлены как два независимых evidence |
| LIVE | верхний статус уже использует Juniper snapshot; history ждёт `reviewStatus=reviewed` | LIVE мог показывать Online сверху, но не иметь Juniper в «Что уже сделано» |
| Graph | использует общий `evidenceNavigator.trail()` | Juniper попадал в trail только после review; source/opened/verified не видны отдельно |
| Universal Action | `billing.juniper` уже зарегистрирован как semantic target | это хорошая база; отдельный lifecycle создавать не нужно |
| Trace | фиксирует клики/page entry/action lifecycle | автоматический Juniper read не имел полного набора system-events |
| Observability | prefetch имел общий `JUNIPER_PREFETCH_FAILED` | timeout/request/parse и Case mismatch не различались |
| Correlation | background prefetch пинит `caseId/episodeId/requestId` | хороший stale-response guard, его нужно сохранить |

## Архитектурный вывод

Juniper уже был параллельным read-only источником, но его data-availability и operator-visit были связаны старым `reviewStatus`. Новая модель должна разделить три факта:

- `JUNIPER_READ` — результат реально получен;
- `JUNIPER_OPENED` — оператор реально открыл штатный Juniper;
- `JUNIPER_VERIFIED` — результат успешно распознан и не конфликтует с текущим Case.

LIVE агрегирует их в одну строку. Graph хранит подробности. Universal Action Lifecycle остаётся единым для ручной навигации/replay.
