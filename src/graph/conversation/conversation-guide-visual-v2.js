(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const base = WB?.graphStudio;
  if (!WB || !base || typeof base.open !== 'function' || WB.__operatorGuideVisualV2Loaded) return;

  WB.__operatorGuideVisualV2Loaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-guide-visual-v2';

  function visualStyles() {
    return `<style id="${STYLE_ID}">
      /* Approved visual direction: one plum language, quiet defaults, strong focus only where needed. */
      .guide-root,
      .guide-root.theme-low-speed,
      .guide-root.theme-no-internet,
      .guide-root.theme-unstable,
      .guide-root.theme-other{
        --accent:#A50046!important;
        --accent-dark:#74113F!important;
        --accent-soft:#FFF3F7!important;
        --accent-line:rgba(165,0,70,.28)!important;
      }

      .guide-root{background:#FBFBFC!important;color:#172033!important}
      .guide-topbar{background:#fff!important;border-bottom-color:#E7E9ED!important}
      .guide-mark{background:#8E1748!important;box-shadow:0 8px 20px rgba(116,17,63,.16)!important}
      .guide-brand b{color:#6F1B42!important;font-weight:800!important}
      .guide-brand small{color:#667085!important}

      .guide-main{background:linear-gradient(180deg,#FFFFFF 0%,#FCFCFD 100%)!important}
      .guide-tabs{gap:10px!important}
      .guide-tab{border:1px solid #DFE3E8!important;background:#fff!important;color:#344054!important;box-shadow:0 1px 2px rgba(16,24,40,.025)!important}
      .guide-tab:hover{border-color:#CDA8B8!important;background:#FFF9FB!important;color:#74113F!important}
      .guide-tab.active{background:linear-gradient(180deg,#A60D50 0%,#8A0D43 100%)!important;border-color:#8A0D43!important;color:#fff!important;box-shadow:0 7px 18px rgba(116,17,63,.20)!important}
      .guide-tab.search-topic-match:not(.active){border-color:#B96486!important;box-shadow:0 0 0 2px rgba(165,0,70,.06)!important}

      .guide-search-input{border-color:#DFE3E8!important;background:#FCFCFD!important;box-shadow:0 1px 2px rgba(16,24,40,.025)!important}
      .guide-search-input:focus{border-color:#B85B82!important;background:#fff!important;box-shadow:0 0 0 3px rgba(165,0,70,.08)!important}
      .guide-search-status{color:#7A8494!important;font-weight:550!important}

      .guide-board:before{border:1.35px dashed rgba(165,0,70,.30)!important;opacity:1!important}

      .guide-core{
        background:linear-gradient(180deg,#A90F51 0%,#8E1247 64%,#74113F 100%)!important;
        box-shadow:0 18px 38px rgba(116,17,63,.23)!important;
      }
      .guide-core:before,.guide-core:after{background:#98144A!important}
      .guide-core:before{box-shadow:76px 2px 0 -8px #98144A!important}
      .guide-core strong{font-weight:820!important;text-shadow:none!important}
      .guide-core small{opacity:.88!important}

      /* Ordinary clouds stay quiet and readable. */
      .guide-cloud{
        border:1.25px solid #D8DDE4!important;
        background:#FFFFFF!important;
        color:#1D2939!important;
        box-shadow:0 8px 20px rgba(28,39,54,.075)!important;
      }
      .guide-cloud:before,.guide-cloud:after{
        border-color:#D8DDE4!important;
        background:#FFFFFF!important;
      }
      .guide-cloud q{font-weight:700!important}
      .guide-cloud q:before,.guide-cloud q:after{color:#A50046!important}

      .guide-cloud:hover{
        border:1.5px solid #A50046!important;
        background:#FFF9FB!important;
        color:#74113F!important;
        box-shadow:0 11px 25px rgba(116,17,63,.13)!important;
      }
      .guide-cloud:hover:before,.guide-cloud:hover:after{
        border-color:#A50046!important;
        background:#FFF9FB!important;
      }

      /* Selected = strongest state, but no neon/double-outline effect. */
      .guide-cloud.active{
        border:2px solid #A50046!important;
        background:#FFF2F7!important;
        color:#74113F!important;
        box-shadow:0 0 0 3px rgba(165,0,70,.09),0 14px 28px rgba(116,17,63,.18)!important;
        outline:0!important;
      }
      .guide-cloud.active:before,.guide-cloud.active:after{
        border-color:#A50046!important;
        background:#FFF2F7!important;
      }

      /* Search focus: visible relative to normal clouds, not fluorescent. */
      .guide-cloud.search-match-high:not(.active){
        border:2px solid #B21355!important;
        background:#FFF5F9!important;
        color:#74113F!important;
        outline:0!important;
        box-shadow:0 0 0 3px rgba(165,0,70,.08),0 13px 27px rgba(116,17,63,.16)!important;
      }
      .guide-cloud.search-match-high:not(.active):before,.guide-cloud.search-match-high:not(.active):after{
        border-color:#B21355!important;
        background:#FFF5F9!important;
      }
      .guide-cloud.search-match-medium:not(.active){
        border:1.5px solid #C8668D!important;
        background:#FFFAFC!important;
        box-shadow:0 10px 22px rgba(116,17,63,.10)!important;
      }
      .guide-cloud.search-match-medium:not(.active):before,.guide-cloud.search-match-medium:not(.active):after{border-color:#C8668D!important}
      .guide-cloud.search-match-low:not(.active){
        border:1.25px solid #D7A8BB!important;
        box-shadow:0 9px 20px rgba(116,17,63,.07)!important;
      }
      .guide-cloud.search-match-low:not(.active):before,.guide-cloud.search-match-low:not(.active):after{border-color:#D7A8BB!important}

      .guide-footer{border-color:#E9E3E6!important;background:#FCF9FA!important;color:#667085!important;box-shadow:none!important}
      .guide-footer b{color:#74113F!important}.guide-footer .dot{background:#A50046!important}

      /* Right column follows the light reference: text first, containers second. */
      .guide-side.guide-ux-side{
        background:#FFFFFF!important;
        border-top:2px solid #A50046!important;
        padding:20px 18px 22px!important;
      }
      .guide-ux-section+.guide-ux-section{border-top:1px solid #ECE8EA!important;margin-top:20px!important;padding-top:18px!important}
      .guide-ux-heading{gap:10px!important;margin-bottom:12px!important;color:#74113F!important}
      .guide-ux-heading-icon{width:30px!important;height:30px!important;color:#A50046!important}
      .guide-ux-heading-icon svg{width:21px!important;height:21px!important;stroke-width:1.7!important}
      .guide-ux-heading-copy b{font-size:16px!important;font-weight:800!important;color:#74113F!important}
      .guide-ux-heading-copy small{font-size:11px!important;font-weight:500!important;color:#7A8494!important}
      .guide-ux-list{gap:9px!important}

      .guide-ux-item{
        border:1px solid #E0E3E8!important;
        border-radius:12px!important;
        background:#FFFFFF!important;
        box-shadow:0 1px 4px rgba(16,24,40,.035)!important;
      }
      .guide-ux-item:hover{
        border-color:#D3B4C1!important;
        background:#FFFFFF!important;
        box-shadow:0 4px 10px rgba(56,35,46,.055)!important;
      }
      .guide-ux-item[data-expanded="true"]{
        border-color:#C987A3!important;
        background:#FFFFFF!important;
        box-shadow:0 4px 12px rgba(116,17,63,.07)!important;
      }

      .guide-ux-toggle{
        min-height:58px!important;
        padding:10px 12px!important;
        grid-template-columns:32px minmax(0,1fr) 18px!important;
        gap:9px!important;
      }
      .guide-ux-card-icon{width:32px!important;height:32px!important;color:#AF0C50!important}
      .guide-ux-card-icon svg{width:20px!important;height:20px!important;stroke-width:1.65!important}
      .guide-ux-label{font-size:13px!important;font-weight:600!important;line-height:1.34!important;color:#1E293B!important}
      .guide-ux-action .guide-ux-label{font-weight:620!important;color:#1E293B!important}
      .guide-ux-chevron{width:18px!important;height:18px!important;color:#778191!important}
      .guide-ux-chevron svg{width:14px!important;height:14px!important}

      .guide-ux-panel{padding:0 14px 14px 53px!important;color:#475467!important;font-size:12px!important;line-height:1.48!important}
      .guide-ux-panel-inner{
        padding:8px 2px 4px 12px!important;
        border:0!important;
        border-left:2px solid #E3A9C0!important;
        border-radius:0!important;
        background:transparent!important;
      }
      .guide-ux-panel-title{margin-bottom:5px!important;color:#8A2851!important;font-size:11px!important;font-weight:760!important}
      .guide-ux-panel-title svg{width:14px!important;height:14px!important}

      .guide-ux-recommended{
        margin-left:7px!important;
        padding:2px 6px!important;
        border:0!important;
        border-radius:999px!important;
        background:#F8EDF2!important;
        color:#8A2851!important;
        font-size:9px!important;
        font-weight:700!important;
      }

      .guide-ux-steps{gap:10px!important}
      .guide-ux-step{grid-template-columns:22px 1fr!important;gap:8px!important}
      .guide-ux-step-number{width:22px!important;height:22px!important;background:#F8EAF0!important;color:#8F174F!important;font-size:10px!important;font-weight:800!important}
      .guide-ux-step-copy b{font-size:11.5px!important;font-weight:650!important;line-height:1.4!important;color:#273244!important}
      .guide-ux-step-copy small{font-size:10.5px!important;line-height:1.42!important;color:#667085!important}
      .guide-ux-step-copy small strong{color:#8A2851!important;font-weight:700!important}

      @media(max-height:860px){
        .guide-side.guide-ux-side{padding:15px 16px 17px!important}
        .guide-ux-heading-copy b{font-size:14px!important}.guide-ux-heading-copy small{font-size:10px!important}
        .guide-ux-toggle{min-height:50px!important;padding:8px 10px!important;grid-template-columns:28px minmax(0,1fr) 17px!important}
        .guide-ux-card-icon{width:28px!important;height:28px!important}.guide-ux-card-icon svg{width:18px!important;height:18px!important}
        .guide-ux-label{font-size:11.5px!important}.guide-ux-panel{padding:0 10px 10px 46px!important;font-size:11px!important}
        .guide-ux-step-copy b{font-size:10.5px!important}.guide-ux-step-copy small{font-size:9.8px!important}
      }

      @media(prefers-reduced-motion:reduce){
        .guide-cloud,.guide-tab,.guide-ux-item,.guide-ux-chevron{transition:none!important}
      }
    </style>`;
  }

  function ensureVisualStyle() {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot || null;
    if (!shadow || shadow.getElementById?.(STYLE_ID)) return false;
    const template = document.createElement('template');
    template.innerHTML = visualStyles();
    shadow.appendChild(template.content.cloneNode(true));
    return true;
  }

  async function openWithVisualV2(options = {}) {
    const result = await base.open(options);
    if (base.mode?.() === 'runtime') ensureVisualStyle();
    return result;
  }

  window.addEventListener('simnet-workbench-module-open', event => {
    if (event?.detail?.module !== 'graph' || event?.detail?.mode !== 'runtime') return;
    queueMicrotask(ensureVisualStyle);
  });

  WB.graphStudio = Object.freeze({ ...base, open: openWithVisualV2 });
  WB.operatorGuideVisualV2 = Object.freeze({
    revision: 'approved-light-plum-visual-v2',
    ensure: ensureVisualStyle
  });
})();
