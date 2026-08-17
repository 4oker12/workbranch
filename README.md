# SIMNET Workbench

> **Current build: v1.7.29.48 — Technical Save Freeze + Selectize Defocus.** TMC writeback now keeps the route frozen on Billing Technical until native Save is verified or the operator actually leaves the section; Huawei OLT remains bound to Billing `a=313`.

### 1.7.29.48 Technical Save Freeze + Selectize Defocus

- Native Billing Save remains manual: Workbench may prefill/focus it, but never clicks it automatically.
- The Save Guide is **one-shot visually**, but closing it does not change the semantic route while the operator remains on Billing Technical. Native Save + post-save verification may advance immediately; leaving Technical without Save records `declined` and only then allows the route to advance to ONU polling. Reload/pageshow while still in Technical is not treated as leaving the section.
- `declined` is durable Case state: Workbench clears `tmcWritebackPendingSave`, never reopens the Save Guide for that writeback, and never drags the operator back to Technical.
- After decline, valid TMC evidence remains authoritative. If TMC provides a conflict-free poll binding, the next route is `POLL_CANDIDATE`; no Save is required to continue the diagnostic attempt.
- A real native Save submission (`billing_save_intent=intent`) is protected from being misclassified as decline while post-save verification is in flight.
- Previous v1.7.29.45 invariants remain: TMC only obligates fields it actually exposes; missing Serial can be source-optional after real TMC teleport; Huawei OLT always selects Billing `a=313`, even for an EPON interface.
- Regression: **311 total · 305 PASS · 0 FAIL · 6 existing browser-DOM SKIP**; `setInterval` in `src`: **0**.

### 1.7.29.44 Standalone Semantic Studio

- Added a separate `src/semantic-studio/` application opened in its own extension tab from the Workbench popup. It never overlays Billing/UserSide.
- Canonical `WB.semanticTree` remains the base model; Studio maintains an independent editable draft and a separately confirmed project proposal.
- Supports contexts/topics, draggable semantic nodes, node types, explicit `A → B` link creation, click-to-edit arrows, conditions and operation bindings.
- Supports fast route sketches such as `Technical -> TMC -> Save -> ONU`, plus free-form idea/dialogue notes for design work.
- Pan/zoom graph canvas, full inspector, undo/redo, import/export, confirmation diff and bounded 30-version local history.
- Studio confirmation does **not** mutate the current Case, Guide, ActionSession, Billing/UserSide navigation or diagnostic runtime. Runtime adoption is a separate reviewed code change.
- Existing in-Workbench Semantic Map remains read-only.
- Regression: **310 total · 304 PASS · 0 FAIL · 6 existing browser-DOM SKIP**.


### 1.7.29.41 Dynamic TMC Writeback Scope

- Added canonical `tmcExpectedFields`: it is derived only from values actually present in current TMC (`OLT`, `ONU Serial`, `ONU MAC`).
- Global `billingMissingTechnical` no longer defines whether the TMC writeback transaction itself is complete. A Billing field absent in TMC is outside that transaction rather than an error.
- Normal TMC recovery inspects every field TMC actually supplied: empty Billing fields are filled, matching values are preserved, conflicts are surfaced and never overwritten silently.
- `applied + alreadyMatched` must cover every `tmcExpectedFields` entry before the form is considered verified.
- `already_present` is a valid no-Save success when every actual TMC field already matches persisted Billing values.
- `technicalWritebackVerified` is still gated by canonical `tmcShownAt`; passive/background TMC parsing cannot complete operator progress.
- Native Save remains mandatory only when Workbench actually changed a Billing field.
- Regression: **304 total · 298 PASS · 0 FAIL · 6 existing SKIP**; production syntax **41/41 PASS**; `setInterval` in `src`: **0**.

### 1.7.29.40 Strict TMC Teleport Milestone

- `TMC_RESULT`, `sourceStatus.tmc`, opening `/customer/<id>`, `usersideVisitedAt`, legacy `tmcFoundAt`, and old cached Guide completion are diagnostic facts only; none of them can mark TMC as visited.
- The only authoritative operator-progress latch is `workflow.ponAcquisition.tmcShownAt`. It is written centrally by Guide only after `userside.tmc` reaches a stable rendered native block, Focus is accepted as `SHOWN`, and all expected available TMC value kinds (OLT / Serial / MAC) have visible plum point marks.
- The same rule covers both entry paths: first Billing → UserSide one-shot teleport and explicit `Показать ТМЦ`. The Rail button itself can no longer write `tmcShownAt`.
- History Replay is read-only: replaying TMC never creates or refreshes `tmcShownAt`.
- `tmc_checked` Guide completion is now gated by the same `tmcShownAt`; cached/passive parser evidence can no longer produce `already_satisfied`.
- Legacy passive `route.tmcFoundAt` is removed during UserSide context processing so it cannot be reused as progress later. Parser evidence itself is preserved for diagnostics/matching.
- Regression: **302 total · 296 PASS · 0 FAIL · 6 existing SKIP**; production syntax **41/41 PASS**; `setInterval` in `src`: **0**.

### 1.7.29.39 Destination Resume + Visible TMC + Selectize Close

- Billing OLT writeback now prefers the live Selectize API (`setValue`/`close`/`blur`) and performs a bounded post-render close, so a correctly selected OLT cannot leave the dropdown covering native Save/Guide.
- Pending TMC → Billing writeback resumes from committed `context:changed` on `billing_technical`; opening LIVE is no longer a workflow trigger.
- A discarded unsaved Technical draft is detected on a fresh Billing document by comparing the real form against `expectedTechnicalWriteback`; stale `pendingSave` is converted back to the same explicit writeback transaction without auto-saving.
- `userside.tmc` candidates must be connected **and rendered**. Zero-size/hidden AJAX/gallery clones are rejected or lifted only to a bounded visible semantic ancestor.
- First-pass TMC acquisition has a temporary MutationObserver scoped to the active ActionSession; it wakes immediately when real AJAX markup appears and self-destructs at the action timeout. No permanent poller or `setInterval` was added.
- Regression: **301 total · 295 PASS · 0 FAIL · 6 existing SKIP**; production syntax **41/41 PASS**; `setInterval` in `src`: **0**.

### 1.7.29.38 Save Gate + Universal Replay Navigation

