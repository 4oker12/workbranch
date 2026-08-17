# Тест-чеклист v1.7.12

При расхождении сохраняйте URL, текущий action Locator, источник факта и фактический текст CRM.

## Billing — карточка

- [ ] `a=user&id=...` определяется как `billing_user`
- [ ] Billing ID совпадает с URL
- [ ] IP берётся из штатного перехода UserSide
- [ ] кнопка `Подсветить` находит «Технические данные»
- [ ] клик `USERSIDE` создаёт handoff

## Billing — технические данные

- [ ] `a=dopdata&id=...` определяется как `billing_technical`
- [ ] тип подключения хранится отдельно от типа OLT
- [ ] MAC абонента не смешан с ONU MAC
- [ ] Serial ONU нормализован
- [ ] выбранная OLT и OLT IP прочитаны из `dopfield_29`
- [ ] Huawei всегда даёт `a=313`
- [ ] клик `Сохранить` создаёт только save intent
- [ ] после новой страницы OLT перечитывается и подтверждается
- [ ] до подтверждения сохранения candidate poll не готов
- [ ] Guide подсвечивает строки полей отдельно и показывает статус `заполнено / отсутствует / конфликт / условно`
- [ ] у каждого поля показано назначение для текущей технологии
- [ ] EPON требует ONU MAC; GPON/GCOM/Huawei требует ONU S/N
- [ ] MAC устройства абонента объяснён как резервный след для MAC/UPLINK/DOWNLINK-поиска

## OLT poll

- [ ] открытая вкладка сама не подтверждает технологию
- [ ] `pending` не завершает сценарий
- [ ] `not_found` отклоняет только текущий binding
- [ ] `timeout` не считается отсутствием ONU
- [ ] `olt_unreachable` не считается отсутствием ONU
- [ ] `parser_error` приводит к manual review
- [ ] `conflict` приводит к inconclusive
- [ ] только `confirmed` завершает поиск успешно

## UserSide / handoff

- [ ] `/customer/{id}` присоединён к исходному Billing-кейсу
- [ ] `usersideVisited=true` в том же кейсе
- [ ] отсутствие ТМЦ зафиксировано как `TMC_RESULT: missing`
- [ ] найденная ТМЦ создаёт кандидата, но не прямое подтверждение
- [ ] MAC с карточки передаётся в direct search
- [ ] пустой direct search предлагает UPLINK/DOWNLINK
- [ ] кандидат подтверждается на конкретном interface MAC list
- [ ] карточка оборудования даёт OLT IP и poll action

## Терминальные исходы

- [ ] `confirmed` — прямой опрос совпал
- [ ] `not_found` — TMC/direct/topology исчерпаны
- [ ] `inconclusive` — конфликт идентификаторов
- [ ] `blocked` — источники недоступны
- [ ] `manual_review` — автоматическая интерпретация невозможна
- [ ] только терминальный результат даёт 100%

## Guide Mode

- [ ] работает только по нажатию
- [ ] не выполняет автоматические клики
- [ ] не использует `nth-child`/`nth-of-type` как основу
- [ ] не подсвечивает reboot
- [ ] core workflow продолжает работать при выключенном Guide Mode

## v1.7.12 — поля, MAC-результат и следы проверки

1. Открыть Billing → «Технические данные» и вызвать следующую подсказку.
2. Убедиться, что карточка перечисляет тип подключения, MAC устройства, OLT, ONU S/N и ONU MAC с отдельными статусами и назначением.
3. В EPON-кейсе проверить, что ONU MAC обязательный, а ONU S/N дополнительный; в GPON/GCOM/Huawei — наоборот.
4. После ручного подтверждения полей должны остаться спокойные метки уже просмотренных строк.
5. В UserSide выполнить поиск MAC: рамка должна охватывать весь блок IP + MAC + поиск + информация + время, а не одну иконку.
6. После найденного MAC нажать «Следующая подсказка» и создать фоновое изменение состояния: окно остаётся открытым.
7. Если у кандидата нет IP OLT, доступна только кнопка «Открыть OLT и посмотреть IP»; переход выполняется лишь после клика.
8. Если IP OLT уже есть, доступна кнопка «Вернуться к абоненту» и лишний переход на OLT не предлагается.
9. Вернуться на ранее проверенную страницу текущего абонента: спокойные метки доказательств восстанавливаются.
10. Открыть другого абонента: следы предыдущего кейса не переносятся.

