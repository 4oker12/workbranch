(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.operatorTrace) return;

  const DOM_TARGET_CAP = 420;
  const DOM_PARENT_CAP = 620;
  const DOM_GRANDPARENT_CAP = 820;
  const SELECTION_DOM_CAP = 1200;
  const TEXT_CAP = 900;
  const SCROLL_SETTLE_MS = 650;
  const TRACE_STORAGE_KEY = 'simnet_workbench_trace_v2';
  const TRACE_MAX_EVENTS = 3000;
  const TRACE_MAX_BYTES = 1200000;
  const TRACE_EVENT_MAX_BYTES = 9000;
  const TRACE_FLUSH_MS = 180;
  const TRACE_FLUSH_BATCH = 40;
  const TRACE_QUEUE_MAX = 600;
  const PROTECTED_KEY_RE = /(?:csrf|token|salt|session|sid|passwd|password|^pp$|^pp\d+$|^uu\d+$|secret|auth)/i;
  const FREE_TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url']);

  const state = {
    ready: false,
    enabled: false,
    destroyed: false,
    storeOff: null,
    scrollTimer: null,
    scrollStartY: 0,
    lastScrollY: 0,
    lastSelectionFingerprint: '',
    lastSelectionAt: 0,
    lastTextChange: new WeakMap(),
    lastNavigation: null,
    listeners: [],
    uiObserver: null,
    queue: [],
    flushTimer: null,
    traceSessionId: '',
    startedAt: '',
    stoppedAt: '',
    droppedEventsCount: 0,
    pendingDroppedEventsCount: 0,
    flushing: false,
    uiFingerprints: new Map(),
    lastInteractionTarget: null,
    lastInteractionAt: 0,
    semanticTargetCache: null,
    semanticTargetCacheAt: 0
  };

  const compact = (value, max = 260) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const truncate = (value, max) => {
    const text = String(value == null ? '' : value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const nowIso = () => new Date().toISOString();

  function eventId(prefix = 'op') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function safeUrl(raw) {
    try {
      const url = new URL(raw || location.href, location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (PROTECTED_KEY_RE.test(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.toString();
    } catch {
      return compact(raw || '', 900);
    }
  }

  function safeControlValue(element) {
    if (!element || element.nodeType !== 1) return '';
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    const name = String(element.getAttribute?.('name') || '');
    if (type === 'password' || PROTECTED_KEY_RE.test(name)) return '[protected]';
    if (element.tagName === 'SELECT') {
      const selected = element.options?.[element.selectedIndex] || null;
      return compact(selected?.textContent || selected?.value || element.value || '', 260);
    }
    if (type === 'checkbox' || type === 'radio') {
      return element.checked ? 'checked' : 'unchecked';
    }
    if (element.tagName === 'TEXTAREA' || FREE_TEXT_TYPES.has(type)) {
      const length = String(element.value || '').length;
      return `[текст: ${length} симв.]`;
    }
    return compact(element.value || element.getAttribute?.('value') || '', 320);
  }

  function isFreeTextControl(element) {
    if (!element || element.nodeType !== 1) return false;
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    return element.tagName === 'TEXTAREA'
      || (element.tagName === 'INPUT' && FREE_TEXT_TYPES.has(type));
  }

  function sanitizeClone(element, cap) {
    if (!element || element.nodeType !== 1) return '';
    try {
      const clone = element.cloneNode(true);
      clone.querySelectorAll('script,style,link,iframe,canvas,video,audio,object,embed').forEach(node => node.remove());
      clone.querySelectorAll('input,textarea,select').forEach(node => {
        const name = String(node.getAttribute('name') || '');
        const type = String(node.getAttribute('type') || '').toLowerCase();
        if (type === 'password' || PROTECTED_KEY_RE.test(name)) {
          node.setAttribute('value', '{protected}');
          if ('value' in node) node.value = '{protected}';
        } else if (node.tagName === 'SELECT') {
          const selected = node.options?.[node.selectedIndex] || null;
          node.setAttribute('data-simnet-selected', compact(selected?.textContent || selected?.value || '', 160));
        } else if (node.tagName === 'TEXTAREA' || FREE_TEXT_TYPES.has(type)) {
          const length = String(node.value || node.textContent || '').length;
          node.setAttribute('value', `{text:${length}}`);
          node.textContent = `{text:${length}}`;
          if ('value' in node) node.value = `{text:${length}}`;
        } else if ('value' in node && node.value) {
          node.setAttribute('value', compact(node.value, 260));
        }
      });
      return truncate(clone.outerHTML, cap);
    } catch {
      return '';
    }
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`);
  }

  function cssPath(element) {
    if (!element || element.nodeType !== 1) return '';
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 8) {
      let part = String(node.tagName || '').toLowerCase();
      if (!part) break;
      const nodeId = String(node.getAttribute?.('id') || '');
      if (nodeId && !/^simnet-workbench/i.test(nodeId)) {
        part += `#${cssEscape(nodeId)}`;
        parts.unshift(part);
        break;
      }
      const usefulClasses = [...(node.classList || [])]
        .filter(name => name && !/^simnet-|^wb-|^ep-/.test(name))
        .slice(0, 2);
      if (usefulClasses.length) part += `.${usefulClasses.map(cssEscape).join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(child => child.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function nodeElement(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement || null;
  }

  function eventElement(event) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    return path.find(node => node?.nodeType === 1) || nodeElement(event?.target);
  }

  function isWorkbenchElement(element, event = null) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    const nodes = path.length ? path : [element];
    return nodes.some(node => {
      if (!node || node.nodeType !== 1) return false;
      const id = String(node.getAttribute?.('id') || '');
      if ([
        'simnet-workbench-rail-host',
        'simnet-workbench-guide-overlay',
        'simnet-workbench-call-registration-host',
        'simnet-graph-studio-host',
        'simnet-data-audit-host',
        'simnet-data-audit-launcher'
      ].includes(id)) return true;
      if (node.hasAttribute?.('data-simnet-wb-owned')) return true;
      return Boolean(node.closest?.(
        '#simnet-workbench-rail-host,#simnet-workbench-guide-overlay,' +
        '#simnet-workbench-call-registration-host,#simnet-graph-studio-host,' +
        '#simnet-data-audit-host,#simnet-data-audit-launcher,' +
        '[data-simnet-wb-owned],[data-simnet-wb-reminder],[data-simnet-wb-trace]'
      ));
    });
  }

  function actionableElement(raw) {
    if (!raw || raw.nodeType !== 1) return raw;
    return raw.closest?.(
      'a,button,input,select,textarea,label,[onclick],[role="button"],[role="link"],' +
      'summary,option,td,th,tr,.item,.table_block'
    ) || raw;
  }

  function nearestSection(element) {
    if (!element) return '';
    const container = element.closest?.(
      'tr,fieldset,form,.table_block,.item,.card,.panel,section,article,main,[id]'
    );
    if (!container) return nearestHeading();
    const heading = container.querySelector?.(
      'legend,h1,h2,h3,h4,.label_h3_hr,.head,.title,th,.left_data,label,strong,b'
    );
    return compact(heading?.textContent || '', 180) || nearestHeading();
  }

  function nearestHeading() {
    const nodes = [...document.querySelectorAll('h1,h2,h3,h4,.label_h3_hr,.head,.title')]
      .filter(node => {
        const rect = node.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0;
      });
    return compact(nodes.at(-1)?.textContent || document.title || '', 180);
  }

  function visualState(element) {
    if (!element || element.nodeType !== 1) return null;
    try {
      const rect = element.getBoundingClientRect?.() || null;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
      const width = Math.round(Number(rect?.width || 0));
      const height = Math.round(Number(rect?.height || 0));
      const display = String(style?.display || '');
      const visibility = String(style?.visibility || '');
      const opacity = String(style?.opacity || '');
      return {
        visible: !element.hidden && display !== 'none' && visibility !== 'hidden' && opacity !== '0' && width > 0 && height > 0,
        display,
        visibility,
        opacity,
        hidden: Boolean(element.hidden),
        ariaExpanded: element.getAttribute?.('aria-expanded') || '',
        ariaHidden: element.getAttribute?.('aria-hidden') || '',
        rect: rect ? { x: Math.round(rect.x || 0), y: Math.round(rect.y || 0), width, height } : null
      };
    } catch {
      return null;
    }
  }

  function targetDescriptor(element) {
    if (!element || element.nodeType !== 1) return null;
    const tag = String(element.tagName || '').toLowerCase();
    const label = compact(
      (isFreeTextControl(element) ? '' : (element.innerText || element.textContent))
      || element.getAttribute?.('aria-label')
      || element.getAttribute?.('title')
      || element.getAttribute?.('name')
      || element.getAttribute?.('id')
      || safeControlValue(element)
      || '',
      280
    );
    return {
      tag,
      id: String(element.getAttribute?.('id') || ''),
      name: element.getAttribute?.('name') || '',
      type: element.getAttribute?.('type') || '',
      role: element.getAttribute?.('role') || '',
      classes: [...(element.classList || [])].filter(Boolean).slice(0, 8),
      text: label,
      title: compact(element.getAttribute?.('title') || '', 220),
      ariaLabel: compact(element.getAttribute?.('aria-label') || '', 220),
      href: element.matches?.('a[href]') ? safeUrl(element.href || element.getAttribute('href')) : '',
      value: element.matches?.('input,select,textarea') ? safeControlValue(element) : '',
      visual: visualState(element)
    };
  }

  function domContext(element) {
    const parent = element?.parentElement || null;
    const grandparent = parent?.parentElement || null;
    return {
      cssPath: cssPath(element),
      parentPath: cssPath(parent),
      grandparentPath: cssPath(grandparent),
      targetHtml: sanitizeClone(element, DOM_TARGET_CAP),
      parentHtml: sanitizeClone(parent, DOM_PARENT_CAP),
      grandparentHtml: sanitizeClone(grandparent, DOM_GRANDPARENT_CAP)
    };
  }

  function pageContext() {
    const context = WB.runtime.lastContext || WB.store.activeCase?.()?.currentContext || null;
    return {
      system: context?.system || '',
      pageKind: context?.pageKind || '',
      entityId: context?.entityId || '',
      subview: context?.subview || '',
      url: safeUrl(location.href),
      title: compact(document.title || '', 240)
    };
  }

  function formNavigation(element) {
    const form = element?.closest?.('form') || null;
    const anchor = element?.closest?.('a[href]') || null;
    if (anchor) {
      return {
        kind: 'link',
        method: 'GET',
        from: safeUrl(location.href),
        to: safeUrl(anchor.href || anchor.getAttribute('href') || ''),
        target: anchor.getAttribute('target') || '',
        download: anchor.hasAttribute('download')
      };
    }
    if (form) {
      return {
        kind: 'form',
        method: String(form.method || 'GET').toUpperCase(),
        from: safeUrl(location.href),
        to: safeUrl(form.action || location.href),
        target: form.target || '',
        download: false
      };
    }
    return null;
  }

  function classifyIntent(element, descriptor, navigation) {
    const raw = [
      descriptor?.text,
      descriptor?.title,
      descriptor?.ariaLabel,
      descriptor?.href,
      nearestSection(element)
    ].filter(Boolean).join(' ').toLowerCase();

    if (/сохран|save|примен|apply|измен|редакт|update/.test(raw)) return 'изменение/сохранение';
    if (/удал|delete|очист|remove|отключ|disable|reboot|перезагруз/.test(raw)) return 'изменение состояния';
    if (/поиск|search|найти|find|фильтр|filter/.test(raw)) return 'поиск/фильтрация';
    if (/опрос|poll|askolt|autofind|ping|провер|diagnos|signal|gpon|epon|gcom|huawei/.test(raw)) return 'диагностика/опрос';
    if (/технич|тех\.?\s*дан|dopdata/.test(raw)) return 'открытие технических данных';
    if (/userside|gotouser/.test(raw)) return 'переход в UserSide';
    if (/tmc|тмц|товарно|материал/.test(raw)) return 'проверка ТМЦ';
    if (/export|экспорт|скач|download/.test(raw)) return 'экспорт';
    if (navigation?.kind) return 'переход/навигация';
    if (element?.matches?.('button,input[type="button"],input[type="submit"],[role="button"]')) return 'команда интерфейса';
    if (element?.matches?.('input,select,textarea')) return 'ввод/изменение поля';
    return 'взаимодействие с DOM';
  }

  function routeSemantic(urlRaw) {
    if (!urlRaw) return null;
    try {
      const url = new URL(urlRaw, location.href);
      const host = url.hostname;
      const action = url.searchParams.get('a') || '';
      const act = url.searchParams.get('act') || '';
      const findType = url.searchParams.get('find_typer') || '';
      if (host === 'admin.simnet.kiev.ua' || host === 'admin.looknet.kiev.ua') {
        if (action === 'dopdata') return { hint: 'Billing: открыть технические данные абонента.', confidence: 0.99, signal: 'a=dopdata' };
        if (action === 'user') return { hint: 'Billing: открыть карточку абонента.', confidence: 0.97, signal: 'a=user' };
        if (action === '310') return { hint: act === 'askolt' ? 'Billing: запустить запрос OLT в EPON.' : 'Billing: открыть EPON-опрос.', confidence: 0.98, signal: `a=310${act ? `&act=${act}` : ''}` };
        if (action === '311') return { hint: act === 'askolt' ? 'Billing: запустить запрос OLT в GPON.' : 'Billing: открыть GPON-опрос.', confidence: 0.98, signal: `a=311${act ? `&act=${act}` : ''}` };
        if (action === '312') return { hint: act === 'askolt' ? 'Billing: запустить запрос OLT в GCOM.' : 'Billing: открыть GCOM-опрос.', confidence: 0.98, signal: `a=312${act ? `&act=${act}` : ''}` };
        if (action === '313') return { hint: act === 'askolt' ? 'Billing: запустить запрос OLT на Huawei.' : 'Billing: открыть Huawei OLT.', confidence: 0.98, signal: `a=313${act ? `&act=${act}` : ''}` };
        if (action === '252') {
          if (act === 'askjun') return { hint: 'Billing: вручную обновить данные Juniper (NEW).', confidence: 0.99, signal: 'a=252&act=askjun' };
          if (act === 'coasync') return { hint: 'Billing Juniper: команда SYNC.', confidence: 0.99, signal: 'a=252&act=coasync' };
          if (act === 'coadisconnect') return { hint: 'Billing Juniper: команда Disconnect.', confidence: 0.99, signal: 'a=252&act=coadisconnect' };
          return { hint: 'Billing: открыть Juniper (NEW) и просмотреть L3-сессию.', confidence: 0.99, signal: 'a=252' };
        }
      }
      if (host === 'userside.simnet.kiev.ua') {
        if (/\/script\/gotouser\.php/i.test(url.pathname)) return { hint: 'Переход из Billing к карточке этого абонента в UserSide.', confidence: 0.99, signal: 'gotouser.php' };
        if (findType === 'machistory') return { hint: 'UserSide: поиск истории по MAC-адресу.', confidence: 0.99, signal: 'find_typer=machistory' };
        if (/^\/customer\/\d+/i.test(url.pathname)) return { hint: 'UserSide: открыть карточку абонента.', confidence: 0.96, signal: '/customer/{id}' };
        if (/^\/device\/\d+/i.test(url.pathname)) return { hint: 'UserSide: открыть карточку оборудования.', confidence: 0.94, signal: '/device/{id}' };
      }
    } catch {}
    return null;
  }

  function semanticFor(element, descriptor, navigation) {
    const intent = classifyIntent(element, descriptor, navigation);
    const section = nearestSection(element);
    const route = routeSemantic(navigation?.to || descriptor?.href || '');
    const label = descriptor?.text || descriptor?.ariaLabel || descriptor?.title || descriptor?.tag || 'элемент';
    const signals = [];
    if (descriptor?.text) signals.push(`text=${compact(descriptor.text, 120)}`);
    if (section) signals.push(`section=${compact(section, 120)}`);
    if (descriptor?.href) signals.push(`href=${safeUrl(descriptor.href)}`);
    if (route?.signal) signals.push(route.signal);
    if (navigation?.method) signals.push(`${navigation.method} navigation`);

    return {
      intent,
      hint: route?.hint || `${intent}: «${compact(label, 160)}»${section ? ` в разделе «${compact(section, 140)}»` : ''}.`,
      confidence: route?.confidence || (descriptor?.text ? 0.82 : 0.66),
      signals
    };
  }

  function navigationType() {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    return nav?.type || 'navigate';
  }

  function traceSessionId() {
    return state.traceSessionId || `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function capEvent(event) {
    let candidate = event;
    try {
      let raw = JSON.stringify(candidate);
      if (raw.length <= TRACE_EVENT_MAX_BYTES) return candidate;
      candidate = {
        eventId: event.eventId,
        capturedAt: event.capturedAt,
        type: event.type,
        message: compact(event.message, 500),
        page: event.page,
        action: event.action || '',
        operationId: event.operationId || '',
        semanticTargetId: event.semanticTargetId || '',
        detailsTruncated: true
      };
      raw = JSON.stringify(candidate);
      return raw.length <= TRACE_EVENT_MAX_BYTES ? candidate : {
        eventId: event.eventId,
        capturedAt: event.capturedAt,
        type: compact(event.type, 80),
        message: compact(event.message, 300),
        detailsTruncated: true
      };
    } catch {
      return { eventId: event.eventId || eventId('trace'), capturedAt: event.capturedAt || nowIso(), type: compact(event.type || 'trace', 80), message: '[unserializable]', detailsTruncated: true };
    }
  }

  function approximateBytes(value) {
    try { return new Blob([JSON.stringify(value)]).size; } catch { return JSON.stringify(value || '').length; }
  }

  async function readTraceStore() {
    try {
      const result = await chrome.storage.local.get([TRACE_STORAGE_KEY]);
      const root = result?.[TRACE_STORAGE_KEY];
      return root && typeof root === 'object' ? root : { schema: 'simnet-workbench-trace-v2', sessions: {} };
    } catch {
      return { schema: 'simnet-workbench-trace-v2', sessions: {} };
    }
  }

  function scheduleFlush(immediate = false) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    if (state.flushing) {
      state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        void flushTrace();
      }, immediate ? 0 : TRACE_FLUSH_MS);
      return;
    }
    if (immediate || state.queue.length >= TRACE_FLUSH_BATCH) {
      state.flushTimer = null;
      void flushTrace();
      return;
    }
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      void flushTrace();
    }, TRACE_FLUSH_MS);
  }

  async function flushTrace() {
    if (state.flushing || !state.queue.length || !state.traceSessionId) return false;
    state.flushing = true;
    const batch = state.queue.splice(0, state.queue.length);
    try {
      const root = await readTraceStore();
      root.schema = 'simnet-workbench-trace-v2';
      root.sessions ||= {};
      const currentCase = WB.store?.activeCase?.() || null;
      const session = root.sessions[state.traceSessionId] ||= {
        traceSessionId: state.traceSessionId,
        workbenchVersion: WB.version || '',
        caseId: WB.store?.localCaseId || currentCase?.id || '',
        login: String(currentCase?.identity?.login?.value || currentCase?.identity?.login || ''),
        startedAt: state.startedAt || nowIso(),
        stoppedAt: '',
        active: true,
        droppedEventsCount: 0,
        events: []
      };
      session.events.push(...batch.map(capEvent));
      if (state.pendingDroppedEventsCount) {
        session.droppedEventsCount = Number(session.droppedEventsCount || 0) + Number(state.pendingDroppedEventsCount || 0);
      }
      while (session.events.length > TRACE_MAX_EVENTS) {
        session.events.shift();
        session.droppedEventsCount = Number(session.droppedEventsCount || 0) + 1;
      }
      let bytes = approximateBytes(session);
      while (bytes > TRACE_MAX_BYTES && session.events.length > 20) {
        const remove = Math.min(50, Math.max(1, Math.ceil(session.events.length * 0.05)));
        session.events.splice(0, remove);
        session.droppedEventsCount = Number(session.droppedEventsCount || 0) + remove;
        bytes = approximateBytes(session);
      }
      state.droppedEventsCount = Number(session.droppedEventsCount || 0);
      session.stoppedAt = state.stoppedAt || session.stoppedAt || '';
      session.active = !Boolean(session.stoppedAt);
      session.updatedAt = nowIso();
      root.updatedAt = session.updatedAt;
      // Keep only a few recent trace sessions globally.
      const ids = Object.keys(root.sessions).sort((a, b) => String(root.sessions[b]?.startedAt || '').localeCompare(String(root.sessions[a]?.startedAt || '')));
      for (const stale of ids.slice(5)) delete root.sessions[stale];
      await chrome.storage.local.set({ [TRACE_STORAGE_KEY]: root });
      state.pendingDroppedEventsCount = 0;
      return true;
    } catch (error) {
      state.queue.unshift(...batch.slice(-TRACE_FLUSH_BATCH));
      void WB.observability?.report?.({
        severity: 'WARNING', code: 'TRACE_STORAGE_WRITE_FAILED', operationType: 'TRACE_RECORDER', source: 'operator-trace', stage: 'FLUSH',
        message: error?.message || 'Не удалось сохранить Trace Recorder', error,
        details: { traceSessionId: state.traceSessionId, queued: state.queue.length }
      });
      return false;
    } finally {
      state.flushing = false;
      if (state.queue.length && !state.flushTimer) scheduleFlush(false);
    }
  }

  function queueTraceEvent(type, message, details = {}) {
    if (state.destroyed || !state.enabled || !state.traceSessionId) return false;
    const event = capEvent({
      eventId: details.eventId || eventId('trace'),
      capturedAt: details.capturedAt || nowIso(),
      type: compact(type, 100),
      message: compact(message, 800),
      page: details.page || pageContext(),
      ...details
    });
    state.queue.push(event);
    while (state.queue.length > TRACE_QUEUE_MAX) {
      state.queue.shift();
      state.pendingDroppedEventsCount += 1;
    }
    scheduleFlush(false);
    return true;
  }

  async function record(type, message, details = {}) {
    return queueTraceEvent(type, message, details);
  }

  function on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function clickDetails(event) {
    const raw = eventElement(event);
    if (!raw) return null;
    const workbenchOwned = isWorkbenchElement(raw, event);
    const element = actionableElement(raw);
    const descriptor = targetDescriptor(element);
    const navigation = formNavigation(element);
    return {
      eventId: eventId('click'),
      action: 'click',
      clickCount: Number(event.detail || 1),
      button: Number(event.button ?? 0),
      pointer: {
        x: Math.round(Number(event.clientX || 0)),
        y: Math.round(Number(event.clientY || 0))
      },
      modifiers: {
        alt: Boolean(event.altKey),
        ctrl: Boolean(event.ctrlKey),
        shift: Boolean(event.shiftKey),
        meta: Boolean(event.metaKey)
      },
      section: nearestSection(element),
      rawTarget: targetDescriptor(raw),
      target: descriptor,
      dom: workbenchOwned ? { cssPath: cssPath(element) } : domContext(element),
      navigation,
      semantic: semanticFor(element, descriptor, navigation),
      previousNavigation: state.lastNavigation,
      origin: workbenchOwned ? 'workbench' : 'page'
    };
  }

  function selectionSnapshot() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const selectedText = compact(selection.toString(), TEXT_CAP);
    if (selectedText.length < 2) return null;

    let range;
    try { range = selection.getRangeAt(0).cloneRange(); } catch { return null; }
    const start = nodeElement(range.startContainer);
    const end = nodeElement(range.endContainer);
    const common = nodeElement(range.commonAncestorContainer);
    if (!start || !end || !common || isWorkbenchElement(common)) return null;

    const wrapper = document.createElement('div');
    try { wrapper.appendChild(range.cloneContents()); } catch { return null; }
    wrapper.querySelectorAll('script,style,link,iframe,canvas,video,audio').forEach(node => node.remove());
    const exactDom = truncate(wrapper.innerHTML, SELECTION_DOM_CAP);
    if (!exactDom) return null;

    const fingerprint = [safeUrl(location.href).replace(/[?#].*$/, ''), cssPath(start), cssPath(end), selectedText].join('|');
    return {
      fingerprint,
      details: {
        eventId: eventId('select'),
        action: 'selection',
        section: nearestSection(common),
        selectedText,
        target: targetDescriptor(common),
        selection: {
          startPath: cssPath(start),
          endPath: cssPath(end),
          commonPath: cssPath(common),
          textLength: String(selection.toString() || '').length
        },
        dom: {
          exactHtml: exactDom,
          commonHtml: sanitizeClone(common, DOM_GRANDPARENT_CAP)
        },
        semantic: {
          intent: 'выделение текста / DOM-фрагмента',
          hint: `Оператор выделил фрагмент «${compact(selectedText, 180)}»${nearestSection(common) ? ` в разделе «${compact(nearestSection(common), 140)}»` : ''}.`,
          confidence: 0.88,
          signals: [`selection=${compact(selectedText, 140)}`, `common=${cssPath(common)}`]
        },
        previousNavigation: state.lastNavigation
      }
    };
  }

  function recordSelection(reason) {
    const snapshot = selectionSnapshot();
    if (!snapshot) return;
    const now = Date.now();
    if (snapshot.fingerprint === state.lastSelectionFingerprint && now - state.lastSelectionAt < 1500) return;
    state.lastSelectionFingerprint = snapshot.fingerprint;
    state.lastSelectionAt = now;
    void record(
      'operator_selection',
      `SELECT · ${compact(snapshot.details.selectedText, 120)}`,
      { ...snapshot.details, reason }
    );
  }

  function meaningfulHoverTarget(raw) {
    if (!raw || raw.nodeType !== 1) return null;
    return raw.closest?.('a,button,input,select,textarea,[onclick],[role="button"],[role="link"],summary') || null;
  }

  function pageEntry(reason = 'document') {
    const type = navigationType();
    const current = {
      at: nowIso(),
      reason,
      type,
      method: 'GET',
      url: safeUrl(location.href),
      referrer: safeUrl(document.referrer || ''),
      page: pageContext()
    };
    state.lastNavigation = current;
    const isReturn = type === 'back_forward' || reason === 'popstate';
    void record(
      isReturn ? 'operator_return' : 'operator_navigation',
      `${isReturn ? 'RETURN' : 'NAVIGATE'} · ${current.page.pageKind || current.url}`,
      {
        eventId: eventId(isReturn ? 'return' : 'nav'),
        action: isReturn ? 'return' : 'navigation',
        navigation: current,
        semantic: {
          intent: isReturn ? 'возврат/история браузера' : 'переход страницы',
          hint: isReturn
            ? `Оператор вернулся через историю браузера на ${current.page.pageKind || current.url}.`
            : `Открыта страница ${current.page.pageKind || current.url} методом GET.`,
          confidence: 0.92,
          signals: [`navigation.type=${type}`, current.referrer ? `referrer=${current.referrer}` : '']
            .filter(Boolean)
        }
      }
    );
  }

  function configuredEnabled() {
    return Boolean(WB.store?.activeCase?.()?.workflow?.operatorTrace?.enabled);
  }

  function clearCaptureListeners() {
    clearTimeout(state.scrollTimer);
    clearTimeout(state.flushTimer);
    state.scrollTimer = null;
    state.flushTimer = null;
    if (state.uiObserver) {
      try { state.uiObserver.disconnect(); } catch {}
      state.uiObserver = null;
    }
    for (const off of state.listeners.splice(0)) {
      try { off(); } catch {}
    }
  }

  function activeSemanticTarget() {
    const session = WB.actionLifecycle?.current?.();
    if (!session) return null;
    const now = Date.now();
    if (state.semanticTargetCache?.isConnected && now - Number(state.semanticTargetCacheAt || 0) < 120) {
      return state.semanticTargetCache;
    }
    const target = WB.actionLifecycle?.resolve?.(session, WB.store?.activeCase?.())?.element || null;
    state.semanticTargetCache = target?.isConnected ? target : null;
    state.semanticTargetCacheAt = now;
    return state.semanticTargetCache;
  }

  function meaningfulUiNode(node) {
    if (!node || node.nodeType !== 1) return null;
    const element = node;
    if (isWorkbenchElement(element)) return null;
    const target = activeSemanticTarget();
    if (target && (element === target || element.contains?.(target) || target.contains?.(element))) return target;
    return null;
  }

  function isVolatileTraceElement(element) {
    if (!(element instanceof Element)) return false;
    if (isWorkbenchElement(element)) return true;
    return Boolean(element.closest?.(
      '#to_top,' +
      '[id^="ifaceLastTimeInfo"],' +
      '[id^="ifTrafficInfo"],' +
      '[id^="ifTrafficIn"],' +
      '[id^="ifTrafficOut"],' +
      '#labelPollerTaskWaitId,' +
      'span[id^="spanOnuRx"][id$="Id"] i'
    ));
  }

  function recentNativeUiMutationTarget(mutation) {
    const now = Date.now();
    if (now - Number(state.lastInteractionAt || 0) > 1800) return null;
    const node = mutation?.target?.nodeType === 1 ? mutation.target : null;
    if (!node || isWorkbenchElement(node) || isVolatileTraceElement(node)) return null;

    if (mutation.type === 'attributes') {
      const attr = String(mutation.attributeName || '');
      if (['style', 'hidden', 'aria-expanded', 'aria-hidden'].includes(attr)) return node;
      if (attr === 'class') {
        const before = String(mutation.oldValue || '');
        const after = String(node.getAttribute?.('class') || '');
        if (/(?:^|[-_\s])(open|opened|active|show|shown|hide|hidden|collapse|collapsed|expand|expanded|selected)(?:$|[-_\s])/i.test(`${before} ${after}`)) return node;
      }
      return null;
    }

    if (mutation.type === 'childList') {
      const section = node.closest?.('details,fieldset,section,article,.panel,.card,.table_block,.item,[id]') || node;
      const descriptor = targetDescriptor(section);
      if (descriptor?.id || descriptor?.text) return section;
    }
    return null;
  }

  function startUiObserver() {
    if (!state.enabled || state.uiObserver || typeof MutationObserver === 'undefined' || !document.documentElement) return;
    state.uiObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = meaningfulUiNode(mutation.target)
          || [...(mutation.addedNodes || [])].map(meaningfulUiNode).find(Boolean)
          || [...(mutation.removedNodes || [])].map(meaningfulUiNode).find(Boolean)
          || recentNativeUiMutationTarget(mutation);
        if (!target || isWorkbenchElement(target) || isVolatileTraceElement(target)) {
          if (target && isWorkbenchElement(target)) WB.performanceMonitor?.count?.('mutationsIgnoredWorkbenchUi');
          continue;
        }
        const descriptor = targetDescriptor(target) || {};
        const before = mutation.type === 'attributes' ? compact(mutation.oldValue || '', 280) : '';
        const after = mutation.type === 'attributes' ? compact(target.getAttribute?.(mutation.attributeName || '') || '', 280) : '';
        const key = `${mutation.type}|${cssPath(target)}|${mutation.attributeName || ''}|${before}|${after}|${descriptor.visual?.visible}`;
        const now = Date.now();
        if (now - Number(state.uiFingerprints.get(key) || 0) < 120) continue;
        state.uiFingerprints.set(key, now);
        if (state.uiFingerprints.size > 200) {
          for (const [fingerprint, at] of state.uiFingerprints) if (now - at > 5000) state.uiFingerprints.delete(fingerprint);
        }
        queueTraceEvent('UI_CHANGE', `UI CHANGE · ${mutation.type}${mutation.attributeName ? ` · ${mutation.attributeName}` : ''}`, {
          action: 'ui_change',
          mutationType: mutation.type,
          attribute: mutation.attributeName || '',
          from: before,
          to: after,
          target: descriptor,
          dom: { cssPath: cssPath(target) },
          visual: descriptor.visual || null,
          operationId: WB.actionLifecycle?.current?.()?.operationId || '',
          semanticTargetId: WB.actionLifecycle?.current?.()?.semanticTargetId || '',
          correlatedToRecentOperatorAction: now - Number(state.lastInteractionAt || 0) <= 1800,
          correlatedOperatorTarget: state.lastInteractionTarget || null
        });
      }
    });
    // Manual TRACE only. The document observer is intentionally temporary and
    // aggressively filtered to Workbench/active semantic targets or short-lived
    // native UI changes correlated with the operator's latest click.
    state.uiObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class','style','hidden','aria-expanded','aria-hidden']
    });
  }

  function recordSystemEvent(type, details = {}) {
    if (!state.enabled) return false;
    return queueTraceEvent(type, type.replace(/_/g, ' '), {
      action: 'workbench_system',
      operationId: details.operationId || WB.actionLifecycle?.current?.()?.operationId || '',
      semanticTargetId: details.semanticTargetId || WB.actionLifecycle?.current?.()?.semanticTargetId || '',
      ...details
    });
  }

  async function exportTrace() {
    await flushTrace();
    const root = await readTraceStore();
    const session = root.sessions?.[state.traceSessionId] || null;
    let diagnostics = {};
    try {
      const stored = await chrome.storage.local.get(['simnet_workbench_diagnostics_v1','simnet_workbench_diagnostics_fallback_v1']);
      diagnostics = {
        persistent: stored?.simnet_workbench_diagnostics_v1 || null,
        emergencyFallback: stored?.simnet_workbench_diagnostics_fallback_v1 || []
      };
    } catch {}
    return {
      schema: 'simnet-workbench-trace-export-v2',
      workbenchVersion: WB.version || '',
      exportedAt: nowIso(),
      traceSessionId: state.traceSessionId,
      activeCaseId: WB.store?.localCaseId || '',
      trace: session,
      activeActionSession: WB.actionLifecycle?.inspect?.() || null,
      diagnostics
    };
  }

  function downloadJson(name, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function stopAndExport() {
    if (state.enabled) disable('manual-export');
    if (state.flushing) await new Promise(resolve => setTimeout(resolve, TRACE_FLUSH_MS + 40));
    await flushTrace();
    const payload = await exportTrace();
    const stamp = nowIso().replace(/[:.]/g, '-');
    downloadJson(`simnet-workbench-trace-${stamp}.json`, payload);
    return payload;
  }

  function enable() {
    if (state.destroyed || state.enabled) return false;
    state.enabled = true;
    state.scrollStartY = window.scrollY;
    state.lastScrollY = window.scrollY;
    const currentCase = WB.store?.activeCase?.() || null;
    const configuredStart = String(currentCase?.workflow?.operatorTrace?.startedAt || currentCase?.workflow?.operatorTrace?.activatedAt || '');
    state.startedAt = configuredStart || nowIso();
    state.stoppedAt = '';
    state.traceSessionId = `${String(currentCase?.id || WB.store?.localCaseId || 'case').replace(/[^a-z0-9_-]+/gi,'_').slice(0,80)}_${state.startedAt.replace(/[^0-9]/g,'').slice(0,17)}`;
    pageEntry('trace-activated');
    queueTraceEvent('TRACE_STARTED', 'DIAGNOSTIC TRACE · START', { action: 'trace_start', traceSessionId: state.traceSessionId });
    startUiObserver();

    on(document, 'click', event => {
      const details = clickDetails(event);
      if (!details) return;
      state.lastInteractionTarget = details.target || details.rawTarget || null;
      state.lastInteractionAt = Date.now();
      state.semanticTargetCache = null;
      state.semanticTargetCacheAt = 0;
      const label = details.target?.text || details.target?.ariaLabel || details.target?.tag || 'элемент';
      const prefix = details.clickCount > 1 ? `CLICK #${details.clickCount}` : 'CLICK';
      void record('operator_click', `${prefix} · ${compact(label, 140)}`, details);
    }, true);

    on(document, 'dblclick', event => {
      const details = clickDetails(event);
      if (!details) return;
      details.action = 'double_click';
      details.clickCount = 2;
      details.eventId = eventId('dblclick');
      const label = details.target?.text || details.target?.ariaLabel || details.target?.tag || 'элемент';
      void record('operator_double_click', `DOUBLE CLICK · ${compact(label, 140)}`, details);
    }, true);

    on(document, 'mouseup', event => {
      if (event.button !== 0) return;
      setTimeout(() => recordSelection('mouse'), 0);
    }, true);

    on(document, 'keyup', event => {
      if (!event.shiftKey && !['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      setTimeout(() => recordSelection('keyboard'), 0);
    }, true);

    on(document, 'change', event => {
      const raw = eventElement(event);
      if (!raw || isWorkbenchElement(raw, event) || !raw.matches?.('input,select,textarea')) return;
      // Legacy UserSide emits synthetic change events while a textarea is being
      // typed. Free text is recorded once on blur and never stored verbatim.
      if (isFreeTextControl(raw)) return;
      const descriptor = targetDescriptor(raw);
      const details = {
        eventId: eventId('change'),
        action: 'change',
        section: nearestSection(raw),
        target: descriptor,
        dom: domContext(raw),
        value: safeControlValue(raw),
        semantic: semanticFor(raw, descriptor, formNavigation(raw)),
        previousNavigation: state.lastNavigation
      };
      void record('operator_change', `CHANGE · ${compact(descriptor?.text || descriptor?.name || descriptor?.id || descriptor?.tag, 120)} → ${compact(details.value, 120)}`, details);
    }, true);

    on(document, 'focusout', event => {
      const raw = eventElement(event);
      if (!raw || isWorkbenchElement(raw, event) || !isFreeTextControl(raw)) return;
      const value = safeControlValue(raw);
      if (state.lastTextChange.get(raw) === value) return;
      state.lastTextChange.set(raw, value);
      const descriptor = targetDescriptor(raw);
      const details = {
        eventId: eventId('text-change'),
        action: 'text_change_complete',
        section: nearestSection(raw),
        target: descriptor,
        dom: domContext(raw),
        value,
        semantic: semanticFor(raw, descriptor, formNavigation(raw)),
        previousNavigation: state.lastNavigation
      };
      void record(
        'operator_change',
        `CHANGE · ${compact(descriptor?.text || descriptor?.name || descriptor?.id || descriptor?.tag, 120)} → ${value}`,
        details
      );
    }, true);

    on(document, 'submit', event => {
      const form = nodeElement(event.target);
      if (!form || isWorkbenchElement(form, event)) return;
      const navigation = {
        kind: 'form',
        method: String(form.method || 'GET').toUpperCase(),
        from: safeUrl(location.href),
        to: safeUrl(form.action || location.href),
        target: form.target || ''
      };
      const descriptor = targetDescriptor(form);
      void record('operator_submit', `SUBMIT · ${navigation.method} ${compact(navigation.to, 180)}`, {
        eventId: eventId('submit'),
        action: 'submit',
        section: nearestSection(form),
        target: descriptor,
        dom: domContext(form),
        navigation,
        semantic: semanticFor(form, descriptor, navigation),
        previousNavigation: state.lastNavigation
      });
    }, true);

    on(document, 'keydown', event => {
      if (!['Enter', 'Escape'].includes(event.key)) return;
      const raw = eventElement(event);
      if (raw && isWorkbenchElement(raw, event)) return;
      const element = actionableElement(raw);
      const descriptor = targetDescriptor(element);
      void record('operator_key', `KEY · ${event.key}${descriptor?.text ? ` · ${compact(descriptor.text, 100)}` : ''}`, {
        eventId: eventId('key'),
        action: 'key',
        key: event.key,
        modifiers: { alt: Boolean(event.altKey), ctrl: Boolean(event.ctrlKey), shift: Boolean(event.shiftKey), meta: Boolean(event.metaKey) },
        target: descriptor,
        section: nearestSection(element),
        semantic: {
          intent: 'клавиатурное действие',
          hint: `Оператор нажал ${event.key}${descriptor?.text ? ` на «${compact(descriptor.text, 120)}»` : ''}.`,
          confidence: 0.78,
          signals: [descriptor?.text ? `target=${compact(descriptor.text, 120)}` : ''].filter(Boolean)
        },
        previousNavigation: state.lastNavigation
      });
    }, true);

    on(window, 'scroll', () => {
      if (!state.scrollTimer) state.scrollStartY = state.lastScrollY;
      state.lastScrollY = window.scrollY;
      clearTimeout(state.scrollTimer);
      state.scrollTimer = setTimeout(() => {
        const fromY = Math.round(state.scrollStartY);
        const toY = Math.round(state.lastScrollY);
        const delta = toY - fromY;
        state.scrollTimer = null;
        if (Math.abs(delta) < 80) return;
        const direction = delta > 0 ? '↓' : '↑';
        void record('operator_scroll', `SCROLL ${direction} · ${Math.abs(delta)} px`, {
          eventId: eventId('scroll'),
          action: 'scroll',
          fromY,
          toY,
          deltaY: delta,
          viewport: { width: innerWidth, height: innerHeight },
          section: nearestHeading(),
          semantic: {
            intent: 'прокрутка страницы',
            hint: `Оператор прокрутил страницу ${delta > 0 ? 'вниз' : 'вверх'} примерно на ${Math.abs(delta)} px.`,
            confidence: 0.9,
            signals: [`scrollY:${fromY}->${toY}`]
          },
          previousNavigation: state.lastNavigation
        });
      }, SCROLL_SETTLE_MS);
    }, { passive: true, capture: true });

    on(window, 'popstate', () => {
      state.lastNavigation = {
        at: nowIso(),
        reason: 'popstate',
        type: 'back_forward',
        method: 'GET',
        url: safeUrl(location.href),
        referrer: safeUrl(document.referrer || ''),
        page: pageContext()
      };
      void record('operator_return', `RETURN · ${state.lastNavigation.page.pageKind || state.lastNavigation.url}`, {
        eventId: eventId('return'),
        action: 'return',
        navigation: state.lastNavigation,
        semantic: {
          intent: 'возврат/история браузера',
          hint: 'Оператор перешёл назад/вперёд через историю браузера.',
          confidence: 0.98,
          signals: ['popstate']
        }
      });
    }, true);

    on(window, 'hashchange', event => {
      void record('operator_navigation', `NAVIGATE HASH · ${compact(location.hash, 140)}`, {
        eventId: eventId('hash'),
        action: 'navigation',
        navigation: {
          type: 'hashchange',
          method: 'GET',
          from: safeUrl(event.oldURL || ''),
          to: safeUrl(event.newURL || location.href)
        },
        semantic: {
          intent: 'переход внутри страницы',
          hint: 'Изменён hash/внутренняя позиция страницы.',
          confidence: 0.9,
          signals: ['hashchange']
        }
      });
    }, true);

    WB.log?.info?.('TRACE', 'Подробный журнал действий оператора включён', {
      caseId: WB.store.localCaseId,
      pageKind: pageContext().pageKind
    });
    return true;
  }

  function disable(reason = 'manual') {
    if (!state.enabled) return false;
    queueTraceEvent('TRACE_STOPPED', 'DIAGNOSTIC TRACE · STOP', { action: 'trace_stop', reason, traceSessionId: state.traceSessionId });
    state.stoppedAt = nowIso();
    scheduleFlush(true);
    clearCaptureListeners();
    state.lastInteractionTarget = null;
    state.lastInteractionAt = 0;
    state.semanticTargetCache = null;
    state.semanticTargetCacheAt = 0;
    state.enabled = false;
    WB.log?.info?.('TRACE', 'Подробный журнал действий оператора выключен', {
      caseId: WB.store.localCaseId,
      pageKind: pageContext().pageKind
    });
    return true;
  }

  function setEnabled(enabled) {
    return enabled ? enable() : disable();
  }

  function syncFromStore() {
    setEnabled(configuredEnabled());
  }

  function init() {
    if (state.ready || state.destroyed) return;
    state.ready = true;
    state.storeOff = WB.bus?.on?.('store:state', syncFromStore) || null;
    syncFromStore();
  }

  function destroy() {
    if (state.destroyed) return;
    disable();
    state.destroyed = true;
    if (typeof state.storeOff === 'function') {
      try { state.storeOff(); } catch {}
    }
    state.storeOff = null;
    clearCaptureListeners();
  }

  WB.operatorTrace = {
    init,
    destroy,
    setEnabled,
    isEnabled: () => state.enabled,
    recordPageEntry: pageEntry,
    recordSystemEvent,
    exportTrace,
    stopAndExport,
    flush: flushTrace,
    storageKey: TRACE_STORAGE_KEY,
    snapshotElement: element => ({
      target: targetDescriptor(element),
      dom: domContext(element),
      section: nearestSection(element),
      page: pageContext()
    })
  };
})();