- TMC form prefill is explicitly **not** saved Billing evidence; pending native Save hard-blocks ONU readiness in the diagnostic core, LIVE rendering, and CTA execution.
- Successful TMC prefill automatically invokes the existing Focus Layer on the real Billing `Сохранить` control and adds a plum pulse; Workbench never duplicates or auto-clicks Save.
- Only the existing post-save confirmation on a fresh Billing document clears the gate and permits `Перейти к опросу ONU`.
- A confirmed ONU/OLT poll is terminal regardless of the order in which the operator reached it; stale poll CTA is both hidden and execution-blocked.
- `Что уже сделано` replay no longer completes when only the destination page opens. It waits for the semantic native target, scrolls/orients it, then completes.
- Bounded replay acquisition applies to Billing Technical, UserSide TMC, Billing poll entry, and Juniper; exhausted retries become `ACTION_REPLAY_TARGET_TIMEOUT` diagnostics instead of silent `WAITING_TARGET`.
- Regression: **300 total · 294 PASS · 0 FAIL · 6 existing SKIP**; production syntax **41/41 PASS**; targeted non-jsdom navigation/PON/Guide tests **25/25 PASS**.

### 1.7.29.37 Navigation Race + TMC First-Pass Fix

- `Перейти к опросу ONU` now performs the native technology navigation itself (`a=310/311/312/313`) instead of merely focusing the technology link on the Billing card.
- The same ActionSession continues on `billing_onu_poll` and finishes Workbench navigation at the visible native `Запрос OLT`; the actual OLT request remains an explicit operator click.
- A passive same-Case UserSide/Billing tab can no longer change a shared ActionSession to `INTERRUPTED` while another tab is executing it; passive observers are lifecycle read-only.
- Focus is emitted only after the lifecycle successfully accepts `SHOWN`, so an already terminal session cannot produce a false visual success.
- First Billing → UserSide TMC handoff resumes the action immediately after Case claim, independent of bootstrap `forceScan` timing.
- `userside.tmc` target acquisition has a bounded event-style retry window for asynchronously rendered native fragments; no permanent `setInterval`/poller was added.
- TMC semantic resolution now reuses the canonical TMC parser before fallback DOM heuristics, preventing Guide/parser drift.
- `Запрос OLT` resolver verifies that the currently open poll technology matches the authoritative Case `pollAction`.

- Regression: **297 total · 291 PASS · 0 FAIL · 6 existing SKIP**; production syntax **41/41 PASS**.

### 1.7.29.36 Poll Target + TMC Fast-Bind Fix

- `Перейти к опросу ONU` now resolves the native Billing tab from the **current verified Case binding** (`diagnostic.pollAction` / `pon.pollAction`) before any locator fallback candidate.
- A stale Locator candidate can no longer redirect Focus from the current PON technology to an old `a=310/311/312/313` tab.
- Fast reuse of an already-open exact `/customer/<id>` UserSide tab now performs an explicit lightweight Case bind/wake in that live content script.
- Billing → UserSide → TMC therefore remains one transaction even without reload/hashchange/pageshow; the pending `userside.tmc` ActionSession continues to target resolution and final scroll/Focus.
- If the fast target tab cannot acknowledge the exact Case identity, Workbench falls back to the proven token/hash handoff instead of stopping on the UserSide card.
- No full-State read was added to the fast path; v1.7.29.35 responsiveness is preserved.
- Regression: **294 total · 288 PASS · 0 FAIL · 6 existing SKIP**.

### 1.7.29.31 Juniper Evidence Graph

- Automatic correlated Juniper read can immediately populate LIVE evidence without forcing a manual visit.
- `JUNIPER_READ`, `JUNIPER_OPENED`, `JUNIPER_VERIFIED` are distinct Case facts.
- Existing `billing.juniper` Universal Action semantic target handles manual replay/focus; no Juniper-specific lifecycle.
- Explicit request/timeout/parse/Case-mismatch diagnostics and bounded Trace system events.
- No new poller, permanent timer, MutationObserver or duplicate Juniper fetch.

### 1.7.29.30 Universal Action Lifecycle + Diagnostic Trace

- One `WB.actionLifecycle` for Technical/TMC/Poll/Ask OLT/Juniper/replay and future semantic targets.
- Focus has no SHOWN TTL; routine store/context/render updates cannot dismiss it.
- DOM replacement rebinds the same semantic target instead of closing/reopening Focus.
- Deprecated `pollRevealPending` / `oneShotFocusTarget` / `evidenceReplayTarget` runtime paths are pruned; guided cross-page state persists as `Case.workflow.actionSession`.
- ActionSession and evidence are separate: CTA click never invents a completed diagnostic milestone.
- Lifecycle failures/invariant violations automatically enter diagnostics with `operationId`.
- Manual `Diagnostic Trace` records clicks, selections, navigation, ActionSession, Focus and bounded/correlated UI changes; no mousemove/hover flood.
- Trace limits: 600 pending memory events, 3000 persisted events/session, ~1.2 MB/session, 5 sessions.
- Old separate Ask OLT page glow was removed; the native action cell uses the same universal Focus Layer.
- Regression: **274 total · 268 PASS · 0 FAIL · 6 existing SKIP**.

### 1.7.29.28 Evidence-driven navigation

- `Case/evidence` is the technical progress source of truth for LIVE, Guide recommendation gating and Graph technical-path projection.
- LIVE no longer renders `не выполнено` rows or the standing `ONU не опрошено` goal.
- Operator route is free: Technical/TMC/Poll can occur in any order; later results never invent earlier milestones.
- A completed milestone suppresses its large CTA even if the operator reached it manually. Replay is available only through the compact history arrow.
- Focus Layer is latched across routine store/context/scan updates and closes only on explicit/semantic completion.
- Passive TMC/Juniper background data does not masquerade as operator progress.
- Poll NOT_FOUND/TIMEOUT/ERROR still count as a performed poll attempt with the real result.
- No new permanent timer/observer was introduced.

> v1.7.29.17 сохраняет все PBX hard guards v1.7.29.16 и добавляет namespace-aware обработку входящих `prov=1`: legacy/LUKNET contract не маскирует точное совпадение IP текущего Case. Телефон остаётся только вспомогательным признаком.

### 1.7.29.17 PBX Provider Namespace Hotfix

- PBX `prov` сохраняется в Call Context как `providerCode`.
- `prov=1`: PBX contract рассматривается как отдельный namespace; несовпадение с SIMNET `abon...` не считается автоматическим конфликтом.
- Для привязки всё равно нужен сильный признак: точный IP или точный сравнимый contract. Телефон один ничего не разрешает.
- Несовпадение IP всегда конфликт. `prov=2`/неизвестный namespace сохраняет строгий contract-conflict v1.7.29.16.

