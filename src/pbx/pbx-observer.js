(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (location.hostname !== 'pbx.simnet.kiev.ua') return;

  const MESSAGE = 'PBX_RECENT_CALLS_OBSERVED';
  const REFRESH_MESSAGE = 'SIMNET_WB_PBX_REFRESH_NOW';
  const SCHEMA = 'simnet-pbx-recent-calls-v1';
  const MAX_CALLS_PER_SNAPSHOT = 80;
  let lastSignature = '';
  let publishTimer = 0;

  const compact = (value, max = 160) => {
    const text = String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  async function reportDiagnostic(entry = {}) {
    try {
      await chrome.runtime.sendMessage({
        type: 'DIAGNOSTICS_REPORT',
        payload: {
          entry: {
            severity: 'ERROR',
            operationType: 'PBX_OBSERVER',
            source: 'pbx-observer',
            pageKind: 'pbx-calls',
            url: location.href,
            ...entry
          }
        }
      });
    } catch {}
  }

  const normalizedHeader = value => compact(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_#]+/g, '');

  function recordIdOf(cell) {
    if (!cell) return '';
    const candidates = [
      ...Array.from(cell.querySelectorAll?.('[id],a[href],a[onclick]') || []).flatMap(node => [
        node.getAttribute?.('id') || '',
        node.getAttribute?.('href') || '',
        node.getAttribute?.('onclick') || ''
      ]),
      cell.getAttribute?.('id') || '',
      cell.innerHTML || '',
      cell.textContent || ''
    ];
    for (const candidate of candidates) {
      const match = String(candidate).match(/(?:textid-|getrec\.php\?id=)?(\d{9,12}\.\d{1,12})/i);
      if (match) return match[1];
    }
    return '';
  }

  function phoneOf(value) {
    const raw = compact(value, 40);
    const digits = raw.replace(/\D+/g, '');
    return digits.length >= 6 && digits.length <= 15 ? digits : '';
  }

  function durationSeconds(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function localStartedAtMs(date, time) {
    const dateMatch = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(time || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!dateMatch || !timeMatch) return 0;
    const value = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] || 0)
    ).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function parseTable(table) {
    const rows = Array.from(table?.rows || table?.querySelectorAll?.('tr') || []);
    if (rows.length < 2) return [];
    const headerCells = Array.from(rows[0].cells || rows[0].querySelectorAll?.('th,td') || []);
    const headers = headerCells.map(cell => normalizedHeader(cell.textContent));
    if (!headers.includes('callerid') || !headers.includes('callid')) return [];

    const index = name => headers.indexOf(name);
    const textAt = (cells, name) => {
      const position = index(name);
      return position >= 0 ? compact(cells[position]?.textContent || '') : '';
    };

    const calls = [];
    for (const row of rows.slice(1)) {
      const cells = Array.from(row.cells || row.querySelectorAll?.('td') || []);
      const callCell = cells[index('callid')] || null;
      const recordId = recordIdOf(callCell);
      if (!recordId) continue;

      const agent = textAt(cells, 'agent');
      const extensionText = textAt(cells, 'extension');
      const agentExtension = String(agent.match(/^\s*(\d{3,6})\b/)?.[1]
        || extensionText.match(/\b(\d{3,6})\b/)?.[1]
        || '');
      const date = textAt(cells, 'date');
      const time = textAt(cells, 'time');
      const duration = textAt(cells, 'duration');
      const ip = textAt(cells, 'ip');
      const providerCode = compact(textAt(cells, 'prov'), 12);

      calls.push({
        callKey: `pbx:${recordId}`,
        recordId,
        recordUrl: `https://pbx.simnet.kiev.ua/fop2/getrec.php?id=${encodeURIComponent(recordId)}`,
        date,
        time,
        startedAtMs: localStartedAtMs(date, time),
        callerId: phoneOf(textAt(cells, 'callerid')),
        providerCode,
        contract: textAt(cells, 'contract'),
        subscriberIp: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : '',
        holdtime: Math.max(0, Number.parseInt(textAt(cells, 'holdtime'), 10) || 0),
        duration,
        durationSeconds: durationSeconds(duration),
        queue: textAt(cells, 'queue'),
        agent,
        agentExtension,
        observedAt: new Date().toISOString()
      });
    }
    return calls;
  }

  function parsePbxRecentCalls(root = document) {
    const byKey = new Map();
    for (const table of Array.from(root?.querySelectorAll?.('table') || [])) {
      for (const call of parseTable(table)) byKey.set(call.callKey, call);
    }
    return [...byKey.values()]
      .sort((left, right) => Number(right.startedAtMs || 0) - Number(left.startedAtMs || 0))
      .slice(0, MAX_CALLS_PER_SNAPSHOT);
  }

  function callSignature(calls) {
    return calls.map(call => [
      call.callKey,
      call.providerCode,
      call.contract,
      call.subscriberIp,
      call.agent,
      call.duration
    ].join(':')).join('|');
  }

  async function fetchFreshRoot() {
    if (typeof fetch !== 'function' || typeof DOMParser === 'undefined') return null;
    const response = await fetch(location.href, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    if (!response.ok) throw new Error(`PBX refresh returned HTTP ${response.status}`);
    const html = await response.text();
    const root = new DOMParser().parseFromString(html, 'text/html');
    return root?.documentElement ? root : null;
  }

  async function publish({ force = false, fresh = false } = {}) {
    let source = 'current-dom';
    let calls = [];

    if (fresh) {
      try {
        const fetched = await fetchFreshRoot();
        if (fetched) {
          calls = parsePbxRecentCalls(fetched);
          source = calls.length ? 'fresh-fetch' : 'current-dom-fallback';
        }
      } catch (error) {
        source = 'current-dom-fallback';
        void reportDiagnostic({
          severity: 'WARN',
          code: 'PBX_FRESH_LIST_FETCH_FAILED',
          stage: 'REFRESH',
          message: error?.message || String(error)
        });
      }
    }

    if (!calls.length) calls = parsePbxRecentCalls(document);
    if (!calls.length) {
      return { ok: false, refreshed: false, published: false, callCount: 0, source, reason: 'pbx-call-table-not-found' };
    }

    const signature = callSignature(calls);
    if (!force && signature === lastSignature) {
      return { ok: true, refreshed: fresh, published: false, callCount: calls.length, source };
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE,
        payload: {
          schema: SCHEMA,
          observedAt: new Date().toISOString(),
          pageUrl: location.href,
          calls
        }
      });
      if (!response?.success) throw new Error(response?.error || 'PBX snapshot rejected by Service Worker');
      lastSignature = signature;
      return { ok: true, refreshed: fresh, published: true, callCount: calls.length, source };
    } catch (error) {
      if (!/context invalidated|receiving end does not exist/i.test(String(error?.message || error))) {
        console.warn('[SIMNET Workbench][PBX] snapshot rejected', error);
        void reportDiagnostic({
          code: 'PBX_SNAPSHOT_PUBLISH_FAILED',
          stage: 'PUBLISH',
          message: error?.message || String(error),
          stack: error?.stack || '',
          details: { callCount: calls.length }
        });
      }
      return { ok: false, refreshed: fresh, published: false, callCount: calls.length, source, reason: 'publish-failed' };
    }
  }

  function schedulePublish() {
    clearTimeout(publishTimer);
    publishTimer = window.setTimeout(() => void publish(), 120);
  }

  chrome.runtime.onMessage?.addListener?.((message, _sender, sendResponse) => {
    if (String(message?.type || '') !== REFRESH_MESSAGE) return false;
    // Explicit operator action replaces permanent DOM observation: get a fresh
    // PBX page snapshot right before the call picker queries its cached calls.
    void publish({ force: true, fresh: true })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, refreshed: false, reason: error?.message || String(error) }));
    return true;
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(publishTimer);
  }, { once: true });
  window.addEventListener('pageshow', schedulePublish);
  document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden) schedulePublish();
  });

  window.addEventListener('error', event => {
    void reportDiagnostic({
      code: 'PBX_UNHANDLED_ERROR',
      stage: 'UNHANDLED',
      message: event?.message || event?.error?.message || 'Unhandled PBX observer error',
      stack: event?.error?.stack || '',
      details: { filename: event?.filename || '', lineno: event?.lineno || 0 }
    });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event?.reason;
    void reportDiagnostic({
      code: 'PBX_UNHANDLED_REJECTION',
      stage: 'UNHANDLED',
      message: reason?.message || String(reason || 'Unhandled PBX observer rejection'),
      stack: reason?.stack || ''
    });
  });

  globalThis.__SIMNET_WB_PBX_TEST_API__ = Object.freeze({
    recordIdOf,
    durationSeconds,
    parsePbxRecentCalls,
    publish
  });

  schedulePublish();
})();
