# v1.7.29.31 — Migration plan

1. Сохранить существующий `juniper-prefetch.js` и его read-only request path; не добавлять новый fetch/poller.
2. Добавить нормализованный `caseData.juniper.evidence` с независимыми `read/opened/verified`.
3. Background preview считать полноценным diagnostic evidence, если parser дал не-error result и correlation/identity не конфликтуют.
4. Не считать automatic read ручным посещением: `operatorOpened=false` до реальной страницы `billing_juniper`.
5. При `billing_juniper` фиксировать `JUNIPER_OPENED` независимо от Guide CTA.
6. Сохранить `billing.juniper` в существующем Universal Action Target Resolver; новый lifecycle не создавать.
7. LIVE history строить из canonical evidence и агрегировать Juniper в одну строку.
8. Graph дополнить Juniper evidence card: source, result, read time, verified time, operatorOpened, IP/MAC/BRAS/session/VLAN.
9. Observability разделить на `JUNIPER_REQUEST_TIMEOUT`, `JUNIPER_REQUEST_FAILED`, `JUNIPER_PARSE_FAILED`, `JUNIPER_RESULT_CASE_MISMATCH`.
10. Trace дополнить `JUNIPER_REQUEST_START`, `JUNIPER_RESPONSE`, `JUNIPER_PARSED`, `JUNIPER_EVIDENCE_ADDED`, `JUNIPER_OPENED`.
11. Не добавлять постоянные timer/observer/listener; существующий prefetch duplicate guard оставить.
12. Обновить regression tests под явно изменённый продуктовый инвариант: automatic Juniper read теперь является evidence, но не manual visit.
