# Архитектура SIMNET Workbench

> **Статус документа:** разделы ниже частично относятся к v1.5.3–v1.7.21.
> С v1.7.27+ добавлены Appeals Navigator, Graph Studio, Plum Shell (v1.7.29.x).
> Актуальный diagnostic path описан здесь кратко; детали locator/LIVE — в остальных docs.


## Semantic Tree (v1.7.29.43+)

Каноническая смысловая карта проекта находится в `src/core/semantic-tree.js`; подробный контракт — `docs/SEMANTIC_TREE.md`.

```text
Semantic Tree (зачем/что выясняем)
        ↓
Operation State Machine (как выполняем)
        ↓
Evidence (чем подтверждаем)
        ↓
Semantic Tree (что нужно дальше)
```

Semantic Tree не является третьим progress store. Он статичен и read-only для runtime Case. Любая новая операция обязана быть привязана к существующему semantic node/edge либо сначала создать новый semantic context. Валидатор запрещает orphan operations/nodes.

Интерактивный просмотр: `Диагностический граф → Смысловая карта`.

## Appeals / Diagnostic Graph (v1.7.27+)

Один state, два UI-view (не два engine):

```text
Published graph (Graph Studio storage)
        ↓
WB.appeals  (select / answer / back / conditions)
        ↓
case.appeal  ← единственный progress
        ↓
┌───────────────────┬────────────────────────┐
│ RAIL appealView   │ Runtime Graph          │
│ компактный companion│ канонический path UI │
│ тот же case.appeal│ + minimap пути         │
└───────────────────┴────────────────────────┘
        ↓
buildDiagnosticSnapshot → NOC / history / future chat
```

- **Runtime Graph** — операторский path (симптом, context chips, ответы, minimap).
- **Studio** — редактор topology (полное дерево); draft не влияет на active Appeal.
- **RAIL** — тот же `case.appeal`; не второй progress store.
- Не добавлять третий interactive surface с отдельным state.
- **Lazy load Graph:** в `content_scripts` только `src/graph/graph-loader.js`. Полный `graph-studio.js` подгружается при первом `WB.graphStudio.open()` (`fetch` + eval в isolated world; файл в `web_accessible_resources`).
- **Lazy load Audit:** `audit-loader.js` в content_scripts; `launcher.js` on demand (Billing list).
- **Interactive surface:** ответы appeal только в Runtime Graph; RAIL — status companion.

## Performance contract

Когда Graph/Audit закрыты: 0 layout/render этих модулей, 0 graph timers/polling, zoom/pan не пишут Case.

Когда Graph открыт: Case change | answer → resolve (pure) → render once → fit once.

Snapshot: семантика (path, evidence refs, compact conflicts), не HTML/DOM/terminal dump.

## Поток данных

```text
Billing DOM / UserSide DOM / штатные ответы
                    │
                    ▼
          Context Engine + Adapters
                    │
                    ▼
          Structured Observations
                    │
                    ▼
     Subscriber Locator Policy Engine
        ├─ attempts
        ├─ evidence
        ├─ hypotheses
        ├─ candidates
        ├─ sourceStatus
        ├─ recommendation
        └─ termination
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      RAIL UI             Guide Mode
  объясняет решение     показывает DOM-цель
```

## Разделение ответственности

### Adapters

Распознают страницу и публикуют наблюдения. Не определяют следующий шаг.

Примеры:

```js
{
  type: 'POLL_RESULT',
  result: 'not_found',
  details: {
    oltIp,
    onuMac,
    subscriberMac,
    pollAction
  }
}
```

```js
{
  type: 'MAC_SEARCH_RESULT',
  result: 'candidate_found',
  searchMode: 'direct',
  details: { candidates }
}
```

### Subscriber Locator

Хранит диагностическую историю и применяет упорядоченный набор правил из `src/core/locator-policy.js`.

Новое ответвление добавляется как:

1. новый тип наблюдения или новый `result`;
2. обработчик, нормализующий данные;
3. одно или несколько policy-правил;
4. при необходимости новый Guide resolver.

