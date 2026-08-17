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
    activeSymptomId: '',
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
    if (key === state.caseKey) return false;
    state.caseKey = key;
    state.activeTypeId = initialTopicId(caseData);
    state.activeSymptomId = '';
    return true;
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
      .module.operator-guide-runtime.open{display:block!important;grid-template-rows:none!important}
      .module.operator-guide-runtime>.guide-root{width:100%;height:100%;min-width:0;min-height:0}
      .guide-root{--accent:#8F174F;--accent-dark:#74143F;--accent-soft:#F9EEF3;--accent-line:rgba(143,23,79,.25);height:100%;min-height:0;display:grid;grid-template-rows:74px 1fr;background:#F7F7F9;color:#1D2939;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
      .guide-root.theme-low-speed{--accent:#8F174F;--accent-dark:#74143F;--accent-soft:#F9EEF3;--accent-line:rgba(143,23,79,.25)}
      .guide-root.theme-no-internet{--accent:#A12C50;--accent-dark:#7C1D3C;--accent-soft:#FCEEF3;--accent-line:rgba(161,44,80,.27)}
      .guide-root.theme-unstable{--accent:#A34B16;--accent-dark:#7A3510;--accent-soft:#FFF4E8;--accent-line:rgba(163,75,22,.28)}
      .guide-root.theme-other{--accent:#596579;--accent-dark:#3D4757;--accent-soft:#F1F3F6;--accent-line:rgba(89,101,121,.25)}
      .guide-root *{box-sizing:border-box}.guide-root button{font:inherit}
      .guide-topbar{display:flex;align-items:center;gap:14px;padding:0 22px;background:#fff;border-bottom:1px solid #E4E7EC}
      .guide-brand{display:flex;align-items:center;gap:12px;min-width:0;margin-right:auto}.guide-mark{width:42px;height:42px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;box-shadow:0 8px 20px color-mix(in srgb,var(--accent) 22%,transparent)}
      .guide-mark svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.guide-brand b,.guide-brand small{display:block}.guide-brand b{font-size:18px;color:#6E1D45;line-height:1.1}.guide-brand small{margin-top:5px;color:#667085;font-size:11px}
      .guide-actions{display:flex;align-items:center;gap:7px}.guide-icon-btn{width:34px;height:34px;border:0;background:transparent;color:#475467;border-radius:9px;cursor:pointer;display:grid;place-items:center;font:700 14px/1 system-ui}.guide-icon-btn:hover{background:#F2F4F7}.guide-icon-btn svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .guide-shell{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(350px,400px);background:#fff}.guide-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto 1fr auto;border-right:1px solid #EAECF0;background:linear-gradient(180deg,#fff 0%,#FBFBFC 100%)}
      .guide-tabs{display:flex;gap:9px;padding:16px 20px 10px;overflow:auto}.guide-tab{height:42px;flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;padding:0 15px;border:1px solid #E4E7EC;border-radius:11px;background:#fff;color:#344054;font:750 11px/1 system-ui;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.03);transition:background .14s ease,border-color .14s ease,color .14s ease}.guide-tab:hover{border-color:var(--accent);background:var(--accent-soft)}.guide-tab.active{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 8px 20px color-mix(in srgb,var(--accent) 18%,transparent)}.guide-tab svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .guide-board-wrap{min-height:0;overflow:auto;padding:12px 20px 16px}.guide-board{min-width:690px;max-width:900px;min-height:530px;margin:0 auto;display:grid;grid-template-columns:1fr 1.12fr 1fr;grid-template-rows:1fr 1.05fr 1fr;gap:20px 24px;align-items:center;justify-items:center;position:relative;padding:20px}.guide-board:before{content:"";position:absolute;inset:13% 15%;border:1.5px dashed var(--accent-line);border-radius:44%;pointer-events:none;transition:border-color .14s ease,transform .14s ease}
      .guide-core{grid-column:2;grid-row:2;z-index:3;width:240px;min-height:150px;padding:24px 22px;border-radius:46% 54% 48% 52% / 55% 45% 55% 45%;background:radial-gradient(circle at 35% 24%,color-mix(in srgb,var(--accent) 82%,white) 0,var(--accent) 43%,var(--accent-dark) 100%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:0 16px 34px color-mix(in srgb,var(--accent-dark) 24%,transparent)}.guide-core svg{width:31px;height:31px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;margin-bottom:9px}.guide-core strong{white-space:pre-line;font-size:22px;line-height:1.08}.guide-core small{margin-top:7px;font-size:10px;opacity:.82}
      .guide-cloud{appearance:none;position:relative;z-index:2;width:180px;min-height:82px;padding:18px 18px 14px;border:1px solid #E7E0E4;border-radius:32px;background:#fff;color:#263238;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;font-weight:750;line-height:1.35;box-shadow:0 8px 20px rgba(31,38,46,.07);cursor:pointer;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease,color .14s ease}.guide-cloud:before,.guide-cloud:after{content:"";position:absolute;z-index:-1;background:inherit;border:1px solid #E7E0E4;border-bottom:0;border-right:0;border-radius:50%;transition:border-color .14s ease,background .14s ease}.guide-cloud:before{width:48px;height:40px;left:24px;top:-17px}.guide-cloud:after{width:58px;height:46px;right:23px;top:-20px}.guide-cloud q{quotes:"“" "”";position:relative;z-index:2}.guide-cloud q:before,.guide-cloud q:after{color:var(--accent);font-size:18px;line-height:0}.guide-cloud:hover{border-color:var(--accent);box-shadow:0 10px 24px color-mix(in srgb,var(--accent) 14%,transparent)}.guide-cloud:hover:before,.guide-cloud:hover:after{border-color:var(--accent)}.guide-cloud.active{background:var(--accent-soft);border:2px solid var(--accent);color:var(--accent-dark);box-shadow:0 12px 28px color-mix(in srgb,var(--accent) 18%,transparent)}.guide-cloud.active:before,.guide-cloud.active:after{border-color:var(--accent);background:var(--accent-soft)}.guide-cloud:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 28%,transparent);outline-offset:4px}
      .guide-cloud.slot-1{grid-column:1;grid-row:1}.guide-cloud.slot-2{grid-column:2;grid-row:1}.guide-cloud.slot-3{grid-column:3;grid-row:1}.guide-cloud.slot-4{grid-column:1;grid-row:2}.guide-cloud.slot-5{grid-column:3;grid-row:2}.guide-cloud.slot-6{grid-column:1;grid-row:3}.guide-cloud.slot-7{grid-column:2;grid-row:3}.guide-cloud.slot-8{grid-column:3;grid-row:3}
      .layout-orbit-soft .slot-1{transform:translate(8px,10px)}.layout-orbit-soft .slot-2{transform:translateY(-8px)}.layout-orbit-soft .slot-3{transform:translate(-8px,10px)}.layout-orbit-soft .slot-4{transform:translateX(-6px)}.layout-orbit-soft .slot-5{transform:translateX(6px)}.layout-orbit-soft .slot-6{transform:translate(12px,-8px)}.layout-orbit-soft .slot-7{transform:translateY(8px)}.layout-orbit-soft .slot-8{transform:translate(-12px,-8px)}
      .layout-break-grid:before{inset:12% 18%;border-radius:24%;transform:rotate(-2deg)}.layout-break-grid .slot-1{transform:translate(26px,4px)}.layout-break-grid .slot-2{transform:translateY(-14px)}.layout-break-grid .slot-3{transform:translate(-26px,4px)}.layout-break-grid .slot-4{transform:translate(-12px,-4px)}.layout-break-grid .slot-5{transform:translate(12px,8px)}.layout-break-grid .slot-6{transform:translate(30px,-14px)}.layout-break-grid .slot-7{transform:translateY(16px)}.layout-break-grid .slot-8{transform:translate(-30px,-14px)}
      .layout-wave:before{inset:14% 13%;border-radius:48% 35% 48% 35%;transform:rotate(3deg)}.layout-wave .slot-1{transform:translate(5px,28px)}.layout-wave .slot-2{transform:translateY(-20px)}.layout-wave .slot-3{transform:translate(-8px,22px)}.layout-wave .slot-4{transform:translate(-12px,-18px)}.layout-wave .slot-5{transform:translate(13px,18px)}.layout-wave .slot-6{transform:translate(16px,25px)}.layout-wave .slot-7{transform:translateY(-15px)}.layout-wave .slot-8{transform:translate(-18px,20px)}
      .layout-scatter:before{inset:15% 14%;border-radius:36% 48% 34% 46%;transform:rotate(-4deg)}.layout-scatter .slot-1{transform:translate(22px,15px) rotate(-1deg)}.layout-scatter .slot-2{transform:translate(-8px,-12px) rotate(1.2deg)}.layout-scatter .slot-3{transform:translate(-26px,22px) rotate(-1.5deg)}.layout-scatter .slot-4{transform:translate(-8px,-12px) rotate(1.4deg)}.layout-scatter .slot-5{transform:translate(15px,6px) rotate(-1deg)}.layout-scatter .slot-6{transform:translate(26px,-2px) rotate(1.6deg)}.layout-scatter .slot-7{transform:translate(-2px,18px) rotate(-1.2deg)}.layout-scatter .slot-8{transform:translate(-24px,-12px) rotate(1deg)}
      .guide-footer{min-height:48px;margin:0 20px 16px;padding:0 14px;border:1px solid #EAE1E6;border-radius:12px;background:#FCF8FA;color:#667085;display:flex;align-items:center;gap:9px;font-size:10px}.guide-footer b{color:var(--accent-dark)}.guide-footer .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:0 0 auto}
      .guide-side{min-width:0;min-height:0;overflow:auto;background:#fff;padding:17px 18px 20px;border-top:3px solid var(--accent)}.guide-side-context{margin-bottom:14px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--accent) 22%,#E4E7EC);border-radius:11px;background:var(--accent-soft);color:var(--accent-dark);font-size:10px;line-height:1.4}.guide-side-context b{display:block;margin-bottom:3px;font-size:12px}.guide-side-section+.guide-side-section{margin-top:18px;padding-top:17px;border-top:1px solid #EAECF0}.guide-side-title{display:flex;align-items:center;gap:10px;margin-bottom:12px;color:var(--accent-dark)}.guide-side-title .round{width:34px;height:34px;border-radius:50%;background:var(--accent-soft);display:grid;place-items:center}.guide-side-title svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.guide-side-title b{font-size:14px}.guide-question-list{display:grid;gap:9px}.guide-question{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid #E4E7EC;border-radius:11px;background:#fff;box-shadow:0 2px 7px rgba(16,24,40,.04);color:#344054;font-size:10.5px;line-height:1.4}.guide-question .number{width:28px;height:28px;border-radius:50%;flex:0 0 auto;background:var(--accent-soft);color:var(--accent-dark);display:grid;place-items:center;font-size:11px;font-weight:850}.guide-meaning{display:grid;gap:9px}.guide-meaning-item{display:grid;grid-template-columns:20px 1fr;gap:8px;align-items:start;color:#475467;font-size:10.5px;line-height:1.45}.guide-meaning-item i{width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:900;margin-top:1px}
      .module.guide-expanded{width:calc(100vw - 88px)!important;height:calc(100vh - 24px)!important}
      @media(max-width:1080px){.guide-shell{grid-template-columns:minmax(0,1fr) 320px}.guide-board{min-width:640px}.guide-cloud{width:160px;font-size:10px}.guide-core{width:210px}}
      @media(prefers-reduced-motion:reduce){.guide-tab,.guide-cloud{transition:none}}
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
    const layoutClass = topic?.presentation?.layoutClass || 'layout-orbit-soft';
    return `<div class="guide-board-wrap"><div class="guide-board ${esc(layoutClass)}">
      ${variants.map((item, index) => {
        const selected = item.id === state.activeSymptomId;
        return `<button type="button" class="guide-cloud slot-${index + 1} ${selected ? 'active' : ''}" data-guide-action="symptom" data-symptom-id="${esc(item.id)}" aria-pressed="${selected ? 'true' : 'false'}"><q>${esc(item.label)}</q></button>`;
      }).join('')}
      <section class="guide-core" aria-label="Суть жалобы">${icon(topic.icon)}<strong>${esc(topic.complaint)}</strong><small>${esc(topic.subtitle || 'Суть жалобы')}</small></section>
    </div></div>`;
  }

  function renderSide(topic) {
    const selectedSymptom = state.activeSymptomId ? content?.symptom?.(topic.id, state.activeSymptomId) : null;
    const questions = Array.isArray(selectedSymptom?.questions) ? selectedSymptom.questions : (Array.isArray(topic?.questions) ? topic.questions : []);
    const meaning = Array.isArray(selectedSymptom?.meaning) ? selectedSymptom.meaning : (Array.isArray(topic?.meaning) ? topic.meaning : []);
    const title = selectedSymptom ? `Подсимптом: ${selectedSymptom.label}` : (topic?.presentation?.sideTitle || 'Общий вопрос по теме');
    const context = selectedSymptom
      ? 'Ниже — уточняющие вопросы именно для выбранной формулировки абонента. Повторный клик по тучке вернёт общий блок.'
      : 'Выбрана общая тема. Нажмите на мини-тучку, чтобы открыть точечный сценарий уточнений.';

    return `<aside class="guide-side">
      <div class="guide-side-context"><b>${esc(title)}</b><span>${esc(context)}</span></div>
      <section class="guide-side-section">
        <div class="guide-side-title"><span class="round">${icon('chat')}</span><b>${selectedSymptom ? 'Порядок уточняющих вопросов' : 'Что спросить'}</b></div>
        <div class="guide-question-list">${questions.map((text, index) => `<div class="guide-question"><span class="number">${index + 1}</span><span>${esc(text)}</span></div>`).join('')}</div>
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

    const validSymptom = state.activeSymptomId ? content?.symptom?.(topic.id, state.activeSymptomId) : null;
    if (state.activeSymptomId && !validSymptom) state.activeSymptomId = '';

    const themeClass = topic?.presentation?.themeClass || 'theme-low-speed';
    state.renderCount += 1;
    state.panel.classList.add('operator-guide-runtime');
    state.panel.innerHTML = `<div class="guide-root ${esc(themeClass)}">
      ${renderTopbar(caseData)}
      <div class="guide-shell">
        <main class="guide-main">
          ${renderTabs(topics)}
          ${renderBoard(topic)}
          <div class="guide-footer"><span class="dot"></span><span><b>Главная тучка — суть обращения.</b> Мини-тучки — конкретные формулировки абонента. Клик по мини-тучке меняет только вопросы справа; диагностика автоматически не запускается.</span></div>
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
      state.activeSymptomId = '';
      render();
      return;
    }
    if (action === 'symptom') {
      const next = String(target.dataset.symptomId || '');
      if (!content?.symptom?.(state.activeTypeId, next)) return;
      state.activeSymptomId = state.activeSymptomId === next ? '' : next;
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
        if (syncCaseContext(activeCase())) render();
      });
    }
  }

  function teardownRuntime() {
    state.active = false;
    state.activeSymptomId = '';
    state.unsubscribeStore?.();
    state.unsubscribeStore = null;
    if (state.panel && state.clickHandler) state.panel.removeEventListener('click', state.clickHandler, true);
    state.clickHandler = null;
    state.panel?.classList.remove('guide-expanded', 'operator-guide-runtime');
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
    state.activeSymptomId = '';
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
    revision: 'operator-guide-symptom-drilldown-v1',
    render: () => { if (state.active) render(); },
    isActive: () => state.active,
    activeTopic: () => state.activeTypeId,
    activeSymptom: () => state.activeSymptomId,
    stats: () => ({
      active: state.active,
      renderCount: state.renderCount,
      activeTypeId: state.activeTypeId,
      activeSymptomId: state.activeSymptomId,
      hasStoreSubscription: Boolean(state.unsubscribeStore)
    })
  });
})();