## v1.4.2 — ТМЦ, двойное действие и hover-panel

1. Открыть кейс, где в UserSide есть блок «Найдено на OLT».
2. Убедиться, что панель сразу показывает «OLT найдена в ТМЦ», имя OLT и IP.
3. При наличии Serial и ONU MAC убедиться, что они отображаются дополнительными строками.
4. Убедиться, что одновременно доступны «Подсветить» и «Вернуться в Billing».
5. Нажать «Подсветить»: рамка должна охватить блок с надписью «Найдено на OLT», именем и IP.
6. Проверить кейс с несовпадающим или отсутствующим Serial/MAC: OLT всё равно остаётся найденной, возврат в Billing доступен.
7. Навести курсор на LIVE/Факты/Журнал/Настройки: соответствующая панель раскрывается.
8. Увести курсор за пределы rail/drawer: панель скрывается примерно через 180 мс.

## v1.5.3 — постоянная подсказка и возобновление маршрута

1. На карточке Billing вызвать быструю подсказку «Технические данные».
2. Убедиться, что подсказка не исчезает сама через 12 секунд или дольше.
3. Кликнуть в свободном месте страницы: подсказка должна закрыться.
4. Повторить подсказку и навести курсор на LIVE/Факты/Журнал: drawer не должен раскрываться.
5. Во время подсказки кликнуть по разделу панели: подсказка закрывается, выбранный раздел открывается.
6. В UserSide при найденной ТМЦ вызвать подсветку:
   - затемняется фон;
   - светлым остаётся точный блок OLT/IP/ONU Serial/ONU MAC/Interface;
   - в карточке есть «Вернуться в Billing».
7. Нажать «Вернуться в Billing»: должна активироваться исходная вкладка Billing текущего кейса.
8. После технических данных перейти в «Платежи» или другой нейтральный раздел, затем вызвать следующую подсказку.
9. Убедиться, что Workbench продолжает незавершённый шаг, а не предлагает начинать с технических данных заново.
10. Открыть карточку другого абонента: новый идентифицированный абонент не должен наследовать маршрут предыдущего кейса.

11. После положительного Huawei-опроса вызвать следующую подсказку.
12. Guide должен показать терминальное состояние «ONU подтверждена» и НЕ требовать проверки Ethernet-порта только из-за наличия `display ont port state`. Сами command/output-блоки при этом остаются размеченными на странице.


## v1.5.3 — визуальный Guide

1. Открыть подсказку у элемента возле правого края: карточка полностью находится левее рейки.
2. Убедиться, что затемнение не меняет яркость во время трёх импульсов рамки.
3. Закрыть подсказку крестиком, `Esc` и кликом по затемнённой области.
4. Повторно нажать быструю кнопку при открытой подсказке: overlay не должен исчезать и появляться заново.
5. На ссылках «Технические данные», `HUAWEI OLT` и `Запрос OLT` нажать «Перейти»: должна использоваться подсвеченная ссылка.
6. На переходе `USERSIDE` проверить сохранение handoff и открытие карточки того же кейса.
7. Проверить, что рейка занимает всю высоту окна при разных масштабах браузера.

## v1.6.9 — Guide ACTION / RESULT evidence

- [ ] A. Highlight a navigation target. Clicking/pointer-down records ACTION, but does not mark the step complete while the old page remains open.
- [ ] B. After the expected destination page is actually observed, the step becomes completed and journal contains CONTEXT/EVIDENCE + STEP DONE.
- [ ] C. On UserSide TMC, background data remains latent before the TMC route step is activated; after the operator reaches the TMC step, the existing parsed snapshot may confirm it without another request.
- [ ] D. Editing OLT/S/N/ONU MAC records an ACTION on field input/change; the edit step completes only when the expected field value is observed.
- [ ] E. Clicking Save records ACTION only. Completion occurs only after the new Billing document confirms the required fields. A mismatch yields RESULT FAILED.
- [ ] F. Clicking ask OLT records ACTION only. Pending/unknown output does not complete the step; a terminal poll outcome does.
- [ ] G. MAC direct search, UPLINK/DOWNLINK, interface and device routes complete only after their corresponding parsed evidence is observed.
- [ ] H. Journal sequence is readable as HINT → ACTION → CONTEXT/EVIDENCE → STEP DONE → NEXT; no extra flashing/automatic clicking is introduced.