Существующие парсеры и UI не должны переписываться целиком.

### Guide Mode

Не принимает диагностических решений. Он получает текущую `recommendation` и пытается найти подходящий DOM-элемент семантически.

## Модель данных Locator

```js
locator = {
  state,
  attempts: [],
  evidence: [],
  hypotheses: [],
  candidates: [],
  sourceStatus: {},
  recommendation: {
    action,
    ruleId,
    reason,
    params
  },
  termination: null | {
    status,
    reason,
    completedAt
  }
};
```

## Гипотезы и отрицательные доказательства

Отрицательный прямой опрос создаёт rejected hypothesis с fingerprint:

```text
OLT identity | ONU identity/interface | poll action
```

Это означает:

- отвергнута конкретная связка;
- OLT не запрещена глобально;
- другой ONU MAC/Serial или интерфейс образует новую гипотезу;
- найденный кандидат должен пройти новый прямой опрос.

## Сила доказательств

От более слабого к сильному:

1. OLT указана в Billing;
2. OLT указана в ТМЦ;
3. MAC найден в истории оборудования;
4. текущий абонент подтверждён на конкретном интерфейсе;
5. прямой OLT poll подтвердил ONU/абонента.

Только пятый уровень завершает поиск как `confirmed`.

## Терминальные состояния

```text
confirmed
not_found
inconclusive
blocked
manual_review
```

Клик, навигация и сохранение формы не являются терминальными состояниями.

## Подтверждение сохранения

```text
native click observer
  → SAVE_INTENT + sourceDocumentId
  → браузер отправляет форму
  → новый documentId
  → Context Engine повторно читает OLT
  → SAVED либо SAVE_FAILED
```

Таким образом, Guide Mode может быть выключен, а переход состояния всё равно фиксируется.

## Handoff

Billing и UserSide используют один кейс. Handoff содержит:

- token;
- caseId;
- sourceTabId;
- targetTabId;
- login/contract/Billing ID/IP;
- purpose;
- TTL;
- одноразовое подтверждение.

UserSide-контекст не должен создавать независимый кейс, если открыт через handoff.

## Ограничения безопасности

- MV3;
- только внутренние host permissions;
- нет `<all_urls>`;
- нет автокликов;
- нет автоматического reboot;
- оператор подтверждает изменения CRM;
- Workbench проверяет результат после действия, а не предполагает успех.


## v1.5.3 — стабильный overlay

Затемнение состоит из четырёх неподвижных областей вокруг cutout. Пульсация применяется только к рамке цели. Tooltip резервирует правую границу полноэкранной рейки, поэтому не может наложиться на неё. Закрытие централизовано через крестик, `Esc` или фоновые области.

## v1.7.20 Route Controller / Evidence Commit Gate

The diagnostic route owns state transitions. A parser/page/DOM event is only an observation until the Route Controller classifies it against the current required action.

```text
PAGE / DOM / GET / PARSER
        ↓
Route Controller
  on_route | supporting | off_route | foreign
        ↓
Evidence Commit Gate
        ↓
canonical case facts + Locator policy
        ↓
Guide / terminal state
```

Rules:
- Off-route facts may be journaled/cached but do not overwrite route-sensitive PON state.
- Poll completion requires a real stable `askolt` response from the expected adapter and an on-route relation.
- Current page and current route step are separate concepts.
- `confirmed` remains a one-way terminal latch.
- DOM scans are single-flight and Workbench-owned MutationObserver changes are ignored by the page scanner.


## v1.7.21 Juniper-first read-only source

```text
Billing subscriber page
        ↓
CHECK_JUNIPER
        ↓
a=252 background read
        ├─ usable session → JUNIPER_SESSION
        └─ empty snapshot → one act=askjun → JUNIPER_SESSION
        ↓
OPEN_TECHNICAL
        ↓
existing Billing → TMC → MAC fallback → Poll route
```

Juniper is not PON topology truth. It is a separate L3/session evidence plane. A Juniper observation can enrich the case and UI but cannot overwrite OLT/ONU binding. `SYNC` and `Disconnect` are excluded from automatic actions.
