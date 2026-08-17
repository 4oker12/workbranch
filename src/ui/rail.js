(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';

  const valueOf = fact =>
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact;

  const technicalFieldLabels = fields => {
    const labels = { olt: 'OLT', onuSerial: 'Serial ONU', onuMac: 'MAC ONU' };
    return (Array.isArray(fields) ? fields : [])
      .map(field => labels[field] || field)
      .join(', ');
  };


  const normalizedIdentity = value => String(valueOf(value) || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

  const tmcTechnicalExpectation = (caseData, fallback = {}) => {
    const pon = caseData?.pon || {};
    const fromTmcFact = (key, fallbackValue) => Object.prototype.hasOwnProperty.call(pon, key)
      ? String(valueOf(pon[key]) || '')
      : String(fallbackValue || '');
    const expected = {
      oltName: fromTmcFact('tmcOltName', fallback.oltName),
      oltIp: fromTmcFact('tmcOltIp', fallback.oltIp),
      onuSerial: fromTmcFact('tmcOnuSerial', fallback.onuSerial),
      onuMac: fromTmcFact('tmcOnuMac', fallback.onuMac)
    };
    const fields = [];
    if (expected.oltName || expected.oltIp) fields.push('olt');
    if (normalizedIdentity(expected.onuSerial)) fields.push('onuSerial');
    if (normalizedIdentity(expected.onuMac).length === 12) fields.push('onuMac');
    return { expected, fields };
  };

  const hasSuccessfulOnuPoll = caseData => {
    if (!caseData) return false;
    if (caseData?.locator?.termination?.status === 'confirmed') return true;
    if (caseData?.live?.oltSnapshot?.status === 'confirmed') return true;
    const evidence = Array.isArray(caseData?.locator?.evidence)
      ? caseData.locator.evidence
      : [];
    return evidence.some(item => {
      if (String(item?.type || '') !== 'POLL_RESULT') return false;
      const result = String(item?.result || item?.details?.outcome || '').toLowerCase();
      return ['confirmed', 'success', 'online', 'up'].includes(result);
    });
  };

  const esc = value =>
    String(value == null ? '' : value).replace(
      /[&<>"']/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
    );

  const formatTime = iso => {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(iso));
    } catch {
      return '';
    }
  };

  const formatRate = raw => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} Mbit/s`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)} kbit/s`;
    return `${Math.round(value)} bit/s`;
  };

  const icon = name => {
    const paths = {
      live: '<path d="M4 12h3l2-5 4 10 2-5h5"/>',
      facts: '<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
      appeals: '<path d="M5 5h14v11H9l-4 3V5Z"/><path d="M8 9h8M8 12h5"/>',
      phone: '<path d="M7.2 3.8 10 7l-2 2.2c1.3 2.6 3.3 4.6 5.9 5.9l2.2-2 3.1 2.8-.9 3.1c-.2.8-1 1.3-1.8 1.2C9.7 19.3 4.7 14.3 3.8 7.5c-.1-.8.4-1.6 1.2-1.8l2.2-.9Z"/>',
      journal: '<path d="M4 7h16M7 4v6M17 4v6M6 11h12v9H6z"/><path d="M9 15h6"/>',
      settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4 13v-2l2-1 .5-1.3-.7-2.1 1.4-1.4 2.1.7L10.6 5l1-2h2l1 2 1.3.9 2.1-.7 1.4 1.4-.7 2.1.9 1.3 2 1v2l-2 1-.9 1.3.7 2.1-1.4 1.4-2.1-.7-1.3.9-1 2h-2l-1-2-1.3-.9-2.1.7-1.4-1.4.7-2.1L6 14z"/>',
      diagnostics: '<path d="M12 3 3.5 19h17L12 3Z"/><path d="M12 9v4M12 16h.01"/>',
      chevron: '<path d="m14 7-5 5 5 5"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      copy: '<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
      nextHint: '<circle cx="12" cy="12" r="6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><path d="m10 12 1.4 1.4L14.5 10"/>',
      graph: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8M17 8l-4 8"/>',
      more: '<rect x="5" y="5" width="5" height="5" rx="1"/><rect x="14" y="5" width="5" height="5" rx="1"/><rect x="5" y="14" width="5" height="5" rx="1"/><rect x="14" y="14" width="5" height="5" rx="1"/>'
    };

    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.live}</svg>`;
  };

  class RailPanel {
    constructor() {
      this.host = null;
      this.shadow = null;
      this.state = null;
      this.drag = null;
      this.toastTimer = null;
      this.guideRunInFlight = false;
      this.liveNavInFlight = false;
      this.pollRevealInFlight = false;
      this.evidenceReplayInFlight = false;
      this.oneShotFocusInFlight = false;
      this.oneShotFocusNavigationKey = '';
      this.tmcWritebackInFlight = false;
      this.tmcWritebackRetryCount = 0;
      this.tmcAutoPrefillKey = '';
      this.tmcAutoPrefillRetryCount = 0;
      this.saveGatePromptKey = '';
      this.hoverOpen = false;
      this.hoverCloseTimer = null;
      this.activeView = null;
      this.fullSection = '';
      this.diagnosticsState = { entries: [], unreadCount: 0, updatedAt: '' };
      this.diagnosticsLoading = false;
      this.boundDiagnosticsChanged = event => {
        const detail = event?.detail || {};
        if (Array.isArray(detail.entries)) {
          this.diagnosticsState = detail;
          if (this.activeView === 'full' && this.fullSection === 'diagnostics') this.render();
          else this.syncDiagnosticsBadge();
          return;
        }
        if (Number.isFinite(Number(detail.unreadCount))) {
          this.diagnosticsState.unreadCount = Number(detail.unreadCount || 0);
          this.syncDiagnosticsBadge();
        }
        if (this.activeView === 'full' && this.fullSection === 'diagnostics') void this.refreshDiagnostics(true);
      };
      window.addEventListener?.('simnet-workbench-diagnostics-changed', this.boundDiagnosticsChanged);
      this.boundModuleOpen = event => {
        const module = String(event?.detail?.module || '');
        if (!['call', 'graph'].includes(module)) return;
        this.activeView = module;
        this.hoverOpen = false;
        this.render();
      };
      this.boundModuleClose = event => {
        const module = String(event?.detail?.module || '');
        if (module && this.activeView !== module) return;
        if (['call', 'graph'].includes(this.activeView)) {
          this.activeView = null;
          this.render();
        }
      };
      this.boundShellKeydown = event => {
        if (event.key !== 'Escape' || !this.activeView || ['call', 'graph'].includes(this.activeView)) return;
        event.preventDefault();
        this.activeView = null;
        this.render();
      };
      window.addEventListener?.('simnet-workbench-module-open', this.boundModuleOpen);
      window.addEventListener?.('simnet-workbench-module-close', this.boundModuleClose);
      globalThis.document?.addEventListener?.('keydown', this.boundShellKeydown, true);
      this.guideActive = Boolean(WB.runtime.guideActive);
      this.appealSaving = false;
      this.terminalView = {
        active: false,
        blocks: 0,
        interpreted: []
      };
      this.pollAttempt = null;
      this.lastWorkflowPageKind = '';
      this.unsub = WB.bus.on('store:state', state => this.update(state));
      this.unsubContextWorkflow = WB.bus.on('context:changed', payload => {
        const context = payload?.context || {};
        const reason = String(payload?.reason || '');
        queueMicrotask(() => { void this.continueWorkflowAfterContext(context, reason); });
      });
      this.unsubGuide = WB.bus.on('guide:active', payload => {
        this.guideActive = Boolean(payload?.active);
        if (this.guideActive) {
          clearTimeout(this.hoverCloseTimer);
          this.hoverOpen = false;
        }
        this.render();
      });
      this.unsubTerminalView = WB.bus.on('terminal:result-view', payload => {
        this.terminalView.active = Boolean(payload?.active);
        this.terminalView.blocks = Number(payload?.blocks || this.terminalView.blocks || 0);
        this.render();
      });
      this.unsubTerminalInterpreted = WB.bus.on('terminal:interpreted', payload => {
        this.terminalView.active = true;
        this.terminalView.interpreted = Array.isArray(payload?.blocks)
          ? payload.blocks
          : [];
        this.terminalView.blocks = this.terminalView.interpreted.length;
        this.render();
      });
      this.unsubGuardBlocked = WB.bus.on('guard:blocked', payload => {
        const reason = String(payload?.reason || '');
        if (reason === 'duplicate-poll-click' || reason === 'duplicate-poll-dblclick') {
          this.toast('Повторный клик заблокирован: запрос уже запущен');
          return;
        }
        if (reason === 'poll-page-not-ready') {
          this.toast('Страница ещё загружается — дождись появления ссылки');
          return;
        }
        if (reason.startsWith('poll-') && reason.endsWith('-mismatch')) {
          this.toast('Эта ссылка относится не к текущей связке абонента');
        }
      });
      this.unsubPollStarted = WB.bus.on('poll:attempt-started', payload => {
        this.pollAttempt = payload || null;
        this.render();
      });
      this.unsubPollResolved = WB.bus.on('poll:attempt-resolved', payload => {
        this.pollAttempt = payload || null;
        this.render();
        if (payload?.failureReason === 'native-navigation-cancelled') {
          this.toast('Запрос не запустился — можно нажать ещё раз');
        }
      });
      this.unsubAppealsGraph = WB.bus.on('appeals:graph-changed', () => this.render());
    }

    mount() {
      if (document.getElementById(HOST_ID)) return;

      this.host = document.createElement('div');
      this.host.id = HOST_ID;
      Object.assign(this.host.style, {
        position: 'fixed',
        right: '12px',
        bottom: '18px',
        width: 'auto',
        height: 'auto',
        transform: 'none',
        zIndex: '2147483646'
      });

      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `
        ${this.styles()}
        ${this.plumStyles()}
        <div class="view-backdrop" data-action="close"></div>
        <div class="shell">
          <aside class="drawer"><div class="panel"></div></aside>
          <nav class="rail"></nav>
        </div>
        <div class="toast"></div>
      `;

      document.documentElement.appendChild(this.host);
      this.state = WB.store.state || this.state;
      if (this.state) {
        this.state.ui = {
          ...(this.state.ui || {}),
          open: false
        };
        this.fullSection = this.normalizeFullSection(this.state.ui.section);
      }
      this.bind();
      this.render();
      void this.refreshDiagnostics(false);
    }

    styles() {
      return `<style>
        :host{
          all:initial;
          color-scheme:dark;
          --bg:rgba(14,18,24,.975);
          --rail:rgba(22,28,36,.985);
          --card:rgba(255,255,255,.055);
          --line:rgba(255,255,255,.105);
          --muted:rgba(255,255,255,.58);
          --text:#f7f9fb;
          --accent:#35d07f;
          --warn:#f6c453;
          --danger:#fb7185;
          --blue:#60a5fa;
          --focus:#58a6ff;
          --cyan:#22d3ee;
          --violet:#a78bfa
        }
        *{box-sizing:border-box}
        button{font:inherit}
        .shell{
          display:flex;
          align-items:stretch;
          height:100vh;
          color:var(--text);
          font:12px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
          filter:drop-shadow(-12px 16px 32px rgba(0,0,0,.35));
          user-select:none
        }
        .drawer{
          width:0;
          height:100vh;
          max-height:none;
          overflow:hidden;
          opacity:0;
          transform:translateX(12px);
          transition:width .22s ease,opacity .16s ease,transform .22s ease;
          border:1px solid transparent;
          border-right:0;
          border-radius:14px 0 0 14px;
          background:var(--bg);
          backdrop-filter:blur(16px)
        }
        .shell.open .drawer{
          width:368px;
          opacity:1;
          transform:none;
          border-color:var(--line)
        }
        .shell.compact.open .drawer{width:288px}
        .shell.guide-active .drawer{
          width:0!important;
          opacity:0!important;
          transform:translateX(12px)!important;
          border-color:transparent!important
        }
        .shell.guide-active .rail{
          border-color:rgba(53,208,127,.48);
          box-shadow:0 0 0 2px rgba(53,208,127,.12),0 0 22px rgba(53,208,127,.16)
        }
        .shell.guide-active .guide-quick{
          color:#fff;
          background:rgba(53,208,127,.18)
        }
        .panel{
          width:368px;
          height:100vh;
          max-height:none;
          overflow:auto;
          scrollbar-width:thin
        }
        .shell.compact .panel{width:288px}
        .rail{
          width:56px;
          height:100vh;
          align-self:stretch;
          display:flex;
          flex-direction:column;
          overflow:hidden;
          border:1px solid var(--line);
          border-right:0;
          border-radius:14px 0 0 14px;
          background:var(--rail);
          backdrop-filter:blur(16px)
        }
        .rail-spacer{
          flex:1 1 auto;
          min-height:14px;
          border-bottom:1px solid rgba(255,255,255,.045)
        }
        .brand,.rail-btn{
          position:relative;
          width:56px;
          height:56px;
          display:grid;
          place-items:center;
          border:0;
          border-bottom:1px solid rgba(255,255,255,.065);
          color:rgba(255,255,255,.65);
          background:transparent;
          cursor:pointer
        }
        .brand{
          height:64px;
          color:#fff;
          font-weight:900;
          letter-spacing:-.08em
        }
        .rail-btn:hover,.rail-btn.active{
          color:#fff;
          background:rgba(255,255,255,.07)
        }
        .rail-btn.guide-quick{
          color:rgba(255,255,255,.34)
        }
        .rail-btn.guide-quick.ready{
          color:var(--accent);
          background:rgba(53,208,127,.09)
        }
        .rail-btn.guide-quick.ready:after{
          content:"";
          position:absolute;
          right:7px;
          top:7px;
          width:6px;
          height:6px;
          border-radius:50%;
          background:var(--accent);
          box-shadow:0 0 0 3px rgba(53,208,127,.13)
        }
        .rail-btn.guide-quick:disabled{
          color:rgba(255,255,255,.2);
          background:transparent;
          cursor:default
        }
        .rail-btn.call-quick{
          color:var(--cyan);
          background:rgba(34,211,238,.055)
        }
        .rail-btn.call-quick:hover{
          color:#a5f3fc;
          background:rgba(34,211,238,.12)
        }
        .rail-btn.active:before{
          content:"";
          position:absolute;
          left:0;
          width:3px;
          height:24px;
          border-radius:0 4px 4px 0;
          background:var(--accent)
        }
        svg{
          width:23px;
          height:23px;
          fill:none;
          stroke:currentColor;
          stroke-width:1.7;
          stroke-linecap:round;
          stroke-linejoin:round
        }
        .head{
          position:sticky;
          top:0;
          z-index:2;
          display:flex;
          align-items:center;
          gap:9px;
          min-height:52px;
          padding:0 12px;
          border-bottom:1px solid var(--line);
          background:rgba(14,18,24,.96);
          cursor:ns-resize
        }
        .head-title{min-width:0;flex:1}
        .head-title b{display:block;font-size:13px}
        .head-title small{
          display:block;
          color:var(--muted);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .dot{
          width:8px;
          height:8px;
          border-radius:50%;
          background:var(--accent);
          box-shadow:0 0 0 4px rgba(53,208,127,.12)
        }
        .dot.warn{
          background:var(--warn);
          box-shadow:0 0 0 4px rgba(246,196,83,.12)
        }
        .icon-btn{
          width:30px;
          height:30px;
          display:grid;
          place-items:center;
          border:0;
          border-radius:8px;
          color:var(--muted);
          background:transparent;
          cursor:pointer
        }
        .icon-btn:hover{
          color:#fff;
          background:rgba(255,255,255,.07)
        }
        .body{padding:12px}
        .eyebrow{
          margin:0 0 7px;
          color:rgba(255,255,255,.42);
          font-size:9px;
          font-weight:800;
          letter-spacing:.12em;
          text-transform:uppercase
        }
        .hero{
          position:relative;
          overflow:hidden;
          padding:14px;
          border:1px solid rgba(88,166,255,.28);
          border-radius:15px;
          background:
            radial-gradient(circle at 100% 0,rgba(34,211,238,.14),transparent 38%),
            linear-gradient(145deg,rgba(88,166,255,.15),rgba(53,208,127,.045))
        }
        .hero:after{
          content:"";
          position:absolute;
          right:-28px;
          bottom:-48px;
          width:120px;
          height:120px;
          border:1px solid rgba(255,255,255,.065);
          border-radius:50%;
          pointer-events:none
        }
        .hero-line{
          display:flex;
          align-items:flex-start;
          gap:9px
        }
        .hero h2{
          margin:0;
          font-size:16px;
          line-height:1.15;
          overflow-wrap:anywhere
        }
        .hero p{margin:5px 0 0;color:var(--muted)}
        .case-kicker{
          display:flex;
          align-items:center;
          gap:6px;
          margin-bottom:8px;
          color:#b9dbff;
          font-size:9px;
          font-weight:850;
          letter-spacing:.1em;
          text-transform:uppercase
        }
        .case-kicker span{
          width:6px;
          height:6px;
          border-radius:50%;
          background:var(--focus);
          box-shadow:0 0 0 4px rgba(88,166,255,.12)
        }
        .chips{
          display:flex;
          flex-wrap:wrap;
          gap:6px;
          margin-top:10px
        }
        .chip{
          max-width:100%;
          padding:5px 7px;
          border:1px solid var(--line);
          border-radius:8px;
          color:rgba(255,255,255,.78);
          background:rgba(255,255,255,.045);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .chip strong{color:#fff}
        .section{margin-top:12px}
        .card{
          padding:10px;
          border:1px solid var(--line);
          border-radius:12px;
          background:var(--card)
        }
        .card.warn{border-color:rgba(246,196,83,.28)}
        .card.ready{border-color:rgba(53,208,127,.3)}
        .card.pending{border-color:rgba(96,165,250,.34);background:rgba(96,165,250,.075)}
        .card+.card{margin-top:7px}
        .label{color:var(--muted);font-size:10px}
        .value{
          margin-top:2px;
          color:#fff;
          font-weight:700;
          overflow-wrap:anywhere
        }
        .empty{color:rgba(255,255,255,.36);font-weight:500}
        .grid{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:7px
        }
        .shell.compact .grid{grid-template-columns:1fr}
        .fact{
          min-height:70px;
          padding:9px;
          border:1px solid var(--line);
          border-radius:10px;
          background:var(--card)
        }
        .fact .value{font-size:12px}
        .source{
          margin-top:4px;
          color:rgba(255,255,255,.34);
          font-size:9px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .card .source{
          white-space:normal;
          overflow:visible;
          text-overflow:clip;
          line-height:1.4
        }
        .fact .source{
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .learning{
          margin-top:8px;
          padding:7px 8px;
          border:1px solid rgba(96,165,250,.18);
          border-radius:8px;
          color:rgba(232,242,255,.78);
          background:rgba(96,165,250,.065);
          font-size:10.5px;
          line-height:1.4
        }
        .learning b{color:#dcecff}
        .route-map{
          position:relative;
          display:grid;
          grid-template-columns:repeat(var(--route-count,4),minmax(0,1fr));
          gap:4px;
          margin-top:12px;
          padding-top:2px
        }
        .route-map:before{
          content:"";
          position:absolute;
          top:11px;
          left:10%;
          right:10%;
          height:1px;
          background:rgba(255,255,255,.13)
        }
        .route-step{
          position:relative;
          min-width:0;
          text-align:center;
          color:rgba(255,255,255,.34);
          font-size:8.5px
        }
        .route-step i{
          position:relative;
          z-index:1;
          width:18px;
          height:18px;
          margin:0 auto 5px;
          display:grid;
          place-items:center;
          border:1px solid rgba(255,255,255,.18);
          border-radius:50%;
          color:rgba(255,255,255,.5);
          background:#171d25;
          font:800 8px/1 system-ui
        }
        .route-step.done{color:rgba(255,255,255,.62)}
        .route-step.done i{
          border-color:rgba(53,208,127,.5);
          color:#062d1b;
          background:var(--accent)
        }
        .route-step.skipped{color:rgba(255,255,255,.38)}
        .route-step.skipped i{
          border-style:dashed;
          color:rgba(255,255,255,.48);
          background:#171d25
        }
        .route-step.current{color:#fff;font-weight:750}
        .route-step.current i{
          border-color:var(--focus);
          color:#fff;
          background:#2563a7;
          box-shadow:0 0 0 4px rgba(88,166,255,.13)
        }
        .route-step span{
          display:block;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .live-case{
          padding:10px 11px;
          border:1px solid var(--line);
          border-radius:12px;
          background:rgba(255,255,255,.035)
        }
        .live-case-main{
          display:flex;
          align-items:center;
          gap:8px
        }
        .live-case-main>div{min-width:0;flex:1}
        .live-case-main .value{
          margin:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .snapshot-light{
          width:8px;
          height:8px;
          flex:0 0 auto;
          border-radius:50%;
          background:var(--warn)
        }
        .snapshot-light.ready{background:var(--accent)}
        .snapshot-light.error{background:var(--danger)}
        .live-stage{
          max-width:46%;
          color:rgba(255,255,255,.54);
          font-size:9px;
          text-align:right
        }
        .snapshot-meta{
          display:flex;
          flex-wrap:wrap;
          gap:4px 10px;
          margin-top:6px;
          color:rgba(255,255,255,.38);
          font-size:9px
        }
        .live-fingerprint{
          padding:10px 11px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.12);
          border-radius:12px;
          background:rgba(255,255,255,.035)
        }
        .live-fingerprint.ready{border-color:rgba(53,208,127,.25)}
        .live-fingerprint.warn{border-color:rgba(246,196,83,.25)}
        .fingerprint-head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px
        }
        .fingerprint-state{
          min-width:0;
          display:flex;
          align-items:center;
          gap:7px
        }
        .fingerprint-state strong{
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .fingerprint-head small{
          flex:0 0 auto;
          color:rgba(255,255,255,.32);
          font-size:8.5px
        }
        .fingerprint-facts{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          margin-top:8px;
          border-top:1px solid rgba(255,255,255,.075);
          border-left:1px solid rgba(255,255,255,.075)
        }
        .snapshot-fact{
          min-width:0;
          padding:6px 7px;
          border-right:1px solid rgba(255,255,255,.075);
          border-bottom:1px solid rgba(255,255,255,.075)
        }
        .snapshot-fact span{
          display:block;
          color:rgba(255,255,255,.34);
          font-size:8px;
          letter-spacing:.04em;
          text-transform:uppercase
        }
        .snapshot-fact strong{
          display:block;
          margin-top:1px;
          overflow:hidden;
          color:rgba(255,255,255,.88);
          font-size:10px;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .fingerprint-foot{
          margin-top:6px;
          overflow:hidden;
          color:rgba(255,255,255,.34);
          font-size:8.5px;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .line-snapshot{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:3px 10px;
          align-items:center;
          padding:9px 11px;
          border:1px solid var(--line);
          border-radius:12px;
          background:rgba(255,255,255,.03)
        }
        .line-snapshot.ready{border-color:rgba(53,208,127,.25)}
        .line-snapshot.warn{border-color:rgba(246,196,83,.25)}
        .line-snapshot .line-state{font-weight:750;text-align:right}
        .line-snapshot .line-facts{
          grid-column:1/-1;
          overflow:hidden;
          color:rgba(255,255,255,.38);
          font-size:8.5px;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .live-next{
          padding:9px 11px;
          border-left:3px solid var(--focus);
          border-radius:0 10px 10px 0;
          background:rgba(88,166,255,.055)
        }
        .live-next .source{margin-top:2px}
        .terminal-evidence{
          display:grid;
          gap:6px;
          margin-top:9px
        }
        .terminal-evidence-row{
          display:grid;
          grid-template-columns:18px 58px minmax(0,1fr);
          align-items:center;
          gap:6px;
          padding:7px;
          border:1px solid rgba(255,255,255,.09);
          border-radius:9px;
          background:rgba(255,255,255,.035)
        }
        .terminal-evidence-row .signal{
          width:18px;
          height:18px;
          display:grid;
          place-items:center;
          border-radius:50%;
          color:#07150e;
          background:var(--accent);
          font-size:11px;
          font-weight:900
        }
        .terminal-evidence-row.attention .signal,
        .terminal-evidence-row.conflict .signal{
          color:#211400;
          background:var(--warn)
        }
        .terminal-evidence-row .evidence-name{
          color:rgba(255,255,255,.55);
          font-size:9px;
          font-weight:800;
          letter-spacing:.05em;
          text-transform:uppercase
        }
        .terminal-evidence-row .evidence-value{
          min-width:0;
          color:#fff;
          font-size:10px;
          font-weight:700;
          overflow-wrap:anywhere
        }
        .confidence{color:rgba(255,255,255,.46)}
        .progress{
          height:6px;
          margin-top:10px;
          overflow:hidden;
          border-radius:99px;
          background:rgba(255,255,255,.08)
        }
        .progress span{
          display:block;
          height:100%;
          border-radius:inherit;
          background:linear-gradient(90deg,var(--blue),var(--accent))
        }
        .progress-label{
          display:flex;
          justify-content:space-between;
          gap:8px;
          margin-top:6px;
          color:var(--muted);
          font-size:10px
        }
        .appeal-intro{
          margin-bottom:12px;
          color:rgba(255,255,255,.68);
          font-size:10.5px;
          line-height:1.5
        }
        .appeal-types{
          display:grid;
          gap:7px
        }
        .appeal-type{
          position:relative;
          width:100%;
          min-height:58px;
          padding:10px 36px 10px 12px;
          overflow:hidden;
          border:1px solid var(--line);
          border-radius:11px;
          color:var(--text);
          background:linear-gradient(115deg,rgba(88,166,255,.09),rgba(255,255,255,.035) 58%);
          text-align:left;
          cursor:pointer
        }
        .appeal-type:after{
          content:'›';
          position:absolute;
          right:13px;
          top:50%;
          color:var(--focus);
          font-size:24px;
          transform:translateY(-52%)
        }
        .appeal-type:hover{
          border-color:rgba(88,166,255,.42);
          background:linear-gradient(115deg,rgba(88,166,255,.15),rgba(255,255,255,.05) 62%)
        }
        .appeal-type b{display:block;font-size:11px}
        .appeal-type small{display:block;margin-top:3px;color:var(--muted);font-size:9.5px;line-height:1.4}
        .appeal-head{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:10px;
          margin-bottom:10px
        }
        .appeal-head .label{color:var(--focus)}
        .appeal-head .value{font-size:15px}
        .appeal-progress{
          display:grid;
          grid-template-columns:repeat(5,minmax(0,1fr));
          gap:3px;
          margin:9px 0 14px
        }
        .appeal-phase{
          position:relative;
          min-width:0;
          padding-top:21px;
          color:rgba(255,255,255,.36);
          font-size:8px;
          text-align:center
        }
        .appeal-phase:before{
          content:'';
          position:absolute;
          left:50%;
          top:7px;
          width:calc(100% + 3px);
          height:2px;
          background:rgba(255,255,255,.09)
        }
        .appeal-phase:last-child:before{display:none}
        .appeal-phase i{
          position:absolute;
          z-index:1;
          left:50%;
          top:1px;
          width:15px;
          height:15px;
          display:grid;
          place-items:center;
          border:1px solid rgba(255,255,255,.18);
          border-radius:50%;
          color:rgba(255,255,255,.52);
          background:var(--bg);
          font-size:8px;
          font-style:normal;
          transform:translateX(-50%)
        }
        .appeal-phase.done:before{background:rgba(53,208,127,.45)}
        .appeal-phase.done i{border-color:rgba(53,208,127,.55);color:#07150e;background:var(--accent)}
        .appeal-phase.current{color:#fff}
        .appeal-phase.current i{border-color:var(--focus);color:#06111d;background:var(--focus);box-shadow:0 0 0 4px rgba(88,166,255,.11)}
        .appeal-known{
          display:flex;
          flex-wrap:wrap;
          gap:5px;
          margin-bottom:10px
        }
        .appeal-known span{
          padding:4px 6px;
          border:1px solid rgba(255,255,255,.08);
          border-radius:7px;
          color:rgba(255,255,255,.7);
          background:rgba(255,255,255,.03);
          font-size:8.5px
        }
        .appeal-known b{color:#fff;font-weight:700}
        .appeal-question{
          position:relative;
          padding:13px 12px 12px;
          overflow:hidden;
          border:1px solid rgba(88,166,255,.25);
          border-radius:12px;
          background:linear-gradient(145deg,rgba(88,166,255,.12),rgba(255,255,255,.035) 62%)
        }
        .appeal-question:before{
          content:'';
          position:absolute;
          left:0;
          top:0;
          bottom:0;
          width:3px;
          background:var(--focus)
        }
        .appeal-question h2{
          margin:3px 0 5px;
          color:#fff;
          font-size:15px;
          line-height:1.28
        }
        .appeal-why{
          margin:0 0 11px;
          color:rgba(235,244,255,.66);
          font-size:9.5px;
          line-height:1.45
        }
        .appeal-options{display:grid;gap:6px}
        .appeal-option{
          width:100%;
          min-height:46px;
          padding:8px 10px;
          border:1px solid rgba(255,255,255,.11);
          border-radius:9px;
          color:#fff;
          background:rgba(6,12,19,.42);
          text-align:left;
          cursor:pointer
        }
        .appeal-option:hover{border-color:rgba(88,166,255,.5);background:rgba(88,166,255,.09)}
        .appeal-option b{display:block;font-size:10.5px}
        .appeal-option small{display:block;margin-top:2px;color:var(--muted);font-size:8.5px}
        .appeal-option:disabled{opacity:.55;cursor:wait}
        .appeal-outcome{
          padding:13px 12px;
          border:1px solid rgba(53,208,127,.25);
          border-radius:12px;
          background:linear-gradient(145deg,rgba(53,208,127,.12),rgba(255,255,255,.035) 66%)
        }
        .appeal-outcome h2{margin:3px 0 6px;font-size:15px;line-height:1.28}
        .appeal-outcome p{margin:0;color:rgba(255,255,255,.7);font-size:9.5px;line-height:1.48}
        .appeal-next{
          margin-top:10px;
          padding:8px 9px;
          border-left:3px solid var(--accent);
          border-radius:0 8px 8px 0;
          color:rgba(255,255,255,.78);
          background:rgba(53,208,127,.06);
          font-size:9.5px
        }
        .appeal-trail{display:grid;gap:5px;margin-top:10px}
        .appeal-trail-row{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:7px;
          padding:6px 0;
          border-bottom:1px solid rgba(255,255,255,.065);
          color:var(--muted);
          font-size:8.5px
        }
        .appeal-trail-row:last-child{border-bottom:0}
        .appeal-trail-row b{max-width:110px;color:rgba(255,255,255,.82);text-align:right}
        .appeal-tech{
          margin-top:13px;
          padding-top:12px;
          border-top:1px solid var(--line)
        }
        .appeal-tech .route-map{margin-top:8px}
        .appeal-tech-readout{
          margin:8px 0;
          color:rgba(255,255,255,.68);
          font-size:9.5px;
          line-height:1.45
        }
        .event.appeal{border-left-color:var(--focus)}
        .journal{display:grid;gap:7px}
        .event{
          padding:9px;
          border-left:2px solid rgba(255,255,255,.18);
          border-radius:0 9px 9px 0;
          background:rgba(255,255,255,.04)
        }
        .event.fact{border-left-color:var(--accent)}
        .event.navigation{border-left-color:var(--blue)}
        .event.diagnostic{border-left-color:var(--warn)}
        .event.handoff{border-left-color:#a78bfa}
        .event.guide{border-left-color:#22d3ee}
        .event.operator_click,.event.operator_double_click{border-left-color:#fb923c}
        .event.operator_selection{border-left-color:#f472b6}
        .event.operator_navigation,.event.operator_return{border-left-color:#38bdf8}
        .event.operator_change,.event.operator_submit,.event.operator_key{border-left-color:#c084fc}
        .event.operator_hover,.event.operator_scroll{border-left-color:#94a3b8}
        .event.route_guard,.event.interaction_guard{border-left-color:#ef4444}
        .event .time{
          color:rgba(255,255,255,.36);
          font-size:9px
        }
        .event .message{
          margin-top:2px;
          color:rgba(255,255,255,.82);
          overflow-wrap:anywhere
        }
        .event .trace-detail{margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,255,255,.1);display:grid;gap:3px;color:rgba(255,255,255,.53);font-size:9px;overflow-wrap:anywhere}
        .event .trace-detail b{color:rgba(255,255,255,.75);font-weight:700}
        .event .trace-dom{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:rgba(255,255,255,.42)}
        .actions{
          display:flex;
          flex-wrap:wrap;
          gap:7px
        }
        .action{
          min-height:34px;
          padding:0 10px;
          display:inline-flex;
          align-items:center;
          gap:6px;
          border:1px solid var(--line);
          border-radius:9px;
          color:#fff;
          background:rgba(255,255,255,.065);
          cursor:pointer
        }
        .action:hover{filter:brightness(1.15)}
        .action.primary{
          border-color:rgba(53,208,127,.28);
          color:#07150e;
          background:var(--accent);
          font-weight:800
        }
        .action.danger{
          color:#fecdd3;
          background:rgba(251,113,133,.12)
        }
        .toggle{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:10px 0;
          border-bottom:1px solid var(--line)
        }
        .toggle:last-child{border-bottom:0}
        .switch{
          width:38px;
          height:22px;
          padding:2px;
          border:0;
          border-radius:99px;
          background:rgba(255,255,255,.14);
          cursor:pointer
        }
        .switch span{
          display:block;
          width:18px;
          height:18px;
          border-radius:50%;
          background:#fff;
          transition:.18s
        }
        .switch.on{background:var(--accent)}
        .switch.on span{transform:translateX(16px)}
        .toast{
          position:absolute;
          right:64px;
          bottom:12px;
          max-width:280px;
          padding:8px 10px;
          border:1px solid var(--line);
          border-radius:9px;
          color:#fff;
          background:rgba(18,23,30,.98);
          opacity:0;
          transform:translateY(5px);
          transition:.16s;
          pointer-events:none;
          font:12px/1.35 system-ui
        }
        .toast.show{opacity:1;transform:none}
      </style>`;
    }

    plumStyles() {
      return `<style>
        :host{
          color-scheme:light;
          --plum:#A50046;
          --plum-hover:#870039;
          --plum-soft:#FFF1F6;
          --plum-line:#E7B7CB;
          --bg:#FFFFFF;
          --rail:#FFFFFF;
          --card:#FFFFFF;
          --line:#E4E7EC;
          --muted:#667085;
          --text:#1D2939;
          --accent:#A50046;
          --warn:#D97706;
          --danger:#D92D20;
          --blue:#2563EB;
          --focus:#A50046;
          --cyan:#A50046;
          --violet:#7C3AED
        }
        .shell{
          position:relative;
          display:block;
          width:52px;
          height:auto;
          filter:none;
          color:var(--text);
          font:12px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif
        }
        .view-backdrop{
          position:fixed;
          inset:0;
          z-index:0;
          opacity:0;
          pointer-events:none;
          background:rgba(24,30,42,.12);
          backdrop-filter:saturate(.88);
          transition:opacity .18s ease
        }
        .view-backdrop.show{opacity:1;pointer-events:auto}
        .view-backdrop.live{background:rgba(24,30,42,.09)}
        .view-backdrop.full{background:rgba(24,30,42,.12)}
        .drawer{
          position:fixed;
          right:76px;
          top:18px;
          bottom:18px;
          width:0;
          height:auto;
          z-index:1;
          overflow:hidden;
          opacity:0;
          transform:translateX(10px);
          border:1px solid transparent;
          border-radius:18px;
          background:rgba(255,255,255,.985);
          box-shadow:-18px 18px 42px rgba(16,24,40,.13);
          backdrop-filter:blur(18px);
          transition:width .22s ease,opacity .16s ease,transform .22s ease,border-color .16s ease
        }
        .shell.open .drawer{width:382px;opacity:1;transform:none;border-color:#E4E7EC}
        .shell.full.open .drawer{width:min(430px,calc(100vw - 104px))}
        .shell.compact.open .drawer{width:338px}
        .panel{width:382px;height:100%;max-height:none;color:var(--text);scrollbar-color:#CBD5E1 transparent}
        .shell.full .panel{width:min(430px,calc(100vw - 104px))}
        .shell.compact .panel{width:338px}
        .rail{
          position:relative;
          z-index:2;
          width:52px;
          height:auto;
          display:grid;
          gap:7px;
          overflow:visible;
          border:0;
          border-radius:0;
          background:transparent;
          box-shadow:none;
          backdrop-filter:none;
          padding:0
        }
        .rail-stack{display:grid;gap:7px}
        .rail-divider{display:none}
        .brand,.rail-btn{
          position:relative;
          width:48px;height:48px;border:1px solid #E4E7EC;border-radius:14px;
          color:var(--plum);background:rgba(255,255,255,.96);
          box-shadow:0 7px 20px rgba(16,24,40,.12),0 1px 3px rgba(16,24,40,.06);
          backdrop-filter:blur(10px);
          transition:background .14s ease,color .14s ease,border-color .14s ease,
          box-shadow .14s ease,transform .14s ease
        }
        .rail-btn:hover{
          color:var(--plum);background:var(--plum-soft);border-color:#F0CBD9;transform:translateY(-1px)
        }
        .rail-btn.active{
          color:#fff;background:var(--plum);border-color:var(--plum);
          box-shadow:0 7px 18px rgba(165,0,70,.25)
        }
        .rail-btn.active:before{display:none}
        .rail-btn.call-quick{color:var(--plum);background:#FFF7FA;border-color:#F5D9E4}
        .rail-btn.call-quick:hover{color:var(--plum);background:#FFEAF2;border-color:#E9B8CC}
        .rail-btn.call-quick.active{color:#fff;background:var(--plum);border-color:var(--plum)}
        .rail-btn.live-ready:after{
          content:"";position:absolute;right:7px;top:7px;width:7px;height:7px;border-radius:50%;
          background:#12B76A;border:2px solid #fff;box-shadow:0 0 0 2px rgba(18,183,106,.12)
        }
        .rail-btn.more{width:42px;height:42px;margin:4px 0 0 3px;color:#667085;background:rgba(255,255,255,.92);border-color:#EAECF0}
        .rail-btn.more.active{color:#fff}
        .rail-label{
          position:absolute;right:56px;top:50%;transform:translateY(-50%) translateX(5px);
          opacity:0;pointer-events:none;white-space:nowrap;padding:6px 8px;border:1px solid #E4E7EC;
          border-radius:8px;background:#fff;color:#344054;box-shadow:0 7px 20px rgba(16,24,40,.12);
          font-size:10px;font-weight:700;transition:.12s
        }
        .rail-btn:hover .rail-label{opacity:1;transform:translateY(-50%) translateX(0)}
        .head{
          background:rgba(255,255,255,.97);border-bottom-color:#EAECF0;cursor:default;
          min-height:58px;padding:0 14px
        }
        .head-title b{color:#1D2939;font-size:13.5px}.head-title small{color:#667085}
        .dot{background:var(--plum);box-shadow:0 0 0 4px rgba(165,0,70,.10)}
        .dot.warn{background:#F79009;box-shadow:0 0 0 4px rgba(247,144,9,.12)}
        .icon-btn{color:#667085}.icon-btn:hover{color:#344054;background:#F2F4F7}
        .body{padding:14px;background:#FCFCFD}
        .eyebrow{color:#98A2B3}
        .hero{
          border-color:#E9C2D2;background:linear-gradient(145deg,#FFF5F8,#FFFFFF 72%);
          box-shadow:0 1px 0 rgba(165,0,70,.03)
        }
        .hero p,.label{color:#667085}.hero h2,.value{color:#1D2939}
        .case-kicker{color:var(--plum)}.case-kicker span{background:var(--plum);box-shadow:0 0 0 4px rgba(165,0,70,.10)}
        .chip{border-color:#E4E7EC;color:#475467;background:#F9FAFB}.chip strong{color:#1D2939}
        .card,.fact{border-color:#E4E7EC;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025)}
        .card.warn{border-color:#FEDF89;background:#FFFAEB}.card.ready{border-color:#ABEFC6;background:#F6FEF9}
        .card.pending{border-color:#C7D7FE;background:#F5F8FF}
        .source{color:#98A2B3}.empty{color:#98A2B3}
        .learning{border-color:#E9C2D2;color:#694052;background:#FFF5F8}.learning b{color:#4A1630}
        .route-map:before{background:#E4E7EC}.route-step{color:#98A2B3}.route-step.done{color:#667085}
        .route-step i{border-color:#D0D5DD;color:#667085;background:#fff}.route-step.done i{border-color:#75E0A7;color:#067647;background:#ECFDF3}
        .route-step.active i,.route-step.current i{border-color:var(--plum);color:#fff;background:var(--plum);box-shadow:0 0 0 3px rgba(165,0,70,.10)}
        .route-step.current{color:#344054}.route-step.skipped{color:#98A2B3}.route-step.skipped i{background:#F9FAFB;color:#98A2B3;border-color:#E4E7EC}
        .live-case,.live-fingerprint,.line-snapshot{border-color:#E4E7EC;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025)}
        .live-fingerprint.ready,.line-snapshot.ready{border-color:#ABEFC6;background:#F6FEF9}.live-fingerprint.warn,.line-snapshot.warn{border-color:#FEDF89;background:#FFFAEB}
        .live-stage,.snapshot-meta,.fingerprint-head small,.fingerprint-foot,.line-snapshot .line-facts{color:#98A2B3}
        .fingerprint-facts{border-top-color:#EAECF0;border-left-color:#EAECF0}.snapshot-fact{border-right-color:#EAECF0;border-bottom-color:#EAECF0}.snapshot-fact span{color:#98A2B3}.snapshot-fact strong{color:#344054}
        .live-next{border-left-color:var(--plum);background:#FFF5F8}.live-next .value{color:#4A1630}
        .pon-ready-action{margin-top:10px}
        .live-context-card{
          padding:11px 12px;border:1px solid #E4E7EC;border-radius:12px;background:#fff;
          box-shadow:0 1px 2px rgba(16,24,40,.025)
        }
        .live-context-card.attention{border-color:#E9C2D2;background:#FFF8FB}
        .live-context-card.final-step{border-color:#E9C2D2;background:#FFF8FB;box-shadow:0 1px 2px rgba(165,0,70,.035)}
        .live-context-card.final-step .live-nav-title{color:#4A1630}
        .live-context-card .value{margin-top:2px;font-size:12px;font-weight:800}
        .live-context-card .source{margin-top:4px;line-height:1.45}
        .live-nav-title{display:flex;align-items:center;gap:7px;color:#1D2939;font-size:12px;font-weight:800}
        .live-nav-title span:first-child{min-width:0;flex:0 1 auto}
        .live-nav-help{position:relative;display:inline-grid;place-items:center;width:18px;height:18px;flex:0 0 18px;border:1px solid #D0D5DD;border-radius:50%;background:#fff;color:#667085;font:800 10px/1 Arial,sans-serif;cursor:help;outline:none}
        .live-nav-help:hover,.live-nav-help:focus-visible{border-color:#C86B91;color:var(--plum);background:#FFF5F8}
        .live-nav-help:after{content:attr(data-help);position:absolute;right:calc(100% + 8px);top:50%;width:250px;max-width:min(250px,65vw);padding:8px 10px;border:1px solid #E4E7EC;border-radius:9px;background:#fff;color:#344054;box-shadow:0 10px 28px rgba(16,24,40,.16);font:500 11px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;white-space:normal;opacity:0;visibility:hidden;transform:translateY(-50%) translateX(4px);transition:opacity .12s ease,transform .12s ease,visibility .12s ease;pointer-events:none;z-index:8}
        .live-nav-help:hover:after,.live-nav-help:focus-visible:after{opacity:1;visibility:visible;transform:translateY(-50%) translateX(0)}
        .juniper-essential{grid-template-columns:repeat(2,minmax(0,1fr))}
        .live-onu-result .value{color:#067647}
        .terminal-evidence-row{border-color:#E4E7EC;background:#fff}.terminal-evidence-row .signal{color:#fff;background:#12B76A}.terminal-evidence-row.attention .signal,.terminal-evidence-row.conflict .signal{color:#fff;background:#F79009}.terminal-evidence-row .evidence-name{color:#667085}.terminal-evidence-row .evidence-value{color:#344054}.confidence{color:#98A2B3}
        .progress{background:#EAECF0}.progress span{background:linear-gradient(90deg,#C34C7D,var(--plum))}
        .appeal-intro{color:#667085}.appeal-type{border-color:#E4E7EC;color:#344054;background:#fff}.appeal-type:after{color:var(--plum)}.appeal-type:hover{border-color:#D5A0B7;background:#FFF8FB}
        .appeal-head .label{color:var(--plum)}.appeal-phase{color:#98A2B3}.appeal-phase:before{background:#EAECF0}.appeal-phase i{border-color:#D0D5DD;color:#667085;background:#fff}.appeal-phase.done:before{background:#75E0A7}.appeal-phase.done i{border-color:#75E0A7;color:#067647;background:#ECFDF3}.appeal-phase.current{color:#344054}.appeal-phase.current i{border-color:var(--plum);color:#fff;background:var(--plum);box-shadow:0 0 0 4px rgba(165,0,70,.08)}
        .appeal-known span{border-color:#E4E7EC;color:#667085;background:#F9FAFB}.appeal-known b{color:#344054}
        .appeal-question{border-color:#E9C2D2;background:#FFF8FB}.appeal-question:before{background:var(--plum)}.appeal-question h2{color:#1D2939}.appeal-why{color:#667085}.appeal-option{border-color:#D0D5DD;color:#344054;background:#fff}.appeal-option:hover{border-color:#C86B91;background:#FFF5F8}
        .appeal-outcome{border-color:#ABEFC6;background:#F6FEF9}.appeal-outcome p{color:#475467}.appeal-next{border-left-color:#12B76A;color:#475467;background:#ECFDF3}.appeal-trail-row{border-bottom-color:#EAECF0}.appeal-trail-row b{color:#344054}.appeal-tech-readout{color:#667085}
        .event{border-left-color:#D0D5DD;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025)}.event .time{color:#98A2B3}.event .message{color:#344054}.event .trace-detail{border-top-color:#EAECF0;color:#667085}.event .trace-detail b{color:#475467}.event .trace-dom{color:#98A2B3}
        .action{
          border-color:#D0D5DD!important;background:#fff!important;color:#344054!important;
          box-shadow:0 1px 2px rgba(16,24,40,.04)
        }
        .action:hover{background:#F9FAFB!important;border-color:#98A2B3!important}
        .action.primary{border-color:var(--plum)!important;background:var(--plum)!important;color:#fff!important}
        .action.primary:hover{background:var(--plum-hover)!important}
        .action.danger{border-color:#FECDCA!important;color:#B42318!important;background:#FFF8F7!important}
        .full-nav{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px}
        .full-nav button{
          min-width:0;height:62px;padding:6px;border:1px solid #E4E7EC;border-radius:11px;
          background:#fff;color:#475467;display:grid;place-items:center;gap:3px;cursor:pointer;font:700 9px/1.2 inherit
        }
        .full-nav button svg{width:19px;height:19px;color:var(--plum)}
        .full-nav button.active{border-color:#E3A8C0;background:#FFF1F6;color:#6D1438}
        .diagnostics-badge{position:absolute;right:5px;top:5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#A50046;color:#fff;font:800 9px/17px Inter,system-ui;text-align:center;box-shadow:0 0 0 2px #fff}
        .diag-list{display:grid;gap:7px}
        .diag-item{border:1px solid #E4E7EC;border-radius:11px;background:#fff;padding:10px}
        .diag-item.unread{border-color:#E3A8C0;box-shadow:inset 3px 0 0 #A50046}
        .diag-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .diag-level{font:800 9px/1 Inter,system-ui;padding:4px 6px;border-radius:999px;background:#F2F4F7;color:#344054}
        .diag-level.ERROR,.diag-level.CRITICAL{background:#FEF3F2;color:#B42318}.diag-level.WARNING{background:#FFFAEB;color:#B54708}.diag-level.NOTICE{background:#F4EBFF;color:#6941C6}
        .diag-code{font:800 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:#344054;overflow-wrap:anywhere}
        .diag-message{margin-top:6px;font:650 11px/1.35 Inter,system-ui;color:#101828;overflow-wrap:anywhere}
        .diag-meta{margin-top:5px;font:500 9px/1.35 Inter,system-ui;color:#667085}
        .diag-details{margin-top:7px;padding-top:7px;border-top:1px solid #F2F4F7;font:500 9px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;color:#475467;white-space:pre-wrap;overflow-wrap:anywhere}

        .live-case.compact-identity{padding:12px 13px;display:grid;gap:8px}
        .live-identity-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
        .live-identity-main{min-width:0}
        .live-identity-main .value{font-size:15px;font-weight:850;line-height:1.2;color:#1D2939}
        .live-identity-main .source{margin-top:2px;color:#98A2B3;font-size:9px}
        .live-connectivity{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;padding:4px 7px;border-radius:999px;background:#F2F4F7;color:#667085;font-size:9px;font-weight:850}
        .live-connectivity.online{background:#ECFDF3;color:#067647}.live-connectivity.offline{background:#FEF3F2;color:#B42318}.live-connectivity.unknown{background:#F2F4F7;color:#667085}
        .live-connectivity i{width:6px;height:6px;border-radius:50%;background:currentColor}
        .live-traffic-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#667085;font-size:9px}
        .live-traffic-row b{color:#344054;font-weight:750}.live-traffic-row time{margin-left:auto;color:#98A2B3}
        .evidence-history{display:grid;gap:6px}.evidence-history-head{display:flex;align-items:center;justify-content:space-between;color:#667085;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
        .evidence-row{display:grid;grid-template-columns:22px minmax(0,1fr) 30px;align-items:center;gap:8px;padding:8px 9px;border:1px solid #E4E7EC;border-radius:10px;background:#fff}
        .evidence-row .check{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#ECFDF3;color:#067647;font-size:12px;font-weight:900}.evidence-row.attention .check{background:#FFFAEB;color:#B54708}.evidence-row.active .check{background:#FFF1F6;color:#A50046}
        .evidence-row-main{min-width:0}.evidence-row-main b{display:block;color:#344054;font-size:10.5px}.evidence-row-main span{display:block;margin-top:2px;color:#667085;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .evidence-replay{display:grid;place-items:center;width:28px;height:28px;border:1px solid #E4E7EC;border-radius:8px;background:#fff;color:#A50046;font:900 16px/1 system-ui;cursor:pointer}.evidence-replay:hover{border-color:#D6A0B7;background:#FFF5F8}
        .live-next-one{border:1px solid #E9C2D2;border-left:3px solid var(--plum);border-radius:10px;background:#FFF8FB;padding:10px}.live-next-one .label{color:#8A1847}.live-next-one .value{margin-top:3px;color:#4A1630;font-size:12px;font-weight:850}.live-next-one .source{margin-top:4px}

        .toast{position:fixed;right:72px;bottom:0;border-color:#E4E7EC;background:#fff;color:#344054;box-shadow:0 12px 32px rgba(16,24,40,.16)}
        .shell.guide-active .rail-btn.live-ready,.shell.guide-active .rail-btn.active{box-shadow:0 0 0 3px rgba(165,0,70,.10),0 9px 24px rgba(16,24,40,.14)}
        @media (prefers-reduced-motion:reduce){.drawer,.view-backdrop,.rail-btn,.rail-label{transition:none!important}}
      </style>`;
    }

    bind() {
      this.shadow.addEventListener('click', event => {
        const sectionButton = event.target.closest('[data-section]');
        if (sectionButton) {
          const section = this.normalizeFullSection(sectionButton.dataset.section);
          if (this.guideActive) WB.guide.clear('USER_INTERRUPTED');
          this.activeView = 'full';
          this.hoverOpen = false;
          this.selectFullSection(section);
          if (section === 'diagnostics') void this.refreshDiagnostics(true);
          return;
        }

        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        if (action === 'view-live') {
          if (this.guideActive) WB.guide.clear('USER_INTERRUPTED');
          this.activeView = this.activeView === 'live' ? null : 'live';
          this.hoverOpen = false;
          this.state.ui = { ...(this.state.ui || {}), section: 'live', open: false };
          if (this.activeView === 'live') {
            window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'live' } }));
          }
          this.render();
          return;
        }
        if (action === 'view-full') {
          if (this.guideActive) WB.guide.clear('USER_INTERRUPTED');
          this.activeView = this.activeView === 'full' ? null : 'full';
          this.hoverOpen = false;
          if (this.activeView === 'full') {
            this.fullSection = this.normalizeFullSection(this.fullSection || this.state?.ui?.section);
            if (this.state) this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false };
            window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'full' } }));
          }
          this.render();
          return;
        }
        if (action === 'view-graph') {
          this.activeView = 'graph';
          this.hoverOpen = false;
          this.render();
          WB.graphStudio?.open?.({ mode: 'runtime' });
          return;
        }

        if (action === 'live-open-technical') {
          void this.followOneShotRecommendation('technical', () => this.openTechnicalDirect());
          return;
        }
        if (action === 'live-go-tmc') {
          void this.followOneShotRecommendation('tmc', () => this.openTmcSourceDirect());
          return;
        }
        if (action === 'live-show-tmc') {
          void this.followOneShotRecommendation('tmc', () => this.showTmcBlock());
          return;
        }
        if (action === 'live-search-mac') {
          void this.openMacSearchDirect();
          return;
        }
        if (action === 'live-apply-tmc') {
          void this.requestTmcWriteback();
          return;
        }
        if (action === 'live-return-technical') {
          void this.returnToTechnical();
          return;
        }
        if (action === 'live-open-poll') {
          void this.requestPollReveal();
          return;
        }
        if (action === 'live-replay') {
          const key = String(event.target.closest('[data-evidence-key]')?.dataset.evidenceKey || '');
          if (key) void this.replayEvidence(key);
          return;
        }

        if (action === 'guide-next') {
          if (this.guideActive) {
            this.toast('Подсказка уже открыта');
            return;
          }
          this.runNextGuide();
          return;
        }

        if (action === 'call-registration') {
          const currentCase = this.activeCase();
          if (!currentCase?.id) {
            this.toast('Сначала открой текущего абонента');
            return;
          }
          if (!WB.callRegistration?.open) {
            this.toast('Модуль регистрации звонка не загружен');
            return;
          }
          this.hoverOpen = false;
          this.activeView = 'call';
          this.render();
          void WB.callRegistration.open(currentCase).then(result => {
            if (!result?.ok && this.activeView === 'call') {
              this.activeView = null;
              this.render();
            }
          });
          return;
        }

        if (action === 'guide-highlight') {
          this.collapseForNavigation();
          if (this.guideActive) {
            this.toast('Сначала закройте текущую подсказку');
            return;
          }
          WB.guide.highlight(this.activeCase()).then(result => {
            this.toast(
              result.ok
                ? 'Элемент подсвечен'
                : 'Нужный элемент на этой странице не найден'
            );
          });
        }
        if (action === 'guide-navigate') {
          this.collapseForNavigation();
          if (this.guideActive) WB.guide.clear('USER_INTERRUPTED');
          WB.guide.navigate(this.activeCase()).then(result => {
            if (!result.ok) {
              this.toast('Не удалось выполнить переход');
            }
          });
        }
        if (action === 'passive-show') {
          const result = WB.guide?.highlightPassiveDiscovery?.(this.activeCase());
          this.toast(result?.ok ? 'Найденный блок показан' : 'Блок уже изменился или не найден');
        }
        if (action === 'close') {
          this.hoverOpen = false;
          this.activeView = null;
          this.render();
        }
        if (action === 'copy-contract') {
          this.copy(
            valueOf(this.activeCase()?.identity?.contract)
            || valueOf(this.activeCase()?.identity?.login)
            || ''
          );
        }
        if (action === 'export') this.exportCase();
        if (action === 'reset') this.resetCase();
        if (action === 'rescan') {
          WB.runtime.forceScan?.('manual-rescan');
          this.toast('Повторное чтение страницы');
        }
        if (action === 'compact') {
          const compact = !Boolean(this.state?.ui?.compact);
          WB.store.patchUi({ compact });
          this.state.ui = { ...this.state.ui, compact };
          this.render();
        }
        if (action === 'operator-trace') {
          const currentCase = this.activeCase();
          if (!currentCase?.id) {
            this.toast('Сначала открой текущего абонента');
            return;
          }
          const enabled = !Boolean(currentCase?.workflow?.operatorTrace?.enabled);
          void WB.store.patchWorkflow('operatorTrace', { enabled }).then(async result => {
            if (result?.accepted === false) {
              this.toast('Не удалось изменить режим записи');
              return;
            }
            WB.operatorTrace?.setEnabled?.(enabled);
            this.render();
            if (enabled) {
              this.toast('DIAGNOSTIC TRACE включён для этого Case');
            } else {
              this.toast('Trace остановлен — готовлю экспорт');
              await WB.operatorTrace?.stopAndExport?.();
            }
          }).catch(error => this.toast(error?.message || String(error)));
          return;
        }
        if (action === 'operator-trace-export') {
          void WB.operatorTrace?.exportTrace?.().then(payload => {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `simnet-workbench-trace-${stamp}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.toast('Trace экспортирован');
          }).catch(error => this.toast(error?.message || String(error)));
          return;
        }
        if (action === 'diagnostics-refresh') {
          void this.refreshDiagnostics(true);
          return;
        }
        if (action === 'diagnostics-mark-read') {
          void WB.observability?.markRead?.().then(state => {
            this.diagnosticsState = state || this.diagnosticsState;
            this.render();
            this.toast('Ошибки отмечены как просмотренные');
          }).catch(error => this.toast(error?.message || String(error)));
          return;
        }
        if (action === 'diagnostics-clear') {
          if (!confirm('Очистить технический журнал Workbench?')) return;
          void WB.observability?.clear?.().then(state => {
            this.diagnosticsState = state || { entries: [], unreadCount: 0, updatedAt: '' };
            this.render();
            this.toast('Диагностический журнал очищен');
          }).catch(error => this.toast(error?.message || String(error)));
          return;
        }
        if (action === 'diagnostics-export') {
          void this.exportDiagnostics();
          return;
        }
        if (action === 'performance-refresh') {
          this.render();
          return;
        }
        if (action === 'performance-reset') {
          WB.performanceMonitor?.reset?.();
          this.render();
          this.toast('Счётчики нагрузки сброшены');
          return;
        }
        if (action === 'appeal-select') {
          const typeId = String(event.target.closest('[data-appeal-type]')?.dataset.appealType || '');
          const appealType = WB.appeals?.type?.(typeId);
          if (!appealType) return;
          void this.persistAppeal(
            WB.appeals.select(typeId),
            { action: 'select', typeLabel: appealType.label }
          );
          return;
        }
        if (action === 'appeal-answer') {
          const current = WB.appeals?.normalize?.(this.activeCase()?.appeal);
          const currentNode = WB.appeals?.node?.(current);
          const answerId = String(event.target.closest('[data-answer]')?.dataset.answer || '');
          const selected = WB.appeals?.availableOptions?.(current, this.activeCase())
            ?.find(item => item.id === answerId);
          if (!currentNode || !selected) return;
          void this.persistAppeal(
            WB.appeals.answer(current, answerId, this.activeCase()),
            {
              action: 'answer',
              question: currentNode.title,
              answer: selected.label
            }
          );
          return;
        }
        if (action === 'appeal-back') {
          void this.persistAppeal(
            WB.appeals.back(this.activeCase()?.appeal),
            { action: 'back' }
          );
          return;
        }
        if (action === 'appeal-reset') {
          void this.persistAppeal(
            WB.appeals.empty(),
            { action: 'reset' }
          );
          return;
        }
        if (action === 'graph-studio-open') {
          this.activeView = 'graph';
          this.render();
          // Operator surface is Diagnostic Graph (runtime) only — not Graph Studio editor.
          WB.graphStudio?.open?.({ mode: 'runtime' });
          return;
        }
      });


    }

    activeCase() {
      return WB.store.activeCase();
    }

    normalizeFullSection(section) {
      return ['appeals', 'facts', 'journal', 'diagnostics', 'settings'].includes(String(section || ''))
        ? String(section)
        : 'facts';
    }

    selectFullSection(section) {
      const next = this.normalizeFullSection(section);
      this.fullSection = next;
      if (this.state) {
        this.state.ui = { ...(this.state.ui || {}), section: next, open: false };
      }
      this.render();
      Promise.resolve(WB.store.patchUi?.({ section: next })).catch(() => {
        this.toast('Не удалось сохранить выбранный раздел');
      });
    }

    update(state) {
      this.state = state || this.state || { ui: {}, cases: {} };
      const persisted = this.normalizeFullSection(this.state?.ui?.section);
      if (this.activeView === 'full' && this.fullSection) {
        this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false };
      } else {
        this.fullSection = persisted;
      }
      this.render();
    }

    async continueWorkflowAfterContext(context = {}, reason = '') {
      const currentCase = this.activeCase();
      if (!currentCase?.id) return { ok: false, reason: 'case-missing' };
      const pageKind = String(context?.pageKind || '');
      this.lastWorkflowPageKind = pageKind;
      const flow = currentCase?.workflow?.ponAcquisition || {};

      // The Save/no-Save business decision is committed by background.js from
      // the previous context of the SAME Billing tab. A full document navigation
      // can destroy this content script before Rail sees the destination, so UI
      // code must not own that durable transition.

      // Cross-tab navigation must finish from the destination context itself.
      // Opening LIVE is presentation only and must never be the event that wakes
      // a pending TMC/Technical ActionSession.
      if (pageKind === 'userside_customer') {
        void this.maybeContinueOneShotFocus();
        return { ok: true, reason: 'userside-action-resumed' };
      }
      if (pageKind !== 'billing_technical') return { ok: false, reason: 'context-not-workflow-target' };

      // Reload/pageshow while still on Billing Technical does not answer the
      // Save question. The semantic status remains frozen on Technical until a
      // real native Save is verified or the operator actually leaves the section.

      if (flow.tmcWritebackPending) {
        return this.maybeApplyPendingTmcWriteback();
      }
      if (flow.tmcWritebackPendingSave) {
        this.syncNativeSaveAttention(currentCase);
        this.scheduleNativeSaveGatePrompt(currentCase);
        return { ok: true, reason: 'native-save-still-pending' };
      }
      return { ok: false, reason: 'no-pending-technical-workflow' };
    }

    render() {
      if (!this.shadow) return;
      const finishRender = WB.performanceMonitor?.begin?.('render', 'rail');

      this.state ||= WB.store.state || {
        ui: { open: false, section: 'live' },
        cases: {}
      };

      const shell = this.shadow.querySelector('.shell');
      const drawerOpen = ['live', 'full'].includes(this.activeView) && !this.guideActive;
      shell.classList.toggle('open', drawerOpen);
      shell.classList.toggle('full', this.activeView === 'full');
      shell.classList.toggle('compact', Boolean(this.state.ui?.compact));
      shell.classList.toggle('guide-active', Boolean(this.guideActive));

      const backdrop = this.shadow.querySelector('.view-backdrop');
      if (backdrop) {
        backdrop.className = `view-backdrop ${this.activeView === 'live' ? 'live' : this.activeView === 'full' ? 'full' : ''}${drawerOpen ? ' show' : ''}`;
      }

      let section = this.state.ui?.section || 'facts';
      if (this.activeView === 'live') section = 'live';
      if (this.activeView === 'full') {
        section = this.normalizeFullSection(this.fullSection || section);
        this.fullSection = section;
      }

      const quickPlan = this.nextStep(this.activeCase());
      const quickReady = this.guideActionable(quickPlan);
      const active = this.activeView;

      this.shadow.querySelector('.rail').innerHTML = `
        <div class="rail-stack">
          ${this.viewButton('call', 'call-registration', 'phone', 'Регистрация звонка', active === 'call', 'call-quick')}
          ${this.viewButton('graph', 'view-graph', 'graph', 'Диагностический граф', active === 'graph')}
          ${this.viewButton('live', 'view-live', 'live', 'LIVE помощник', active === 'live', quickReady ? 'live-ready' : '')}
        </div>
        ${this.viewButton('full', 'view-full', 'more', 'Все функции', active === 'full', 'more')}
      `;
      this.syncDiagnosticsBadge();

      const panel = this.shadow.querySelector('.panel');
      const nav = this.activeView === 'full' ? this.fullNav(section) : '';
      panel.innerHTML = this.header(section) + `<div class="body">${nav}${this.section(section)}</div>`;
      this.syncPonTechnicalFieldHints();
      window.setTimeout(() => { void this.maybeApplyPendingTmcWriteback(); }, 0);
      window.setTimeout(() => { void this.maybeContinuePollReveal(); }, 0);
      window.setTimeout(() => {
        void this.maybeContinueEvidenceReplay();
        void this.maybeContinueOneShotFocus();
      }, 0);
      finishRender?.({ ok: true, activeView: this.activeView || 'compact' });
    }

    viewButton(view, action, iconName, title, active = false, extraClass = '') {
      return `<button class="rail-btn ${extraClass} ${active ? 'active' : ''}" data-action="${action}" data-view="${view}" title="${esc(title)}" aria-label="${esc(title)}">${icon(iconName)}<span class="rail-label">${esc(title)}</span></button>`;
    }

    fullNav(section) {
      const items = [
        ['facts', 'facts', 'Абонент'],
        ['appeals', 'appeals', 'Обращение'],
        ['journal', 'journal', 'Журнал'],
        ['diagnostics', 'diagnostics', 'Ошибки'],
        ['settings', 'settings', 'Настройки']
      ];
      return `<div class="full-nav">${items.map(([id, iconName, label]) => `<button class="${section === id ? 'active' : ''}" data-section="${id}" title="${esc(label)}">${icon(iconName)}<span>${esc(label)}</span></button>`).join('')}</div>`;
    }

    railButton(section, title) {
      return `<button class="rail-btn" data-section="${section}" title="${title}">${icon(section)}</button>`;
    }

    header(section) {
      const currentCase = this.activeCase();
      const context = WB.runtime.lastContext || currentCase?.currentContext;
      const diagnostic = currentCase?.diagnostic || {};
      const title = {
        live: 'LIVE · снимок',
        appeals: 'Навигатор обращения',
        facts: 'Профиль абонента',
        journal: 'Журнал кейса',
        diagnostics: 'Диагностика Workbench',
        settings: 'Настройки'
      }[section] || 'Workbench';

      return `
        <header class="head">
          <span class="dot ${diagnostic.conflictCount ? 'warn' : ''}"></span>
          <div class="head-title">
            <b>${title}</b>
            <small>${esc(
              context
                ? this.contextLabel(context)
                : 'Ожидание контекста'
            )}</small>
          </div>
          <button class="icon-btn" data-action="close" title="Свернуть">${icon('close')}</button>
        </header>
      `;
    }

    section(section) {
      if (section === 'appeals') return this.appealView();
      if (section === 'facts') return this.factsView();
      if (section === 'journal') return this.journalView();
      if (section === 'diagnostics') return this.diagnosticsView();
      if (section === 'settings') return this.settingsView();
      return this.liveView();
    }

    nextStep(currentCase) {
      return WB.guide?.plan?.(currentCase) || {
        id: 'guide-unavailable',
        title: 'Продолжи диагностику',
        text: 'Guide Mode не инициализирован.',
        kind: 'none'
      };
    }

    contextLabel(context = {}) {
      const system = String(context.system || '');
      const pageKind = String(context.pageKind || '');
      const systems = {
        billing: 'Billing',
        'looknet-billing': 'Billing',
        userside: 'UserSide'
      };
      const pages = {
        billing_user: 'карточка абонента',
        billing_juniper: 'интернет-сессия',
        billing_technical: 'технические данные',
        billing_onu_poll: 'опрос ONU',
        userside_customer: 'карточка абонента',
        userside_tmc: 'ТМЦ',
        userside_device: 'оборудование',
        device_poller: 'данные коммутатора',
        device_interface_errors: 'ошибки интерфейсов',
        device_interface_list: 'список интерфейсов',
        userside_interface: 'интерфейс'
      };
      return [systems[system] || system, pages[pageKind] || pageKind]
        .filter(Boolean)
        .join(' · ');
    }

    stageLabel(stage = '') {
      return ({
        empty: 'Собираем контекст',
        'juniper-session': 'Проверяем интернет-сессию',
        'need-technical-data': 'Читаем технические данные',
        'ethernet-route': 'Ищем порт коммутатора',
        'ethernet-fdb': 'Сверяем MAC и VLAN в FDB',
        'ethernet-errors': 'Проверяем ошибки порта',
        'ethernet-complete': 'Ethernet-путь проверен',
        'ready-for-poll': 'Готово к живому опросу',
        polling: 'Ждём ответ OLT',
        confirmed: 'Диагностика завершена'
      })[String(stage || '')] || 'Диагностика продолжается';
    }

    learningForPlan(plan) {
      return WB.knowledge?.resolve?.(plan)?.simple || '';
    }

    routeSteps(diagnostic = {}, locator = {}) {
      const ethernet = Boolean(diagnostic.isEthernet);
      const steps = ethernet
        ? [
            ['juniper', 'Juniper'],
            ['technical', 'Техданные'],
            ['switch', 'Коммутатор'],
            ['fdb', 'MAC / VLAN'],
            ['errors', 'Ошибки']
          ]
        : [
            ['juniper', 'Juniper'],
            ['technical', 'Техданные'],
            ['tmc', 'ТМЦ'],
            ['poll', 'Опрос']
          ];
      const stage = String(diagnostic.stage || 'empty');
      const action = String(diagnostic.locatorAction || '');
      const finished = stage === 'confirmed'
        || stage === 'ethernet-complete'
        || Boolean(diagnostic.confirmed);
      let current = 0;

      if (ethernet) {
        current = ({
          'need-technical-data': 1,
          'ethernet-route': 2,
          'ethernet-fdb': 3,
          'ethernet-errors': 4,
          'ethernet-complete': steps.length
        })[stage] ?? 0;
      } else if (/technical|fill_billing/i.test(action) || stage === 'need-technical-data') {
        current = 1;
      } else if (/tmc|customer_mac|search_mac|inspect_interface|inspect_device/i.test(action)) {
        current = 2;
      } else if (/poll/i.test(action) || ['ready-for-poll', 'polling'].includes(stage)) {
        current = 3;
      }
      if (finished) current = steps.length;

      const tmcObserved = Boolean(locator?.sourceStatus?.tmc);
      return steps.map(([id, label], index) => {
        let state = index < current ? 'done' : index === current ? 'current' : 'todo';
        if (!ethernet && id === 'tmc' && current > index && !tmcObserved) {
          state = 'skipped';
        }
        return { id, label, state };
      });
    }

    routeMap(diagnostic = {}, locator = {}) {
      const steps = this.routeSteps(diagnostic, locator);
      return `
        <div class="route-map" style="--route-count:${steps.length}" aria-label="Маршрут диагностики">
          ${steps.map((step, index) => `
            <div class="route-step ${step.state}" title="${esc(step.label)}">
              <i>${step.state === 'done' ? '✓' : step.state === 'skipped' ? '–' : index + 1}</i>
              <span>${esc(step.label)}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    pollAttemptFor(currentCase) {
      const stored = currentCase?.operations?.poll?.current || null;
      const local = this.pollAttempt;
      const attempt = local?.caseId === currentCase?.id ? local : stored;
      if (!attempt || String(attempt.caseId || currentCase?.id || '') !== String(currentCase?.id || '')) return null;
      return attempt;
    }

    pollAttemptPending(currentCase) {
      const attempt = this.pollAttemptFor(currentCase);
      if (!attempt) return false;
      const stage = String(attempt.stage || '');
      return attempt.pending !== false
        && !['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(stage);
    }

    pollAttemptCard(currentCase) {
      const attempt = this.pollAttemptFor(currentCase);
      if (!attempt) return '';
      const stage = String(attempt.stage || '');
      const pending = this.pollAttemptPending(currentCase);
      if (pending) {
        const value = stage === 'INTENT_RECORDED'
          ? 'Фиксирую запуск запроса…'
          : stage === 'REQUEST_STARTED'
            ? 'Запрос OLT отправляется…'
            : 'OLT обрабатывает запрос…';
        return `
          <div class="section">
            <div class="card pending">
              <div class="label">OLT · запрос выполняется</div>
              <div class="value">${esc(value)}</div>
              <div class="source">Повторный клик не нужен.</div>
            </div>
          </div>
        `;
      }
      if (['FAILED', 'TIMEOUT'].includes(stage) && currentCase?.locator?.termination?.status !== 'confirmed') {
        return `
          <div class="section">
            <div class="card warn">
              <div class="label">OLT · запрос не завершён</div>
              <div class="value">${stage === 'TIMEOUT' ? 'Страница ответа не открылась' : 'Запрос был отменён страницей'}</div>
              <div class="source">Запрос можно повторить.</div>
            </div>
          </div>
        `;
      }
      return '';
    }

    guideActionable(next) {
      return Boolean(
        next
        && (
          next.kind === 'highlight'
          || next.kind === 'navigate'
          || next.kind === 'focus-source'
          || next.focusSource
        )
      );
    }

    async runNextGuide() {
      if (this.guideRunInFlight) {
        this.toast('Подсказка уже готовится');
        return { ok: false, reason: 'guide-action-locked' };
      }

      this.collapseForNavigation();
      this.guideRunInFlight = true;
      let result = null;
      try {
        result = await WB.guide.runNext(this.activeCase());
      } catch (error) {
        console.debug('[SIMNET Workbench] Guide target changed during action', error);
        WB.runtime.forceScan?.('guide-target-changed');
        this.toast('Страница обновилась — состояние уже перечитано');
        return {
          ok: false,
          reason: 'target-detached'
        };
      } finally {
        this.guideRunInFlight = false;
      }

      if (result?.ok) {
        if (result.plan?.kind === 'highlight') {
          this.toast('Следующая подсказка показана');
        }
        return result;
      }

      const message = result?.reason === 'no-active-guide-action'
        ? 'Сейчас нет активной подсказки'
        : result?.reason === 'page-not-ready'
          ? 'Страница ещё загружается — подсказка пока заблокирована'
        : result?.reason === 'terminal-result-active'
          ? 'Результат уже получен — сверь данные OLT'
          : ['target-detached', 'target-resolve-failed', 'target-not-stable'].includes(result?.reason)
            ? 'Элемент ещё перестраивается — попробуй после загрузки страницы'
        : result?.reason === 'not-highlightable'
          ? 'Нужный элемент на странице не найден'
          : 'Не удалось вызвать следующую подсказку';
      this.toast(message);
      return result;
    }

    guideActions(next) {
      const actions = [];

      if (next?.kind === 'highlight') {
        actions.push(`
          <button class="action primary" data-action="guide-highlight">
            Подсветить
          </button>
        `);
      }

      if (
        next?.kind === 'navigate'
        || next?.kind === 'focus-source'
        || next?.focusSource
      ) {
        actions.push(`
          <button class="action ${actions.length ? '' : 'primary'}" data-action="guide-navigate">
            ${(next.kind === 'focus-source' || next.focusSource) ? 'Вернуться в Billing' : 'Перейти'}
          </button>
        `);
      }

      return actions.join('');
    }

    terminalEvidenceRows(snapshot = null) {
      const transient = Array.isArray(this.terminalView.interpreted)
        ? this.terminalView.interpreted
        : [];
      const blocks = transient.length
        ? transient
        : (Array.isArray(snapshot?.evidence) ? snapshot.evidence : []);
      const find = predicate => blocks.find(predicate);
      const historyBlock = find(block => block.family === 'history')
        || find(block => ['diagnostic', 'history'].includes(block.visualPriority))
        || null;
      const offlineSince = String(snapshot?.offlineSince || historyBlock?.facts?.currentOfflineSince || historyBlock?.facts?.latestAt || '');
      let offlineDuration = String(snapshot?.offlineDuration || historyBlock?.facts?.currentOfflineDuration || '');
      if (!offlineDuration && /offline/i.test(String(snapshot?.onuStatus || '')) && offlineSince) {
        const downAt = WB.pollTerminal?.parseDateish?.(offlineSince);
        const capturedAt = Date.parse(snapshot?.capturedAt || snapshot?.updatedAt || '');
        if (Number.isFinite(downAt) && Number.isFinite(capturedAt) && capturedAt >= downAt) {
          offlineDuration = WB.pollTerminal?.formatElapsed?.(capturedAt - downAt) || '';
        }
      }
      const normalizeHistory = value => {
        let text = String(value || '').replace(/7\s*д(?:ней|ня)?\s*:\s*[×x]?\s*(\d+)/gi, 'событий за 7 дней: $1');
        if (offlineDuration && !/\boffline\b/i.test(text)) {
          text = [`OFFLINE ${offlineDuration}`, offlineSince ? `с ${offlineSince}` : '', text].filter(Boolean).join(' · ');
        }
        return text;
      };
      const selected = [
        ['MAC', find(block => block.family === 'mac_address')],
        ['Линк', find(block => block.family === 'ont_port_state')],
        ['События', historyBlock]
      ];

      const rows = selected
        .filter(([, block]) => block && (block.summary || block.diagnosticNote))
        .map(([name, block]) => {
          const state = block.relation === 'conflict' ? 'conflict' : (block.state || 'neutral');
          return {
            name,
            state,
            signal: ['attention', 'conflict'].includes(state) ? '!' : state === 'normal' ? '✓' : '•',
            value: name === 'События'
              ? normalizeHistory(block.summary || block.diagnosticNote)
              : (block.summary || block.diagnosticNote)
          };
        });
      const has = name => rows.some(row => row.name === name);
      const learnedMac = snapshot?.observedSubscriberMac || snapshot?.learnedMacs?.[0] || '';
      if (!has('MAC') && learnedMac) {
        rows.push({ name: 'MAC', state: 'normal', signal: '✓', value: `MAC ИЗУЧЕН · ${learnedMac}` });
      }
      if (!has('Линк') && snapshot?.linkState) {
        const speed = Number(snapshot.speedMbps);
        const slow = Number.isFinite(speed) && speed > 0 && speed <= 10;
        const linkUp = String(snapshot.linkState).toLowerCase() === 'up';
        const link = [
          `LINK ${String(snapshot.linkState).toUpperCase()}`,
          Number.isFinite(speed) ? `${speed} Мбит/с` : '',
          slow ? 'медленно' : '',
          snapshot.duplex ? `${snapshot.duplex[0].toUpperCase()}${snapshot.duplex.slice(1)}-Duplex` : ''
        ].filter(Boolean).join(' · ');
        rows.push({
          name: 'Линк',
          state: linkUp && !slow ? 'normal' : 'attention',
          signal: linkUp && !slow ? '✓' : '!',
          value: link
        });
      }
      if (!has('События') && snapshot?.historySummary) {
        rows.push({ name: 'События', state: offlineDuration ? 'attention' : 'neutral', signal: offlineDuration ? '!' : '•', value: normalizeHistory(snapshot.historySummary) });
      }
      if (offlineDuration && !rows.some(row => /offline/i.test(String(row.value || '')))) {
        rows.push({
          name: 'ONU offline',
          state: 'attention',
          signal: '!',
          value: `${offlineDuration}${offlineSince ? ` · с ${offlineSince}` : ''}`
        });
      }
      return rows;
    }

    snapshotFact(label, value) {
      return `
        <div class="snapshot-fact">
          <span>${esc(label)}</span>
          <strong class="${value ? '' : 'empty'}">${esc(value || '—')}</strong>
        </div>
      `;
    }

    liveCaseCard(currentCase, context = {}, diagnostic = {}, completed = false) {
      const login = valueOf(currentCase?.identity?.login);
      const contract = valueOf(currentCase?.identity?.contract);
      const identity = contract ? `Договор ${contract}` : (login || currentCase?.id || 'Абонент');
      const juniper = currentCase?.locator?.sourceStatus?.juniper?.details
        || currentCase?.juniper?.details
        || {};
      const session = String(
        currentCase?.locator?.sourceStatus?.juniper?.result
        || currentCase?.juniper?.result
        || juniper?.status
        || ''
      ).toLowerCase();
      const state = session === 'online' ? 'online' : ['offline', 'no_session'].includes(session) ? 'offline' : 'unknown';
      const stateLabel = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Статус не определён';
      const rx = formatRate(juniper?.rxBps);
      const tx = formatRate(juniper?.txBps);
      const speedRaw = String(juniper?.speedRaw || '').trim();
      const captured = juniper?.lastEventTime || juniper?.startTime || currentCase?.juniper?.updatedAt || currentCase?.updatedAt || '';
      return `
        <div class="live-case compact-identity">
          <div class="live-identity-row">
            <div class="live-identity-main">
              <div class="value">${esc(identity)}</div>
              <div class="source">${esc([login, this.contextLabel(context)].filter(Boolean).join(' · '))}</div>
            </div>
            <span class="live-connectivity ${state}"><i></i>${esc(stateLabel)}</span>
          </div>
          ${(rx || tx || speedRaw || captured) ? `<div class="live-traffic-row">
            ${rx ? `<b>↓ ${esc(rx)}</b>` : ''}
            ${tx ? `<b>↑ ${esc(tx)}</b>` : ''}
            ${!rx && !tx && speedRaw ? `<b>↕ ${esc(speedRaw)}</b>` : ''}
            ${captured ? `<time>${esc(captured)}</time>` : ''}
          </div>` : ''}
        </div>
      `;
    }

    evidenceHistory(currentCase) {
      const trail = WB.evidenceNavigator?.trail?.(currentCase) || [];
      if (!trail.length) return '';
      return `
        <div class="section">
          <div class="evidence-history">
            <div class="evidence-history-head"><span>Что уже сделано</span><span>${trail.length}</span></div>
            ${trail.map(item => `
              <div class="evidence-row ${esc(item.level || '')}">
                <span class="check">✓</span>
                <div class="evidence-row-main">
                  <b>${esc(item.label)}</b>
                  <span>${esc(item.status || 'выполнено')}${item.at ? ` · ${esc(formatTime(item.at))}` : ''}</span>
                </div>
                ${item.replay ? `<button class="evidence-replay" data-action="live-replay" data-evidence-key="${esc(item.key)}" title="Показать это место ещё раз" aria-label="Показать ${esc(item.label)} ещё раз">→</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    juniperCard(juniper = null, diagnostic = {}, prefetch = {}) {
      if (!juniper) {
        const status = String(prefetch?.dataStatus || 'missing');
        const reading = status === 'loading' || diagnostic?.locatorAction === 'check_juniper';
        const failed = status === 'error' || status === 'stale';
        return `
          <div class="section">
            <div class="live-fingerprint">
              <div class="fingerprint-head">
                <div class="fingerprint-state">
                  <span class="snapshot-light ${failed ? 'error' : ''}"></span>
                  <strong>${reading ? 'Считываю Juniper…' : failed ? 'Juniper не прочитан' : 'Снимка Juniper пока нет'}</strong>
                </div>
                <small>${failed ? 'можно открыть вручную для проверки' : 'a=252 · только чтение'}</small>
              </div>
            </div>
          </div>
        `;
      }

      const details = juniper.details || {};
      const result = String(juniper.result || details.status || 'unknown');
      const online = result === 'online' || details.status === 'online';
      const offline = result === 'offline' || details.status === 'offline';
      const state = online
        ? 'Online'
        : offline
          ? (details.staleRadius ? 'Нет сессии на BRAS' : 'Offline')
          : result === 'no_session'
            ? 'Нет активной сессии'
            : result === 'error'
              ? 'Ошибка чтения'
              : 'Снимок получен';
      const traffic = details.hasTraffic === true
        ? (details.speedRaw || 'Есть')
        : details.hasTraffic === false
          ? 'Нет сейчас'
          : '—';
      const timeValue = details.lastEventTime || details.startTime || '';
      const timeLabel = details.lastEventTime ? 'Событие' : 'С начала';
      const foot = [
        details.lastEvent || '',
        details.preview ? 'предварительный снимок' : ''
      ].filter(Boolean).join(' · ');
      const cardClass = online ? 'ready' : (offline || result === 'error' ? 'warn' : '');
      const lightClass = online ? 'ready' : (result === 'error' ? 'error' : '');

      return `
        <div class="section">
          <div class="live-fingerprint ${cardClass}">
            <div class="fingerprint-head">
              <div class="fingerprint-state">
                <span class="snapshot-light ${lightClass}"></span>
                <strong>${esc(state)}</strong>
              </div>
              <small>Juniper · только чтение</small>
            </div>
            <div class="fingerprint-facts juniper-essential">
              ${this.snapshotFact('Трафик', traffic)}
              ${this.snapshotFact(timeLabel, timeValue)}
            </div>
            ${foot ? `<div class="fingerprint-foot" title="${esc(foot)}">${esc(foot)}</div>` : ''}
          </div>
        </div>
      `;
    }

    lineSnapshot(currentCase, diagnostic = {}) {
      if (!diagnostic.isEthernet) return '';
      const link = [
        valueOf(currentCase.network?.accessLinkState),
        valueOf(currentCase.network?.accessSpeedMbps)
          ? `${valueOf(currentCase.network?.accessSpeedMbps)} Мбит/с`
          : ''
      ].filter(Boolean).join(' · ');
      const complete = diagnostic.stage === 'ethernet-complete';
      const state = link || (complete ? 'Порт проверен' : 'Нужно проверить порт');
      const facts = [
        valueOf(currentCase.network?.accessDeviceName),
        valueOf(currentCase.network?.accessInterface) || valueOf(currentCase.network?.accessPort),
        valueOf(currentCase.network?.accessVlan) ? `VLAN ${valueOf(currentCase.network?.accessVlan)}` : '',
        valueOf(currentCase.network?.mac)
      ];
      const summary = facts.filter(Boolean).join(' · ') || 'Данные порта ещё не собраны';
      return `
        <div class="section">
          <div class="line-snapshot ${complete ? 'ready' : ''}">
            <div class="label">Линия · Ethernet</div>
            <div class="line-state">${esc(state)}</div>
            <div class="line-facts" title="${esc(summary)}">${esc(summary)}</div>
          </div>
        </div>
      `;
    }

    liveNavHelp(text = '') {
      return text
        ? `<span class="live-nav-help" data-help="${esc(text)}" title="${esc(text)}" aria-label="${esc(text)}" tabindex="0">?</span>`
        : '';
    }

    ponContextCard(currentCase, diagnostic = {}, locator = {}, next = {}) {
      if (diagnostic.isEthernet) return '';
      const termination = locator?.termination || null;
      // A successful live poll is terminal evidence regardless of the order in
      // which the operator reached it. Never offer another "Перейти к опросу ONU"
      // merely because the normal acquisition route was entered afterwards.
      if (hasSuccessfulOnuPoll(currentCase)) return '';
      // Presentation only: once the native request is already running, the
      // pre-request navigation card must disappear instead of competing with
      // the authoritative pending status.
      if (this.pollAttemptPending(currentCase)) return '';

      const missing = Array.isArray(diagnostic.billingMissingTechnical)
        ? diagnostic.billingMissingTechnical
        : [];
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      const flow = currentCase?.workflow?.ponAcquisition || {};
      const savePending = Boolean(flow.tmcWritebackPending || flow.tmcWritebackPendingSave);
      const ready = Boolean(diagnostic.readyForOnuPoll || diagnostic.canAttemptOnuPoll)
        && missing.length === 0
        && !savePending;
      const tmcShown = Boolean(flow.tmcShownAt);
      const acknowledged = Boolean(flow.instructionAcknowledged);
      const writebackVerified = Boolean(flow.technicalWritebackVerified);
      const onTechnical = page.pageKind === 'billing_technical';
      const onUserside = page.pageKind === 'userside_customer';
      const missingText = technicalFieldLabels(missing);
      const locatorRecommendation = currentCase?.locator?.recommendation || {};
      const tmcAvailableFields = [
        valueOf(currentCase?.pon?.tmcOltName) || valueOf(currentCase?.pon?.tmcOltIp) ? 'olt' : '',
        normalizedIdentity(currentCase?.pon?.tmcOnuSerial) ? 'onuSerial' : '',
        normalizedIdentity(currentCase?.pon?.tmcOnuMac) ? 'onuMac' : ''
      ].filter(Boolean);
      const locatorHasConflict = Array.isArray(locatorRecommendation.params?.conflicts)
        && locatorRecommendation.params.conflicts.length > 0;
      const locatorFields = Array.isArray(locatorRecommendation.params?.fields)
        ? locatorRecommendation.params.fields
        : [];
      const tmcWritebackFields = Array.isArray(flow.tmcExpectedFields) && flow.tmcExpectedFields.length
        ? flow.tmcExpectedFields
        : Array.isArray(flow.tmcWritebackFields) && flow.tmcWritebackFields.length
          ? flow.tmcWritebackFields
          : locatorHasConflict && locatorFields.length
            ? locatorFields
            : tmcAvailableFields.length
              ? tmcAvailableFields
              : locatorFields;
      const tmcWritebackRoute = Boolean(
        tmcShown
        && (
          flow.tmcWritebackPending
          || flow.tmcWritebackPendingSave
          || (
            locatorRecommendation.action === 'fill_billing_technical'
            && locatorRecommendation.params?.source === 'tmc'
          )
        )
      );

      // Block B — before the poll page this remains a navigation action.
      // On the poll page itself Workbench no longer duplicates Billing with its
      // own CTA: the native «Запрос OLT» link is the harmonious final action.
      const pollAchieved = Boolean(WB.evidenceNavigator?.achieved?.(currentCase, 'poll'));
      if (!pollAchieved && !savePending && (ready || (diagnostic.technicalVisited && !missing.length && writebackVerified))) {
        if (page.pageKind === 'billing_onu_poll') {
          return `
            <div class="section">
              <div class="live-context-card final-step" data-live-final-step="ask-olt">
                <div class="live-nav-title"><span>Финальный шаг · Запрос OLT</span></div>
                <div class="source">Нажми штатный «Запрос OLT» в строке ONU. Workbench только выделяет нужную ссылку.</div>
              </div>
            </div>
          `;
        }
        return `
          <div class="section">
            <div class="live-context-card ready">
              <div class="live-nav-title"><span>Готово к живому опросу</span>${this.liveNavHelp('OLT и идентификаторы ONU подтверждены. Workbench откроет карточку Billing и подсветит нужную вкладку опроса; сам опрос выполняет оператор.')}</div>
              <div class="actions" style="margin-top:8px"><button class="action primary" data-action="live-open-poll">Перейти к опросу ONU</button></div>
            </div>
          </div>
        `;
      }

      let title = 'Перейти в технические данные';
      let text = 'Проверим поля, от которых зависит точная привязка ONU и выбор штатного типа опроса.';
      let help = 'Технические данные нужны, чтобы проверить OLT и идентификаторы ONU перед живым опросом.';
      let action = 'live-open-technical';
      let actionLabel = 'Перейти в технические данные';
      let tone = '';

      if (tmcWritebackRoute) {
        const fieldsText = technicalFieldLabels(tmcWritebackFields) || missingText || 'данные ONU';
        const hasConflict = Array.isArray(locatorRecommendation.params?.conflicts)
          && locatorRecommendation.params.conflicts.length > 0;
        if (onTechnical) {
          const lastStatus = String(flow.tmcWritebackLastStatus || '');
          const verifiedInForm = Boolean(flow.tmcWritebackVerifiedInForm);
          const failed = Boolean(lastStatus) && !['applied', 'already_present'].includes(lastStatus);
          title = flow.tmcWritebackPendingSave
            ? (verifiedInForm ? 'Данные подставлены ✓' : 'Проверь и сохрани')
            : failed
              ? 'Подстановка не завершена'
              : 'Подставляем данные ТМЦ';
          text = flow.tmcWritebackPendingSave
            ? `Из ТМЦ подставлено: ${technicalFieldLabels(flow.tmcWritebackAppliedFields || tmcWritebackFields) || fieldsText}.${technicalFieldLabels(flow.tmcWritebackMatchedFields || []) ? ` Уже совпадало: ${technicalFieldLabels(flow.tmcWritebackMatchedFields || [])}.` : ''} Проверь значения и нажми штатную кнопку «Сохранить».`
            : failed
              ? `Workbench не смог автоматически сопоставить: ${fieldsText}. Данные ТМЦ сохранены; можно повторить подстановку без нового поиска.`
              : `Подставляем из ТМЦ: ${fieldsText}.`;
          help = flow.tmcWritebackPendingSave
            ? 'Workbench заполняет только поля формы. Сохранение остаётся явным действием оператора.'
            : failed
              ? `Последний статус: ${lastStatus}. Повтор использует тот же подтверждённый TMC-кандидат и не запускает новый маршрут.`
              : 'Workbench заполняет только поля формы. Сохранение остаётся явным действием оператора.';
          action = failed ? 'live-apply-tmc' : '';
          actionLabel = failed ? 'Повторить подстановку' : '';
          tone = flow.tmcWritebackPendingSave ? 'reminder' : 'attention';
        } else {
          const onlyOlt = tmcWritebackFields.length === 1 && tmcWritebackFields[0] === 'olt';
          const expected = locatorRecommendation.params?.expectedTechnical || {
            oltName: valueOf(currentCase?.pon?.tmcOltName),
            oltIp: valueOf(currentCase?.pon?.tmcOltIp),
            onuSerial: valueOf(currentCase?.pon?.tmcOnuSerial),
            onuMac: valueOf(currentCase?.pon?.tmcOnuMac)
          };
          const oltValue = [expected.oltName, expected.oltIp].filter(Boolean).join(' · ');
          title = hasConflict
            ? 'Есть расхождение Billing ↔ ТМЦ'
            : onlyOlt
              ? 'OLT найден в ТМЦ'
              : 'Данные найдены в ТМЦ';
          text = `${hasConflict ? 'Нужно заполнить техданные Billing из ТМЦ. ' : ''}Сначала откроем Billing → Технические данные. Только после загрузки формы Workbench подставит: ${fieldsText}${onlyOlt && oltValue ? ` (${oltValue})` : ''}. Затем проверь значения и нажми штатное «Сохранить».`;
          help = 'Порядок жёсткий: сначала переход в Billing → Технические данные, затем подстановка уже найденных данных ТМЦ. Workbench не сохраняет форму сам и не запускает дополнительный поиск по MAC.';
          action = 'live-apply-tmc';
          actionLabel = flow.tmcWritebackPending
            ? 'Переходим в Billing…'
            : onlyOlt
              ? 'Заполнить OLT'
              : 'Заполнить техданные';
          tone = 'attention';
        }
      } else if (diagnostic.technicalVisited && missing.length) {
        const activeAction = WB.actionLifecycle?.current?.() || null;
        const tmcOneShotActive = Boolean(
          activeAction
          && !WB.actionLifecycle?.isTerminal?.(activeAction)
          && activeAction.semanticTargetId === 'userside.tmc'
          && String(activeAction.caseId || '') === String(currentCase?.id || '')
        );
        if (onUserside && !tmcShown && tmcOneShotActive) {
          title = 'Ищем ТМЦ…';
          text = `В Billing не хватает: ${missingText || 'данных ONU'}. Первый клик уже принят: Workbench сам доведёт эту ActionSession до блока ТМЦ.`;
          help = 'Второй клик не нужен. После полной загрузки карточки Workbench сам найдёт TMC target, проверит Case identity и покажет первый обучающий Focus.';
          action = '';
          actionLabel = '';
          tone = 'attention';
        } else if (onUserside && !tmcShown) {
          title = 'Показать ТМЦ';
          text = `В Billing не хватает: ${missingText || 'данных ONU'}. Это ручной fallback для уже открытой карточки UserSide.`;
          help = 'При нормальном маршруте из Billing отдельного второго клика нет; эта кнопка нужна только если оператор пришёл в UserSide своим ходом.';
          action = 'live-show-tmc';
          actionLabel = 'Показать ТМЦ';
        } else if (tmcShown) {
          // On Technical page: short status only — banner/highlights do the rest.
          if (onTechnical) {
            title = acknowledged ? 'Осталось заполнить' : 'Заполни и сохрани';
            text = missingText || 'недостающие поля';
            help = 'Подсвечены только пустые обязательные поля. «Понятно» снимает крупную подсказку, но не закрывает этап — нужен Save и повторное чтение.';
            action = '';
            actionLabel = '';
            tone = acknowledged ? 'reminder' : 'attention';
          } else if (acknowledged) {
            title = 'Осталось заполнить';
            text = missingText || 'недостающие поля';
            help = 'Подсказка уже была показана. Заполните оставшиеся поля и сохраните.';
            action = 'live-return-technical';
            actionLabel = 'Вернуться в технические данные';
            tone = 'reminder';
          } else {
            title = 'Обновить технические данные';
            text = `ТМЦ: ${missingText || 'данные'}. Вернись в Billing и сохрани.`;
            help = 'После Save Workbench перечитает Billing. «Понятно» только снимает навязчивую подсказку.';
            action = 'live-return-technical';
            actionLabel = 'Обновить технические данные';
            tone = 'attention';
          }
        } else {
          title = 'Перейти в ТМЦ';
          text = `Не хватает: ${missingText || 'данных ONU'}. Следующий источник — ТМЦ текущего абонента.`;
          help = 'Один клик запускает единую ActionSession: Workbench откроет текущего абонента UserSide, дождётся карточки, сам найдёт TMC target и покажет его. Второй клик не нужен.';
          action = 'live-go-tmc';
          actionLabel = 'Перейти в ТМЦ';
          tone = 'attention';
        }
      } else if (diagnostic.technicalVisited && !missing.length) {
        return '';
      }

      return `
        <div class="section">
          <div class="live-context-card ${tone}">
            <div class="live-nav-title"><span>${esc(title)}</span>${this.liveNavHelp(help)}</div>
            ${text ? `<div class="source">${esc(text)}</div>` : ''}
            ${action ? `<div class="actions" style="margin-top:8px"><button class="action primary" data-action="${esc(action)}">${esc(actionLabel)}</button></div>` : ''}
          </div>
        </div>
      `;
    }

    clearPonPageHints() {
      document.querySelectorAll?.('[data-simnet-live-missing-field]').forEach(el => {
        el.removeAttribute('data-simnet-live-missing-field');
        el.classList.remove('simnet-live-missing-field', 'simnet-live-missing-attention', 'simnet-live-missing-reminder');
      });
      document.querySelectorAll?.('.simnet-live-field-help').forEach(node => node.remove());
      document.getElementById('simnet-live-writeback-banner')?.remove();
    }

    ensurePonPageHintStyles() {
      if (document.getElementById('simnet-live-page-hint-style')) return;
      const style = document.createElement('style');
      style.id = 'simnet-live-page-hint-style';
      style.textContent = `
        /* Highlight only the control (input/select), not the whole table row. */
        .simnet-live-missing-field,
        input.simnet-live-missing-field,
        select.simnet-live-missing-field,
        textarea.simnet-live-missing-field {
          background:rgba(255,247,237,.85)!important;
          outline:1.5px solid rgba(247,144,9,.5)!important;
          outline-offset:1px!important;
          border-color:#f0b44c!important;
          border-radius:4px!important;
          box-shadow:0 0 0 2px rgba(247,144,9,.1)!important;
        }
        .simnet-live-missing-attention,
        input.simnet-live-missing-attention,
        select.simnet-live-missing-attention,
        textarea.simnet-live-missing-attention {
          background:rgba(255,237,213,.95)!important;
          outline:2px solid rgba(247,144,9,.65)!important;
          outline-offset:1px!important;
          border-color:#f59e0b!important;
          box-shadow:0 0 0 3px rgba(247,144,9,.14)!important;
        }
        .simnet-live-missing-reminder,
        input.simnet-live-missing-reminder,
        select.simnet-live-missing-reminder,
        textarea.simnet-live-missing-reminder {
          background:rgba(255,247,237,.7)!important;
          outline:1px solid rgba(247,144,9,.4)!important;
          outline-offset:1px!important;
          border-color:#f0b44c!important;
          box-shadow:none!important;
        }
        .simnet-live-field-help { position:relative!important;display:inline-grid!important;place-items:center!important;width:18px!important;height:18px!important;margin-left:7px!important;border:1px solid rgba(165,0,70,.28)!important;border-radius:50%!important;background:#fff!important;color:#7A123D!important;font:700 11px/1 Arial,sans-serif!important;cursor:help!important;vertical-align:middle!important;opacity:.72!important;outline:none!important;transition:opacity .14s ease,border-color .14s ease,box-shadow .14s ease!important; }
        .simnet-live-field-help:hover,.simnet-live-field-help:focus-visible { opacity:1!important;border-color:rgba(165,0,70,.62)!important;box-shadow:0 0 0 3px rgba(165,0,70,.08)!important; }
        html.simnet-wb-guide-active .simnet-live-field-help { z-index:2147483645!important;opacity:1!important;background:#FFF5F8!important;border-color:rgba(165,0,70,.72)!important;box-shadow:0 0 0 4px rgba(165,0,70,.12)!important; }
        .simnet-live-field-help:after { content:attr(data-simnet-help);position:absolute!important;left:calc(100% + 8px)!important;top:50%!important;width:270px!important;max-width:min(270px,60vw)!important;padding:8px 10px!important;border:1px solid #E4E7EC!important;border-radius:9px!important;background:#fff!important;color:#344054!important;box-shadow:0 10px 28px rgba(16,24,40,.18)!important;font:500 11px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;text-align:left!important;white-space:normal!important;opacity:0!important;visibility:hidden!important;transform:translateY(-50%) translateX(-4px)!important;transition:opacity .12s ease,transform .12s ease,visibility .12s ease!important;pointer-events:none!important;z-index:2!important; }
        .simnet-live-field-help:hover:after,.simnet-live-field-help:focus-visible:after { opacity:1!important;visibility:visible!important;transform:translateY(-50%) translateX(0)!important; }
        @keyframes simnet-wb-native-save-pulse {
          0%,100% { outline-color:#A50046; box-shadow:0 0 0 4px rgba(165,0,70,.10),0 0 0 0 rgba(165,0,70,.28); }
          50% { outline-color:#C00052; box-shadow:0 0 0 5px rgba(165,0,70,.16),0 0 0 9px rgba(165,0,70,.06); }
        }
        .simnet-wb-native-save-attention { outline:3px solid #A50046!important;outline-offset:3px!important;box-shadow:0 0 0 5px rgba(165,0,70,.12)!important;border-radius:4px!important;animation:simnet-wb-native-save-pulse 1.05s ease-in-out infinite!important; }
        @media (prefers-reduced-motion:reduce) { .simnet-wb-native-save-attention { animation:none!important; } }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    syncPonWritebackBanner() {
      // Large in-table prompt was intentionally removed. Billing tables must keep
      // their native geometry; the target control + compact help marker are enough.
      document.getElementById('simnet-live-writeback-banner')?.remove();
    }

    syncNativeSaveAttention(currentCase = this.activeCase()) {
      document.querySelectorAll?.('.simnet-wb-native-save-attention').forEach(node => node.classList.remove('simnet-wb-native-save-attention'));
      const flow = currentCase?.workflow?.ponAcquisition || {};
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      if (
        page.pageKind !== 'billing_technical'
        || !flow.tmcWritebackPendingSave
        || !flow.tmcWritebackVerifiedInForm
        || !Array.isArray(flow.tmcWritebackAppliedFields)
        || flow.tmcWritebackAppliedFields.length === 0
        || flow.tmcWritebackPromptDismissedAt
      ) return;
      const save = WB.guide?.resolvers?.findSaveButton?.() || null;
      if (!(save instanceof Element)) return;
      this.ensurePonPageHintStyles();
      save.classList.add('simnet-wb-native-save-attention');
    }

    scheduleNativeSaveGatePrompt(currentCase = this.activeCase()) {
      const flow = currentCase?.workflow?.ponAcquisition || {};
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      const eligible = Boolean(
        currentCase?.id
        && page.pageKind === 'billing_technical'
        && flow.tmcWritebackPendingSave
        && flow.tmcWritebackVerifiedInForm
        && Array.isArray(flow.tmcWritebackAppliedFields)
        && flow.tmcWritebackAppliedFields.length > 0
        && !flow.tmcWritebackPromptDismissedAt
      );
      if (!eligible) {
        if (!flow.tmcWritebackPendingSave) this.saveGatePromptKey = '';
        return false;
      }
      const key = [
        currentCase.id,
        flow.tmcWritebackRequestedAt || '',
        flow.tmcWritebackAppliedAt || '',
        (flow.tmcWritebackAppliedFields || []).join('+')
      ].join('|');
      if (this.saveGatePromptKey === key) return false;
      this.saveGatePromptKey = key;

      window.setTimeout(async () => {
        const freshCase = this.activeCase();
        const freshFlow = freshCase?.workflow?.ponAcquisition || {};
        const freshPage = WB.runtime.lastContext || freshCase?.currentContext || {};
        if (
          !freshCase?.id
          || String(freshCase.id) !== String(currentCase.id)
          || freshPage.pageKind !== 'billing_technical'
          || !freshFlow.tmcWritebackPendingSave
          || !freshFlow.tmcWritebackVerifiedInForm
          || !Array.isArray(freshFlow.tmcWritebackAppliedFields)
          || freshFlow.tmcWritebackAppliedFields.length === 0
          || freshFlow.tmcWritebackPromptDismissedAt
        ) return;

        this.syncNativeSaveAttention(freshCase);
        const currentPlan = WB.guide?.plan?.(freshCase) || null;
        if (!['billing.save-technical-fields', 'billing.save-olt'].includes(String(currentPlan?.id || ''))) {
          // The save gate is authoritative. If another recommendation appears
          // while native changes are still unsaved, expose the inconsistency.
          void WB.observability?.report?.({
            severity: 'ERROR',
            code: 'POLL_READY_BEFORE_TECHNICAL_SAVE',
            operationType: 'GUIDE_ACTION',
            source: 'rail',
            stage: 'SAVE_GATE',
            message: 'Guide попытался уйти с несохранённых техданных до native Save',
            details: { planId: currentPlan?.id || '', caseId: freshCase.id || '' }
          });
          this.saveGatePromptKey = '';
          return;
        }
        const result = await WB.guide?.highlight?.(freshCase);
        if (!result?.ok) this.saveGatePromptKey = '';
      }, 90);
      return true;
    }

    async acknowledgeWritebackInstruction(currentCase) {
      try {
        await WB.store.patchWorkflow?.('ponAcquisition', {
          instructionAcknowledged: true,
          instructionAcknowledgedAt: new Date().toISOString()
        });
      } catch (_) {
        // Best-effort: UI still softens locally if the message fails.
      }
      const flow = currentCase?.workflow?.ponAcquisition || {};
      flow.instructionAcknowledged = true;
      flow.instructionAcknowledgedAt = flow.instructionAcknowledgedAt || new Date().toISOString();
      // Acknowledgement only dismisses the strong prompt — never marks writeback verified.
      document.getElementById('simnet-live-writeback-banner')?.remove();
      this.syncPonTechnicalFieldHints();
      this.render?.();
    }

    syncPonTechnicalFieldHints() {
      const currentCase = this.activeCase();
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      const diagnostic = currentCase?.diagnostic || {};
      const flow = currentCase?.workflow?.ponAcquisition || {};
      const onPendingPonTechnical = Boolean(
        currentCase
        && diagnostic.isPon
        && page.pageKind === 'billing_technical'
        && currentCase?.locator?.termination?.status !== 'confirmed'
      );
      const missing = onPendingPonTechnical && Array.isArray(diagnostic.billingMissingTechnical)
        ? diagnostic.billingMissingTechnical
        : [];
      const needed = new Set(missing);
      const acknowledged = Boolean(flow.instructionAcknowledged);
      const tmcShown = Boolean(flow.tmcShownAt);
      // Native Technical controls must not glow merely because the operator is
      // browsing the page. Field emphasis is reserved for the explicit TMC →
      // Billing writeback operation and disappears when that operation ends.
      const instructionWindow = Boolean(flow.tmcWritebackPending || flow.tmcWritebackPendingSave);
      const attentionMode = instructionWindow && !acknowledged && missing.length > 0;
      const modeClass = attentionMode ? 'simnet-live-missing-attention' : 'simnet-live-missing-reminder';

      // Highlight the input/select only — never the whole Technical row.
      // Idempotent markers avoid render → mutation → rescan loops.
      document.querySelectorAll?.('[data-simnet-live-missing-field]').forEach(el => {
        const field = String(el.dataset?.simnetLiveMissingField || '');
        if (needed.has(field)) return;
        el.removeAttribute('data-simnet-live-missing-field');
        el.classList.remove('simnet-live-missing-field', 'simnet-live-missing-attention', 'simnet-live-missing-reminder');
      });
      document.querySelectorAll?.('.simnet-live-field-help').forEach(node => {
        const field = String(node.dataset?.simnetLiveField || '');
        if (needed.has(field)) return;
        node.remove();
      });

      if (onPendingPonTechnical && tmcShown && missing.length && flow.tmcWritebackPending && !flow.tmcWritebackPendingSave) {
        void this.maybeAutoPrefillMissingTmcTechnical(currentCase, diagnostic, missing);
      }
      this.syncPonWritebackBanner();
      this.syncNativeSaveAttention(currentCase);
      this.scheduleNativeSaveGatePrompt(currentCase);

      if (!missing.length || !instructionWindow) {
        document.querySelectorAll?.('[data-simnet-live-missing-field]').forEach(el => {
          el.removeAttribute('data-simnet-live-missing-field');
          el.classList.remove('simnet-live-missing-field', 'simnet-live-missing-attention', 'simnet-live-missing-reminder');
        });
        document.querySelectorAll?.('.simnet-live-field-help').forEach(node => node.remove());
        if (!instructionWindow) document.getElementById('simnet-live-writeback-banner')?.remove();
        return;
      }
      this.ensurePonPageHintStyles();
      const hints = {
        olt: 'OLT нужна для точной привязки и определения правильного типа штатного опроса. Если поле пустое — сверяем ТМЦ.',
        onuSerial: 'Serial ONU/ONT нужен для полной идентификации оборудования при штатном опросе.',
        onuMac: 'MAC ONU нужен для привязки оборудования и штатного живого опроса.'
      };
      for (const field of missing) {
        const control = WB.guide?.resolvers?.technicalControl?.(field)
          || (() => {
            const row = WB.guide?.resolvers?.technicalRow?.(field);
            return row?.querySelector?.('select, input, textarea') || null;
          })();
        if (!(control instanceof Element)) continue;

        document.querySelectorAll?.(`[data-simnet-live-missing-field="${field}"]`).forEach(existing => {
          if (existing === control) return;
          existing.removeAttribute('data-simnet-live-missing-field');
          existing.classList.remove('simnet-live-missing-field', 'simnet-live-missing-attention', 'simnet-live-missing-reminder');
        });

        if (control.dataset.simnetLiveMissingField !== field) control.dataset.simnetLiveMissingField = field;
        control.classList.add('simnet-live-missing-field');
        control.classList.toggle('simnet-live-missing-attention', attentionMode);
        control.classList.toggle('simnet-live-missing-reminder', !attentionMode);

        const cell = control.closest?.('td,th') || control.parentElement || control;
        const visualControl = field === 'olt'
          ? cell.querySelector?.('.selectize-control') || control
          : control;
        let help = cell.querySelector?.(`.simnet-live-field-help[data-simnet-live-field="${field}"]`) || null;
        if (!help) {
          help = document.createElement('span');
          help.className = 'simnet-live-field-help';
          help.dataset.simnetWbOwned = '1';
          help.dataset.simnetLiveField = field;
          help.textContent = '?';
          help.tabIndex = 0;
        }
        const helpText = hints[field] || 'Это поле нужно для живого опроса ONU.';
        help.dataset.simnetHelp = helpText;
        help.title = helpText;
        help.setAttribute('aria-label', helpText);
        // Billing OLT uses Selectize: the native <select> is hidden before the
        // visible wrapper. Anchor after that wrapper so "?" stays on the right.
        if (visualControl.nextElementSibling !== help) {
          visualControl.insertAdjacentElement('afterend', help);
        }
      }
    }

    async withLiveNavigation(task) {
      if (this.liveNavInFlight) return { ok: false, reason: 'live-navigation-busy' };
      this.liveNavInFlight = true;
      try {
        return await task();
      } catch (error) {
        return this.handleLiveActionError(error);
      } finally {
        this.liveNavInFlight = false;
      }
    }

    handleLiveActionError(error) {
      const invalidated = error?.code === 'EXTENSION_CONTEXT_INVALIDATED'
        || /Extension context invalidated|Расширение было перезагружено/i.test(String(error?.message || error));
      if (invalidated) {
        this.toast('Расширение обновлено — обнови эту страницу. Прогресс Case сохранён.');
        return { ok: false, reason: 'extension-context-invalidated' };
      }
      console.warn('[SIMNET Workbench LIVE] action failed', error);
      void WB.observability?.report?.({
        severity: 'ERROR',
        code: 'LIVE_ACTION_FAILED',
        operationType: 'LIVE_ACTION',
        source: 'rail',
        stage: 'ACTION',
        message: String(error?.message || error || 'LIVE action failed'),
        error
      });
      this.toast('Действие не выполнено. Подробности в консоли.');
      return { ok: false, reason: 'live-action-failed', error: String(error?.message || error) };
    }

    notifyExtensionContextInvalidated() {
      this.toast('Расширение было перезагружено. Обнови страницу Billing/UserSide; Case не сбрасывается.');
    }

    actionDestinationForMilestone(key, currentCase = this.activeCase()) {
      const billingId = String(valueOf(currentCase?.identity?.billingId) || '');
      const customerId = String(valueOf(currentCase?.identity?.customerId) || '');
      if (key === 'technical') return { semanticTargetId: 'billing.technical', destinationSystem: 'billing', destinationPageKind: 'billing_technical', destinationEntityId: billingId };
      if (key === 'tmc') return { semanticTargetId: 'userside.tmc', destinationSystem: 'userside', destinationPageKind: 'userside_customer', destinationEntityId: customerId };
      if (key === 'poll') return { semanticTargetId: 'billing.poll.entry', destinationSystem: 'billing', destinationPageKind: 'billing_user', destinationEntityId: billingId };
      if (key === 'juniper') return { semanticTargetId: 'billing.juniper', destinationSystem: 'billing', destinationPageKind: 'billing_juniper', destinationEntityId: billingId };
      return { semanticTargetId: `live.${key || 'unknown'}`, destinationSystem: '', destinationPageKind: '', destinationEntityId: '' };
    }

    startGuidedLifecycle(key, options = {}) {
      const currentCase = this.activeCase();
      if (!currentCase?.id || !WB.actionLifecycle) return null;
      const destination = this.actionDestinationForMilestone(key, currentCase);
      const started = WB.actionLifecycle.start({
        operationType: options.operationType || (options.replayOnly ? 'DIRECT_REPLAY' : 'GUIDE_NAVIGATION'),
        intent: options.replayOnly ? 'DIRECT_REPLAY' : 'GUIDED_NAVIGATION',
        navigationCapable: options.navigationCapable !== false,
        caseId: currentCase.id,
        ...destination,
        expectedPostCondition: options.expectedPostCondition || (options.replayOnly
          ? `${destination.semanticTargetId} достигнут и destination identity подтверждена`
          : `${destination.semanticTargetId} достигнут, target/evidence подтверждены и Focus показан`),
        sourceAction: options.sourceAction || (options.replayOnly ? 'live-history-replay' : 'live-one-shot-cta'),
        title: options.title || '',
        text: options.text || '',
        replayOnly: Boolean(options.replayOnly),
        planId: options.planId || `live.${options.replayOnly ? 'replay' : 'guide'}.${key}`,
        targetTimeoutMs: options.targetTimeoutMs || 12000
      });
      return started?.session || null;
    }

    async followOneShotRecommendation(key, fallback) {
      const currentCase = this.activeCase();
      if (!currentCase) return { ok: false, reason: 'case-missing' };

      const plan = this.nextStep(currentCase);
      const milestone = WB.evidenceNavigator?.planMilestoneKey?.(plan) || '';
      const allowed = WB.evidenceNavigator?.recommendationAllowed?.(currentCase, plan) !== false;
      if (!allowed || milestone !== key) {
        return typeof fallback === 'function'
          ? fallback()
          : { ok: false, reason: 'recommendation-unavailable' };
      }

      const destination = this.actionDestinationForMilestone(key, currentCase);
      const session = this.startGuidedLifecycle(key, {
        operationType: 'GUIDE_NAVIGATION',
        sourceAction: 'live-one-shot-cta',
        title: plan?.title || '',
        text: plan?.text || '',
        planId: plan?.id || `live.guide.${key}`
      });
      if (!session) return { ok: false, reason: 'action-session-unavailable' };

      this.activeView = null;
      this.hoverOpen = false;
      this.render();

      const page = WB.runtime.lastContext || currentCase.currentContext || {};
      if (WB.actionLifecycle?.destinationMatches?.(session, page)) {
        return WB.guide?.continueActiveActionSession?.(currentCase) || { ok: false, reason: 'guide-unavailable' };
      }

      WB.actionLifecycle?.navigationStarted?.(session, { actualResult: destination.destinationPageKind || destination.destinationSystem || '' });
      await WB.actionLifecycle?.flushPersistence?.();
      let result = null;
      if (key === 'technical') result = await this.openTechnicalDirect();
      else if (key === 'tmc') result = await this.openTmcSourceDirect();
      else if (key === 'poll') result = await this.navigateToBillingCardForAction(currentCase);
      else if (key === 'juniper' && WB.guide?.runNext) result = await WB.guide.runNext(currentCase);
      else if (WB.guide?.runNext) result = await WB.guide.runNext(currentCase);
      else result = typeof fallback === 'function' ? await fallback() : { ok: false, reason: 'navigation-unavailable' };

      if (!result?.ok && !['destination-not-reached', 'target-not-ready'].includes(result?.reason || '')) {
        WB.actionLifecycle?.fail?.(session, result?.reason || 'navigation-failed', {
          code: 'ACTION_NAVIGATION_FAILED',
          message: `Не удалось начать переход к ${destination.semanticTargetId}`,
          actualResult: result?.reason || ''
        });
      }
      return result;
    }

    async maybeContinueOneShotFocus() {
      const currentCase = this.activeCase();
      const session = WB.actionLifecycle?.syncFromCase?.(currentCase) || WB.actionLifecycle?.current?.();
      if (!currentCase || !session || WB.actionLifecycle?.isTerminal?.(session)) return { ok: false, reason: 'no-one-shot-focus' };
      if (String(session.caseId || '') !== String(currentCase.id || '')) return { ok: false, reason: 'foreign-action-session' };
      return WB.guide?.continueActiveActionSession?.(currentCase) || { ok: false, reason: 'guide-unavailable' };
    }

    async openTechnicalDirect() {
      this.collapseForNavigation();
      return this.withLiveNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        // Prefer native in-page link only when already on authenticated Billing
        const session = WB.billingNavigation?.resolveSession?.();
        if (session?.ok) {
          const anchor = WB.guide?.resolvers?.findTechnicalDataLink?.(currentCase);
          if (anchor?.href) {
            try {
              const href = new URL(anchor.href, location.href);
              if (!href.searchParams.get('pp') && session._pp) {
                // Do not follow native link that lost pp — use gateway
              } else {
                anchor.click();
                return { ok: true, method: 'native-link' };
              }
            } catch {
              anchor.click();
              return { ok: true, method: 'native-link' };
            }
          }
        }
        if (WB.billingNavigation?.navigate) {
          const result = await WB.billingNavigation.navigate({
            caseId: currentCase.id,
            semanticTargetId: 'billing.technical',
            entityId: String(valueOf(currentCase?.identity?.billingId) || ''),
            intent: 'DIRECT_REPLAY',
            sourceAction: 'open-technical-direct'
          });
          if (!result?.ok) {
            this.toast(result?.code === 'BILLING_SESSION_NOT_CONFIRMED'
              ? 'Нет подтверждённой сессии Billing — открой карточку абонента вручную'
              : 'Не удалось открыть технические данные');
            return { ok: false, reason: result?.reason || 'navigation-rejected', code: result?.code };
          }
          return result;
        }
        this.toast('Центральный Billing Navigation Service недоступен — переход остановлен');
        return { ok: false, reason: 'billing-navigation-unavailable' };
      });
    }

    ensureTmcNavigationSession(currentCase = this.activeCase(), options = {}) {
      if (!currentCase?.id || !WB.actionLifecycle) return null;
      let current = WB.actionLifecycle.syncFromCase?.(currentCase) || WB.actionLifecycle.current?.() || null;
      if (
        current
        && !WB.actionLifecycle.isTerminal?.(current)
        && String(current.caseId || '') === String(currentCase.id)
        && String(current.semanticTargetId || '') === 'userside.tmc'
      ) {
        return current;
      }

      // The operator explicitly asked for TMC. A stale same-Case Guide action
      // must not own the navigation lock and silently downgrade this command to
      // "just focus/open UserSide". A live native OLT request is the only action
      // we intentionally do not supersede here.
      if (current && !WB.actionLifecycle.isTerminal?.(current) && String(current.caseId || '') === String(currentCase.id)) {
        if (String(current.semanticTargetId || '') === 'billing.olt.request') return null;
        WB.actionLifecycle.interrupt?.(current, 'ACTION_SUPERSEDED_BY_OPERATOR', { actualResult: 'userside.tmc' });
        current = null;
      }

      return this.startGuidedLifecycle('tmc', {
        operationType: 'GUIDE_NAVIGATION',
        sourceAction: String(options.sourceAction || 'open-tmc-direct'),
        title: String(options.title || 'ТМЦ'),
        text: String(options.text || 'Перейти к блоку ТМЦ текущего абонента.'),
        planId: String(options.planId || 'userside.find-tmc')
      });
    }

    async openTmcSourceDirect() {
      this.collapseForNavigation();
      return this.withLiveNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };

        // Never perform a bare Billing -> UserSide jump. The semantic TMC
        // ActionSession is the transaction command that has to survive the
        // tab/document boundary and finish at the native TMC block.
        const session = this.ensureTmcNavigationSession(currentCase, {
          sourceAction: 'open-tmc-direct'
        });
        if (!session) {
          this.toast('Переход к ТМЦ остановлен: активное действие не позволяет начать новый маршрут');
          return { ok: false, reason: 'tmc-action-session-unavailable' };
        }
        if (session.status === 'REQUESTED') {
          WB.actionLifecycle.navigationStarted?.(session, { actualResult: 'userside_customer' });
        }
        await WB.actionLifecycle.flushPersistence?.();

        const result = await WB.handoff?.openUsersideForCase?.(currentCase);
        if (!result?.ok) {
          WB.actionLifecycle.fail?.(session, result?.reason || 'handoff-unavailable', {
            code: 'TMC_HANDOFF_NAVIGATION_FAILED',
            message: 'Не удалось перенести TMC ActionSession в UserSide',
            actualResult: result?.reason || ''
          });
          this.toast('Не удалось открыть UserSide для текущего абонента');
        }
        return result || { ok: false, reason: 'handoff-unavailable' };
      });
    }

    async navigateToBillingCardForAction(currentCase = this.activeCase(), semanticTargetId = 'billing.user') {
      if (!currentCase) return { ok: false, reason: 'case-missing' };
      const page = WB.runtime.lastContext || currentCase.currentContext || {};
      const target = semanticTargetId || 'billing.user';
      if (page.pageKind === 'billing_user' && target === 'billing.user') {
        return WB.guide?.continueActiveActionSession?.(currentCase) || { ok: true, method: 'already-billing-card' };
      }
      if (page.pageKind === 'billing_juniper' && target === 'billing.juniper') {
        return { ok: true, method: 'already-juniper' };
      }
      if (WB.billingNavigation?.navigate) {
        const result = await WB.billingNavigation.navigate({
          caseId: currentCase.id,
          semanticTargetId: target,
          entityId: String(valueOf(currentCase?.identity?.billingId) || ''),
          intent: 'DIRECT_REPLAY',
          sourceAction: 'navigate-billing-card'
        });
        if (!result?.ok) {
          return { ok: false, reason: result?.reason || 'navigation-rejected', code: result?.code };
        }
        return result;
      }
      return { ok: false, reason: 'billing-navigation-unavailable' };
    }

    async showTmcBlock() {
      this.collapseForNavigation();
      try {
        if (this.guideActive) WB.guide?.clear?.('USER_INTERRUPTED');
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const session = this.startGuidedLifecycle('tmc', {
          operationType: 'GUIDE_HIGHLIGHT',
          sourceAction: 'live-show-tmc',
          title: 'ТМЦ',
          text: 'Показать найденные данные ТМЦ текущего Case.',
          planId: 'userside.find-tmc'
        });
        if (!session) return { ok: false, reason: 'action-session-unavailable' };
        const result = await WB.guide?.continueActiveActionSession?.(currentCase);
        if (result?.ok && result?.tmcTeleportConfirmed) {
          this.toast('ТМЦ показана');
        } else if (result?.ok) {
          this.toast('ТМЦ найдена, но обязательная подсветка полей не подтверждена');
        } else {
          this.toast('Блок ТМЦ ещё не найден на странице');
        }
        return result || { ok: false, reason: 'tmc-reveal-unavailable' };
      } catch (error) {
        return this.handleLiveActionError(error);
      }
    }

    async maybeAutoPrefillMissingTmcTechnical(currentCase, diagnostic, missing = []) {
      const flow = currentCase?.workflow?.ponAcquisition || {};
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      if (
        !currentCase
        || !diagnostic?.isPon
        || page.pageKind !== 'billing_technical'
        || !flow.tmcShownAt
        || flow.tmcWritebackPending
        || flow.tmcWritebackPendingSave
        || flow.technicalWritebackVerified
        || this.tmcWritebackInFlight
      ) return { ok: false, reason: 'tmc-auto-prefill-not-eligible' };

      const tmcExpectation = tmcTechnicalExpectation(currentCase);
      const expected = tmcExpectation.expected;
      // The TMC transaction scope is dynamic: only values that TMC actually has.
      // `missing` is intentionally not used to manufacture obligations. Existing
      // matching Billing values count as matched; empty ones may be filled; a
      // field absent in TMC is outside this transaction entirely.
      const fields = tmcExpectation.fields;
      if (!fields.length) return { ok: false, reason: 'tmc-auto-prefill-values-missing' };

      const key = [
        currentCase.id || '',
        flow.tmcShownAt || '',
        ...fields,
        expected.oltName,
        expected.oltIp,
        expected.onuSerial,
        expected.onuMac
      ].join('|');
      if (this.tmcAutoPrefillKey === key) return { ok: false, reason: 'tmc-auto-prefill-already-attempted' };
      this.tmcAutoPrefillKey = key;
      this.tmcWritebackInFlight = true;

      try {
        const apply = WB.guide?.resolvers?.applyMissingTmcTechnicalValues;
        if (typeof apply !== 'function') return { ok: false, reason: 'tmc-auto-prefill-resolver-missing' };
        const result = apply(currentCase, fields) || { ok: false, status: 'unavailable', completed: [], unresolved: [] };

        if (result.status === 'not_ready' && this.tmcAutoPrefillRetryCount < 10) {
          this.tmcAutoPrefillRetryCount += 1;
          this.tmcAutoPrefillKey = '';
          window.setTimeout(() => {
            void this.maybeAutoPrefillMissingTmcTechnical(currentCase, diagnostic, missing);
          }, 200);
          return { ok: false, reason: 'technical-controls-not-ready', retry: true };
        }
        this.tmcAutoPrefillRetryCount = 0;

        const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
        const conflictFields = unresolved
          .filter(item => item?.status === 'conflict')
          .map(item => item.field)
          .filter(field => fields.includes(field));

        if (result.status === 'already_present') {
          const matchedFields = Array.isArray(result.skippedExisting) && result.skippedExisting.length
            ? result.skippedExisting
            : fields;
          const at = new Date().toISOString();
          await WB.store.patchWorkflow?.('ponAcquisition', {
            tmcExpectedFields: fields,
            tmcWritebackPending: false,
            tmcWritebackPendingSave: false,
            tmcWritebackVerifiedInForm: true,
            tmcWritebackVerifiedInFormAt: at,
            tmcWritebackAppliedFields: [],
            tmcWritebackMatchedFields: matchedFields,
            tmcWritebackConflictFields: [],
            tmcWritebackSavedAt: '',
            tmcWritebackFields: fields,
            expectedTechnicalWriteback: null,
            instructionAcknowledged: true,
            technicalWritebackVerified: true,
            tmcWritebackLastStatus: 'already_present',
            tmcWritebackLastAt: at
          });
          Object.assign(flow, {
            tmcExpectedFields: fields,
            tmcWritebackPending: false,
            tmcWritebackPendingSave: false,
            tmcWritebackVerifiedInForm: true,
            tmcWritebackVerifiedInFormAt: at,
            tmcWritebackAppliedFields: [],
            tmcWritebackMatchedFields: matchedFields,
            tmcWritebackConflictFields: [],
            tmcWritebackSavedAt: '',
            tmcWritebackFields: fields,
            expectedTechnicalWriteback: null,
            instructionAcknowledged: true,
            technicalWritebackVerified: true,
            tmcWritebackLastStatus: 'already_present',
            tmcWritebackLastAt: at
          });
          window.setTimeout(() => WB.runtime.forceScan?.('tmc-auto-prefill-already-present'), 0);
          this.render?.();
          return { ok: true, reason: 'already-present', result };
        }

        if (!result.ok) {
          const failedAt = new Date().toISOString();
          await WB.store.patchWorkflow?.('ponAcquisition', {
            tmcExpectedFields: fields,
            tmcWritebackConflictFields: conflictFields,
            expectedTechnicalWriteback: expected,
            technicalWritebackVerified: false,
            tmcWritebackLastStatus: result.status || 'failed',
            tmcWritebackLastAt: failedAt
          });
          flow.tmcExpectedFields = fields;
          flow.tmcWritebackConflictFields = conflictFields;
          flow.expectedTechnicalWriteback = expected;
          flow.technicalWritebackVerified = false;
          void WB.observability?.report?.({
            severity: 'WARNING',
            code: 'TMC_AUTO_WRITEBACK_FAILED',
            operationType: 'TMC_WRITEBACK',
            source: 'rail',
            stage: 'APPLY_FIELDS',
            message: 'Автоподстановка данных ТМЦ не завершилась',
            expected,
            actual: result,
            details: { fields, status: result.status || 'failed', conflictFields }
          });
          return { ok: false, reason: result.status || 'tmc-auto-prefill-failed', result };
        }

        const completed = Array.isArray(result.completed) ? result.completed : [];
        const matchedFields = Array.isArray(result.skippedExisting) ? result.skippedExisting : [];
        const accountedFields = new Set([...completed, ...matchedFields]);
        const verifiedInForm = Boolean(
          result.ok
          && unresolved.length === 0
          && fields.every(field => accountedFields.has(field))
        );
        const requestedAt = new Date().toISOString();
        const appliedAt = requestedAt;
        const expectedWriteback = result.expected || expected;
        const patch = {
          tmcExpectedFields: fields,
          tmcWritebackPending: false,
          tmcWritebackPendingSave: verifiedInForm && completed.length > 0,
          tmcWritebackRequestedAt: requestedAt,
          tmcWritebackAppliedAt: result.ok ? appliedAt : '',
          tmcWritebackVerifiedInForm: verifiedInForm,
          tmcWritebackVerifiedInFormAt: verifiedInForm ? appliedAt : '',
          tmcWritebackAppliedFields: result.ok ? completed : [],
          tmcWritebackMatchedFields: matchedFields,
          tmcWritebackConflictFields: conflictFields,
          tmcWritebackSavedAt: '',
          tmcWritebackFields: fields,
          expectedTechnicalWriteback: expectedWriteback,
          instructionAcknowledged: true,
          technicalWritebackVerified: false,
          tmcWritebackDeclinedAt: '',
          tmcWritebackDeclineReason: '',
          tmcWritebackPromptDismissedAt: '',
          tmcWritebackPromptDismissReason: ''
        };
        await WB.store.patchWorkflow?.('ponAcquisition', patch);
        Object.assign(flow, patch);

        if (!verifiedInForm) {
          const unresolvedLabels = unresolved.map(item => technicalFieldLabels([item.field])).filter(Boolean);
          void WB.observability?.report?.({
            severity: 'WARNING',
            code: 'TMC_WRITEBACK_PARTIAL',
            operationType: 'TMC_WRITEBACK',
            source: 'rail',
            stage: 'VERIFY_FIELDS',
            message: 'Часть ожидаемых полей ТМЦ не подтверждена в форме Billing',
            expected: expectedWriteback,
            actual: result,
            details: { expectedFields: fields, unresolved: unresolvedLabels }
          });
          this.toast(`Подстановка не завершена${unresolvedLabels.length ? `: ${unresolvedLabels.join(', ')}` : ''}. Шаг не засчитан.`);
        } else {
          const appliedText = technicalFieldLabels(completed);
          const matchedText = technicalFieldLabels(matchedFields);
          this.toast(`ТМЦ обработана: ${appliedText ? `подставлено ${appliedText}` : ''}${appliedText && matchedText ? '; ' : ''}${matchedText ? `уже совпадало ${matchedText}` : ''}. Нажми «Сохранить», если были изменения.`);
        }
        window.setTimeout(() => WB.runtime.forceScan?.('tmc-auto-prefill-applied'), 0);
        this.render?.();
        return { ok: verifiedInForm, reason: verifiedInForm ? '' : 'tmc-writeback-partial', result };
      } catch (error) {
        this.tmcAutoPrefillKey = '';
        return this.handleLiveActionError(error);
      } finally {
        this.tmcWritebackInFlight = false;
      }
    }

    async requestTmcWriteback() {
      this.collapseForNavigation();
      try {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const rec = currentCase.locator?.recommendation || {};
        const tmcExpectation = tmcTechnicalExpectation(currentCase, rec.params?.expectedTechnical || {});
        const expected = tmcExpectation.expected;
        const availableFields = tmcExpectation.fields;
        const recommendedFields = Array.isArray(rec.params?.fields) && rec.params.fields.length
          ? rec.params.fields.filter(field => availableFields.includes(field))
          : [];
        const hasConflict = Array.isArray(rec.params?.conflicts) && rec.params.conflicts.length > 0;

        // Normal TMC recovery is scoped by the actual TMC payload, never by a
        // hard-coded GPON/EPON list. All supplied fields are inspected: empty
        // Billing values may be filled, matching values stay untouched, and
        // conflicts are surfaced. Fields absent in TMC are not obligations.
        const fields = hasConflict
          ? (recommendedFields.length ? recommendedFields : availableFields)
          : availableFields;
        if (!fields.length) {
          this.toast('В ТМЦ нет данных для подстановки');
          return { ok: false, reason: 'tmc-values-missing' };
        }

        const requestedAt = new Date().toISOString();
        const patch = {
          tmcExpectedFields: availableFields,
          tmcWritebackPending: true,
          tmcWritebackPendingSave: false,
          tmcWritebackRequestedAt: requestedAt,
          tmcWritebackAppliedAt: '',
          tmcWritebackVerifiedInForm: false,
          tmcWritebackVerifiedInFormAt: '',
          tmcWritebackAppliedFields: [],
          tmcWritebackMatchedFields: [],
          tmcWritebackConflictFields: hasConflict ? recommendedFields : [],
          tmcWritebackSavedAt: '',
          tmcWritebackFields: fields,
          tmcWritebackMode: hasConflict ? 'correction' : 'missing-only',
          expectedTechnicalWriteback: expected,
          instructionAcknowledged: false,
          technicalWritebackVerified: false,
          tmcWritebackLastStatus: '',
          tmcWritebackLastAt: '',
          tmcWritebackDeclinedAt: '',
          tmcWritebackDeclineReason: '',
          tmcWritebackPromptDismissedAt: '',
          tmcWritebackPromptDismissReason: ''
        };
        await WB.store.patchWorkflow?.('ponAcquisition', patch);
        currentCase.workflow ||= {};
        currentCase.workflow.ponAcquisition ||= {};
        Object.assign(currentCase.workflow.ponAcquisition, patch);

        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        if (page.pageKind === 'billing_technical') {
          return this.maybeApplyPendingTmcWriteback();
        }
        return this.returnToTechnical();
      } catch (error) {
        return this.handleLiveActionError(error);
      }
    }

    async maybeApplyPendingTmcWriteback() {
      if (this.tmcWritebackInFlight) return { ok: false, reason: 'tmc-writeback-busy' };
      const currentCase = this.activeCase();
      const flow = currentCase?.workflow?.ponAcquisition || {};
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      if (!currentCase || !flow.tmcWritebackPending || page.pageKind !== 'billing_technical') {
        return { ok: false, reason: 'tmc-writeback-not-pending' };
      }

      this.tmcWritebackInFlight = true;
      try {
        const applyResolver = flow.tmcWritebackMode === 'correction'
          ? WB.guide?.resolvers?.applyTmcTechnicalValues
          : WB.guide?.resolvers?.applyMissingTmcTechnicalValues;
        const result = applyResolver?.(
          currentCase,
          flow.tmcWritebackFields || []
        ) || { ok: false, status: 'unavailable', completed: [], unresolved: [] };

        if (result.status === 'not_ready' && this.tmcWritebackRetryCount < 10) {
          this.tmcWritebackRetryCount += 1;
          window.setTimeout(() => { void this.maybeApplyPendingTmcWriteback(); }, 200);
          return { ok: false, reason: 'technical-controls-not-ready', retry: true };
        }

        this.tmcWritebackRetryCount = 0;
        const observedWriteback = WB.observability?.startOperation?.(
          'TMC_WRITEBACK',
          { fields: flow.tmcWritebackFields || [], expectedFields: flow.tmcExpectedFields || [], mode: flow.tmcWritebackMode || 'missing-only' },
          {
            source: 'rail',
            stage: 'APPLY_FIELDS',
            expected: flow.expectedTechnicalWriteback || null
          }
        );
        const appliedAt = new Date().toISOString();
        const expectedFields = Array.isArray(flow.tmcExpectedFields) && flow.tmcExpectedFields.length
          ? flow.tmcExpectedFields
          : Array.isArray(result.requestedFields) && result.requestedFields.length
            ? result.requestedFields
            : (result.fields || flow.tmcWritebackFields || []);
        const appliedFields = result.ok ? (Array.isArray(result.completed) ? result.completed : []) : [];
        const expectedValues = result.expected || flow.expectedTechnicalWriteback || {};
        const reportedMatched = result.ok && Array.isArray(result.skippedExisting) ? result.skippedExisting : [];
        const currentMatches = WB.guide?.resolvers?.currentTechnicalMatches;
        const matchedFields = result.ok
          ? [...new Set([
              ...reportedMatched,
              ...expectedFields.filter(field => (
                !appliedFields.includes(field)
                && typeof currentMatches === 'function'
                && currentMatches([field], expectedValues)
              ))
            ])]
          : [];
        const unresolvedFields = Array.isArray(result.unresolved) ? result.unresolved : [];
        const conflictFields = unresolvedFields
          .filter(item => item?.status === 'conflict')
          .map(item => item.field)
          .filter(field => expectedFields.includes(field));
        const accountedFields = new Set([...appliedFields, ...matchedFields]);
        const verifiedInForm = Boolean(
          result.ok
          && unresolvedFields.length === 0
          && expectedFields.every(field => accountedFields.has(field))
        );
        const finalStatus = verifiedInForm ? 'applied' : result.ok ? 'partial' : String(result.status || 'failed');

        if (result.status === 'already_present') {
          const alreadyMatched = Array.isArray(result.skippedExisting) && result.skippedExisting.length
            ? result.skippedExisting
            : expectedFields;
          const patch = {
            tmcExpectedFields: expectedFields,
            tmcWritebackPending: false,
            tmcWritebackPendingSave: false,
            tmcWritebackAppliedAt: '',
            tmcWritebackVerifiedInForm: true,
            tmcWritebackVerifiedInFormAt: appliedAt,
            tmcWritebackAppliedFields: [],
            tmcWritebackMatchedFields: alreadyMatched,
            tmcWritebackConflictFields: [],
            expectedTechnicalWriteback: null,
            technicalWritebackVerified: true,
            tmcWritebackLastStatus: 'already_present',
            tmcWritebackLastAt: appliedAt
          };
          await WB.store.patchWorkflow?.('ponAcquisition', patch);
          Object.assign(flow, patch);
          observedWriteback?.success?.({ status: 'already_present', expectedFields, matchedFields: alreadyMatched });
          this.toast(`ТМЦ сверена: ${technicalFieldLabels(alreadyMatched)} уже совпадает. Сохранять нечего.`);
          window.setTimeout(() => WB.runtime.forceScan?.('tmc-writeback-already-present'), 0);
          this.render();
          return { ok: true, reason: 'already-present', result };
        }

        const patch = {
          tmcExpectedFields: expectedFields,
          tmcWritebackPending: false,
          tmcWritebackPendingSave: verifiedInForm && appliedFields.length > 0,
          tmcWritebackAppliedAt: result.ok ? appliedAt : '',
          tmcWritebackVerifiedInForm: verifiedInForm,
          tmcWritebackVerifiedInFormAt: verifiedInForm ? appliedAt : '',
          tmcWritebackAppliedFields: appliedFields,
          tmcWritebackMatchedFields: matchedFields,
          tmcWritebackConflictFields: conflictFields,
          tmcWritebackFields: result.fields || flow.tmcWritebackFields || [],
          expectedTechnicalWriteback: result.expected || flow.expectedTechnicalWriteback || null,
          technicalWritebackVerified: false,
          tmcWritebackLastStatus: finalStatus,
          tmcWritebackLastAt: appliedAt,
          tmcWritebackDeclinedAt: '',
          tmcWritebackDeclineReason: '',
          tmcWritebackPromptDismissedAt: '',
          tmcWritebackPromptDismissReason: ''
        };
        await WB.store.patchWorkflow?.('ponAcquisition', patch);
        Object.assign(flow, patch);

        if (result.ok) {
          const unresolved = unresolvedFields.map(item => technicalFieldLabels([item.field])).filter(Boolean);
          const skipped = technicalFieldLabels(matchedFields);
          const applied = technicalFieldLabels(appliedFields);
          if (unresolved.length) {
            observedWriteback?.reject?.('Часть ожидаемых полей ТМЦ не подтверждена в Billing', {
              code: 'TMC_WRITEBACK_PARTIAL',
              stage: 'VERIFY_FIELDS',
              actual: result,
              details: { expectedFields, unresolved }
            });
          } else {
            observedWriteback?.success?.({ ...result, expectedFields, appliedFields, matchedFields });
          }
          this.toast(unresolved.length
            ? `Подстановка не завершена: ${unresolved.join(', ')}. Шаг не засчитан и Save не подтверждён.`
            : `${applied ? `Подставлено: ${applied}. ` : ''}${skipped ? `Уже совпадало: ${skipped}. ` : ''}${applied ? 'Проверь и нажми «Сохранить».' : 'Сохранять нечего.'}`);
          window.setTimeout(() => WB.runtime.forceScan?.('tmc-writeback-prefilled'), 0);
          this.render();
          return { ok: verifiedInForm, reason: verifiedInForm ? '' : 'tmc-writeback-partial', result };
        }

        observedWriteback?.error?.(new Error(`TMC writeback: ${result.status || 'failed'}`), {
          code: 'TMC_WRITEBACK_VERIFY_FAILED',
          stage: 'VERIFY_FIELDS',
          message: 'Данные ТМЦ не были подтверждённо применены к полям Billing',
          actual: result,
          details: { expectedFields, fields: flow.tmcWritebackFields || [], conflictFields }
        });
        this.toast(conflictFields.length
          ? `Конфликт Billing ↔ ТМЦ: ${technicalFieldLabels(conflictFields)}. Автоперезапись запрещена.`
          : 'Не удалось подставить данные ТМЦ в поля Billing');
        return { ok: false, reason: result.status || 'tmc-writeback-failed', result };
      } catch (error) {
        return this.handleLiveActionError(error);
      } finally {
        this.tmcWritebackInFlight = false;
      }
    }

    async openMacSearchDirect() {
      this.collapseForNavigation();
      return this.withLiveNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        if (page.pageKind !== 'userside_customer') {
          const result = await WB.handoff?.openUsersideForCase?.(currentCase);
          if (!result?.ok) this.toast('Не удалось вернуть UserSide текущего абонента');
          return result || { ok: false, reason: 'userside-open-failed' };
        }
        const anchor = WB.guide?.resolvers?.findCustomerMacSearchLink?.(currentCase);
        if (!anchor?.href) {
          this.toast('Ссылка поиска по MAC сейчас не найдена');
          return { ok: false, reason: 'mac-search-link-missing' };
        }
        location.assign(anchor.href);
        return { ok: true, method: 'mac-search-url' };
      });
    }

    async returnToTechnical() {
      this.collapseForNavigation();
      return this.withLiveNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        if (page.pageKind === 'billing_technical') {
          return { ok: true, method: 'already-technical' };
        }

        if (WB.billingNavigation?.navigate) {
          const result = await WB.billingNavigation.navigate({
            caseId: currentCase.id,
            semanticTargetId: 'billing.technical',
            entityId: String(valueOf(currentCase?.identity?.billingId) || ''),
            intent: 'GUIDED_NAVIGATION',
            sourceAction: 'tmc-writeback-return-technical'
          });
          if (!result?.ok) {
            this.toast(result?.code === 'BILLING_SESSION_NOT_CONFIRMED'
              ? 'Нет подтверждённой живой сессии Billing — техданные не открыты'
              : 'Не удалось безопасно открыть Billing → Технические данные');
            return { ok: false, reason: result?.reason || 'billing-navigation-rejected', code: result?.code };
          }
          return result;
        }
        return { ok: false, reason: 'billing-navigation-unavailable' };
      });
    }

    async replayEvidence(key) {
      if (this.evidenceReplayInFlight) return { ok: false, reason: 'replay-busy' };
      this.collapseForNavigation();
      const currentCase = this.activeCase();
      if (!currentCase || !WB.evidenceNavigator?.achieved?.(currentCase, key)) {
        this.toast('Этот этап ещё не зафиксирован в текущем Case');
        return { ok: false, reason: 'milestone-not-achieved' };
      }
      this.evidenceReplayInFlight = true;
      try {
        const session = this.startGuidedLifecycle(key, {
          operationType: 'DIRECT_REPLAY',
          sourceAction: 'live-history-replay',
          replayOnly: true,
          title: key === 'technical' ? 'Технические данные' : key === 'tmc' ? 'ТМЦ' : key === 'poll' ? 'Штатный опрос ONU' : key === 'juniper' ? 'Juniper' : 'Пройденный этап',
          planId: `replay.${key}`
        });
        if (!session) return { ok: false, reason: 'action-session-unavailable' };
        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        if (WB.actionLifecycle?.destinationMatches?.(session, page)) {
          return WB.guide?.continueActiveActionSession?.(currentCase) || { ok: false, reason: 'guide-unavailable' };
        }
        WB.actionLifecycle?.navigationStarted?.(session, { actualResult: session.destinationPageKind || session.destinationSystem || '' });
        await WB.actionLifecycle?.flushPersistence?.();
        let result;
        if (key === 'technical') result = await this.openTechnicalDirect();
        else if (key === 'tmc') result = await this.openTmcSourceDirect();
        else if (key === 'juniper') result = await this.navigateToBillingCardForAction(currentCase, 'billing.juniper');
        else if (key === 'poll') result = await this.navigateToBillingCardForAction(currentCase, 'billing.poll.entry');
        else return { ok: false, reason: 'replay-navigation-unavailable' };

        if (result?.ok) {
          // Navigation commit is NOT completion. The destination document/content
          // script must verify pageKind + entity for this Case before DIRECT_REPLAY
          // can become COMPLETED. For an already-open destination, verify now.
          const currentPage = WB.runtime.lastContext || currentCase.currentContext || {};
          if (WB.actionLifecycle?.destinationMatches?.(session, currentPage)) {
            return WB.guide?.continueActiveActionSession?.(currentCase) || result;
          }
        } else if (result?.code === 'BILLING_AUTH_PAGE_REACHED' || result?.code === 'BILLING_SESSION_NOT_CONFIRMED') {
          WB.actionLifecycle?.fail?.(session, result.reason || 'navigation-rejected', {
            code: result.code,
            message: result.code === 'BILLING_AUTH_PAGE_REACHED'
              ? 'Billing вернул страницу авторизации'
              : 'Сессия Billing не подтверждена — переход отклонён',
            actualResult: result.reason || ''
          });
        } else if (!result?.ok) {
          WB.actionLifecycle?.fail?.(session, result?.reason || 'replay-failed', {
            code: result?.code || 'DIRECT_REPLAY_FAILED',
            message: 'Direct replay не достиг destination',
            actualResult: result?.reason || ''
          });
        }
        return result;
      } finally {
        this.evidenceReplayInFlight = false;
      }
    }

    async maybeContinueEvidenceReplay() {
      return this.maybeContinueOneShotFocus();
    }

    async requestPollReveal() {
      this.collapseForNavigation();
      try {
        const currentCase = this.activeCase();
        const diagnostic = currentCase?.diagnostic || {};
        const flow = currentCase?.workflow?.ponAcquisition || {};
        const missing = Array.isArray(diagnostic.billingMissingTechnical) ? diagnostic.billingMissingTechnical : [];
        if (hasSuccessfulOnuPoll(currentCase)) {
          this.toast('Опрос ONU уже успешно выполнен для текущего Case');
          return { ok: false, reason: 'poll-already-confirmed' };
        }
        const savePending = Boolean(flow.tmcWritebackPending || flow.tmcWritebackPendingSave);
        if (!currentCase || savePending || missing.length || !(diagnostic.readyForOnuPoll || diagnostic.canAttemptOnuPoll)) {
          this.toast(savePending
            ? 'Данные уже подставлены, но ещё не сохранены. Нажми штатную «Сохранить».'
            : 'Сначала сохрани необходимые технические данные');
          return { ok: false, reason: savePending ? 'technical-save-required' : 'poll-not-ready' };
        }
        const pollAction = String(
          WB.guide?.resolvers?.authoritativePollAction?.(currentCase)
          || diagnostic.pollAction
          || ''
        );
        const pollTargetByAction = {
          '310': 'billing.poll.epon',
          '311': 'billing.poll.gpon',
          '312': 'billing.poll.gcom',
          '313': 'billing.poll.huawei'
        };
        const pollTarget = pollTargetByAction[pollAction] || '';
        if (!pollTarget) {
          this.toast('Не удалось определить нативную вкладку опроса ONU для текущей OLT');
          return { ok: false, reason: 'poll-action-unresolved' };
        }

        // One-shot contract: this CTA does not stop on the Billing card and does
        // not ask the operator for a second Workbench click. It opens the exact
        // native technology poll page itself and the same ActionSession ends at
        // the real native "Запрос OLT" control, which remains a manual click.
        const billingId = String(valueOf(currentCase?.identity?.billingId) || '');
        const started = WB.actionLifecycle?.start?.({
          operationType: 'GUIDE_NAVIGATION',
          intent: 'GUIDED_NAVIGATION',
          navigationCapable: true,
          caseId: currentCase.id,
          semanticTargetId: 'billing.olt.request',
          destinationSystem: 'billing',
          destinationPageKind: 'billing_onu_poll',
          destinationEntityId: billingId,
          expectedPostCondition: 'Открыта правильная нативная вкладка опроса ONU и показан Focus на Запрос OLT',
          sourceAction: 'live-one-shot-cta',
          title: 'Запусти запрос OLT',
          text: 'Нажми нативный «Запрос OLT» для текущего Case.',
          planId: 'billing.ask-olt',
          targetTimeoutMs: 12000
        });
        const session = started?.session || null;
        if (!session) return { ok: false, reason: started?.reason || 'action-session-unavailable' };

        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        const currentPollAction = (() => {
          try { return new URL(location.href).searchParams.get('a') || ''; } catch { return ''; }
        })();
        if (
          WB.actionLifecycle?.destinationMatches?.(session, page)
          && page.pageKind === 'billing_onu_poll'
          && currentPollAction === pollAction
        ) {
          return WB.guide?.continueActiveActionSession?.(currentCase) || { ok: false, reason: 'guide-unavailable' };
        }
        WB.actionLifecycle?.navigationStarted?.(session, { actualResult: pollTarget });
        await WB.actionLifecycle?.flushPersistence?.();
        const result = await WB.billingNavigation?.navigate?.({
          caseId: currentCase.id,
          semanticTargetId: pollTarget,
          entityId: billingId,
          intent: 'GUIDED_NAVIGATION',
          operationId: session.operationId || '',
          sourceAction: 'live-poll-one-shot-direct'
        }) || { ok: false, reason: 'billing-navigation-unavailable' };
        if (!result?.ok) {
          WB.actionLifecycle?.fail?.(session, result?.reason || 'poll-page-navigation-failed', {
            code: 'ACTION_NAVIGATION_FAILED',
            message: 'Не удалось перейти к штатному разделу опроса ONU',
            actualResult: result?.reason || ''
          });
        }
        return result;
      } catch (error) {
        return this.handleLiveActionError(error);
      }
    }

    async maybeContinuePollReveal() {
      const session = WB.actionLifecycle?.syncFromCase?.(this.activeCase()) || WB.actionLifecycle?.current?.();
      if (!session || !['billing.poll.entry', 'billing.olt.request'].includes(String(session.semanticTargetId || '')) || WB.actionLifecycle?.isTerminal?.(session)) {
        return { ok: false, reason: 'no-pending-poll-reveal' };
      }
      return WB.guide?.continueActiveActionSession?.(this.activeCase()) || { ok: false, reason: 'guide-unavailable' };
    }

    liveView() {
      const currentCase = this.activeCase();
      const terminalVisible = Boolean(this.terminalView.active || WB.pollTerminal?.hasResult?.());
      if (!currentCase) {
        return terminalVisible
          ? `<div class="card ready"><div class="label">OLT · ответ получен</div><div class="value">Сверить результат на странице</div></div>`
          : `<div class="card"><div class="label">LIVE</div><div class="value">Абонент не определён</div><div class="source">Открой карточку абонента — снимок появится автоматически.</div></div>`;
      }

      const context = WB.runtime.lastContext || currentCase.currentContext || {};
      const diagnostic = currentCase.diagnostic || {};
      const locator = currentCase.locator || {};
      const termination = locator.termination || null;
      const oltSnapshot = currentCase.live?.oltSnapshot || null;
      const completed = termination?.status === 'confirmed' || oltSnapshot?.status === 'confirmed' || diagnostic.stage === 'ethernet-complete';
      const next = this.nextStep(currentCase);
      const terminalReady = terminalVisible || termination?.status === 'confirmed' || oltSnapshot?.status === 'confirmed';
      const interpretedCount = Number(this.terminalView.blocks || oltSnapshot?.evidence?.length || 0);
      const evidenceRows = this.terminalEvidenceRows(oltSnapshot);
      const passiveDiscovery = WB.guide?.latestPassiveDiscovery?.(currentCase) || null;
      const contract = valueOf(currentCase.identity?.contract);
      const login = valueOf(currentCase.identity?.login);
      const trail = WB.evidenceNavigator?.trail?.(currentCase) || [];
      const pollAchieved = trail.some(item => item.key === 'poll');
      const recommendationAllowed = WB.evidenceNavigator?.recommendationAllowed?.(currentCase, next) !== false;
      const guideButtons = recommendationAllowed ? this.guideActions(next) : '';

      const snapshotSource = oltSnapshot?.capturedAt ? `обновлено ${formatTime(oltSnapshot.capturedAt)}` : '';
      const terminalState = terminalReady ? [
        diagnostic.pollResponded ? 'OLT ответила' : '',
        diagnostic.bindingVerified ? 'Привязка ONU подтверждена' : 'Привязка ONU не подтверждена',
        diagnostic.serviceHealthy
          ? 'Сервис работает'
          : diagnostic.serviceState && diagnostic.serviceState !== 'unknown'
            ? `Сервис: ${diagnostic.serviceState}`
            : ''
      ].filter(Boolean).join(' · ') : '';
      const terminalSummary = terminalReady ? `
        <div class="section">
          <div class="card ready live-onu-result">
            <div class="label">Живой опрос ONU</div>
            <div class="value">${esc(oltSnapshot?.onuStatus ? `ONU ${oltSnapshot.onuStatus}` : 'Ответ оборудования получен')}</div>
            ${evidenceRows.length ? `<div class="terminal-evidence">${evidenceRows.map(row => `<div class="terminal-evidence-row ${esc(row.state)}"><span class="signal">${esc(row.signal)}</span><span class="evidence-name">${esc(row.name)}</span><span class="evidence-value">${esc(row.value)}</span></div>`).join('')}</div>` : ''}
            ${terminalState ? `<div class="source">${esc(terminalState)}</div>` : ''}
            <div class="source">${esc([snapshotSource, interpretedCount ? `разобрано блоков: ${interpretedCount}` : 'живые данные подтверждены'].filter(Boolean).join(' · '))}</div>
          </div>
        </div>` : '';

      let nextHtml = '';
      if (!terminalReady) {
        if (diagnostic.isEthernet) {
          if (recommendationAllowed && guideButtons) nextHtml = `<div class="section"><div class="live-next-one"><div class="label">Следующий полезный шаг</div><div class="value">${esc(next.title)}</div><div class="source">${esc(next.text)}</div><div class="actions" style="margin-top:8px">${guideButtons}</div></div></div>`;
        } else if (pollAchieved) {
          if (recommendationAllowed && guideButtons && !/poll|ask-olt/i.test(String(next.id || ''))) nextHtml = `<div class="section"><div class="live-next-one"><div class="label">Следующий полезный шаг</div><div class="value">${esc(next.title)}</div><div class="source">${esc(next.text)}</div><div class="actions" style="margin-top:8px">${guideButtons}</div></div></div>`;
        } else {
          nextHtml = this.ponContextCard(currentCase, diagnostic, locator, next);
        }
      }

      return `
        ${this.liveCaseCard(currentCase, context, diagnostic, completed)}
        ${diagnostic.isEthernet ? this.lineSnapshot(currentCase, diagnostic, locator) : ''}
        ${this.pollAttemptCard(currentCase)}
        ${terminalSummary}
        ${this.evidenceHistory(currentCase)}
        ${nextHtml}
        ${passiveDiscovery && !terminalReady ? `<div class="section"><div class="card"><div class="label">Замечено вне шага</div><div class="value">${esc(passiveDiscovery.type || 'Новые данные')}</div><div class="source">${esc(passiveDiscovery.summary || 'Маршрут не изменён.')}</div><div class="actions" style="margin-top:8px"><button class="action" data-action="passive-show">Показать</button></div></div></div>` : ''}
        ${(contract || login) ? `<div class="section"><div class="actions"><button class="action" data-action="copy-contract">${icon('copy')} Договор</button></div></div>` : ''}
      `;
    }

    async persistAppeal(nextAppeal, transition = {}) {
      if (this.appealSaving) {
        this.toast('Ответ уже сохраняется');
        return;
      }
      const currentCase = this.activeCase();
      if (!currentCase) {
        this.toast('Сначала открой абонента');
        return;
      }

      this.appealSaving = true;
      currentCase.appeal = nextAppeal;
      this.render();
      try {
        const result = await WB.store.patchAppeal(nextAppeal, transition);
        if (result?.accepted === false) {
          this.toast('Кейс уже изменился — ответ не применён');
        }
      } catch {
        this.toast('Не удалось сохранить маршрут обращения');
      } finally {
        this.appealSaving = false;
        this.render();
      }
    }

    appealView() {
      const currentCase = this.activeCase();
      const navigator = WB.appeals;
      if (!currentCase) {
        return `
          <div class="card">
            <div class="value">Сначала открой абонента</div>
            <div class="source">Маршрут обращения сохраняется внутри конкретного кейса и не должен смешиваться между абонентами.</div>
          </div>
        `;
      }
      if (!navigator) {
        return `<div class="card warn"><div class="value">Навигатор не загрузился</div><div class="source">Обнови расширение и перечитай страницу.</div></div>`;
      }

      const state = navigator.normalize(currentCase.appeal);
      const appealType = navigator.typeForState(state);
      if (!appealType) {
        return `
          <div class="appeal-intro">
            Выбери, с чем обратился абонент. Дальше — по одному уточняющему вопросу. Полный path можно открыть в «Диагностический граф».
          </div>
          <div class="actions" style="margin:8px 0 10px">
            <button class="action primary" data-action="graph-studio-open">Диагностический граф</button>
          </div>
          <div class="appeal-types">
            ${navigator.types.map(item => `
              <button
                class="appeal-type"
                data-action="appeal-select"
                data-appeal-type="${esc(item.id)}"
                ${this.appealSaving ? 'disabled' : ''}
              >
                <b>${esc(item.label)}</b>
                <small>${esc(item.short)}</small>
              </button>
            `).join('')}
          </div>
          <div class="section">
            <div class="learning"><b>Как это работает:</b> вопросы уточняют симптом, а LIVE отдельно проверяет фактическую сеть. Ответ абонента не считается техническим доказательством.</div>
          </div>
        `;
      }

      const currentNode = navigator.node(state);
      const currentOptions = navigator.availableOptions(state, currentCase);
      const phases = navigator.phaseStates(state);
      const known = navigator.caseSummary(currentCase);
      const history = state.history.slice(-5);
      const coverage = typeof navigator.contextCoverage === 'function'
        ? navigator.contextCoverage(currentCase)
        : { items: [] };
      const coverageStrip = (coverage.items || [])
        .filter(item => ['billing', 'userside', 'onu_olt', 'freshness'].includes(item.id))
        .map(item => {
          const mark = item.status === 'confirmed' ? '✓' : item.status === 'conflicting' ? '×' : '·';
          return `<span title="${esc(item.detail || '')}">${mark} ${esc(item.label)}</span>`;
        })
        .join('');
      const progress = `
        <div class="appeal-progress" aria-label="Маршрут уточнения обращения">
          ${phases.map((item, index) => `
            <div class="appeal-phase ${esc(item.state)}">
              <i>${item.state === 'done' ? '✓' : index + 1}</i>
              <span>${esc(item.label)}</span>
            </div>
          `).join('')}
        </div>
      `;
      const knownStrip = known.length
        ? `<div class="appeal-known">${known.map(item => `<span>${esc(item.label)}: <b>${esc(item.value)}</b></span>`).join('')}</div>`
        : '';
      const trail = history.length
        ? `
          <div class="appeal-trail">
            <div class="eyebrow">Уже выяснили</div>
            ${history.map(item => `
              <div class="appeal-trail-row">
                <span>${esc(item.question)}</span>
                <b>${esc(item.answer)}</b>
              </div>
            `).join('')}
          </div>
        `
        : '';

      // Full appeal answers stay in RAIL — same case.appeal as Diagnostic Graph.
      const currentContent = currentNode?.kind === 'outcome'
        ? `
          <div class="appeal-outcome">
            <div class="label">Рабочая гипотеза · не окончательный диагноз</div>
            <h2>${esc(currentNode.title)}</h2>
            <p>${esc(currentNode.summary)}</p>
            <div class="appeal-next"><b>Следующий шаг:</b> ${esc(currentNode.nextAction)}</div>
          </div>
        `
        : `
          <div class="appeal-question">
            <div class="label">Один вопрос сейчас</div>
            <h2>${esc(currentNode?.title || 'Продолжи уточнение')}</h2>
            <p class="appeal-why">${esc(currentNode?.why || 'Ответ поможет выбрать следующую ветку проверки.')}</p>
            <div class="appeal-options">
              ${currentOptions.map(item => `
                <button
                  class="appeal-option"
                  data-action="appeal-answer"
                  data-answer="${esc(item.id)}"
                  ${this.appealSaving ? 'disabled' : ''}
                >
                  <b>${esc(item.label)}</b>
                  <small>Дальше: ${esc(item.hint)}</small>
                </button>
              `).join('') || '<div class="source">Для текущих данных нет доступного ответа.</div>'}
            </div>
          </div>
        `;

      return `
        <div class="appeal-head">
          <div>
            <div class="label">Тип обращения</div>
            <div class="value">${esc(appealType.label)}</div>
          </div>
          <div class="actions">
            <button class="action primary" data-action="graph-studio-open">Диагностический граф</button>
            <button class="action" data-action="appeal-reset" ${this.appealSaving ? 'disabled' : ''}>Сменить</button>
          </div>
        </div>
        ${progress}
        ${coverageStrip ? `<div class="appeal-known">${coverageStrip}</div>` : knownStrip}
        ${currentContent}
        ${trail}
        <div class="actions" style="margin-top:10px">
          ${state.history.length ? `<button class="action" data-action="appeal-back" ${this.appealSaving ? 'disabled' : ''}>Назад на вопрос</button>` : ''}
        </div>
      `;
    }

    factsView() {
      const currentCase = this.activeCase();
      if (!currentCase) {
        return `<div class="card"><div class="empty">Нет активного кейса.</div></div>`;
      }
      const isEthernet = Boolean(currentCase.diagnostic?.isEthernet)
        || String(valueOf(currentCase.network?.connectionFamily) || '').toLowerCase() === 'ethernet';

      const groups = [
        [
          'Идентификация',
          currentCase.identity,
          [
            ['Логин', 'login'],
            ['Договор', 'contract'],
            ['Billing ID', 'billingId'],
            ['Customer ID', 'customerId']
          ]
        ],
        [
          'Сеть',
          currentCase.network,
          [
            ['IP', 'ip'],
            ['MAC абонента', 'mac'],
            ['Тип подключения', 'connectionFamily'],
            ['Исходное значение', 'connectionRaw'],
            ['Коммутатор ID', 'accessDeviceId'],
            ['Коммутатор', 'accessDeviceName'],
            ['IP коммутатора', 'accessDeviceIp'],
            ['Порт', 'accessPort'],
            ['Интерфейс', 'accessInterface'],
            ['Линк', 'accessLinkState'],
            ['Скорость, Мбит/с', 'accessSpeedMbps'],
            ['MAC в FDB', 'accessFdbMac'],
            ['Интерфейс FDB', 'accessFdbInterface'],
            ['VLAN', 'accessVlan'],
            ['Ошибки порта', 'accessErrorsStatus'],
            ['Ошибки in', 'accessErrorsIn'],
            ['Ошибки out', 'accessErrorsOut']
          ]
        ],
        ...(isEthernet ? [] : [[
          'PON / ONU',
          currentCase.pon,
          [
            ['ONU Serial', 'onuSerial'],
            ['ONU MAC', 'onuMac'],
            ['OLT', 'oltName'],
            ['OLT ID', 'oltId'],
            ['OLT IP', 'oltIp'],
            ['ТМЦ ONU Serial', 'tmcOnuSerial'],
            ['ТМЦ ONU MAC', 'tmcOnuMac'],
            ['ТМЦ OLT', 'tmcOltName'],
            ['ТМЦ OLT IP', 'tmcOltIp'],
            ['ТМЦ OLT device ID', 'tmcOltDeviceId'],
            ['ТМЦ Interface', 'tmcPort'],
            ['Найденное оборудование', 'locatedDeviceName'],
            ['Найденное устройство ID', 'locatedDeviceId'],
            ['Подтверждённый интерфейс', 'locatedInterface'],
            ['Найденная OLT', 'locatedOltName'],
            ['Найденная OLT IP', 'locatedOltIp'],
            ['Найденный тип опроса', 'locatedPollType'],
            ['Тип OLT / опроса', 'pollType'],
            ['Действие Billing', 'pollAction'],
            ['Порт', 'port'],
            ['Статус', 'status'],
            ['RX', 'rx'],
            ['TX', 'tx'],
            ['Расстояние', 'distance']
          ]
        ]]),
        [
          'Профиль',
          currentCase.profile,
          [
            ['ФИО', 'fullName'],
            ['Адрес', 'address'],
            ['Тариф', 'tariff'],
            ['Баланс', 'balance']
          ]
        ]
      ];

      const conflicts = Number(currentCase.conflicts?.length || 0);
      const conflictCard = conflicts
        ? `
          <div class="card warn">
            <div class="label">Конфликты источников</div>
            <div class="value">${conflicts}</div>
            <div class="source">Низкоуверенные значения больше не перезаписывают подтверждённые факты.</div>
          </div>
        `
        : '';

      return conflictCard + groups.map(
        ([title, group, fields]) => `
          <div class="section">
            <div class="eyebrow">${title}</div>
            <div class="grid">
              ${fields.map(([label, key]) => this.factCard(label, group?.[key])).join('')}
            </div>
          </div>
        `
      ).join('');
    }

    journalEventDetail(event) {
      const type = String(event?.type || '');
      const details = event?.details || {};
      if (type === 'route_guard') {
        const blocked = Array.isArray(details.blockedFacts)
          ? details.blockedFacts.map(item => `${item.group || ''}.${item.key || ''}`).filter(Boolean)
          : [];
        const observations = Array.isArray(details.observations) ? details.observations : [];
        const lines = [
          `<div><b>NEXT:</b> ${esc(details.requiredAction || 'none')}</div>`,
          `<div><b>Связь:</b> ${esc(details.relation || 'unknown')}</div>`,
          details.pageKind ? `<div><b>Страница:</b> ${esc(details.pageKind)}</div>` : '',
          blocked.length ? `<div><b>Не допущено в route-state:</b> ${esc(blocked.join(', '))}</div>` : '',
          observations.length ? `<div><b>Observations:</b> ${esc(observations.map(item => `${item.type}:${item.relation || ''}${item.passive ? ':passive' : ''}`).join(' · '))}</div>` : ''
        ].filter(Boolean);
        return `<div class="trace-detail">${lines.join('')}</div>`;
      }
      if (type === 'juniper') {
        const lines = [
          details.summary ? `<div><b>Смысл:</b> ${esc(details.summary)}</div>` : '',
          details.status ? `<div><b>Статус:</b> ${esc(details.status)}</div>` : '',
          details.subscriberIp || details.subscriberMac ? `<div><b>Абонент:</b> ${esc([details.subscriberIp, details.subscriberMac].filter(Boolean).join(' · '))}</div>` : '',
          details.bras ? `<div><b>BRAS:</b> ${esc(details.bras)}</div>` : '',
          details.sessionId || details.source ? `<div><b>Сессия:</b> ${esc([details.source, details.sessionId ? `#${details.sessionId}` : ''].filter(Boolean).join(' · '))}</div>` : '',
          details.speedRaw ? `<div><b>Обмен:</b> ${esc(details.speedRaw)}${details.hasTraffic === true ? ' · есть' : details.hasTraffic === false ? ' · нет в момент снимка' : ''}</div>` : '',
          details.lastEvent ? `<div><b>Последнее событие:</b> ${esc(details.lastEvent)}</div>` : '',
          details.vlan ? `<div><b>VLAN:</b> ${esc(details.vlan)}</div>` : '',
          '<div><b>Режим:</b> read-only</div>'
        ].filter(Boolean);
        return `<div class="trace-detail">${lines.join('')}</div>`;
      }
      if (type === 'interaction_guard') {
        const target = details.target || {};
        const lines = [
          details.reason ? `<div><b>Защита:</b> ${esc(details.reason)}</div>` : '',
          target.text || target.tag ? `<div><b>Цель:</b> ${esc(target.text || target.tag)}</div>` : '',
          details.action ? `<div><b>Poll:</b> ${esc(details.action)}</div>` : '',
          details.ageMs != null ? `<div><b>Повтор через:</b> ${esc(String(details.ageMs))} ms</div>` : ''
        ].filter(Boolean);
        return lines.length ? `<div class="trace-detail">${lines.join('')}</div>` : '';
      }
      if (!type.startsWith('operator_')) return '';
      const semantic = details.semantic || {};
      const target = details.target || {};
      const navigation = details.navigation || {};
      const dom = details.dom || {};
      const lines = [];
      if (semantic.hint) lines.push(`<div><b>Смысл:</b> ${esc(semantic.hint)}</div>`);
      if (target.text || target.tag) lines.push(`<div><b>Цель:</b> ${esc(target.text || target.tag)}${target.tag ? ` · &lt;${esc(target.tag)}&gt;` : ''}</div>`);
      if (details.section) lines.push(`<div><b>Раздел:</b> ${esc(details.section)}</div>`);
      if (navigation.method || navigation.to || navigation.url) lines.push(`<div><b>Переход:</b> ${esc(navigation.method || 'GET')} ${esc(navigation.to || navigation.url || '')}</div>`);
      if (dom.cssPath || details.selection?.commonPath) lines.push(`<div class="trace-dom"><b>DOM:</b> ${esc(dom.cssPath || details.selection?.commonPath || '')}</div>`);
      if (details.selectedText) lines.push(`<div><b>Выделено:</b> ${esc(String(details.selectedText).slice(0, 260))}</div>`);
      if (details.value) lines.push(`<div><b>Значение:</b> ${esc(details.value)}</div>`);
      return lines.length ? `<div class="trace-detail">${lines.join('')}</div>` : '';
    }

    journalView() {
      const events = this.activeCase()?.journal || [];
      if (!events.length) {
        return `
          <div class="card">
            <div class="empty">Журнал пуст. События появятся при смене страницы и обнаружении новых фактов.</div>
          </div>
        `;
      }

      return `
        <div class="journal">
          ${events.map(event => `
            <div class="event ${esc(event.type)}">
              <div class="time">${formatTime(event.at)} · ${esc(event.type)}</div>
              <div class="message">${esc(event.message)}</div>
              ${this.journalEventDetail(event)}
            </div>
          `).join('')}
        </div>
      `;
    }

    syncDiagnosticsBadge() {
      const button = this.shadow?.querySelector?.('.rail-btn.more');
      if (!button) return;
      button.querySelector?.('.diagnostics-badge')?.remove();
      const unread = Math.max(0, Number(this.diagnosticsState?.unreadCount || 0));
      if (!unread) return;
      const badge = document.createElement('span');
      badge.className = 'diagnostics-badge';
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.title = `${unread} непросмотренных проблем Workbench`;
      button.appendChild(badge);
    }

    async refreshDiagnostics(render = false) {
      if (this.diagnosticsLoading || !WB.observability?.getDiagnostics) return this.diagnosticsState;
      this.diagnosticsLoading = true;
      try {
        const state = await WB.observability.getDiagnostics();
        if (state && typeof state === 'object') this.diagnosticsState = state;
        if (render && this.activeView === 'full' && this.fullSection === 'diagnostics') this.render();
        else this.syncDiagnosticsBadge();
        return this.diagnosticsState;
      } catch (error) {
        console.warn('[SIMNET Workbench][DIAGNOSTICS] read failed', error);
        return this.diagnosticsState;
      } finally {
        this.diagnosticsLoading = false;
      }
    }

    diagnosticsView() {
      const state = this.diagnosticsState || { entries: [], unreadCount: 0 };
      const entries = Array.isArray(state.entries) ? state.entries.slice(0, 80) : [];
      const display = value => {
        if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
        try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); }
      };
      return `
        <div class="card">
          <div class="label">Непросмотренные проблемы</div>
          <div class="value">${Number(state.unreadCount || 0)}</div>
          <div class="source">Хранятся только ограниченные WARNING / ERROR / CRITICAL и значимые NOTICE. DEBUG не накапливается.</div>
          <div class="actions" style="margin-top:8px">
            <button class="action" data-action="diagnostics-refresh">Обновить</button>
            <button class="action" data-action="diagnostics-mark-read">Прочитано</button>
            <button class="action primary" data-action="diagnostics-export">Экспорт</button>
            <button class="action danger" data-action="diagnostics-clear">Очистить</button>
          </div>
        </div>
        <div class="section">
          <div class="eyebrow">Последние события</div>
          ${entries.length ? `<div class="diag-list">${entries.map(entry => {
            const extra = [
              entry.stage ? `stage: ${entry.stage}` : '',
              entry.reason ? `reason: ${entry.reason}` : '',
              display(entry.expected) ? `expected: ${display(entry.expected)}` : '',
              display(entry.actual) ? `actual: ${display(entry.actual)}` : '',
              entry.stack ? `stack: ${entry.stack}` : ''
            ].filter(Boolean).join('\n');
            return `<div class="diag-item ${entry.unread ? 'unread' : ''}">
              <div class="diag-top"><span class="diag-level ${esc(entry.severity || '')}">${esc(entry.severity || 'ERROR')}</span><span class="diag-code">${esc(entry.code || 'WORKBENCH_FAILURE')}</span>${Number(entry.count || 1) > 1 ? `<span class="chip">×${Number(entry.count || 1)}</span>` : ''}</div>
              <div class="diag-message">${esc(entry.message || entry.reason || '')}</div>
              <div class="diag-meta">${esc(formatTime(entry.lastSeenAt || entry.firstSeenAt || ''))}${entry.subscriber ? ` · ${esc(entry.subscriber)}` : ''}${entry.system || entry.pageKind ? ` · ${esc([entry.system, entry.pageKind].filter(Boolean).join(' / '))}` : ''}</div>
              ${extra ? `<details class="diag-details"><summary>Технические детали</summary>${esc(extra)}</details>` : ''}
            </div>`;
          }).join('')}</div>` : '<div class="card"><div class="empty">Ошибок пока нет.</div></div>'}
        </div>
      `;
    }

    async exportDiagnostics() {
      try {
        const bundle = await WB.observability?.exportBundle?.();
        if (!bundle) throw new Error('Диагностический экспорт недоступен');
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `simnet-workbench-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.toast('Диагностика экспортирована');
      } catch (error) {
        this.toast(error?.message || String(error));
      }
    }

    settingsView() {
      const ui = this.state?.ui || {};
      const currentCase = this.activeCase();
      const load = WB.performanceMonitor?.snapshot?.({
        state: this.state,
        caseData: currentCase
      }) || {
        level: 'low',
        rates: {},
        sizes: {},
        scans: [],
        networks: [],
        renders: [],
        milestones: {}
      };
      const levelLabel = {
        low: 'Низкая',
        medium: 'Средняя',
        high: 'Высокая'
      }[load.level] || 'Низкая';
      const levelClass = load.level === 'high' ? 'warn' : load.level === 'medium' ? 'pending' : 'ready';
      const total = rows => (rows || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
      const avg = rows => {
        const count = total(rows);
        return count
          ? Math.round((rows || []).reduce((sum, item) => sum + Number(item.totalMs || 0), 0) / count)
          : 0;
      };
      const juniper = (load.networks || []).filter(item => String(item.label || '').startsWith('juniper'));
      const calls = (load.networks || []).filter(item => String(item.label || '').startsWith('call-'));
      const bytes = value => {
        const size = Number(value || 0);
        if (!size) return '—';
        if (size < 1024) return `${size} Б`;
        if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
        return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
      };
      const milestone = name => Number.isFinite(Number(load.milestones?.[name]))
        ? `${Math.round(Number(load.milestones[name]))} мс`
        : '—';
      const hiddenSuppressed = Number(load.counters?.hiddenScansSuppressed || 0)
        + Number(load.counters?.hiddenStatePublishesDeferred || 0);
      const tabLifecycle = this.state?.meta?.tabLifecycle || {};

      return `
        <div class="card">
          <div class="toggle">
            <div>
              <div class="value">Компактный режим</div>
              <div class="label">252 px и одна колонка фактов</div>
            </div>
            <button class="switch ${ui.compact ? 'on' : ''}" data-action="compact"><span></span></button>
          </div>
        </div>

        <div class="card" style="margin-top:7px">
          <div class="toggle">
            <div>
              <div class="value">Diagnostic Trace ${currentCase?.workflow?.operatorTrace?.enabled ? '· RECORDING' : '· OFF'}</div>
              <div class="label">Ручная чёрная коробка: клики, выделения, переходы, ActionSession, Focus show/hide/rebind и ограниченные UI-изменения. В обычном режиме выключена.</div>
            </div>
            <button class="switch ${currentCase?.workflow?.operatorTrace?.enabled ? 'on' : ''}" data-action="operator-trace" title="${currentCase?.workflow?.operatorTrace?.enabled ? 'Остановить и экспортировать' : 'Начать запись'}"><span></span></button>
          </div>
          <div class="actions" style="margin-top:7px">
            <button class="action" data-action="operator-trace">${currentCase?.workflow?.operatorTrace?.enabled ? 'Остановить и экспортировать' : 'Начать запись'}</button>
            <button class="action" data-action="operator-trace-export">Экспорт текущего Trace</button>
          </div>
        </div>

        <div class="section">
          <div class="eyebrow">Нагрузка Workbench</div>
          <div class="card ${levelClass}">
            <div class="label">Текущая оценка</div>
            <div class="value">${levelLabel}</div>
            <div class="source">Считаются операции Workbench; CPU% расширения Chrome отдельно не раскрывает.</div>
          </div>
          <div class="grid" style="margin-top:7px">
            <div class="fact"><div class="label">DOM-сканы</div><div class="value">${total(load.scans)} · ~${Number(load.rates?.scansPerMinute || 0)}/мин</div><div class="source">средний ${avg(load.scans)} мс · фон пропущено ${hiddenSuppressed}</div></div>
            <div class="fact"><div class="label">Записи Case</div><div class="value">${Number(load.counters?.storageWrites || 0)} · ~${Number(load.rates?.writesPerMinute || 0)}/мин</div><div class="source">Case ${bytes(load.sizes?.caseBytes)}</div></div>
            <div class="fact"><div class="label">Juniper GET</div><div class="value">${total(juniper)}</div><div class="source">средний ответ ${avg(juniper)} мс</div></div>
            <div class="fact"><div class="label">Звонок / UserSide</div><div class="value">${total(calls)} GET/POST</div><div class="source">средний ответ ${avg(calls)} мс</div></div>
            <div class="fact"><div class="label">Хранилище</div><div class="value">${bytes(load.sizes?.stateBytes)}</div><div class="source">журнал ${bytes(load.sizes?.journalBytes)}</div></div>
            <div class="fact"><div class="label">Память вкладки</div><div class="value">${bytes(load.sizes?.heapBytes)}</div><div class="source">вся страница, если Chrome доступно</div></div>
            <div class="fact"><div class="label">Закрытые вкладки</div><div class="value">очищено ${Number(tabLifecycle.closedTabsCleaned || 0)}</div><div class="source">снимков удалено ${Number(tabLifecycle.viewDocumentsRemoved || 0)} · остановлено ${Number(tabLifecycle.pendingOperationsStopped || 0)}</div></div>
          </div>
          <div class="card" style="margin-top:7px">
            <div class="label">Холодный запуск</div>
            <div class="source">RAIL ${milestone('rail-mounted')} · Case ${milestone('store-ready')} · контекст ${milestone('first-context')} · Juniper ${milestone('juniper-result')}</div>
          </div>
          <div class="actions" style="margin-top:7px">
            <button class="action" data-action="performance-refresh">Обновить</button>
            <button class="action" data-action="performance-reset">Сбросить</button>
          </div>
        </div>

        <div class="section">
          <div class="eyebrow">Кейс</div>
          <div class="actions">
            <button class="action primary" data-action="export">${icon('download')} Экспорт JSON</button>
            <button class="action danger" data-action="reset">${icon('trash')} Очистить</button>
          </div>
        </div>

        <div class="section">
          <div class="card">
            <div class="label">Версия</div>
            <div class="value">SIMNET Workbench ${WB.version}</div>
            <div class="source">Cross-system handoff · on-demand Guide Mode · strict route</div>
          </div>
        </div>
      `;
    }

    collapseForNavigation() {
      const wasOpen = Boolean(this.activeView || this.hoverOpen);
      this.activeView = null;
      this.hoverOpen = false;
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
      if (wasOpen) this.render();
      return wasOpen;
    }

    openView(view) {
      const target = String(view || '').toLowerCase();
      if (target === 'call') {
        const currentCase = this.activeCase();
        if (!currentCase?.id) return Promise.resolve({ ok: false, reason: 'case-missing' });
        this.activeView = 'call';
        this.render();
        return WB.callRegistration?.open?.(currentCase) || Promise.resolve({ ok: false, reason: 'call-module-missing' });
      }
      if (target === 'graph') {
        this.activeView = 'graph';
        this.render();
        WB.graphStudio?.open?.({ mode: 'runtime' });
        return Promise.resolve({ ok: true });
      }
      if (target === 'live') {
        this.activeView = 'live';
        this.state.ui = { ...(this.state.ui || {}), section: 'live', open: false };
        window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'live' } }));
        this.render();
        return Promise.resolve({ ok: true });
      }
      if (target === 'full') {
        this.activeView = 'full';
        this.fullSection = this.normalizeFullSection(this.fullSection || this.state?.ui?.section);
        if (this.state) this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false };
        window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'full' } }));
        this.render();
        return Promise.resolve({ ok: true });
      }
      this.closeView();
      return Promise.resolve({ ok: true });
    }

    closeView() {
      if (this.activeView === 'call') WB.callRegistration?.close?.();
      if (this.activeView === 'graph') WB.graphStudio?.close?.();
      this.activeView = null;
      this.hoverOpen = false;
      this.render();
    }

    uiState() {
      return {
        activeView: this.activeView,
        railCount: document.querySelectorAll(`#${HOST_ID}`).length,
        backdropCount: this.shadow?.querySelectorAll('.view-backdrop.show').length || 0,
        drawerOpen: Boolean(this.shadow?.querySelector('.shell.open')),
        callOpen: Boolean(document.getElementById('simnet-workbench-call-registration-host')),
        graphOpen: Boolean(WB.graphStudio?.isOpen?.())
      };
    }

    chip(label, value) {
      return value
        ? `<span class="chip"><strong>${esc(label)}:</strong> ${esc(value)}</span>`
        : '';
    }

    factCard(label, fact) {
      const value = valueOf(fact);
      const source = fact?.source || '';
      const confidence = Number(fact?.confidence);

      return `
        <div class="fact">
          <div class="label">${esc(label)}</div>
          <div class="value ${value ? '' : 'empty'}">${esc(value || '—')}</div>
          <div class="source">
            ${esc(source || 'не найдено')}
            ${Number.isFinite(confidence) ? `<span class="confidence"> · ${Math.round(confidence * 100)}%</span>` : ''}
          </div>
        </div>
      `;
    }

    async copy(text) {
      if (!text) return this.toast('Нечего копировать');

      try {
        await navigator.clipboard.writeText(String(text));
        this.toast('Скопировано');
      } catch {
        this.toast('Буфер обмена недоступен');
      }
    }

    exportCase() {
      const currentCase = this.activeCase();
      if (!currentCase) return this.toast('Нет активного кейса');

      const blob = new Blob(
        [JSON.stringify(currentCase, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download =
        `simnet-workbench-${String(currentCase.id).replace(/[^a-z0-9_-]+/gi, '_')}.json`;
      anchor.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast('Кейс экспортирован');
    }

    async resetCase() {
      if (!confirm('Очистить текущий кейс Workbench?')) return;

      await WB.store.resetActiveCase();
      this.toast('Кейс очищен и будет создан заново');
    }

    toast(message) {
      const node = this.shadow.querySelector('.toast');
      node.textContent = message;
      node.classList.add('show');

      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(
        () => node.classList.remove('show'),
        1800
      );
    }

    destroy() {
      clearTimeout(this.toastTimer);
      clearTimeout(this.hoverCloseTimer);
      this.unsub?.();
      this.unsubContextWorkflow?.();
      this.unsubGuide?.();
      this.unsubTerminalView?.();
      this.unsubTerminalInterpreted?.();
      this.unsubGuardBlocked?.();
      this.unsubPollStarted?.();
      this.unsubPollResolved?.();
      window.removeEventListener?.('simnet-workbench-diagnostics-changed', this.boundDiagnosticsChanged);
      window.removeEventListener?.('simnet-workbench-module-open', this.boundModuleOpen);
      window.removeEventListener?.('simnet-workbench-module-close', this.boundModuleClose);
      globalThis.document?.removeEventListener?.('keydown', this.boundShellKeydown, true);
      this.host?.remove();
    }
  }

  WB.rail = new RailPanel();
})();