### 1.7.29.16 PBX Hard Guards

- Совпадение телефона считается только подсказкой. Кнопка привязки и POST разрешаются исключительно при точном совпадении договора или IP.
- Несовпадающий договор или IP получает явный статус `conflict`; такой звонок нельзя выбрать, закрепить или отправить.
- Регистрация без закреплённого PBX `callid` через модальное окно Workbench запрещена.
- Перед POST background атомарно помечает звонок как `submitting`, поэтому повторный клик и параллельная вкладка получают блокировку.
- Подтверждённый UserSide результат переводит звонок в `registered` и запрещает повторную регистрацию.
- Неопределённый/оборванный сетевой результат переводит звонок в `review_required`: повтор запрещён, пока оператор не проверит историю UserSide.
- Вся связка `sender tab → Case → customerId → PBX callid → договор/IP` повторно проверяется непосредственно перед штатным `/message/save_call`.
- Ограничения действуют на регистрацию через окно Workbench. Нативная форма UserSide остаётся отдельным механизмом сайта и не подменяется расширением.

### 1.7.29.15 PBX Recent Call Binding

- Отдельный минимальный content script работает только на `https://pbx.simnet.kiev.ua/*` и читает строки завершённых звонков из таблицы `list.php`.
- Уникальным ключом является PBX `callid`/record id вида `1786725676.187490`; одинаковый телефон в нескольких разговорах остаётся несколькими независимыми звонками.
- Сохраняются только метаданные: дата/время, телефон, договор/IP при наличии, ожидание, длительность, очередь, оператор и ссылка `getrec.php?id=...`. Аудиофайл автоматически не запрашивается.
- В форме «Регистрация звонка» появился оранжевый блок `ТЕСТ · БЕЗ POST`: оператор выбирает завершённый разговор и закрепляет его за `caseId + customerId` без регистрации в UserSide.
- Договор и IP считаются сильным совпадением; телефон — только вспомогательным. Если сильных кандидатов несколько, автоматического выбора нет.
- Один PBX-звонок нельзя закрепить за двумя Case. Конфликт блокируется в service worker, а не только интерфейсом.
- Перед настоящим `/message/save_call` service worker повторно сверяет Case вкладки, `customerId` и выбранный PBX `callid`; переход на карточку другого абонента делает старую форму недействительной.
- PBX-снимки ограничены 120 звонками и 48 часами. Обновление идёт только при изменении списка; отдельного сетевого polling и бесконечных запросов нет.
- Старая регистрация без PBX-привязки остаётся доступной, поэтому временная недоступность телефонии не ломает нативную форму UserSide.

### 1.7.29.10 Stateful PON LIVE Flow

- PON workflow не является блокирующим wizard: оператор может уйти в любой раздел, а LIVE всегда восстанавливает ближайший незакрытый шаг из текущего Case.
- До реального ответа ONU статус показывает `ONU не опрошено`; сначала — `Сверить данные`, после проверки Billing — конкретный список недостающих полей.
- Навигация отделена от статуса: `Перейти в технические данные` → при нехватке `Перейти в ТМЦ` → после загрузки UserSide `Показать ТМЦ` → `Обновить технические данные`.
- В Billing Technical реально недостающие обязательные поля подсвечиваются прямо в нативной форме и получают компактный `?` с объяснением.
- `Показать ТМЦ` является явным операторским подтверждением: пассивно найденный TMC-result не перескакивает этот этап. Факт просмотра сохраняется в `case.workflow.ponAcquisition`.
- Возврат из UserSide предпочитает исходную Billing-вкладку через существующий handoff; после нативного сохранения готовность определяется только по перечитанным фактическим полям.
- Когда обязательные поля заполнены, статус становится `Данные готовы для опроса ONU`; `Перейти к опросу` возвращает на Billing и автоматически показывает правильный штатный poll-раздел.
- Намеренно удалён старый best-effort poll при неполных обязательных техданных: для PON недостающие OLT/Serial/MAC сначала восстанавливаются через TMC. EPON сохраняет свою матрицу обязательности без Serial.
- Juniper остаётся read-only LIVE-фактом и доступен оператору, но больше не является обязательным навигационным барьером перед Technical/TMC acquisition.
- После подтверждённого poll LIVE заменяет acquisition-status на фактический результат ONU; raw optics/OLT IP остаются вторым уровнем.

### 1.7.29.8 Floating Plum Dock

- Нет постоянного 64 px rail и нет резервирования ширины CRM.
- `Call / Graph / LIVE` — отдельные floating icon tiles в правом нижнем углу; `More` уменьшена и отделена визуально.
- LIVE и Full открываются поверх CRM как drawer и не меняют геометрию Billing/UserSide.
- Call — centered modal поверх CRM.
- Graph — большой centered workspace.
- Case/context, Guide, Juniper, handoff, locator и диагностическая логика не изменены.

### 1.7.29.6 Автоматический Juniper-снимок

- Первый Billing-контекст абонента сразу запускает `a=252` read-only GET без искусственной задержки.
- Асинхронный ответ закреплён за `Case + episode + requestId`; переход в технические данные больше не делает его устаревшим.
- LIVE получает снимок сразу после ответа, а верхний `juniper.dataStatus` хранит те же данные без состояния `missing` при наличии результата.
- Guide не отправляет оператора в Juniper обязательным шагом. Ручной раздел остаётся доступен для проверки при ошибке.
- Зависшее `loading` автоматически получает новую попытку после 20 секунд; подтверждённый снимок не запрашивается повторно.

> v1.7.29.5 Closed Tab Lifecycle Hotfix. Закрытые вкладки больше не оставляют тяжёлые page-view и зависшие операции; подтверждённые данные абонента остаются в Case.

### 1.7.29.5 Жизненный цикл вкладок

- Закрытие вкладки очищает только её служебные `tabId/documentId/viewsByTab`, не удаляя Case, LIVE, ONU/Juniper, Guide, Appeal и доказательства.
- Pending Poll и незавершённый Juniper привязаны к вкладке-источнику и получают явный `source-tab-closed`, вместо бесконечного ожидания.
- Подтверждённый ONU/OLT snapshot и доступный Juniper сохраняются после закрытия исходной страницы.
- Старые «призрачные» tabId сверяются с реально открытыми вкладками при установке/запуске и очищаются одной сериализованной записью.
- Невалидные Handoff и мёртвые focus-back ссылки удаляются; целевая вкладка, уже принявшая Case, продолжает работу.
- Если закрыта последняя вкладка текущего абонента, сам Case остаётся, а активная вкладочная привязка корректно переносится или очищается.
- Закрытие обычной вкладки Chrome, не связанной с Workbench, не создаёт запись State.
- Настройки показывают число очищенных вкладок, удалённых снимков документов и остановленных операций.

