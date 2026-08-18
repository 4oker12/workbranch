(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const base = WB?.graphStudio;
  if (!WB || !base || typeof base.open !== 'function' || WB.__conversationVisualRefreshLoaded) return;

  WB.__conversationVisualRefreshLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-guide-visual-refresh-v1';

  function visualStyles() {
    return `<style id="${STYLE_ID}">
      /* Visual-only refresh. Tabs are intentionally not restyled here. */
      .guide-topbar{padding:0 24px;border-bottom-color:#E8E4E7}
      .guide-brand{gap:14px}.guide-mark{width:46px;height:46px;box-shadow:0 10px 26px color-mix(in srgb,var(--accent) 20%,transparent)}
      .guide-mark svg{width:24px;height:24px;stroke-width:1.8}
      .guide-brand b{font-size:20px;font-weight:800;letter-spacing:-.02em}.guide-brand small{font-size:12px;font-weight:500}

      .guide-shell{grid-template-columns:minmax(0,1fr) minmax(370px,410px)}
      .guide-board-wrap{padding:18px 24px 16px}
      .guide-board{min-width:720px;max-width:920px;min-height:510px;grid-template-columns:1fr 1.16fr 1fr;grid-template-rows:1fr 1.08fr 1fr;gap:24px 28px;padding:26px 18px 18px}
      .guide-board:before{inset:14% 16%;border-width:1.5px;border-radius:46%;opacity:.86}

      .guide-core{position:relative;isolation:isolate;width:286px;min-height:164px;padding:30px 26px 23px;border-radius:34% 38% 36% 40% / 42% 44% 38% 42%;box-shadow:0 22px 46px color-mix(in srgb,var(--accent-dark) 28%,transparent)}
      .guide-core:before,.guide-core:after{content:"";position:absolute;z-index:-1;border-radius:50%;background:var(--accent);pointer-events:none}
      .guide-core:before{width:104px;height:78px;left:34px;top:-28px;box-shadow:76px 1px 0 -8px var(--accent)}
      .guide-core:after{width:78px;height:64px;right:29px;top:-12px;opacity:.98}
      .guide-core svg,.guide-core strong,.guide-core small{position:relative;z-index:1}
      .guide-core svg{width:34px;height:34px;stroke-width:1.8;margin-bottom:10px}
      .guide-core strong{font-size:25px;font-weight:850;line-height:1.07;letter-spacing:-.02em;text-shadow:0 1px 1px rgba(0,0,0,.08)}
      .guide-core small{margin-top:9px;font-size:12px;font-weight:600;opacity:.9}

      .guide-cloud{width:184px;min-height:96px;padding:23px 17px 17px;border-radius:30px;border-color:#E5DEE3;color:#242C38;font-size:13px;font-weight:750;line-height:1.32;box-shadow:0 11px 25px rgba(31,38,46,.09)}
      .guide-cloud:before{width:55px;height:44px;left:18px;top:-18px}
      .guide-cloud:after{width:64px;height:50px;right:18px;top:-22px}
      .guide-cloud q{font-weight:750}.guide-cloud q:before,.guide-cloud q:after{font-size:20px;font-weight:800}
      .guide-cloud:hover{box-shadow:0 15px 30px color-mix(in srgb,var(--accent) 15%,transparent)}
      .guide-cloud.active{box-shadow:0 16px 32px color-mix(in srgb,var(--accent) 20%,transparent)}

      .layout-orbit-soft .slot-1{transform:translate(14px,5px)}.layout-orbit-soft .slot-2{transform:translateY(-9px)}.layout-orbit-soft .slot-3{transform:translate(-14px,5px)}
      .layout-orbit-soft .slot-4{transform:translateX(-3px)}.layout-orbit-soft .slot-5{transform:translateX(3px)}
      .layout-orbit-soft .slot-6{transform:translate(15px,-5px)}.layout-orbit-soft .slot-7{transform:translateY(8px)}.layout-orbit-soft .slot-8{transform:translate(-15px,-5px)}

      .layout-break-grid:before{inset:13% 17%}.layout-break-grid .slot-1{transform:translate(20px,3px)}.layout-break-grid .slot-2{transform:translateY(-11px)}.layout-break-grid .slot-3{transform:translate(-20px,3px)}
      .layout-break-grid .slot-4{transform:translate(-7px,-3px)}.layout-break-grid .slot-5{transform:translate(7px,5px)}.layout-break-grid .slot-6{transform:translate(22px,-10px)}.layout-break-grid .slot-7{transform:translateY(12px)}.layout-break-grid .slot-8{transform:translate(-22px,-10px)}

      .layout-wave .slot-1{transform:translate(7px,20px)}.layout-wave .slot-2{transform:translateY(-15px)}.layout-wave .slot-3{transform:translate(-8px,16px)}
      .layout-wave .slot-4{transform:translate(-8px,-12px)}.layout-wave .slot-5{transform:translate(9px,12px)}.layout-wave .slot-6{transform:translate(14px,18px)}.layout-wave .slot-7{transform:translateY(-10px)}.layout-wave .slot-8{transform:translate(-14px,15px)}

      .layout-scatter:before{inset:15% 15%;border-radius:38% 46% 36% 44%;transform:rotate(-3deg)}
      .layout-scatter .slot-1{transform:translate(13px,8px) rotate(-1deg)}.layout-scatter .slot-2{transform:translate(-4px,-8px) rotate(1deg)}.layout-scatter .slot-3{transform:translate(-18px,12px) rotate(-1deg)}
      .layout-scatter .slot-4{transform:translate(-2px,-8px) rotate(1deg)}.layout-scatter .slot-5{transform:translate(8px,4px) rotate(-1deg)}.layout-scatter .slot-6{transform:translate(18px,-2px) rotate(1deg)}.layout-scatter .slot-7{transform:translate(0,10px) rotate(-1deg)}.layout-scatter .slot-8{transform:translate(-16px,-8px) rotate(1deg)}

      .guide-footer{min-height:52px;margin:0 24px 18px;padding:0 16px;border-radius:14px;font-size:12px;line-height:1.35}.guide-footer b{font-weight:750}.guide-footer .dot{width:9px;height:9px}

      .guide-side{padding:20px 20px 22px}
      .guide-side-context{margin-bottom:16px;padding:12px 14px;border-radius:12px;font-size:12px;line-height:1.45}.guide-side-context b{margin-bottom:5px;font-size:15px;font-weight:800}
      .guide-side-section+.guide-side-section{margin-top:20px;padding-top:18px}
      .guide-side-title{margin-bottom:14px}.guide-side-title .round{width:36px;height:36px}.guide-side-title svg{stroke-width:1.8}.guide-side-title b{font-size:16px;font-weight:800}
      .guide-question-list{gap:10px}.guide-question{gap:12px;padding:13px 14px;border-radius:12px;font-size:13px;font-weight:600;line-height:1.45;box-shadow:0 3px 9px rgba(16,24,40,.05)}
      .guide-question .number{width:30px;height:30px;font-size:12px;font-weight:850}
      .guide-meaning{gap:10px}.guide-meaning-item{gap:10px;font-size:13px;font-weight:500;line-height:1.45}

      @media(max-width:1080px){
        .guide-shell{grid-template-columns:minmax(0,1fr) 330px}
        .guide-board{min-width:650px;min-height:490px;gap:20px 22px}
        .guide-cloud{width:166px;min-height:90px;font-size:12px}
        .guide-core{width:248px;min-height:150px}.guide-core strong{font-size:22px}
        .guide-question,.guide-meaning-item{font-size:12px}
      }
    </style>`;
  }

  function ensureVisualStyle() {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot || null;
    if (!shadow || shadow.getElementById(STYLE_ID)) return false;
    const template = document.createElement('template');
    template.innerHTML = visualStyles();
    shadow.appendChild(template.content.cloneNode(true));
    return true;
  }

  async function openWithVisualRefresh(options = {}) {
    const result = await base.open(options);
    if (base.mode?.() === 'runtime') ensureVisualStyle();
    return result;
  }

  WB.graphStudio = Object.freeze({ ...base, open: openWithVisualRefresh });
  WB.operatorGuideVisualRefresh = Object.freeze({
    revision: 'approved-cloud-visual-v1',
    ensure: ensureVisualStyle
  });
})();
