(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.runtime.booted) return;

  WB.runtime.booted = true;

  let lastSignature = '';
  let scanTimer = null;
  let scanQueuedAt = 0;
  let scheduledReason = '';
  let scheduledForce = false;
  let scheduledGeneration = 0;
  let observer = null;
  let scanInFlight = false;
  let pendingScan = null;
  let scanGeneration = 0;
  let documentGeneration = 0;
  let unchangedScanStreak = 0;
  let quiescent = false;
  let lastJuniperPrefetchKey = '';

  const SCAN_DEBOUNCE_MS = 140;
  const SCAN_MAX_WAIT_MS = 450;

  function activeWorkRequiresScanning() {
    const currentCase = WB.store?.activeCase?.() || null;
    const action = WB.actionLifecycle?.current?.() || null;
    const flow = currentCase?.workflow?.ponAcquisition || {};
    const pollPending = Boolean(currentCase?.pollAttempt?.pending || currentCase?.workflow?.pollAttempt?.pending);
    return Boolean(
      (action && !WB.actionLifecycle?.isTerminal?.(action))
      || pollPending
      || flow.tmcWritebackPending
      || flow.tmcWritebackPendingSave
    );
  }

  function shouldScanPollTerminal() {
    const pageKind = String(WB.runtime?.lastContext?.pageKind || '');
    if (pageKind === 'billing_onu_poll') return true;
    try {
      const url = new URL(location.href);
      return ['310','311','312','313'].includes(String(url.searchParams.get('a') || ''));
    } catch {
      return false;
    }
  }

  function mutationCanWakeQuiescent(mutation) {
    if (!mutation) return false;
    if (activeWorkRequiresScanning()) return true;
    const element = mutation.target?.nodeType === 1
      ? mutation.target
      : mutation.target?.parentElement;
    const pageKind = String(WB.runtime?.lastContext?.pageKind || '');
    if (pageKind === 'billing_onu_poll') return true;
    if (!element) return mutation.type === 'childList';
    if (element.closest?.('form,select,input,textarea,[id*="dopfield"],[id*="askolt"],[id*="olt" i]')) return true;
    const text = String(element.textContent || '').slice(0, 1200);
    return /Найдено на OLT|ТМЦ|Запрос OLT|Serial|ONU MAC|OLT\s*IP|Статус сес/i.test(text);
  }

  function markDocumentInvalidated() {
    documentGeneration += 1;
    quiescent = false;
    unchangedScanStreak = 0;
  }


  function invalidateExtensionContext(message = '') {
    if (WB.runtime.extensionContextStopped) return;
    WB.runtime.extensionContextStopped = true;
    WB.runtime.extensionContextInvalidated = true;
    WB.runtime.destroyed = true;
    clearTimeout(scanTimer);
    scanTimer = null;
    scanQueuedAt = 0;
    scheduledReason = '';
    scheduledForce = false;
    scheduledGeneration = 0;
    pendingScan = null;
    observer?.disconnect?.();
    scanInFlight = false;
    WB.operatorTrace?.destroy?.();
    WB.rail?.notifyExtensionContextInvalidated?.(message);
  }

  WB.runtime.invalidateExtensionContext = invalidateExtensionContext;

  const signatureOf = context => {
    const meta = { ...(context.meta || {}) };
    delete meta.scanGeneration;
    return JSON.stringify({
      key: context.key,
      identity: context.identity,
      network: context.network,
      pon: context.pon,
      profile: context.profile,
      meta,
      quality: context.quality
    });
  };

  function mergePendingScan(current, reason, force, generation) {
    return {
      reason: reason || current?.reason || 'queued-scan',
      force: Boolean(force || current?.force),
      generation: Math.max(Number(generation || 0), Number(current?.generation || 0))
    };
  }

  function queueScheduledScan(reason, force, generation) {
    const now = Date.now();
    if (!scanQueuedAt) scanQueuedAt = now;
    scheduledReason = reason || scheduledReason || 'dom-change';
    scheduledForce = scheduledForce || force;
    scheduledGeneration = Math.max(Number(scheduledGeneration || 0), Number(generation || 0));

    const elapsed = now - scanQueuedAt;
    const delay = Math.max(
      0,
      Math.min(SCAN_DEBOUNCE_MS, SCAN_MAX_WAIT_MS - elapsed)
    );

    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const nextReason = scheduledReason || 'dom-change';
      const nextForce = scheduledForce;
      const nextGeneration = Number(scheduledGeneration || scanGeneration);
      scanTimer = null;
      scanQueuedAt = 0;
      scheduledReason = '';
      scheduledForce = false;
      scheduledGeneration = 0;
      void scan(nextReason, nextForce, nextGeneration);
    }, delay);
  }


  async function scan(reason = 'scan', force = false, requestedGeneration = 0) {
    const finishScan = WB.performanceMonitor?.begin?.('scan', reason);
    if (document.hidden) {
      WB.performanceMonitor?.count?.('hiddenScansSuppressed');
      finishScan?.({ ok: true });
      return;
    }
    const generation = ++scanGeneration;
    const scanDocumentGeneration = documentGeneration;
    if (scanInFlight) {
      finishScan?.({ ok: true });
      WB.performanceMonitor?.count?.('scansQueued');
      if (pendingScan) WB.performanceMonitor?.count?.('scansCoalesced');
      pendingScan = mergePendingScan(pendingScan, reason, force, generation);
      return;
    }

    scanInFlight = true;
    WB.performanceMonitor?.count?.('scansStarted');
    const documentId = String(WB.runtime.documentId || '');
    clearTimeout(scanTimer);
    scanTimer = null;
    scanQueuedAt = 0;
    scheduledReason = '';
    scheduledForce = false;
    scheduledGeneration = 0;
    if (WB.runtime.destroyed) {
      scanInFlight = false;
      finishScan?.({ ok: false });
      return;
    }

    try {
      // Do not read a page while the legacy CRM is still rebuilding its DOM.
      // MutationObserver noise from Workbench itself is ignored separately below.
      if (WB.interactionGuards?.waitForUiReady) {
        const bootScan = reason === 'boot';
        await WB.interactionGuards.waitForUiReady({
          timeoutMs: bootScan ? 320 : (force ? 600 : 420),
          quietMs: bootScan ? 50 : (force ? 65 : 75)
        });
      }
      if (
        documentId !== String(WB.runtime.documentId || '')
        || scanDocumentGeneration !== documentGeneration
      ) {
        console.debug('[SIMNET WB][SCAN] Устаревший scan отброшен до чтения DOM', {
          documentId,
          generation,
          currentGeneration: scanGeneration,
          documentGeneration,
          scanDocumentGeneration
        });
        WB.performanceMonitor?.count?.('scansDropped');
        WB.performanceMonitor?.count?.('scansStaleBeforeDom');
        return;
      }

      // Poll terminal markup is visual only. It runs before context parsing so newly
      // arrived command blocks are grouped once and can also be used as Guide anchors.
      if (shouldScanPollTerminal()) WB.pollTerminal?.scan?.();
      const context = WB.contextEngine.detect();
      context.meta ||= {};
      context.meta.scanGeneration = generation;
      const signature = signatureOf(context);

      if (
        documentId !== String(WB.runtime.documentId || '')
        || scanDocumentGeneration !== documentGeneration
      ) {
        console.debug('[SIMNET WB][SCAN] Устаревший scan отброшен перед commit', {
          documentId,
          generation,
          currentGeneration: scanGeneration,
          documentGeneration,
          scanDocumentGeneration
        });
        WB.performanceMonitor?.count?.('scansDropped');
        WB.performanceMonitor?.count?.('scansStaleBeforeCommit');
        return;
      }

      if (!force && signature === lastSignature) {
        WB.performanceMonitor?.count?.('scansUnchanged');
        unchangedScanStreak += 1;
        if (unchangedScanStreak >= 2 && !activeWorkRequiresScanning()) {
          if (!quiescent) WB.performanceMonitor?.count?.('quiescentEntries');
          quiescent = true;
        }
        return;
      }
      lastSignature = signature;
      unchangedScanStreak = 0;
      quiescent = false;

      const result = await WB.store.applyContext(context);
      if (
        documentId !== String(WB.runtime.documentId || '')
        || scanDocumentGeneration !== documentGeneration
      ) {
        console.debug('[SIMNET WB][SCAN] Результат старого scan не опубликован в UI', {
          documentId,
          generation,
          currentGeneration: scanGeneration,
          documentGeneration,
          scanDocumentGeneration
        });
        WB.performanceMonitor?.count?.('scansDropped');
        WB.performanceMonitor?.count?.('scansStaleBeforePublish');
        return;
      }
      WB.bus.emit('context:changed', {
        context,
        result,
        reason
      });
      WB.performanceMonitor?.count?.('scansCommitted');
      WB.performanceMonitor?.mark?.('first-context');

      WB.log?.changed?.(
        'context-page',
        context.key,
        'CONTEXT',
        'Страница распознана',
        {
          system: context.system,
          pageKind: context.pageKind,
          entityId: context.entityId || '',
          reason
        }
      );

      const activeCase = WB.store.activeCase?.() || null;
      const recommendation = activeCase?.locator?.recommendation || null;

      // Juniper is read in parallel from the first Billing subscriber page and
      // published into LIVE. It is not a blocking Guide step; no SYNC or Disconnect
      // is ever automatic.
      if (context.system === 'billing' || context.system === 'looknet-billing') {
        const juniperKey = [
          activeCase?.id || '',
          activeCase?.network?.ip?.value || activeCase?.network?.ip || '',
          activeCase?.network?.mac?.value || activeCase?.network?.mac || ''
        ].join('|');
        if (juniperKey && juniperKey !== lastJuniperPrefetchKey) {
          lastJuniperPrefetchKey = juniperKey;
          queueMicrotask(() => {
            WB.juniper?.maybePrefetch?.(`identity:${reason}`).catch?.(() => {});
          });
        }
      }
      const termination = activeCase?.locator?.termination || null;
      const recommendationSignature = [
        activeCase?.id || '',
        recommendation?.action || '',
        termination?.status || ''
      ].join('|');
      WB.log?.changed?.(
        'locator-recommendation',
        recommendationSignature,
        'LOCATOR',
        termination?.status
          ? 'Маршрут завершён'
          : 'Следующий диагностический шаг',
        {
          caseId: activeCase?.id || '',
          action: recommendation?.action || 'none',
          reason: recommendation?.reason || '',
          termination: termination?.status || ''
        }
      );

      const poll = context.meta?.poll || null;
      if (poll) {
        WB.log?.changed?.(
          'poll-outcome',
          `${context.key}|${poll.outcome}|${poll.commandBlocks?.length || 0}`,
          'TERMINAL',
          'Результат OLT классифицирован',
          {
            outcome: poll.outcome || 'unknown',
            ready: Boolean(poll.ready),
            matchedBy: poll.matchedBy || [],
            blocks: poll.commandBlocks?.length || 0
          }
        );
      }
    } catch (error) {
      if (error?.code === 'EXTENSION_CONTEXT_INVALIDATED' || /Extension context invalidated|Расширение было перезагружено/i.test(String(error?.message || error))) {
        invalidateExtensionContext(error?.message || String(error));
        return;
      }
      WB.performanceMonitor?.count?.('scanErrors');
      WB.performanceMonitor?.count?.('scansFailed');
      WB.log?.error?.('SCAN', 'Ошибка чтения страницы', {
        reason,
        message: error?.message || String(error)
      });
      void WB.observability?.report?.({
        severity: 'ERROR',
        code: 'CONTENT_SCAN_FAILED',
        operationType: 'CONTEXT_SCAN',
        source: 'bootstrap',
        stage: String(reason || 'scan'),
        message: error?.message || String(error),
        error
      });
      console.error('[SIMNET Workbench] scan failed', reason, error);
    } finally {
      finishScan?.({ ok: true });
      scanInFlight = false;
      if (pendingScan && !WB.runtime.destroyed) {
        const queued = pendingScan;
        pendingScan = null;
        queueScheduledScan(
          queued.reason || 'queued-scan',
          Boolean(queued.force),
          0
        );
      }
    }
  }

  function schedule(reason, force = false) {
    if (document.hidden) {
      WB.performanceMonitor?.count?.('hiddenScansSuppressed');
      return;
    }
    WB.performanceMonitor?.count?.('scansScheduled');
    const generation = scanGeneration + 1;

    // A real external invalidation must stale the current reader immediately,
    // but a burst must not create a burst of timers/readers. Keep one pending
    // request and let the existing latest-wins generation checks reject stale work.
    if (scanInFlight) {
      WB.performanceMonitor?.count?.('scansQueued');
      if (pendingScan) WB.performanceMonitor?.count?.('scansCoalesced');
      pendingScan = mergePendingScan(pendingScan, reason, force, generation);
      return;
    }

    if (scanTimer) WB.performanceMonitor?.count?.('scansCoalesced');
    queueScheduledScan(reason, force, generation);
  }

  async function boot() {
    WB.performanceMonitor?.mark?.('boot-start');
    WB.log?.info?.('BOOT', 'Запуск Workbench', {
      version: WB.version,
      host: location.hostname,
      path: location.pathname
    });
    // The complete rail is useful even while Case storage and handoff state are
    // loading. Mount it first so UserSide never shows only Graph/Audit launchers.
    WB.rail.mount();
    WB.performanceMonitor?.mark?.('rail-mounted');
    await WB.store.init();
    WB.performanceMonitor?.mark?.('store-ready');
    await WB.handoff?.init?.();
    WB.performanceMonitor?.mark?.('handoff-ready');
    if (document.hidden) {
      WB.performanceMonitor?.count?.('hiddenScansSuppressed');
    } else {
      await scan('boot', true);
      // Handoff.init runs before runtime.forceScan exists. The first canonical
      // scan above has now populated the current UserSide TMC facts, so execute
      // the carried semantic command immediately instead of waiting for a later
      // LIVE/store/render event to wake Guide.
      await WB.handoff?.resumePendingSemanticHandoff?.('post-boot-scan');
    }
    WB.operatorTrace?.init?.();

    observer = new MutationObserver(mutations => {
      WB.performanceMonitor?.count?.('mutationBatches');
      WB.performanceMonitor?.count?.('mutationRecords', mutations.length);
      if (document.hidden) {
        WB.performanceMonitor?.count?.('hiddenScansSuppressed');
        return;
      }
      let external = false;
      let wakeRelevant = false;
      for (const mutation of mutations) {
        if (WB.interactionGuards?.isWorkbenchMutation?.(mutation)) {
          WB.performanceMonitor?.count?.('mutationsIgnoredWorkbenchUi');
          continue;
        }
        if (WB.interactionGuards?.isVolatileCrmMutation?.(mutation)) {
          WB.performanceMonitor?.count?.('volatileMutationsSuppressed');
          WB.performanceMonitor?.count?.('volatileCrmMutationsSuppressed');
          continue;
        }
        external = true;
        if (mutationCanWakeQuiescent(mutation)) wakeRelevant = true;
      }
      if (external) {
        if (quiescent && !wakeRelevant) {
          WB.performanceMonitor?.count?.('quiescentMutationsSuppressed');
          return;
        }
        quiescent = false;
        schedule('dom-change');
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // Cosmetic class/style churn in legacy CRM widgets does not alter the
      // subscriber identity. Destructive action guards keep their own observer.
      attributeFilter: ['href', 'disabled', 'hidden']
    });

    window.addEventListener('pageshow', event => {
      markDocumentInvalidated();
      schedule(event.persisted ? 'bfcache-restore' : 'pageshow');
    });
    window.addEventListener('popstate', () => { markDocumentInvalidated(); schedule('popstate'); });
    window.addEventListener('hashchange', () => { markDocumentInvalidated(); schedule('hashchange'); });
    document.addEventListener('change', event => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
        const type = String(target.getAttribute?.('type') || '').toLowerCase();
        const freeText = target instanceof HTMLTextAreaElement
          || (target instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'tel', 'url'].includes(type));
        if (freeText) return;
        schedule('form-change');
      }
    }, true);
    document.addEventListener('focusout', event => {
      const target = event.target;
      const type = String(target?.getAttribute?.('type') || '').toLowerCase();
      const freeText = target instanceof HTMLTextAreaElement
        || (target instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'tel', 'url'].includes(type));
      if (freeText) schedule('form-text-complete');
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(scanTimer);
        scanTimer = null;
        scanQueuedAt = 0;
        scheduledReason = '';
        scheduledForce = false;
        scheduledGeneration = 0;
        pendingScan = null;
        return;
      }
      WB.store.resume?.();
      schedule('visible');
      queueMicrotask(() => { void WB.handoff?.resumePendingSemanticHandoff?.('visibility-resume'); });
    });

    WB.runtime.scan = (reason, force = false) => scan(reason || 'scan', force);
    WB.runtime.forceScan = reason => { quiescent = false; unchangedScanStreak = 0; return scan(reason || 'forced', true); };
    WB.runtime.scanGeneration = () => scanGeneration;
    WB.runtime.documentGeneration = () => documentGeneration;
    WB.runtime.isQuiescent = () => quiescent;
    WB.runtime.destroy = () => {
      WB.runtime.destroyed = true;
      clearTimeout(scanTimer);
      scanTimer = null;
      scanQueuedAt = 0;
      scheduledReason = '';
      scheduledForce = false;
      scheduledGeneration = 0;
      observer?.disconnect();
      pendingScan = null;
      scanInFlight = false;
      WB.operatorTrace?.destroy?.();
      WB.callRegistration?.destroy?.();
      WB.store.destroy();
      WB.rail.destroy();
    };

    WB.log?.info?.('BOOT', 'Workbench готов', {
      version: WB.version,
      host: location.hostname
    });
    WB.performanceMonitor?.mark?.('boot-ready');
  }

  boot().catch(error => {
    void WB.observability?.report?.({
      severity: 'CRITICAL',
      code: 'CONTENT_BOOT_FAILED',
      operationType: 'CONTENT_BOOT',
      source: 'bootstrap',
      stage: 'BOOT',
      message: error?.message || String(error),
      error
    });
    console.error('[SIMNET Workbench] boot failed', error);
  });
})();
