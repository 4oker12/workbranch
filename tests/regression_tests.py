from pathlib import Path
import json
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
results = []


def check(name, condition, detail=""):
    results.append({
        "name": name,
        "status": "PASS" if condition else "FAIL",
        "detail": detail
    })


def skip(name, detail=""):
    results.append({
        "name": name,
        "status": "SKIP",
        "detail": detail
    })


manifest = json.loads(
    (ROOT / "manifest.json").read_text(encoding="utf-8")
)
guide = (ROOT / "src/ui/guide.js").read_text(encoding="utf-8")
poll_terminal = (ROOT / "src/ui/poll-terminal.js").read_text(encoding="utf-8")
rail = (ROOT / "src/ui/rail.js").read_text(encoding="utf-8")
appeals = (ROOT / "src/ui/appeals-navigator.js").read_text(encoding="utf-8")
graph_studio = (ROOT / "src/graph/graph-studio.js").read_text(encoding="utf-8")
call_registration = (ROOT / "src/ui/call-registration.js").read_text(encoding="utf-8")
pbx_observer = (ROOT / "src/pbx/pbx-observer.js").read_text(encoding="utf-8")
background = (ROOT / "src/background.js").read_text(encoding="utf-8")
audit_launcher = (ROOT / "src/audit/launcher.js").read_text(encoding="utf-8")
bootstrap = (ROOT / "src/content/bootstrap.js").read_text(encoding="utf-8")
updater = (ROOT / "src/ui/updater.js").read_text(encoding="utf-8")
updater_core = (ROOT / "src/ui/updater-core.mjs").read_text(encoding="utf-8")
observability = (ROOT / "src/core/observability.js").read_text(encoding="utf-8")
diagnostics_core = (ROOT / "src/shared/diagnostics-core.mjs").read_text(encoding="utf-8")
store_client = (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
interaction_guards = (ROOT / "src/core/interaction-guards.js").read_text(encoding="utf-8")
juniper_prefetch = (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")
graph_loader = (ROOT / "src/graph/graph-loader.js").read_text(encoding="utf-8")
popup_html = (ROOT / "src/ui/popup.html").read_text(encoding="utf-8")
popup_js = (ROOT / "src/ui/popup.js").read_text(encoding="utf-8")
dom_integration = (
    ROOT / "tests/poll_terminal_dom_integration_test.mjs"
).read_text(encoding="utf-8")

check(
    "manifest is MV3 v1.7.29.50",
    manifest.get("manifest_version") == 3
    and manifest.get("version") == "1.7.29.50",
    manifest.get("version", "")
)
check(
    "permissions stay minimal",
    manifest.get("permissions") == ["storage"],
    json.dumps(manifest.get("permissions"), ensure_ascii=False)
)
check(
    "manifest has no all_urls",
    "<all_urls>" not in json.dumps(manifest),
    "restricted ISP hosts"
)
check(
    "observability layer loads before message/store operations without new permissions",
    "src/core/observability.js" in manifest["content_scripts"][0]["js"]
    and manifest["content_scripts"][0]["js"].index("src/core/observability.js")
    < manifest["content_scripts"][0]["js"].index("src/core/store-client.js")
    and manifest.get("permissions") == ["storage"],
    "content reporter is ready before StoreClient; no broad permission added"
)
check(
    "diagnostics persistence is bounded, deduplicated and redacted",
    "DIAGNOSTICS_MAX_ENTRIES = 200" in diagnostics_core
    and "DIAGNOSTICS_MAX_BYTES = 420000" in diagnostics_core
    and "existingIndex = state.entries.findIndex" in diagnostics_core
    and "[redacted]" in diagnostics_core
    and "SECRET_QUERY_KEYS" in diagnostics_core,
    "separate ring buffer; repeated failures collapse; secrets are removed before durable storage"
)
check(
    "diagnostics batching has no heartbeat or permanent Service Worker keepalive",
    "diagnosticsPending" in background
    and "diagnosticsFlushTimer = setTimeout" in background
    and "setInterval" not in observability
    and "setInterval" not in diagnostics_core,
    "errors flush in a short event-driven batch; no monitoring poller"
)
check(
    "content runtime failures survive a closed Service Worker message channel",
    "simnet_workbench_diagnostics_fallback_v1" in observability
    and "chrome.storage.local.set({ [FALLBACK_KEY]: next })" in observability
    and "DIAGNOSTICS_FALLBACK_KEY" in background
    and "applyDiagnosticEntries(state, fallback" in background,
    "rare sendMessage failures fall back to a small bounded storage queue and merge on worker wake"
)
check(
    "Service Worker message failures are visible in DevTools and persistent diagnostics",
    "SERVICE_WORKER_MESSAGE_FAILED" in background
    and "console.error(`[SIMNET WB][SW]" in background
    and "SERVICE_WORKER_UNHANDLED_REJECTION" in background
    and "SERVICE_WORKER_UNHANDLED_ERROR" in background,
    "background handler/unhandled failures no longer disappear behind sendResponse"
)
check(
    "critical Workbench operations report non-exception failures",
    "TMC_WRITEBACK_VERIFY_FAILED" in rail
    and "TMC_WRITEBACK_PARTIAL" in rail
    and "OLT_POLL_ATTEMPT_TIMEOUT" in interaction_guards
    and "CALL_REGISTRATION_UNCONFIRMED" in call_registration
    and "JUNIPER_REQUEST_FAILED" in juniper_prefetch
    and "JUNIPER_PARSE_FAILED" in juniper_prefetch
    and "JUNIPER_REQUEST_TIMEOUT" in juniper_prefetch
    and "GRAPH_LAZY_LOAD_FAILED" in graph_loader
    and "PBX_SNAPSHOT_PUBLISH_FAILED" in pbx_observer
    and "UPDATER_APPLY_FAILED" in updater,
    "post-conditions and user-visible operation chains have explicit failure records"
)
check(
    "Workbench exposes one diagnostics inbox with badge and export",
    "Диагностика Workbench" in rail
    and "diagnostics-badge" in rail
    and "diagnostics-mark-read" in rail
    and "diagnostics-clear" in rail
    and "diagnostics-export" in rail
    and "chrome.action?.setBadgeText" in background
    and "simnet-workbench-diagnostics-export-v1" in background,
    "More -> Errors shows unread failures and exports one compact diagnostic JSON"
)
check(
    "local updater is reachable from extension popup without new broad permissions",
    "Обновить Workbench" in popup_html
    and "src/ui/updater.html" in popup_js
    and manifest.get("permissions") == ["storage"],
    "popup opens a local extension updater page; no tabs/all_urls permission added"
)
check(
    "emergency diagnostics export works without a Service Worker response",
    "simnet_workbench_diagnostics_v1" in popup_js
    and "simnet_workbench_diagnostics_fallback_v1" in popup_js
    and "chrome.storage.local.get" in popup_js
    and "Экспорт ошибок" in popup_html,
    "toolbar popup reads durable/fallback diagnostics directly from storage"
)
check(
    "StoreClient observability cannot create synthetic MESSAGE timeout failures",
    "timeoutMs: 20000" not in store_client
    and "WB.observability?.startOperation" not in store_client
    and "STORE_MESSAGE_CHANNEL_CLOSED" in store_client,
    "message semantics stay unchanged; only actual sendMessage failures are reported"
)
check(
    "Data Audit resize cannot dereference an unmounted host",
    "if (!state.host?.isConnected) return false;" in audit_launcher,
    "optional Audit resize is null-safe before mount"
)

check(
    "local updater validates archive identity/version and blocks path traversal",
    "normalizeZipPath" in updater_core
    and "Откат заблокирован" in updater_core
    and "SIMNET Workbench" in updater_core
    and "Символические ссылки запрещены" in updater_core
    and "Небезопасный путь в ZIP" in updater_core,
    "ZIP is validated before any write"
)
check(
    "local updater writes manifest last and keeps a runtime backup",
    "BACKUP_DIR = '.simnet-wb-backup'" in updater
    and "runtimeBackupPath" in updater
    and "left === 'manifest.json'" in updater
    and "chrome.runtime.reload()" in updater,
    "runtime files are backed up; manifest is committed last; extension reload is explicit"
)
check(
    "local updater never auto-reloads operator tabs unless checkbox was selected",
    "reloadMatchingTabs: Boolean(reloadTabs.checked)" in updater
    and "if (!meta.reloadMatchingTabs)" in background
    and "chrome.tabs.reload" in background,
    "default updater checkbox is unchecked; active work is not destroyed silently"
)
check(
    "Data Audit launcher is CSP-safe and single-path",
    "src/audit/launcher.js" in manifest["content_scripts"][0]["js"]
    and "src/audit/audit-loader.js" not in manifest["content_scripts"][0]["js"]
    and not (ROOT / "src/audit/audit-loader.js").exists()
    and "(0, eval)" not in audit_launcher
    and "new Function" not in audit_launcher,
    "normal MV3 content script; no runtime JS-string evaluation"
)
check(
    "Data Audit heavy workspace initializes only on first open",
    "function ensureWorkspace()" in audit_launcher
    and "if (state.frame?.isConnected) return state.frame;" in audit_launcher
    and "ensureWorkspace();" in audit_launcher
    and "if (!isBillingListUrl()) return;" in audit_launcher,
    "launcher shell is light; audit.html/audit.js iframe is singleton and on-demand"
)
check(
    "SCAN scheduler coalesces DOM bursts without invalidating active readers",
    "function mergePendingScan(" in bootstrap
    and "function queueScheduledScan(" in bootstrap
    and "if (scanInFlight)" in bootstrap
    and "scansCoalesced" in bootstrap
    and "documentGeneration" in bootstrap
    and "scanDocumentGeneration !== documentGeneration" in bootstrap
    and "generation !== scanGeneration" not in bootstrap,
    "ordinary DOM churn becomes one trailing scan; only document invalidation can stale active work"
)
check(
    "Appeals Navigator loads before the rail",
    "src/ui/appeals-navigator.js" in manifest["content_scripts"][0]["js"]
    and manifest["content_scripts"][0]["js"].index("src/ui/appeals-navigator.js")
    < manifest["content_scripts"][0]["js"].index("src/ui/rail.js"),
    "question graph API is available before the panel renders"
)
check(
    "Call Registration loads before the rail",
    "src/ui/call-registration.js" in manifest["content_scripts"][0]["js"]
    and manifest["content_scripts"][0]["js"].index("src/ui/call-registration.js")
    < manifest["content_scripts"][0]["js"].index("src/ui/rail.js"),
    "isolated UI module is ready before the RAIL action"
)
pbx_scripts = [
    item for item in manifest.get("content_scripts", [])
    if "https://pbx.simnet.kiev.ua/*" in item.get("matches", [])
]
check(
    "PBX access is isolated to a read-only recent-call observer",
    "https://pbx.simnet.kiev.ua/*" in manifest.get("host_permissions", [])
    and len(pbx_scripts) == 1
    and pbx_scripts[0].get("js") == ["src/pbx/pbx-observer.js"]
    and "PBX_RECENT_CALLS_OBSERVED" in pbx_observer
    and "getrec.php?id=" in pbx_observer
    and "fetch(" not in pbx_observer,
    "PBX page contributes call metadata only; audio is never fetched"
)
check(
    "Call Registration is strict by default and operator override is explicit/audited",
    "PBX_RECENT_CALLS_QUERY" in call_registration
    and "PBX_CALL_BIND" in call_registration
    and "СТРОГАЯ ПО УМОЛЧАНИЮ" in call_registration
    and "Принять под ответственность" in call_registration
    and "overrideAcknowledged" in call_registration
    and "window.confirm(" in call_registration
    and "pbxCallKey: this.pbxBinding.callKey" in call_registration
    and "function validateCallSubmissionContext(" in background
    and "match.level !== 'strong'" in background
    and "operator-override" in background
    and "callSignature" in background
    and "Одного телефона недостаточно" in background
    and "сначала закрепи завершённый PBX-звонок" in background,
    "strong correlation remains default; manual responsibility is a separate immutable-call override"
)
check(
    "PBX registration has an atomic duplicate-submit guard",
    "claimPbxCallSubmission" in background
    and "status === 'registered'" in background
    and "registrationStatus = 'submitting'" in background
    and "registrationStatus = 'review_required'" in background
    and "PBX_CALL_SUBMISSION_FINALIZE" in call_registration
    and "Не повторяй отправку" in call_registration,
    "parallel tabs, repeat clicks and unknown network outcomes fail closed"
)
check(
    "RAIL exposes one native call registration action",
    "this.viewButton('call', 'call-registration'" in rail
    and "WB.callRegistration.open(currentCase)" in rail
    and "Регистрация звонка" in rail,
    "current Case customerId opens the compact UserSide form"
)
check(
    "Billing resolves UserSide Customer ID without forcing navigation",
    "resolveCallCustomer(payload" in background
    and "call-resolve-gotouser" in background
    and "call-resolve-ajax" in background
    and "call-resolve-search-page" in background
    and "caseId: this.caseSnapshot.caseId" in call_registration
    and "customer-id-missing" not in call_registration,
    "current Case -> gotouser IP -> exact search fallback -> native call form"
)
performance_monitor = (ROOT / "src/core/performance-monitor.js").read_text(encoding="utf-8")
bootstrap = (ROOT / "src/content/bootstrap.js").read_text(encoding="utf-8")
check(
    "Workbench exposes compact on-demand load telemetry",
    "src/core/performance-monitor.js" in manifest["content_scripts"][0]["js"]
    and "Нагрузка Workbench" in rail
    and "writesPerMinute" in performance_monitor
    and "juniper-initial" in (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")
    and "rail-mounted" in bootstrap,
    "scans / Case writes / network / render / storage size / cold startup"
)
check(
    "hidden tabs defer DOM scans and cross-tab rail renders",
    "hiddenScansSuppressed" in bootstrap
    and "WB.store.resume?.()" in bootstrap
    and "hiddenStatePublishesDeferred" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "document?.hidden" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "фон пропущено" in rail,
    "background tabs retain latest State without scan/render; one resume sync runs when visible"
)
check(
    "closed Workbench tabs release ephemeral state without broader permissions",
    "chrome.tabs?.onRemoved?.addListener(handleTabRemoved)" in background
    and "cleanupClosedTabState" in background
    and "delete state.tabs[tabId]" in background
    and "delete caseData.viewsByTab[tabId]" in background
    and "source-tab-closed" in background
    and "Закрытые вкладки" in rail,
    "tab/view bindings and orphaned operations are cleaned; subscriber Case evidence remains"
)
check(
    "UserSide rail mounts before storage and handoff work",
    bootstrap.index("WB.rail.mount()") < bootstrap.index("await WB.store.init()")
    < bootstrap.index("await WB.handoff?.init?.()")
    and "WB.store.patchUi({ open: false })" not in rail,
    "full RAIL is visible immediately; Graph/Audit no longer arrive alone"
)
check(
    "operator journal is bounded and ignores Workbench-owned UI",
    "MAX_JOURNAL_BYTES" in background
    and "journalFormat = 2" in background
    and "data-simnet-wb-owned" in (ROOT / "src/core/operator-trace.js").read_text(encoding="utf-8")
    and "simnet-workbench-call-registration-host" in (ROOT / "src/core/operator-trace.js").read_text(encoding="utf-8"),
    "legacy verbose signatures are compacted without losing subscriber semantics"
)
check(
    "Call Registration preserves the native UserSide contract",
    all(token in call_registration for token in [
        "CALL_REGISTRATION_FORM",
        "CALL_REGISTRATION_SUBMIT",
        "input[type=\"hidden\"][name]",
        "select[name=\"standart_comment\"]",
        "textarea[name=\"comment\"]",
        "input[name=\"dopf_13\"]",
        "additional_fields[]",
        "status: 'unknown'",
        "сохранение не подтверждено"
    ])
    and "CALL_REGISTRATION_FORM" in background
    and "CALL_REGISTRATION_SUBMIT" in background
    and "application/x-www-form-urlencoded" in background,
    "fresh CSRF + hidden fields + exact UserSide save endpoint"
)
check(
    "TMC reveal is target-specific and cannot jump to a later MAC-search Guide step",
    "semanticTargetId: 'userside.tmc'" in rail
    and "sourceAction: 'live-show-tmc'" in rail
    and "continueActiveActionSession" in rail[rail.find("async showTmcBlock()"):rail.find("async maybeAutoPrefillMissingTmcTechnical") ]
    and "tmcTeleportConfirmed" in rail[rail.find("async showTmcBlock()"):rail.find("async maybeAutoPrefillMissingTmcTechnical") ]
    and "tmcShownAt" not in rail[rail.find("async showTmcBlock()"):rail.find("async maybeAutoPrefillMissingTmcTechnical") ]
    and "recordTmcTeleportShown" in guide
    and "tmcTeleportVisualConfirmation" in guide
    and "if (!visual?.confirmed)" in guide
    and "tmcShownAt: at" in guide
    and "registerResolver?.('userside.tmc'" in guide
    and "tmcHighlightTarget" in guide[guide.find("registerResolver?.('userside.tmc'"):guide.find("registerResolver?.('billing.poll.entry'")]
    and "WB.guide?.highlight?.(currentCase)" not in rail[rail.find("async showTmcBlock()"):rail.find("async maybeAutoPrefillMissingTmcTechnical")],
    "TMC is recorded centrally only after userside.tmc Focus is visible and the required TMC values are visibly marked"
)
check(
    "TMC identity conflict prefills Billing instead of detouring to MAC search",
    "Есть расхождение Billing ↔ ТМЦ" in rail
    and "live-apply-tmc" in rail
    and ("Заполнить техданные" in rail or "Заполнить техданные" in rail)
    and "applyTmcTechnicalValues" in guide
    and "tmc.identity-conflict-fill-billing" in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8")
    and "tmc.identity-conflict-search-mac" not in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8"),
    "resolved UserSide/TMC values are copied into Billing controls; native Save remains operator-controlled"
)
check(
    "Guide primary focus uses the shared plum accent",
    "border: 2px solid rgba(165,0,70,.92)" in guide
    and "background:#A50046" in guide
    and "border: 1px solid rgba(165,0,70,.46)" in guide
    and "background:#58a6ff" not in guide,
    "navigation focus shares the Workbench plum language instead of blue/orange primary accents"
)
check(
    "OLT help marker is anchored after the visible control",
    "cell.querySelector?.('.selectize-control') || control" in rail
    and "visualControl.insertAdjacentElement('afterend', help)" in rail
    and "control.nextSibling" not in rail[rail.find("syncPonTechnicalFieldHints()"):rail.find("async withLiveNavigation")],
    "Selectize's hidden native select can no longer place '?' on the left"
)
check(
    "micro-hints rise above Focus Layer while rail stays topmost",
    "z-index: 2147483644" in guide
    and "simnet-wb-guide-active" in guide
    and "html.simnet-wb-guide-active .simnet-live-field-help" in rail
    and "z-index:2147483645!important" in rail
    and "zIndex: '2147483646'" in rail,
    "page hints are readable above the dim backdrop; Workbench rail remains above both"
)
check(
    "micro-hints keep a low-contrast base state and expose readable hover text",
    "opacity:.72!important" in rail
    and "data-simnet-help" in rail
    and "content:attr(data-simnet-help)" in rail
    and "data-help=" in rail,
    "base hint stays present but quiet; hover/focus reveals the explanation"
)
check(
    "TMC point evidence belongs to the one-shot Focus Layer",
    "Focus is a one-shot pointer, not persistent decoration" in guide
    and "clearTmcValueMarks(document);" in guide[guide.find("clear(reason ="):guide.find("const TRACE_STYLE_ID")],
    "closing Focus removes Workbench-owned TMC point marks; completed evidence remains in LIVE/Graph history instead"
)
check(
    "TMC first-pass reveal restores the exact v29.32 point-highlight view",
    "function tmcHighlightTarget(caseData)" in guide
    and "document.createRange()" in guide
    and "range.getClientRects()" in guide
    and "return unionRects(rects) || element.getBoundingClientRect();" in guide
    and "String(valueOf(caseData?.pon?.tmcPort)" in guide
    and "span.dataset.simnetWbTmcValue" in guide
    and "--simnet-wb-tmc-mark-width" in guide
    and "background:rgba(165,0,70,.075)" in guide
    and "!currentPlan?.replayOnly" in guide,
    "first Guide pass keeps semantic TMC geometry plus the old aligned plum OLT/IP/SN/MAC marks; History Replay stays lightweight"
)
check(
    "TMC writeback enters Billing technical through fresh semantic navigation before touching controls",
    "Сначала откроем Billing → Технические данные" in rail
    and "semanticTargetId: 'billing.technical'" in rail
    and "sourceAction: 'tmc-writeback-return-technical'" in rail
    and "page.pageKind === 'billing_technical'" in rail
    and "tmcWritebackMode: hasConflict ? 'correction' : 'missing-only'" in rail
    and "applyMissingTmcTechnicalValues" in rail
    and "safeBillingSemanticTarget" in background
    and "source.searchParams.get('pp')" in background
    and "semanticTargetId: String(options?.semanticTargetId || '')" in (ROOT / "src/core/handoff.js").read_text(encoding="utf-8"),
    "UserSide writeback resolves fresh source-tab pp semantically; only Billing technical consumes pending field writes"
)

check(
    "TMC writeback obligations come only from fields actually present in current TMC",
    "tmcTechnicalExpectation" in rail
    and "tmcExpectedFields" in rail
    and "tmcExpectedFields" in background
    and "Fields absent in TMC are not obligations" in rail
    and "fields = tmcExpectation.fields" in rail[rail.find("async maybeAutoPrefillMissingTmcTechnical"):rail.find("async requestTmcWriteback")]
    and "const fields = hasConflict" in rail[rail.find("async requestTmcWriteback"):rail.find("async maybeApplyPendingTmcWriteback")]
    and ": availableFields;" in rail[rail.find("async requestTmcWriteback"):rail.find("async maybeApplyPendingTmcWriteback")]
    and "expectedFields.every(field => accountedFields.has(field))" in rail
    and "flow.tmcShownAt" in background[background.find("function syncPonWritebackWorkflow"):background.find("function ensureGuideShape")],
    "TMC scope is dynamic: present fields must be applied/matched; absent fields never become writeback obligations; passive parsing cannot verify the step"
)

check(
    "TMC OLT writeback can resolve Selectize options loaded only after opening/search",
    "triggerSelectizeOltLookup" in guide
    and "selectizeCandidateNodes" in guide
    and "candidateIp" in guide[guide.find("function triggerSelectizeOltLookup"):guide.find("function rankOltOptionNodes")]
    and "status: 'not_ready'" in guide[guide.find("function resolveOltOptionByName"):guide.find("function dispatchSyntheticClick")]
    and "dropdownOption" in guide[guide.find("function applyOltOptionSelection"):guide.find("function resolveAndApplyOltByName")],
    "empty native dopfield_29 is no longer treated as a final miss while Billing Selectize is still loading its real OLT choices"
)
check(
    "failed TMC writeback remains visible and retryable instead of disappearing silently",
    "tmcWritebackLastStatus" in rail
    and "Подстановка не завершена" in rail
    and "Повторить подстановку" in rail
    and "tmcWritebackLastStatus" in background,
    "operator sees a retry action with the same TMC evidence when automatic field matching fails"
)

check(
    "native Ask OLT focus covers the semantic action cell through the universal Guide target",
    "function askOltHighlightTarget" in guide
    and "link?.closest?.('td,th') || link" in guide
    and "semanticTargetId === 'billing.olt.request'" in guide
    and "registerResolver?.('billing.olt.request'" in guide,
    "the final native action keeps the larger semantic cell target without a separate persistent highlight subsystem"
)
check(
    "TMC-known missing OLT is offered as safe one-click Billing prefill without a standing negative checklist",
    "OLT найден в ТМЦ" in rail
    and ("Заполнить OLT" in rail or "Заполнить OLT" in rail)
    and "Сначала откроем Billing → Технические данные" in rail
    and "Только после загрузки формы Workbench подставит" in rail
    and "Billing: не заполнено —" not in rail
    and "ONU не опрошено" not in rail,
    "safe TMC→Billing writeback remains available while the old always-visible missing-step wording is removed"
)
check(
    "TMC prefill never auto-submits Billing",
    "applyTmcTechnicalValues" in guide
    and "native Save" in guide
    and "findSaveButton().click" not in guide
    and "requestSubmit" not in guide,
    "controls are prefilled only; operator confirms with the native Save button"
)
check(
    "TMC shown + missing Billing field auto-prefills without the large table banner",
    "maybeAutoPrefillMissingTmcTechnical" in rail
    and "applyMissingTmcTechnicalValues" in guide
    and "tmc-auto-prefill-applied" in rail
    and "Нужно обновить технические данные" not in rail
    and "insertBefore(banner, firstMissing)" not in rail,
    "known TMC values fill only still-empty Billing controls; native Save remains operator-controlled and table geometry is untouched"
)
check(
    "confirmed ONU poll no longer depends on a feature-specific poll reveal flag",
    "caseData.route.onuPollConfirmedAt" in background
    and "delete flow[deprecated]" in background
    and "'pollRevealPending'" in background
    and "pollRevealPending" not in rail
    and "pollRevealPending" not in guide,
    "successful poll evidence is independent from deprecated Guide pending flags; universal actionSession owns guided navigation"
)
check(
    "stale extension contexts stop scanning instead of spamming rejected messages",
    "EXTENSION_CONTEXT_INVALIDATED" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "invalidateExtensionContext" in bootstrap
    and "notifyExtensionContextInvalidated" in rail
    and "Workbench message type is missing" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8"),
    "extension reload requires page refresh; Case remains in chrome.storage"
)
check(
    "UserSide ONU Rx timestamp churn does not trigger full Case rescans",
    "isVolatileCrmMutation" in (ROOT / "src/core/interaction-guards.js").read_text(encoding="utf-8")
    and "span[id^=\"spanOnuRx\"]" in (ROOT / "src/core/interaction-guards.js").read_text(encoding="utf-8")
    and "volatileCrmMutationsSuppressed" in bootstrap,
    "timestamp-only poller mutations are ignored; actual ONU Rx value changes remain observable"
)

check(
    "LIVE keeps only call-relevant Juniper facts on the first surface",
    all(token in rail for token in [
        "LIVE · снимок",
        "live-fingerprint",
        "snapshotFact('Трафик', traffic)",
        "details.lastEventTime || details.startTime",
        "Что уже сделано"
    ])
    and "ONU не опрошено" not in rail
    and "pon-live-goal" not in rail
    and "snapshotFact('IP', details.subscriberIp)" not in rail
    and "snapshotFact('MAC', details.subscriberMac)" not in rail
    and "Operator Cockpit" not in rail
    and 'data-action="juniper-layer"' not in rail,
    "session + traffic + time are first-level; IP/MAC stay in Case data; unperformed PON steps are not rendered as a checklist"
)
check(
    "Appeals Navigator stays focused on symptom narrowing without duplicating LIVE",
    ("Один вопрос сейчас" in rail or "Сейчас в маршруте" in rail)
    and "Рабочая гипотеза · не окончательный диагноз" in rail
    and (
        "Ответ абонента не считается техническим доказательством" in rail
        or "Ответ абонента ≠ network evidence" in rail
        or "Ответы и path — только в Diagnostic Graph" in rail
    )
    and "Техническая диагностика этого же кейса" not in rail
    and 'data-action="appeal-live"' not in rail
    and 'data-action="appeal-guide"' not in rail,
    "RAIL companion + Graph answers; technical PON acquisition stays in LIVE"
)
check(
    "Full Workbench section selection is click-driven and stable across store updates",
    "this.fullSection = ''" in rail
    and "selectFullSection(section)" in rail
    and "WB.store.patchUi?.({ section: next })" in rail
    and "this.activeView === 'full' && this.fullSection" in rail
    and "this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false }" in rail
    and "this.shadow.addEventListener('pointerover', event =>" not in rail,
    "clicked section is persisted and a stale store render cannot throw Appeals back to Facts"
)
check(
    "five initial appeal types have finite deterministic branches",
    all(token in appeals for token in [
        "id: 'low_speed'",
        "id: 'no_internet'",
        "id: 'unstable'",
        "id: 'wifi'",
        "id: 'sites'",
        "function answer(raw, answerId, caseData = {}",
        "function back(raw)"
    ]),
    "low speed / no internet / unstable / Wi-Fi / sites"
)
check(
    "appeal progress is case-bound and cannot retarget a foreign tab",
    "STORE_PATCH_APPEAL" in (ROOT / "src/shared/messages.js").read_text(encoding="utf-8")
    and "async patchAppeal(appeal, transition" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "tabCaseId !== requestedCaseId" in (ROOT / "src/background.js").read_text(encoding="utf-8")
    and "reason: 'foreign-case'" in (ROOT / "src/background.js").read_text(encoding="utf-8")
    and "result.appeal = normalizeAppealState" in (ROOT / "src/background.js").read_text(encoding="utf-8"),
    "answers and history remain inside the current subscriber case"
)
check(
    "Graph Studio is a separate editable module with MV3 CSP-safe loading",
    "src/graph/graph-loader.js" in manifest["content_scripts"][0]["js"]
    and "src/graph/graph-studio.js" in manifest["content_scripts"][0]["js"]
    and manifest["content_scripts"][0]["js"].index("src/ui/appeals-navigator.js")
    < manifest["content_scripts"][0]["js"].index("src/graph/graph-loader.js")
    < manifest["content_scripts"][0]["js"].index("src/graph/graph-studio.js")
    < manifest["content_scripts"][0]["js"].index("src/ui/rail.js")
    and "eval)(source" not in graph_loader
    and "new Function(" not in graph_loader
    and "src/graph/graph-studio.js" not in manifest.get("web_accessible_resources", [{}])[0].get("resources", [])
    and "Сохранить черновик" in graph_studio
    and "Опубликовать" in graph_studio
    and "Импорт" in graph_studio
    and "Экспорт" in graph_studio,
    "Graph Studio is packaged locally and loaded in the isolated content world without eval/unsafe-eval"
)
check(
    "graph publication validates topology and pins active appeals",
    "function validateGraph" in appeals
    and "обнаружен цикл" in appeals
    and "целевой узел" in appeals
    and "graphRevision" in appeals
    and "graphType" in appeals
    and "typeForState" in appeals
    and "MAX_GRAPH_HISTORY" in appeals
    and "availableOptions" in appeals,
    "finite graph + version history + case-fact transition conditions"
)


operator_trace = (ROOT / "src/core/operator-trace.js").read_text(encoding="utf-8")
background = (ROOT / "src/background.js").read_text(encoding="utf-8")

check(
    "detailed operator trace is explicit opt-in, bounded and silent while disabled",
    "enabled: false" in operator_trace
    and "function configuredEnabled()" in operator_trace
    and "workflow?.operatorTrace?.enabled" in operator_trace
    and "if (state.destroyed || !state.enabled" in operator_trace
    and "function enable()" in operator_trace
    and "function disable(" in operator_trace
    and "setEnabled" in operator_trace
    and "'operator_click'" in operator_trace
    and "'operator_double_click'" in operator_trace
    and "'operator_selection'" in operator_trace
    and "'operator_navigation'" in operator_trace
    and "'operator_return'" in operator_trace
    and "'operator_change'" in operator_trace
    and "'operator_scroll'" in operator_trace
    and "'operator_hover'" not in operator_trace
    and "mousemove" not in operator_trace
    and "TRACE_MAX_EVENTS = 3000" in operator_trace
    and "TRACE_MAX_BYTES = 1200000" in operator_trace
    and "function startUiObserver()" in operator_trace
    and "state.uiObserver.disconnect()" in operator_trace
    and "stopAndExport" in operator_trace
    and 'data-action="operator-trace"' in rail
    and "Diagnostic Trace" in rail
    and "Остановить и экспортировать" in rail,
    "manual Trace records rich interaction only while enabled, has no hover/mousemove flood, and is bounded/exportable"
)
check(
    "free-text typing is private and does not trigger per-key Case writes",
    "if (isFreeTextControl(raw)) return;" in operator_trace
    and "on(document, 'focusout'" in operator_trace
    and "[текст: ${length} симв.]" in operator_trace
    and "document.addEventListener('input'" not in bootstrap
    and "schedule('form-text-complete')" in bootstrap,
    "textarea/text content is summarized and rescanned once on blur; synthetic input/change keystrokes do not persist text"
)
check(
    "manual confirmed ONU poll outranks unfinished Guide acquisition order",
    "isConfirmedPollContext" in (ROOT / "src/core/route-controller.js").read_text(encoding="utf-8")
    and "isConfirmedPollObservation" in (ROOT / "src/core/route-controller.js").read_text(encoding="utf-8")
    and "caseData?.live?.oltSnapshot?.status === 'confirmed'" in guide,
    "exact correlated PollAttempt terminates Guide without Juniper/Technical backtracking"
)
check(
    "Huawei DownTime remains a timestamp and offline duration is explicit",
    "currentOfflineDuration" in poll_terminal
    and "событий за 7 дней" in poll_terminal
    and "DownTime — время начала отключения, не длительность" in poll_terminal,
    "timezone-aware DownTime -> OFFLINE duration; seven days labels only the event window"
)
check(
    "legacy LIVE history is normalized without another poll",
    "normalizeHistory" in rail
    and "событий за 7 дней: $1" in rail
    and "snapshot?.capturedAt" in rail,
    "old `7 дней: ×N` snapshots render as an event window and recover offline duration at capture time"
)
check(
    "operator click stores target plus two DOM parent levels",
    "targetHtml: sanitizeClone(element" in operator_trace
    and "parentHtml: sanitizeClone(parent" in operator_trace
    and "grandparentHtml: sanitizeClone(grandparent" in operator_trace
    and "parentPath: cssPath(parent)" in operator_trace
    and "grandparentPath: cssPath(grandparent)" in operator_trace,
    "target + parent + grandparent HTML/path"
)
check(
    "terminal poll state cannot remain pending",
    "canonicalStatus" in (ROOT / "src/core/correlation.js").read_text(encoding="utf-8")
    and "? 'resolved'" in (ROOT / "src/core/correlation.js").read_text(encoding="utf-8")
    and "pending: !terminal" in (ROOT / "src/core/correlation.js").read_text(encoding="utf-8"),
    "CONFIRMED/FAILED/TIMEOUT attempts normalize their public status"
)
check(
    "PON ONU LAN port is not exported as provider Ethernet access",
    "onuLanPort: fact(" in (ROOT / "src/adapters/userside-adapter.js").read_text(encoding="utf-8")
    and "classification: accessPoint.isEthernet" in (ROOT / "src/adapters/userside-adapter.js").read_text(encoding="utf-8")
    and "['accessLinkState', 'onuLanLinkState']" in background
    and "delete result.network[networkKey]" in background,
    "PON ONU UNI/LAN state remains PON evidence; network.access* is Ethernet-only"
)
check(
    "LIVE history snapshots keep structured events and deduplicate summaries",
    "function durableSnapshotValue" in background
    and "{object:" in background
    and "appendSummaryUnique" in poll_terminal
    and "item.displaySummary = appendSummaryUnique" in poll_terminal,
    "no [object Object] event flattening and no repeated identical OFFLINE summary"
)
check(
    "diagnostic result separates poll response, binding verification and service health",
    "pollResponded" in background
    and "bindingVerified" in background
    and "serviceHealthy" in background
    and "serviceState" in background
    and "OLT ответила" in rail
    and "Привязка ONU не подтверждена" in rail,
    "route completion no longer has to be interpreted as identity or service-health proof"
)
check(
    "operator trace derives semantic GET/navigation hints without AI",
    "method: 'GET'" in operator_trace
    and "a=dopdata" in operator_trace
    and "gotouser.php" in operator_trace
    and "find_typer=machistory" in operator_trace
    and "semanticFor" in operator_trace,
    "HTML/text/URL/GET route semantics"
)
check(
    "operator trace protects secrets and keeps tab-bound case journaling",
    "PROTECTED_KEY_RE" in operator_trace
    and "[protected]" in operator_trace
    and "state.tabs?.[tabId]?.caseId" in background
    and "operatorActions" in background,
    "protected form values + sender tab case resolution"
)
check(
    "Juniper (NEW) starts as a parallel read-only snapshot",
    "src/core/juniper-session-parser.js" in manifest["content_scripts"][0]["js"]
    and "src/core/juniper-prefetch.js" in manifest["content_scripts"][0]["js"]
    and "BILLING_PREFETCH_PAGES" in (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")
    and "action !== 'check_juniper'" not in (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")
    and "a=252" in operator_trace
    and "searchParams.set('act', 'coasync')" not in (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")
    and "searchParams.set('act', 'coadisconnect')" not in (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8"),
    "read-only a=252 prefetch runs without blocking the Billing technical route"
)
check(
    "Juniper automatic read is first-class evidence without gating the PON acquisition flow",
    "juniper-background-preview" in (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")
    and "juniperPreview" in background
    and "kind: 'JUNIPER_READ'" in background
    and "kind: 'JUNIPER_OPENED'" in background
    and "kind: 'JUNIPER_VERIFIED'" in background
    and "operatorOpened" in background
    and "billing.open-juniper" in guide
    and "billing.inspect-juniper" in guide
    and "const juniperReviewStatus" not in guide
    and "billing.return-for-juniper" not in guide
    and "route.open-technical" in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8"),
    "correlated background read becomes Case evidence; manual OPENED stays separate; Technical/TMC route remains non-blocking"
)
check(
    "safe Guide navigation survives unrelated legacy DOM churn",
    "cancelOnStale: false" in guide
    and "requireQuiet: false" in guide
    and "stale-guide-click-pass-through" in (ROOT / "src/core/interaction-guards.js").read_text(encoding="utf-8"),
    "Guide bookkeeping cannot cancel native navigation; Poll strictness stays in the semantic document guard"
)

check(
    "operator trace CSS path avoids named-form id collisions",
    "node.getAttribute?.('id')" in operator_trace
    and "id: String(element.getAttribute?.('id') || '')" in operator_trace,
    "form[name=id] cannot become #[object HTMLInputElement]"
)

check(
    "case journal renders operator semantic context",
    "journalEventDetail(event)" in rail
    and "<b>Смысл:</b>" in rail
    and "<b>DOM:</b>" in rail
    and ".event.operator_click" in rail,
    "human-readable semantic trace in rail journal; full DOM stays in JSON export"
)

check(
    "terminal DOM overrides a stale Ask OLT recommendation",
    "id: 'result.review-terminal'" in guide
    and guide.index("id: 'result.review-terminal'") < guide.index("const locatorPlan = planLocator"),
    "result evidence wins before Locator can expose another poll action"
)
check(
    "Guide never dereferences a detached Billing node",
    "!normalizedTarget.element.isConnected" in guide
    and "reason: 'target-detached'" in guide
    and "this.currentPlan !== currentPlan" in guide
    and "guide-target-changed" in rail,
    "async hint persistence is followed by DOM connectivity validation"
)
check(
    "terminal segmentation survives a partial legacy DOM replacement",
    "Фрагмент DOM изменился во время разметки" in poll_terminal
    and "Контейнер пропущен, остальные продолжают обработку" in poll_terminal
    and "commandNode?.parentNode !== container" in poll_terminal,
    "one stale fragment cannot abort all command blocks"
)
check(
    "important runtime events are visible and filterable in DevTools",
    "[SIMNET WB][${String(scope || 'APP').toUpperCase()}]" in (
        ROOT / "src/content/namespace.js"
    ).read_text(encoding="utf-8")
    and "Оператор запустил Запрос OLT" in guide
    and "Ответ OLT обнаружен" in poll_terminal
    and "Результат OLT классифицирован" in (
        ROOT / "src/content/bootstrap.js"
    ).read_text(encoding="utf-8"),
    "BOOT / CONTEXT / GUIDE / TERMINAL / LOCATOR without mutation-scan spam"
)
check(
    "real browser-DOM terminal regression is recorded",
    "terminal.scan(dom.window.document)" in dom_integration
    and "first.created, 8" in dom_integration
    and "result.review-terminal" in dom_integration,
    "flat Billing DOM plus stale Locator handoff"
)

check(
    "MAC and Ethernet are decisive whole-block evidence",
    "data-simnet-visual-priority=\"decisive\"" in poll_terminal
    and "КЛЮЧЕВОЕ 1/2 · MAC УСТРОЙСТВА" in poll_terminal
    and "КЛЮЧЕВОЕ 2/2 · ETHERNET-ПОРТ" in poll_terminal
    and "content:\"✓ \"" in poll_terminal
    and "content:\"! \"" in poll_terminal,
    "whole block + explicit text/symbol result"
)
check(
    "recent history uses current 24h and 7d windows",
    "const nowMs = Date.now()" in poll_terminal
    and "events24h" in poll_terminal
    and "events7d" in poll_terminal
    and "recentHistoryIsFrequent" in poll_terminal,
    "2+ events/24h or 3+ events/7d; isolated history stays context"
)
check(
    "rail repeats decisive live evidence in operator order",
    "terminalEvidenceRows(snapshot = null)" in rail
    and "['MAC', find(block => block.family === 'mac_address')]" in rail
    and "['Линк', find(block => block.family === 'ont_port_state')]" in rail
    and "['События', historyBlock]" in rail
    and "['Оптика', find(block => block.family === 'optical')]" not in rail,
    "MAC -> Link -> relevant events; raw optical levels remain second-level evidence"
)
check(
    "completed Guide promotes semantic familiarity only after poll completion",
    "promoteCompletedGuideToExperience" in (ROOT / "src/background.js").read_text(encoding="utf-8")
    and "termination?.status !== LocatorTermination.CONFIRMED" in (ROOT / "src/background.js").read_text(encoding="utf-8")
    and "experience.learnedTargets" in (ROOT / "src/background.js").read_text(encoding="utf-8"),
    "operator memory is orthogonal to diagnostic stage"
)
check(
    "familiar elements use a light reminder without completing Guide steps",
    "data-simnet-wb-reminder" in guide
    and "refreshFamiliarReminders" in guide
    and "setFamiliarReminder" in guide,
    "subtle semantic reminder layer"
)
check(
    "out-of-route evidence is passive and promotable",
    "outside-current-guide-route" in (ROOT / "src/background.js").read_text(encoding="utf-8")
    and "existing.passive && !observation.passive" in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8")
    and "Passive discovery is evidence memory only" in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8"),
    "non-linear browsing cannot reorder the route; revisit can promote the same evidence"
)
check(
    "PON incomplete Billing is hard-gated through TMC before live poll",
    "billing.try-poll-minimal" not in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8")
    and "billing.incomplete-check-tmc" in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8")
    and "technical.missingBilling.length > 0" in (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8"),
    "missing required OLT/Serial/MAC is repaired through TMC before the operator is offered live poll"
)

check(
    "PON evidence and guided navigation persist through separate Case workflow namespaces",
    "STORE_PATCH_WORKFLOW" in (ROOT / "src/shared/messages.js").read_text(encoding="utf-8")
    and "patchWorkflow(namespace, patch" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "ensureWorkflowShape" in background
    and "ensureActionSessionShape" in background
    and "tmcShownAt" in background
    and "namespace === 'actionSession'" in background
    and "openUsersideForCase" in (ROOT / "src/core/handoff.js").read_text(encoding="utf-8")
    and "'live-show-tmc'" in rail
    and 'data-action="live-open-poll"' in rail,
    "evidence milestones remain in ponAcquisition while one universal actionSession survives guided cross-page navigation"
)

store_client_source = (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
check(
    "content StoreClient defines the workflow message it sends",
    "STORE_PATCH_WORKFLOW: 'STORE_PATCH_WORKFLOW'" in store_client_source
    and "MessageType.STORE_PATCH_WORKFLOW" in store_client_source,
    "patchWorkflow must never call chrome.runtime.sendMessage with type undefined"
)

check(
    "clean unpacked-extension update is documented",
    (ROOT / "INSTALL-UPDATE.txt").exists()
    and "не саму корневую папку" in (ROOT / "INSTALL-UPDATE.txt").read_text(encoding="utf-8")
    and "manifest.json" in (ROOT / "INSTALL-UPDATE.txt").read_text(encoding="utf-8"),
    "stable folder path without stale merged files"
)

refs = [
    manifest["background"]["service_worker"],
    manifest["action"]["default_popup"],
    *manifest["icons"].values(),
]
for item in manifest["content_scripts"]:
    refs.extend(item["js"])

missing = [ref for ref in refs if not (ROOT / ref).exists()]
check(
    "all manifest references exist",
    not missing,
    str(missing or len(refs))
)

loaded_js = manifest["content_scripts"][0]["js"]
check(
    "locator signals load before adapters",
    loaded_js.index("src/core/locator-signals.js")
    < loaded_js.index("src/adapters/billing-adapter.js")
    and loaded_js.index("src/core/locator-signals.js")
    < loaded_js.index("src/adapters/userside-adapter.js"),
    "signal classifier first"
)
check(
    "TMC identity matcher loads before UserSide and Guide",
    loaded_js.index("src/core/tmc-match.js")
    < loaded_js.index("src/adapters/userside-adapter.js")
    and loaded_js.index("src/core/tmc-match.js")
    < loaded_js.index("src/ui/guide.js"),
    "shared informational ONU identity matcher"
)

check(
    "shared TMC parser loads before UserSide adapter",
    "src/core/tmc-parser.js" in loaded_js
    and loaded_js.index("src/core/tmc-parser.js") < loaded_js.index("src/adapters/userside-adapter.js"),
    "same parser is available to live Workbench and Data Audit"
)

check(
    "handoff and locator observer load before Guide",
    loaded_js.index("src/core/handoff.js")
    < loaded_js.index("src/core/locator-observer.js")
    < loaded_js.index("src/ui/guide.js"),
    "core independent from visual helper"
)
check(
    "semantic tree loads before Graph Studio and Rail",
    "src/core/semantic-tree.js" in loaded_js
    and loaded_js.index("src/core/semantic-tree.js") < loaded_js.index("src/graph/graph-studio.js")
    and loaded_js.index("src/core/semantic-tree.js") < loaded_js.index("src/ui/rail.js"),
    "semantic model is available to graph/UI but remains independent from runtime Case progress"
)

check(
    "universal action lifecycle loads after StoreClient and before Guide/Rail",
    "src/core/action-lifecycle.js" in loaded_js
    and loaded_js.index("src/core/store-client.js") < loaded_js.index("src/core/action-lifecycle.js")
    and loaded_js.index("src/core/action-lifecycle.js") < loaded_js.index("src/ui/guide.js")
    and loaded_js.index("src/core/action-lifecycle.js") < loaded_js.index("src/ui/rail.js"),
    "all guided targets share one lifecycle engine before UI consumers initialise"
)

node = shutil.which("node")
syntax_ok = True
syntax_detail = "node unavailable"
module_files = {
    "src/background.js",
    "src/core/correlation.js",
    "src/core/locator-policy.js",
    "src/core/route-controller.js",
    "src/shared/messages.js",
    "src/shared/diagnostics-core.mjs"
}

if node:
    syntax_detail = ""
    for path in ROOT.rglob("*.js"):
        rel = path.relative_to(ROOT).as_posix()
        if path.name == "generator-source-original.js":
            continue
        if rel in module_files:
            proc = subprocess.run(
                [node, "--input-type=module", "--check"],
                input=path.read_text(encoding="utf-8"),
                text=True,
                capture_output=True
            )
        else:
            proc = subprocess.run(
                [node, "--check", str(path)],
                text=True,
                capture_output=True
            )
        if proc.returncode:
            syntax_ok = False
            syntax_detail += f"{rel}: {proc.stderr}\n"

check(
    "all JavaScript files pass syntax check",
    syntax_ok,
    syntax_detail or "OK"
)

for test_name in [
    "background_unit_test.mjs",
    "tab_lifecycle_unit_test.mjs",
    "case_processor_integration_test.mjs",
    "correlation_hardening_unit_test.mjs",
    "poll_recovery_ux_unit_test.mjs",
    "store_client_cold_poll_response_unit_test.mjs",
    "store_client_hidden_tab_unit_test.mjs",
    "store_client_workflow_unit_test.mjs",
    "ethernet_access_route_unit_test.mjs",
    "operator_cockpit_focus_unit_test.mjs",
    "plum_ui_shell_unit_test.mjs",
    "live_snapshot_unit_test.mjs",
    "live_onu_acquisition_flow_unit_test.mjs",
    "pon_workflow_persistence_unit_test.mjs",
    "appeals_navigator_unit_test.mjs",
    "appeals_store_integration_test.mjs",
    "graph_studio_unit_test.mjs",
    "graph_studio_ui_contract_test.mjs",
    "semantic_tree_contract_test.mjs",
    "semantic_graph_ui_contract_test.mjs",
    "semantic_studio_standalone_unit_test.mjs",
    "locator_policy_unit_test.mjs",
    "locator_signals_unit_test.mjs",
    "tmc_source_limited_poll_contract_unit_test.mjs",
    "tmc_match_unit_test.mjs",
    "tmc_parser_unit_test.mjs",
    "juniper_prefetch_unit_test.mjs",
    "juniper_session_parser_unit_test.mjs",
    "juniper_evidence_graph_unit_test.mjs",
    "knowledge_base_unit_test.mjs",
    "audit_billing_parser_unit_test.mjs",
    "audit_readiness_unit_test.mjs",
    "audit_launcher_csp_unit_test.mjs",
    "scan_scheduler_coalescing_unit_test.mjs",
    "scan_quiescent_unit_test.mjs",
    "navigation_transaction_regression_unit_test.mjs",
    "billing_navigation_safety_unit_test.mjs",
    "history_replay_writeback_contract_test.mjs",
    "transition_responsiveness_panel_privacy_unit_test.mjs",
    "route_variation_unit_test.mjs",
    "guide_progress_unit_test.mjs",
    "guide_evidence_flow_unit_test.mjs",
    "evidence_navigation_unit_test.mjs",
    "tmc_teleport_milestone_unit_test.mjs",
    "evidence_focus_lifecycle_unit_test.mjs",
    "live_evidence_history_unit_test.mjs",
    "graph_evidence_projection_unit_test.mjs",
    "one_shot_tmc_focus_unit_test.mjs",
    "poll_target_priority_unit_test.mjs",
    "poll_one_shot_direct_navigation_unit_test.mjs",
    "action_passive_tab_race_unit_test.mjs",
    "tmc_first_transition_retry_unit_test.mjs",
    "tmc_handoff_transaction_unit_test.mjs",
    "tmc_viewport_teleport_unit_test.mjs",
    "save_gate_replay_navigation_unit_test.mjs",
    "workflow_resume_selectize_tmc_visibility_unit_test.mjs",
    "universal_action_lifecycle_unit_test.mjs",
    "universal_action_guide_contract_test.mjs",
    "trace_recorder_v2_contract_test.mjs",
    "trace_recorder_bounded_unit_test.mjs",
    "important_logging_unit_test.mjs",
    "observability_unit_test.mjs",
    "observability_content_unit_test.mjs",
    "poll_terminal_unit_test.mjs",
    "route_controller_unit_test.mjs",
    "pbx_call_context_unit_test.mjs",
    "pbx_provider_namespace_unit_test.mjs",
    "pbx_observer_unit_test.mjs",
    "updater_core_unit_test.mjs"
]:
    ok = False
    detail = "node unavailable"
    if node:
        proc = subprocess.run(
            [node, str(ROOT / "tests" / test_name)],
            text=True,
            capture_output=True
        )
        ok = proc.returncode == 0
        detail = proc.stdout.strip() or proc.stderr.strip()
    check(f"{test_name} passes", ok, detail)

jsdom_module = os.environ.get("SIMNET_JSDOM_MODULE", "")
for test_name in [
    "poll_terminal_dom_integration_test.mjs",
    "guide_evidence_dom_integration_test.mjs",
    "graph_studio_dom_integration_test.mjs",
    "call_registration_dom_integration_test.mjs",
    "operator_trace_privacy_dom_test.mjs",
    "late_poll_response_dom_test.mjs"
]:
    if not node:
        skip(f"{test_name} passes", "node unavailable")
        continue
    if not jsdom_module:
        skip(f"{test_name} passes", "SIMNET_JSDOM_MODULE unavailable; browser-DOM fixture retained for environments with jsdom")
        continue
    proc = subprocess.run(
        [node, str(ROOT / "tests" / test_name)],
        text=True,
        capture_output=True,
        env={**os.environ, "SIMNET_JSDOM_MODULE": jsdom_module}
    )
    check(
        f"{test_name} passes",
        proc.returncode == 0,
        proc.stdout.strip() or proc.stderr.strip()
    )

background = (ROOT / "src/background.js").read_text(encoding="utf-8")
policy = (ROOT / "src/core/locator-policy.js").read_text(encoding="utf-8")
signals = (ROOT / "src/core/locator-signals.js").read_text(encoding="utf-8")
billing = (ROOT / "src/adapters/billing-adapter.js").read_text(encoding="utf-8")
userside = (ROOT / "src/adapters/userside-adapter.js").read_text(encoding="utf-8")
guide = (ROOT / "src/ui/guide.js").read_text(encoding="utf-8")
observer = (ROOT / "src/core/locator-observer.js").read_text(encoding="utf-8")
handoff = (ROOT / "src/core/handoff.js").read_text(encoding="utf-8")
messages = (ROOT / "src/shared/messages.js").read_text(encoding="utf-8")
rail = (ROOT / "src/ui/rail.js").read_text(encoding="utf-8")
knowledge = (ROOT / "src/ui/knowledge-base.js").read_text(encoding="utf-8")
poll_terminal = (ROOT / "src/ui/poll-terminal.js").read_text(encoding="utf-8")
bootstrap = (ROOT / "src/content/bootstrap.js").read_text(encoding="utf-8")
tmc_match = (ROOT / "src/core/tmc-match.js").read_text(encoding="utf-8")
interaction_guards = (ROOT / "src/core/interaction-guards.js").read_text(encoding="utf-8")
route_controller = (ROOT / "src/core/route-controller.js").read_text(encoding="utf-8")
context_engine = (ROOT / "src/core/context-engine.js").read_text(encoding="utf-8")

check(
    "route controller gates facts before canonical merge",
    "gateContextForCommit" in background
    and "routeActionBefore" in background
    and "classifyContextRelation" in background
    and "PASSIVE_PON_FIELDS" in route_controller
    and "billing_onu_poll" in route_controller,
    "off-route poll/TMC/MAC pages may be observed but cannot rewrite route facts"
)
check(
    "direct Ethernet access is classified from bound subscriber and switch-port evidence",
    "function classifyEthernetAccessPoint" in userside
    and "ownerMatched" in userside
    and "ethernetCsmacd" in userside
    and "ponIdentity" in userside
    and "type: 'ETHERNET_ACCESS_POINT'" in userside,
    "matching subscriber + Ethernet interface + switch port; PON identities are excluded"
)
check(
    "Ethernet route collects switch FDB and target-port error evidence",
    "type: 'ETHERNET_DEVICE'" in userside
    and "type: 'ETHERNET_FDB_RESULT'" in userside
    and "type: 'ETHERNET_PORT_ERRORS'" in userside
    and "accessFdbInterface" in userside
    and "accessVlan" in userside
    and "accessErrorsStatus" in userside,
    "switch → FDB MAC/port/VLAN → interface-error snapshot"
)
check(
    "Ethernet diagnostic pages stay attached to the subscriber case",
    "kind: 'device_interface_errors'" in context_engine
    and "kind: 'device_interface_list'" in context_engine
    and "case 'device_poller'" in userside
    and "case 'device_interface_errors'" in userside
    and "caseData.network?.accessDeviceId" in background,
    "device/FDB/error subroutes correlate through accessDeviceId"
)
check(
    "Ethernet policy is separate from PON and has a finite evidence sequence",
    "route.ethernet-open-switch" in policy
    and "route.ethernet-check-fdb" in policy
    and "route.ethernet-check-errors" in policy
    and "route.ethernet-summary" in policy
    and "LocatorAction.CHECK_ETHERNET_FDB" in policy
    and "LocatorAction.CHECK_ETHERNET_ERRORS" in policy
    and "LocatorAction.ETHERNET_SUMMARY" in policy,
    "technical review → switch → FDB → errors → summary; no ONU/OLT dependency"
)
check(
    "LIVE presents Ethernet switch facts without a false ONU/OLT shortage",
    "diagnostic.isEthernet" in rail
    and "accessDeviceName" in rail
    and "accessPort" in rail
    and "accessVlan" in rail
    and "isEthernet ? []" in rail
    and "userside.ethernet-summary" in knowledge,
    "Ethernet-specific LIVE/Facts card and explanation; PON group hidden"
)
check(
    "off-route poll confirmation is rejected in locator core",
    "invalid-poll-confirmation" in policy
    and "details.pollCompleted === true" in policy
    and "details.pollResponded === true" in policy
    and "details.requestObserved === true" in policy
    and "observation.routeRelation === 'on_route'" in policy,
    "confirmed requires real request/response/on-route evidence"
)
check(
    "MutationObserver cannot race Workbench into stale clicks/scans",
    "isWorkbenchMutation" in interaction_guards
    and "domEpoch" in interaction_guards
    and "poll-click-target-mutated" in interaction_guards
    and "scanInFlight" in bootstrap
    and "pendingScan" in bootstrap
    and "waitForUiReady" in bootstrap,
    "Workbench mutations are ignored; external DOM churn is serialized and click targets are revalidated"
)
check(
    "double/triple poll and Guide clicks are single-flight guarded",
    "POLL_LOCK_MS = 900" in interaction_guards
    and "previousAttempt.pending !== false" in interaction_guards
    and "POLL_ATTEMPT_UPDATE" in interaction_guards
    and "duplicate-poll-click" in interaction_guards
    and "duplicate-poll-dblclick" in interaction_guards
    and "duplicate-guide-click" in interaction_guards
    and "target-pointerdown" not in guide
    and "recordActionOnce('target-click'" in guide,
    "pointerdown is not ACTION; repeated poll/Guide clicks are blocked before duplicate work"
)

correlation = (ROOT / "src/core/correlation.js").read_text(encoding="utf-8")
store_client = (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
juniper_prefetch = (ROOT / "src/core/juniper-prefetch.js").read_text(encoding="utf-8")

check(
    "Case Processor owns correlated diagnostic commits",
    "finalizeCaseCommits(state, previousState)" in background
    and "caseData.caseVersion" in background
    and "caseData.routeGeneration" in background
    and "validateDiagnosticInvariants" in background
    and "await writeState(state)" in background,
    "single queued commit, caseVersion and routeGeneration invariants"
)
check(
    "route relation is recomputed in background",
    "observation.producerRouteRelation" in background
    and "observation.routeRelation = classifyObservationRelation" in background
    and "observation.routeRelation ||=" not in background,
    "producer relation is metadata only"
)
check(
    "async Juniper response is pinned to its originating case",
    "Freeze the case/episode/route at request start" in juniper_prefetch
    and "requestId" in juniper_prefetch
    and "caseId: String(pin?.caseId || '')" in juniper_prefetch
    and "activeCaseId or the tab's current binding" in background,
    "caseId/episodeId/requestId/routeGeneration return with the response"
)
check(
    "same case keeps independent tab/document views",
    "result.viewsByTab ||= {}" in background
    and "storeViewContext(caseData, envelope, nextContext)" in background
    and "senderDocumentId" in correlation,
    "Billing/UserSide/OLT contexts do not overwrite one another"
)
check(
    "document callbacks are latest-wins while DOM scans are coalesced",
    "documentGeneration" in bootstrap
    and "scanDocumentGeneration !== documentGeneration" in bootstrap
    and "pageInstanceStartedAt" in correlation
    and "stale-document" in correlation,
    "old document results cannot publish; ordinary DOM mutations no longer cancel valid active scans"
)
check(
    "Juniper async response survives route progress",
    "result.juniper.dataStatus" in background
    and "asynchronousJuniper" in background
    and "requireIdentity: !asynchronousJuniper" in background
    and "requireCurrentRoute: !asynchronousJuniper" in background
    and "caseData.juniper =" in background,
    "pinned Case/episode/request accepts the read-only response after Guide advances"
)
check(
    "correlation verdict is journaled",
    "CORRELATION" in background
    and all(token in background for token in [
        "caseVersion", "routeGeneration", "documentId", "requestId", "pollAttemptId", "verdict", "reason"
    ]),
    "JSON explains why state mutation was accepted, passive, stale or rejected"
)

check(
    "wrong poll tab cannot terminate Guide",
    "expectedPollAction" in billing
    and "rowExpectedPollAction" in billing
    and "wrongPollTab" in billing
    and "rawPollResponded" in billing
    and "requestObserved" in billing
    and "!wrongPollTab" in billing
    and "passive: wrongPollTab" in billing,
    "known EPON case cannot be completed from GPON/GCOM/Huawei tab"
)
check(
    "poll click is action-locked and semantic-target guarded",
    "duplicate-poll-click" in interaction_guards
    and "pollBindingVerdict" in interaction_guards
    and "poll-page-not-ready" in interaction_guards
    and "poll-request-document-not-opened" in interaction_guards
    and "POLL_LOCK_MS" in interaction_guards
    and "guideRunInFlight" in rail,
    "rapid clicks stay single-flight without requiring silence from the whole Billing DOM"
)
check(
    "late real OLT response replaces a premature timeout and stays in the Case",
    "preservePollAttemptForNativeNavigation" in interaction_guards
    and "beforeunload" in interaction_guards
    and "isRecoverableLatePollResponse" in interaction_guards
    and "responseEvidence: rawPollResponded" in billing
    and "lateResponseRecovery" in billing
    and "exactLateResponse" in background
    and "late-poll-response-confirmed" in background
    and "POLL CONFIRMED · получен поздний ответ OLT" in background,
    "TIMEOUT → exact askolt response → CONFIRMED is latched across Billing Back navigation"
)
check(
    "confirmed OLT evidence is stored in a durable per-Case LIVE snapshot",
    "commitConfirmedOltSnapshot" in background
    and "caseData.live.oltSnapshot = next" in background
    and "snapshot: durableSnapshot" in billing
    and "currentCase.live?.oltSnapshot || null" in rail
    and "failed result must not clear the confirmed LIVE snapshot" in (
        ROOT / "tests/case_processor_integration_test.mjs"
    ).read_text(encoding="utf-8"),
    "MAC, Ethernet, optics and history survive Back/reload; failures cannot erase the confirmed snapshot"
)
check(
    "cold native poll response keeps its originating Case and PollAttempt",
    "exactColdPollResponse" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "attemptCase" in (ROOT / "src/core/store-client.js").read_text(encoding="utf-8")
    and "localCaseId, ''" in (
        ROOT / "tests/store_client_cold_poll_response_unit_test.mjs"
    ).read_text(encoding="utf-8"),
    "new content script adopts only the exact same-tab response operation before localCaseId is initialized"
)
check(
    "explicit G-COM marker overrides generic GPON in every routing layer",
    "g[\\s_-]*com" in billing.lower()
    and "g[\\s_-]*com" in signals.lower()
    and "g[\\s_-]*com" in policy.lower()
    and "attemptAction" in route_controller,
    "Vernadsky-24-GPON (...) G-COM resolves to GCOM / a=312"
)
check(
    "opening a poll tab without a request emits no poll attempt",
    "locatorObservations: requestObserved ? [" in billing
    and "requestObserved" in billing,
    "tab load/click is not POLL COMPLETE; only an actual request episode can emit POLL_RESULT"
)
check(
    "TMC is a hard gate before MAC fallback",
    "guard.tmc-before-network" in policy
    and "NETWORK_FALLBACK_ACTIONS" in policy,
    "incidental MAC/equipment evidence cannot outrun TMC in the operational route"
)
check(
    "OLT vendor selects poll adapter independently of access interface",
    "technologyFromEvidence" in signals
    and "candidate.pollAction = tech.action" in policy
    and "olt-vendor" in signals,
    "Huawei OLT + EPON interface resolves to Huawei action 313"
)
check(
    "Guide waits for a stable target before showing Focus Layer",
    "waitForStableTarget" in guide
    and "hint-superseded" in guide
    and "relatedResolver" in guide
    and "visibility: hidden" in guide,
    "no one-frame Focus Layer flash while Billing DOM is moving"
)
check(
    "MAC history transit switch is not promoted to OLT",
    "isLikelyPonOltCandidate" in policy
    and "obviousTransit" in policy,
    "Arista/Port-Channel first hop remains topology evidence"
)
check(
    "terminal success requires response facts instead of wrapped commands",
    "analysisHasSubscriberResponse" in poll_terminal
    and "Wrapped command blocks are not evidence by themselves" in poll_terminal
    and "hasSuccessfulAnalysis" in poll_terminal,
    "CLI errors cannot become pollResponded merely because blocks exist"
)

check(
    "policy engine is declarative",
    "const POLICY_RULES = [" in policy
    and "priority:" in policy
    and "ruleId" in policy,
    "ordered independent rules"
)
check(
    "adapters emit observations instead of choosing routes",
    "locatorObservations" in billing
    and "locatorObservations" in userside
    and "POLICY_RULES" not in billing
    and "POLICY_RULES" not in userside,
    "sources report; policy decides"
)
check(
    "poll completion is independent from identity matching",
    all(token in signals for token in [
        "pollResponded",
        "identityAssessment",
        "identityConflicts",
        "result = 'confirmed'"
    ])
    and "generic word such as `online`" in signals,
    "ONU response closes poll; identity mismatch remains a finding"
)
check(
    "not-found rejection is scoped to a binding",
    "rejectionScope: result === 'not_found'" in policy
    and "bindingFingerprint" in policy
    and "The OLT itself may" in policy,
    "OLT is not globally banned"
)
check(
    "terminal outcomes are explicit",
    all(token in policy for token in [
        "CONFIRMED: 'confirmed'",
        "NOT_FOUND: 'not_found'",
        "INCONCLUSIVE: 'inconclusive'",
        "BLOCKED: 'blocked'",
        "MANUAL_REVIEW: 'manual_review'"
    ]),
    "five completion classes"
)
check(
    "completed Guide steps cannot reactivate",
    "completed-step-is-terminal" in background
    and "ensureGuideShape(caseData).active = null" in background,
    "late cross-tab hint/action cannot reopen a finished Guide step"
)

check(
    "button click does not finish workflow",
    "POLL_RESULT" in policy
    and "WAIT_POLL" in policy
    and "COMPLETE_CONFIRMED" in policy
    and "outcome" in billing,
    "result evaluated after action"
)
check(
    "save uses intent then post-navigation verification",
    "BILLING_OLT_SAVE_INTENT" in policy
    and "sourceDocumentId" in observer
    and "post-navigation-verification" in background
    and "!== pendingSave.sourceDocumentId" in background,
    "no false saved state on click"
)
check(
    "core save observation works without Guide Mode",
    "native-save-click" in observer
    and "LOCATOR_APPLY_OBSERVATION" in observer
    and "guide" not in observer.lower(),
    "native page observer"
)
check(
    "handoff remains mandatory and tab-safe",
    all(token in background for token in [
        "HANDOFF_TTL_MS",
        "sourceTabId",
        "targetTabId",
        "attachHandoffToContext"
    ])
    and "simnet-wb-handoff" in handoff,
    "same case across Billing/UserSide"
)
check(
    "UserSide branches include TMC MAC and topology",
    all(token in userside for token in [
        "TMC_RESULT",
        "CUSTOMER_MACS",
        "MAC_SEARCH_RESULT",
        "INTERFACE_CONFIRMATION",
        "DEVICE_DETAILS",
        "uplink_downlink"
    ]),
    "search sources"
)
check(
    "TMC identity rows are supplemental evidence",
    "Identity comparison is informational" in tmc_match
    and "only help rank multiple TMC blocks" in userside
    and "identity_mismatch" in tmc_match
    and "identity_incomplete" in tmc_match,
    "OLT discovery is not blocked by ONU identity rows"
)
check(
    "TMC OLT is accepted whenever name or IP is found",
    "const hasOlt = Boolean" in policy
    and "result: hasOlt ? 'found' : result" in policy
    and "candidateDetails.oltName || candidateDetails.oltIp" in policy,
    "name/IP creates the TMC candidate"
)
check(
    "Guide shows TMC highlight and Billing return together",
    "tmcFoundText" in guide
    and "title: 'OLT найдена в ТМЦ'" in guide
    and "focusSource: true" in guide
    and "next?.focusSource" in rail
    and "Подсветить" in rail
    and "Вернуться в Billing" in rail,
    "both actions remain visible"
)
check(
    "compact rail is click-driven and does not depend on hover expansion",
    "this.activeView = null" in rail
    and "this.viewButton('call', 'call-registration'" in rail
    and "this.viewButton('graph', 'view-graph'" in rail
    and "this.viewButton('live', 'view-live'" in rail
    and "this.viewButton('full', 'view-full'" in rail
    and "Boolean(this.hoverOpen && !this.guideActive)" not in rail,
    "Call / Graph / LIVE / More are explicit operator actions"
)

action_lifecycle = (ROOT / "src/core/action-lifecycle.js").read_text(encoding="utf-8")
check(
    "Guide overlay uses stable explicit dismissal with no SHOWN TTL",
    "class=\"tip-close\"" in guide
    and "data-dismiss-guide" in guide
    and "event.key === 'Escape'" in guide
    and "cleanupTimer" not in guide
    and "['NAVIGATING', 'DESTINATION_REACHED', 'WAITING_TARGET', 'TARGET_READY']" in action_lifecycle
    and "Critical invariant: SHOWN has no TTL" in action_lifecycle,
    "target-acquisition timeout is centralized in the lifecycle; Focus after SHOWN persists until an explicit lifecycle reason"
)
check(
    "TMC guide exposes Billing return inside the overlay",
    "tip-action" in guide
    and "Вернуться в Billing" in guide
    and "currentPlan.focusSource" in guide
    and "executePlanNavigation(" in guide,
    "highlight and safe return are available together"
)
check(
    "TMC highlight isolates semantic text lines",
    "tmcHighlightTarget" in guide
    and "document.createTreeWalker" in guide
    and "document.createRange" in guide
    and "unionRects" in guide,
    "exact OLT/IP/Serial/MAC block cutout"
)
check(
    "UserSide MAC hint highlights the semantic IP/MAC row",
    "rowHighlightTarget" in guide
    and "resolver: () => rowHighlightTarget(findCustomerMacSearchLink(caseData))" in guide
    and ":scope > th, :scope > td" in guide,
    "the ring covers the useful row instead of only the search icon"
)
check(
    "MAC-history result is informational instead of equipment-navigation CTA",
    "id: 'userside.mac-result'" in guide
    and "knowledgeId: 'userside.mac-result'" in guide
    and "candidateResultTarget(caseData)" in guide
    and "kind: 'navigate',\n            url: candidateDeviceUrl(caseData)" not in guide,
    "matched date/equipment/port/VLAN row is highlighted without Guide opening the device"
)
check(
    "MAC-result overlay branches only on known OLT IP",
    "function macResultOverlayAction" in guide
    and "action: 'open-candidate-device'" in guide
    and "Открыть OLT и посмотреть IP" in guide
    and "action: 'return-customer'" in guide
    and "Вернуться к абоненту" in guide,
    "missing IP -> equipment card; known IP -> subscriber card"
)
check(
    "panel interactions cannot silently replace an active Guide focus",
    "guide:active" in rail
    and "shell.classList.toggle('guide-active'" in rail
    and "if (this.guideActive) WB.guide.clear('USER_INTERRUPTED')" in rail
    and "mouseenter" not in rail
    and "mouseleave" not in rail,
    "rail is click-driven; explicit operator interaction dismisses Focus with a lifecycle reason instead of hover-driven replacement"
)
check(
    "Focus Layer lightly separates current and related fields",
    "class=\"shade shade-top\"" in guide
    and "background: rgba(5,10,16,.22)" in guide
    and "pointer-events: none" in guide
    and "related-marker" in guide
    and "1 · Сейчас" in guide,
    "mild non-blocking backdrop + numbered semantic fields"
)
check(
    "Guide card avoids the floating Workbench dock area",
    "railLeftBoundary()" in guide
    and "safeRight" in guide
    and "width: min(310px, calc(100vw - 88px))" in guide,
    "tooltip still clamps left of the floating icon dock"
)
check(
    "highlight navigation uses the original target link",
    "targetNavigationUrl" in guide
    and "executePlanNavigation" in guide
    and "currentPlan.kind === 'highlight'" in guide
    and "location.assign(targetUrl)" in guide,
    "no route re-plan before the explicit transition"
)
check(
    "floating icon dock overlays CRM without reserving page width",
    "right: '12px'" in rail
    and "bottom: '18px'" in rail
    and "background:transparent" in rail
    and "box-shadow:none" in rail
    and "width:48px" in rail
    and "document.body.style.paddingRight" not in rail
    and "applyRailReservation" not in rail
    and '<div class="rail-spacer"' not in rail,
    "Call / Graph / LIVE / More are a small overlay dock; Billing/UserSide keep full width"
)
check(
    "repeated quick hint does not recreate an active overlay",
    "Подсказка уже открыта" in rail
    and "alreadyActive: true" in guide,
    "no clear-and-show flicker"
)

check(
    "route resumes through neutral detours",
    "shouldContinueTabCase" in background
    and "previousTabCaseId" in background
    and "continuationCaseId" in background
    and "updateRouteCheckpoint" in background
    and "result.route.resume" in background,
    "payments/lists do not restart the subscriber case"
)

check(
    "compact rail keeps Guide inside LIVE instead of adding a fifth primary button",
    "this.viewButton('live', 'view-live'" in rail
    and "live-ready" in rail
    and "guideActions(next)" in rail
    and "WB.guide.runNext" in rail,
    "LIVE exposes the existing recommendation/highlight flow"
)
check(
    "unified Guide runner prefers current-page highlight",
    "async function runNext" in guide
    and "if (currentPlan.kind === 'highlight')" in guide
    and "return highlight(caseData)" in guide
    and "return navigate(caseData)" in guide,
    "highlight first, then safe navigation"
)
check(
    "highlight overlays never navigate through nested target links",
    "currentPlan.kind === 'highlight' && targetUrl" not in guide
    and "A highlight is guidance only" in guide
    and "operatorMustClickPageControl" in guide,
    "operator clicks the real page control; no accidental reload/re-poll CTA"
)
check(
    "DOM scan cannot be starved by continuous page mutations",
    "SCAN_MAX_WAIT_MS" in bootstrap
    and "scanQueuedAt" in bootstrap
    and "scheduledForce = scheduledForce || force" in bootstrap,
    "terminal response and rail state are processed without manual refresh"
)
check(
    "terminal result layer has no Guide focus path",
    "simnet-wb-poll-command-block" not in guide
    and "WB.pollTerminal?.focusBlock" not in guide
    and "lite: true" not in guide,
    "terminal evidence cannot be promoted into a Guide overlay or focus action"
)
check(
    "LIVE activity indicator only appears for an actionable Guide plan",
    "guideActionable(quickPlan)" in rail
    and "quickReady ? 'live-ready' : ''" in rail
    and ".rail-btn.live-ready:after" in rail,
    "rail status dot is informational and does not create a dead Guide control"
)
check(
    "service worker version matches manifest",
    f"const VERSION = '{manifest.get('version')}';" in background,
    "runtime PING reports package version"
)

check(
    "knowledge base loads before Guide",
    loaded_js.index("src/ui/knowledge-base.js")
    < loaded_js.index("src/ui/guide.js"),
    "static explanations are independent from routes"
)
check(
    "initial microlearning dictionary covers known targets",
    all(token in knowledge for token in [
        "billing.technical-data",
        "billing.userside-link",
        "billing.olt-field",
        "userside.tmc-olt",
        "billing.ask-olt",
        "userside.mac-search",
        "userside.uplink-downlink",
        "userside.interface"
    ]),
    "Billing and UserSide starter concepts"
)
check(
    "Guide renders reusable compact microlearning layers",
    "WB.knowledge?.resolve" in guide
    and "Compact Focus Layer" in guide
    and "animation: simnetWbGuidePulse .7s ease-out 1" in guide,
    "compact Focus Layer; knowledge still resolves; one subtle target pulse"
)
check(
    "poll terminal markup loads before Guide",
    "src/ui/poll-terminal.js" in loaded_js
    and loaded_js.index("src/ui/poll-terminal.js") < loaded_js.index("src/ui/guide.js"),
    "command blocks are available as semantic Guide anchors"
)
check(
    "poll terminal keeps semantic importance tiers",
    all(token in poll_terminal for token in [
        "ont_info",
        "ont_port_state",
        "mac_address",
        "service_port",
        "data-simnet-importance",
        "critical",
        "high",
        "medium",
        "reference"
    ])
    and "color:" in poll_terminal
    and "rgba(" in poll_terminal,
    "stable importance model under the stronger evidence-first presentation"
)
check(
    "poll terminal is isolated from Guide targets",
    "WB.pollTerminal?.findBlock" not in guide
    and "WB.pollTerminal.focusBlock" not in guide
    and "findBlock," not in poll_terminal
    and "focusBlock," not in poll_terminal
    and "const commandBlocks = WB.pollTerminal?.snapshot?.() || []" in billing
    and "commandBlocks," in billing,
    "terminal blocks remain evidence/markup but cannot become Guide steps"
)
check(
    "Huawei poll parser reads output-specific identity evidence",
    "observedSubscriberMac" in signals
    and "observedSerialAliases" in signals
    and "Command arguments identify what was requested" in signals
    and "command arguments" in signals
    and "normalizeMac(expectedSubscriberMac) === normalizeMac(observedSubscriberMac)" in signals,
    "only parsed terminal output, not command/profile text, can confirm subscriber MAC or serial"
)

check(
    "confirmed Huawei result terminates without unsolicited Ethernet advice",
    "case 'complete_confirmed':" in guide
    and "id: 'result.confirmed'" in guide
    and "title: 'Опрос ONU выполнен'" in guide
    and "Terminal command blocks are visual/educational semantics, not automatic route steps" in guide
    and "billing.onu-port-state" not in guide,
    "terminal semantics remain available without becoming a forced route step"
)
check(
    "terminal output can only close Guide, never create a Guide plan",
    "simnet-workbench-guide-overlay" in poll_terminal
    and "terminal:result-view" in guide
    and "terminal.passive-result" not in guide
    and "passiveTerminal" not in guide
    and "terminalResultPresent" in poll_terminal,
    "one-way safety boundary between operational Guide and passive terminal result layer"
)
check(
    "terminal passive mode detects output before semantic wrapping",
    "hadResultBeforeMarkup" in poll_terminal
    and "RESULT_MARKERS" in poll_terminal
    and "enterPassiveResultView(root)" in poll_terminal,
    "unknown or newly arrived Huawei output is passive before block markup finishes"
)
check(
    "terminal state is explicit without animation",
    "data-simnet-state" in poll_terminal
    and "attention" in poll_terminal
    and "normal" in poll_terminal
    and "content:\"✓ \"" in poll_terminal
    and "content:\"! \"" in poll_terminal
    and "animation:" not in poll_terminal,
    "state is duplicated by text symbols and never blinks"
)

check(
    "terminal relation axis is independent from health state",
    "data-simnet-relation" in poll_terminal
    and "relation: baseRelationForAnalysis(item)" in poll_terminal
    and all(token in poll_terminal for token in ["'primary'", "'dependent'", "'context'", "'conflict'"]),
    "PRIMARY/DEPENDENT/CONTEXT/CONFLICT do not overload normal/attention"
)

check(
    "terminal cross-block logic keeps offline state above stale MAC evidence",
    "ONU сейчас OFFLINE: это не подтверждение текущего Ethernet-линка." in poll_terminal
    and "item.relation = 'dependent'" in poll_terminal
    and "item.relation = 'context'" in poll_terminal
    and r"show\s+ont-logging\s+buffer" in poll_terminal
    and "optical_overview" in poll_terminal,
    "offline dominates stale MAC; dependent commands/history stay semantically separated"
)

check(
    "Ask OLT click closes only the visual hint, not the workflow",
    "currentPlan?.id === 'billing.ask-olt'" in guide
    and "TARGET_ACTIVATED_PENDING_RESULT" in guide
    and "completeActivePollActionFromEvidence" in guide
    and "poll:attempt-resolved" in guide
    and "validated-olt-terminal-result" in guide,
    "poll click is intent only; ActionSession stays active until validated terminal evidence or terminal failure"
)

check(
    "confirmed rail replaces acquisition warning with live ONU result",
    "terminal:result-view" in rail
    and "terminal:interpreted" in rail
    and "Живой опрос ONU" in rail
    and "Ответ оборудования получен" in rail
    and "terminal-evidence-row" in rail
    and "ONU не опрошено" not in rail
    and "pon-live-goal" not in rail,
    "terminal evidence remains the informational layer; the old standing acquisition warning/checklist is removed entirely"
)

check(
    "poll terminal recognizes traffic and Ethernet statistics blocks",
    "ont_traffic" in poll_terminal
    and "eth_statistics" in poll_terminal
    and "display\\s+statistics\\s+ont-eth" in poll_terminal,
    "all major Huawei result sections can be marked together"
)

check(
    "Guide covers policy actions",
    all(token in guide for token in [
        "check_juniper",
        "poll_current_binding",
        "check_tmc",
        "search_mac",
        "search_uplink_downlink",
        "inspect_interface",
        "inspect_device",
        "fill_billing_olt",
        "complete_confirmed",
        "complete_not_found"
    ]),
    "branch-aware visual helper"
)
check(
    "Guide remains on-demand and no automatic clicks",
    "scrollIntoView" in guide
    and "pointer-events: none" in guide
    and ".click()" not in guide
    and ".click()" not in observer,
    "operator keeps control"
)
check(
    "Guide avoids recorded positional selectors",
    "nth-child" not in guide
    and "nth-of-type" not in guide,
    "semantic locators"
)
check(
    "Guide never targets reboot",
    "reboot" not in guide.lower(),
    "safe action boundary"
)
check(
    "new store schema migrates v4",
    "simnet_workbench_state_v5" in background
    and "migrateV4" in background
    and "schemaVersion: 5" in background,
    "state v5"
)


# Shared TMC parser regression checks
tmc_parser = (ROOT / "src/core/tmc-parser.js").read_text(encoding="utf-8")
check(
    "shared TMC parser recognizes Workbench OLT semantics",
    all(token in tmc_parser for token in [
        "найдено|знайдено",
        'a[href*="/device/"]',
        "oltName",
        "oltIp",
        "deviceId",
        "interface",
        "serial",
        "mac"
    ]),
    "Найдено на OLT + /device/ + IP/Serial/MAC/Interface"
)
check(
    "UserSide adapter delegates TMC parsing to shared parser",
    "WB.tmcParser?.findBlocks" in userside
    and "WB.tmcParser?.parseBlock" in userside,
    "no separate live-only TMC parser"
)

# Data Audit UX / safety regression checks
audit_js = (ROOT / "src/audit/audit.js").read_text(encoding="utf-8")
audit_html = (ROOT / "src/audit/audit.html").read_text(encoding="utf-8")
audit_launcher = (ROOT / "src/audit/launcher.js").read_text(encoding="utf-8")
audit_tmc_parser_loaded = '../core/tmc-parser.js' in audit_html
check(
    "Data Audit uses the same shared TMC parser as Workbench",
    audit_tmc_parser_loaded
    and "globalThis.SIMNET_TMC_PARSER" in audit_js
    and "tmc:profile:" in audit_js
    and "cached.tmcParserVersion === parserVersion" in audit_js
    and "tmcParseStatus" in audit_js,
    "shared parser + cache version bump + parse diagnostics"
)


check(
    "Data Audit capture accumulates manual Billing pages into one draft",
    "mergeCapturedPage" in audit_js
    and "collectionDraft" in audit_js
    and "requests: 0" in audit_launcher,
    "any current listuser page is parsed locally and merged with deduplication"
)
check(
    "Data Audit saved group separates Open from Add to audit",
    "data-open-group" in audit_js
    and "data-use-group" in audit_js
    and "openGroupModal" in audit_js,
    "saved group is inspectable without implicitly creating another group"
)
check(
    "Data Audit default mode is OLT-first ONU readiness",
    "auditMode: 'onu_identity_compare'" in audit_js
    and "ponReadinessAssessment" in audit_js
    and "Проверить OLT + готовность ONU" in audit_html,
    "primary route confirms OLT and simultaneously checks/fills ONU identifiers"
)
check(
    "Data Audit fixes markers onto the same saved group",
    "group.auditSnapshot" in audit_js
    and "markers[memberKey(row.member)]" in audit_js
    and "Состав группы фиксирован" in audit_js,
    "audit does not mutate group membership"
)
check(
    "Data Audit workspace draft persists across page navigation",
    "audit-draft" in audit_js
    and "loadWorkspaceDraft" in audit_js
    and "saveWorkspaceDraft" in audit_js,
    "temporary sources and selection survive navigation"
)
check(
    "Data Audit pause can finish with partial result",
    "AUDIT_CAPTURE_FINISH_HERE" in audit_launcher
    and "finishRequested" in audit_js
    and "Хватит — взять собранное" in audit_html,
    "pause, finish-here and cancel are separate controls"
)
check(
    "Data Audit exposes request and load forecast",
    "planBillingRequests" in audit_html
    and "planTmcRequests" in audit_html
    and "planLoad" in audit_html
    and "1 запрос за раз" in audit_js,
    "Billing/TMC estimates and sequential execution are visible"
)
check(
    "Data Audit remains read-only",
    "method: 'GET'" in audit_js
    and "AUDIT_FETCH_SAME_ORIGIN" in audit_js
    and "reboot" not in audit_js.lower()
    and "askolt" not in audit_js.lower(),
    "no reboot/askolt path in audit module"
)

check(
    "Data Audit Billing parser requires a real subscriber link",
    "if (!billingId) continue;" in audit_launcher
    and "action !== 'user' && action !== 'dopdata'" in audit_launcher,
    "note/history rows with a bare abon mention are ignored"
)
check(
    "Data Audit Billing parser has no page-wide abon fallback",
    "doc.body?.innerText" not in audit_launcher
    and "Deliberately no page-wide fallback" in audit_launcher,
    "subscriber discovery stays row-scoped"
)
check(
    "Data Audit Billing parser keeps valid ids on deduplication",
    "const memberIndex = new Map();" in audit_launcher
    and "members[existingIndex].billingId = cleanBillingId" in audit_launcher,
    "a weak duplicate cannot poison the valid subscriber record"
)
check(
    "Data Audit has a direct PON filter path",
    "Только PON" in audit_html
    and "billing.connectionFamily" in audit_js
    and "normalizeConnectionFamily" in audit_js,
    "five-page draft can be filtered to PON before group creation"
)
check(
    "Data Audit can save filtered subscribers as a group",
    "saveFilteredGroupModal" in audit_js
    and "Сохранить отобранных как группу" in audit_html
    and "source: { type: 'filtered-result'" in audit_js,
    "selection -> Billing filter -> persistent group"
)
check(
    "Data Audit main check is OLT-first readiness and always enters TMC",
    "Готовность ONU / OLT: Billing ↔ ТМЦ" in audit_js
    and "ponReadinessAssessment" in audit_js
    and "row.billingMatch = true; // Для проверки готовности всегда идём в ТМЦ" in audit_js
    and "status: 'olt_mismatch'" in audit_js,
    "every Billing field-combination reaches TMC; OLT mismatch remains a problem even if ONU identity matches"
)
check(
    "Data Audit records contextual next action when TMC is insufficient",
    "nextAction: searchMac ? 'search_mac' : 'manual_lookup'" in audit_js
    and "Следующий источник — поиск MAC" in audit_js
    and "searchMac" in audit_js,
    "Billing -> TMC -> equipment MAC search is explicit without automating equipment traversal yet"
)
check(
    "Data Audit distinguishes missing Billing fields from mismatch",
    "status = 'needs_olt'" in audit_js
    and "status = 'needs_serial'" in audit_js
    and "status = 'needs_mac'" in audit_js
    and "ТМЦ дала недостающие данные" in audit_js,
    "missing OLT/SN/MAC produces fill advice rather than a false mismatch"
)
check(
    "TMC parser has bounded DOM evidence escalation",
    "DOM_TRACE_MAX_LEVELS = 4" in tmc_parser
    and "scope_too_large" in tmc_parser
    and "AMBIGUOUS" in tmc_parser
    and "page_root_forbidden" in tmc_parser
    and "buildDomTrace" in tmc_parser,
    "max four DOM levels with anchor/ambiguity and hard boundaries"
)
check(
    "Data Audit preserves failed members as an issue set inside group history",
    "group.auditHistory" in audit_js
    and "issueMembers" in audit_js
    and "История проверок" in audit_js,
    "group membership stays fixed while check history stores failures"
)
check(
    "Data Audit has persistent semantic journal",
    "createObjectStore('logs'" in audit_js
    and "logEvent(" in audit_js
    and "История действий Data Audit" in audit_html,
    "important operator actions are stored semantically in IndexedDB"
)
check(
    "Data Audit hides mixing controls for a single source",
    "mixSection.hidden = groups.length <= 1" in audit_js
    and 'id="mixSection" hidden' in audit_html,
    "one-group workflow stays filter-first instead of set-theory-first"
)

resume_fixture_path = ROOT / "tests/fixtures/guide_resume_route.json"
resume_fixture_ok = False
resume_fixture_detail = "missing"
if resume_fixture_path.exists():
    resume_fixture = json.loads(
        resume_fixture_path.read_text(encoding="utf-8")
    )
    expected = resume_fixture.get("expected", {})
    checkpoint = resume_fixture.get("checkpoint", {})
    resume_fixture_ok = all([
        expected.get("sameCase") is True,
        expected.get("restartFromTechnical") is False,
        expected.get("nextAction") == "fill_billing_olt",
        checkpoint.get("action") == "fill_billing_olt"
    ])
    resume_fixture_detail = "neutral detour keeps unresolved checkpoint"

check(
    "Data Audit uses a hard-gated human wizard",
    all(token in audit_html for token in [
        'data-wstep="1"', 'data-wstep="2"', 'data-wstep="3"',
        'data-wstep="4"', 'data-wstep="5"', 'data-wstep="6"',
        'Сколько страниц Billing собрать?', 'Кого оставить из собранных?',
        'Сохрани отобранных как группу', 'Что проверить в этой группе?'
    ])
    and "wizardMaxUnlocked" in audit_js
    and "Сначала заверши текущий шаг" in audit_js,
    "future steps stay locked until the current step has a valid result"
)
check(
    "Data Audit page slider collects a requested sequential range",
    'id="pageCountRange"' in audit_html
    and 'min="1" max="20"' in audit_html
    and "AUDIT_CAPTURE_BILLING_PAGES" in audit_js
    and "captureBillingPages" in audit_launcher
    and "billingPageUrl" in audit_launcher
    and "url.searchParams.set('start', String(page))" in audit_launcher
    and "url.searchParams.delete('colnarrow')" in audit_launcher,
    "current page + requested following pages using native Billing pagination shape"
)
check(
    "Data Audit wizard exposes explicit save and controlled completed lifecycle",
    'wizardSaveProgressBtn' in audit_html
    and all(token in audit_html for token in ['wizardStep2Back','wizardStep3Back','wizardStep4Back','wizardStep5Back'])
    and 'wizardStep6Back' not in audit_html
    and 'wizardRepeatAudit' in audit_html
    and "Состояние Data Audit сохранено вручную" in audit_js,
    "operator can save progress; completed result starts a new check or a new audit"
)
check(
    "Data Audit saved groups expose CRUD",
    "openGroupModal" in audit_js
    and "editGroupModal" in audit_js
    and "deleteGroupModal" in audit_js
    and "saveWizardGroup" in audit_js,
    "create/read/update/delete group lifecycle"
)
check(
    "Data Audit keeps semantic journal in wizard",
    'wizardJournalBtn' in audit_html
    and 'wizardJournalBody' in audit_html
    and "renderJournal" in audit_js
    and "logEvent('ACTION'" in audit_js,
    "operator actions remain understandable after the run"
)


check(
    "Data Audit resolves UserSide through Billing gotouser IP first",
    "extractGotouserIp" in audit_js
    and "gotouser.php?ip=${encodeURIComponent(ip)}" in audit_js
    and "parseCustomerIdFromUrl(routed?.url)" in audit_js
    and audit_js.index("gotouser.php?ip=${encodeURIComponent(ip)}") < audit_js.index("customer_list/ajax_search?token=${Date.now()}"),
    "Billing IP handoff is primary; search is fallback"
)
check(
    "Data Audit UserSide fallback is exact and two-stage",
    "customer_list/ajax_search?token=${Date.now()}" in audit_js
    and "parseAjaxCustomerExact" in audit_js
    and "customer_list/search_page?search=" in audit_js
    and "parseSearchPageCustomerExact" in audit_js,
    "ajax exact match then search_page exact fallback"
)
check(
    "background fetch exposes final redirected URL",
    "url: response.url || String(url || '')" in background
    and "redirected: Boolean(response.redirected)" in background,
    "gotouser redirect can yield /customer/<id>"
)
check(
    "Data Audit request forecast includes resolver fallback worst case",
    "members.length * 4" in audit_js
    and "count * 4" in audit_js
    and "до 4 GET/абонента" in audit_html,
    "gotouser + ajax + search_page + TMC main <= 4 UserSide GET per candidate"
)
check(
    "Data Audit shows live network load telemetry",
    all(token in audit_html for token in ["requestBreakdown", "loadCounter", "resolverCounter", "wizardNetworkSummary"])
    and "runtimeRatePerMinute" in audit_js
    and "runtimeNetworkSnapshot" in audit_js
    and "maxInFlight" in audit_js,
    "Billing/UserSide counts, GET/min, active requests and resolver path are visible"
)
check(
    "Data Audit capture reports load while parsing Billing pages",
    "captureNetwork(task)" in audit_launcher
    and "phase:'fetch'" in audit_launcher
    and "avgRequestsPerMinute" in audit_launcher
    and "applyCaptureNetwork" in audit_js,
    "page collection publishes live request/load metrics"
)
check(
    "Data Audit saves network diagnostics with run and group check",
    "network: runtimeNetworkSnapshot()" in audit_js
    and "network: state.lastRun?.network || runtimeNetworkSnapshot()" in audit_js
    and "gotouser ${run.network.gotouserSuccess}/${run.network.gotouserAttempts}" in audit_js,
    "later analysis can use actual Billing/UserSide/resolver/load metrics"
)


# --- v1.7.29.36 Billing navigation safety invariants ---
billing_nav = (ROOT / "src/core/billing-navigation.js").read_text(encoding="utf-8")
action_lifecycle = (ROOT / "src/core/action-lifecycle.js").read_text(encoding="utf-8")
context_engine = (ROOT / "src/core/context-engine.js").read_text(encoding="utf-8")

check(
    "billing navigation gateway module exists",
    "WB.billingNavigation" in billing_nav and "function navigate" in billing_nav,
    "central session-aware gateway"
)
check(
    "manifest loads billing-navigation before context-engine",
    "src/core/billing-navigation.js" in manifest["content_scripts"][0]["js"]
    and manifest["content_scripts"][0]["js"].index("src/core/billing-navigation.js")
    < manifest["content_scripts"][0]["js"].index("src/core/context-engine.js"),
    "auth detector available for pageKind"
)
check(
    "authenticated Billing URL without pp is rejected",
    "BILLING_NAVIGATION_PP_MISSING" in billing_nav
    and "assertSafeToNavigate" in billing_nav,
    "no fallback URL without pp"
)
check(
    "guide technical URL builder refuses missing pp",
    "safeTechnicalUrl" in guide
    and "billingTechnicalUrl" in guide,
    "feature builders delegated to gateway"
)
check(
    "DOM auth page overrides URL route to billing_login",
    "isBillingAuthDom" in context_engine
    and "billing_login" in context_engine,
    "login form cannot be classified as technical"
)
check(
    "DIRECT_REPLAY completes only after native target orientation",
    "direct-replay-target-oriented" in guide
    and "showReplayOrientation" in guide
    and "replay-target-not-ready" in guide,
    "destination page alone is insufficient; replay must scroll/orient to semantic target"
)
check(
    "duplicate ActionSession clicks are suppressed",
    "ACTION_DUPLICATE_SUPPRESSED" in action_lifecycle
    and "BILLING_NAVIGATION_DUPLICATE_BLOCKED" in action_lifecycle,
    "idempotent navigation"
)
check(
    "LIVE CTA uses fill technical wording",
    "Заполнить техданные" in rail,
    "not verify-only wording for missing technical"
)
check(
    "ONU poll is gated only while the native Save decision is pending",
    "technicalSavePending" in background
    and "!technicalSavePending" in background
    and "writebackFlow.tmcWritebackPendingSave" in guide
    and "technical-save-required" in rail,
    "prefill alone cannot poll while Save is unanswered; explicit decline closes the question and permits TMC continuation"
)
check(
    "history replay waits for real semantic target before completion",
    "direct-replay-target-oriented" in guide
    and "retryableReplayTarget" in guide
    and "replay-target-not-visible" in guide,
    "arrows navigate, wait, scroll/orient, then complete"
)

check(
    "guide resume fixture is covered",
    resume_fixture_ok,
    resume_fixture_detail
)

fixture_path = ROOT / "tests/fixtures/subscriber_locator_route.json"
fixture_ok = False
fixture_detail = "missing"
if fixture_path.exists():
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    route = fixture.get("route", {})
    fixture_ok = all([
        "ONU" in fixture.get("negative_poll", ""),
        "active-onu" in fixture.get("confirmed_poll", "").lower(),
        route.get("old_olt_ip") == "172.16.100.10",
        route.get("new_olt_ip") == "172.16.200.20",
        route.get("interface") == "EPON0/13:39"
    ])
    fixture_detail = "negative + recovered positive route"
check(
    "recorded subscriber-locator route fixture is covered",
    fixture_ok,
    fixture_detail
)


check(
    "known UserSide customer bypasses gotouser redirect on revisit",
    "useDirectCustomer" in handoff
    and "new URL(`/customer/${customerId}`" in handoff
    and "await WB.store.prepareHandoff(payload)" in handoff,
    "first discovery may use IP redirect; resolved customerId uses canonical card and persisted handoff"
)
check(
    "same-Case open UserSide tab is safely reused before opening another tab",
    "await WB.store.openHandoffTarget" in handoff
    and "chrome.tabs.query({ url: 'https://userside.simnet.kiev.ua/*' })" in background
    and "usersideCustomerIdFromTabUrl(tab?.url) === customerId" in background
    and "reusedWithoutReload" in background,
    "exact customer tab is focused/rebound without reload; only Workbench-owned same-Case tabs may be repurposed"
)
check(
    "navigation actions collapse expanded drawer and do not auto-reopen after Guide",
    "collapseForNavigation()" in rail
    and "async requestPollReveal() {\n      this.collapseForNavigation();" in rail
    and "this.activeView = null;" in rail,
    "LIVE/full drawer becomes COMPACT before poll/replay/TMC/technical navigation"
)
check(
    "busy action continuation is coalesced instead of dropped",
    "let actionContinuationQueued = false;" in guide
    and "actionContinuationQueued = true;" in guide
    and "queueMicrotask(() =>" in guide,
    "destination/context event gets one trailing continuation pass"
)
check(
    "guided TMC restores semantic Focus plus v29.32 point marks",
    "resolver: () => tmcHighlightTarget(caseData)" in guide
    and "String(valueOf(caseData?.pon?.tmcOltName)" in guide
    and "String(valueOf(caseData?.pon?.tmcOltIp)" in guide
    and "normalizeMac(valueOf(caseData?.pon?.tmcOnuMac)" in guide
    and "normalizeSerial(valueOf(caseData?.pon?.tmcOnuSerial)" in guide
    and "String(valueOf(caseData?.pon?.tmcPort)" in guide
    and "highlightTmcValues(caseData" in guide
    and "--simnet-wb-tmc-mark-width" in guide,
    "first-pass TMC keeps the exact semantic OLT/IP/Serial/MAC/Interface Focus and the old aligned plum value marks"
)
check(
    "Guide persistence redacts live Billing pp including old stored steps",
    "sanitizeGuidePersistedDetails(payload.details)" in background
    and "step.action = sanitizeGuidePersistedDetails(step.action)" in background
    and "searchParams.set('pp', '[redacted]')" in background,
    "native targetHref can no longer leak authenticated pp into Case export"
)

passed = sum(item["status"] == "PASS" for item in results)
skipped = sum(item["status"] == "SKIP" for item in results)
failed = sum(item["status"] == "FAIL" for item in results)
report = {
    "version": manifest.get("version"),
    "total": len(results),
    "passed": passed,
    "skipped": skipped,
    "failed": failed,
    "results": results
}

(ROOT / "tests/last_report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2),
    encoding="utf-8"
)

lines = [
    f"# SIMNET Workbench v{manifest.get('version')} — regression report",
    "",
    f"- Total: **{len(results)}**",
    f"- Passed: **{passed}**",
    f"- Skipped: **{skipped}**",
    f"- Failed: **{failed}**",
    "",
    "| # | Test | Result | Detail |",
    "|---:|---|---|---|"
]
for index, item in enumerate(results, 1):
    detail = str(item["detail"]).replace("|", "\\|").replace("\n", " ")
    lines.append(
        f"| {index} | {item['name']} | {item['status']} | {detail} |"
    )

(ROOT / "tests/last_report.md").write_text(
    "\n".join(lines) + "\n",
    encoding="utf-8"
)

print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(1 if failed else 0)
