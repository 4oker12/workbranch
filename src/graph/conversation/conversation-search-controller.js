(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const search = WB?.operatorGuideSearch;
  const runtime = WB?.conversationGraphRuntime;
  if (!WB || !search || !runtime || WB.operatorGuideSearchUi) return;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-guide-search-style-v1';
  const DEBOUNCE_MS = 110;
  const UI_MAX_RESULTS = 4;
  const HIGH_THRESHOLD = 0.60;
  const MEDIUM_THRESHOLD = 0.43;
  const LOW_THRESHOLD = 0.34;
  const SEARCH_CLASSES = ['search-match-high', 'search-match-medium', 'search-match-low'];

  const state = {
    active: false, panel: null, shadow: null, query: '', results: [], generation: 0,
    debounceTimer: 0, inputHandler: null, clickHandler: null, unsubscribeStore: null, caseKey: ''
  };

  const factValue = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
  function activeCase() { return WB.store?.activeCase?.() || null; }
  function currentCaseKey(caseData = activeCase()) {
    return String(caseData?.id || caseData?.caseId || factValue(caseData?.identity?.login) || factValue(caseData?.identity?.contract) || '');
  }

  function searchStyles() {
    return `<style id="${STYLE_ID}">
      .guide-main{grid-template-rows:auto auto 1fr auto!important}
      .guide-search-row{display:flex;align-items:center;gap:10px;padding:0 20px 6px;min-width:0}
      .guide-search-box{position:relative;display:flex;align-items:center;width:min(520px,100%);min-width:220px}
      .guide-search-input{width:100%;height:36px;padding:0 13px 0 36px;border:1px solid #E4E7EC;border-radius:10px;background:#FCFCFD;color:#344054;outline:none;font:600 11px/1.2 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 1px 2px rgba(16,24,40,.03);transition:border-color .14s ease,box-shadow .14s ease,background .14s ease}
      .guide-search-input::placeholder{color:#98A2B3;font-weight:500}.guide-search-input:focus{border-color:var(--accent);background:#fff;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 10%,transparent)}
      .guide-search-icon{position:absolute;left:12px;width:15px;height:15px;pointer-events:none;color:#98A2B3}.guide-search-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .guide-search-status{min-width:0;color:#667085;font:600 10px/1.25 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .guide-tab.search-topic-match:not(.active){border-color:color-mix(in srgb,var(--accent) 58%,#E4E7EC);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 8%,transparent)}
      .guide-tab.active.search-topic-match{box-shadow:0 8px 20px color-mix(in srgb,var(--accent) 18%,transparent),inset 0 -3px 0 rgba(255,255,255,.36)}
      .guide-cloud.search-match-high{outline:3px solid color-mix(in srgb,var(--accent) 34%,transparent);outline-offset:4px}
      .guide-cloud.search-match-high:not(.active){border-color:var(--accent);box-shadow:0 14px 30px color-mix(in srgb,var(--accent) 20%,transparent)}
      .guide-cloud.search-match-medium:not(.active){border-color:color-mix(in srgb,var(--accent) 60%,#E7E0E4);box-shadow:0 10px 24px color-mix(in srgb,var(--accent) 12%,transparent)}
      .guide-cloud.search-match-low:not(.active){border-color:color-mix(in srgb,var(--accent) 34%,#E7E0E4);box-shadow:0 8px 20px color-mix(in srgb,var(--accent) 8%,transparent)}
      @media(max-height:860px){.guide-search-row{padding:0 20px 3px}.guide-search-input{height:33px}}
      @media(max-width:1080px){.guide-search-row{gap:8px}.guide-search-box{width:min(430px,100%)}.guide-search-status{font-size:9px}}
      @media(prefers-reduced-motion:reduce){.guide-search-input{transition:none}}
    </style>`;
  }

  function ensureStyle() {
    if (!state.shadow || state.shadow.getElementById?.(STYLE_ID)) return;
    const template = document.createElement('template');
    template.innerHTML = searchStyles();
    state.shadow.appendChild(template.content.cloneNode(true));
  }

  function searchIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>'; }

  function ensureSearchUi() {
    if (!state.active || !runtime.isActive?.() || !state.panel?.isConnected) return false;
    const root = state.panel.querySelector?.('.guide-root');
    const tabs = root?.querySelector?.('.guide-tabs');
    if (!root || !tabs) return false;
    let row = root.querySelector?.('[data-guide-search-host]');
    if (!row) {
      const template = document.createElement('template');
      template.innerHTML = `<div class="guide-search-row" data-guide-search-host>
        <label class="guide-search-box"><span class="guide-search-icon">${searchIcon()}</span><input class="guide-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Как абонент описывает проблему?" aria-label="Поиск по формулировке абонента" data-guide-search-input></label>
        <span class="guide-search-status" aria-live="polite" data-guide-search-status></span>
      </div>`;
      row = template.content.firstElementChild;
      tabs.insertAdjacentElement('afterend', row);
    }
    const input = row.querySelector?.('[data-guide-search-input]');
    if (input && input.value !== state.query) input.value = state.query;
    applyHighlights();
    return true;
  }

  function clearHighlights() {
    if (!state.panel) return;
    state.panel.querySelectorAll?.('.guide-tab.search-topic-match').forEach(node => node.classList.remove('search-topic-match'));
    state.panel.querySelectorAll?.('.guide-cloud.search-match-high,.guide-cloud.search-match-medium,.guide-cloud.search-match-low').forEach(node => node.classList.remove(...SEARCH_CLASSES));
  }

  function uiResults() {
    const eligible = state.results.filter(result => Number(result.score) >= LOW_THRESHOLD);
    const selected = [];
    let highCount = 0;
    for (const result of eligible) {
      const high = result.score >= HIGH_THRESHOLD;
      if (high && highCount >= 2) continue;
      selected.push(result);
      if (high) highCount += 1;
      if (selected.length >= UI_MAX_RESULTS) break;
    }
    return selected;
  }

  function resultLevel(score) { return score >= HIGH_THRESHOLD ? 'search-match-high' : score >= MEDIUM_THRESHOLD ? 'search-match-medium' : 'search-match-low'; }

  function updateStatus(selected) {
    const node = state.panel?.querySelector?.('[data-guide-search-status]');
    if (!node) return;
    if (!state.query) { node.textContent = ''; return; }
    node.textContent = selected.length ? 'Подсвечены наиболее близкие варианты' : 'Нет достаточно уверенного совпадения';
  }

  function applyHighlights(expectedGeneration = state.generation) {
    if (!state.active || expectedGeneration !== state.generation) return false;
    clearHighlights();
    if (!state.query) { updateStatus([]); return true; }
    const selected = uiResults();
    const activeTopicId = String(runtime.activeTopic?.() || '');
    const topicIds = new Set(selected.map(result => String(result.topicId || '')));
    for (const topicId of topicIds) state.panel.querySelector?.(`.guide-tab[data-topic-id="${CSS.escape(topicId)}"]`)?.classList.add('search-topic-match');
    for (const result of selected) {
      if (String(result.topicId || '') !== activeTopicId) continue;
      const symptomId = String(result.symptomId || '');
      state.panel.querySelector?.(`.guide-cloud[data-symptom-id="${CSS.escape(symptomId)}"]`)?.classList.add(resultLevel(Number(result.score) || 0));
    }
    updateStatus(selected);
    return true;
  }

  function cancelDebounce() { if (state.debounceTimer) { clearTimeout(state.debounceTimer); state.debounceTimer = 0; } }
  function resetSearch({ clearDom = true } = {}) {
    cancelDebounce(); state.generation += 1; state.query = ''; state.results = [];
    if (clearDom) {
      clearHighlights();
      const input = state.panel?.querySelector?.('[data-guide-search-input]');
      if (input) input.value = '';
      updateStatus([]);
    }
  }

  function runSearch(query, generation) {
    if (!state.active || generation !== state.generation || query !== state.query) return;
    state.debounceTimer = 0;
    const results = search.search(query);
    if (!state.active || generation !== state.generation || query !== state.query) return;
    state.results = Array.isArray(results) ? results : [];
    applyHighlights(generation);
  }

  function onPanelInput(event) {
    const input = event.target?.closest?.('[data-guide-search-input]');
    if (!input || !state.panel?.contains?.(input)) return;
    cancelDebounce();
    const query = String(input.value || '').replace(/\s+/g, ' ').trim();
    state.query = query; state.results = [];
    const generation = ++state.generation;
    if (!query) { applyHighlights(generation); return; }
    state.debounceTimer = setTimeout(() => runSearch(query, generation), DEBOUNCE_MS);
  }

  function onPanelClick() {
    if (!state.active) return;
    queueMicrotask(() => { if (state.active && runtime.isActive?.()) ensureSearchUi(); });
  }

  function onStoreState() {
    if (!state.active) return;
    const nextCaseKey = currentCaseKey();
    if (nextCaseKey !== state.caseKey) { state.caseKey = nextCaseKey; resetSearch({ clearDom: false }); }
    queueMicrotask(() => { if (state.active && runtime.isActive?.()) ensureSearchUi(); });
  }

  function detachPanel() {
    resetSearch();
    state.unsubscribeStore?.(); state.unsubscribeStore = null;
    if (state.panel && state.inputHandler) state.panel.removeEventListener('input', state.inputHandler, true);
    if (state.panel && state.clickHandler) state.panel.removeEventListener('click', state.clickHandler, true);
    state.inputHandler = null; state.clickHandler = null; state.active = false; state.panel = null; state.shadow = null; state.caseKey = '';
  }

  function attachPanel({ fresh = false } = {}) {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot || null;
    const panel = shadow?.querySelector('.module') || null;
    if (!shadow || !panel || !runtime.isActive?.()) return false;
    if (state.panel && state.panel !== panel) detachPanel();
    state.shadow = shadow; state.panel = panel;
    if (fresh) resetSearch({ clearDom: false });
    state.active = true; state.caseKey = currentCaseKey(); ensureStyle();
    if (!state.inputHandler) { state.inputHandler = onPanelInput; panel.addEventListener('input', state.inputHandler, true); }
    if (!state.clickHandler) { state.clickHandler = onPanelClick; panel.addEventListener('click', state.clickHandler, true); }
    if (!state.unsubscribeStore && WB.bus?.on) state.unsubscribeStore = WB.bus.on('store:state', onStoreState);
    return ensureSearchUi();
  }

  function afterRuntimeOpen() {
    queueMicrotask(() => { queueMicrotask(() => { if (runtime.isActive?.()) attachPanel({ fresh: !state.active }); }); });
  }

  function onModuleOpen(event) {
    if (event?.detail?.module !== 'graph') return;
    if (event.detail?.mode !== 'runtime') { if (state.active) detachPanel(); return; }
    afterRuntimeOpen();
  }
  function onModuleClose(event) { if (event?.detail?.module === 'graph' && state.active) detachPanel(); }

  window.addEventListener('simnet-workbench-module-open', onModuleOpen);
  window.addEventListener('simnet-workbench-module-close', onModuleClose);

  WB.operatorGuideSearchUi = Object.freeze({
    revision: 'operator-guide-local-search-ui-v1',
    stats: () => ({
      active: state.active, queryLength: state.query.length, resultCount: state.results.length, generation: state.generation,
      debouncePending: Boolean(state.debounceTimer), hasInputListener: Boolean(state.inputHandler), hasClickListener: Boolean(state.clickHandler), hasStoreSubscription: Boolean(state.unsubscribeStore)
    })
  });
})();