> v1.7.29.4 ONU Time + Manual Poll + Load Hotfix. `DownTime` читается как временная метка, реальный ручной OLT-ответ завершает Guide, а ввод текста больше не создаёт scan/write на каждую букву.

### 1.7.29.4 Точный offline и завершение по факту опроса

- Huawei `UpTime`/`DownTime` — временные метки событий, а не длительности. LIVE отдельно показывает `OFFLINE 1 д 5 ч`, время начала и число событий в окне 7 дней.
- Настоящий ответ текущего коррелированного `PollAttempt` имеет приоритет над порядком Guide: после ручного опроса оператор больше не отправляется назад в Juniper, Технические данные или UserSide.
- Простое открытие poll-вкладки, неверный `a=310/311/312/313`, чужой Case/attempt или ответ без ONU-признаков по-прежнему не завершают маршрут.
- Textarea/свободный текст не сохраняются дословно и фиксируются максимум один раз после выхода из поля; ввод по клавишам больше не запускает контекстный DOM-scan.
- `pageshow`, history/hash и обычное изменение формы проходят signature-dedupe; одинаковые факты с той же уверенностью не переписывают `observedAt` и Case.
- Journal ограничен 120 КБ, а обычная принятая корреляция контекста не дублируется отдельной записью; ошибочные/stale/foreign и operation-корреляции сохраняются для диагностики.
- Скрытые вкладки больше не сканируют DOM и не перерисовывают RAIL на каждую запись State. Они принимают последнее состояние без рендера и один раз синхронизируются при возврате; число подавленных фоновых работ видно в мониторе нагрузки.

> v1.7.29.3 Performance & Cross-System Call Hotfix. RAIL появляется сразу, Juniper стартует без лишней последовательной записи, регистрация звонка работает из Billing, а нагрузка Workbench видна в Настройках.

### 1.7.29.3 Быстрый запуск и контроль нагрузки

- RAIL монтируется до чтения Case/handoff: на UserSide больше нет промежутка, когда видны только Graph и Audit.
- Статус Juniper сохраняется параллельно первому read-only GET; отдельный refresh GET выполняется только если штатная страница предлагает `askjun` и сессия ещё не получена.
- Регистрация звонка из Billing разрешает UserSide Customer ID через штатный `gotouser.php?ip=…`, затем через точный поиск по login/договору, не заставляя оператора сначала открывать UserSide.
- В Настройках появился монитор: DOM-сканы, записи Case/мин, Juniper и call GET/POST, размеры State/Case/журнала, рендер и этапы холодного запуска.
- Старые раздутые подписи журнала мигрируют в короткий hash; DOM остаётся на трёх уровнях, но с меньшими лимитами. Собственные формы Workbench больше не записываются как действия оператора.

### 1.7.29.2 Durable LIVE OLT Snapshot

- MAC, состояние Ethernet, скорость/duplex, оптика и релевантная история сохраняются атомарно вместе с подтверждённым `PollAttempt`;
- после нативного перехода новый content script восстанавливает Case и `pollAttemptId` из точной same-tab попытки ещё до первого `applyContext`, поэтому холодная страница ответа больше не теряет право на запись;
- LIVE восстанавливает эти строки из Case, даже когда исходная страница терминального ответа уже закрыта;
- пустой, ошибочный, timeout-ответ или чужая попытка не могут стереть последний подтверждённый снимок;
- снимок изолирован по абонентскому Case и не переносится на следующего абонента;
- `GCOM`, `G-COM` и `G COM` распознаются одинаково; в названии `...GPON (...) G-COM` явный маркер G-COM выбирает `a=312` и имеет приоритет над общим GPON.

> v1.7.29.1 Poll Result Persistence Hotfix. Реальный поздний ответ OLT исправляет преждевременный timeout, закрепляется в текущем Case и не теряется после возврата по истории Billing.

### 1.7.29.1 Persistent OLT Result

- нативный переход `Запрос OLT` останавливает 12-секундный watchdog до ожидания медленного ответа оборудования;
- если timeout уже успел сохраниться, строго совпавшая страница `act=askolt` с настоящими ONU/OLT-признаками повышает ту же попытку до `CONFIRMED`;
- восстановление требует совпадения `caseId`, `pollAttemptId`, Billing ID, типа опроса и OLT IP; обычное открытие вкладки или наличие команд результатом не считается;
- подтверждённый результат записывается в Case Processor и историю PollAttempt, поэтому `Назад` не возвращает Guide к повторному опросу;
- LIVE больше не показывает одновременно timeout и успешный результат одного запроса.

> v1.7.29 Call Registration + Compact LIVE. В RAIL появилась отдельная кнопка звонка, а LIVE стал коротким отпечатком текущего абонента: статус Juniper, IP, MAC, трафик и время — без прежнего cockpit-интерфейса.

### 1.7.29 Native UserSide Call Registration

- отдельная кнопка `☎ Регистрация звонка` доступна в RAIL при активном кейсе с `customerId`;
- форма каждый раз загружается из `/message/tab?section=call&customer_id=...`, поэтому `_csrf`, служебные поля и варианты типового комментария не копируются в код;
- Workbench сохраняет все hidden-поля штатной формы, синхронизирует `standart_comment`, `comment`, `dopf_13` и отправляет обычный form-urlencoded POST на `/message/save_call`;
- мост service worker ограничен двумя маршрутами UserSide и позволяет использовать действие как из Billing, так и из UserSide;
- `HTTP 200` сам по себе не считается успехом: зелёный результат появляется только при подтверждённом redirect/сообщении UserSide; повторно возвращённая форма считается ошибкой валидации;
- при смене активного абонента загруженная форма становится недействительной и не может быть отправлена в чужой Case;
- в журнал пишется только факт регистрации и типовой комментарий — телефон, текст комментария и CSRF не сохраняются;
- LIVE больше не показывает cockpit, проценты и четыре вкладки Juniper: один компактный снимок сразу отвечает, есть ли сессия и трафик, какие IP/MAC и время видит Juniper;
- состояние линии сведено в одну строку; для PON итог остаётся открытым до настоящего ответа ONU/Link;
- Guide сохраняет объяснения и ведение по следующему действию; Case Processor, Locator, Poll, Data Audit и Graph Studio логически не изменялись.

