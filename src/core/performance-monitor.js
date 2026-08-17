(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.performanceMonitor) return;

  const startedAt = performance.now();
  let windowStartedAt = startedAt;
  const counters = Object.create(null);
  const timings = Object.create(null);
  const milestones = Object.create(null);

  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const bytesOf = value => {
    try {
      return new Blob([JSON.stringify(value ?? null)]).size;
    } catch {
      return 0;
    }
  };

  function bucket(category, label) {
    const key = `${String(category || 'operation')}:${String(label || 'unknown')}`;
    timings[key] ||= {
      category: String(category || 'operation'),
      label: String(label || 'unknown'),
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      bytes: 0,
      inFlight: 0,
      maxInFlight: 0
    };
    return timings[key];
  }

  function record(category, label, durationMs = 0, details = {}) {
    const item = bucket(category, label);
    const duration = Math.max(0, finite(durationMs));
    item.count += 1;
    item.errors += details?.ok === false ? 1 : 0;
    item.totalMs += duration;
    item.lastMs = duration;
    item.maxMs = Math.max(item.maxMs, duration);
    item.bytes += Math.max(0, finite(details?.bytes));
    return item;
  }

  function begin(category, label) {
    const item = bucket(category, label);
    const at = performance.now();
    item.inFlight += 1;
    item.maxInFlight = Math.max(item.maxInFlight, item.inFlight);
    let finished = false;
    return details => {
      if (finished) return 0;
      finished = true;
      item.inFlight = Math.max(0, item.inFlight - 1);
      const duration = performance.now() - at;
      record(category, label, duration, details || {});
      return duration;
    };
  }

  function count(name, amount = 1) {
    const key = String(name || 'unknown');
    counters[key] = finite(counters[key]) + finite(amount || 1);
    return counters[key];
  }

  function mark(name) {
    const key = String(name || 'milestone');
    if (Object.prototype.hasOwnProperty.call(milestones, key)) return milestones[key];
    milestones[key] = Math.max(0, performance.now() - startedAt);
    return milestones[key];
  }

  function rows(category) {
    return Object.values(timings)
      .filter(item => !category || item.category === category)
      .map(item => ({
        ...item,
        avgMs: item.count ? Math.round(item.totalMs / item.count) : 0,
        maxMs: Math.round(item.maxMs),
        lastMs: Math.round(item.lastMs)
      }));
  }

  function snapshot({ state = null, caseData = null } = {}) {
    const elapsedMs = Math.max(1, performance.now() - windowStartedAt);
    const minutes = elapsedMs / 60000;
    const scans = rows('scan');
    const messages = rows('message');
    const networks = rows('network');
    const renders = rows('render');
    const writeCount = finite(counters.storageWrites);
    const scanCount = scans.reduce((sum, item) => sum + item.count, 0);
    const stateBytes = state ? bytesOf(state) : 0;
    const caseBytes = caseData ? bytesOf(caseData) : 0;
    const journalBytes = caseData?.journal ? bytesOf(caseData.journal) : 0;
    const heapBytes = finite(globalThis.performance?.memory?.usedJSHeapSize);
    const maxScanMs = scans.reduce((max, item) => Math.max(max, item.maxMs), 0);
    const maxRenderMs = renders.reduce((max, item) => Math.max(max, item.maxMs), 0);
    const writesPerMinute = Math.round((writeCount / minutes) * 10) / 10;
    const scansPerMinute = Math.round((scanCount / minutes) * 10) / 10;
    const pressure = (
      (writesPerMinute > 18 ? 2 : writesPerMinute > 8 ? 1 : 0)
      + (scansPerMinute > 30 ? 2 : scansPerMinute > 14 ? 1 : 0)
      + (maxScanMs > 450 ? 2 : maxScanMs > 180 ? 1 : 0)
      + (caseBytes > 650000 ? 2 : caseBytes > 300000 ? 1 : 0)
      + (maxRenderMs > 90 ? 2 : maxRenderMs > 35 ? 1 : 0)
    );

    return {
      elapsedMs: Math.round(elapsedMs),
      level: pressure >= 6 ? 'high' : pressure >= 3 ? 'medium' : 'low',
      counters: { ...counters },
      milestones: { ...milestones },
      scans,
      messages,
      networks,
      renders,
      rates: { writesPerMinute, scansPerMinute },
      sizes: { stateBytes, caseBytes, journalBytes, heapBytes }
    };
  }

  function reset() {
    for (const key of Object.keys(counters)) delete counters[key];
    for (const key of Object.keys(timings)) delete timings[key];
    for (const key of Object.keys(milestones)) delete milestones[key];
    windowStartedAt = performance.now();
    mark('reset');
  }

  WB.performanceMonitor = Object.freeze({
    begin,
    record,
    count,
    mark,
    snapshot,
    reset,
    bytesOf
  });
  mark('monitor-ready');
})();
