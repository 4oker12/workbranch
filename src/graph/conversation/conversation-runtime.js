(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__conversationGraphRuntimeLoaded) return;
  if (!WB.graphStudio || typeof WB.graphStudio.open !== 'function') return;

  WB.__conversationGraphRuntimeLoaded = true;

  const baseGraphStudio = WB.graphStudio;
  const content = WB.conversationGraphContent;
  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-conversation-runtime-style';

  const state = {
    active: false,
    busy: false,
    expanded: false,
    zoom: 1,
    panel: null,
    shadow: null,
    edgeFrame: 0,
    unsubscribeStore: null,
    resizeObserver: null,
    clickHandler: null,
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

  function currentAppeal(caseData = activeCase()) {
    return WB.appeals?.normalize?.(caseData?.appeal) || WB.appeals?.empty?.() || null;
  }

  function currentVm(caseData = activeCase()) {
    const appeal = currentAppeal(caseData);
    const appealType = WB.appeals?.typeForState?.(appeal) || null;
    const vm = WB.appeals?.resolveRuntimeGraph?.({ appeal, appealType, caseData }) || {
      status: 'empty',
      currentNode: null,
      history: [],
      availableOptions: [],
      contextCoverage: { items: [] },
      types: WB.appeals?.types || []
    };
    return { appeal, appealType, vm };
  }

  function icon(name) {
    const paths = {
      chat: '<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8 10h8M8 13h5"/>',
      wifi: '<path d="M4 9c4.7-4 11.3-4 16 0M7 12.5c3-2.6 7-2.6 10 0M10 16c1.2-1 2.8-1 4 0"/><circle cx="12" cy="19" r="1"/>',
      branch: '<circle cx="7" cy="6" r="2"/><circle cx="17" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M9 6h6M8 8l3.2 8M16 8l-3.2 8"/>',
      plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8Z"/><path d="M12 16v5"/>',
      router: '<rect x="4" y="11" width="16" height="8" rx="2"/><path d="M7 11V6M17 11V6M8 15h.01M11 15h.01"/>',
      speed: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="m12 13 4-4"/><circle cx="12" cy="13" r="1.5"/>',
      back: '<path d="m14 7-5 5 5 5"/>',
      reset: '<path d="M5 8V4m0 0h4M5 4l3 3a7 7 0 1 1-1.5 8"/>',
      fit: '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      map: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8M17 8l-4 8"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chat}</svg>`;
  }

  function styles() {
    return `<style id="${STYLE_ID}">
      .conv-root{height:100%;min-height:0;display:grid;grid-template-rows:58px 1fr;background:#F7F7F9;color:#1D2939;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
      .conv-root *{box-sizing:border-box}
      .conv-topbar{display:flex;align-items:center;gap:12px;padding:0 16px;background:#fff;border-bottom:1px solid #E4E7EC}
      .conv-brand{display:flex;align-items:center;gap:10px;min-width:0;margin-right:auto}.conv-mark{width:34px;height:34px;border-radius:10px;background:#A50046;color:#fff;display:grid;place-items:center;font-weight:900;box-shadow:0 6px 16px rgba(165,0,70,.18)}
      .conv-brand b,.conv-brand small{display:block}.conv-brand b{font-size:14px;color:#1D2939}.conv-brand small{margin-top:2px;color:#667085;font-size:9px}
      .conv-actions{display:flex;align-items:center;gap:6px}.conv-btn,.conv-icon-btn{height:32px;border:1px solid #D0D5DD;background:#fff;color:#344054;border-radius:8px;font:700 10px/1 Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
      .conv-btn{padding:0 10px}.conv-icon-btn{width:32px;padding:0}.conv-btn:hover,.conv-icon-btn:hover{background:#F9FAFB;border-color:#98A2B3}.conv-btn svg,.conv-icon-btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.conv-btn.primary{background:#A50046;border-color:#A50046;color:#fff}.conv-btn:disabled{opacity:.45;cursor:not-allowed}
      .conv-shell{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,320px);gap:0}.conv-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto auto 1fr auto;background:linear-gradient(180deg,#FBFCFD 0,#F7F7F9 100%);border-right:1px solid #E4E7EC}
      .conv-meta{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-bottom:1px solid #EAECF0;background:rgba(255,255,255,.82)}.conv-symptom{padding:6px 10px;border:1px solid #F3B6CF;background:#FFF1F6;color:#8F003C;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.conv-coverage{display:flex;gap:6px;min-width:0;overflow:auto}.conv-chip{padding:5px 8px;border-radius:999px;border:1px solid #E4E7EC;background:#fff;color:#667085;font-size:9px;font-weight:700;white-space:nowrap}.conv-chip.ok{border-color:#ABEFC6;background:#ECFDF3;color:#067647}.conv-chip.warn{border-color:#FEDF89;background:#FFFAEB;color:#B54708}.conv-chip.err{border-color:#FECDCA;background:#FEF3F2;color:#B42318}
      .conv-legend{display:flex;align-items:center;gap:16px;padding:8px 16px;color:#667085;font-size:9px}.conv-legend span{display:inline-flex;align-items:center;gap:6px}.conv-line{width:20px;height:2px;border-radius:2px;background:#A50046}.conv-line.done{background:#12B76A}.conv-line.alt{background:#98A2B3}.conv-line.rare{height:0;border-top:2px dashed #F79009;background:transparent}
      .conv-scroll{position:relative;min-height:0;overflow:auto;padding:0 18px 18px}.conv-stage{position:relative;min-width:860px;min-height:560px;padding:12px 18px 48px;transform-origin:top left;transition:transform .12s ease}.conv-edges{position:absolute;inset:0;z-index:0;overflow:visible;pointer-events:none}.conv-edges path{fill:none;stroke:#98A2B3;stroke-width:1.6}.conv-edges path.current{stroke:#A50046;stroke-width:2.1}.conv-edges path.done{stroke:#12B76A;stroke-width:1.9}.conv-edges path.rare{stroke:#F79009;stroke-dasharray:6 5}
      .conv-trail{position:relative;z-index:2;display:flex;align-items:center;gap:6px;min-height:46px;margin:2px auto 12px;max-width:980px;overflow:auto;padding:4px}.conv-trail-label{color:#667085;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;margin-right:4px}.conv-trail-step{flex:0 0 auto;max-width:190px;border:1px solid #ABEFC6;background:#ECFDF3;color:#067647;border-radius:999px;padding:6px 9px;font:700 9px/1.2 Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.conv-trail-step:hover{border-color:#6CE9A6}.conv-trail-arrow{color:#98A2B3;font-size:11px}
      .conv-focus{position:relative;z-index:2;max-width:560px;margin:0 auto 24px;padding:17px 18px;border:1.5px solid #A50046;border-radius:16px;background:#fff;box-shadow:0 12px 34px rgba(16,24,40,.08),0 0 0 3px rgba(165,0,70,.045)}.conv-focus-head{display:flex;align-items:center;gap:12px}.conv-focus-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#FFF1F6;color:#A50046;flex:0 0 auto}.conv-focus-icon svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.7}.conv-eyebrow{font-size:8px;text-transform:uppercase;letter-spacing:.09em;color:#667085;font-weight:900}.conv-focus h2{margin:4px 0 3px;font-size:17px;line-height:1.25;color:#101828}.conv-focus p{margin:0;color:#667085;font-size:10px;line-height:1.45}.conv-level-badge{display:inline-flex;margin-top:9px;padding:4px 7px;border-radius:999px;background:#FFFAEB;color:#B54708;font-size:8px;font-weight:800}.conv-level-badge.operator{background:#F2F4F7;color:#475467}
      .conv-branches{position:relative;z-index:2;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;max-width:1060px;margin:0 auto}.conv-branch{min-width:0;display:grid;align-content:start;gap:10px}.conv-answer{width:100%;min-height:62px;padding:11px 12px;border:1px solid #D0D5DD;border-radius:13px;background:#fff;color:#344054;text-align:left;cursor:pointer;box-shadow:0 4px 14px rgba(16,24,40,.04);transition:border-color .12s ease,box-shadow .12s ease,transform .12s ease}.conv-answer:hover{border-color:#A50046;box-shadow:0 8px 20px rgba(165,0,70,.08);transform:translateY(-1px)}.conv-answer b{display:block;font-size:11px;line-height:1.25}.conv-answer small{display:block;margin-top:4px;color:#667085;font-size:8.5px;line-height:1.35}.conv-answer.rare{border-style:dashed;border-color:#FDB022;background:#FFFCF5}.conv-preview{min-height:78px;padding:11px 12px;border:1px solid #EAECF0;border-radius:12px;background:rgba(255,255,255,.74);color:#475467}.conv-preview .kind{font-size:7.5px;text-transform:uppercase;letter-spacing:.08em;color:#98A2B3;font-weight:900}.conv-preview b{display:block;margin-top:5px;font-size:10px;line-height:1.3}.conv-preview.outcome{border-color:#ABEFC6;background:#F6FEF9;color:#067647}
      .conv-empty{max-width:860px;margin:36px auto;padding:12px}.conv-empty h2{margin:0 0 6px;color:#101828;font-size:20px}.conv-empty>p{margin:0 0 18px;color:#667085;font-size:11px}.conv-symptoms{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.conv-symptom-card{padding:14px;border:1px solid #E4E7EC;border-radius:14px;background:#fff;text-align:left;cursor:pointer;color:#344054;box-shadow:0 4px 14px rgba(16,24,40,.04)}.conv-symptom-card:hover{border-color:#C44C7E}.conv-symptom-card.featured{border-color:#D94F89;background:#FFF9FB}.conv-symptom-card b,.conv-symptom-card small{display:block}.conv-symptom-card b{font-size:12px}.conv-symptom-card small{margin-top:5px;color:#667085;font-size:9px;line-height:1.4}
      .conv-toolbar{display:flex;align-items:center;gap:7px;min-height:48px;padding:8px 16px;background:#fff;border-top:1px solid #EAECF0}.conv-toolbar .spacer{flex:1}.conv-step-note{color:#667085;font-size:9px}
      .conv-helper{min-width:0;min-height:0;overflow:auto;background:#fff;padding:14px}.conv-helper-head{position:sticky;top:-14px;z-index:2;margin:-14px -14px 10px;padding:15px 14px 11px;background:rgba(255,255,255,.96);border-bottom:1px solid #EAECF0}.conv-helper-head b{display:block;color:#344054;font-size:11px;text-transform:uppercase;letter-spacing:.05em}.conv-helper-head small{display:block;margin-top:3px;color:#98A2B3;font-size:8.5px}.conv-helper-list{display:grid;gap:10px}.conv-help-card{padding:13px;border:1px solid #E4E7EC;border-radius:13px;background:#fff;box-shadow:0 3px 10px rgba(16,24,40,.035)}.conv-help-title{display:flex;align-items:center;gap:9px}.conv-help-icon{width:34px;height:34px;border-radius:10px;background:#FFF1F6;color:#A50046;display:grid;place-items:center;flex:0 0 auto}.conv-help-icon svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.conv-help-title b{font-size:11px;color:#1D2939}.conv-help-card p{margin:8px 0 0;color:#667085;font-size:9.5px;line-height:1.5}.conv-no-case{margin:40px auto;max-width:520px;padding:18px;border:1px dashed #D0D5DD;border-radius:14px;background:#fff;text-align:center;color:#667085;font-size:11px}
      .module.conv-expanded{width:calc(100vw - 88px)!important;height:calc(100vh - 24px)!important}
      @media(max-width:1050px){.conv-shell{grid-template-columns:minmax(0,1fr) 280px}.conv-stage{min-width:760px}.conv-branches{grid-template-columns:repeat(2,minmax(170px,1fr))}}
    </style>`;
  }

  function ensureStyle() {
    if (!state.shadow || state.shadow.getElementById(STYLE_ID)) return;
    state.shadow.insertAdjacentHTML('beforeend', styles());
  }

  function coverageClass(status) {
    if (status === 'confirmed') return 'ok';
    if (status === 'conflicting') return 'err';
    if (status === 'stale') return 'warn';
    return '';
  }

  function renderTopbar(caseData, vm) {
    const login = factValue(caseData?.identity?.login) || factValue(caseData?.identity?.contract) || 'нет активного абонента';
    const status = vm?.status === 'empty' ? 'Выбери симптом' : vm?.currentNode?.kind === 'outcome' ? 'Ветка завершена' : 'Разговорный маршрут';
    return `
      <header class="conv-topbar">
        <div class="conv-brand"><div class="conv-mark">G</div><div><b>Вспомогательный граф разговора</b><small>${esc(login)} · ${esc(status)}</small></div></div>
        <div class="conv-actions">
          <button type="button" class="conv-btn" data-conv-action="semantic">${icon('map')}<span>Смысловая карта</span></button>
          <button type="button" class="conv-icon-btn" data-conv-action="expand" title="Развернуть">${state.expanded ? '↘' : '↗'}</button>
          <button type="button" class="conv-icon-btn" data-conv-action="close" title="Закрыть">${icon('close')}</button>
        </div>
      </header>`;
  }

  function renderMeta(vm, type) {
    const coverage = (vm?.contextCoverage?.items || []).filter(item => ['billing', 'userside', 'onu_olt', 'session'].includes(item.id));
    return `
      <div class="conv-meta">
        <span class="conv-symptom">${esc(content?.symptomLabel?.(type) || type?.label || 'Симптом')}</span>
        <div class="conv-coverage">${coverage.map(item => `<span class="conv-chip ${coverageClass(item.status)}" title="${esc(item.detail || '')}">${item.status === 'confirmed' ? '✓ ' : ''}${esc(item.label)}</span>`).join('')}</div>
      </div>
      <div class="conv-legend">
        <span><i class="conv-line"></i>Текущий вопрос</span>
        <span><i class="conv-line done"></i>Пройдено</span>
        <span><i class="conv-line alt"></i>Вариант</span>
        <span><i class="conv-line rare"></i>Расширенная проверка</span>
      </div>`;
  }

  function renderTrail(vm) {
    const history = vm?.history || [];
    if (!history.length) return '<div class="conv-trail" data-conv-trail></div>';
    const visible = history.slice(-5);
    const offset = history.length - visible.length;
    return `
      <div class="conv-trail" data-conv-trail>
        <span class="conv-trail-label">Пройдено</span>
        ${visible.map((item, index) => `${index ? '<span class="conv-trail-arrow">→</span>' : ''}<button type="button" class="conv-trail-step" data-conv-action="rewind" data-history-index="${offset + index}" title="Изменить этот ответ">✓ ${esc(item.answer || item.question || '')}</button>`).join('')}
      </div>`;
  }

  function renderFocus(vm, type) {
    const current = content?.presentNode?.(vm?.currentNode, type?.id) || vm?.currentNode;
    if (!current) return '';
    const levelBadge = current.level === 'advanced'
      ? '<span class="conv-level-badge">Расширенная проверка · только если уместно</span>'
      : current.level === 'operator'
        ? '<span class="conv-level-badge operator">Шаг оператора</span>'
        : '';
    return `
      <section class="conv-focus" data-conv-current>
        <div class="conv-focus-head">
          <div class="conv-focus-icon">${icon(current.kind === 'outcome' ? 'fit' : 'speed')}</div>
          <div><div class="conv-eyebrow">${current.kind === 'outcome' ? 'Итог ветки' : 'Текущий вопрос'}</div><h2>${esc(current.title || '')}</h2><p>${esc(current.why || current.summary || '')}</p>${levelBadge}</div>
        </div>
      </section>`;
  }

  function renderBranches(vm, type) {
    const current = vm?.currentNode;
    if (!current) return '';
    if (current.kind === 'outcome') {
      return `<div class="conv-branches"><div class="conv-preview outcome"><div class="kind">Рекомендация</div><b>${esc(current.nextAction || 'Зафиксируй результат и продолжай по ситуации.')}</b></div></div>`;
    }
    const options = vm?.availableOptions || [];
    return `
      <div class="conv-branches" data-conv-branches>
        ${options.map(raw => {
          const option = content?.presentOption?.(current.id, raw, type?.id) || raw;
          const nextRaw = type?.nodes?.[raw.next] || null;
          const next = content?.presentNode?.(nextRaw, type?.id) || nextRaw;
          const rare = option.tier === 'rare';
          return `<div class="conv-branch" data-conv-branch="${esc(raw.id)}">
            <button type="button" class="conv-answer ${rare ? 'rare' : ''}" data-conv-action="answer" data-answer-id="${esc(raw.id)}" data-edge-tier="${rare ? 'rare' : 'alternative'}">
              <b>${esc(option.label || raw.label || '')}</b>
              ${raw.hint ? `<small>${esc(raw.hint)}</small>` : ''}
            </button>
            ${next ? `<div class="conv-preview ${next.kind === 'outcome' ? 'outcome' : ''}" data-conv-preview="${esc(raw.id)}"><div class="kind">${next.kind === 'outcome' ? 'К чему ведёт' : rare ? 'Расширенная ветка' : 'Дальше'}</div><b>${esc(next.title || '')}</b></div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
  }

  function renderHelper(vm, type) {
    const cards = content?.helperCards?.(vm?.currentNode, type?.id) || [];
    return `
      <aside class="conv-helper">
        <div class="conv-helper-head"><b>Помощник оператора</b><small>Как спросить и объяснить без лишних терминов</small></div>
        <div class="conv-helper-list">${cards.map(card => `<section class="conv-help-card"><div class="conv-help-title"><div class="conv-help-icon">${icon(card.icon)}</div><b>${esc(card.title)}</b></div><p>${esc(card.text)}</p></section>`).join('')}</div>
      </aside>`;
  }

  function renderEmpty(caseData, vm) {
    const types = vm?.types?.length ? vm.types : WB.appeals?.types || [];
    return `
      <div class="conv-main">
        <div class="conv-empty">
          <h2>С чего начинается жалоба?</h2>
          <p>Это вспомогательный маршрут разговора. Он не запускает TMC, ONU/OLT, Juniper или другие технические действия.</p>
          ${caseData ? `<div class="conv-symptoms">${types.map(type => `<button type="button" class="conv-symptom-card ${type.id === 'low_speed' ? 'featured' : ''}" data-conv-action="select-symptom" data-type-id="${esc(type.id)}"><b>${esc(content?.symptomLabel?.(type) || type.label)}</b><small>${esc(type.short || '')}</small></button>`).join('')}</div>` : '<div class="conv-no-case">Сначала открой карточку абонента — разговорный маршрут привязывается к текущему Case.</div>'}
        </div>
      </div>
      ${renderHelper(vm, null)}`;
  }

  function renderToolbar(appeal, vm) {
    const skip = content?.skipOption?.(vm?.availableOptions || []);
    return `
      <div class="conv-toolbar">
        <button type="button" class="conv-btn" data-conv-action="back" ${(appeal?.history || []).length ? '' : 'disabled'}>${icon('back')}Назад</button>
        <button type="button" class="conv-btn" data-conv-action="reset">${icon('reset')}Сменить симптом</button>
        ${skip ? `<button type="button" class="conv-btn" data-conv-action="answer" data-answer-id="${esc(skip.id)}">Пропустить</button>` : ''}
        <span class="spacer"></span>
        <span class="conv-step-note">Шаг ${(appeal?.history || []).length + 1}</span>
        <button type="button" class="conv-btn" data-conv-action="fit">${icon('fit')}К текущему вопросу</button>
      </div>`;
  }

  function render() {
    if (!state.active || !state.panel || !state.shadow) return;
    const caseData = activeCase();
    const { appeal, appealType, vm } = currentVm(caseData);
    state.renderCount += 1;

    let body = '';
    if (!caseData || vm.status === 'empty') {
      body = renderEmpty(caseData, vm);
    } else {
      body = `
        <div class="conv-main">
          ${renderMeta(vm, appealType)}
          <div class="conv-scroll" data-conv-scroll>
            <div class="conv-stage" data-conv-stage style="transform:scale(${state.zoom});width:${100 / state.zoom}%">
              <svg class="conv-edges" data-conv-edges aria-hidden="true"></svg>
              ${renderTrail(vm)}
              ${renderFocus(vm, appealType)}
              ${renderBranches(vm, appealType)}
            </div>
          </div>
          ${renderToolbar(appeal, vm)}
        </div>
        ${renderHelper(vm, appealType)}`;
    }

    state.panel.innerHTML = `${renderTopbar(caseData, vm)}<div class="conv-shell">${body}</div>`;
    state.panel.classList.toggle('conv-expanded', state.expanded);
    scheduleEdges();
  }

  function edgePath(from, to, stageRect, scale = 1) {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = (a.left + a.width / 2 - stageRect.left) / scale;
    const y1 = (a.bottom - stageRect.top) / scale;
    const x2 = (b.left + b.width / 2 - stageRect.left) / scale;
    const y2 = (b.top - stageRect.top) / scale;
    const bend = Math.max(26, Math.abs(y2 - y1) * .45);
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  }

  function drawEdges() {
    state.edgeFrame = 0;
    if (!state.active || !state.shadow) return;
    const stage = state.shadow.querySelector('[data-conv-stage]');
    const svg = state.shadow.querySelector('[data-conv-edges]');
    const current = state.shadow.querySelector('[data-conv-current]');
    if (!stage || !svg || !current) return;
    const stageRect = stage.getBoundingClientRect();
    const scale = state.zoom || 1;
    const width = Math.max(stage.scrollWidth, 860);
    const height = Math.max(stage.scrollHeight, 560);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    const paths = [];

    for (const answer of state.shadow.querySelectorAll('[data-conv-action="answer"][data-answer-id]')) {
      if (!answer.closest('[data-conv-branch]')) continue;
      const tier = answer.dataset.edgeTier === 'rare' ? 'rare' : 'current';
      paths.push(`<path class="${tier}" d="${edgePath(current, answer, stageRect, scale)}"/>`);
      const preview = answer.closest('[data-conv-branch]')?.querySelector('[data-conv-preview]');
      if (preview) paths.push(`<path class="${tier === 'rare' ? 'rare' : ''}" d="${edgePath(answer, preview, stageRect, scale)}"/>`);
    }

    const trail = [...state.shadow.querySelectorAll('.conv-trail-step')];
    if (trail.length) {
      const last = trail[trail.length - 1];
      paths.push(`<path class="done" d="${edgePath(last, current, stageRect, scale)}"/>`);
    }
    svg.innerHTML = paths.join('');
  }

  function scheduleEdges() {
    if (state.edgeFrame) cancelAnimationFrame(state.edgeFrame);
    state.edgeFrame = requestAnimationFrame(drawEdges);
  }

  function fitCurrent() {
    state.shadow?.querySelector('[data-conv-current]')?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
  }

  async function patchAppeal(nextAppeal, transition) {
    if (state.busy || !WB.store?.patchAppeal) return;
    state.busy = true;
    try {
      await WB.store.patchAppeal(nextAppeal, transition);
      render();
      requestAnimationFrame(fitCurrent);
    } finally {
      state.busy = false;
    }
  }

  async function chooseSymptom(typeId) {
    const next = WB.appeals?.select?.(typeId);
    if (!next || next.status === 'empty') return;
    await patchAppeal(next, { action: 'select', typeId, source: 'conversation-runtime' });
  }

  async function answer(answerId) {
    const caseData = activeCase();
    const appeal = currentAppeal(caseData);
    if (!appeal || appeal.status === 'empty') return;
    const next = WB.appeals?.answer?.(appeal, answerId, caseData, { source: 'operator' });
    if (!next) return;
    await patchAppeal(next, { action: 'answer', answerId, source: 'conversation-runtime' });
  }

  async function back() {
    const appeal = currentAppeal();
    if (!appeal) return;
    await patchAppeal(WB.appeals.back(appeal), { action: 'back', source: 'conversation-runtime' });
  }

  async function reset() {
    await patchAppeal(WB.appeals.empty(), { action: 'reset', source: 'conversation-runtime' });
  }

  async function rewind(historyIndex) {
    const appeal = currentAppeal();
    if (!appeal || !Array.isArray(appeal.history)) return;
    const index = Number(historyIndex);
    if (!Number.isInteger(index) || index < 0 || index >= appeal.history.length) return;
    const target = appeal.history[index];
    const rewound = WB.appeals.normalize({
      ...appeal,
      nodeId: target.nodeId,
      outcomeId: '',
      status: 'active',
      history: appeal.history.slice(0, index),
      completedAt: ''
    });
    await patchAppeal(rewound, { action: 'rewind', nodeId: target.nodeId, source: 'conversation-runtime' });
  }

  function onPanelClick(event) {
    if (!state.active) return;
    const target = event.target.closest?.('[data-conv-action]');
    const action = target?.dataset.convAction;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'close') return void closeRuntime();
    if (action === 'semantic') return void open({ mode: 'semantic' });
    if (action === 'expand') {
      state.expanded = !state.expanded;
      state.panel?.classList.toggle('conv-expanded', state.expanded);
      render();
      return;
    }
    if (action === 'fit') return fitCurrent();
    if (action === 'select-symptom') return void chooseSymptom(target.dataset.typeId || '');
    if (action === 'answer') return void answer(target.dataset.answerId || '');
    if (action === 'back') return void back();
    if (action === 'reset') return void reset();
    if (action === 'rewind') return void rewind(target.dataset.historyIndex);
  }

  function installRuntimeLifecycle() {
    if (!state.panel || !state.shadow) return;
    if (!state.clickHandler) {
      state.clickHandler = onPanelClick;
      state.panel.addEventListener('click', state.clickHandler, true);
    }
    if (!state.unsubscribeStore && WB.bus?.on) {
      state.unsubscribeStore = WB.bus.on('store:state', () => {
        if (state.active && !state.busy) render();
      });
    }
    if (!state.resizeObserver && globalThis.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(() => {
        if (state.active) scheduleEdges();
      });
      state.resizeObserver.observe(state.panel);
    }
  }

  function teardownRuntime() {
    state.active = false;
    if (state.edgeFrame) {
      cancelAnimationFrame(state.edgeFrame);
      state.edgeFrame = 0;
    }
    state.unsubscribeStore?.();
    state.unsubscribeStore = null;
    state.resizeObserver?.disconnect?.();
    state.resizeObserver = null;
    if (state.panel && state.clickHandler) state.panel.removeEventListener('click', state.clickHandler, true);
    state.clickHandler = null;
    state.panel?.classList.remove('conv-expanded');
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

  WB.graphStudio = publicApi;
  WB.conversationGraphRuntime = Object.freeze({
    revision: 'conversation-runtime-v1',
    render: () => { if (state.active) render(); },
    isActive: () => state.active,
    stats: () => ({
      active: state.active,
      renderCount: state.renderCount,
      hasStoreSubscription: Boolean(state.unsubscribeStore),
      hasResizeObserver: Boolean(state.resizeObserver),
      hasEdgeFrame: Boolean(state.edgeFrame)
    })
  });
})();