> v1.7.28 Graph Studio. Граф обращений теперь редактируется в отдельном модуле: черновик, проверка связей, условия переходов и безопасная публикация версии, которую читает Appeals Navigator.

### 1.7.28 Graph Studio / Editable Appeals Knowledge

- кнопка `Graph` открывает отдельное изменяемое рабочее пространство;
- слева выбирается тип обращения, в центре видны узлы и связи, справа редактируются свойства;
- поддерживаются вопросы, ответы, результаты, простые объяснения и следующие действия;
- условия ответа используют только факты текущего кейса и не подменяют техническое доказательство;
- черновик можно сохранить с ошибками, но публикация требует конечного ациклического маршрута;
- новая публикация применяется к новым обращениям, уже начатые остаются на прежней версии;
- JSON импорт/экспорт и история публикаций позволяют переносить и восстанавливать граф;
- Data Audit и Graph Studio остаются отдельными модулями.

### 1.7.27 Appeals Navigator / Guided Question Graph

- оператор выбирает тип обращения: низкая скорость, нет интернета, обрывы, Wi‑Fi или недоступные сайты;
- полный граф не рисуется целиком: сверху видны пять смысловых этапов, в центре — один текущий вопрос и 2–3 ответа;
- под каждым ответом указано, какую ветку он откроет дальше;
- история ответов сохраняется в case и не переносится между абонентами/вкладками;
- итог называется рабочей гипотезой и всегда содержит следующий проверочный шаг;
- вопросный маршрут не подменяет сетевую диагностику: внизу того же экрана виден прежний LIVE-маршрут Juniper → PON/Ethernet;
- можно вернуться на предыдущий вопрос, сменить тип обращения, открыть LIVE либо вызвать следующую подсказку;
- существующие Operator Cockpit, Focus Layer, Case Processor и диагностическая policy v1.7.26 сохранены.

### 1.7.26 Operator Cockpit / Focus Layer

- LIVE показывает карту маршрута отдельно для PON и Ethernet, текущий этап и короткий человеческий смысл следующего действия;
- раздел «Факты» переименован в «Абонент», при этом schema/state и диагностическая policy не изменены;
- карточка Juniper разделена на `Статус / Трафик / IP–MAC / Время` и использует уже собранные read-only данные a=252;
- Juniper всегда сохраняет границу вывода: online подтверждает интернет-сессию, но не качество линии, PON/Ethernet или Wi‑Fi;
- Focus Layer использует синий маркер `1 · Сейчас`, до трёх спокойных связанных маркеров и лёгкое неблокирующее приглушение вокруг цели;
- на Juniper подсвечивается смысловая строка статуса, а BRAS/привязка, трафик и время показываются отдельными связанными полями, если DOM позволяет;
- анимация остаётся однократной; native click/navigation Billing и UserSide не перехватываются;
- Case Processor, correlation guards, Poll lifecycle и маршруты v1.7.25 не менялись.

### 1.7.25 Ethernet Access Route / Twisted Pair

- тип Ethernet утверждается только при совпадении абонента, Ethernet-интерфейсе и известном порте коммутатора;
- маршрут: `Juniper → Технические данные → Точка подключения → Коммутатор → FDB → Ошибки порта → Сводка`;
- FDB подтверждает MAC, интерфейс и VLAN; отдельная страница списка VLAN не является обязательной;
- отсутствие целевого порта в снимке ошибок трактуется как «зарегистрированных ошибок в этом снимке нет», а не как вечная гарантия;
- ONU/OLT и PON-поля не показываются как недостающие для прямого Ethernet;
- PON/EPON/GPON и все защитные механизмы v1.7.24 сохранены.

### 1.7.24 Poll Recovery / Guided UX

- Poll проверяет неизменность целевой ссылки и её привязку к текущему абоненту вместо ожидания полной неподвижности страницы;
- Guide больше не может отменить уже разрешённый нативный переход «Запрос OLT»;
- отменённый/неоткрывшийся запрос освобождается через 12 секунд, зависшая попытка — через 90 секунд;
- `pollAttemptId` не переносится в события другого абонента;
- Juniper preview определяет UTF-8/Windows-1251 и не превращает кириллицу в `����`;
- LIVE показывает человеческие названия этапов, заметное состояние живого опроса и умеренные пояснения «Простыми словами»;
- основное действие всегда остаётся первым: пояснение помогает новичку, но не перегружает рабочий маршрут.

### 1.7.23 Case Processor / Correlation Hardening

- единый event envelope и correlation verdict в Journal;
- `episodeId`, `caseVersion`, `routeGeneration` с миграцией старых кейсов;
- один queued commit в background и централизованные invariants;
- pinned Juniper prefetch без повторного выбора кейса через активную вкладку;
- `viewsByTab[tabId][documentId]` вместо одного глобального page context;
- `sender.documentId`, `pageInstanceId` и `scanGeneration/latest-wins` для stale DOM;
- PollAttempt lifecycle и pending-lock вместо 30-секундного ожидания;
- `juniper.dataStatus` отделён от обязательного `juniper.reviewStatus`.

### 1.7.22 Juniper Guided First / fast UI

Новый старт маршрута:

```text
Billing subscriber
→ Juniper (NEW) read-only
→ Технические данные
→ TMC / fallback / poll по прежним правилам
```

Juniper используется как информативный L3-снимок: online/offline, BRAS, session, IP/MAC, start time, текущий обмен, last event, VLAN. Он не заменяет PON-проверку и не имеет права сам менять OLT/ONU маршрут. Если a=252 пуст, разрешён один `act=askjun`; `coasync`/`coadisconnect` запрещены для автоматического вызова.

### 1.7.20 Stability Core / Route Controller

- `on_route / supporting / off_route / foreign` классификация до merge фактов.
- Off-route Huawei/GPON/GCOM/TMC/MAC/device evidence не переписывает текущий обязательный шаг.
- Ask OLT: 30-секундный single-flight, double/triple-click guard, click ≠ complete.
- `POLL COMPLETE` требует реальный `act=askolt`, ожидаемый adapter, стабильный DOM и технический ответ.
- Guide ACTION записывается после стабильного click, а не на pointerdown.
- Main MutationObserver игнорирует собственный DOM Workbench; scans сериализованы.
- Журнал: `ROUTE GUARD` и `INTERACTION GUARD` + прежний подробный operator trace.

