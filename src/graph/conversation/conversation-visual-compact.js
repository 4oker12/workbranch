(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const base = WB?.graphStudio;
  if (!WB || !base || typeof base.open !== 'function' || WB.__conversationVisualCompactLoaded) return;

  WB.__conversationVisualCompactLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-guide-visual-compact-v1';

  function compactStyles() {
    return `<style id="${STYLE_ID}">
      /* Compact only when viewport height is constrained (e.g. browser zoom 125%).
         Tabs and guide logic are intentionally untouched. */
      @media(max-height:860px){
        .guide-board-wrap{padding:10px 20px 10px}
        .guide-board{min-width:690px;max-width:880px;min-height:390px;gap:14px 22px;padding:16px 14px 10px}
        .guide-board:before{inset:13% 16%}

        .guide-core{width:248px;min-height:142px;padding:23px 22px 18px}
        .guide-core:before{width:88px;height:64px;left:30px;top:-22px;box-shadow:66px 1px 0 -8px var(--accent)}
        .guide-core:after{width:68px;height:54px;right:27px;top:-10px}
        .guide-core svg{width:29px;height:29px;margin-bottom:7px}
        .guide-core strong{font-size:22px;line-height:1.05}
        .guide-core small{margin-top:7px;font-size:11px}

        .guide-cloud{width:166px;min-height:82px;padding:19px 14px 13px;font-size:12px;line-height:1.28;box-shadow:0 8px 19px rgba(31,38,46,.08)}
        .guide-cloud:before{width:48px;height:38px;left:17px;top:-15px}
        .guide-cloud:after{width:56px;height:43px;right:17px;top:-18px}
        .guide-cloud q:before,.guide-cloud q:after{font-size:18px}

        .layout-orbit-soft .slot-1{transform:translate(9px,3px)}.layout-orbit-soft .slot-2{transform:translateY(-5px)}.layout-orbit-soft .slot-3{transform:translate(-9px,3px)}
        .layout-orbit-soft .slot-4{transform:translateX(-1px)}.layout-orbit-soft .slot-5{transform:translateX(1px)}
        .layout-orbit-soft .slot-6{transform:translate(10px,-3px)}.layout-orbit-soft .slot-7{transform:translateY(5px)}.layout-orbit-soft .slot-8{transform:translate(-10px,-3px)}

        .layout-break-grid .slot-1{transform:translate(14px,2px)}.layout-break-grid .slot-2{transform:translateY(-7px)}.layout-break-grid .slot-3{transform:translate(-14px,2px)}
        .layout-break-grid .slot-4{transform:translate(-4px,-2px)}.layout-break-grid .slot-5{transform:translate(4px,3px)}.layout-break-grid .slot-6{transform:translate(15px,-6px)}.layout-break-grid .slot-7{transform:translateY(7px)}.layout-break-grid .slot-8{transform:translate(-15px,-6px)}

        .layout-wave .slot-1{transform:translate(5px,12px)}.layout-wave .slot-2{transform:translateY(-9px)}.layout-wave .slot-3{transform:translate(-5px,10px)}
        .layout-wave .slot-4{transform:translate(-5px,-7px)}.layout-wave .slot-5{transform:translate(6px,7px)}.layout-wave .slot-6{transform:translate(9px,11px)}.layout-wave .slot-7{transform:translateY(-6px)}.layout-wave .slot-8{transform:translate(-9px,9px)}

        .layout-scatter .slot-1{transform:translate(8px,5px) rotate(-1deg)}.layout-scatter .slot-2{transform:translate(-2px,-5px) rotate(1deg)}.layout-scatter .slot-3{transform:translate(-11px,7px) rotate(-1deg)}
        .layout-scatter .slot-4{transform:translate(-1px,-5px) rotate(1deg)}.layout-scatter .slot-5{transform:translate(5px,2px) rotate(-1deg)}.layout-scatter .slot-6{transform:translate(11px,-1px) rotate(1deg)}.layout-scatter .slot-7{transform:translate(0,6px) rotate(-1deg)}.layout-scatter .slot-8{transform:translate(-10px,-5px) rotate(1deg)}

        .guide-footer{min-height:44px;margin:0 20px 12px;padding:0 13px;font-size:11px}

        .guide-side{padding:16px 18px 18px}
        .guide-side-context{margin-bottom:12px;padding:10px 12px;font-size:11px}.guide-side-context b{font-size:14px}
        .guide-side-section+.guide-side-section{margin-top:15px;padding-top:14px}
        .guide-side-title{margin-bottom:10px}.guide-side-title .round{width:32px;height:32px}.guide-side-title b{font-size:15px}
        .guide-question-list{gap:8px}.guide-question{gap:10px;padding:10px 12px;font-size:12px;line-height:1.36}
        .guide-question .number{width:27px;height:27px;font-size:11px}
        .guide-meaning{gap:8px}.guide-meaning-item{gap:8px;font-size:12px;line-height:1.36}
      }
    </style>`;
  }

  function ensureCompactStyle() {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot || null;
    if (!shadow || shadow.getElementById(STYLE_ID)) return false;
    const template = document.createElement('template');
    template.innerHTML = compactStyles();
    shadow.appendChild(template.content.cloneNode(true));
    return true;
  }

  async function openWithCompactVisual(options = {}) {
    const result = await base.open(options);
    if (base.mode?.() === 'runtime') ensureCompactStyle();
    return result;
  }

  WB.graphStudio = Object.freeze({ ...base, open: openWithCompactVisual });
  WB.operatorGuideVisualCompact = Object.freeze({
    revision: 'approved-cloud-compact-v1',
    ensure: ensureCompactStyle
  });
})();
