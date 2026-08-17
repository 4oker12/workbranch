(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__conversationGraphModeBridgeLoaded) return;
  WB.__conversationGraphModeBridgeLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  let panel = null;

  function onPanelClick(event) {
    const target = event.target.closest?.('[data-action="runtime-open"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    void WB.graphStudio?.open?.({ mode: 'runtime' });
  }

  function attach() {
    const host = document.getElementById(HOST_ID);
    const nextPanel = host?.shadowRoot?.querySelector('.module') || null;
    if (!nextPanel || nextPanel === panel) return Boolean(nextPanel);
    panel?.removeEventListener?.('click', onPanelClick, true);
    panel = nextPanel;
    panel.addEventListener('click', onPanelClick, true);
    return true;
  }

  if (!attach()) {
    queueMicrotask(() => {
      if (!attach()) window.addEventListener('DOMContentLoaded', attach, { once: true });
    });
  }

  WB.conversationGraphModeBridge = Object.freeze({
    attached: () => Boolean(panel?.isConnected)
  });
})();
