(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  // Loader may set a lazy stub on WB.graphStudio; only block real double-init.
  if (!WB || window.top !== window.self || WB.__graphStudioLoaded) return;
  WB.__graphStudioLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const UI_STORAGE_KEY = 'simnet_graph_studio_ui_v1';
  const RAIL_WIDTH = 64;
  const MIN_WIDTH = 760;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const safeIdPart = value => String(value || 'node').toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[^a-z]+/, 'a_')
    .slice(0, 48) || 'node';
  const token = prefix => `${safeIdPart(prefix)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

  const state = {
    host: null,
    shadow: null,
    panel: null,
    launcher: null,
    open: false,
    mode: 'runtime',
    expanded: false,
    width: Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.72)),
    zoom: 0.9,
    graph: null,
    bundle: null,
    selectedTypeId: '',
    selectedNodeId: '',
    semanticContextId: 'access',
    semanticSelectedNodeId: 'ctx.access',
    dirty: false,
    busy: false,
    validation: null,
    originalMarginRight: '',
    originalTransition: '',
    toastTimer: 0,
    autoFitPending: false
  };

  function styles() {
    return `<style>
      :host{all:initial;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eef7}
      *{box-sizing:border-box}button,input,textarea,select{font:inherit}
      .launcher{position:fixed;right:${RAIL_WIDTH + 10}px;bottom:58px;z-index:2147483606;height:38px;min-width:82px;padding:0 11px;display:grid;grid-template-columns:18px auto;align-items:center;gap:7px;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:rgba(18,24,32,.97);color:#f7f9fb;box-shadow:0 10px 28px rgba(0,0,0,.28);font-weight:700;font-size:12px;cursor:pointer}
      .launcher:hover{background:#202a38;border-color:rgba(96,165,250,.42)}.launcher svg{width:18px;height:18px;fill:none;stroke:#60a5fa;stroke-width:1.7}
      .module{position:fixed;top:0;right:${RAIL_WIDTH}px;bottom:0;z-index:2147483604;display:none;min-width:${MIN_WIDTH}px;background:#0c111a;border-left:1px solid #283548;box-shadow:-18px 0 50px rgba(0,0,0,.38)}
      .module.open{display:grid;grid-template-rows:58px 1fr}.resizer{position:absolute;left:-6px;top:0;bottom:0;width:12px;cursor:col-resize;z-index:5}.expanded .resizer{display:none}
      .topbar{display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid #263244;background:linear-gradient(180deg,#151d29,#111821)}
      .brand{display:flex;align-items:center;gap:10px;min-width:210px}.brand-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#172a45;border:1px solid #2a4b74;color:#7bb6ff;font-weight:900}.brand b,.brand small{display:block}.brand b{font-size:14px}.brand small{margin-top:2px;color:#8291a6;font-size:9px}
      .status{display:flex;align-items:center;gap:7px;min-width:0;margin-right:auto}.chip{padding:5px 8px;border-radius:999px;border:1px solid #34445a;background:#192332;color:#aab8c9;font-size:9px;font-weight:800;white-space:nowrap}.chip.ok{border-color:#245b45;background:#102d23;color:#75dda8}.chip.warn{border-color:#6e5522;background:#312610;color:#eac678}.chip.bad{border-color:#713a46;background:#351820;color:#f0a0b1}
      .actions{display:flex;align-items:center;gap:6px}.btn,.icon-btn{border:1px solid #344359;background:#1a2432;color:#dce7f5;border-radius:8px;height:32px;padding:0 10px;font-size:10px;font-weight:800;cursor:pointer}.btn:hover,.icon-btn:hover{border-color:#5b7aa2;background:#223047}.btn.primary{border-color:#2f70c4;background:#2468b9;color:#fff}.btn.success{border-color:#25714d;background:#17603f}.btn.danger{border-color:#733b47;color:#f2a2b2}.btn:disabled{opacity:.45;cursor:wait}.icon-btn{width:32px;padding:0;font-size:15px}
      .workspace{min-height:0;display:grid;grid-template-columns:220px minmax(390px,1fr) 330px;background:#0c111a}.sidebar,.inspector{min-height:0;overflow:auto;background:#111823}.sidebar{border-right:1px solid #273346}.inspector{border-left:1px solid #273346}.pane-head{position:sticky;top:0;z-index:2;padding:13px;background:#111823;border-bottom:1px solid #273346}.eyebrow{color:#71839a;font-size:8px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.pane-head h2{margin:4px 0 3px;font-size:14px}.pane-head p{margin:0;color:#7f8fa5;font-size:9px;line-height:1.4}
      .type-list{display:grid;gap:6px;padding:9px}.type-card{width:100%;text-align:left;padding:10px;border:1px solid #2c394d;border-radius:10px;background:#151e2b;color:#dce6f4;cursor:pointer}.type-card:hover,.type-card.active{border-color:#4f88cc;background:#172b43}.type-card b,.type-card small{display:block}.type-card b{font-size:10.5px}.type-card small{margin-top:3px;color:#8291a5;font-size:8.5px;line-height:1.35}.type-card .count{float:right;color:#6faef8}
      .side-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 9px 9px}.side-actions .btn{padding:0 6px}
      .canvas-pane{min-width:0;min-height:0;display:grid;grid-template-rows:46px 1fr}.canvas-toolbar{display:flex;align-items:center;gap:8px;padding:0 11px;border-bottom:1px solid #273346;background:#101721}.canvas-toolbar .title{margin-right:auto}.canvas-toolbar b,.canvas-toolbar small{display:block}.canvas-toolbar b{font-size:11px}.canvas-toolbar small{margin-top:1px;color:#77889e;font-size:8px}.zoom{display:flex;align-items:center;gap:4px;color:#8ca0b9;font-size:9px}
      .canvas-scroll{position:relative;min-height:0;overflow:auto;background-color:#0d141e;background-image:radial-gradient(#253246 1px,transparent 1px);background-size:20px 20px}.canvas-stage{position:relative;min-width:900px;min-height:100%;padding:30px;transform-origin:0 0}.edge-layer{position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:0}.edge-layer path{fill:none;stroke:#38516f;stroke-width:1.5}.edge-layer path.selected{stroke:#63a9ff;stroke-width:2.3;filter:drop-shadow(0 0 3px rgba(99,169,255,.4))}
      .columns{position:relative;z-index:1;display:flex;align-items:flex-start;gap:70px;min-width:max-content}.level{width:230px;display:grid;align-content:start;gap:18px}.level-title{color:#667991;font-size:8px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.node-card{position:relative;width:230px;text-align:left;padding:11px;border:1px solid #34445a;border-radius:12px;background:#16202d;color:#e4edf8;box-shadow:0 8px 22px rgba(0,0,0,.18);cursor:pointer}.node-card:hover{border-color:#52769e}.node-card.selected{border-color:#6eafff;box-shadow:0 0 0 2px rgba(91,164,255,.14),0 10px 28px rgba(0,0,0,.28)}.node-card.outcome{border-color:#2f624d;background:#13271f}.node-card .kind{display:flex;justify-content:space-between;color:#7890aa;font-size:7.5px;font-weight:900;text-transform:uppercase}.node-card h3{margin:6px 0 8px;font-size:11px;line-height:1.35}.edge-label{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.07);color:#9eb0c5;font-size:8px}.edge-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.edge-label b{color:#6faef8;font-weight:800}.edge-label.conditional:before{content:"если";padding:2px 4px;border-radius:4px;background:#4b3b17;color:#e9c36c;font-size:6.5px;font-weight:900}.orphan{border-color:#6d4d29!important}.empty-canvas{margin:60px auto;padding:18px;max-width:360px;text-align:center;border:1px dashed #3d4b5d;border-radius:12px;color:#8090a5}
      .form{padding:12px}.form-section{margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #273346}.form-section:last-child{border-bottom:0}.form h3{margin:0 0 9px;font-size:11px}.field{display:block;margin:9px 0}.field span{display:block;margin-bottom:4px;color:#8496ad;font-size:8px;font-weight:800}.field input,.field textarea,.field select{width:100%;border:1px solid #35465d;border-radius:7px;background:#0d141e;color:#e4edf8;outline:none}.field input,.field select{height:32px;padding:0 8px}.field textarea{min-height:66px;padding:8px;resize:vertical;line-height:1.4}.field input:focus,.field textarea:focus,.field select:focus{border-color:#5e9ce6;box-shadow:0 0 0 2px rgba(73,143,225,.12)}.field input[readonly]{color:#74859a;background:#101721}.two{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .option-editor{margin:8px 0;padding:9px;border:1px solid #334258;border-radius:9px;background:#141d29}.option-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.option-head b{font-size:9px}.mini{height:24px;padding:0 7px;border:1px solid #3c4b60;border-radius:6px;background:#192434;color:#cdd9e8;font-size:8px;font-weight:800;cursor:pointer}.mini.danger{color:#eca2b0;border-color:#653845}.condition-box{margin-top:8px;padding-top:8px;border-top:1px dashed #394a61}.condition-box .note{color:#73859c;font-size:7.5px;line-height:1.4}.validation{max-height:170px;overflow:auto;padding:9px 12px;border-top:1px solid #273346;background:#0f1620}.validation b{font-size:9px}.validation ul{margin:6px 0 0;padding-left:16px}.validation li{margin:3px 0;color:#e99baa;font-size:8px;line-height:1.35}.validation li.warning{color:#d9b96c}.validation.good{color:#73d6a4}.toast{position:fixed;right:72px;bottom:18px;z-index:2147483647;max-width:340px;padding:10px 13px;border:1px solid #41658e;border-radius:9px;background:#162538;color:#e8f2ff;box-shadow:0 12px 30px rgba(0,0,0,.35);font-size:10px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.16s}.toast.show{opacity:1;transform:none}
      @media(max-width:1100px){.workspace{grid-template-columns:185px minmax(340px,1fr) 290px}.level,.node-card{width:205px}.columns{gap:50px}}
    </style>`;
  }

  function plumStyles() {
    return `<style>
      :host{color-scheme:light;color:#1D2939;--plum:#A50046;--plum-hover:#870039;--plum-soft:#FFF1F6}
      .launcher{display:none!important}
      .backdrop{
        position:fixed;inset:0;z-index:2147483602;display:none;background:rgba(22,29,41,.28);
        backdrop-filter:blur(2px) saturate(.9);opacity:0;transition:opacity .18s ease
      }
      .backdrop.open{display:block;opacity:1}
      .module{
        top:50%;left:50%;right:auto;bottom:auto;width:min(90vw,1540px);height:88vh;min-width:760px;
        transform:translate(-50%,-50%) scale(.988);opacity:0;border:1px solid #DDE2E8;border-radius:20px;
        overflow:hidden;background:#F8FAFC;box-shadow:0 32px 90px rgba(16,24,40,.26),0 4px 14px rgba(16,24,40,.08);
        transition:opacity .16s ease,transform .18s ease;z-index:2147483604
      }
      .module.open{display:grid;grid-template-rows:62px 1fr;opacity:1;transform:translate(-50%,-50%) scale(1)}
      .module.expanded{width:calc(100vw - ${RAIL_WIDTH + 24}px)!important;height:calc(100vh - 24px)!important;border-radius:16px}
      .resizer{display:none!important}
      .topbar{padding:0 16px;border-bottom:1px solid #E4E7EC;background:linear-gradient(180deg,#FFFFFF,#FCFCFD);color:#1D2939}
      .brand{min-width:240px}.brand-mark{background:var(--plum);border-color:var(--plum);color:#fff;box-shadow:0 6px 14px rgba(165,0,70,.18)}
      .brand b{color:#1D2939;font-size:14px}.brand small{color:#667085}
      .chip{border-color:#E4E7EC;background:#F9FAFB;color:#667085}.chip.ok{border-color:#ABEFC6;background:#ECFDF3;color:#067647}.chip.warn{border-color:#FEDF89;background:#FFFAEB;color:#B54708}.chip.bad{border-color:#FECDCA;background:#FEF3F2;color:#B42318}
      .btn,.icon-btn{border-color:#D0D5DD;background:#fff;color:#344054;box-shadow:0 1px 2px rgba(16,24,40,.04)}
      .btn:hover,.icon-btn:hover{border-color:#98A2B3;background:#F9FAFB}.btn.primary{border-color:var(--plum);background:var(--plum);color:#fff}.btn.primary:hover{background:var(--plum-hover)}
      .btn.success{border-color:#079455;background:#079455;color:#fff}.btn.danger{border-color:#FECDCA;color:#B42318;background:#FFF8F7}
      .workspace{grid-template-columns:220px minmax(430px,1fr) 340px;background:#F8FAFC}
      .sidebar,.inspector{background:#fff}.sidebar{border-right-color:#E4E7EC}.inspector{border-left-color:#E4E7EC}
      .pane-head{background:#fff;border-bottom-color:#E4E7EC}.eyebrow{color:#98A2B3}.pane-head h2{color:#1D2939}.pane-head p{color:#667085}
      .type-card{border-color:#E4E7EC;background:#fff;color:#344054;box-shadow:0 1px 2px rgba(16,24,40,.02)}.type-card:hover{border-color:#D5A0B7;background:#FFF8FB}.type-card.active{border-color:#C86B91;background:var(--plum-soft);box-shadow:0 0 0 2px rgba(165,0,70,.06)}
      .type-card small{color:#667085}.type-card .count{color:var(--plum)}
      .canvas-pane{background:#fff}.canvas-toolbar{border-bottom-color:#E4E7EC;background:#fff}.canvas-toolbar b{color:#1D2939}.canvas-toolbar small,.zoom{color:#667085}
      .canvas-scroll{background-color:#FAFBFC;background-image:radial-gradient(#D8DEE7 1px,transparent 1px);background-size:20px 20px}
      .edge-layer path{stroke:#B9C2CE;stroke-width:1.6}.edge-layer path.selected{stroke:var(--plum);stroke-width:2.35;filter:drop-shadow(0 0 3px rgba(165,0,70,.18))}
      .level-title{color:#98A2B3}
      .node-card{border-color:#D0D5DD;background:#fff;color:#344054;box-shadow:0 8px 22px rgba(16,24,40,.07)}.node-card:hover{border-color:#C86B91}.node-card.selected{border-color:var(--plum);box-shadow:0 0 0 3px rgba(165,0,70,.08),0 12px 28px rgba(16,24,40,.09)}
      .node-card.outcome{border-color:#ABEFC6;background:#F6FEF9}.node-card .kind{color:#98A2B3}.node-card h3{color:#1D2939}.edge-label{border-top-color:#EAECF0;color:#667085}.edge-label b{color:var(--plum)}.edge-label.conditional:before{background:#FFFAEB;color:#B54708}
      .orphan{border-color:#FEC84B!important}.empty-canvas{border-color:#D0D5DD;color:#667085;background:#fff}
      .form{color:#344054}.form-section{border-bottom-color:#E4E7EC}.form h3{color:#1D2939}.field span{color:#667085}.field input,.field textarea,.field select{border-color:#D0D5DD;background:#fff;color:#1D2939}.field input:focus,.field textarea:focus,.field select:focus{border-color:#C34C7D;box-shadow:0 0 0 3px rgba(165,0,70,.08)}.field input[readonly]{color:#667085;background:#F9FAFB}
      .option-editor{border-color:#E4E7EC;background:#FCFCFD}.mini{border-color:#D0D5DD;background:#fff;color:#475467}.mini.danger{color:#B42318;border-color:#FECDCA}.condition-box{border-top-color:#D0D5DD}.condition-box .note{color:#98A2B3}
      .validation{border-top-color:#E4E7EC;background:#F9FAFB;color:#475467}.validation li{color:#B42318}.validation li.warning{color:#B54708}.validation.good{color:#067647}
      .toast{right:${RAIL_WIDTH + 18}px;border-color:#E4E7EC;background:#fff;color:#344054;box-shadow:0 12px 30px rgba(16,24,40,.16)}
      .runtime-workspace{grid-template-columns:210px minmax(440px,1fr) 360px}.runtime-topbar .brand{min-width:280px}.runtime-inspector-body{padding:12px;display:grid;gap:10px}.runtime-card{padding:12px;border:1px solid #E4E7EC;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025)}.runtime-card h3{margin:4px 0 8px;font-size:13px;color:#1D2939}.runtime-card p{margin:8px 0 0;color:#667085;font-size:10px;line-height:1.5}.runtime-card.hint{display:grid;gap:4px;background:#FFF8FB;border-color:#E9C2D2}.runtime-card.hint b{color:#6D1438}.runtime-card.hint span,.runtime-note{color:#667085;font-size:9px;line-height:1.45}.runtime-status{display:inline-flex;padding:4px 7px;border-radius:999px;background:#F2F4F7;color:#667085;font-size:8px;font-weight:900;text-transform:uppercase}.runtime-status.current{background:var(--plum-soft);color:#8A1847}.runtime-status.done{background:#ECFDF3;color:#067647}.node-card.current{border-color:var(--plum);box-shadow:0 0 0 3px rgba(165,0,70,.08),0 12px 28px rgba(16,24,40,.09)}.node-card.done{border-color:#ABEFC6;background:#F6FEF9}.node-card.todo{opacity:.82}.node-card.done .kind{color:#067647}.node-card.current .kind{color:var(--plum)}.next-action{display:grid;gap:3px;margin-top:10px;padding:8px 9px;border-left:3px solid var(--plum);background:#FFF5F8;border-radius:0 8px 8px 0}.next-action b{color:#6D1438;font-size:8px;text-transform:uppercase}.next-action span{color:#344054;font-size:10px}.runtime-options{display:grid;gap:5px;margin-top:10px}.runtime-options>div{display:flex;justify-content:space-between;gap:8px;padding:6px 7px;border:1px solid #EAECF0;border-radius:8px;background:#FCFCFD;color:#475467;font-size:9px}.runtime-options b{color:var(--plum)}.evidence-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}.evidence-grid>div{min-width:0;padding:7px;border:1px solid #EAECF0;border-radius:8px;background:#FCFCFD}.evidence-grid span{display:block;color:#98A2B3;font-size:7.5px;text-transform:uppercase}.evidence-grid b{display:block;margin-top:2px;color:#344054;font-size:9px;overflow-wrap:anywhere}.runtime-journal{display:grid;gap:5px;margin-top:8px}.runtime-journal>div{display:grid;gap:2px;padding:6px 0;border-bottom:1px solid #EAECF0}.runtime-journal>div:last-child{border-bottom:0}.runtime-journal span{color:#98A2B3;font-size:7.5px;text-transform:uppercase}.runtime-journal b{color:#475467;font-size:9px;font-weight:650;line-height:1.35}.runtime-empty{padding:10px;color:#98A2B3;font-size:9px;text-align:center}.runtime-inspector{background:#FCFCFD}
      @media(max-width:1100px){.workspace{grid-template-columns:190px minmax(360px,1fr) 300px}.module{width:calc(100vw - 92px);height:90vh;min-width:0}.level,.node-card{width:205px}.columns{gap:50px}}
      @media(prefers-reduced-motion:reduce){.backdrop,.module{transition:none!important}}
      /* Runtime graph-first layout */
      .runtime-graph-first{display:grid;min-height:0;background:#F8FAFC}
      .rt-scroll{overflow:auto;padding:18px 22px 28px;min-height:0}
      .rt-hero{max-width:720px;margin:24px auto;text-align:center}
      .rt-hero-title{font-size:18px;font-weight:800;color:#1D2939}
      .rt-hero-sub{margin-top:6px;color:#667085;font-size:12px;line-height:1.45}
      .rt-symptoms{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:18px;text-align:left}
      .rt-symptom{display:grid;gap:4px;padding:12px 14px;border:1px solid #E4E7EC;border-radius:12px;background:#fff;cursor:pointer;text-align:left;box-shadow:0 1px 2px rgba(16,24,40,.04)}
      .rt-symptom:hover{border-color:#C86B91;background:var(--plum-soft)}
      .rt-symptom b{color:#1D2939;font-size:13px}.rt-symptom small{color:#667085;font-size:11px;line-height:1.4}
      .rt-root{max-width:820px;margin:0 auto 14px}
      .rt-symptom-badge{display:inline-flex;padding:8px 14px;border-radius:999px;background:var(--plum-soft);color:#8A1847;font-weight:800;font-size:13px;border:1px solid #E9C2D2}
      .rt-context{margin-top:12px;padding:10px 12px;border:1px solid #E4E7EC;border-radius:12px;background:#fff}
      .rt-context-label{color:#667085;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}
      .rt-chips,.rt-side-evidence{display:flex;flex-wrap:wrap;gap:6px}
      .rt-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:999px;border:1px solid #E4E7EC;background:#F9FAFB;color:#667085;font-size:11px;font-weight:700}
      .rt-chip.ok{border-color:#ABEFC6;background:#ECFDF3;color:#067647}
      .rt-chip.warn{border-color:#FEDF89;background:#FFFAEB;color:#B54708}
      .rt-chip.err{border-color:#FECDCA;background:#FEF3F2;color:#B42318}
      .rt-path{max-width:820px;margin:0 auto;display:grid;gap:10px}
      .rt-step{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:12px 14px;border:1px solid #E4E7EC;border-radius:14px;background:#fff}
      .rt-step.done{border-color:#ABEFC6;background:#F6FEF9}
      .rt-step.current{border-color:var(--plum);box-shadow:0 0 0 3px rgba(165,0,70,.08)}
      .rt-step-index{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#F2F4F7;color:#667085;font-size:11px;font-weight:800}
      .rt-step.done .rt-step-index{background:#DCFAE6;color:#067647}
      .rt-step.current .rt-step-index{background:var(--plum);color:#fff}
      .rt-step-q{font-size:13px;font-weight:800;color:#1D2939}
      .rt-step-a{margin-top:4px;color:#067647;font-size:12px;font-weight:700}
      .rt-step-hint{margin-top:4px;color:#667085;font-size:11px;line-height:1.4}
      .rt-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:10px}
      .rt-option{display:grid;gap:3px;padding:10px 12px;border:1px solid #E4E7EC;border-radius:10px;background:#FCFCFD;cursor:pointer;text-align:left}
      .rt-option:hover{border-color:var(--plum);background:var(--plum-soft)}
      .rt-option b{color:#1D2939;font-size:12px}.rt-option small{color:#667085;font-size:10px}
      .rt-outcome{margin-top:8px;padding:10px;border-radius:10px;background:#F6FEF9;border:1px solid #ABEFC6}
      .rt-outcome b{color:#067647;font-size:13px}.rt-outcome p{margin:6px 0 0;color:#344054;font-size:12px;line-height:1.45}
      .rt-toolbar{max-width:820px;margin:14px auto 0;display:flex;flex-wrap:wrap;gap:8px}
      .rt-side-evidence{max-width:820px;margin:12px auto 0}
      .rt-evidence-trail{max-width:820px;margin:0 auto 14px;padding:10px 12px;border:1px solid #E4E7EC;border-radius:12px;background:#fff}
      .rt-evidence-trail-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:#667085;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
      .rt-evidence-chain{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
      .rt-evidence-node{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid #ABEFC6;border-radius:999px;background:#ECFDF3;color:#067647;font-size:10px;font-weight:750}
      .rt-evidence-node.attention{border-color:#FEDF89;background:#FFFAEB;color:#B54708}
      .rt-evidence-arrow{color:#98A2B3;font-size:11px}
      .rt-evidence-empty{color:#98A2B3;font-size:10px}
      .rt-layout{display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:16px;align-items:start;max-width:1000px;margin:0 auto}
      .rt-main{min-width:0}
      .rt-minimap{position:sticky;top:8px;padding:10px;border:1px solid #E4E7EC;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04)}
      .rt-minimap-head{margin-bottom:8px;color:#667085;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
      .rt-minimap-chain{display:flex;flex-direction:column;align-items:stretch;gap:0}
      .rt-minimap-node{display:block;padding:5px 7px;border-radius:7px;border:1px solid #E4E7EC;background:#F9FAFB;color:#475467;font-size:9px;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .rt-minimap-node.done{border-color:#ABEFC6;background:#ECFDF3;color:#067647}
      .rt-minimap-node.current{border-color:var(--plum);background:var(--plum-soft);color:#8A1847}
      .rt-minimap-node.outcome{border-color:#ABEFC6;background:#F6FEF9;color:#067647}
      .rt-minimap-node.next{border-style:dashed;color:#98A2B3;font-weight:600}
      .rt-minimap-link{display:block;width:1px;height:8px;margin:0 auto;background:#D0D5DD}
      @media(max-width:900px){.rt-layout{grid-template-columns:1fr}.rt-minimap{position:static}}
    </style>`;
  }


  function semanticStyles() {
    return `<style>
      .semantic-shell{min-height:0;display:grid;grid-template-columns:210px minmax(480px,1fr) 320px;background:#FCFCFD;color:#101828}
      .semantic-side,.semantic-inspector{min-height:0;overflow:auto;background:#fff}.semantic-side{border-right:1px solid #EAECF0}.semantic-inspector{border-left:1px solid #EAECF0}
      .semantic-head{position:sticky;top:0;z-index:3;padding:14px;background:#fff;border-bottom:1px solid #EAECF0}.semantic-head .eyebrow{color:#A30B4F}.semantic-head h2{margin:4px 0;font-size:14px;color:#101828}.semantic-head p{margin:0;color:#667085;font-size:10px;line-height:1.45}
      .semantic-contexts{display:grid;gap:6px;padding:10px}.semantic-context{width:100%;padding:9px 10px;text-align:left;border:1px solid #EAECF0;border-radius:10px;background:#fff;color:#344054;cursor:pointer}.semantic-context:hover,.semantic-context.active{border-color:#A30B4F;background:#FFF4F7}.semantic-context b,.semantic-context small{display:block}.semantic-context b{font-size:11px}.semantic-context small{margin-top:3px;color:#667085;font-size:9px;line-height:1.35}
      .semantic-canvas-pane{min-width:0;min-height:0;display:grid;grid-template-rows:48px 1fr}.semantic-toolbar{display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #EAECF0;background:#fff}.semantic-toolbar .title{margin-right:auto}.semantic-toolbar b,.semantic-toolbar small{display:block}.semantic-toolbar b{font-size:12px;color:#101828}.semantic-toolbar small{margin-top:2px;color:#667085;font-size:9px}
      .semantic-scroll{position:relative;min-height:0;overflow:auto;background-color:#F9FAFB;background-image:radial-gradient(#D0D5DD 1px,transparent 1px);background-size:22px 22px}.semantic-stage{position:relative;min-width:980px;min-height:100%;padding:32px;transform-origin:0 0}.semantic-edges{position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:0}.semantic-edges path{fill:none;stroke:#98A2B3;stroke-width:1.3}.semantic-edges path.selected{stroke:#A30B4F;stroke-width:2}.semantic-edges text{font-size:8px;fill:#667085;paint-order:stroke;stroke:#F9FAFB;stroke-width:4px;stroke-linejoin:round}
      .semantic-columns{position:relative;z-index:1;display:flex;align-items:flex-start;gap:62px;min-width:max-content}.semantic-level{width:218px;display:grid;align-content:start;gap:14px}.semantic-level-title{color:#667085;font-size:8px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
      .semantic-node{position:relative;width:218px;padding:10px 11px;text-align:left;border:1px solid #D0D5DD;border-radius:11px;background:#fff;color:#101828;box-shadow:0 1px 2px rgba(16,24,40,.05);cursor:pointer}.semantic-node:hover{border-color:#A30B4F}.semantic-node.selected{border-color:#A30B4F;box-shadow:0 0 0 2px rgba(163,11,79,.10)}.semantic-node.operation{background:#FFF4F7;border-color:#E7A5C0}.semantic-node.gate{background:#FFFAEB;border-color:#FEDF89}.semantic-node.fact,.semantic-node.state{background:#F6FEF9;border-color:#ABEFC6}.semantic-node.context{background:#F9F5FF;border-color:#D6BBFB}.semantic-node.root{background:#A30B4F;border-color:#A30B4F;color:#fff}
      .semantic-node .kind{display:flex;justify-content:space-between;gap:6px;font-size:7.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#667085}.semantic-node.root .kind{color:#FCE7F0}.semantic-node h3{margin:5px 0 0;font-size:11px;line-height:1.35}.semantic-node .op{margin-top:6px;padding-top:6px;border-top:1px solid rgba(152,162,179,.25);font-size:8px;color:#A30B4F;font-weight:800}
      .semantic-detail{padding:12px}.semantic-card{margin-bottom:12px;padding:11px;border:1px solid #EAECF0;border-radius:11px;background:#fff}.semantic-card h3{margin:4px 0 7px;font-size:13px;color:#101828}.semantic-card p{margin:0;color:#475467;font-size:10px;line-height:1.5}.semantic-kv{display:grid;gap:7px;margin-top:10px}.semantic-kv div{padding-top:7px;border-top:1px solid #F2F4F7}.semantic-kv span,.semantic-kv b{display:block}.semantic-kv span{color:#667085;font-size:8px;text-transform:uppercase;font-weight:800}.semantic-kv b{margin-top:2px;color:#344054;font-size:9px;line-height:1.4}.semantic-rules{margin:0;padding-left:17px;color:#475467;font-size:9px;line-height:1.45}.semantic-rules li{margin:5px 0}.semantic-edge-list{display:grid;gap:6px;margin-top:8px}.semantic-edge-row{padding:7px 8px;border:1px solid #EAECF0;border-radius:8px;background:#F9FAFB;font-size:9px;color:#475467}.semantic-edge-row b{color:#A30B4F}
      @media(max-width:1100px){.semantic-shell{grid-template-columns:175px minmax(390px,1fr) 270px}.semantic-level,.semantic-node{width:195px}.semantic-columns{gap:48px}}
    </style>`;
  }

  function selectedType() {
    return state.graph?.types?.find(item => item.id === state.selectedTypeId) || null;
  }

  function selectedNode() {
    return selectedType()?.nodes?.[state.selectedNodeId] || null;
  }

  function ensureSelection() {
    const types = state.graph?.types || [];
    if (!types.some(item => item.id === state.selectedTypeId)) state.selectedTypeId = types[0]?.id || '';
    const type = selectedType();
    if (!type?.nodes?.[state.selectedNodeId]) state.selectedNodeId = type?.first || Object.keys(type?.nodes || {})[0] || '';
  }

  function validate() {
    state.validation = WB.appeals.studio.validate(state.graph || { types: [] });
    return state.validation;
  }

  function graphDepths(type) {
    const depths = new Map();
    const queue = type?.first ? [[type.first, 0]] : [];
    while (queue.length) {
      const [nodeId, depth] = queue.shift();
      if (!type.nodes[nodeId] || depths.has(nodeId)) continue;
      depths.set(nodeId, depth);
      const node = type.nodes[nodeId];
      for (const answer of node.options || []) queue.push([answer.next, depth + 1]);
    }
    const unreachable = new Set(Object.keys(type?.nodes || {}).filter(nodeId => !depths.has(nodeId)));
    const fallback = Math.max(0, ...depths.values()) + 1;
    for (const nodeId of unreachable) depths.set(nodeId, fallback);
    return { depths, unreachable };
  }

  function activeCase() {
    return WB.store?.activeCase?.() || null;
  }

  function runtimeAppeal() {
    return WB.appeals?.normalize?.(activeCase()?.appeal) || null;
  }

  function runtimeNodeStatus(nodeId) {
    if (state.mode !== 'runtime') return '';
    const appeal = runtimeAppeal();
    if (!appeal || appeal.status === 'empty') return 'todo';
    if (String(appeal.nodeId || '') === String(nodeId || '')) return 'current';
    const visited = new Set((appeal.history || []).map(item => String(item?.nodeId || '')).filter(Boolean));
    if (visited.has(String(nodeId || ''))) return 'done';
    return 'todo';
  }

  function runtimeNodeBadge(nodeId) {
    const status = runtimeNodeStatus(nodeId);
    if (status === 'current') return 'СЕЙЧАС';
    if (status === 'done') return 'ПРОЙДЕНО';
    return '';
  }

  function factValue(raw) {
    return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
  }

  function runtimeEvidenceRows(caseData) {
    if (!caseData) return [];
    const diagnostic = caseData.diagnostic || {};
    const locator = caseData.locator || {};
    const juniper = locator.sourceStatus?.juniper?.details || caseData.juniper?.details || {};
    const live = caseData.live?.oltSnapshot || {};
    const rows = [
      ['Case', caseData.id || ''],
      ['Абонент', factValue(caseData.identity?.login) || factValue(caseData.identity?.contract) || ''],
      ['IP', factValue(caseData.network?.ip) || juniper.subscriberIp || ''],
      ['Диагностика', diagnostic.stage || ''],
      ['Технология', diagnostic.subtype || diagnostic.family || factValue(caseData.network?.connectionFamily) || ''],
      ['Juniper', juniper.status || caseData.juniper?.result || locator.sourceStatus?.juniper?.result || locator.sourceStatus?.juniperPreview?.result || ''],
      ['ONU', live.onuStatus || factValue(caseData.pon?.status) || ''],
      ['OLT', live.oltName || factValue(caseData.pon?.oltName) || factValue(caseData.pon?.tmcOltName) || ''],
      ['Следующий шаг', locator.recommendation?.title || locator.recommendation?.action || ''],
      ['Завершение', locator.termination?.status || '']
    ];
    return rows.filter(([, value]) => String(value || '').trim()).slice(0, 10);
  }

  function runtimeJuniperEvidence(caseData) {
    const state = caseData?.juniper || {};
    const source = caseData?.locator?.sourceStatus?.juniper
      || caseData?.locator?.sourceStatus?.juniperPreview
      || null;
    const details = state?.details || source?.details || {};
    const result = String(state?.result || source?.result || details?.status || '');
    const read = state?.evidence?.read || null;
    const opened = state?.evidence?.opened || null;
    const verified = state?.evidence?.verified || null;
    if (!result && !read && !opened) return '';
    const rows = [
      ['Состояние', result || 'unknown'],
      ['Источник чтения', read?.source || state?.readSource || (state?.preview ? 'automatic' : '')],
      ['IP', details?.subscriberIp || ''],
      ['MAC', details?.subscriberMac || ''],
      ['BRAS', details?.brasName || details?.brasIp || ''],
      ['Session', details?.sessionId || ''],
      ['VLAN', details?.vlan || ''],
      ['Получено', read?.at || state?.readAt || state?.updatedAt || ''],
      ['Проверено parser/correlation', verified?.at || state?.verifiedAt || ''],
      ['Оператор открывал', opened?.at || state?.openedAt ? `да · ${opened?.at || state?.openedAt}` : 'нет']
    ].filter(([, value]) => String(value || '').trim());
    return `
      <section class="runtime-card juniper-evidence">
        <div class="eyebrow">Juniper · evidence node</div>
        <div class="runtime-note">Автоматический read и ручное посещение хранятся раздельно; LIVE агрегирует их в одну строку.</div>
        <div class="evidence-grid">${rows.map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>
      </section>`;
  }

  function runtimeEvidenceTrail(caseData) {
    return WB.evidenceNavigator?.trail?.(caseData) || [];
  }

  function renderRuntimeEvidenceTrail(caseData) {
    const trail = runtimeEvidenceTrail(caseData);
    return `
      <section class="rt-evidence-trail" aria-label="Пройденный технический путь">
        <div class="rt-evidence-trail-head"><span>Пройденный технический путь</span><span>${trail.length || ''}</span></div>
        <div class="rt-evidence-chain">
          ${trail.length ? trail.map((item, index) => `
            ${index ? '<span class="rt-evidence-arrow">→</span>' : ''}
            <span class="rt-evidence-node ${esc(item.level === 'attention' ? 'attention' : '')}" title="${esc(item.status || '')}">✓ ${esc(item.label)}${item.status ? ` · ${esc(item.status)}` : ''}</span>
          `).join('') : '<span class="rt-evidence-empty">Значимые технические действия ещё не зафиксированы.</span>'}
        </div>
      </section>`;
  }

  function runtimeJournal(caseData) {
    const events = Array.isArray(caseData?.journal) ? caseData.journal : [];
    return events
      .filter(item => item && !['operator_hover', 'operator_scroll'].includes(String(item.type || '')))
      .slice(-8)
      .reverse();
  }

  function runtimeInspector(type, node) {
    const caseData = activeCase();
    const appeal = runtimeAppeal();
    const status = node ? runtimeNodeStatus(node.id) : '';
    const rows = runtimeEvidenceRows(caseData);
    const journal = runtimeJournal(caseData);
    const stateLabel = status === 'current' ? 'Текущий узел' : status === 'done' ? 'Пройдено' : 'Не пройдено';
    const nodeDetails = !node ? '<div class="runtime-empty">Выбери узел на графе.</div>' : `
      <section class="runtime-card node-detail ${status}">
        <div class="eyebrow">${esc(node.kind === 'outcome' ? 'Результат ветки' : 'Узел маршрута')}</div>
        <h3>${esc(node.title)}</h3>
        <div class="runtime-status ${status}">${esc(stateLabel)}</div>
        ${node.kind === 'outcome'
          ? `<p>${esc(node.summary || 'Описание результата не заполнено.')}</p>${node.nextAction ? `<div class="next-action"><b>Следующий шаг</b><span>${esc(node.nextAction)}</span></div>` : ''}`
          : `<p>${esc(node.why || 'Этот вопрос уточняет симптом и сам по себе не является техническим доказательством.')}</p>${(node.options || []).length ? `<div class="runtime-options">${node.options.map(answer => `<div><span>${esc(answer.label)}</span><b>→ ${esc(answer.next)}</b></div>`).join('')}</div>` : ''}`}
      </section>`;
    return `
      ${nodeDetails}
      <section class="runtime-card">
        <div class="eyebrow">Технические доказательства кейса</div>
        <div class="runtime-note">Ответы в графе обращения и сетевые факты не смешиваются. Ниже — только текущие данные Case/LIVE.</div>
        <div class="evidence-grid">${rows.length ? rows.map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('') : '<div class="runtime-empty">Технических фактов пока нет.</div>'}</div>
      </section>
      ${runtimeJuniperEvidence(caseData)}
      <section class="runtime-card">
        <div class="eyebrow">Последний доказательный след</div>
        <div class="runtime-journal">${journal.length ? journal.map(item => `<div><span>${esc(item.type || 'event')}</span><b>${esc(item.message || '')}</b></div>`).join('') : '<div class="runtime-empty">Журнал кейса пока пуст.</div>'}</div>
      </section>
      ${appeal?.status === 'empty' ? '<section class="runtime-card hint"><b>Обращение ещё не выбрано.</b><span>Выбери тип жалобы в «Обращение», после чего здесь появится текущий маршрут.</span></section>' : ''}
    `;
  }

  function renderCanvas(type) {
    if (!type) return '<div class="empty-canvas">Добавь тип обращения, затем создай стартовый вопрос.</div>';
    const { depths, unreachable } = graphDepths(type);
    const groups = new Map();
    for (const [nodeId, depth] of depths) {
      if (!groups.has(depth)) groups.set(depth, []);
      groups.get(depth).push(type.nodes[nodeId]);
    }
    return `
      <svg class="edge-layer" aria-hidden="true"></svg>
      <div class="columns">
        ${[...groups.entries()].sort((a, b) => a[0] - b[0]).map(([depth, nodes]) => `
          <div class="level">
            <div class="level-title">${depth === 0 ? 'Старт' : `Шаг ${depth + 1}`}</div>
            ${nodes.map(node => `
              <button class="node-card ${esc(node.kind)} ${node.id === state.selectedNodeId ? 'selected' : ''} ${unreachable.has(node.id) ? 'orphan' : ''} ${runtimeNodeStatus(node.id)}" data-action="select-node" data-node-id="${esc(node.id)}">
                <div class="kind"><span>${node.kind === 'outcome' ? 'результат' : 'вопрос'}${runtimeNodeBadge(node.id) ? ` · ${runtimeNodeBadge(node.id)}` : ''}</span><span>${esc(node.phase)}</span></div>
                <h3>${esc(node.title)}</h3>
                ${(node.options || []).map(answer => `
                  <div class="edge-label ${answer.condition ? 'conditional' : ''}"><span>${esc(answer.label)}</span><b>→ ${esc(answer.next)}</b></div>
                `).join('')}
              </button>
            `).join('')}
          </div>
        `).join('')}
      </div>`;
  }

  function typeInspector(type) {
    if (!type) return '<div class="form"><div class="empty-canvas">Выбери или добавь тип обращения.</div></div>';
    const nodeIds = Object.keys(type.nodes || {});
    return `
      <div class="form-section">
        <div class="eyebrow">Тип обращения</div>
        <label class="field"><span>ID · устойчивый служебный ключ</span><input value="${esc(type.id)}" readonly></label>
        <label class="field"><span>Название для оператора</span><input data-type-field="label" value="${esc(type.label)}"></label>
        <label class="field"><span>Короткое описание</span><textarea data-type-field="short">${esc(type.short)}</textarea></label>
        <label class="field"><span>Первый узел</span><select data-type-field="first">${nodeIds.map(id => `<option value="${esc(id)}" ${id === type.first ? 'selected' : ''}>${esc(id)} · ${esc(type.nodes[id].title)}</option>`).join('')}</select></label>
      </div>`;
  }

  function conditionEditor(answer, index) {
    const condition = answer.condition || { fact: '', operator: 'equals', value: '' };
    const facts = WB.appeals.studio.conditionFacts;
    return `
      <div class="condition-box">
        <div class="two">
          <label class="field"><span>Условие показа ответа</span><select data-option-index="${index}" data-option-field="condition.fact"><option value="">Всегда показывать</option>${Object.entries(facts).map(([id, label]) => `<option value="${esc(id)}" ${condition.fact === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <label class="field"><span>Оператор</span><select data-option-index="${index}" data-option-field="condition.operator">
            <option value="equals" ${condition.operator === 'equals' ? 'selected' : ''}>равно</option>
            <option value="not_equals" ${condition.operator === 'not_equals' ? 'selected' : ''}>не равно</option>
            <option value="exists" ${condition.operator === 'exists' ? 'selected' : ''}>заполнено</option>
            <option value="not_exists" ${condition.operator === 'not_exists' ? 'selected' : ''}>не заполнено</option>
          </select></label>
        </div>
        <label class="field"><span>Значение условия</span><input data-option-index="${index}" data-option-field="condition.value" value="${esc(condition.value)}" ${['exists', 'not_exists'].includes(condition.operator) ? 'disabled' : ''}></label>
        <div class="note">Условие использует только уже подтверждённые факты текущего кейса. Оно скрывает неподходящий ответ, но само не ставит диагноз.</div>
      </div>`;
  }

  function nodeInspector(type, node) {
    if (!node) return '<div class="form-section"><div class="empty-canvas">Выбери узел на карте.</div></div>';
    const nodeIds = Object.keys(type.nodes || {});
    const phaseOptions = type.phases || [];
    return `
      <div class="form-section">
        <div class="eyebrow">${node.kind === 'outcome' ? 'Результат ветки' : 'Уточняющий вопрос'}</div>
        <label class="field"><span>ID узла</span><input value="${esc(node.id)}" readonly></label>
        <label class="field"><span>Этап прогресса</span><select data-node-field="phase">${phaseOptions.map(item => `<option value="${esc(item.id)}" ${item.id === node.phase ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
        <label class="field"><span>${node.kind === 'outcome' ? 'Название гипотезы' : 'Текст вопроса'}</span><textarea data-node-field="title">${esc(node.title)}</textarea></label>
        ${node.kind === 'outcome' ? `
          <label class="field"><span>Что означает результат</span><textarea data-node-field="summary">${esc(node.summary)}</textarea></label>
          <label class="field"><span>Следующий шаг оператора</span><textarea data-node-field="nextAction">${esc(node.nextAction)}</textarea></label>
          <label class="field"><span>Фокус</span><input data-node-field="focus" value="${esc(node.focus)}"></label>
        ` : `
          <label class="field"><span>Зачем задаём · простое объяснение</span><textarea data-node-field="why">${esc(node.why)}</textarea></label>
          <h3>Ответы и переходы</h3>
          ${(node.options || []).map((answer, index) => `
            <div class="option-editor">
              <div class="option-head"><b>Ответ ${index + 1}</b><button class="mini danger" data-action="delete-option" data-option-index="${index}">Удалить</button></div>
              <label class="field"><span>Текст ответа</span><input data-option-index="${index}" data-option-field="label" value="${esc(answer.label)}"></label>
              <label class="field"><span>Куда ведёт</span><select data-option-index="${index}" data-option-field="next">${nodeIds.map(id => `<option value="${esc(id)}" ${answer.next === id ? 'selected' : ''}>${esc(id)} · ${esc(type.nodes[id].title)}</option>`).join('')}</select></label>
              <label class="field"><span>Подсказка «что дальше»</span><input data-option-index="${index}" data-option-field="hint" value="${esc(answer.hint)}"></label>
              ${conditionEditor(answer, index)}
            </div>
          `).join('')}
          <button class="btn" data-action="add-option">+ Добавить ответ</button>
        `}
        <div class="actions" style="margin-top:12px"><button class="btn danger" data-action="delete-node">Удалить узел</button></div>
      </div>`;
  }

  function validationHtml() {
    const report = state.validation || validate();
    if (report.valid && !report.warnings.length) return `<div class="validation good"><b>✓ Граф корректен: ${report.stats.nodes} узлов, ${report.stats.edges} переходов</b></div>`;
    return `<div class="validation ${report.valid ? '' : 'bad'}"><b>${report.valid ? 'Можно публиковать, но есть замечания' : 'Публикация заблокирована'}</b><ul>${report.errors.map(item => `<li>${esc(item)}</li>`).join('')}${report.warnings.map(item => `<li class="warning">${esc(item)}</li>`).join('')}</ul></div>`;
  }

  function renderStudio() {
    if (!state.panel || !state.graph) return;
    ensureSelection();
    validate();
    const type = selectedType();
    const node = selectedNode();
    const report = state.validation;
    const publishedRevision = state.bundle?.published?.revision || WB.appeals.graphRevision();
    state.panel.innerHTML = `
      <div class="resizer" title="Изменить ширину Graph Studio"></div>
      <header class="topbar">
        <div class="brand"><div class="brand-mark">G</div><div><b>Graph Studio</b><small>Конструктор обращений · SIMNET Workbench</small></div></div>
        <div class="status">
          <span class="chip ${state.dirty ? 'warn' : 'ok'}">${state.dirty ? 'Есть несохранённые изменения' : 'Черновик сохранён'}</span>
          <span class="chip ${report.valid ? 'ok' : 'bad'}">${report.valid ? 'Граф корректен' : `${report.errors.length} ошибок`}</span>
          <span class="chip">Опубликовано: ${esc(publishedRevision)}</span>
        </div>
        <div class="actions">
          <button class="btn" data-action="import">Импорт</button><input data-role="import-file" type="file" accept="application/json,.json" hidden>
          <button class="btn" data-action="export">Экспорт</button>
          <button class="btn" data-action="save" ${state.busy ? 'disabled' : ''}>Сохранить черновик</button>
          <button class="btn success" data-action="publish" ${state.busy || !report.valid ? 'disabled' : ''}>Опубликовать</button>
          <button class="icon-btn" data-action="expand" title="Развернуть">${state.expanded ? '↘' : '↗'}</button>
          <button class="icon-btn" data-action="close" title="Закрыть">×</button>
        </div>
      </header>
      <div class="workspace">
        <aside class="sidebar">
          <div class="pane-head"><div class="eyebrow">Обращения</div><h2>Типы жалоб</h2><p>Каждый тип имеет собственный конечный маршрут.</p></div>
          <div class="type-list">${state.graph.types.map(item => `<button class="type-card ${item.id === state.selectedTypeId ? 'active' : ''}" data-action="select-type" data-type-id="${esc(item.id)}"><span class="count">${Object.keys(item.nodes || {}).length}</span><b>${esc(item.label)}</b><small>${esc(item.short)}</small></button>`).join('')}</div>
          <div class="side-actions"><button class="btn" data-action="add-type">+ Обращение</button><button class="btn danger" data-action="delete-type">Удалить</button></div>
          <div class="side-actions"><button class="btn" data-action="reset-draft">Отменить правки</button><button class="btn danger" data-action="restore-builtin">Стандартный граф</button></div>
        </aside>
        <main class="canvas-pane">
          <div class="canvas-toolbar"><div class="title"><b>${esc(type?.label || 'Граф не выбран')}</b><small>Кликни узел, чтобы изменить его справа</small></div><button class="btn" data-action="add-question">+ Вопрос</button><button class="btn" data-action="add-outcome">+ Результат</button><div class="zoom"><button class="mini" data-action="zoom-out">−</button><span>${Math.round(state.zoom * 100)}%</span><button class="mini" data-action="zoom-in">+</button></div></div>
          <div class="canvas-scroll"><div class="canvas-stage" style="zoom:${state.zoom}">${renderCanvas(type)}</div></div>
        </main>
        <aside class="inspector">
          <div class="pane-head"><div class="eyebrow">Свойства</div><h2>${esc(node?.title || type?.label || 'Ничего не выбрано')}</h2><p>Изменения сначала остаются в черновике.</p></div>
          <div class="form">${typeInspector(type)}${nodeInspector(type, node)}</div>
          ${validationHtml()}
        </aside>
      </div>`;
    installResize();
    requestAnimationFrame(drawEdges);
  }

  function coverageChipClass(status) {
    if (status === 'confirmed') return 'ok';
    if (status === 'conflicting') return 'err';
    if (status === 'stale') return 'warn';
    return '';
  }

  function coverageChipMark(status) {
    if (status === 'confirmed') return '✓';
    if (status === 'conflicting') return '×';
    if (status === 'stale') return '·';
    return '—';
  }

  /**
   * Compact path minimap — same Case path as the main Runtime view, not a second engine.
   * Shows traversed + current + immediate next options as small nodes.
   */
  function renderRuntimeMinimap(vm, type) {
    if (!type || !vm || vm.status === 'empty') return '';
    const history = vm.history || [];
    const current = vm.currentNode;
    const nodes = [];
    for (const item of history) {
      nodes.push({ id: item.nodeId, label: item.answer || item.question || item.nodeId, kind: 'done' });
    }
    if (current) {
      nodes.push({
        id: current.id,
        label: current.kind === 'outcome' ? (current.title || 'Итог') : 'Сейчас',
        kind: current.kind === 'outcome' ? 'outcome' : 'current'
      });
    }
    for (const opt of vm.availableOptions || []) {
      nodes.push({ id: `opt-${opt.id}`, label: opt.label, kind: 'next' });
    }
    if (!nodes.length) return '';
    const stepLabel = current?.kind === 'outcome'
      ? 'Итог'
      : `Этап ${history.length + 1} из ?`;
    return `
      <aside class="rt-minimap" aria-label="Карта пути">
        <div class="rt-minimap-head"><span>${esc(stepLabel)}</span></div>
        <div class="rt-minimap-chain">
          ${nodes.map((node, index) => `
            ${index ? '<i class="rt-minimap-link"></i>' : ''}
            <span class="rt-minimap-node ${esc(node.kind)}" title="${esc(node.label)}">${esc(node.label)}</span>
          `).join('')}
        </div>
      </aside>`;
  }

  function renderRuntimePath(vm, type) {
    if (!type || !vm || vm.status === 'empty') return '';

    const current = vm.currentNode;
    const optionsHtml = current?.kind === 'question'
      ? `<div class="rt-options">${(vm.availableOptions || []).map(opt => `
          <button type="button" class="rt-option" data-action="appeal-answer" data-answer-id="${esc(opt.id)}">
            <b>${esc(opt.label)}</b>
            ${opt.hint ? `<small>${esc(opt.hint)}</small>` : ''}
          </button>`).join('')}</div>`
      : '';
    const outcomeHtml = current?.kind === 'outcome'
      ? `<div class="rt-outcome"><b>${esc(current.title)}</b><p>${esc(current.summary || '')}</p>${current.nextAction ? `<div class="next-action"><b>Дальше</b><span>${esc(current.nextAction)}</span></div>` : ''}</div>`
      : '';

    const pathSteps = (vm.history || []).map((item, index) => `
      <div class="rt-step done">
        <div class="rt-step-index">${index + 1}</div>
        <div class="rt-step-body">
          <div class="rt-step-q">${esc(item.question)}</div>
          <div class="rt-step-a">${esc(item.answer)}</div>
        </div>
      </div>`).join('');

    return `
      <div class="rt-path">
        ${pathSteps}
        ${current ? `
          <div class="rt-step current">
            <div class="rt-step-index">${(vm.history || []).length + 1}</div>
            <div class="rt-step-body">
              <div class="rt-step-q">${esc(current.title)}</div>
              ${current.kind === 'question' ? `<div class="rt-step-hint">${esc(current.why || '')}</div>${optionsHtml}` : outcomeHtml}
            </div>
          </div>` : ''}
      </div>`;
  }

  function renderRuntime() {
    if (!state.panel || !state.graph) return;
    const caseData = activeCase();
    const appeal = runtimeAppeal();
    const appealType = WB.appeals?.typeForState?.(appeal) || null;
    const vm = WB.appeals?.resolveRuntimeGraph?.({
      appeal,
      appealType,
      caseData
    }) || { status: 'empty', types: WB.appeals?.types || [], contextCoverage: { items: [] } };

    if (appeal?.typeId) state.selectedTypeId = appeal.typeId;
    if (appeal?.nodeId) state.selectedNodeId = appeal.nodeId;

    const login = factValue(caseData?.identity?.login) || factValue(caseData?.identity?.contract) || 'нет активного абонента';
    const coverage = vm.contextCoverage?.items || [];
    // Primary context chips for the banner (Billing / UserSide / ONU-OLT / freshness).
    const primaryCoverage = coverage.filter(item => ['billing', 'userside', 'onu_olt', 'freshness'].includes(item.id));
    const sideCoverage = coverage.filter(item => ['session', 'wan_ip'].includes(item.id));

    let body = '';
    if (vm.status === 'empty') {
      const types = vm.types?.length ? vm.types : (WB.appeals?.types || []);
      body = `
        <div class="rt-hero">
          <div class="rt-hero-title">Выберите симптом</div>
          <div class="rt-hero-sub">Маршрут сохранится в Case. Открытие Graph не запускает опрос или навигацию.</div>
          <div class="rt-symptoms">${types.map(item => `
            <button type="button" class="rt-symptom" data-action="appeal-select" data-type-id="${esc(item.id)}">
              <b>${esc(item.label)}</b>
              <small>${esc(item.short || '')}</small>
            </button>`).join('')}</div>
        </div>`;
    } else {
      body = `
        <div class="rt-layout">
          <div class="rt-main">
            <div class="rt-root">
              <div class="rt-symptom-badge">Симптом: ${esc(vm.root?.label || '')}</div>
              <div class="rt-context">
                <div class="rt-context-label">Контекст уже проверен</div>
                <div class="rt-chips">${primaryCoverage.map(item => `
                  <span class="rt-chip ${coverageChipClass(item.status)}" title="${esc(item.detail || '')}">
                    ${coverageChipMark(item.status)} ${esc(item.label)}
                  </span>`).join('')}</div>
              </div>
            </div>
            ${renderRuntimePath(vm, appealType)}
            <div class="rt-toolbar">
              <button type="button" class="btn" data-action="appeal-back" ${(appeal?.history || []).length ? '' : 'disabled'}>← Назад</button>
              <button type="button" class="btn" data-action="appeal-reset">Сменить симптом</button>
              <button type="button" class="btn" data-action="fit-view">Подогнать</button>
            </div>
            ${sideCoverage.length ? `
              <div class="rt-side-evidence">${sideCoverage.map(item => `
                <span class="rt-chip ${coverageChipClass(item.status)}" title="${esc(item.detail || '')}">
                  ${coverageChipMark(item.status)} ${esc(item.label)}${item.detail ? `: ${esc(item.detail)}` : ''}
                </span>`).join('')}</div>` : ''}
          </div>
          ${renderRuntimeMinimap(vm, appealType)}
        </div>`;
    }

    state.panel.innerHTML = `
      <header class="topbar runtime-topbar">
        <div class="brand"><div class="brand-mark">G</div><div><b>Диагностический граф</b><small>${esc(login)}</small></div></div>
        <div class="status">
          <span class="chip ${appeal?.status === 'complete' || appeal?.status === 'completed' ? 'ok' : appeal?.status === 'active' ? 'warn' : ''}">${esc(
            appeal?.status === 'complete' || appeal?.status === 'completed'
              ? 'Маршрут завершён'
              : appeal?.status === 'active'
                ? 'Диагностика идёт'
                : 'Ожидание симптома'
          )}</span>
          ${vm.root?.graphRevision ? `<span class="chip">rev ${esc(String(vm.root.graphRevision).slice(-8))}</span>` : ''}
        </div>
        <div class="actions">
          <button class="btn" data-action="semantic-open">Смысловая карта</button>
          <button class="btn" data-action="zoom-out">−</button>
          <button class="btn" data-action="zoom-in">+</button>
          <button class="icon-btn" data-action="expand" title="Развернуть">${state.expanded ? '↘' : '↗'}</button>
          <button class="icon-btn" data-action="close" title="Закрыть">×</button>
        </div>
      </header>
      <div class="runtime-graph-first">
        <div class="rt-scroll">${renderRuntimeEvidenceTrail(caseData)}${body}</div>
      </div>`;
    requestAnimationFrame(() => {
      if (state.autoFitPending) {
        state.autoFitPending = false;
        fitRuntimeView();
      }
    });
  }

  function fitRuntimeView() {
    const scroll = state.shadow?.querySelector('.rt-scroll');
    const current = state.shadow?.querySelector('.rt-step.current');
    if (!scroll || !current) return;
    current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function persistAppeal(nextAppeal, transition = {}) {
    if (!WB.store?.patchAppeal) return { ok: false, reason: 'store-missing' };
    const result = await WB.store.patchAppeal(nextAppeal, transition);
    // Re-render from canonical Case after store accepts the patch.
    render();
    return result;
  }

  async function runtimeSelectSymptom(typeId) {
    const next = WB.appeals.select(typeId);
    if (!next || next.status === 'empty') return toast('Тип обращения недоступен');
    state.autoFitPending = true;
    await persistAppeal(next, { action: 'select', typeId });
  }

  async function runtimeAnswer(answerId) {
    const caseData = activeCase();
    const current = runtimeAppeal();
    if (!current || current.status === 'empty') return;
    const next = WB.appeals.answer(current, answerId, caseData, { source: 'operator' });
    if (next.nodeId === current.nodeId && (next.history || []).length === (current.history || []).length) {
      return toast('Этот ответ сейчас недоступен');
    }
    state.autoFitPending = true;
    await persistAppeal(next, { action: 'answer', answerId });
  }

  async function runtimeBack() {
    const current = runtimeAppeal();
    if (!current) return;
    const next = WB.appeals.back(current);
    state.autoFitPending = true;
    await persistAppeal(next, { action: 'back' });
  }

  async function runtimeReset() {
    const next = WB.appeals.empty();
    state.autoFitPending = false;
    await persistAppeal(next, { action: 'reset' });
  }


  function semanticModel() {
    return WB.semanticTree?.subgraph?.(state.semanticContextId || '') || null;
  }

  function semanticSelectedNode(model = semanticModel()) {
    return model?.nodes?.[state.semanticSelectedNodeId] || model?.nodes?.[model?.rootId] || null;
  }

  function semanticDepths(model) {
    const depths = new Map();
    if (!model?.rootId || !model?.nodes?.[model.rootId]) return depths;
    const queue = [[model.rootId, 0]];
    while (queue.length) {
      const [nodeId, depth] = queue.shift();
      if (!model.nodes[nodeId] || depths.has(nodeId)) continue;
      depths.set(nodeId, depth);
      for (const edge of model.edges || []) {
        if (edge.from === nodeId && !depths.has(edge.to)) queue.push([edge.to, depth + 1]);
      }
    }
    return depths;
  }

  function renderSemanticCanvas(model) {
    if (!model || !Object.keys(model.nodes || {}).length) return '<div class="empty-canvas">Смысловой контекст пуст.</div>';
    const depths = semanticDepths(model);
    const groups = new Map();
    for (const [nodeId, depth] of depths) {
      if (!groups.has(depth)) groups.set(depth, []);
      groups.get(depth).push(model.nodes[nodeId]);
    }
    return `
      <svg class="semantic-edges" aria-hidden="true"></svg>
      <div class="semantic-columns">
        ${[...groups.entries()].sort((a,b) => a[0]-b[0]).map(([depth,nodes]) => `
          <div class="semantic-level">
            <div class="semantic-level-title">${depth === 0 ? 'Case' : `Смысл ${depth}`}</div>
            ${nodes.map(node => `
              <button type="button" class="semantic-node ${esc(node.kind || '')} ${node.id === state.semanticSelectedNodeId ? 'selected' : ''}" data-action="semantic-select-node" data-semantic-node-id="${esc(node.id)}">
                <div class="kind"><span>${esc(node.kind || 'node')}</span><span>${esc(node.contextId || 'core')}</span></div>
                <h3>${esc(node.label || node.id)}</h3>
                ${node.operationId ? `<div class="op">${esc(node.operationId)}</div>` : ''}
              </button>`).join('')}
          </div>`).join('')}
      </div>`;
  }

  function semanticInspector(model, node) {
    if (!node) return '<div class="semantic-detail"><div class="semantic-card"><p>Выбери смысловой узел.</p></div></div>';
    const operation = node.operationId ? WB.semanticTree?.operation?.(node.operationId) : null;
    const outgoing = (model?.edges || []).filter(edge => edge.from === node.id);
    const incoming = (model?.edges || []).filter(edge => edge.to === node.id);
    const context = node.contextId ? WB.semanticTree?.context?.(node.contextId) : null;
    return `<div class="semantic-detail">
      <section class="semantic-card">
        <div class="eyebrow">${esc(node.kind || 'node')}</div>
        <h3>${esc(node.label || node.id)}</h3>
        <p>${esc(node.summary || '')}</p>
        <div class="semantic-kv">
          <div><span>ID</span><b>${esc(node.id)}</b></div>
          ${context ? `<div><span>Смысловой контекст</span><b>${esc(context.label)}</b></div>` : ''}
          ${operation ? `<div><span>Операция</span><b>${esc(node.operationId)} · ${esc(operation.label)}</b></div>` : ''}
          ${operation?.successEvidence?.length ? `<div><span>Успех подтверждает</span><b>${operation.successEvidence.map(esc).join('<br>')}</b></div>` : ''}
          ${operation?.ownerFiles?.length ? `<div><span>Реализация сейчас</span><b>${operation.ownerFiles.map(esc).join('<br>')}</b></div>` : ''}
        </div>
      </section>
      <section class="semantic-card">
        <div class="eyebrow">Связи</div>
        <div class="semantic-edge-list">
          ${incoming.map(edge => `<div class="semantic-edge-row">← <b>${esc(edge.label || 'из')}</b> ${esc(model.nodes?.[edge.from]?.label || edge.from)}</div>`).join('')}
          ${outgoing.map(edge => `<div class="semantic-edge-row">→ <b>${esc(edge.label || 'к')}</b> ${esc(model.nodes?.[edge.to]?.label || edge.to)}${edge.condition ? `<br><span>если: ${esc(edge.condition)}</span>` : ''}</div>`).join('')}
          ${!incoming.length && !outgoing.length ? '<div class="semantic-edge-row">Связей нет.</div>' : ''}
        </div>
      </section>
      <section class="semantic-card">
        <div class="eyebrow">Правило расширения проекта</div>
        <ul class="semantic-rules">${(WB.semanticTree?.placementRules || []).map(rule => `<li>${esc(rule)}</li>`).join('')}</ul>
      </section>
    </div>`;
  }

  function drawSemanticEdges() {
    const model = semanticModel();
    const stage = state.shadow?.querySelector('.semantic-stage');
    const svg = state.shadow?.querySelector('.semantic-edges');
    if (!model || !stage || !svg) return;
    const stageRect = stage.getBoundingClientRect();
    const zoom = state.zoom || 1;
    const width = Math.max(stage.scrollWidth, 980);
    const height = Math.max(stage.scrollHeight, 650);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    const rows = [];
    for (const edge of model.edges || []) {
      const from = state.shadow.querySelector(`[data-semantic-node-id="${CSS.escape(edge.from)}"]`);
      const to = state.shadow.querySelector(`[data-semantic-node-id="${CSS.escape(edge.to)}"]`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = (a.right - stageRect.left) / zoom;
      const y1 = (a.top + a.height / 2 - stageRect.top) / zoom;
      const x2 = (b.left - stageRect.left) / zoom;
      const y2 = (b.top + b.height / 2 - stageRect.top) / zoom;
      const bend = Math.max(26, (x2 - x1) * .45);
      const selected = edge.from === state.semanticSelectedNodeId || edge.to === state.semanticSelectedNodeId;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 - 4;
      rows.push(`<path class="${selected ? 'selected' : ''}" d="M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}"/>`);
      if (edge.label) rows.push(`<text x="${mx}" y="${my}" text-anchor="middle">${esc(edge.label)}</text>`);
    }
    svg.innerHTML = rows.join('');
  }

  function fitSemanticView() {
    const selected = state.shadow?.querySelector(`[data-semantic-node-id="${CSS.escape(state.semanticSelectedNodeId || '')}"]`);
    selected?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
  }

  function renderSemantic() {
    if (!state.panel) return;
    const model = semanticModel();
    if (!model) {
      state.panel.innerHTML = '<div class="empty-canvas">Semantic Tree не загружено.</div>';
      return;
    }
    const report = WB.semanticTree?.validate?.() || { valid: false, errors: ['validator unavailable'] };
    if (!model.nodes?.[state.semanticSelectedNodeId]) {
      state.semanticSelectedNodeId = state.semanticContextId ? `ctx.${state.semanticContextId}` : model.rootId;
      if (!model.nodes?.[state.semanticSelectedNodeId]) state.semanticSelectedNodeId = model.rootId;
    }
    const selected = semanticSelectedNode(model);
    const activeContext = WB.semanticTree?.context?.(state.semanticContextId);
    const contexts = WB.semanticTree?.snapshot?.()?.contexts || [];
    state.panel.innerHTML = `
      <header class="topbar runtime-topbar">
        <div class="brand"><div class="brand-mark">S</div><div><b>Смысловая карта Workbench</b><small>${esc(WB.semanticTree?.revision || '')}</small></div></div>
        <div class="status"><span class="chip ${report.valid ? 'ok' : 'bad'}">${report.valid ? 'Контракт цел' : `Ошибок: ${report.errors?.length || 0}`}</span></div>
        <div class="actions">
          <button class="btn" data-action="runtime-open">Диагностический граф</button>
          <button class="btn" data-action="semantic-fit">К узлу</button>
          <button class="btn" data-action="zoom-out">−</button><button class="btn" data-action="zoom-in">+</button>
          <button class="icon-btn" data-action="expand" title="Развернуть">${state.expanded ? '↘' : '↗'}</button>
          <button class="icon-btn" data-action="close" title="Закрыть">×</button>
        </div>
      </header>
      <div class="semantic-shell">
        <aside class="semantic-side">
          <div class="semantic-head"><div class="eyebrow">Semantic contexts</div><h2>Смысловые ветки</h2><p>Новая функция обязана иметь место здесь или создать новый контекст.</p></div>
          <div class="semantic-contexts">
            <button class="semantic-context ${!state.semanticContextId ? 'active' : ''}" data-action="semantic-context" data-context-id=""><b>Вся карта</b><small>Все текущие смысловые контексты.</small></button>
            ${contexts.map(ctx => `<button class="semantic-context ${ctx.id === state.semanticContextId ? 'active' : ''}" data-action="semantic-context" data-context-id="${esc(ctx.id)}"><b>${esc(ctx.label)}</b><small>${esc(ctx.summary)}</small></button>`).join('')}
          </div>
        </aside>
        <main class="semantic-canvas-pane">
          <div class="semantic-toolbar"><div class="title"><b>${esc(activeContext?.label || model.title || 'Смысловая карта')}</b><small>${esc(activeContext?.summary || model.purpose || '')}</small></div><span class="chip">${Object.keys(model.nodes || {}).length} узлов</span><span class="chip">${(model.edges || []).length} связей</span></div>
          <div class="semantic-scroll"><div class="semantic-stage" style="zoom:${state.zoom}">${renderSemanticCanvas(model)}</div></div>
        </main>
        <aside class="semantic-inspector">
          <div class="semantic-head"><div class="eyebrow">Смысл узла</div><h2>${esc(selected?.label || 'Выбери узел')}</h2><p>Зачем узел существует и чем подтверждается его переход.</p></div>
          ${semanticInspector(model, selected)}
        </aside>
      </div>`;
    installResize();
    requestAnimationFrame(drawSemanticEdges);
  }

  function render() {
    if (state.mode === 'runtime') return renderRuntime();
    if (state.mode === 'semantic') return renderSemantic();
    return renderStudio();
  }

  function drawEdges() {
    const type = selectedType();
    const stage = state.shadow?.querySelector('.canvas-stage');
    const svg = state.shadow?.querySelector('.edge-layer');
    if (!type || !stage || !svg) return;
    const stageRect = stage.getBoundingClientRect();
    const zoom = state.zoom || 1;
    const width = Math.max(stage.scrollWidth, 900);
    const height = Math.max(stage.scrollHeight, 600);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    const paths = [];
    for (const node of Object.values(type.nodes || {})) {
      const from = state.shadow.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
      if (!from) continue;
      const a = from.getBoundingClientRect();
      for (const answer of node.options || []) {
        const to = state.shadow.querySelector(`[data-node-id="${CSS.escape(answer.next)}"]`);
        if (!to) continue;
        const b = to.getBoundingClientRect();
        const x1 = (a.right - stageRect.left) / zoom;
        const y1 = (a.top + a.height / 2 - stageRect.top) / zoom;
        const x2 = (b.left - stageRect.left) / zoom;
        const y2 = (b.top + b.height / 2 - stageRect.top) / zoom;
        const bend = Math.max(28, (x2 - x1) * 0.48);
        const selected = node.id === state.selectedNodeId || answer.next === state.selectedNodeId;
        paths.push(`<path class="${selected ? 'selected' : ''}" d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}"/>`);
      }
    }
    svg.innerHTML = paths.join('');
  }

  function markDirty({ rerender = true } = {}) {
    state.dirty = true;
    validate();
    if (rerender) render();
  }

  function setOptionField(node, index, path, value) {
    const answer = node?.options?.[index];
    if (!answer) return;
    if (!path.startsWith('condition.')) {
      answer[path] = value;
      return;
    }
    const key = path.split('.')[1];
    if (key === 'fact' && !value) {
      answer.condition = null;
      return;
    }
    answer.condition ||= { fact: '', operator: 'equals', value: '' };
    answer.condition[key] = value;
    if (['exists', 'not_exists'].includes(answer.condition.operator)) answer.condition.value = '';
  }

  async function saveDraft() {
    state.busy = true;
    render();
    try {
      const result = await WB.appeals.studio.saveDraft(state.graph);
      state.bundle = result.bundle;
      state.graph = clone(result.bundle.draft);
      state.dirty = false;
      toast(result.valid ? 'Черновик сохранён' : 'Черновик сохранён с ошибками; публикация пока заблокирована');
    } catch (error) {
      toast(`Не удалось сохранить: ${error?.message || error}`);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function publish() {
    const report = validate();
    if (!report.valid) return toast('Сначала исправь ошибки графа');
    state.busy = true;
    render();
    try {
      const result = await WB.appeals.studio.publish(state.graph);
      if (!result.published) return toast('Публикация отклонена валидатором');
      state.bundle = result.bundle;
      state.graph = clone(result.bundle.draft);
      state.dirty = false;
      toast('Новая версия опубликована. Активные обращения сохранят прежний маршрут.');
    } catch (error) {
      toast(`Не удалось опубликовать: ${error?.message || error}`);
    } finally {
      state.busy = false;
      render();
    }
  }

  function exportGraph() {
    const blob = new Blob([JSON.stringify(state.graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `simnet-appeals-graph-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Черновик графа экспортирован');
  }

  async function importGraph(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const checked = WB.appeals.studio.validate(parsed);
      state.graph = checked.graph;
      state.selectedTypeId = state.graph.types[0]?.id || '';
      state.selectedNodeId = state.graph.types[0]?.first || '';
      state.dirty = true;
      render();
      toast(checked.valid ? 'Граф импортирован в черновик' : `Импортирован черновик: ${checked.errors.length} ошибок`);
    } catch (error) {
      toast(`Файл не прочитан: ${error?.message || error}`);
    }
  }

  function toast(message) {
    const node = state.shadow?.querySelector('.toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  function applyWidth(width, persist = true) {
    const max = Math.max(MIN_WIDTH, window.innerWidth - RAIL_WIDTH - 40);
    state.width = state.expanded
      ? Math.max(MIN_WIDTH, window.innerWidth - RAIL_WIDTH - 24)
      : Math.max(MIN_WIDTH, Math.min(Number(width) || Math.round(window.innerWidth * 0.9), max));
    state.panel.style.width = state.expanded ? `calc(100vw - ${RAIL_WIDTH + 24}px)` : 'min(90vw, 1540px)';
    state.panel.classList.toggle('expanded', state.expanded);
    if (persist && globalThis.chrome?.storage?.local) {
      chrome.storage.local.set({ [UI_STORAGE_KEY]: { width: state.width, zoom: state.zoom } });
    }
  }

  function installResize() {
    const handle = state.shadow.querySelector('.resizer');
    if (!handle || handle.dataset.ready) return;
    handle.dataset.ready = '1';
    let drag = null;
    handle.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, width: state.width };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      applyWidth(drag.width + drag.x - event.clientX, false);
    });
    const finish = event => {
      if (!drag) return;
      drag = null;
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      applyWidth(state.width, true);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  async function open(options = {}) {
    await WB.appeals.studio.ready;
    const requestedMode = typeof options === 'string' ? options : String(options?.mode || 'runtime');
    state.mode = requestedMode === 'studio' ? 'studio' : requestedMode === 'semantic' ? 'semantic' : 'runtime';
    window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'graph', mode: state.mode } }));
    state.bundle = WB.appeals.studio.bundle();
    if (state.mode === 'runtime') {
      state.graph = clone(WB.appeals.graphSnapshot());
      state.dirty = false;
      const appeal = runtimeAppeal();
      state.selectedTypeId = appeal?.typeId || state.graph.types?.[0]?.id || '';
      const type = selectedType();
      state.selectedNodeId = appeal?.nodeId && type?.nodes?.[appeal.nodeId]
        ? appeal.nodeId
        : type?.first || '';
      ensureSelection();
    } else if (state.mode === 'semantic') {
      const model = semanticModel();
      if (!model?.nodes?.[state.semanticSelectedNodeId]) {
        state.semanticSelectedNodeId = state.semanticContextId ? `ctx.${state.semanticContextId}` : model?.rootId || 'case';
      }
    } else {
      if (!state.graph || !state.dirty) state.graph = clone(state.bundle.draft || state.bundle.published);
      ensureSelection();
    }
    state.open = true;
    state.panel.classList.add('open');
    state.shadow?.querySelector('.backdrop')?.classList.add('open');
    applyWidth(state.width, false);
    render();
  }

  function close() {
    const wasOpen = state.open;
    state.open = false;
    state.panel.classList.remove('open');
    state.shadow?.querySelector('.backdrop')?.classList.remove('open');
    if (wasOpen) {
      window.dispatchEvent(new CustomEvent('simnet-workbench-module-close', { detail: { module: 'graph' } }));
    }
  }

  function handleClick(event) {
    const target = event.target.closest('[data-action]');
    const action = target?.dataset.action;
    if (!action) return;
    const runtimeActions = new Set([
      'close', 'expand', 'select-type', 'select-node', 'zoom-in', 'zoom-out',
      'appeal-select', 'appeal-answer', 'appeal-back', 'appeal-reset', 'fit-view', 'semantic-open'
    ]);
    const semanticActions = new Set([
      'close', 'expand', 'zoom-in', 'zoom-out', 'semantic-open', 'runtime-open',
      'semantic-context', 'semantic-select-node', 'semantic-fit'
    ]);
    if (state.mode === 'runtime' && !runtimeActions.has(action)) return;
    if (state.mode === 'semantic' && !semanticActions.has(action)) return;
    if (action === 'semantic-open') return void open({ mode: 'semantic' });
    if (action === 'runtime-open') return void open({ mode: 'runtime' });
    if (action === 'semantic-context') {
      state.semanticContextId = target.dataset.contextId || '';
      state.semanticSelectedNodeId = state.semanticContextId ? `ctx.${state.semanticContextId}` : 'case';
      return render();
    }
    if (action === 'semantic-select-node') {
      state.semanticSelectedNodeId = target.dataset.semanticNodeId || '';
      return render();
    }
    if (action === 'semantic-fit') return fitSemanticView();
    const type = selectedType();
    const node = selectedNode();
    if (action === 'close') return close();
    if (action === 'expand') { state.expanded = !state.expanded; applyWidth(state.width, true); return render(); }
    if (action === 'select-type') { state.selectedTypeId = target.dataset.typeId || ''; state.selectedNodeId = ''; return render(); }
    if (action === 'select-node') { state.selectedNodeId = target.dataset.nodeId || ''; return render(); }
    if (action === 'zoom-in') { state.zoom = Math.min(1.2, state.zoom + 0.1); applyWidth(state.width, true); return render(); }
    if (action === 'zoom-out') { state.zoom = Math.max(0.6, state.zoom - 0.1); applyWidth(state.width, true); return render(); }
    if (action === 'appeal-select') return void runtimeSelectSymptom(target.dataset.typeId || '');
    if (action === 'appeal-answer') return void runtimeAnswer(target.dataset.answerId || '');
    if (action === 'appeal-back') return void runtimeBack();
    if (action === 'appeal-reset') return void runtimeReset();
    if (action === 'fit-view') return fitRuntimeView();
    if (action === 'save') return void saveDraft();
    if (action === 'publish') return void publish();
    if (action === 'export') return exportGraph();
    if (action === 'import') return state.shadow.querySelector('[data-role="import-file"]')?.click();
    if (action === 'add-type') {
      const id = token('appeal');
      state.graph.types.push({ id, label: 'Новое обращение', short: 'Опиши жалобу понятным языком', first: '', phases: clone(type?.phases || [{ id: 'symptom', label: 'Симптом' }, { id: 'result', label: 'Гипотеза' }]), nodes: {} });
      state.selectedTypeId = id; state.selectedNodeId = ''; markDirty(); return;
    }
    if (action === 'delete-type' && type && confirm(`Удалить обращение «${type.label}» из черновика?`)) {
      state.graph.types = state.graph.types.filter(item => item.id !== type.id); state.selectedTypeId = ''; state.selectedNodeId = ''; markDirty(); return;
    }
    if ((action === 'add-question' || action === 'add-outcome') && type) {
      const isOutcome = action === 'add-outcome';
      const id = token(`${type.id}.${isOutcome ? 'outcome' : 'question'}`);
      type.nodes[id] = isOutcome
        ? { id, kind: 'outcome', phase: 'result', title: 'Новая рабочая гипотеза', summary: '', nextAction: '', focus: 'access' }
        : { id, kind: 'question', phase: type.phases[0]?.id || 'symptom', title: 'Новый уточняющий вопрос', why: '', options: [] };
      if (!type.first) type.first = id;
      state.selectedNodeId = id; markDirty(); return;
    }
    if (action === 'delete-node' && type && node && confirm(`Удалить узел «${node.title}» из черновика?`)) {
      delete type.nodes[node.id]; if (type.first === node.id) type.first = Object.keys(type.nodes)[0] || ''; state.selectedNodeId = ''; markDirty(); return;
    }
    if (action === 'add-option' && node?.kind === 'question') {
      node.options.push({ id: token('answer'), label: 'Новый ответ', next: Object.keys(type.nodes)[0] || '', hint: '', condition: null }); markDirty(); return;
    }
    if (action === 'delete-option' && node?.kind === 'question') {
      node.options.splice(Number(target.dataset.optionIndex), 1); markDirty(); return;
    }
    if (action === 'reset-draft') {
      if (state.dirty && !confirm('Отменить несохранённые изменения и вернуть опубликованный граф?')) return;
      void WB.appeals.studio.resetDraft().then(bundle => { state.bundle = bundle; state.graph = clone(bundle.draft); state.dirty = false; render(); toast('Черновик возвращён к опубликованной версии'); }); return;
    }
    if (action === 'restore-builtin') {
      if (!confirm('Опубликовать стандартный встроенный граф? Предыдущая версия останется в истории.')) return;
      state.busy = true; render();
      void WB.appeals.studio.restoreBuiltin().then(result => { state.bundle = result.bundle; state.graph = clone(result.bundle.draft); state.dirty = false; toast('Стандартный граф опубликован'); }).catch(error => toast(error?.message || error)).finally(() => { state.busy = false; render(); });
    }
  }

  function handleChange(event) {
    if (state.mode === 'runtime') return;
    if (event.target.matches('[data-role="import-file"]')) return void importGraph(event.target.files?.[0]);
    const type = selectedType();
    const node = selectedNode();
    if (!type) return;
    const typeField = event.target.dataset.typeField;
    const nodeField = event.target.dataset.nodeField;
    const optionField = event.target.dataset.optionField;
    if (typeField) type[typeField] = event.target.value;
    else if (nodeField && node) node[nodeField] = event.target.value;
    else if (optionField && node) setOptionField(node, Number(event.target.dataset.optionIndex), optionField, event.target.value);
    else return;
    markDirty();
  }

  async function mount() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.dataset.simnetWbOwned = 'graph-studio';
    const shadow = host.attachShadow({ mode: 'open' });
    // No floating launcher: Graph opens only via RAIL («Диагностический граф»).
    // Dead Plum-era launcher (styles + button + click handler) removed.
    shadow.innerHTML = `${styles()}${plumStyles()}${semanticStyles()}<div class="backdrop"></div><section class="module"></section><div class="toast"></div>`;
    document.documentElement.appendChild(host);
    state.host = host;
    state.shadow = shadow;
    state.panel = shadow.querySelector('.module');
    state.launcher = null;
    state.shadow.querySelector('.backdrop')?.addEventListener('click', () => close());
    state.panel.addEventListener('click', handleClick);
    state.panel.addEventListener('change', handleChange);
    window.addEventListener('simnet-workbench-module-open', event => {
      if (event.detail?.module !== 'graph' && state.open) close();
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.open) {
        event.preventDefault();
        close();
      }
    }, true);
    window.addEventListener('resize', () => { if (state.open) applyWidth(state.width, false); });
    if (globalThis.chrome?.storage?.local) {
      const stored = await chrome.storage.local.get([UI_STORAGE_KEY]);
      const ui = stored?.[UI_STORAGE_KEY] || {};
      state.width = Number(ui.width) || state.width;
      state.zoom = Math.max(0.6, Math.min(1.2, Number(ui.zoom) || state.zoom));
    }
    await WB.appeals.studio.ready;
    state.bundle = WB.appeals.studio.bundle();
    state.graph = clone(state.bundle.draft || state.bundle.published);
  }

  WB.graphStudio = Object.freeze({ open, close, isOpen: () => state.open, mode: () => state.mode });
  if (document.documentElement) void mount();
  else window.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
})();