Comments:

Result: [ ] matches  [ ] partial  [ ] does not match

## v1.7.0 — ONU poll terminal blocks

- [ ] Huawei poll output is divided by command, not by arbitrary DOM parents.
- [ ] No flashing/multicolor terminal decoration; only grayscale tiers.
- [ ] `display ont info by-sn` is marked as key ONU state/identity.
- [ ] `display ont port state ... eth-port all` is marked as key Ethernet-link state.
- [ ] `display mac-address ...` is marked as important device-MAC evidence.
- [ ] `display service-port ...` is marked as supplementary service/VLAN evidence.
- [ ] Hovering a block explains what to look at without replacing the original terminal output.
- [ ] Terminal blocks never become Guide targets or navigation actions.
- [ ] Poll parsing recognizes XPON serial alias, subscriber MAC and full GPON interface from the recorded Huawei output.


## v1.7.8 — evidence-aware terminal state matrix

- [ ] GCOM: MAC row may remain visible while `brief/info` says ONU offline; Workbench marks MAC as context, not current link proof.
- [ ] GCOM: optics / port-state errors caused by offline ONU are marked dependent, not as additional independent faults.
- [ ] GCOM: when the same ONU later becomes online, per-ONU optics and Ethernet state return to normal live evidence.
- [ ] Huawei: `display ont register-info` is recognized as lifecycle history and distinguishes power events from optical-loss events.
- [ ] BDCOM GPON: `uni-port ... up` + `1Gbps Full-Duplex` is parsed as ETH UP / 1000 / full.
- [ ] BDCOM GPON: empty `active-onu` result is interpreted as current offline evidence.
- [ ] BDCOM EPON: active ONU row exposes current online state, distance, alive time and last deregistration reason.
- [ ] LOS / LOSI / wire-down may raise attention; a few dying-gasp / POWER_OFF events do not create an automatic alarm.
- [ ] Port-wide GCOM optical table is reference context; subscriber-specific optics is the diagnostic signal block.
- [ ] Terminal view remains passive: no Guide CTA, navigation or repeat poll is generated from these interpretations.

Comments:

Result: [ ] matches  [ ] partial  [ ] does not match

## v1.7.9 — live result handoff and Guide action boundary

- [ ] On the real BDCOM GPON flat output, all eight command/result ranges receive inline semantic markup.
- [ ] After clicking the native highlighted `Запрос OLT`, Guide closes and no duplicate `Перейти` button is shown.
- [ ] When the terminal result appears, the rail changes to `Сверить результаты` without browser refresh or `Перечитать страницу`.
- [ ] Frequent unrelated page mutations do not postpone interpretation for more than approximately one second.
- [ ] `PRIMARY / DEPENDENT / CONTEXT / CONFLICT` is visible independently from `normal / attention / neutral`.
- [ ] Terminal result processing performs no reload, fetch/XHR, command execution, automatic click or navigation.

Comments:

Result: [ ] matches  [ ] partial  [ ] does not match

## v1.7.10 — stale Guide / terminal DOM race + DevTools events

- [ ] Open DevTools → Console and filter by `SIMNET WB`.
- [ ] Reload the page: visible events include `[BOOT]`, `[CONTEXT]` and `[LOCATOR]`.
- [ ] Open an ONU poll tab and use Guide to highlight the native `Запрос OLT` link.
- [ ] Console shows `[GUIDE] Запрошена подсказка` and `[GUIDE] Подсказка показана`.
- [ ] Click the highlighted native link yourself; no duplicate action button is present.
- [ ] Console shows `[GUIDE] Оператор запустил Запрос OLT`.
- [ ] When Billing replaces the old table with output, no `Node cannot be found in the current page` error appears.
- [ ] Console shows `[TERMINAL] Ответ OLT обнаружен`, start of parsing and the final block summary.
- [ ] The old `Запрос OLT` recommendation disappears immediately, even before the stored case finishes updating.
- [ ] The rail shows `Сверить результаты`; the quick Guide button does not try to find the removed link.
- [ ] All command/result ranges receive terminal markup without refreshing the page.
- [ ] Repeated MutationObserver scans do not flood Console with identical important events.

Comments:

Result: [ ] matches  [ ] partial  [ ] does not match