> v1.7.19 Operator Trace Journal. В журнал кейса добавлена подробная запись действий оператора: клики/двойные клики, выделение текста, переходы/возвраты, изменения полей, submit, hover и прокрутка. Для клика сохраняется смысл, URL/GET-контекст, CSS path и HTML цели + 2 родительских уровней. Значения password/token/session защищаются.

### 1.7.19 Operator Trace Journal

- Пишет реальные действия на страницах Billing/UserSide в активный кейс, но не журналирует собственную панель Workbench.
- CLICK хранит raw target, semantic target, координаты, clickCount, модификаторы, section, переход и DOM: target + parent + grandparent.
- SELECT хранит точный Range DOM-фрагмент и границы выделения.
- NAVIGATE/RETURN различают обычный переход и browser back/forward, где это сообщает Navigation Timing/popstate.
- CHANGE/SUBMIT фиксируют подтверждённое изменение поля/формы; password/token/session значения редактируются как protected.
- HOVER записывается только после 650 мс dwell на интерактивной цели, SCROLL — после остановки и только при заметном смещении, чтобы журнал не превращался в шум.
- Смысловая подсказка строится детерминированно из текста/HTML/section/href/URL и GET-маршрута (dopdata, gotouser, machistory, OLT actions), без AI.
- В rail-журнале показывается компактный смысл/цель/переход/DOM path; полный HTML остаётся в JSON экспорте кейса.
- Старые Guard Rails v1.7.18 сохранены без изменения маршрутной логики в этой сборке.

### 1.7.18 Guard Rails

- **Route guard:** после неудачного/неполного best-effort poll Workbench идёт в ТМЦ раньше MAC-history/оборудования. Если оператор сам открыл MAC раньше, факт сохраняется passive и не двигает NEXT.
- **UI-ready guard:** Guide ждёт готовый документ и стабильную видимую цель. Пока DOM перестраивается, рамка/карточка не создаётся; устаревшие async-запросы подсказки ничего не дорисовывают.
- **Action lock:** быстрые повторные «Получить подсказку» не запускают конкурирующие Guide-запросы; чувствительный `Запрос OLT` защищён от случайного double click.
- **Poll lifecycle:** нажатие/переход = только request. `POLL COMPLETE` возникает лишь после реального технического ответа ONU/OLT, связанного с фактически запущенным poll. Простое открытие вкладки, `Ждите...`, наличие команд или CLI-ошибки не завершают Guide.
- **Adapter guard:** если маршрут знает правильный poll type, вывод другой вкладки помечается passive/off-route и не может закрыть диагностику.
- **Response guard:** `Invalid input`, `unknown command`, syntax/parameter errors, `ONU/ONT not found` не считаются ответом ONU. Реальный ONLINE/OFFLINE/LOS/оптика/порт/MAC/ONT state — считается.
- **Technology resolution:** интерфейс PON сильнее названия шасси. `Huawei MA5800` с `EPON ...` в ТМЦ ведёт в action 310 (EPON), а не автоматически в Huawei 313.
- После валидного ответа действует прежний terminal latch: FINISHED необратим в рамках текущего диагностического эпизода.

### 1.7.17 Guide memory / non-linear safety

- После завершённого диагностического Guide реально пройденные semantic targets сохраняются как опыт оператора. На следующих абонентах они получают только тонкую спокойную отметку; это не новый diagnostic state.
- Если оператор открыл ТМЦ/MAC/оборудование вне текущего шага, наблюдение сохраняется как passive evidence и не меняет NEXT/progress. При повторном посещении, когда этот источник действительно нужен маршруту, тот же факт продвигается в active evidence без дубля.
- Самостоятельный штатный опрос остаётся сильнее Guide: любой реальный технический ответ ONU/OLT завершает Guide, даже если оператор не следовал подсказке.
- ONU MAC — обязательный минимум для попытки PON-опроса. Если тип опроса уже известен, Workbench позволяет один best-effort poll при пустой OLT и/или S/N; ошибка ведёт в ТМЦ, затем при необходимости в MAC → оборудование/порт.

### 1.7.15 Poll complete ≠ identity match

- Реальный технический ответ ONU/ONT завершает штатный опрос независимо от совпадения MAC, S/N или клиентской привязки.
- Несовпадение идентификаторов остаётся отдельным фактом Terminal Interpretation и не запускает новый TMC/MAC круг.
- PENDING действует только до появления ответа оборудования; ONLINE/OFFLINE — состояние ONU, а не критерий успешности самого запроса.
- Общие слова страницы Billing вроде IPTV `Online` не считаются ответом ONU.
- После POLL COMPLETE диагностический маршрут защёлкивается; поздние события из других вкладок не возвращают Guide в polling/searching.

Current Guide patch: the diagnostic route is finite and interruption-safe. Passive observations are cached separately from Guide completion, `confirmed` is a one-way terminal latch, provisional poll output stabilizes before fallback, and the LIVE rail switches to a final result view after successful diagnosis.

### 1.7.14 Finite route / terminal latch / passive evidence

- A page merely being opened or parsed does not complete a Guide step. Passive evidence is cached; when the route later reaches that step it may resolve as `already_satisfied` without forcing the operator to repeat the action.
- `POLL_RESULT = confirmed` locks the current diagnostic episode. Later UserSide/MAC/equipment navigation remains passive context and cannot reopen `searching`, `candidate_found` or `wait_context`.
- Existing v1.7.13 cases with durable `direct_confirmed` history automatically recover the terminal latch after update.
- Fresh `partial` poll output waits 3 seconds for terminal stabilization before any fallback. If it grows into `confirmed`, the route ends without a needless TMC detour.
- 100% and the quiet route trail require an explicit terminal state.
- EPON uses OLT + ONU MAC as the route requirement; Serial found in TMC remains supplemental and is not forced into Billing.
- Billing Save verification accepts the actual matching OLT/IP even when the candidate's `expectedTechnical` object is empty.
- UserSide `gotouser.php` navigation links are not IP evidence; repeated identical conflicts are deduplicated and GPON parent/ONT interface forms are treated hierarchically.
- Poll identity matching uses parsed terminal output only. Values present only in command arguments/profile rows cannot confirm MAC/Serial.
- The LIVE rail shows a dedicated `Диагностика завершена / CONFIRMED` result instead of a contradictory ready/searching/waiting state.

### 1.7.12 Field-aware Guide and evidence trail

