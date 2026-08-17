(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__conversationGraphModeBridgeLoaded) return;
  WB.__conversationGraphModeBridgeLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const RAIL_HOST_ID = 'simnet-workbench-rail-host';
  let panel = null;
  let labelFrame = 0;

  function syncOperatorGuideLabels() {
    const railShadow = document.getElementById(RAIL_HOST_ID)?.shadowRoot || null;
    if (!railShadow) return false;

    const graphButton = railShadow.querySelector('[data-action="view-graph"]');
    if (graphButton) {
      graphButton.title = 'Пособие оператора';
      graphButton.setAttribute('aria-label', 'Пособие оператора');
      const label = graphButton.querySelector('.rail-label');
      if (label) label.textContent = 'Пособие оператора';
    }

    railShadow.querySelectorAll('[data-action="graph-studio-open"]').forEach(button => {
      button.textContent = 'Пособие оператора';
      button.title = 'Пособие оператора';
    });

    const intro = railShadow.querySelector('.appeal-intro');
    if (intro && /Диагностический граф/i.test(intro.textContent || '')) {
      intro.textContent = 'Выбери тему обращения или открой «Пособие оператора»: там собраны типичные формулировки абонента, уточняющие вопросы и смысл этих вопросов.';
    }

    return Boolean(graphButton);
  }

  function scheduleOperatorGuideLabels() {
    if (labelFrame) cancelAnimationFrame(labelFrame);
    labelFrame = requestAnimationFrame(() => {
      labelFrame = requestAnimationFrame(() => {
        labelFrame = 0;
        syncOperatorGuideLabels();
      });
    });
  }

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
      scheduleOperatorGuideLabels();
    });
  }

  WB.bus?.on?.('store:state', scheduleOperatorGuideLabels);
  window.addEventListener('simnet-workbench-module-open', scheduleOperatorGuideLabels);
  window.addEventListener('DOMContentLoaded', scheduleOperatorGuideLabels, { once: true });
  scheduleOperatorGuideLabels();

  WB.conversationGraphModeBridge = Object.freeze({
    attached: () => Boolean(panel?.isConnected),
    syncOperatorGuideLabels
  });
})();
