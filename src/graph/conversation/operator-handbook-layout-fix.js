(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__operatorHandbookLayoutFixLoaded) return;
  WB.__operatorHandbookLayoutFixLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-handbook-layout-fix';

  function apply() {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot;
    if (!shadow) return false;
    if (shadow.getElementById(STYLE_ID)) return true;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .module.handbook-mode {
        display: block !important;
        grid-template-rows: none !important;
      }
      .module.handbook-mode > .handbook-root {
        width: 100%;
        height: 100%;
        min-height: 100%;
      }
    `;
    shadow.appendChild(style);
    return true;
  }

  const onModuleOpen = event => {
    if (event?.detail?.module !== 'graph') return;
    apply();
  };

  apply();
  window.addEventListener('simnet-workbench-module-open', onModuleOpen);

  WB.operatorHandbookLayoutFix = Object.freeze({
    revision: 'operator-handbook-layout-v1',
    apply
  });
})();