- Billing technical data shows separate status and purpose for connection type, subscriber/device MAC, OLT, ONU MAC and ONU S/N.
- EPON treats ONU MAC as the primary ONU identifier; GPON/GCOM/Huawei treat ONU S/N as primary.
- Subscriber/device MAC is explained as the independent fallback trace to interface and UPLINK/DOWNLINK.
- The operator explicitly confirms that technical fields were reviewed before Guide leaves for TMC or ONU poll.
- UserSide MAC highlight covers the complete `.table_block`, not the magnifier icon.
- MAC/OLT evidence overlays are stable across background recommendation changes and close only on a real action, dismissal, navigation or detached target.
- Missing OLT IP exposes `Открыть OLT и посмотреть IP`; known IP exposes `Вернуться к абоненту`.
- Reviewed TMC, MAC and Billing field evidence leaves a low-noise visual trace for the active subscriber case.

### 1.7.11 Evidence-first result view

- The whole MAC and Ethernet blocks are visually stronger than ONU/optics/service context.
- Compact results are explicit: `✓ MAC ИЗУЧЕН · СОВПАДАЕТ`, `✓ LINK UP · 1 Гбит/с · Full-Duplex`, or a `!` warning for missing/conflicting/down evidence.
- Fresh repeated history is emphasized; old or isolated events remain readable context.
- The side rail shows MAC, Ethernet and relevant history in the same evidence order.

### 1.7.10 Stable terminal handoff / detached-node guard

- Terminal DOM immediately overrides a stale `billing.ask-olt` recommendation.
- Replaced Billing nodes are re-resolved or safely rejected before Guide uses them.
- A partial legacy DOM mutation no longer aborts interpretation of the remaining output.
- DevTools Console shows filterable important events under `[SIMNET WB]` for BOOT,
  CONTEXT, GUIDE, TERMINAL and LOCATOR without logging every DOM scan.

### 1.7.9 Live terminal handoff / strict Guide actions

- Continuous Billing DOM changes cannot indefinitely postpone Workbench scanning; a pending result is processed within a bounded interval.
- Real BDCOM GPON output is segmented from one flat `<font>` stream at command and `<hr>` boundaries.
- Terminal Interpretation updates the rail directly when output appears; `Перечитать страницу` is no longer needed for the result handoff.
- Guide highlights explain and outline real page controls. They do not add a duplicate `Перейти` action for `Запрос OLT`; the operator clicks the highlighted Billing control.
- Utility navigation remains only for an actual page/system transition or returning to a subscriber card.
- Terminal relation and health are independent axes, so `DEPENDENT`/`CONTEXT` are not treated as extra faults.

### 1.7.7 MAC-result Guide safety

UserSide MAC hints use semantic row-sized highlights. MAC-history equipment links remain manual operator choices, and the Workbench utility action returns to the subscriber card instead of opening equipment.

### 1.7.6 Multi-adapter terminal interpretation

After ONU poll output appears, Workbench automatically recognizes vendor-specific command blocks for Huawei, GCOM, BDCOM GPON and BDCOM EPON, maps them into common semantic blocks (ONU / PON optics / ETH / MAC / service / traffic), and applies monochrome state-aware emphasis. Guide routing to TMC, device MAC and UPLINK/DOWNLINK is unchanged.

### 1.7.5 Guide / terminal separation

Operational Guide and terminal-result help are now separate subsystems. Guide still leads through Billing → TMC → device MAC → UPLINK/DOWNLINK and correction/retry routes, but its current episode ends on the real `Запрос OLT` click. Terminal output is read-only semantic markup only: no «Проверь Ethernet», no «Перейти», no terminal Guide target, and no re-poll action. An incomplete poll may later start a new operational Guide step such as TMC or MAC fallback.

### 1.7.4 hard-passive terminal result view

- Detects real ONU terminal output before semantic wrappers are created.
- Immediately closes any stale Guide overlay / poll CTA when output appears.
- All detected command/output blocks are marked together.
- Monochrome hierarchy only: grayscale depth + border weight; attention state is darker, not colorful.
- A visible terminal result never becomes a clickable navigation target.
- Optical summary now includes temperature when present.

### 1.7.3 passive terminal result view

After ONU poll output appears, Workbench does not create a new Guide step over the terminal. All recognized command/output sections are marked together in a quiet monochrome map with compact extracted values. No «Перейти» CTA, no dimming overlay, and no terminal action can trigger another poll.

### 1.7.2 terminal UX
Terminal command blocks are informational evidence, not navigation. They use subtle monochrome segmentation and compact value summaries; no modal overlay or “Перейти” button is shown for terminal output.

## 1.7.0 terminal semantics

On Billing ONU poll pages Workbench groups terminal output by the command that produced it. The markup is intentionally monochrome and non-animated. Each block receives an importance/meaning label and can be reused as a Guide anchor; the original terminal output remains visible and copyable.

# SIMNET Workbench

> v1.7.15 poll semantics: если ONU/ONT вернула технический ответ, опрос считается выполненным. Совпадение MAC/S/N — отдельная сверка, а не условие успешности опроса. v1.5.3

Chrome MV3 LIVE-помощник оператора для Billing и UserSide.

## Текущая версия v1.5.3

- Если в ТМЦ обнаружено имя или IP OLT, Workbench сразу показывает «OLT найдена в ТМЦ».
- В информационный блок дополнительно подхватываются ONU Serial и ONU MAC, но они не блокируют найденную OLT.
- Кнопки «Подсветить» и «Вернуться в Billing» доступны одновременно.
- Боковая панель раскрывается при наведении на раздел rail и скрывается после ухода курсора.


## Главное изменение

Диагностика больше не представлена одним линейным сценарием. В сборке добавлен **Subscriber Locator** — движок поиска фактического подключения абонента.

Нажатие `Запрос OLT` завершает только действие. После получения ответа Workbench классифицирует результат и решает, закончена ли диагностика или требуется следующая ветка.

## Архитектура маршрута

```text
Billing/UserSide adapters
        ↓
структурированные наблюдения
        ↓
Subscriber Locator policy-engine
        ↓
гипотезы · кандидаты · попытки · доказательства
        ↓
следующее действие или терминальный результат
        ↓
RAIL + опциональный Guide Mode
```

Парсеры не выбирают маршрут. Они сообщают факты и результаты. Решения находятся в отдельном наборе правил `src/core/locator-policy.js`.

## Поддерживаемые результаты OLT-опроса

