# SIMNET Workbench — Semantic Tree

**Статус:** канонический смысловой контракт проекта с v1.7.29.43.  
**Источник истины для структуры:** `src/core/semantic-tree.js`.

## Зачем это существует

Workbench больше нельзя рассматривать как набор кнопок, Guide-step'ов и DOM-переходов.

Есть три разных слоя:

```text
SEMANTIC TREE
Что мы пытаемся выяснить и зачем нужен следующий шаг
        ↓ выбирает смысловую операцию
OPERATION STATE MACHINE
Как безопасно выполнить конкретное действие
        ↓ возвращает результат
EVIDENCE
Почему смысловой факт считается подтверждённым / исключённым / конфликтным
        ↓
SEMANTIC TREE пересчитывает, что нужно дальше
```

Semantic Tree **не хранит runtime progress Case**. Он является статической картой смысла проекта.

Runtime progress остаётся в Case / ActionSession / workflow / appeal.

---

## Главное правило расширения Workbench

Любой новый функционал должен пройти semantic placement.

### Допустимы только два варианта

1. Новая функция прикрепляется к существующему смысловому узлу или переходу.
2. Существующих контекстов объективно недостаточно — создаётся новый semantic context, который сначала связывается с `Абонент / Case`, и уже внутрь него помещается функция.

### Запрещено

```text
новая кнопка
→ новая функция
→ новый state
→ потом когда-нибудь решим, зачем это существует
```

Правильно:

```text
какую проблему/неопределённость решаем?
→ в каком semantic context это живёт?
→ какой факт должен появиться после выполнения?
→ какая Operation реализует переход?
→ какое Evidence подтверждает успех?
→ только потом UI/кнопка/автоматизация
```

`src/core/semantic-tree.js::validate()` специально запрещает orphan operations и orphan semantic nodes.

---

## Текущая верхнеуровневая карта

```text
АБОНЕНТ / CASE
│
├── Симптом / обращение
│   └── Маршрут обращения
│
├── Сессия / Juniper
│   └── Проверить Juniper
│       ├── online
│       ├── offline
│       └── reset / profile evidence
│
├── Доступ / физический путь
│   └── Тип подключения
│       │
│       ├── PON
│       │   ├── Проверить техданные
│       │   │   └── Техданных достаточно?
│       │   │       │
│       │   │       ├── ДА → Живой опрос ONU/OLT
│       │   │       │
│       │   │       └── НЕТ → Показать ТМЦ
│       │   │                 │
│       │   │                 ├── ТМЦ дала данные
│       │   │                 │   └── Сверить / перенести в Billing
│       │   │                 │       ├── уже совпадает → дальше
│       │   │                 │       ├── конфликт → решение оператора
│       │   │                 │       └── изменено → штатный Save
│       │   │                 │                       ├── saved → ONU poll
│       │   │                 │                       └── отказ/уход → повтор writeback
│       │   │                 │
│       │   │                 └── ТМЦ недостаточно → MAC fallback
│       │   │
│       │   └── Живой опрос ONU/OLT
│       │       ├── confirmed
│       │       │   └── анализ PON
│       │       │       ├── состояние ONU
│       │       │       ├── оптика
│       │       │       ├── клиентский Ethernet-link
│       │       │       ├── learned MAC
│       │       │       ├── service-port / VLAN
│       │       │       └── traffic
│       │       └── no confirmation / timeout / wrong route
│       │
│       └── Ethernet
│           └── Проверить Ethernet-путь
│               ├── switch
│               ├── port / link
│               ├── MAC / FDB
│               ├── errors
│               └── uplink
│
├── Где физически найден абонент
│   ├── Billing
│   ├── ТМЦ
│   ├── MAC history/search
│   ├── ONU/OLT
│   └── Switch
│
├── Доказательства
│   ├── подтверждено
│   ├── исключено
│   ├── конфликт
│   └── нужен следующий источник
│
└── Операторский контекст
    ├── History Replay
    └── Регистрация звонка
```

---

## Почему ТМЦ разделена на несколько смыслов

Это обязательный пример правильного моделирования.

```text
TMC_RESULT распарсен
≠
оператор/Workbench прошёл TMC semantic operation
≠
данные TMC перенесены в Billing
≠
изменения сохранены
```

Соответственно:

- parser даёт `evidence/source data`;
- `tmc.inspect` завершается только после Workbench teleport + viewport + point highlights;
- `tmc.writeback` работает только с реально присутствующими TMC-полями;
- `native Save` — отдельный gate;
- отказ от Save не откатывает `tmc.inspect` назад.

---

## Operation ≠ Semantic Tree

Пример:

```text
SEMANTIC EDGE:
«техданных недостаточно» → «проверить ТМЦ»

OPERATION:
tmc.inspect

STATE MACHINE:
REQUESTED
→ NAVIGATING
→ DESTINATION_REACHED
→ WAITING_TARGET
→ TARGET_READY
→ SHOWN
→ COMPLETED

EVIDENCE:
workbench teleport shown
+ TMC root in viewport
+ expected OLT / Serial / MAC point highlights in viewport
```

Semantic Tree не должен знать, через сколько вкладок проходит операция, как работает handoff или сколько bounded retry ей нужно.

Operation State Machine не должна решать, **зачем** оператор идёт в ТМЦ.

---

## Как добавлять новую идею

Перед реализацией новой функции заполнить короткую карточку:

```text
Название идеи:

1. Semantic context:
   существующий / новый

2. Какую неопределённость закрывает:

3. Из какого semantic node начинается:

4. Какой semantic node/fact должен появиться после успеха:

5. Operation ID:

6. Success evidence:

7. Отказ / timeout / conflict:

8. Меняет ли canonical Case или только показывает историю:

9. Какие существующие операции/инварианты не имеет права ломать:
```

Если пункты 1–6 нельзя заполнить, функцию пока нельзя добавлять в UI.

---

## Интерактивное представление

`Диагностический граф → Смысловая карта` открывает read-only интерактивное представление `WB.semanticTree`.

Доступно:

- фильтр по semantic context;
- вся карта целиком;
- выбор узла;
- входящие/исходящие смысловые связи;
- conditions ребра;
- связанная Operation;
- success evidence;
- текущие implementation owner files;
- правила расширения проекта.

Эта карта намеренно **не редактирует runtime Case и не запускает диагностику**.

---

## Инварианты

1. Один `Case` — корень смысловой модели.
2. Нет orphan operation.
3. Нет orphan semantic node.
4. Parser observation не равен выполненной Operation.
5. Navigation success не равен business success без postcondition/evidence.
6. Отказ/timeout/conflict являются нормальными ветками, а не «сломавшейся линейной цепочкой».
7. Уже подтверждённый факт не откатывается только из-за отказа на следующем шаге.
8. History Replay не меняет canonical progress.
9. UI является представлением semantic/operation state, а не источником истины.
10. Добавление новой функции начинается с semantic placement, а не с кнопки.

## PON/TMC source-limited identity invariant (v1.7.29.45)

TMC is authoritative only for values the real native block actually exposes.
After the canonical `userside.tmc` semantic teleport has completed (`workflow.ponAcquisition.tmcShownAt`):

- if TMC exposes `OLT + ONU MAC` and no ONU Serial, Serial is **not required** for this route;
- missing Serial must not become a writeback obligation, a readiness blocker, or a reason to repeat TMC;
- passive/background TMC parsing cannot activate this relaxation;
- when the OLT is Huawei, the Billing poll adapter is always Huawei (`a=313`) even if the subscriber interface is labelled EPON. Interface technology and poll-adapter/vendor are separate semantic facts.
