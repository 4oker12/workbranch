# SIMNET Workbench v1.7.29.47 — Selectize Defocus + Same-Page Poll Transition

## Исправлено

1. Автоподстановка OLT больше не оставляет caret/focus в Selectize. После программного выбора Workbench закрывает список, снимает focus-классы и кратко паркует keyboard focus на собственном невидимом focus sink. Повтор закрытия ограничен двумя animation frames + одним 60ms settle; постоянных таймеров нет.
2. Решение оператора «не сохранять» теперь пересчитывает Locator на той же странице `billing_technical`. `declineTmcWriteback()` после durable patch сразу выполняет forced scan и repaint Rail. Переход на другую страницу больше не нужен, чтобы увидеть `poll_candidate`.
3. Native Save остаётся ручным. Пока одноразовый Save-вопрос открыт, poll не предлагается; после X/ESC/backdrop решение становится `declined` и сразу на текущей Technical появляется следующий шаг ONU poll.

## Инварианты

- Save никогда не кликается автоматически.
- Реальный native Save intent не считается отказом.
- TMC evidence и подтверждённая binding сохраняются при отказе от Save.
- `setInterval` в production `src`: 0.