- `confirmed` — абонент подтверждён прямым опросом;
- `not_found` — текущая связка OLT + ONU не подтверждена;
- `pending` — опрос ещё выполняется;
- `timeout` — результата нет, отсутствие ONU не доказано;
- `olt_unreachable` — OLT недоступна;
- `parser_error` — Workbench не распознал страницу;
- `conflict` — найдены несовпадающие идентификаторы;
- `partial` — есть часть доказательств;
- `unknown` — результата недостаточно для вывода.

`not_found` отвергает только конкретную связку OLT + ONU/интерфейс. Сама OLT не блокируется навсегда и может быть повторно проверена с другими идентификаторами.

## Реализованные ветки поиска

```text
Технические данные Billing
  ├─ положительный прямой опрос → confirmed
  ├─ ONU не найдена
  │    └─ UserSide → ТМЦ
  │         ├─ OLT найдена → внести в Billing → проверить сохранение → повторный опрос
  │         └─ ТМЦ отсутствует → MAC history
  │              ├─ кандидат найден → интерфейс → карточка оборудования
  │              └─ прямой поиск пуст → UPLINK/DOWNLINK
  ├─ timeout / OLT недоступна → один повтор → альтернативные источники
  ├─ конфликт → inconclusive
  └─ ошибка парсера → manual_review
```

## Варианты завершения

- `confirmed` — абонент подтверждён прямым опросом найденной OLT;
- `not_found` — доступные автоматизированные ветки исчерпаны;
- `inconclusive` — данные противоречат друг другу;
- `blocked` — необходимые источники или оборудование недоступны;
- `manual_review` — нужна ручная проверка или NOC.

Прогресс `100%` выставляется только после терминального результата, а не после клика по кнопке опроса.

## Billing → UserSide handoff

Handoff остаётся обязательным:

- UserSide-контекст присоединяется к исходному Billing-кейсу;
- сохраняются `caseId`, исходная вкладка, IP, логин, договор и Billing ID;
- добавляется Customer ID;
- используется одноразовый token с TTL;
- маршрут Subscriber Locator сохраняется при переходе;
- можно вернуться в исходную вкладку Billing.

## Проверка сохранения OLT

Клик `Сохранить` считается только намерением. Workbench подтверждает сохранение после загрузки нового документа и повторного чтения выбранной OLT.

```text
save click
→ BILLING_OLT_SAVE_INTENT
→ новая страница
→ повторное чтение OLT
→ BILLING_OLT_SAVED или BILLING_OLT_SAVE_FAILED
```

Это работает независимо от Guide Mode.

## Guide Mode

Кнопка `Подсветить` визуально показывает действие, уже выбранное policy-engine:

- Технические данные;
- USERSIDE;
- ТМЦ;
- поиск по MAC;
- UPLINK/DOWNLINK;
- найденный интерфейс;
- карточку оборудования;
- поле OLT и `Сохранить`;
- нужную вкладку опроса;
- `Запрос OLT`.

Guide Mode не выполняет автоматических кликов и не является источником диагностических решений.

## Безопасные ограничения

- нет `<all_urls>`;
- разрешение расширения: только `storage`;
- работа ограничена внутренними доменами SIMNET/LOOKNET;
- нет внешней отправки данных;
- нет автоматического `reboot ONU`;
- нет автоматического изменения CRM;
- позиционные `nth-child`/`nth-of-type` не используются как основа Guide Mode.


## Guide Mode v1.5.3

- Карточка всегда остаётся слева от полноэкранной правой рейки и не перекрывает её.
- Затемнение стабильно: пульсирует только рамка цели, а не вся страница.
- Закрытие выполняется крестиком, `Esc` или кликом по затемнённой области.
- Повторный вызов уже открытой подсказки не пересоздаёт её.
- Кнопка **Перейти** работает по исходной подсвеченной ссылке; для UserSide сохраняется обязательный handoff.
- Рейка занимает всю высоту окна, имеет ширину 56 px и увеличенные иконки.

## Установка и обновление

Первичная установка остаётся стандартной для распакованного MV3: распаковать ZIP, открыть `chrome://extensions`, включить режим разработчика, выбрать **«Загрузить распакованное расширение»** и указать папку, где `manifest.json` находится в корне.

Начиная с **v1.7.29.23**, дальнейшие обновления можно выполнять из самой оболочки: иконка **SIMNET Workbench** → **«Обновить Workbench»**. Один раз привязывается текущая рабочая папка, затем для следующих версий достаточно выбрать новый ZIP. Updater проверяет архив, создаёт runtime-backup, пишет `manifest.json` последним и перезапускает расширение. Автоперезагрузка открытых рабочих вкладок выключена по умолчанию, чтобы не потерять несохранённые данные.

Подробный порядок: `INSTALL-UPDATE.txt`.

Store v4 мигрируется в Store v5.


### TMC в v1.4.2

Если в блоке «Найдено на OLT» извлечены имя или IP OLT, Workbench сразу показывает OLT как найденную. ONU Serial и ONU MAC отображаются рядом как дополнительные данные и не блокируют кнопку возврата в Billing. Кнопки «Подсветить» и «Вернуться в Billing» доступны одновременно.

## Contextual microlearning

Version 1.5.0 introduces a separate static knowledge base. A route identifies the next target, while the knowledge base supplies the reusable explanation. The Guide tooltip contains four layers: title, what the element is, why it matters, and the current action. New routes can reuse existing concepts without copying explanation text.
## Quick next hint

Version 1.5.1 added a permanent target button to the collapsed right rail. It runs the action currently selected by the Guide policy without opening the drawer.

## Persistent Guide and resumable route

Version 1.5.3 keeps a visual hint open until the operator clicks anywhere. The exact target remains isolated from the dimmed page. A TMC hint can show **Вернуться в Billing** directly inside the tooltip. While the hint is active, rail hover does not expand the drawer; an explicit rail click closes the hint and opens the selected section.

The current subscriber case is also retained during temporary detours to payments, lists, or other neutral Billing/UserSide pages. The policy resumes from `route.resume` and the facts already collected instead of restarting from technical data. Opening technical data manually only refreshes facts; it does not auto-click or force the Guide overlay.

### Data Audit 1.6.7: OLT-first readiness check

The main audit route treats Billing, UserSide/TMC and the future equipment MAC search as an evidence cascade. The current build automates Billing → TMC. It uses TMC to confirm the factual OLT and at the same time verify/recover ONU S/N and ONU MAC. When TMC is unavailable or insufficient, the result records `search_mac` as the next action when a usable MAC exists; automatic equipment traversal remains intentionally disabled until its endpoints are recorded and validated.
