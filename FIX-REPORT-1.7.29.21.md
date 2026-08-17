# SIMNET Workbench v1.7.29.21 — UI-only fix report

## Задача

Сохранить рабочую диагностику без изменений и переделать только представление финального шага PON-опроса. На штатной Billing-странице опроса Workbench должен подвести внимание к реальному `Запрос OLT`, а не создавать второй интерфейс управления.

## Что изменено

### 1. Native `Запрос OLT` — финальная точка

Когда PON-данные уже сверены и оператор находится на `billing_onu_poll`, LIVE больше не показывает кнопку `Перейти к опросу ONU`. Вместо неё — компактный информационный блок `Финальный шаг · Запрос OLT` без собственного действия.

Точная штатная ссылка `Запрос OLT` определяется уже существующим resolver `findAskOltLink(caseData)` и получает только визуальный marker: plum outline + мягкий фон + underline. Marker не меняет layout и не вызывает click.

### 2. Один визуальный state во время pending

Если существующий PollAttempt уже находится в pending-stage, renderer скрывает pre-poll элементы `ONU не опрошено` и финальный/ready CTA. Остаётся существующая карточка `OLT · запрос выполняется` / `Повторный клик не нужен`.

Это renderer-only условие. PollAttempt не создаётся, не меняется и не завершается UI-кодом.

### 3. Что намеренно НЕ менялось

- `Запрос OLT`, `AUTOFIND`, `Опрос порта`, `reboot` и их native handlers.
- `correlation.js`, locator policy, route controller, Case Processor, network capture.
- Guide plan `billing.ask-olt` и правило: реальный запрос запускает оператор штатным кликом.
- Terminal parsing и подтверждение live result.

## Regression

Перед правкой базовый архив имел 1 FAIL: `poll_terminal_unit_test.mjs`, потому что тестовая дата `2026-08-08` к текущей дате 2026-08-16 вышла за проверяемое 7-дневное окно. Production-код не менялся; fixture переведена на относительные timestamps. После этого baseline regression был 232 PASS / 6 SKIP / 0 FAIL.

Для UI-fix добавлены проверки поведения ready-on-route / ready-on-poll-page / pending.
