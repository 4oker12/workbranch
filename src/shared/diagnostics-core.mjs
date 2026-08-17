export const DIAGNOSTICS_SCHEMA_VERSION = 1;
export const DIAGNOSTICS_MAX_ENTRIES = 200;
export const DIAGNOSTICS_MAX_BYTES = 420000;
export const DIAGNOSTICS_MAX_STACK = 4200;
export const DIAGNOSTICS_MAX_MESSAGE = 700;
export const DIAGNOSTICS_MAX_DETAILS_BYTES = 9000;

const SECRET_KEYS = /(^|_)(pp|password|passwd|pass|token|secret|csrf|cookie|authorization|auth|session|sessionid|sid)(_|$)/i;
const SECRET_QUERY_KEYS = /^(pp|password|passwd|pass|token|secret|_csrf|csrf|session|sessionid|sid|auth|authorization)$/i;
const ALLOWED_SEVERITY = new Set(['DEBUG', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL']);

export function stableDiagnosticHash(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function truncateDiagnosticText(value, max = DIAGNOSTICS_MAX_MESSAGE) {
  const text = String(value == null ? '' : value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

export function redactDiagnosticUrl(raw) {
  const text = truncateDiagnosticText(raw, 1600);
  if (!text) return '';
  try {
    const url = new URL(text);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.test(key)) url.searchParams.set(key, '[redacted]');
    }
    if (url.username) url.username = '[redacted]';
    if (url.password) url.password = '[redacted]';
    return truncateDiagnosticText(url.href, 1600);
  } catch {
    return text
      .replace(/([?&](?:pp|password|passwd|pass|token|secret|_csrf|csrf|session|sessionid|sid|auth|authorization)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
  }
}

function roughBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function sanitizePrimitive(value) {
  if (typeof value === 'string') return redactDiagnosticUrl(truncateDiagnosticText(value, 1200));
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value == null) return value;
  return truncateDiagnosticText(String(value), 500);
}

export function sanitizeDiagnosticDetails(input, depth = 0, seen = new WeakSet()) {
  if (input == null || typeof input !== 'object') return sanitizePrimitive(input);
  if (depth >= 4) return '[truncated-depth]';
  if (seen.has(input)) return '[circular]';
  seen.add(input);

  if (Array.isArray(input)) {
    const output = input.slice(0, 24).map(item => sanitizeDiagnosticDetails(item, depth + 1, seen));
    if (input.length > 24) output.push(`[+${input.length - 24} items]`);
    return output;
  }

  const output = {};
  for (const [key, raw] of Object.entries(input).slice(0, 48)) {
    if (SECRET_KEYS.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    const value = sanitizeDiagnosticDetails(raw, depth + 1, seen);
    output[key] = value;
    if (roughBytes(output) > DIAGNOSTICS_MAX_DETAILS_BYTES) {
      output.__truncated = true;
      break;
    }
  }
  return output;
}

export function normalizeDiagnosticEntry(raw = {}, meta = {}) {
  const timestamp = new Date(raw.timestamp || raw.at || Date.now()).toISOString();
  const severity = ALLOWED_SEVERITY.has(String(raw.severity || '').toUpperCase())
    ? String(raw.severity).toUpperCase()
    : 'ERROR';
  const errorLike = raw.error && typeof raw.error === 'object' ? raw.error : null;
  const message = truncateDiagnosticText(
    raw.message || raw.reason || errorLike?.message || raw.code || 'Workbench diagnostic event',
    DIAGNOSTICS_MAX_MESSAGE
  );
  const stack = severity === 'ERROR' || severity === 'CRITICAL'
    ? truncateDiagnosticText(raw.stack || errorLike?.stack || '', DIAGNOSTICS_MAX_STACK)
    : '';
  const source = truncateDiagnosticText(raw.source || meta.source || 'workbench', 120);
  const operationType = truncateDiagnosticText(raw.operationType || raw.operation || '', 120);
  const code = truncateDiagnosticText(raw.code || `${operationType || source}_FAILURE`, 140).toUpperCase();
  const details = sanitizeDiagnosticDetails(raw.details || {});
  const entry = {
    id: truncateDiagnosticText(raw.id || `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`, 120),
    severity,
    code,
    operationType,
    stage: truncateDiagnosticText(raw.stage || '', 120),
    source,
    message,
    reason: truncateDiagnosticText(raw.reason || '', 700),
    expected: sanitizeDiagnosticDetails(raw.expected ?? null),
    actual: sanitizeDiagnosticDetails(raw.actual ?? null),
    caseId: truncateDiagnosticText(raw.caseId || meta.caseId || '', 160),
    subscriber: truncateDiagnosticText(raw.subscriber || meta.subscriber || '', 120),
    system: truncateDiagnosticText(raw.system || meta.system || '', 80),
    pageKind: truncateDiagnosticText(raw.pageKind || meta.pageKind || '', 100),
    tabId: Number.isInteger(Number(raw.tabId ?? meta.tabId)) ? Number(raw.tabId ?? meta.tabId) : null,
    frameId: Number.isInteger(Number(raw.frameId ?? meta.frameId)) ? Number(raw.frameId ?? meta.frameId) : null,
    documentId: truncateDiagnosticText(raw.documentId || meta.documentId || '', 160),
    pageInstanceId: truncateDiagnosticText(raw.pageInstanceId || meta.pageInstanceId || '', 160),
    version: truncateDiagnosticText(raw.version || meta.version || '', 60),
    url: redactDiagnosticUrl(raw.url || meta.url || ''),
    operationId: truncateDiagnosticText(raw.operationId || '', 160),
    stack,
    details,
    count: Math.max(1, Number(raw.count || 1)),
    unread: severity === 'WARNING' || severity === 'ERROR' || severity === 'CRITICAL',
    firstSeenAt: timestamp,
    lastSeenAt: timestamp
  };
  entry.signature = truncateDiagnosticText(
    raw.signature || stableDiagnosticHash([
      entry.code,
      entry.operationType,
      entry.stage,
      entry.source,
      entry.message.replace(/\b\d{5,}\b/g, '#')
    ].join('|')),
    120
  );
  return entry;
}

export function emptyDiagnosticsState() {
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    updatedAt: '',
    unreadCount: 0,
    entries: []
  };
}

function recomputeUnread(state) {
  state.unreadCount = state.entries.reduce((sum, entry) => sum + (entry.unread ? 1 : 0), 0);
  return state;
}

export function diagnosticsBytes(state) {
  return roughBytes(state);
}

export function pruneDiagnosticsState(state) {
  state.entries = Array.isArray(state.entries) ? state.entries.slice(0, DIAGNOSTICS_MAX_ENTRIES) : [];
  while (state.entries.length && diagnosticsBytes(state) > DIAGNOSTICS_MAX_BYTES) {
    state.entries.pop();
  }
  state.updatedAt = new Date().toISOString();
  return recomputeUnread(state);
}

export function applyDiagnosticEntries(currentState, rawEntries = [], meta = {}) {
  const state = currentState && typeof currentState === 'object'
    ? {
        schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
        updatedAt: String(currentState.updatedAt || ''),
        unreadCount: Number(currentState.unreadCount || 0),
        entries: Array.isArray(currentState.entries) ? currentState.entries.map(item => ({ ...item })) : []
      }
    : emptyDiagnosticsState();

  for (const raw of rawEntries) {
    const entry = normalizeDiagnosticEntry(raw, meta);
    if (entry.severity === 'DEBUG') continue;
    const existingIndex = state.entries.findIndex(item => item.signature === entry.signature);
    if (existingIndex >= 0) {
      const existing = state.entries.splice(existingIndex, 1)[0];
      state.entries.unshift({
        ...existing,
        ...entry,
        id: existing.id || entry.id,
        count: Math.max(1, Number(existing.count || 1)) + Math.max(1, Number(entry.count || 1)),
        firstSeenAt: existing.firstSeenAt || entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        unread: Boolean(existing.unread || entry.unread)
      });
    } else {
      state.entries.unshift(entry);
    }
  }
  return pruneDiagnosticsState(state);
}

export function markDiagnosticsRead(currentState) {
  const state = currentState && typeof currentState === 'object'
    ? { ...currentState, entries: (currentState.entries || []).map(entry => ({ ...entry, unread: false })) }
    : emptyDiagnosticsState();
  state.updatedAt = new Date().toISOString();
  return recomputeUnread(state);
}

export function clearDiagnosticsState() {
  const state = emptyDiagnosticsState();
  state.updatedAt = new Date().toISOString();
  return state;
}
