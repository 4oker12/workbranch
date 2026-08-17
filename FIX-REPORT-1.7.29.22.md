# SIMNET Workbench v1.7.29.22 — UI focus hierarchy report

## Задача

Доработать только визуальный слой по скриншотам: сделать финальный `Запрос OLT` очевиднее, не оставлять Workbench-подсказки под затемнением, сохранить тихую подсветку после закрытия Focus Layer и убрать семантическую путаницу «OLT отсутствует» против «OLT найден в ТМЦ, но не записан в Billing».

## Что изменено

### 1. `Запрос OLT` — семантическая зона, а не мелкая ссылка

Resolver и native click не менялись. Workbench по-прежнему находит реальную ссылку `act=askolt`, но визуальный marker теперь ставится на её `td/th`-ячейку. Сама ссылка остаётся штатной и кликается оператором.

### 2. Иерархия Focus Layer

Z-order закреплён как:

`dim Focus Layer (2147483644) < page micro-hints/evidence (2147483645) < Workbench RAIL (2147483646)`.

Поэтому `?`, финальная зона OLT и точечный evidence не теряются под затемнением. В базовом режиме они остаются низкоконтрастными; при активном Focus Layer становятся контрастнее.

### 3. Persistent evidence

Закрытие transient Guide overlay больше не удаляет уже найденные point-маркеры ТМЦ. Они заменяются при следующем TMC reveal / смене DOM-контекста.

### 4. Точная формулировка TMC → Billing

Если Billing Technical пуст, но TMC уже содержит OLT, LIVE не пишет двусмысленное `Не хватает: OLT`. Теперь: `Billing: не заполнено — OLT · найдено в ТМЦ`.

Для single-field OLT writeback показывается конкретный `OLT name · IP` и кнопка `Подставить OLT в Billing`. Уже существующий safe writeback переносит значение в форму. Автоматического Save нет.

### 5. Что не менялось

- PollAttempt / correlation / route controller / locator policy.
- Native `Запрос OLT`, AUTOFIND, Port poll, Reboot handlers.
- TMC parser и правила выбора источника.
- Сохранение Billing остаётся ручным.
- Pending/confirmed по-прежнему подавляет повторный poll CTA.

## Regression

237 PASS / 6 SKIP / 0 FAIL. SKIP — прежние DOM fixtures без доступного jsdom-модуля в текущем окружении.
