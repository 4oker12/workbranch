# Handoff и Guide Mode — v1.5.3

## Handoff lifecycle

```text
Billing tab
  → capture click on gotouser.php
  → HANDOFF_PREPARE
  → token + caseId + sourceTabId + subscriber identity
  → UserSide tab
  → HANDOFF_CLAIM
  → targetTabId
  → STORE_APPLY_CONTEXT with original caseId
  → Subscriber Locator continues the same workflow
```

### Matching priority

1. Exact one-time token.
2. Claimed case ID and target tab.
3. Fresh pending handoff with matching subscriber IP.

### Expiration

- pending: 10 minutes;
- claimed: 30 minutes.

## Guide follows policy actions

Guide Mode does not contain a fixed end-to-end script. It maps the current policy action to a semantic DOM target.

```text
open_technical
poll_current_binding
check_tmc
search_mac
search_uplink_downlink
inspect_interface
inspect_device
fill_billing_olt
poll_candidate
complete_confirmed / complete_not_found / manual_review
```

## Highlight rules

- overlay uses `pointer-events: none`;
- native CRM elements remain clickable;
- target is resolved at activation time;
- dynamic `pp`, subscriber IDs and row positions are not hardcoded;
- no automatic click;
- `reboot ONU` is never a Guide target.

## Save flow

Guide may highlight `Сохранить`, but core state transition is handled by the native locator observer:

```text
operator click
→ save intent
→ new document
→ selected OLT reread
→ saved / failed
```

## Отображение найденной ТМЦ и возврат в Billing

Если UserSide-парсер извлёк имя или IP OLT из блока «Найдено на OLT», Workbench сразу показывает OLT как найденную. В той же карточке выводятся имя OLT, IP, а при наличии — ONU Serial и ONU MAC.

Кнопки доступны одновременно:

- «Подсветить» — выделяет исходный DOM-блок ТМЦ;
- «Вернуться в Billing» — переводит оператора обратно в исходную вкладку.

ONU Serial и ONU MAC используются как дополнительные строки и для ранжирования нескольких блоков. Их отсутствие или несовпадение не скрывает найденную OLT и не блокирует возврат в Billing.


## v1.5.3 — действие из карточки

Кнопка внутри Guide не вызывает повторный `plan(case)`. Она выполняет сохранённый план подсказки и использует ссылку фактически подсвеченного DOM-элемента. Для `gotouser.php` сначала вызывается `prepareFromAnchor`, затем открывается штатная вкладка с токеном handoff.
