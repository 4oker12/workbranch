(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__conversationGraphRuntimeLoaded) return;
  if (!WB.graphStudio || typeof WB.graphStudio.open !== 'function') return;

  WB.__conversationGraphRuntimeLoaded = true;

  const baseGraphStudio = WB.graphStudio;
  const content = WB.conversationGraphContent;
  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-handbook-style';

  const state = {
    active: false,
    panel: null,
    shadow: null,
    selectedIds: new Set(['slow']),
    activeTopicId: 'slow',
    query: '',
    clickHandler: null,
    inputHandler: null,
    unsubscribeStore: null,
    moduleCloseHandler: null,
    renderCount: 0
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const factValue = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;

  function activeCase() {
    return WB.store?.activeCase?.() || null;
  }

  function caseLabel() {
    const caseData = activeCase();
    return factValue(caseData?.identity?.login)
      || factValue(caseData?.identity?.contract)
      || factValue(caseData?.login)
      || 'без привязки к Case';
  }

  function icon(name) {
    const paths = {
      book: '<path d="M4.5 5.5A3.5 3.5 0 0 1 8 3h3v16H8a3.5 3.5 0 0 0-3.5 2V5.5Z"/><path d="M19.5 5.5A3.5 3.5 0 0 0 16 3h-3v16h3a3.5 3.5 0 0 1 3.5 2V5.5Z"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
      globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.2 3.6 4.9 3.6 8S14.4 17.8 12 20M12 4c-2.4 2.2-3.6 4.9-3.6 8S9.6 17.8 12 20"/>',
      speed: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="m12 13 4-4"/><circle cx="12" cy="13" r="1.3"/>',
      pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
      phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 6h4M11 18h2"/>',
      device: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M8 20h8M12 16v4"/>',
      wifi: '<path d="M4 9c4.7-4 11.3-4 16 0M7 12.5c3-2.6 7-2.6 10 0M10 16c1.2-1 2.8-1 4 0"/><circle cx="12" cy="19" r="1"/>',
      tv: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="m10 10 5 2.5-5 2.5v-5ZM9 3l3 3 3-3"/>',
      game: '<path d="M8 9h8a4 4 0 0 1 3.8 5.2l-1 3.1a2 2 0 0 1-3.3.8L13.8 16h-3.6l-1.7 2.1a2 2 0 0 1-3.3-.8l-1-3.1A4 4 0 0 1 8 9Z"/><path d="M8 12v3M6.5 13.5h3M16 12.5h.01M18 14.5h.01"/>',
      browser: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16M7 7h.01M10 7h.01"/>',
      router: '<rect x="4" y="11" width="16" height="8" rx="2"/><path d="M7 11V6M17 11V6M8 15h.01M11 15h.01"/>',
      shield: '<path d="M12 3 5 6v5c0 4.5 2.7 7.5 7 10 4.3-2.5 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
      plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8Z"/><path d="M12 16v5"/>',
      moon: '<path d="M19 15.5A8 8 0 0 1 8.5 5 7 7 0 1 0 19 15.5Z"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 9a7 7 0 0 0-11.6-2.6L4 9M6 15a7 7 0 0 0 11.6 2.6L20 15"/>',
      dots: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
      chat: '<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8 10h8M8 13h5"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      idea: '<path d="M9 18h6M10 21h4"/><path d="M8.5 15.5A6 6 0 1 1 15.5 15.5c-.8.6-1.1 1.2-1.2 2h-4.6c-.1-.8-.4-1.4-1.2-2Z"/>',
      quote: '<path d="M7 9h4v4H8.5A3.5 3.5 0 0 1 5 9.5V8M15 9h4v4h-2.5A3.5 3.5 0 0 1 13 9.5V8"/>',
      map: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8M17 8l-4 8"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      reset: '<path d="M5 8V4m0 0h4M5 4l3 3a7 7 0 1 1-1.5 8"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chat}</svg>`;
  }

  function styles() {
    return `<style id="${STYLE_ID}">
      .handbook-root{height:100%;min-height:0;display:grid;grid-template-rows:64px 1fr;background:#F8F7F9;color:#1D2939;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
      .handbook-root *{box-sizing:border-box}
      .handbook-topbar{display:flex;align-items:center;gap:12px;padding:0 18px;background:#fff;border-bottom:1px solid #E8E5EA}
      .handbook-brand{display:flex;align-items:center;gap:11px;min-width:0;margin-right:auto}.handbook-mark{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#A50046;color:#fff;box-shadow:0 8px 22px rgba(165,0,70,.16)}.handbook-mark svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .handbook-brand b,.handbook-brand small{display:block}.handbook-brand b{font-size:16px;line-height:1.1;color:#1D2939}.handbook-brand small{margin-top:4px;color:#7A7280;font-size:10px}
      .handbook-actions{display:flex;align-items:center;gap:8px}.handbook-btn,.handbook-icon-btn{height:34px;border:1px solid #DDD8E0;background:#fff;color:#4A4350;border-radius:12px;font:700 10px/1 Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}.handbook-btn{padding:0 12px}.handbook-icon-btn{width:34px;padding:0}.handbook-btn:hover,.handbook-icon-btn:hover{border-color:#BFAFBA;background:#FCFAFC}.handbook-btn svg,.handbook-icon-btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .handbook-shell{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,360px);background:#F8F7F9}
      .handbook-main{min-width:0;min-height:0;overflow:auto;padding:20px 22px 22px;border-right:1px solid #E8E5EA;background:#FBFAFC}
      .handbook-intro{display:flex;align-items:flex-start;gap:16px;margin-bottom:16px}.handbook-intro-copy{min-width:0;flex:1}.handbook-intro h2{margin:0;color:#201A22;font-size:20px;line-height:1.2}.handbook-intro p{margin:5px 0 0;color:#746C78;font-size:11px;line-height:1.45}.handbook-case{flex:0 0 auto;padding:7px 11px;border-radius:999px;background:#FFF2F7;border:1px solid #F0C7D8;color:#8B1749;font-size:9px;font-weight:800}
      .handbook-search{position:relative;display:flex;align-items:center;margin-bottom:18px}.handbook-search svg{position:absolute;left:15px;width:18px;height:18px;fill:none;stroke:#8A818D;stroke-width:1.7}.handbook-search input{width:100%;height:46px;padding:0 42px;border:1px solid #DDD8E0;border-radius:18px;background:#fff;color:#2A242C;font:600 12px/1.2 Inter,system-ui,sans-serif;outline:none;box-shadow:0 6px 20px rgba(40,24,35,.035)}.handbook-search input:focus{border-color:#C24A7E;box-shadow:0 0 0 3px rgba(165,0,70,.055)}.handbook-search input::placeholder{color:#A39BA6;font-weight:500}
      .handbook-selected{display:flex;align-items:center;gap:7px;min-height:30px;margin:-4px 0 12px;overflow:auto}.handbook-selected-label{color:#8A818D;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}.handbook-selected-chip{flex:0 0 auto;padding:5px 9px;border-radius:999px;background:#FBEAF2;color:#8E1749;border:1px solid #F0C7D8;font-size:9px;font-weight:800}
      .handbook-board{position:relative;display:grid;gap:15px;min-height:460px;padding:8px 12px 14px;border:1px solid #ECE8EE;border-radius:26px;background:#fff;box-shadow:0 14px 38px rgba(47,28,41,.045);overflow:hidden}.handbook-board::before,.handbook-board::after{content:"";position:absolute;border:1px dashed #E8D6DF;border-radius:50%;pointer-events:none}.handbook-board::before{width:520px;height:190px;left:8%;top:72px;transform:rotate(-3deg)}.handbook-board::after{width:430px;height:180px;right:4%;bottom:40px;transform:rotate(5deg)}
      .handbook-group{position:relative;z-index:1;padding:4px 2px}.handbook-group-title{margin:0 0 8px 8px;color:#988F9A;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.09em}.handbook-cloud{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px 14px}.handbook-topic{position:relative;min-width:150px;min-height:62px;padding:11px 18px;border:1px solid #E1DCE3;border-radius:999px;background:#fff;color:#3E3741;display:inline-flex;align-items:center;justify-content:flex-start;gap:11px;text-align:left;cursor:pointer;box-shadow:0 7px 18px rgba(42,24,37,.045);transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease,background .12s ease}.handbook-topic:hover{transform:translateY(-1px);border-color:#D09AB2;box-shadow:0 10px 23px rgba(95,40,69,.08)}.handbook-topic.selected{border-color:#D98BAC;background:#FFF5F9;color:#78173E}.handbook-topic.current{border-color:#8F0E46;background:#A50046;color:#fff;box-shadow:0 12px 28px rgba(165,0,70,.22)}.handbook-topic-icon{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;background:#FFF0F6;color:#A50046}.handbook-topic.selected .handbook-topic-icon{background:#FBE1EC}.handbook-topic.current .handbook-topic-icon{background:rgba(255,255,255,.16);color:#fff}.handbook-topic-icon svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}.handbook-topic b{font-size:11px;line-height:1.2}.handbook-topic small{display:block;margin-top:2px;font-size:8px;opacity:.7}
      .handbook-empty-search{position:relative;z-index:2;padding:32px;text-align:center;color:#7B737F;font-size:11px}
      .handbook-note{margin-top:13px;padding:10px 13px;border-radius:16px;background:#F7F4F7;color:#726A75;font-size:9.5px;line-height:1.45}.handbook-note b{color:#4A424D}
      .handbook-side{min-width:0;min-height:0;overflow:auto;background:#fff;padding:18px 16px}.handbook-side-head{position:sticky;top:-18px;z-index:4;margin:-18px -16px 14px;padding:18px 16px 12px;background:rgba(255,255,255,.97);border-bottom:1px solid #EEEAEF}.handbook-side-head b{display:flex;align-items:center;gap:8px;color:#332C36;font-size:13px}.handbook-side-head b svg{width:18px;height:18px;fill:none;stroke:#A50046;stroke-width:1.7}.handbook-side-head small{display:block;margin-top:4px;color:#938A96;font-size:9px}
      .handbook-section{margin-bottom:16px}.handbook-section-title{display:flex;align-items:center;gap:8px;margin:0 0 8px;color:#4B424E;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.handbook-section-title svg{width:16px;height:16px;fill:none;stroke:#A50046;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.handbook-question-list{display:grid;gap:8px}.handbook-question{padding:11px 12px;border:1px solid #E6E1E7;border-radius:17px;background:#fff;color:#312A34;font-size:10.5px;line-height:1.45;box-shadow:0 5px 14px rgba(41,25,37,.035)}.handbook-question strong{display:inline-grid;place-items:center;width:20px;height:20px;margin-right:7px;border-radius:50%;background:#FBEAF2;color:#A50046;font-size:8px;vertical-align:middle}
      .handbook-pill-list{display:flex;flex-wrap:wrap;gap:7px}.handbook-mini-pill{padding:7px 10px;border-radius:999px;border:1px solid #E4DFE5;background:#FAF8FA;color:#514955;font-size:9px;font-weight:700}.handbook-hook{display:flex;gap:8px;padding:8px 0;color:#625A65;font-size:9.5px;line-height:1.4}.handbook-hook i{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;background:#F3EAF0;color:#8F1748;font-style:normal;font-size:9px;font-weight:900}.handbook-phrase{padding:12px 13px;border-radius:17px;background:#FFF6FA;border:1px solid #F0D0DE;color:#5A3346;font-size:10px;line-height:1.48}.handbook-phrase+.handbook-phrase{margin-top:7px}
      .handbook-conclusion{margin-top:14px;padding:13px 14px;border-radius:18px;border:1px solid #E7D9C7;background:#FFFAF3;color:#625447}.handbook-conclusion b{display:block;margin-bottom:5px;color:#493D34;font-size:10px}.handbook-conclusion p{margin:0;font-size:9.5px;line-height:1.45}.handbook-conclusion .next{margin-top:9px;display:flex;gap:6px;flex-wrap:wrap}.handbook-conclusion .next span{padding:5px 8px;border-radius:999px;background:#fff;border:1px solid #E8DDCF;font-size:8.5px;font-weight:800;color:#6E5A46}
      .module.handbook-mode{width:min(92vw,1580px)!important;height:min(92vh,900px)!important;max-height:92vh!important}
      @media(max-width:1100px){.handbook-shell{grid-template-columns:minmax(0,1fr) 310px}.handbook-topic{min-width:132px;padding:10px 14px}.handbook-main{padding:16px}.handbook-board{border-radius:22px}}
      @media(max-width:860px){.handbook-shell{grid-template-columns:1fr}.handbook-side{display:none}.module.handbook-mode{width:calc(100vw - 84px)!important}.handbook-board::before,.handbook-board::after{display:none}}
    </style>`;
  }

  function ensureStyle() {
    if (!state.shadow || state.shadow.getElementById(STYLE_ID)) return;
    const template = document.createElement('template');
    template.innerHTML = styles().trim();
    const node = template.content.firstElementChild;
    if (node) state.shadow.appendChild(node);
  }

  function selectedIds() {
    return [...state.selectedIds];
  }

  function currentTopic() {
    return content?.topic?.(state.activeTopicId) || content?.topic?.('slow') || null;
  }

  function renderTopbar() {
    return `
      <header class="handbook-topbar">
        <div class="handbook-brand">
          <div class="handbook-mark">${icon('book')}</div>
          <div><b>Пособие оператора</b><small>Что спросить у абонента · ${esc(caseLabel())}</small></div>
        </div>
        <div class="handbook-actions">
          <button type="button" class="handbook-btn" data-handbook-action="semantic">${icon('map')}<span>Смысловая карта</span></button>
          <button type="button" class="handbook-btn" data-handbook-action="reset">${icon('reset')}<span>Сбросить</span></button>
          <button type="button" class="handbook-icon-btn" data-handbook-action="close" title="Закрыть">${icon('close')}</button>
        </div>
      </header>`;
  }

  function renderSelected() {
    const chosen = selectedIds().map(id => content?.topic?.(id)).filter(Boolean);
    return `
      <div class="handbook-selected">
        <span class="handbook-selected-label">Выбрано</span>
        ${chosen.map(item => `<span class="handbook-selected-chip">${esc(item.label)}</span>`).join('')}
      </div>`;
  }

  function renderBoard() {
    const groups = content?.groups || [];
    let visibleCount = 0;
    const groupHtml = groups.map(group => {
      const items = content?.groupTopics?.(group.id, state.query) || [];
      visibleCount += items.length;
      if (!items.length) return '';
      return `
        <section class="handbook-group">
          <div class="handbook-group-title">${esc(group.label)}</div>
          <div class="handbook-cloud">
            ${items.map(item => {
              const selected = state.selectedIds.has(item.id);
              const current = item.id === state.activeTopicId;
              return `<button type="button" class="handbook-topic ${selected ? 'selected' : ''} ${current ? 'current' : ''}" data-handbook-action="topic" data-topic-id="${esc(item.id)}" aria-pressed="${selected ? 'true' : 'false'}">
                <span class="handbook-topic-icon">${icon(item.icon)}</span>
                <span><b>${esc(item.label)}</b>${current ? '<small>активная тема</small>' : ''}</span>
              </button>`;
            }).join('')}
          </div>
        </section>`;
    }).join('');

    return `
      <div class="handbook-board">
        ${visibleCount ? groupHtml : '<div class="handbook-empty-search">Ничего похожего не нашёл. Попробуй проще: «телефон», «видео», «Wi‑Fi», «вечером».</div>'}
      </div>`;
  }

  function renderQuestions(guide) {
    return `
      <section class="handbook-section">
        <div class="handbook-section-title">${icon('chat')} Что спросить</div>
        <div class="handbook-question-list">
          ${(guide.questions || []).map((question, index) => `<div class="handbook-question"><strong>${index + 1}</strong>${esc(question)}</div>`).join('')}
        </div>
      </section>`;
  }

  function renderChecks(guide) {
    if (!guide.checks?.length) return '';
    return `
      <section class="handbook-section">
        <div class="handbook-section-title">${icon('check')} Что предложить проверить</div>
        <div class="handbook-pill-list">${guide.checks.map(item => `<span class="handbook-mini-pill">${esc(item)}</span>`).join('')}</div>
      </section>`;
  }

  function renderHooks(guide) {
    if (!guide.hooks?.length) return '';
    return `
      <section class="handbook-section">
        <div class="handbook-section-title">${icon('idea')} За что зацепиться</div>
        ${guide.hooks.map(item => `<div class="handbook-hook"><i>•</i><span>${esc(item)}</span></div>`).join('')}
      </section>`;
  }

  function renderPhrases(guide) {
    if (!guide.phrases?.length) return '';
    return `
      <section class="handbook-section">
        <div class="handbook-section-title">${icon('quote')} Как сказать проще</div>
        ${guide.phrases.map(item => `<div class="handbook-phrase">${esc(item)}</div>`).join('')}
      </section>`;
  }

  function renderSide() {
    const guide = content?.compose?.(selectedIds()) || { questions: [], checks: [], hooks: [], phrases: [], conclusion: '' };
    const topic = currentTopic();
    return `
      <aside class="handbook-side">
        <div class="handbook-side-head">
          <b>${icon(topic?.icon || 'chat')} ${esc(topic?.label || 'Подсказки')}</b>
          <small>Арсенал вопросов по выбранным темам. Это не обязательный сценарий.</small>
        </div>
        ${renderQuestions(guide)}
        ${renderChecks(guide)}
        ${renderHooks(guide)}
        ${renderPhrases(guide)}
        <div class="handbook-conclusion">
          <b>Когда базовый арсенал исчерпан</b>
          <p>${esc(guide.conclusion || 'Если данных недостаточно — переходи к дополнительной технической проверке.')}</p>
          <div class="next"><span>Дополнительная проверка</span><span>Эскалация / выезд при необходимости</span></div>
        </div>
      </aside>`;
  }

  function render() {
    if (!state.active || !state.panel || !state.shadow) return;
    state.renderCount += 1;
    state.panel.classList.add('handbook-mode');
    state.panel.innerHTML = `
      <div class="handbook-root">
        ${renderTopbar()}
        <div class="handbook-shell">
          <main class="handbook-main">
            <div class="handbook-intro">
              <div class="handbook-intro-copy">
                <h2>Что сейчас сказал абонент?</h2>
                <p>Выбери одну или несколько тем — справа появится пачка нормальных уточняющих вопросов. Никакого обязательного маршрута.</p>
              </div>
              <span class="handbook-case">${esc(caseLabel())}</span>
            </div>
            <label class="handbook-search">
              ${icon('search')}
              <input type="search" value="${esc(state.query)}" data-handbook-search placeholder="Например: телевизор тормозит вечером" autocomplete="off" spellcheck="false">
            </label>
            ${renderSelected()}
            ${renderBoard()}
            <div class="handbook-note"><b>Принцип:</b> не пытайся заставить абонента говорить техническими терминами. Получи наблюдаемый симптом, сравнение и только потом делай вывод.</div>
          </main>
          ${renderSide()}
        </div>
      </div>`;
  }

  function toggleTopic(topicId) {
    const topic = content?.topic?.(topicId);
    if (!topic) return;
    state.activeTopicId = topic.id;
    if (state.selectedIds.has(topic.id)) {
      if (state.selectedIds.size > 1) state.selectedIds.delete(topic.id);
    } else {
      state.selectedIds.add(topic.id);
    }
    render();
  }

  function resetHandbook() {
    state.selectedIds = new Set(['slow']);
    state.activeTopicId = 'slow';
    state.query = '';
    render();
  }

  function onPanelClick(event) {
    if (!state.active) return;
    const target = event.target.closest?.('[data-handbook-action]');
    const action = target?.dataset.handbookAction;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'close') return void closeRuntime();
    if (action === 'semantic') return void open({ mode: 'semantic' });
    if (action === 'reset') return resetHandbook();
    if (action === 'topic') return toggleTopic(target.dataset.topicId || '');
  }

  function onPanelInput(event) {
    if (!state.active || !event.target?.matches?.('[data-handbook-search]')) return;
    state.query = String(event.target.value || '');
    render();
    const input = state.panel?.querySelector?.('[data-handbook-search]');
    if (input) {
      input.focus?.();
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    }
  }

  function installRuntimeLifecycle() {
    if (!state.panel) return;
    if (!state.clickHandler) {
      state.clickHandler = onPanelClick;
      state.panel.addEventListener('click', state.clickHandler, true);
    }
    if (!state.inputHandler) {
      state.inputHandler = onPanelInput;
      state.panel.addEventListener('input', state.inputHandler, true);
    }
    if (!state.unsubscribeStore && WB.bus?.on) {
      state.unsubscribeStore = WB.bus.on('store:state', () => {
        if (state.active) render();
      });
    }
  }

  function teardownRuntime() {
    state.active = false;
    state.unsubscribeStore?.();
    state.unsubscribeStore = null;
    if (state.panel && state.clickHandler) state.panel.removeEventListener('click', state.clickHandler, true);
    if (state.panel && state.inputHandler) state.panel.removeEventListener('input', state.inputHandler, true);
    state.clickHandler = null;
    state.inputHandler = null;
    state.panel?.classList.remove('handbook-mode');
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

  const debugApi = Object.freeze({
    revision: 'operator-handbook-runtime-v1',
    render: () => { if (state.active) render(); },
    isActive: () => state.active,
    selectedTopics: () => selectedIds(),
    stats: () => ({
      active: state.active,
      renderCount: state.renderCount,
      selectedCount: state.selectedIds.size,
      hasStoreSubscription: Boolean(state.unsubscribeStore),
      hasClickHandler: Boolean(state.clickHandler),
      hasInputHandler: Boolean(state.inputHandler)
    })
  });

  WB.graphStudio = publicApi;
  WB.operatorHandbookRuntime = debugApi;
  WB.conversationGraphRuntime = debugApi;
})();
