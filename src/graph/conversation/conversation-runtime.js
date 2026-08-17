(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__conversationGraphRuntimeLoaded) return;
  if (!WB.graphStudio || typeof WB.graphStudio.open !== 'function') return;

  WB.__conversationGraphRuntimeLoaded = true;

  const baseGraphStudio = WB.graphStudio;
  const content = WB.conversationGraphContent;
  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-guide-style';

  const state = {
    active: false,
    expanded: false,
    activeTypeId: content?.defaultTopicId || 'low_speed',
    caseKey: '',
    panel: null,
    shadow: null,
    clickHandler: null,
    moduleCloseHandler: null,
    unsubscribeStore: null,
    renderCount: 0
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const factValue = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;

  function activeCase() {
    return WB.store?.activeCase?.() || null;
  }

  function currentCaseKey(caseData = activeCase()) {
    return String(
      caseData?.id
      || caseData?.caseId
      || factValue(caseData?.identity?.login)
      || factValue(caseData?.identity?.contract)
      || ''
    );
  }

  function initialTopicId(caseData = activeCase()) {
    const appeal = WB.appeals?.normalize?.(caseData?.appeal) || null;
    const appealType = WB.appeals?.typeForState?.(appeal) || null;
    return content?.normalizeTopicId?.(appealType?.id || content?.defaultTopicId) || 'low_speed';
  }

  function syncCaseContext(caseData = activeCase()) {
    const key = currentCaseKey(caseData);
    if (key === state.caseKey) return;
    state.caseKey = key;
    state.activeTypeId = initialTopicId(caseData);
  }

  function icon(name) {
    const paths = {
      book: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/>',
      chat: '<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8 10h8M8 13h5"/>',
      bulb: '<path d="M9 18h6M10 21h4"/><path d="M8.2 14.5A6 6 0 1 1 15.8 14.5C14.7 15.4 14 16.4 14 18h-4c0-1.6-.7-2.6-1.8-3.5Z"/>',
      speed: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="m12 13 4-4"/><circle cx="12" cy="13" r="1.5"/>',
      'globe-off': '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2 2.2 3 4.9 3 8 0 1.1-.1 2.1-.4 3.1M12 20c-2-2.2-3-4.9-3-8 0-1.2.2-2.4.5-3.5M5 5l14 14"/>',
      unstable: '<path d="M4 9c4.7-4 11.3-4 16 0M7 12.5c3-2.6 7-2.6 10 0M10 16c1.2-1 2.8-1 4 0"/><path d="M5 20 19 6"/>',
      more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chat}</svg>`;
  }

  function styles() {
    return `<style id="${STYLE_ID}">
      .guide-root{height:100%;min-height:0;display:grid;grid-template-rows:74px 1fr;background:#F7F7F9;color:#1D2939;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
      .guide-root *{box-sizing:border-box}
      .guide-topbar{display:flex;align-items:center;gap:14px;padding:0 22px;background:#fff;border-bottom:1px solid #E4E7EC}
      .guide-brand{display:flex;align-items:center;gap:12px;min-width:0;margin-right:auto}.guide-mark{width:42px;height:42px;border-radius:50%;background:#8F174F;color:#fff;display:grid;place-items:center;box-shadow:0 8px 20px rgba(143,23,79,.2)}
      .guide-mark svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.guide-brand b,.guide-brand small{display:block}.guide-brand b{font-size:18px;color:#6E1D45;line-height:1.1}.guide-brand small{margin-top:5px;color:#667085;font-size:11px}
      .guide-actions{display:flex;align-items:center;gap:7px}.guide-icon-btn{width:34px;height:34px;border:0;background:transparent;color:#475467;border-radius:9px;cursor:pointer;display:grid;place-items:center;font:700 14px/1 system-ui}.guide-icon-btn:hover{background:#F2F4F7}.guide-icon-btn svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .guide-shell{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,380px);background:#fff}.guide-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto 1fr auto;border-right:1px solid #EAECF0;background:linear-gradient(180deg,#fff 0%,#FBFBFC 100%)}
      .guide-tabs{display:flex;gap:9px;padding:16px 20px 10px;overflow:auto}.guide-tab{height:42px;flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;padding:0 15px;border:1px solid #E4E7EC;border-radius:11px;background:#fff;color:#344054;font:750 11px/1 system-ui;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.03);transition:.14s ease}.guide-tab:hover{border-color:#C76A92;background:#FFF9FB}.guide-tab.active{background:linear-gradient(135deg,#8F174F,#A50046);border-color:#8F174F;color:#fff;box-shadow:0 8px 20px rgba(143,23,79,.18)}.guide-tab svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .guide-board-wrap{min-height:0;overflow:auto;padding:8px 20px 12px}.guide-board{min-width:690px;max-width:860px;min-height:510px;margin:0 auto;display:grid;grid-template-columns:1fr 1.12fr 1fr;grid-template-rows:1fr 1.05fr 1fr;gap:18px 22px;align-items:center;justify-items:center;position:relative;padding:12px}.guide-board:before{content:"";position:absolute;inset:13% 16%;border:1.5px dashed rgba(143,23,79,.25);border-radius:44%;pointer-events:none}
      .guide-core{grid-column:2;grid-row:2;z-index:3;width:230px;min-height:145px;padding:24px 22px;border-radius:46% 54% 48% 52% / 55% 45% 55% 45%;background:radial-gradient(circle at 35% 24%,#A73A70 0,#8F174F 43%,#74143F 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:0 16px 34px rgba(116,20,63,.22)}.guide-core svg{width:31px;height:31px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;margin-bottom:9px}.guide-core strong{white-space:pre-line;font-size:22px;line-height:1.08}.guide-core small{margin-top:7px;font-size:10px;opacity:.82}
      .guide-cloud{position:relative;z-index:2;width:176px;min-height:78px;padding:18px 18px 14px;border:1px solid #E7E0E4;border-radius:32px;background:#fff;color:#263238;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:700;line-height:1.35;box-shadow:0 8px 20px rgba(31,38,46,.07)}.guide-cloud:before,.guide-cloud:after{content:"";position:absolute;z-index:-1;background:#fff;border:1px solid #E7E0E4;border-bottom:0;border-right:0;border-radius:50%}.guide-cloud:before{width:48px;height:40px;left:24px;top:-17px}.guide-cloud:after{width:58px;height:46px;right:23px;top:-20px}.guide-cloud q{quotes:"“" "”";position:relative;z-index:2}.guide-cloud q:before,.guide-cloud q:after{color:#B44F7D;font-size:18px;line-height:0}
      .guide-cloud:nth-of-type(1){grid-column:1;grid-row:1}.guide-cloud:nth-of-type(2){grid-column:2;grid-row:1}.guide-cloud:nth-of-type(3){grid-column:3;grid-row:1}.guide-cloud:nth-of-type(4){grid-column:1;grid-row:2}.guide-cloud:nth-of-type(5){grid-column:3;grid-row:2}.guide-cloud:nth-of-type(6){grid-column:1;grid-row:3}.guide-cloud:nth-of-type(7){grid-column:2;grid-row:3}.guide-cloud:nth-of-type(8){grid-column:3;grid-row:3}
      .guide-footer{min-height:48px;margin:0 20px 16px;padding:0 14px;border:1px solid #EAE1E6;border-radius:12px;background:#FCF8FA;color:#667085;display:flex;align-items:center;gap:9px;font-size:10px}.guide-footer b{color:#7D244B}.guide-footer .dot{width:8px;height:8px;border-radius:50%;background:#A50046;flex:0 0 auto}
      .guide-side{min-width:0;min-height:0;overflow:auto;background:#fff;padding:17px 18px 20px}.guide-side-section+ .guide-side-section{margin-top:18px;padding-top:17px;border-top:1px solid #EAECF0}.guide-side-title{display:flex;align-items:center;gap:10px;margin-bottom:12px;color:#7B214A}.guide-side-title .round{width:34px;height:34px;border-radius:50%;background:#F9EEF3;display:grid;place-items:center}.guide-side-title svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.guide-side-title b{font-size:14px}.guide-question-list{display:grid;gap:9px}.guide-question{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid #E4E7EC;border-radius:11px;background:#fff;box-shadow:0 2px 7px rgba(16,24,40,.04);color:#344054;font-size:10.5px;line-height:1.4}.guide-question .bubble{width:28px;height:28px;border-radius:50%;flex:0 0 auto;background:#F8EDF2;color:#9B2E61;display:grid;place-items:center}.guide-question .bubble svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}.guide-meaning{display:grid;gap:9px}.guide-meaning-item{display:grid;grid-template-columns:20px 1fr;gap:8px;align-items:start;color:#475467;font-size:10.5px;line-height:1.45}.guide-meaning-item i{width:18px;height:18px;border-radius:50%;background:#8F174F;color:#fff;display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:900;margin-top:1px}
      .module.guide-expanded{width:calc(100vw - 88px)!important;height:calc(100vh - 24px)!important}
      @media(max-width:1080px){.guide-shell{grid-template-columns:minmax(0,1fr) 310px}.guide-board{min-width:640px}.guide-cloud{width:158px;font-size:10px}.guide-core{width:210px}}
    </style>`;
  }

  function ensureStyle() {
    if (!state.shadow || state.shadow.getElementById(STYLE_ID)) return;
    const template = document.createElement('template');
    template.innerHTML = styles();
    state.shadow.appendChild(template.content.cloneNode(true));
  }

  function renderTopbar(caseData) {
    const login = factValue(caseData?.identity?.login) || factValue(caseData?.identity?.contract) || 'без активного абонента';
    return `
      <header class="guide-topbar">
        <div class="guide-brand">
          <div class="guide-mark">${icon('book')}</div>
          <div><b>Пособие оператора</b><small>Что спросить у абонента · ${esc(login)}</small></div>
        </div>
        <div class="guide-actions">
          <button type="button" class="guide-icon-btn" data-guide-action="expand" title="Развернуть">${state.expanded ? '↘' : '↗'}</button>
          <button type="button" class="guide-icon-btn" data-guide-action="close" title="Закрыть">${icon('close')}</button>
        </div>
      </header>`;
  }

  function renderTabs(topics) {
    return `<div class="guide-tabs" role="tablist" aria-label="Темы обращения">
      ${topics.map(item => `<button type="button" class="guide-tab ${item.id === state.activeTypeId ? 'active' : ''}" role="tab" aria-selected="${item.id === state.activeTypeId ? 'true' : 'false'}" data-guide-action="topic" data-topic-id="${esc(item.id)}">${icon(item.icon)}<span>${esc(item.label)}</span></button>`).join('')}
    </div>`;
  }

  function renderBoard(topic) {
    const variants = Array.isArray(topic?.variants) ? topic.variants.slice(0, 8) : [];
    return `<div class="guide-board-wrap"><div class="guide-board">
      ${variants.map(text => `<div class="guide-cloud"><q>${esc(text)}</q></div>`).join('')}
      <section class="guide-core" aria-label="Суть жалобы">${icon(topic.icon)}<strong>${esc(topic.complaint)}</strong><small>${esc(topic.subtitle || 'Суть жалобы')}</small></section>
    </div></div>`;
  }

  function renderSide(topic) {
    const questions = Array.isArray(topic?.questions) ? topic.questions : [];
    const meaning = Array.isArray(topic?.meaning) ? topic.meaning : [];
    return `<aside class="guide-side">
      <section class="guide-side-section">
        <div class="guide-side-title"><span class="round">${icon('chat')}</span><b>Что спросить</b></div>
        <div class="guide-question-list">${questions.map(text => `<div class="guide-question"><span class="bubble">${icon('chat')}</span><span>${esc(text)}</span></div>`).join('')}</div>
      </section>
      <section class="guide-side-section">
        <div class="guide-side-title"><span class="round">${icon('bulb')}</span><b>Что это нам даёт</b></div>
        <div class="guide-meaning">${meaning.map(text => `<div class="guide-meaning-item"><i>✓</i><span>${esc(text)}</span></div>`).join('')}</div>
      </section>
    </aside>`;
  }

  function render() {
    if (!state.active || !state.panel || !state.shadow) return;
    const caseData = activeCase();
    syncCaseContext(caseData);
    const topics = content?.topics?.() || [];
    const topic = content?.topic?.(state.activeTypeId) || topics[0] || null;
    if (!topic) return;
    state.renderCount += 1;

    state.panel.innerHTML = `<div class="guide-root">
      ${renderTopbar(caseData)}
      <div class="guide-shell">
        <main class="guide-main">
          ${renderTabs(topics)}
          ${renderBoard(topic)}
          <div class="guide-footer"><span class="dot"></span><span><b>Это не диагностический граф.</b> Облачка — варианты формулировок абонента; tab меняет тему жалобы, вопросы и смысл уточнений. Никакой маршрут автоматически не запускается.</span></div>
        </main>
        ${renderSide(topic)}
      </div>
    </div>`;
    state.panel.classList.toggle('guide-expanded', state.expanded);
  }

  function onPanelClick(event) {
    if (!state.active) return;
    const target = event.target.closest?.('[data-guide-action]');
    const action = target?.dataset.guideAction;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'close') return void closeRuntime();
    if (action === 'expand') {
      state.expanded = !state.expanded;
      render();
      return;
    }
    if (action === 'topic') {
      const next = content?.normalizeTopicId?.(target.dataset.topicId || '');
      if (!next || next === state.activeTypeId) return;
      state.activeTypeId = next;
      render();
    }
  }

  function installRuntimeLifecycle() {
    if (!state.panel) return;
    if (!state.clickHandler) {
      state.clickHandler = onPanelClick;
      state.panel.addEventListener('click', state.clickHandler, true);
    }
    if (!state.unsubscribeStore && WB.bus?.on) {
      state.unsubscribeStore = WB.bus.on('store:state', () => {
        if (!state.active) return;
        syncCaseContext(activeCase());
        render();
      });
    }
  }

  function teardownRuntime() {
    state.active = false;
    state.unsubscribeStore?.();
    state.unsubscribeStore = null;
    if (state.panel && state.clickHandler) state.panel.removeEventListener('click', state.clickHandler, true);
    state.clickHandler = null;
    state.panel?.classList.remove('guide-expanded');
  }

  async function open(options = {}) {
    const requestedMode = typeof options === 'string' ? options : String(options?.mode || 'runtime');
    const mode = requestedMode === 'studio' ? 'studio' : requestedMode === 'semantic' ? 'semantic' : 'runtime';
    if (mode !== 'runtime') {
      teardownRuntime();
      return baseGraphStudio.open(options);
    }

    await baseGraphStudio.open({ mode: 'runtime' });
    const host = document.getElementById(HOST_ID);
    state.shadow = host?.shadowRoot || null;
    state.panel = state.shadow?.querySelector('.module') || null;
    if (!state.shadow || !state.panel) return;
    ensureStyle();
    state.active = true;
    state.caseKey = '';
    syncCaseContext(activeCase());
    installRuntimeLifecycle();
    render();
  }

  function closeRuntime() {
    teardownRuntime();
    return baseGraphStudio.close();
  }

  state.moduleCloseHandler = event => {
    if (event?.detail?.module === 'graph' && state.active) teardownRuntime();
  };
  window.addEventListener('simnet-workbench-module-close', state.moduleCloseHandler);

  const publicApi = Object.freeze({
    open,
    close: closeRuntime,
    isOpen: () => baseGraphStudio.isOpen(),
    mode: () => state.active ? 'runtime' : baseGraphStudio.mode()
  });

  WB.graphStudio = publicApi;
  WB.conversationGraphRuntime = Object.freeze({
    revision: 'operator-guide-tabs-v2',
    render: () => { if (state.active) render(); },
    isActive: () => state.active,
    activeTopic: () => state.activeTypeId,
    stats: () => ({
      active: state.active,
      renderCount: state.renderCount,
      activeTypeId: state.activeTypeId,
      hasStoreSubscription: Boolean(state.unsubscribeStore)
    })
  });
})();
