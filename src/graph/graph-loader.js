(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.graphStudio) return;

  const SCRIPT_PATH = 'src/graph/graph-studio.js';
  let loadPromise = null;

  /**
   * Graph Studio is packaged as the next static content script in manifest.json.
   * MV3 extension CSP forbids eval/new Function, so never fetch+eval extension JS.
   * The loader remains as a stable API shim for Rail callers.
   */
  function ensureGraphStudio() {
    if (WB.__graphStudioLoaded && typeof WB.graphStudio?.open === 'function' && !WB.graphStudio.__lazy) {
      return Promise.resolve(WB.graphStudio);
    }
    const error = new Error('Graph Studio bundle is not initialized');
    void WB.observability?.report?.({
      severity: 'ERROR',
      code: 'GRAPH_LAZY_LOAD_FAILED',
      operationType: 'GRAPH_LOAD',
      source: 'graph-loader',
      stage: 'LOAD',
      message: error.message,
      error
    });
    return Promise.reject(error);
  }

  async function open(options) {
    const api = await ensureGraphStudio();
    return api.open(options);
  }

  async function close() {
    if (!WB.__graphStudioLoaded) return;
    const api = await ensureGraphStudio();
    return api.close?.();
  }

  function isOpen() {
    if (!WB.__graphStudioLoaded) return false;
    return Boolean(WB.graphStudio?.isOpen?.());
  }

  function mode() {
    if (!WB.__graphStudioLoaded) return 'runtime';
    return WB.graphStudio?.mode?.() || 'runtime';
  }

  WB.graphStudio = Object.freeze({
    __lazy: true,
    ensure: ensureGraphStudio,
    open,
    close,
    isOpen,
    mode
  });
})();
