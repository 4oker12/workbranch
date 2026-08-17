import { MessageType } from './shared/messages.js';
import {
  LocatorObservationType,
  LocatorAction,
  LocatorTermination,
  ensureLocatorShape,
  applyLocatorObservations,
  evaluateLocatorPolicy,
  locatorSnapshot,
  isBindingRejected,
  currentBillingBinding,
  pollPartialStable,
  requiredTechnicalFieldsForCase
} from './core/locator-policy.js';
import {
  RouteRelation,
  classifyContextRelation,
  classifyObservationRelation,
  gateContextForCommit
} from './core/route-controller.js';
import {
  CorrelationVerdict,
  PollAttemptStage,
  identityFingerprint,
  makeEventEnvelope,
  nextPollAttempt,
  pollAttemptPending,
  routeStateSignature,
  validateCorrelation,
  validateDiagnosticInvariants
} from './core/correlation.js';
import {
  applyDiagnosticEntries,
  clearDiagnosticsState,
  diagnosticsBytes,
  emptyDiagnosticsState,
  markDiagnosticsRead
} from './shared/diagnostics-core.mjs';

const VERSION = '1.7.29.50';
const POLL_STALE_TIMEOUT_MS = 90000;
const POLL_LATE_RESPONSE_MAX_AGE_MS = 180000;
const RECOVERABLE_POLL_TIMEOUT_REASONS = new Set([
  'poll-request-document-not-opened',
  'poll-attempt-stale'
]);
const STATE_KEY = 'simnet_workbench_state_v5';
const ACTION_SESSION_FAST_KEY = 'simnet_workbench_action_session_fast_v1';
const PREVIOUS_STATE_KEY = 'simnet_workbench_state_v4';
const LOCAL_UPDATE_META_KEY = 'simnet_workbench_local_update_meta_v1';
const DIAGNOSTICS_KEY = 'simnet_workbench_diagnostics_v1';
const DIAGNOSTICS_FALLBACK_KEY = 'simnet_workbench_diagnostics_fallback_v1';
const MAX_CASES = 60;
const MAX_JOURNAL = 240;
const MAX_JOURNAL_BYTES = 120000;
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const CLAIMED_HANDOFF_TTL_MS = 30 * 60 * 1000;
const MAX_PROCESSED_EVENT_IDS = 160;
const MAX_PBX_CALLS = 120;
const MAX_CASE_CALL_BINDINGS = 16;
const PBX_CALL_TTL_MS = 48 * 60 * 60 * 1000;

const ALLOWED_HOSTS = new Set([
  'userside.simnet.kiev.ua',
  'admin.simnet.kiev.ua',
  'admin.looknet.kiev.ua'
]);
const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
const PBX_ORIGIN = 'https://pbx.simnet.kiev.ua';
const CALL_FORM_PATH = '/message/tab';
const CALL_SAVE_PATH = '/message/save_call';

let writeQueue = Promise.resolve();
let mainStateCache = null;
let mainStateLoadPromise = null;
let fastActionSessionsCache = null;
let diagnosticsWriteQueue = Promise.resolve();
let diagnosticsCache = null;
let diagnosticsPending = [];
let diagnosticsWaiters = [];
let diagnosticsFlushTimer = null;
let diagnosticsReportingFailure = false;

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}


function diagnosticSenderMeta(sender = {}, entry = {}) {
  return {
    source: String(entry?.source || 'service-worker'),
    caseId: String(entry?.caseId || ''),
    subscriber: String(entry?.subscriber || ''),
    system: String(entry?.system || ''),
    pageKind: String(entry?.pageKind || ''),
    tabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null,
    frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0,
    documentId: String(sender?.documentId || entry?.documentId || ''),
    pageInstanceId: String(entry?.pageInstanceId || ''),
    version: VERSION,
    url: String(sender?.url || entry?.url || '')
  };
}

async function readDiagnostics() {
  if (diagnosticsCache) return clone(diagnosticsCache);
  const stored = await chrome.storage.local.get([DIAGNOSTICS_KEY, DIAGNOSTICS_FALLBACK_KEY]);
  const value = stored?.[DIAGNOSTICS_KEY];
  let state = value && typeof value === 'object' ? value : emptyDiagnosticsState();
  const fallback = Array.isArray(stored?.[DIAGNOSTICS_FALLBACK_KEY]) ? stored[DIAGNOSTICS_FALLBACK_KEY] : [];
  if (fallback.length) {
    state = applyDiagnosticEntries(state, fallback, { source: 'content-fallback', version: VERSION });
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: state });
    await chrome.storage.local.remove(DIAGNOSTICS_FALLBACK_KEY);
  }
  diagnosticsCache = state;
  return clone(diagnosticsCache);
}

async function updateDiagnosticsBadge(state = diagnosticsCache) {
  const unread = Math.max(0, Number(state?.unreadCount || 0));
  const text = unread > 99 ? '99+' : unread ? String(unread) : '';
  try {
    await chrome.action?.setBadgeText?.({ text });
    if (text) await chrome.action?.setBadgeBackgroundColor?.({ color: '#A50046' });
  } catch {}
}

function flushDiagnosticsBatch() {
  if (diagnosticsFlushTimer) {
    clearTimeout(diagnosticsFlushTimer);
    diagnosticsFlushTimer = null;
  }
  const batch = diagnosticsPending.splice(0);
  const waiters = diagnosticsWaiters.splice(0);
  if (!batch.length) {
    for (const waiter of waiters) waiter.resolve({ accepted: true, unreadCount: Number(diagnosticsCache?.unreadCount || 0) });
    return diagnosticsWriteQueue;
  }

  const operation = async () => {
    try {
      let state = await readDiagnostics();
      for (const item of batch) {
        state = applyDiagnosticEntries(state, [item.entry], item.meta);
      }
      diagnosticsCache = state;
      await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: state });
      await updateDiagnosticsBadge(state);
      const result = { accepted: true, unreadCount: Number(state.unreadCount || 0), sizeBytes: diagnosticsBytes(state) };
      for (const waiter of waiters) waiter.resolve(result);
      return result;
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
      throw error;
    }
  };

  diagnosticsWriteQueue = diagnosticsWriteQueue.then(operation, operation).catch(error => {
    if (!diagnosticsReportingFailure) {
      diagnosticsReportingFailure = true;
      console.error('[SIMNET Workbench][DIAGNOSTICS] persistent reporter failed', error);
      diagnosticsReportingFailure = false;
    }
  });
  return diagnosticsWriteQueue;
}

function enqueueDiagnostic(entry = {}, sender = {}) {
  if (!entry || typeof entry !== 'object') return Promise.resolve({ accepted: false, reason: 'invalid-entry' });
  return new Promise((resolve, reject) => {
    diagnosticsPending.push({ entry, meta: diagnosticSenderMeta(sender, entry) });
    diagnosticsWaiters.push({ resolve, reject });
    const immediate = String(entry.severity || '').toUpperCase() === 'CRITICAL' || diagnosticsPending.length >= 16;
    if (immediate) {
      void flushDiagnosticsBatch();
      return;
    }
    if (!diagnosticsFlushTimer) {
      diagnosticsFlushTimer = setTimeout(() => { void flushDiagnosticsBatch(); }, 140);
    }
  });
}

async function markAllDiagnosticsRead() {
  await flushDiagnosticsBatch();
  const state = markDiagnosticsRead(await readDiagnostics());
  diagnosticsCache = state;
  await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: state });
  await updateDiagnosticsBadge(state);
  return clone(state);
}

async function clearDiagnostics() {
  diagnosticsPending = [];
  for (const waiter of diagnosticsWaiters.splice(0)) waiter.resolve({ accepted: false, reason: 'cleared' });
  if (diagnosticsFlushTimer) clearTimeout(diagnosticsFlushTimer);
  diagnosticsFlushTimer = null;
  await diagnosticsWriteQueue;
  const state = clearDiagnosticsState();
  diagnosticsCache = state;
  await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: state });
  await updateDiagnosticsBadge(state);
  return clone(state);
}

async function exportDiagnosticsBundle() {
  await flushDiagnosticsBatch();
  const diagnostics = await readDiagnostics();
  const state = await readState();
  const referencedCaseIds = new Set(
    diagnostics.entries.map(entry => String(entry.caseId || '')).filter(Boolean)
  );
  if (state?.activeCaseId) referencedCaseIds.add(String(state.activeCaseId));
  const cases = [...referencedCaseIds].slice(0, 20).map(caseId => {
    const current = state?.cases?.[caseId] || null;
    return {
      caseId,
      login: rawFactValue(current?.identity?.login),
      contract: rawFactValue(current?.identity?.contract),
      billingId: rawFactValue(current?.identity?.billingId),
      customerId: rawFactValue(current?.identity?.customerId),
      currentContext: current?.currentContext ? {
        system: String(current.currentContext.system || ''),
        pageKind: String(current.currentContext.pageKind || ''),
        entityId: String(current.currentContext.entityId || ''),
        documentId: String(current.currentContext.correlation?.documentId || current.currentContext.meta?.documentId || '')
      } : null
    };
  });
  return {
    schema: 'simnet-workbench-diagnostics-export-v1',
    workbenchVersion: VERSION,
    exportedAt: nowIso(),
    activeCaseId: String(state?.activeCaseId || ''),
    runtime: {
      manifestVersion: 3,
      diagnosticEntries: diagnostics.entries.length,
      unreadCount: diagnostics.unreadCount,
      diagnosticsBytes: diagnosticsBytes(diagnostics)
    },
    cases,
    diagnostics
  };
}

function reportBackgroundUnhandled(kind, error) {
  if (diagnosticsReportingFailure) return;
  const err = error instanceof Error ? error : new Error(String(error?.message || error || kind));
  console.error(`[SIMNET WB][SW][${kind}]`, err);
  void enqueueDiagnostic({
    severity: 'ERROR',
    code: kind,
    operationType: 'SERVICE_WORKER_RUNTIME',
    source: 'service-worker',
    stage: 'UNHANDLED',
    message: err.message || kind,
    stack: err.stack || '',
    error: { message: err.message || '', stack: err.stack || '', name: err.name || '' }
  }).catch(() => {});
}

globalThis.addEventListener?.('error', event => {
  reportBackgroundUnhandled('SERVICE_WORKER_UNHANDLED_ERROR', event?.error || event?.message || 'Unhandled Service Worker error');
});

globalThis.addEventListener?.('unhandledrejection', event => {
  reportBackgroundUnhandled('SERVICE_WORKER_UNHANDLED_REJECTION', event?.reason || 'Unhandled Service Worker rejection');
});

function stableEpisodeId(caseId, createdAt) {
  const text = `${caseId}|${createdAt}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `episode_${(hash >>> 0).toString(36)}_${String(createdAt || '').replace(/\D+/g, '').slice(0, 14)}`;
}

function clone(value) {
  return value == null
    ? value
    : JSON.parse(JSON.stringify(value));
}

function compact(value, max = 240) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > max
    ? `${text.slice(0, max)}…`
    : text;
}

function truncateText(value, max = 1000) {
  const text = String(value == null ? '' : value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stableHash(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function comparable(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeMac(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex : '';
}

function normalizeSerial(value) {
  return String(value || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
}

function ensureJuniperEvidenceShape(caseData) {
  caseData.juniper ||= {};
  const evidence = caseData.juniper.evidence ||= {};
  if (!('read' in evidence)) evidence.read = null;
  if (!('opened' in evidence)) evidence.opened = null;
  if (!('verified' in evidence)) evidence.verified = null;
  return evidence;
}

function juniperIdentityCheck(caseData, details = {}) {
  const expectedIp = String(rawFactValue(caseData?.network?.ip) || '');
  const expectedMac = normalizeMac(rawFactValue(caseData?.network?.mac) || '');
  const observedIp = String(details?.subscriberIp || '');
  const observedMac = normalizeMac(details?.subscriberMac || '');
  const ipConflict = Boolean(expectedIp && observedIp && expectedIp !== observedIp);
  const macConflict = Boolean(expectedMac && observedMac && expectedMac !== observedMac);
  return {
    isMatch: !(ipConflict || macConflict),
    expectedIp,
    observedIp,
    expectedMac,
    observedMac,
    ipConflict,
    macConflict
  };
}

function applyJuniperCaseEvidence(caseData, observation, envelope = {}, options = {}) {
  if (!caseData || observation?.type !== LocatorObservationType.JUNIPER_SESSION) {
    return { applied: false, reason: 'not-juniper' };
  }
  const now = nowIso();
  const details = observation.details || {};
  const result = String(observation.result || details.status || 'unknown').toLowerCase();
  const automatic = Boolean(details.preview || observation.passiveReason === 'juniper-background-preview' || options.automatic);
  const parsed = result !== 'error';
  const identityCheck = juniperIdentityCheck(caseData, details);
  const evidence = ensureJuniperEvidenceShape(caseData);
  const source = automatic ? 'automatic' : 'operator-page';

  observation.details = { ...details, identityCheck, readSource: source };

  if (parsed && !identityCheck.isMatch) {
    caseData.juniper.dataStatus = 'stale';
    caseData.juniper.result = 'identity_mismatch';
    caseData.juniper.details = observation.details;
    caseData.juniper.failureReason = 'identity-mismatch';
    caseData.juniper.verified = false;
    caseData.juniper.updatedAt = now;
    observation.passive = true;
    observation.passiveReason = 'juniper-identity-mismatch';
    void enqueueDiagnostic({
      severity: 'ERROR',
      code: 'JUNIPER_RESULT_CASE_MISMATCH',
      operationType: 'JUNIPER_READ',
      source: 'service-worker',
      stage: automatic ? 'AUTOMATIC_READ' : 'MANUAL_PAGE',
      caseId: String(caseData.id || ''),
      subscriber: String(rawFactValue(caseData.identity?.login) || ''),
      message: 'Juniper вернул идентификаторы, конфликтующие с текущим Case',
      details: { identityCheck, result, requestId: String(envelope?.operation?.requestId || '') }
    }).catch(() => {});
    return { applied: false, reason: 'identity-mismatch', identityCheck };
  }

  caseData.juniper = {
    ...caseData.juniper,
    dataStatus: parsed ? 'available' : 'error',
    requestId: String(envelope?.operation?.requestId || caseData.juniper?.requestId || ''),
    result,
    details: observation.details,
    summary: compact(observation.summary || '', 360),
    method: observation.method || '',
    readOnly: true,
    preview: automatic,
    readSource: parsed ? source : String(caseData.juniper?.readSource || ''),
    verified: parsed && identityCheck.isMatch,
    failureReason: parsed ? '' : 'parse-error',
    updatedAt: now
  };

  if (parsed) {
    caseData.juniper.readAt ||= now;
    caseData.juniper.lastReadAt = now;
    if (automatic) caseData.juniper.autoReadAt ||= now;
    caseData.juniper.verifiedAt = now;
    evidence.read ||= {
      kind: 'JUNIPER_READ',
      at: now,
      source,
      result,
      method: observation.method || '',
      requestId: String(envelope?.operation?.requestId || '')
    };
    evidence.verified = {
      kind: 'JUNIPER_VERIFIED',
      at: now,
      source: 'correlation+parser',
      result,
      identityCheck
    };
  }

  return { applied: parsed, parsed, automatic, identityCheck, result };
}

function markJuniperOpened(caseData, context = {}) {
  if (!caseData || String(context?.pageKind || '') !== 'billing_juniper') return false;
  const evidence = ensureJuniperEvidenceShape(caseData);
  const at = String(context?.observedAt || nowIso());
  const firstOpen = !evidence.opened;
  evidence.opened ||= {
    kind: 'JUNIPER_OPENED',
    at,
    source: 'operator',
    pageKind: 'billing_juniper',
    documentId: String(context?.meta?.documentId || '')
  };
  caseData.juniper.openedAt ||= at;
  caseData.juniper.operatorOpened = true;
  caseData.juniper.reviewStatus = caseData.juniper.verified ? 'reviewed' : 'opened';
  if (caseData.juniper.verified) caseData.juniper.reviewedAt ||= at;
  return firstOpen;
}

function normalizePonInterface(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/^([eg]pon)/i, match => match.toUpperCase())
    .toUpperCase();
}

function equivalentFactValue(groupName, key, left, right) {
  if (comparable(left) === comparable(right)) return true;
  if (groupName === 'pon' && ['locatedInterface', 'tmcPort', 'port'].includes(key)) {
    const a = normalizePonInterface(left);
    const b = normalizePonInterface(right);
    if (!a || !b) return false;
    return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
  }
  return false;
}

function conflictKey(entry = {}) {
  return [
    entry.field || '',
    comparable(entry.oldValue),
    comparable(entry.newValue),
    entry.oldSource || '',
    entry.newSource || '',
    entry.accepted ? '1' : '0'
  ].join('|');
}


function compactExistingConflicts(conflicts = []) {
  const result = [];
  const byKey = new Map();
  for (const raw of Array.isArray(conflicts) ? conflicts : []) {
    if (!raw || typeof raw !== 'object') continue;
    if (
      raw.field === 'pon.locatedInterface'
      && equivalentFactValue('pon', 'locatedInterface', raw.oldValue, raw.newValue)
    ) {
      continue;
    }
    const entry = { ...raw, count: Number(raw.count || 1) };
    const key = conflictKey(entry);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += entry.count;
      if (String(entry.at || '') > String(existing.at || '')) existing.at = entry.at;
      continue;
    }
    byKey.set(key, entry);
    result.push(entry);
  }
  return result.slice(0, 40);
}


function requiredDiagnosticTechnicalFields(caseData) {
  return requiredTechnicalFieldsForCase(caseData);
}

function factValue(fact) {
  return (
    fact
    && typeof fact === 'object'
    && 'value' in fact
  )
    ? fact.value
    : fact;
}

function rawFactValue(fact) {
  return String(factValue(fact) ?? '');
}

function hasFact(group, key) {
  const value = factValue(group?.[key]);
  return (
    value != null
    && String(value).trim() !== ''
  );
}

function extractOltIp(value) {
  const match = String(value || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return match ? match[1] : '';
}

function tmcTechnicalExpectation(caseData) {
  const expected = {
    oltName: String(factValue(caseData?.pon?.tmcOltName) || ''),
    oltIp: String(factValue(caseData?.pon?.tmcOltIp) || ''),
    onuSerial: String(factValue(caseData?.pon?.tmcOnuSerial) || ''),
    onuMac: String(factValue(caseData?.pon?.tmcOnuMac) || '')
  };
  const fields = [];
  if (expected.oltName || expected.oltIp) fields.push('olt');
  if (normalizeSerial(expected.onuSerial)) fields.push('onuSerial');
  if (normalizeMac(expected.onuMac)) fields.push('onuMac');
  return { expected, fields };
}

function tmcFieldMatchesBilling(caseData, field, expected = tmcTechnicalExpectation(caseData).expected) {
  if (field === 'onuSerial') {
    const wanted = normalizeSerial(expected.onuSerial);
    const actual = normalizeSerial(factValue(caseData?.pon?.onuSerial));
    return Boolean(wanted && actual && wanted === actual);
  }
  if (field === 'onuMac') {
    const wanted = normalizeMac(expected.onuMac);
    const actual = normalizeMac(factValue(caseData?.pon?.onuMac));
    return Boolean(wanted && actual && wanted === actual);
  }
  if (field === 'olt') {
    const wantedIp = comparable(expected.oltIp || extractOltIp(expected.oltName));
    const actualName = String(factValue(caseData?.pon?.oltName) || '');
    const actualIp = comparable(factValue(caseData?.pon?.oltIp) || extractOltIp(actualName));
    if (wantedIp && actualIp) return wantedIp === actualIp;
    const wantedName = comparable(expected.oltName);
    const observedName = comparable(actualName);
    if (!wantedName || !observedName) return false;
    return wantedName === observedName
      || wantedName.includes(observedName)
      || observedName.includes(wantedName);
  }
  return false;
}

function makeFact(value, source, confidence = 0.95) {
  return value == null || value === ''
    ? null
    : {
        value,
        source,
        confidence,
        observedAt: nowIso()
      };
}

function emptyUi() {
  return {
    open: true,
    section: 'live',
    top: null,
    compact: false,
    navigationHelp: 'on-demand'
  };
}

function normalizeAppealState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawTypeId = String(source.typeId || '');
  const typeId = /^[a-z][a-z0-9_.-]{1,79}$/.test(rawTypeId) ? rawTypeId : '';
  const graphRevision = compact(source.graphRevision || '', 80);
  let graphType = null;
  if (source.graphType && typeof source.graphType === 'object') {
    try {
      const serialized = JSON.stringify(source.graphType);
      if (serialized.length <= 120000) graphType = JSON.parse(serialized);
    } catch {}
  }
  if (!typeId) {
    return {
      schemaVersion: 1,
      graphRevision,
      graphType: null,
      typeId: '',
      nodeId: '',
      outcomeId: '',
      status: 'empty',
      history: [],
      startedAt: '',
      updatedAt: ''
    };
  }

  const status = ['active', 'complete'].includes(String(source.status || ''))
    ? String(source.status)
    : 'active';
  const history = (Array.isArray(source.history) ? source.history : [])
    .filter(item => item && typeof item === 'object')
    .slice(-24)
    .map(item => ({
      nodeId: compact(item.nodeId || '', 120),
      answerId: compact(item.answerId || '', 80),
      question: compact(item.question || '', 240),
      answer: compact(item.answer || '', 160),
      next: compact(item.next || '', 120),
      at: compact(item.at || '', 40)
    }));

  return {
    schemaVersion: 1,
    graphRevision,
    graphType,
    typeId,
    nodeId: compact(source.nodeId || '', 120),
    outcomeId: status === 'complete' ? compact(source.outcomeId || source.nodeId || '', 120) : '',
    status,
    history,
    startedAt: compact(source.startedAt || nowIso(), 40),
    updatedAt: compact(source.updatedAt || nowIso(), 40),
    completedAt: status === 'complete' ? compact(source.completedAt || source.updatedAt || nowIso(), 40) : ''
  };
}

function emptyState(ui = null) {
  return {
    schemaVersion: 5,
    version: VERSION,
    activeCaseId: '',
    cases: {},
    tabs: {},
    handoffs: {},
    telephony: {
      schema: 'simnet-pbx-call-context-v1',
      calls: {},
      bindings: {},
      updatedAt: ''
    },
    experience: { learnedTargets: {}, updatedAt: '' },
    ui: ui || emptyUi(),
    meta: {
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  };
}



function ensureOperatorTraceShape(caseData) {
  caseData.workflow ||= {};
  const trace = caseData.workflow.operatorTrace ||= {};
  trace.schema ||= 'simnet-operator-trace-mode-v2';
  trace.enabled = Boolean(trace.enabled);
  trace.activatedAt ||= '';
  trace.deactivatedAt ||= '';
  trace.updatedAt ||= '';
  trace.startedAt ||= '';
  trace.stoppedAt ||= '';
  return trace;
}

function ensureActionSessionShape(caseData) {
  caseData.workflow ||= {};
  const lifecycle = caseData.workflow.actionSession ||= {};
  lifecycle.schema ||= 'simnet-universal-action-session-v1';
  if (!('active' in lifecycle)) lifecycle.active = null;
  if (!('lastTerminal' in lifecycle)) lifecycle.lastTerminal = null;
  lifecycle.updatedAt ||= '';
  return lifecycle;
}

function ensureWorkflowShape(caseData) {
  caseData.workflow ||= {};
  const flow = caseData.workflow.ponAcquisition ||= {};
  flow.schema ||= 'simnet-pon-acquisition-v1';
  flow.tmcShownAt ||= '';
  flow.tmcShownOperationId ||= '';
  flow.tmcShownFields = Array.isArray(flow.tmcShownFields)
    ? [...new Set(flow.tmcShownFields.filter(field => ['olt', 'serial', 'mac'].includes(field)))]
    : [];
  // v1.7.29.34 migration: old feature-specific Guide pending flags are not
  // lifecycle state anymore. Drop stale values so they cannot resurrect a
  // pre-universal one-shot/replay/final-highlight after an update/reload.
  for (const deprecated of [
    'pollRevealPending','pollRevealRequestedAt','pollRevealShownAt',
    'pollFinalHintPending','pollFinalHintShownAt',
    'evidenceReplayTarget','evidenceReplayRequestedAt',
    'oneShotFocusTarget','oneShotFocusRequestedAt'
  ]) delete flow[deprecated];
  // Writeback instruction: acknowledgement ≠ verified Billing data.
  flow.instructionAcknowledged = Boolean(flow.instructionAcknowledged);
  flow.instructionAcknowledgedAt ||= '';
  flow.technicalWritebackVerified = Boolean(flow.technicalWritebackVerified);
  flow.technicalWritebackVerifiedAt ||= '';
  flow.tmcWritebackPending = Boolean(flow.tmcWritebackPending);
  flow.tmcWritebackPendingSave = Boolean(flow.tmcWritebackPendingSave);
  flow.tmcWritebackRequestedAt ||= '';
  flow.tmcWritebackAppliedAt ||= '';
  flow.tmcWritebackVerifiedInForm = Boolean(flow.tmcWritebackVerifiedInForm);
  flow.tmcWritebackVerifiedInFormAt ||= '';
  flow.tmcExpectedFields = Array.isArray(flow.tmcExpectedFields) ? [...new Set(flow.tmcExpectedFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
  flow.tmcWritebackAppliedFields = Array.isArray(flow.tmcWritebackAppliedFields) ? [...new Set(flow.tmcWritebackAppliedFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
  flow.tmcWritebackMatchedFields = Array.isArray(flow.tmcWritebackMatchedFields) ? [...new Set(flow.tmcWritebackMatchedFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
  flow.tmcWritebackConflictFields = Array.isArray(flow.tmcWritebackConflictFields) ? [...new Set(flow.tmcWritebackConflictFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
  flow.tmcWritebackSavedAt ||= '';
  flow.tmcWritebackLastStatus ||= '';
  flow.tmcWritebackLastAt ||= '';
  flow.tmcWritebackDeclinedAt ||= '';
  flow.tmcWritebackDeclineReason ||= '';
  flow.tmcWritebackPromptDismissedAt ||= '';
  flow.tmcWritebackPromptDismissReason ||= '';
  flow.tmcWritebackFields = Array.isArray(flow.tmcWritebackFields)
    ? [...new Set(flow.tmcWritebackFields.filter(field => ['olt', 'onuSerial', 'onuMac'].includes(field)))]
    : [];
  if (!flow.expectedTechnicalWriteback || typeof flow.expectedTechnicalWriteback !== 'object') {
    flow.expectedTechnicalWriteback = null;
  }
  flow.updatedAt ||= '';
  return flow;
}

/**
 * Keep expected writeback + verification flags in sync with live Billing evidence.
 * instructionAcknowledged only means the operator dismissed the strong prompt —
 * it must never imply technicalWritebackVerified.
 */
function syncPonWritebackWorkflow(caseData) {
  const flow = ensureWorkflowShape(caseData);
  const diagnostic = caseData.diagnostic || {};
  if (!diagnostic.isPon) return flow;

  const billingSaved = caseData.locator?.sourceStatus?.billing_saved || {};
  const writebackRequestedAt = Date.parse(flow.tmcWritebackRequestedAt || '') || 0;
  const billingSavedAt = Date.parse(billingSaved.updatedAt || '') || 0;
  if (
    flow.tmcWritebackPendingSave
    && billingSaved.result === 'saved'
    && (!writebackRequestedAt || billingSavedAt >= writebackRequestedAt)
  ) {
    flow.tmcWritebackPendingSave = false;
    flow.tmcWritebackSavedAt = nowIso();
    flow.tmcWritebackLastStatus = 'saved';
  }

  const tmcExpectation = tmcTechnicalExpectation(caseData);
  const expectedFields = tmcExpectation.fields;
  const expected = tmcExpectation.expected;
  flow.tmcExpectedFields = expectedFields;

  if (expectedFields.length && !flow.expectedTechnicalWriteback) {
    flow.expectedTechnicalWriteback = expected;
  }

  const matchedFields = expectedFields.filter(field => tmcFieldMatchesBilling(caseData, field, expected));
  const conflictFields = expectedFields.filter(field => {
    if (matchedFields.includes(field)) return false;
    if (field === 'olt') return Boolean(factValue(caseData?.pon?.oltName) || factValue(caseData?.pon?.oltIp));
    if (field === 'onuSerial') return Boolean(normalizeSerial(factValue(caseData?.pon?.onuSerial)));
    if (field === 'onuMac') return Boolean(normalizeMac(factValue(caseData?.pon?.onuMac)));
    return false;
  });
  flow.tmcWritebackConflictFields = conflictFields;

  const allExpectedMatch = expectedFields.length > 0 && matchedFields.length === expectedFields.length;
  const transactionTerminal = !flow.tmcWritebackRequestedAt
    || ['saved', 'already_present'].includes(String(flow.tmcWritebackLastStatus || ''));
  const canVerifyTmcWriteback = Boolean(
    flow.tmcShownAt
    && allExpectedMatch
    && transactionTerminal
    && !flow.tmcWritebackPending
    && !flow.tmcWritebackPendingSave
  );

  if (canVerifyTmcWriteback) {
    flow.tmcWritebackMatchedFields = [...new Set([
      ...(flow.tmcWritebackMatchedFields || []),
      ...matchedFields
    ])];
    if (!flow.technicalWritebackVerified) {
      flow.technicalWritebackVerified = true;
      flow.technicalWritebackVerifiedAt = nowIso();
    }
    flow.expectedTechnicalWriteback = null;
  } else {
    flow.technicalWritebackVerified = false;
    flow.technicalWritebackVerifiedAt = '';
  }

  flow.updatedAt = nowIso();
  return flow;
}

function ensureGuideShape(caseData) {
  caseData.route ||= {};
  const guide = caseData.route.guide ||= {};
  guide.completed ||= {};
  guide.steps ||= {};
  guide.active ||= null;
  guide.sequence = Number(guide.sequence || 0);
  // Repair older persisted Guide records too: native Billing anchors may have
  // carried the live pp inside targetHref before Guide persistence was redacted.
  for (const step of Object.values(guide.steps || {})) {
    if (!step || typeof step !== 'object') continue;
    if (step.hint) step.hint = sanitizeGuidePersistedDetails(step.hint);
    if (step.action) step.action = sanitizeGuidePersistedDetails(step.action);
    if (step.result) step.result = sanitizeGuidePersistedDetails(step.result);
  }
  for (const record of Object.values(guide.completed || {})) {
    if (!record || typeof record !== 'object') continue;
    if (record.details) record.details = sanitizeGuidePersistedDetails(record.details);
    if (record.result) record.result = sanitizeGuidePersistedDetails(record.result);
  }
  // A completed step can never be active again. Multiple Billing/UserSide tabs
  // may emit late Guide events, so repair this invariant whenever the case is read.
  if (guide.active?.stepId) {
    const activeStep = guide.steps?.[guide.active.stepId];
    if (guide.completed?.[guide.active.stepId] || activeStep?.status === 'completed') {
      guide.active = null;
    }
  }
  return guide;
}

function normalizeGuideExpectation(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const type = compact(source.type || '', 80);
  if (!type) return null;
  return {
    ...source,
    type,
    pageKind: compact(source.pageKind || '', 80),
    system: compact(source.system || '', 40),
    searchMode: compact(source.searchMode || '', 40),
    actionMode: compact(source.actionMode || '', 40),
    fields: Array.isArray(source.fields)
      ? source.fields.map(value => compact(value, 40)).filter(Boolean).slice(0, 8)
      : [],
    outcomes: Array.isArray(source.outcomes)
      ? source.outcomes.map(value => compact(value, 60)).filter(Boolean).slice(0, 20)
      : [],
    expectedTechnical: source.expectedTechnical && typeof source.expectedTechnical === 'object'
      ? {
          oltName: compact(source.expectedTechnical.oltName || '', 220),
          oltIp: compact(source.expectedTechnical.oltIp || '', 80),
          onuSerial: compact(source.expectedTechnical.onuSerial || '', 120),
          onuMac: compact(source.expectedTechnical.onuMac || '', 120)
        }
      : null
  };
}

function semanticTargetsForCompletedGuideStep(stepId, record = {}) {
  const id = String(stepId || '');
  const details = record?.details || record?.result || {};
  const targets = new Set();
  const add = value => { if (value) targets.add(value); };

  if (/^billing\.(open|resume|reopen)-technical/.test(id) || id === 'billing.open-technical') {
    add('billing.technical.link');
  }
  if (id.startsWith('billing.inspect-technical:')) {
    add('billing.technical');
    for (const item of Array.isArray(details.fields) ? details.fields : []) {
      const field = typeof item === 'string' ? item : item?.field;
      if (field) add(`billing.technical.${field}`);
    }
  }
  if (id === 'billing.fill-olt' || id.startsWith('billing.fill-technical:')) {
    add('billing.technical');
    for (const field of Array.isArray(details.fields) ? details.fields : []) {
      add(`billing.technical.${typeof field === 'string' ? field : field?.field || ''}`);
    }
  }
  if (id === 'billing.save-olt' || id === 'billing.save-technical-fields') {
    add('billing.technical.save');
  }
  if (id === 'billing.open-userside' || id === 'billing.resume-userside-tmc' || id === 'billing.open-userside-for-mac') {
    add('billing.userside.link');
  }
  if (id.startsWith('userside.inspect-tmc:') || id === 'userside.find-tmc') add('userside.tmc');
  if (id === 'userside.search-mac') add('userside.mac-search');
  if (id === 'userside.search-topology') add('userside.topology-search');
  if (id === 'userside.inspect-interface') add('userside.interface');
  if (['userside.inspect-device', 'userside.open-device-for-onu', 'userside.resume-device-for-onu'].includes(id)) add('userside.device');
  if (id === 'billing.open-poll-tab' || id === 'resume-billing-for-poll') add('billing.poll.tab');
  if (id === 'billing.ask-olt') add('billing.poll.request');
  return [...targets].filter(Boolean);
}

function promoteCompletedGuideToExperience(state, caseData) {
  if (caseData?.locator?.termination?.status !== LocatorTermination.CONFIRMED) return false;
  state.experience ||= { learnedTargets: {}, updatedAt: '' };
  state.experience.learnedTargets ||= {};
  const completed = caseData?.route?.guide?.completed || {};
  let changed = false;
  const completedAt = caseData.locator.termination.completedAt || nowIso();
  for (const [stepId, record] of Object.entries(completed)) {
    for (const target of semanticTargetsForCompletedGuideStep(stepId, record)) {
      const current = state.experience.learnedTargets[target] || {};
      const caseIds = new Set(Array.isArray(current.caseIds) ? current.caseIds : []);
      const firstForCase = !caseIds.has(caseData.id);
      caseIds.add(caseData.id);
      state.experience.learnedTargets[target] = {
        target,
        firstCompletedAt: current.firstCompletedAt || record?.at || completedAt,
        lastCompletedAt: record?.at || completedAt,
        completedCount: Number(current.completedCount || 0) + (firstForCase ? 1 : 0),
        caseIds: [...caseIds].slice(-24),
        lastCaseId: caseData.id
      };
      if (firstForCase) changed = true;
    }
  }
  if (changed) state.experience.updatedAt = nowIso();
  return changed;
}

function markOutOfRouteObservationsPassive(caseData, observations = [], context = {}, routeAction = '') {
  caseData.route ||= {};
  caseData.route.passiveSources ||= {};

  const passiveKey = type => {
    if (type === LocatorObservationType.TMC_RESULT) return 'tmc';
    if ([LocatorObservationType.MAC_SEARCH_RESULT, LocatorObservationType.INTERFACE_CONFIRMATION, LocatorObservationType.DEVICE_DETAILS].includes(type)) return 'networkLocator';
    if ([
      LocatorObservationType.ETHERNET_ACCESS_POINT,
      LocatorObservationType.ETHERNET_DEVICE,
      LocatorObservationType.ETHERNET_FDB_RESULT,
      LocatorObservationType.ETHERNET_PORT_ERRORS
    ].includes(type)) return 'ethernet';
    if (type === LocatorObservationType.POLL_RESULT) return 'poll';
    return '';
  };

  for (const observation of observations) {
    if (!observation?.type) continue;
    // A producer may report what it expected, but it never owns the final
    // relation. Keep the claim only as metadata and always classify again here.
    observation.producerRouteRelation = observation.routeRelation || '';
    observation.producerPassive = Boolean(observation.passive);
    observation.passive = false;
    observation.passiveReason = '';
    const relation = classifyObservationRelation(caseData, observation, context, routeAction);
    observation.routeRelation = relation;

    const key = passiveKey(observation.type);
    if (relation !== RouteRelation.ON_ROUTE) {
      observation.passive = true;
      observation.passiveReason = relation === RouteRelation.FOREIGN
        ? 'foreign-case-context'
        : relation === RouteRelation.SUPPORTING
          ? 'supporting-outside-route'
          : 'outside-current-guide-route';
      if (key) {
        caseData.route.passiveSources[key] = {
          type: observation.type,
          relation,
          observedAt: nowIso()
        };
      }
    } else if (key) {
      delete caseData.route.passiveSources[key];
    }
  }
  return observations;
}

function rememberRouteControllerDecision(caseData, context, routeAction, relation, blockedFacts = [], observations = []) {
  caseData.route ||= {};
  caseData.route.controller ||= {};
  const previous = caseData.route.controller;
  const observationRelations = (observations || [])
    .filter(item => item?.type)
    .map(item => ({
      type: item.type,
      result: item.result || '',
      relation: item.routeRelation || '',
      passive: Boolean(item.passive),
      reason: item.passiveReason || ''
    }));

  caseData.route.controller = {
    requiredAction: String(routeAction || ''),
    relation: String(relation || ''),
    pageKind: String(context?.pageKind || ''),
    system: String(context?.system || ''),
    entityId: String(context?.entityId || ''),
    blockedFactCount: blockedFacts.length,
    blockedFacts: blockedFacts.slice(0, 24),
    observations: observationRelations.slice(0, 16),
    updatedAt: nowIso()
  };

  const signature = JSON.stringify({
    requiredAction: routeAction || '',
    relation,
    pageKind: context?.pageKind || '',
    blocked: blockedFacts.map(item => `${item.group}.${item.key}`),
    observations: observationRelations.map(item => `${item.type}:${item.relation}:${item.result}`)
  });
  const previousSignature = previous?.signature || '';
  caseData.route.controller.signature = signature;

  if (signature !== previousSignature && (
    relation === RouteRelation.OFF_ROUTE
    || relation === RouteRelation.FOREIGN
    || blockedFacts.length
    || observationRelations.some(item => item.passive)
  )) {
    addJournal(
      caseData,
      'route_guard',
      `ROUTE GUARD · ${routeAction || 'none'} · ${relation || 'unknown'}`,
      {
        requiredAction: routeAction || '',
        relation,
        pageKind: context?.pageKind || '',
        system: context?.system || '',
        blockedFacts: blockedFacts.slice(0, 24),
        observations: observationRelations.slice(0, 16)
      }
    );
  }
}

function guideStepRecord(caseData, stepId) {
  const guide = ensureGuideShape(caseData);
  guide.steps[stepId] ||= {
    stepId,
    status: 'new',
    hintedAt: '',
    actionConfirmedAt: '',
    resultConfirmedAt: '',
    failedAt: '',
    hint: null,
    action: null,
    result: null,
    expected: null,
    sequence: 0
  };
  return guide.steps[stepId];
}

function matchesExpectedTechnical(caseData, fields = [], expected = {}) {
  const binding = currentBillingBinding(caseData) || {};
  const actual = {
    oltName: binding.oltName || rawFactValue(caseData?.pon?.oltName) || '',
    oltIp: binding.oltIp || rawFactValue(caseData?.pon?.oltIp) || '',
    onuSerial: rawFactValue(caseData?.pon?.onuSerial) || '',
    onuMac: rawFactValue(caseData?.pon?.onuMac) || ''
  };
  const checks = (fields || []).map(field => {
    if (field === 'olt') {
      const expectedIp = comparable(expected?.oltIp || '');
      const expectedName = comparable(expected?.oltName || '');
      const actualIp = comparable(actual.oltIp || '');
      const actualName = comparable(actual.oltName || '');
      return Boolean(
        (expectedIp && actualIp && expectedIp === actualIp)
        || (expectedName && actualName && (
          actualName.includes(expectedName)
          || expectedName.includes(actualName)
        ))
      );
    }
    if (field === 'onuSerial') {
      return Boolean(
        normalizeSerial(expected?.onuSerial)
        && normalizeSerial(expected.onuSerial) === normalizeSerial(actual.onuSerial)
      );
    }
    if (field === 'onuMac') {
      return Boolean(
        normalizeMac(expected?.onuMac)
        && normalizeMac(expected.onuMac) === normalizeMac(actual.onuMac)
      );
    }
    return false;
  });
  return Boolean(checks.length && checks.every(Boolean));
}

function evaluateGuideExpectation(caseData, context = {}, locatorApplied = []) {
  const guide = ensureGuideShape(caseData);
  const active = guide.active;
  if (!active?.stepId || !active.expected) return null;
  const expected = normalizeGuideExpectation(active.expected);
  if (!expected) return null;

  const evidenceBase = {
    pageKind: String(context.pageKind || ''),
    system: String(context.system || ''),
    entityId: String(context.entityId || ''),
    subview: String(context.subview || ''),
    expectation: expected.type
  };

  if (expected.type === 'page_kind') {
    const pageMatches = !expected.pageKind || context.pageKind === expected.pageKind;
    const systemMatches = !expected.system || context.system === expected.system;
    if (pageMatches && systemMatches) {
      return {
        status: 'confirmed',
        evidenceType: 'context',
        details: evidenceBase
      };
    }
    return null;
  }

  if (expected.type === 'tmc_checked') {
    // Passive UserSide parsing is evidence, not operator progress. A TMC Guide
    // step is confirmable only after the Workbench teleport/focus path records
    // tmcShownAt. This prevents cached TMC_RESULT/sourceStatus from completing
    // the step before the operator has actually been taken to the native block.
    const shownAt = String(caseData?.workflow?.ponAcquisition?.tmcShownAt || '');
    if (shownAt) {
      const tmc = context.meta?.tmc || caseData?.locator?.sourceStatus?.tmc || null;
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          result: String(tmc?.result || ''),
          found: Boolean(tmc?.found || tmc?.result === 'found'),
          oltName: compact(tmc?.oltName || tmc?.details?.oltName || '', 220),
          oltIp: compact(tmc?.oltIp || tmc?.details?.oltIp || '', 80),
          candidateCount: Number(tmc?.candidateCount || tmc?.details?.candidateCount || 0),
          shownAt,
          resolution: 'workbench-teleport-shown'
        }
      };
    }
    return null;
  }

  if (expected.type === 'mac_search') {
    const macSearch = context.meta?.macSearch || null;
    if (
      context.pageKind === 'userside_customer_list'
      && macSearch
      && (!expected.searchMode || macSearch.searchMode === expected.searchMode)
      && ['candidate_found', 'not_found'].includes(macSearch.result)
    ) {
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          searchMode: macSearch.searchMode,
          result: macSearch.result,
          searchedMac: compact(macSearch.searchedMac || '', 120),
          candidateCount: Number(macSearch.candidateCount || 0)
        }
      };
    }
    return null;
  }

  if (expected.type === 'interface_checked') {
    const confirmation = context.meta?.interfaceConfirmation || null;
    if (
      context.pageKind === 'interface_mac_list'
      && confirmation
      && ['confirmed', 'not_found'].includes(confirmation.result)
    ) {
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          result: confirmation.result,
          deviceId: String(confirmation.deviceId || ''),
          ifIndex: String(confirmation.ifIndex || ''),
          matchedBy: confirmation.matchedBy || []
        }
      };
    }
    return null;
  }

  if (expected.type === 'device_checked') {
    const details = context.meta?.deviceDetails || null;
    if (context.pageKind === 'userside_device' && details) {
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          deviceId: String(details.deviceId || ''),
          oltName: compact(details.oltName || '', 220),
          oltIp: compact(details.oltIp || '', 80),
          technology: compact(details.technology || '', 80),
          pollAction: compact(details.pollAction || '', 20)
        }
      };
    }
    return null;
  }

  if (expected.type === 'technical_fields_match') {
    if (
      context.pageKind === 'billing_technical'
      && matchesExpectedTechnical(
        caseData,
        expected.fields,
        expected.expectedTechnical || {}
      )
    ) {
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          fields: expected.fields.slice()
        }
      };
    }
    return null;
  }

  if (expected.type === 'billing_save_verified') {
    const saved = locatorApplied.find(item => item?.observation?.type === LocatorObservationType.BILLING_OLT_SAVED);
    const failed = locatorApplied.find(item => item?.observation?.type === LocatorObservationType.BILLING_OLT_SAVE_FAILED);
    if (saved) {
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          fields: expected.fields.slice(),
          observation: saved.observation.type,
          summary: compact(saved.observation.summary || '', 300)
        }
      };
    }
    if (failed) {
      return {
        status: 'failed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          fields: expected.fields.slice(),
          observation: failed.observation.type,
          summary: compact(failed.observation.summary || '', 300)
        }
      };
    }
    return null;
  }

  if (expected.type === 'poll_terminal') {
    const poll = context.meta?.poll || null;
    const outcomes = expected.outcomes.length
      ? expected.outcomes
      : ['confirmed', 'not_found', 'parser_error', 'olt_unreachable', 'timeout', 'conflict', 'partial'];
    const stableOutcome = poll?.outcome !== 'partial' || pollPartialStable(caseData?.locator);
    if (
      context.pageKind === 'billing_onu_poll'
      && poll
      && !poll.pending
      && stableOutcome
      && outcomes.includes(poll.outcome)
    ) {
      return {
        status: 'confirmed',
        evidenceType: 'evidence',
        details: {
          ...evidenceBase,
          outcome: poll.outcome,
          matchedBy: poll.matchedBy || [],
          interface: compact(poll.interface || '', 120)
        }
      };
    }
    return null;
  }

  return null;
}

function guideNextSnapshot(caseData) {
  const rec = caseData?.locator?.recommendation || null;
  if (!rec?.action) return null;
  return {
    action: String(rec.action || ''),
    ruleId: String(rec.ruleId || ''),
    reason: compact(rec.reason || '', 260),
    phase: String(rec.params?.phase || '')
  };
}

function reconcileGuideProgress(caseData, context = {}, locatorApplied = []) {
  const guide = ensureGuideShape(caseData);
  const active = guide.active;
  if (!active?.stepId) return null;

  const verdict = evaluateGuideExpectation(caseData, context, locatorApplied);
  if (!verdict) return null;

  const step = guideStepRecord(caseData, active.stepId);
  const at = nowIso();

  if (!step.actionConfirmedAt && active.expected?.actionMode === 'context') {
    step.actionConfirmedAt = at;
    step.action = {
      method: verdict.details?.resolution === 'already_satisfied'
        ? 'cached-evidence'
        : 'context-arrival',
      inferred: true,
      resolution: verdict.details?.resolution || 'live',
      pageKind: String(context.pageKind || ''),
      system: String(context.system || '')
    };
  }

  if (verdict.evidenceType) {
    addJournal(
      caseData,
      verdict.evidenceType === 'context' ? 'guide_context' : 'guide_evidence',
      `${verdict.evidenceType === 'context' ? 'CONTEXT' : 'EVIDENCE'} · ${active.stepId}`,
      verdict.details
    );
  }

  if (verdict.status === 'failed') {
    if (!step.failedAt || step.status !== 'result_failed') {
      step.status = 'result_failed';
      step.failedAt = at;
      step.result = verdict.details;
      addJournal(
        caseData,
        'guide_result',
        `RESULT FAILED · ${active.stepId}`,
        verdict.details
      );
    }
    return { stepId: active.stepId, status: 'failed', verdict };
  }

  if (step.status !== 'completed') {
    step.status = 'completed';
    step.resultConfirmedAt = at;
    step.result = verdict.details;
    guide.completed[active.stepId] = {
      at,
      details: verdict.details
    };
    addJournal(
      caseData,
      'guide_result',
      `STEP DONE · ${active.stepId}`,
      verdict.details
    );

    const next = guideNextSnapshot(caseData);
    if (next && next.action) {
      addJournal(
        caseData,
        'guide_next',
        `NEXT · ${next.action}`,
        next
      );
    }
  }

  if (guide.active?.stepId === active.stepId) guide.active = null;
  return { stepId: active.stepId, status: 'completed', verdict };
}

function ensureCaseShape(caseData, caseId) {
  const result = caseData || {};
  result.id ||= caseId;
  result.schemaVersion = 5;
  result.createdAt ||= nowIso();
  // Deterministic migration matters: STORE_GET_STATE and the next queued write
  // may read the same legacy case separately before it has been persisted.
  result.episodeId ||= stableEpisodeId(result.id, result.createdAt);
  result.caseVersion = Math.max(0, Number(result.caseVersion || 0));
  result.routeGeneration = Math.max(0, Number(result.routeGeneration || 0));
  result.updatedAt ||= nowIso();
  result.identity ||= {};
  result.network ||= {};
  // Canonical MAC model: «MAC устройства» is the subscriber/device MAC.
  // Older cases may still contain routerMac; migrate it once and remove the duplicate field.
  if (!result.network.mac && result.network.routerMac) result.network.mac = result.network.routerMac;
  if ('routerMac' in result.network) delete result.network.routerMac;
  result.pon ||= {};
  result.profile ||= {};
  result.live ||= {};
  result.live.oltSnapshot = result.live.oltSnapshot && typeof result.live.oltSnapshot === 'object'
    ? result.live.oltSnapshot
    : null;
  result.contexts ||= {};
  result.viewsByTab ||= {};
  result.currentContext ||= {};
  result.conflicts = compactExistingConflicts(result.conflicts || []);
  result.meta ||= {
    observations: 0,
    scans: 0
  };
  result.meta.observations ||= 0;
  result.meta.scans ||= 0;
  if (Number(result.meta.journalFormat || 0) < 2) {
    // Rewrite legacy verbose signatures and oversized operator DOM once. The
    // semantic event remains, while old duplicated payloads stop taxing every
    // subsequent full-state storage commit.
    result.journal = trimCaseJournal(result.journal || []);
    result.meta.journalFormat = 2;
  } else {
    result.journal = Array.isArray(result.journal) ? result.journal : [];
  }
  result.meta.processedEventIds = Array.isArray(result.meta.processedEventIds)
    ? result.meta.processedEventIds.slice(-MAX_PROCESSED_EVENT_IDS)
    : [];
  result.route ||= {};
  ensureGuideShape(result);
  ensureWorkflowShape(result);
  ensureOperatorTraceShape(result);

  // UserSide's «Точка подключения» can be the LAN side of a PON ONU. Older
  // builds stored that device/port under network.access* even when Billing had
  // already confirmed PON. Move such facts to an explicit ONU/LAN namespace so
  // they cannot be mistaken for an Ethernet access switch.
  if (String(rawFactValue(result.network.connectionFamily) || '').toUpperCase() === 'PON') {
    const moves = [
      ['accessDeviceId', 'onuDeviceId'],
      ['accessDeviceName', 'onuDeviceName'],
      ['accessDeviceIp', 'onuDeviceIp'],
      ['accessPort', 'onuLanPort'],
      ['accessInterface', 'onuLanInterface'],
      ['accessLinkState', 'onuLanLinkState'],
      ['accessSpeedMbps', 'onuLanSpeedMbps']
    ];
    for (const [networkKey, ponKey] of moves) {
      if (!result.pon[ponKey] && result.network[networkKey]) result.pon[ponKey] = result.network[networkKey];
      if (networkKey in result.network) delete result.network[networkKey];
    }
  }
  result.route.handoffs ||= [];
  result.route.checkpoints ||= [];
  result.route.resume ||= null;
  ensureLocatorShape(result);
  result.operations ||= {};
  result.operations.poll ||= {
    current: null,
    history: []
  };
  const normalizeStoredPollAttempt = attempt => {
    if (!attempt || typeof attempt !== 'object') return attempt || null;
    const stage = String(attempt.stage || '').toUpperCase();
    if (stage === PollAttemptStage.CONFIRMED) return { ...attempt, pending: false, status: 'resolved', outcome: 'confirmed' };
    if (stage === PollAttemptStage.TIMEOUT) return { ...attempt, pending: false, status: 'timeout', outcome: attempt.outcome || 'timeout' };
    if (stage === PollAttemptStage.FAILED) return { ...attempt, pending: false, status: 'failed' };
    return attempt;
  };
  result.operations.poll.current = normalizeStoredPollAttempt(result.operations.poll.current);
  result.operations.poll.history = Array.isArray(result.operations.poll.history)
    ? result.operations.poll.history.slice(-24).map(normalizeStoredPollAttempt)
    : [];
  result.juniper ||= {};
  result.juniper.dataStatus ||= 'missing';
  result.juniper.reviewStatus ||= 'required';
  result.juniper.requestId ||= '';
  result.juniper.readAt ||= '';
  result.juniper.lastReadAt ||= '';
  result.juniper.autoReadAt ||= '';
  result.juniper.openedAt ||= '';
  result.juniper.verifiedAt ||= '';
  result.juniper.readSource ||= '';
  result.juniper.operatorOpened = Boolean(result.juniper.operatorOpened);
  result.juniper.verified = Boolean(result.juniper.verified);
  ensureJuniperEvidenceShape(result);
  result.appeal = normalizeAppealState(result.appeal);
  result.telephony ||= {};
  result.telephony.schema ||= 'simnet-case-call-bindings-v1';
  result.telephony.callBindings = Array.isArray(result.telephony.callBindings)
    ? result.telephony.callBindings
      .filter(binding => binding && typeof binding === 'object' && /^pbx:\d{9,12}\.\d{1,12}$/.test(String(binding.callKey || '')))
      .slice(-MAX_CASE_CALL_BINDINGS)
    : [];
  result.diagnostic ||= {
    stage: 'empty',
    completion: 0,
    family: '',
    subtype: '',
    readyForOnuPoll: false,
    nextRequiredSource: 'billing-technical'
  };
  return result;
}

function migrateV4(previous) {
  const state = emptyState(previous?.ui || null);
  state.activeCaseId = previous?.activeCaseId || '';
  state.tabs = previous?.tabs || {};
  state.meta = {
    ...(previous?.meta || {}),
    migratedFrom: 4,
    migratedAt: nowIso(),
    updatedAt: nowIso()
  };

  for (const [caseId, caseData] of Object.entries(
    previous?.cases || {}
  )) {
    state.cases[caseId] = ensureCaseShape(
      clone(caseData),
      caseId
    );
  }

  return state;
}

async function loadStateFromStorage() {
  const result = await chrome.storage.local.get([
    STATE_KEY,
    PREVIOUS_STATE_KEY
  ]);

  const current = result[STATE_KEY];
  if (current?.schemaVersion === 5) {
    current.version = VERSION;
    current.cases ||= {};
    current.tabs ||= {};
    current.handoffs ||= {};
    current.telephony ||= {
      schema: 'simnet-pbx-call-context-v1',
      calls: {},
      bindings: {},
      updatedAt: ''
    };
    current.telephony.calls ||= {};
    current.telephony.bindings ||= {};
    current.experience ||= { learnedTargets: {}, updatedAt: '' };
    current.experience.learnedTargets ||= {};
    current.ui = { ...emptyUi(), ...(current.ui || {}) };
    current.meta ||= {};

    for (const [caseId, caseData] of Object.entries(current.cases)) {
      current.cases[caseId] = ensureCaseShape(caseData, caseId);
      promoteCompletedGuideToExperience(current, current.cases[caseId]);
    }

    purgeHandoffs(current);
    return current;
  }

  const previous = result[PREVIOUS_STATE_KEY];
  if (previous?.schemaVersion === 4) return migrateV4(previous);
  return emptyState();
}

async function ensureMainStateCache() {
  if (!chrome?.runtime?.id) return loadStateFromStorage();
  if (mainStateCache) return mainStateCache;
  if (!mainStateLoadPromise) {
    mainStateLoadPromise = loadStateFromStorage()
      .then(state => {
        mainStateCache = clone(state);
        return mainStateCache;
      })
      .finally(() => { mainStateLoadPromise = null; });
  }
  return mainStateLoadPromise;
}

async function readStateReference() {
  // Read-only/fast-lane background paths may use the service-worker snapshot
  // directly. This avoids cloning a multi-Case state graph before a click can
  // focus an already-open tab or persist a tiny ActionSession transition.
  return ensureMainStateCache();
}

async function readState() {
  // Unit/integration harnesses intentionally replace the mocked storage object
  // directly between calls. Real MV3 service workers always have runtime.id;
  // keep harness reads fresh while production uses the single-writer cache.
  if (!chrome?.runtime?.id) return loadStateFromStorage();

  // Mutating/queued callers still receive an isolated clone.
  const loaded = await ensureMainStateCache();
  return clone(loaded);
}

async function writeState(state) {
  state.meta ||= {};
  state.meta.updatedAt = nowIso();
  const startedAt = nowMs();
  await chrome.storage.local.set({ [STATE_KEY]: state });
  if (chrome?.runtime?.id) mainStateCache = clone(state);

  const elapsedMs = nowMs() - startedAt;
  if (elapsedMs >= 1200) {
    void enqueueDiagnostic({
      severity: 'WARNING',
      code: 'STATE_WRITE_SLOW',
      operationType: 'STATE_WRITE',
      source: 'service-worker-state',
      stage: 'STORAGE_SET',
      message: `Основной State записывался ${elapsedMs} мс`,
      details: { elapsedMs, caseCount: Object.keys(state.cases || {}).length }
    }).catch(() => {});
  }
  return state;
}

function caseForDiff(caseData) {
  const copy = clone(caseData || {});
  delete copy.caseVersion;
  delete copy.routeGeneration;
  return copy;
}

function finalizeCaseCommits(state, previousState) {
  const previousCases = previousState?.cases || {};
  for (const [caseId, rawCase] of Object.entries(state.cases || {})) {
    const caseData = ensureCaseShape(rawCase, caseId);
    const previous = previousCases[caseId]
      ? ensureCaseShape(previousCases[caseId], caseId)
      : null;
    const changed = !previous
      || JSON.stringify(caseForDiff(previous)) !== JSON.stringify(caseForDiff(caseData));
    if (!changed) continue;

    const violations = previous
      ? validateDiagnosticInvariants(previous, caseData)
      : [];
    if (violations.length) {
      const rejected = ensureCaseShape(clone(previous), caseId);
      addJournal(
        rejected,
        'invariant_guard',
        `GUARD/INVARIANT · ${violations.join(', ')}`,
        {
          verdict: CorrelationVerdict.REJECTED,
          reason: 'diagnostic-invariant-violation',
          violations
        }
      );
      rejected.caseVersion = Number(previous.caseVersion || 0) + 1;
      rejected.routeGeneration = Number(previous.routeGeneration || 0);
      rejected.updatedAt = nowIso();
      state.cases[caseId] = rejected;
      continue;
    }

    const previousRoute = previous ? routeStateSignature(previous) : '';
    const nextRoute = routeStateSignature(caseData);
    caseData.routeGeneration = Number(previous?.routeGeneration || 0)
      + (previousRoute !== nextRoute ? 1 : 0);
    caseData.caseVersion = Number(previous?.caseVersion || 0) + 1;
    state.cases[caseId] = caseData;
  }
}

function enqueue(mutator) {
  const operation = writeQueue.then(async () => {
    const state = await readState();
    const previousState = clone(state);
    const result = await mutator(state);
    // Read-only/deduplicated operations may explicitly prove that they made no
    // state mutation. Do not rewrite the entire persistent Workbench State in
    // that case merely to acknowledge a repeated click/hint.
    if (result?.__skipWrite === true) {
      return result.value;
    }
    // Case Processor is the only writer: every case mutation is finalized once,
    // versioned once and checked before the single durable state commit.
    finalizeCaseCommits(state, previousState);
    await writeState(state);
    return result === undefined
      ? state
      : result;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function cleanupClosedTabState(state, rawTabId, at = nowIso()) {
  const numericTabId = Number(rawTabId);
  if (!Number.isInteger(numericTabId) || numericTabId < 0) {
    return {
      changed: false,
      tabId: null,
      casesTouched: 0,
      viewDocumentsRemoved: 0,
      handoffsRemoved: 0,
      pendingOperationsStopped: 0
    };
  }

  const tabId = String(numericTabId);
  state.tabs ||= {};
  state.cases ||= {};
  state.handoffs ||= {};

  const closedTab = state.tabs[tabId] || null;
  let changed = false;
  let casesTouched = 0;
  let viewDocumentsRemoved = 0;
  let handoffsRemoved = 0;
  let pendingOperationsStopped = 0;

  if (closedTab) {
    delete state.tabs[tabId];
    changed = true;
  }

  for (const [caseId, rawCase] of Object.entries(state.cases)) {
    const caseData = ensureCaseShape(rawCase, caseId);
    const documents = caseData.viewsByTab?.[tabId] || null;
    const documentIds = new Set(Object.keys(documents || {}));
    if (closedTab?.caseId === caseId && closedTab.documentId) {
      documentIds.add(String(closedTab.documentId));
    }

    let caseChanged = false;
    if (documents) {
      viewDocumentsRemoved += Object.keys(documents).length;
      delete caseData.viewsByTab[tabId];
      caseChanged = true;
    }

    const currentPoll = caseData.operations?.poll?.current || null;
    const pollBelongsToClosedTab = Boolean(
      pollAttemptPending(currentPoll)
      && (
        (
          currentPoll.requestTabId != null
          && Number(currentPoll.requestTabId) === numericTabId
        )
        || (
          currentPoll.requestTabId == null
          && currentPoll.requestDocumentId
          && documentIds.has(String(currentPoll.requestDocumentId))
        )
      )
    );
    if (pollBelongsToClosedTab) {
      const stopped = {
        ...currentPoll,
        stage: PollAttemptStage.FAILED,
        status: 'failed',
        pending: false,
        outcome: 'failed',
        failureReason: 'source-tab-closed',
        resolvedAt: Date.now(),
        updatedAt: at
      };
      caseData.operations.poll.current = stopped;
      const history = caseData.operations.poll.history;
      const historyIndex = history.findIndex(
        item => String(item?.pollAttemptId || '') === String(stopped.pollAttemptId || '')
      );
      if (historyIndex >= 0) history[historyIndex] = clone(stopped);
      else history.push(clone(stopped));
      caseData.operations.poll.history = history.slice(-24);
      addJournal(caseData, 'poll_attempt', 'POLL FAILED · вкладка закрыта', {
        pollAttemptId: stopped.pollAttemptId,
        verdict: CorrelationVerdict.STALE,
        reason: stopped.failureReason
      });
      pendingOperationsStopped += 1;
      caseChanged = true;
    }

    if (
      caseData.juniper?.dataStatus === 'loading'
      && caseData.juniper.requestTabId != null
      && Number(caseData.juniper.requestTabId) === numericTabId
    ) {
      caseData.juniper.dataStatus = 'stale';
      caseData.juniper.failureReason = 'source-tab-closed';
      caseData.juniper.updatedAt = at;
      pendingOperationsStopped += 1;
      caseChanged = true;
    }

    if (caseChanged) {
      caseData.updatedAt = at;
      state.cases[caseId] = caseData;
      casesTouched += 1;
      changed = true;
    }
  }

  for (const [token, handoff] of Object.entries(state.handoffs)) {
    const sourceClosed = handoff?.sourceTabId != null
      && Number(handoff.sourceTabId) === numericTabId;
    const targetClosed = handoff?.targetTabId != null
      && Number(handoff.targetTabId) === numericTabId;
    if (!sourceClosed && !targetClosed) continue;

    if (targetClosed || (sourceClosed && handoff.status !== 'claimed')) {
      delete state.handoffs[token];
      handoffsRemoved += 1;
      changed = true;
      continue;
    }

    // A claimed destination may continue using the Case after its source tab
    // closes. Only the now-invalid focus-back pointer is removed.
    handoff.sourceTabId = null;
    handoff.sourceWindowId = null;
    handoff.sourceClosedAt = at;
    changed = true;
  }

  if (changed) {
    const activeCaseStillOpen = Object.values(state.tabs).some(
      tab => String(tab?.caseId || '') === String(state.activeCaseId || '')
    );
    if (!activeCaseStillOpen) {
      const replacement = Object.values(state.tabs)
        .filter(tab => tab?.caseId && state.cases[tab.caseId])
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      state.activeCaseId = String(replacement?.caseId || '');
    }

    state.meta ||= {};
    const lifecycle = state.meta.tabLifecycle || {};
    state.meta.tabLifecycle = {
      closedTabsCleaned: Number(lifecycle.closedTabsCleaned || 0) + 1,
      viewDocumentsRemoved: Number(lifecycle.viewDocumentsRemoved || 0) + viewDocumentsRemoved,
      handoffsRemoved: Number(lifecycle.handoffsRemoved || 0) + handoffsRemoved,
      pendingOperationsStopped: Number(lifecycle.pendingOperationsStopped || 0) + pendingOperationsStopped,
      lastClosedTabId: numericTabId,
      lastCleanupAt: at
    };
  }

  return {
    changed,
    tabId: numericTabId,
    casesTouched,
    viewDocumentsRemoved,
    handoffsRemoved,
    pendingOperationsStopped
  };
}

function cleanupClosedTab(tabId) {
  const operation = writeQueue.then(async () => {
    const state = await readState();
    const previousState = clone(state);
    const result = cleanupClosedTabState(state, tabId);
    // tabs.onRemoved fires for every browser tab. A non-Workbench tab must not
    // cause another full-state write.
    if (!result.changed) return result;
    finalizeCaseCommits(state, previousState);
    await writeState(state);
    return result;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function reconcileOpenTabs() {
  if (typeof chrome.tabs?.query !== 'function') {
    return Promise.resolve({ changed: false, reason: 'tabs-query-unavailable' });
  }

  const operation = writeQueue.then(async () => {
    const openTabs = await chrome.tabs.query({});
    const openTabIds = new Set(
      (Array.isArray(openTabs) ? openTabs : [])
        .map(tab => Number(tab?.id))
        .filter(tabId => Number.isInteger(tabId) && tabId >= 0)
    );
    const state = await readState();
    const previousState = clone(state);
    const results = [];

    for (const storedTabId of Object.keys(state.tabs || {})) {
      const numericTabId = Number(storedTabId);
      if (!Number.isInteger(numericTabId) || openTabIds.has(numericTabId)) continue;
      const result = cleanupClosedTabState(state, numericTabId);
      if (result.changed) results.push(result);
    }

    if (!results.length) {
      return { changed: false, openTabs: openTabIds.size, cleanedTabs: 0 };
    }

    finalizeCaseCommits(state, previousState);
    await writeState(state);
    return {
      changed: true,
      openTabs: openTabIds.size,
      cleanedTabs: results.length,
      viewDocumentsRemoved: results.reduce(
        (total, item) => total + Number(item.viewDocumentsRemoved || 0),
        0
      )
    };
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function correlationDetails(envelope, verdict, reason = '') {
  return {
    caseId: String(envelope?.caseId || ''),
    episodeId: String(envelope?.episodeId || ''),
    caseVersion: Number(envelope?.caseVersion || 0),
    routeGeneration: Number(envelope?.routeGeneration || 0),
    documentId: String(envelope?.origin?.documentId || ''),
    requestId: String(envelope?.operation?.requestId || ''),
    pollAttemptId: String(envelope?.operation?.pollAttemptId || ''),
    verdict: String(verdict || CorrelationVerdict.REJECTED),
    reason: String(reason || '')
  };
}

function rememberProcessedEvent(caseData, envelope) {
  const eventId = String(envelope?.eventId || '');
  if (!eventId) return;
  caseData.meta ||= {};
  const ids = Array.isArray(caseData.meta.processedEventIds)
    ? caseData.meta.processedEventIds
    : [];
  if (!ids.includes(eventId)) ids.push(eventId);
  caseData.meta.processedEventIds = ids.slice(-MAX_PROCESSED_EVENT_IDS);
}

function addCorrelationJournal(caseData, envelope, result, message = 'CORRELATION') {
  if (!caseData) return;
  // An ordinary accepted context is already represented by currentContext,
  // observations and facts. Repeating its full passport in Journal on every
  // meaningful scan added ~28 KB in a short real session without diagnostic
  // value. Keep rejected/stale/foreign verdicts and all operation correlations.
  if (
    message === 'CORRELATION'
    && result?.verdict === CorrelationVerdict.ACCEPTED
    && envelope?.type === MessageType.STORE_APPLY_CONTEXT
    && !envelope?.operation?.pollAttemptId
  ) return;
  addJournal(
    caseData,
    'correlation',
    `${message} · ${String(result?.verdict || 'rejected').toUpperCase()}`,
    correlationDetails(envelope, result?.verdict, result?.reason)
  );
}

function envelopeFor(type, payload, sender, caseData = null, caseId = '') {
  return makeEventEnvelope(payload?.envelope || {}, {
    type,
    payload: payload?.observation || payload?.context || payload || null,
    sender,
    caseData,
    caseId
  });
}

function currentTabDocument(state, envelope) {
  const tabId = envelope?.origin?.tabId;
  if (tabId == null) return null;
  return state.tabs?.[String(tabId)] || null;
}

function contextForEnvelope(caseData, envelope) {
  const tabId = envelope?.origin?.tabId;
  const documentId = String(envelope?.origin?.documentId || '');
  if (tabId != null && documentId) {
    const byDocument = caseData?.viewsByTab?.[String(tabId)] || {};
    if (byDocument[documentId]) return byDocument[documentId];
  }
  return caseData?.currentContext || {};
}

function storeViewContext(caseData, envelope, context) {
  const tabId = envelope?.origin?.tabId;
  const documentId = String(envelope?.origin?.documentId || context?.meta?.documentId || 'unknown-document');
  if (tabId == null) return;
  caseData.viewsByTab ||= {};
  caseData.viewsByTab[String(tabId)] ||= {};
  caseData.viewsByTab[String(tabId)][documentId] = {
    ...context,
    documentId,
    pageInstanceId: String(envelope?.origin?.pageInstanceId || ''),
    pageInstanceStartedAt: Number(envelope?.origin?.pageInstanceStartedAt || 0)
  };
  const entries = Object.entries(caseData.viewsByTab[String(tabId)]);
  if (entries.length > 8) {
    entries
      .sort((a, b) => String(b[1]?.observedAt || '').localeCompare(String(a[1]?.observedAt || '')))
      .slice(8)
      .forEach(([key]) => delete caseData.viewsByTab[String(tabId)][key]);
  }
}

function latestViewContextForEnvelopeTab(caseData, envelope) {
  const tabId = envelope?.origin?.tabId;
  if (tabId == null) return null;
  const byDocument = caseData?.viewsByTab?.[String(tabId)] || {};
  const entries = Object.values(byDocument).filter(Boolean);
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const byObserved = String(b?.observedAt || '').localeCompare(String(a?.observedAt || ''));
    if (byObserved) return byObserved;
    return Number(b?.pageInstanceStartedAt || 0) - Number(a?.pageInstanceStartedAt || 0);
  });
  return entries[0] || null;
}

/**
 * Native Billing navigation is the durable operator-decision boundary for a
 * TMC prefill. The content-script Rail can disappear during the full document
 * navigation, so this transition must be committed in the Service Worker from
 * the previous view of the SAME tab.
 *
 * While the operator remains on billing_technical, Save stays pending. Once
 * that tab actually leaves billing_technical without a native Save intent, the
 * opportunity is closed for this Case: TMC remains completed evidence and the
 * locator may continue to ONU polling.
 */
function closeTmcWritebackAfterTechnicalExit(caseData, envelope, nextContext) {
  const previousContext = latestViewContextForEnvelopeTab(caseData, envelope);
  if (String(previousContext?.pageKind || '') !== 'billing_technical') return false;
  if (String(nextContext?.pageKind || '') === 'billing_technical') return false;

  const flow = ensureWorkflowShape(caseData);
  const appliedFields = Array.isArray(flow.tmcWritebackAppliedFields)
    ? flow.tmcWritebackAppliedFields
    : [];
  // The business decision is about the opportunity that was shown in native
  // Technical, not about whether every TMC comparison was conflict-free. If
  // Workbench actually inserted at least one value into a previously-empty
  // field and the operator then leaves Technical without Save, that opportunity
  // is finished for this Case. Do not reopen TMC/Technical in a loop.
  if (
    !flow.tmcShownAt
    || appliedFields.length === 0
    || flow.tmcWritebackDeclinedAt
    || flow.tmcWritebackSavedAt
    || flow.technicalWritebackVerified
  ) return false;

  const intent = caseData?.locator?.sourceStatus?.billing_save_intent || {};
  const requestedAt = Date.parse(flow.tmcWritebackRequestedAt || '') || 0;
  const intentAt = Date.parse(intent.updatedAt || '') || 0;
  const nativeSaveIntentPending = String(intent.result || '') === 'intent'
    && (!requestedAt || !intentAt || intentAt >= requestedAt);
  if (nativeSaveIntentPending) return false;

  const at = nowIso();
  flow.tmcWritebackPending = false;
  flow.tmcWritebackPendingSave = false;
  flow.tmcWritebackVerifiedInForm = false;
  flow.technicalWritebackVerified = false;
  flow.technicalWritebackVerifiedAt = '';
  flow.tmcWritebackLastStatus = 'declined';
  flow.tmcWritebackLastAt = at;
  flow.tmcWritebackDeclinedAt = at;
  flow.tmcWritebackDeclineReason = 'left-technical-without-save';
  flow.updatedAt = at;

  addJournal(caseData, 'tmc_writeback', 'TMC WRITEBACK · пропущено сохранение', {
    decision: 'declined',
    reason: 'left-technical-without-save',
    appliedFields,
    fromPageKind: 'billing_technical',
    toPageKind: String(nextContext?.pageKind || '')
  });
  return true;
}

function advancePollAttemptFromContext(caseData, envelope, context) {
  const poll = context?.meta?.poll || null;
  if (!poll?.requestObserved) return { accepted: false, reason: 'not-a-poll-response' };
  const pollAttemptId = String(envelope?.operation?.pollAttemptId || '');
  const current = caseData?.operations?.poll?.current || null;
  if (!pollAttemptId || !current || current.pollAttemptId !== pollAttemptId) {
    return { accepted: false, reason: 'stale-poll-attempt' };
  }

  const outcome = String(poll.outcome || 'unknown');
  const currentStage = String(current.stage || '');
  const currentFailure = String(current.failureReason || '');
  let responseUrl = null;
  try {
    responseUrl = new URL(
      String(context?.url || envelope?.origin?.url || ''),
      'https://admin.simnet.kiev.ua'
    );
  } catch {}
  const responseAgeMs = Date.now() - Number(current.startedAt || 0);
  const exactLateResponse = Boolean(
    currentStage === PollAttemptStage.TIMEOUT
    && RECOVERABLE_POLL_TIMEOUT_REASONS.has(currentFailure)
    && outcome === 'confirmed'
    && poll.responseEvidence === true
    && poll.lateResponseRecovery === true
    && responseAgeMs >= 0
    && responseAgeMs <= POLL_LATE_RESPONSE_MAX_AGE_MS
    && /\/stat\.pl$/i.test(String(responseUrl?.pathname || ''))
    && responseUrl?.searchParams.get('act') === 'askolt'
    && (!current.action || responseUrl.searchParams.get('a') === String(current.action))
    && (!current.billingId || responseUrl.searchParams.get('id') === String(current.billingId))
    && (
      !current.oltIp
      || !responseUrl.searchParams.get('olt_ip')
      || responseUrl.searchParams.get('olt_ip') === String(current.oltIp)
    )
  );
  if (exactLateResponse) {
    const recovered = {
      ...current,
      stage: PollAttemptStage.CONFIRMED,
      status: 'resolved',
      pending: false,
      outcome: 'confirmed',
      failureReason: '',
      recoveredFromStage: currentStage,
      recoveredFromReason: currentFailure,
      lateResponseRecovery: true,
      responseDocumentId: String(envelope?.origin?.documentId || ''),
      updatedAt: nowIso(),
      completedAt: nowIso()
    };
    caseData.operations.poll.current = recovered;
    const historyIndex = caseData.operations.poll.history.findIndex(
      item => String(item?.pollAttemptId || '') === pollAttemptId
    );
    if (historyIndex >= 0) {
      caseData.operations.poll.history[historyIndex] = clone(recovered);
    } else {
      caseData.operations.poll.history.push(clone(recovered));
    }
    caseData.operations.poll.history = caseData.operations.poll.history.slice(-24);
    return {
      accepted: true,
      recovered: true,
      reason: 'late-poll-response-confirmed',
      attempt: recovered
    };
  }
  const stage = outcome === 'confirmed'
    ? PollAttemptStage.CONFIRMED
    : outcome === 'timeout'
      ? PollAttemptStage.TIMEOUT
      : ['not_found', 'olt_unreachable', 'parser_error', 'conflict'].includes(outcome)
        ? PollAttemptStage.FAILED
        : PollAttemptStage.PARSED;
  const transition = nextPollAttempt(current, {
    pollAttemptId,
    stage,
    outcome,
    responseDocumentId: String(envelope?.origin?.documentId || ''),
    updatedAt: nowIso(),
    completedAt: ['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(stage) ? nowIso() : ''
  });
  if (!transition.accepted) return transition;
  caseData.operations.poll.current = transition.attempt;
  if (!pollAttemptPending(transition.attempt)) {
    caseData.operations.poll.history.push(clone(transition.attempt));
    caseData.operations.poll.history = caseData.operations.poll.history.slice(-24);
  }
  return transition;
}

function durableSnapshotValue(value, depth = 0) {
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (typeof value === 'string') return compact(value, depth ? 180 : 300);
  if (depth >= 2) {
    if (Array.isArray(value)) return `[array:${value.length}]`;
    if (value && typeof value === 'object') return `{object:${Object.keys(value).length}}`;
    return compact(value, 180);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 16).map(item => durableSnapshotValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 12).map(([key, child]) => [
        compact(key, 60),
        durableSnapshotValue(child, depth + 1)
      ])
    );
  }
  return compact(value, depth ? 180 : 300);
}

function durableSnapshotFacts(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).slice(0, 36).map(([key, value]) => [
      compact(key, 80),
      durableSnapshotValue(value, 0)
    ])
  );
}

function durableSnapshotEvidence(raw = []) {
  return (Array.isArray(raw) ? raw : []).slice(0, 18).map(block => ({
    adapter: compact(block?.adapter || '', 40),
    family: compact(block?.family || '', 60),
    label: compact(block?.label || '', 120),
    state: compact(block?.state || 'neutral', 24),
    relation: compact(block?.relation || 'context', 24),
    visualPriority: compact(block?.visualPriority || '', 24),
    summary: compact(block?.summary || '', 420),
    diagnosticNote: compact(block?.diagnosticNote || '', 520),
    facts: durableSnapshotFacts(block?.facts || {})
  }));
}

function confirmedOltSnapshotFromContext(caseData, envelope = {}, context = {}, pollTransition = null) {
  const poll = context?.meta?.poll || null;
  const raw = poll?.snapshot || null;
  if (
    context?.pageKind !== 'billing_onu_poll'
    || !raw
    || raw.outcome !== 'confirmed'
    || poll?.outcome !== 'confirmed'
    || poll?.requestObserved !== true
    || poll?.responseEvidence !== true
    || poll?.wrongPollTab === true
  ) return null;

  const pollAttemptId = String(envelope?.operation?.pollAttemptId || '');
  const attempt = pollTransition?.attempt || caseData?.operations?.poll?.current || null;
  const currentAttemptId = String(attempt?.pollAttemptId || attempt?.attemptId || '');
  const attemptConfirmed = String(attempt?.stage || '').toUpperCase() === PollAttemptStage.CONFIRMED
    || String(attempt?.outcome || '') === 'confirmed';
  if (!pollAttemptId || pollAttemptId !== currentAttemptId || !attemptConfirmed) return null;

  const action = compact(raw.pollAction || poll.openedAction || '', 20);
  if (attempt?.action && action && String(attempt.action) !== action) return null;

  const learnedMacs = (Array.isArray(raw.learnedMacs) ? raw.learnedMacs : [])
    .map(item => compact(item, 32))
    .filter(Boolean)
    .slice(0, 16);
  const now = nowIso();
  return {
    schemaVersion: 1,
    status: 'confirmed',
    outcome: 'confirmed',
    pollAttemptId,
    pollAction: action,
    pollType: compact(raw.pollType || '', 40),
    adapter: compact(raw.adapter || '', 40),
    oltName: compact(raw.oltName || rawFactValue(caseData?.pon?.oltName) || '', 220),
    oltIp: compact(raw.oltIp || rawFactValue(caseData?.pon?.oltIp) || '', 80),
    onuStatus: compact(raw.onuStatus || rawFactValue(caseData?.pon?.status) || '', 80),
    onuMac: compact(raw.onuMac || rawFactValue(caseData?.pon?.onuMac) || '', 40),
    onuSerial: compact(raw.onuSerial || rawFactValue(caseData?.pon?.onuSerial) || '', 100),
    observedOnuMac: compact(raw.observedOnuMac || '', 40),
    observedOnuSerial: compact(raw.observedOnuSerial || '', 100),
    subscriberMac: compact(raw.subscriberMac || rawFactValue(caseData?.network?.mac) || '', 40),
    observedSubscriberMac: compact(raw.observedSubscriberMac || learnedMacs[0] || '', 40),
    learnedMacs,
    interface: compact(raw.interface || '', 120),
    rx: compact(raw.rx || '', 40),
    tx: compact(raw.tx || '', 40),
    distance: compact(raw.distance || '', 40),
    oltRx: compact(raw.oltRx || '', 40),
    linkState: compact(raw.linkState || '', 24),
    speedMbps: Number.isFinite(raw.speedMbps) ? Number(raw.speedMbps) : null,
    duplex: compact(raw.duplex || '', 24),
    vlan: Number.isFinite(raw.vlan) ? Number(raw.vlan) : null,
    identityAssessment: compact(raw.identityAssessment || 'unverified', 24),
    identityConflicts: (Array.isArray(raw.identityConflicts) ? raw.identityConflicts : [])
      .map(item => compact(item, 60)).filter(Boolean).slice(0, 12),
    matchedBy: (Array.isArray(raw.matchedBy) ? raw.matchedBy : [])
      .map(item => compact(item, 60)).filter(Boolean).slice(0, 12),
    responseSummary: compact(raw.responseSummary || '', 1200),
    historySummary: compact(raw.historySummary || '', 520),
    offlineSince: compact(raw.offlineSince || '', 80),
    offlineDuration: compact(raw.offlineDuration || '', 80),
    offlineDurationMs: Number.isFinite(raw.offlineDurationMs) ? Number(raw.offlineDurationMs) : null,
    evidence: durableSnapshotEvidence(raw.evidence || []),
    responseDocumentId: compact(envelope?.origin?.documentId || '', 180),
    sourceUrl: compact(context?.url || envelope?.origin?.url || '', 1000),
    bindingFingerprint: compact(envelope?.bindingFingerprint || attempt?.bindingFingerprint || '', 500),
    capturedAt: now,
    updatedAt: now
  };
}

function commitConfirmedOltSnapshot(caseData, envelope = {}, context = {}, pollTransition = null) {
  const incoming = confirmedOltSnapshotFromContext(caseData, envelope, context, pollTransition);
  if (!incoming) return { stored: false, reason: 'no-confirmed-correlated-snapshot', snapshot: null };

  caseData.live ||= {};
  const previous = caseData.live.oltSnapshot && typeof caseData.live.oltSnapshot === 'object'
    ? caseData.live.oltSnapshot
    : null;
  let next = incoming;
  if (previous?.pollAttemptId === incoming.pollAttemptId) {
    next = {
      ...previous,
      ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => (
        value !== ''
        && value != null
        && !(Array.isArray(value) && value.length === 0)
      ))),
      evidence: incoming.evidence.length >= Number(previous.evidence?.length || 0)
        ? incoming.evidence
        : previous.evidence,
      learnedMacs: incoming.learnedMacs.length >= Number(previous.learnedMacs?.length || 0)
        ? incoming.learnedMacs
        : previous.learnedMacs,
      capturedAt: previous.capturedAt || incoming.capturedAt,
      updatedAt: incoming.updatedAt
    };
  }

  const previousComparable = previous ? JSON.stringify({ ...previous, updatedAt: '' }) : '';
  const nextComparable = JSON.stringify({ ...next, updatedAt: '' });
  if (previousComparable === nextComparable) {
    return { stored: false, reason: 'snapshot-unchanged', snapshot: previous };
  }
  caseData.live.oltSnapshot = next;
  return { stored: true, reason: previous ? 'snapshot-updated' : 'snapshot-created', snapshot: next };
}

function chooseCaseId(context = {}) {
  const identity = context.identity || {};
  const login = rawFactValue(identity.login);
  const contract = rawFactValue(identity.contract);
  const customerId = rawFactValue(identity.customerId);
  const billingId = rawFactValue(identity.billingId);

  if (login) return `login:${login}`;
  if (contract) return `contract:${contract}`;
  if (customerId) return `customer:${customerId}`;

  if (billingId) {
    return `billing:${context.system || 'unknown'}:${billingId}`;
  }

  if (context.entityId) {
    return `entity:${context.system || 'unknown'}:${context.entityId}`;
  }

  return `page:${context.system || 'unknown'}:${context.pageKind || 'other'}`;
}

function contextHasSubscriberIdentity(context = {}) {
  const identity = context.identity || {};
  return ['login', 'contract', 'customerId', 'billingId']
    .some(field => Boolean(rawFactValue(identity[field])));
}

function entityMatchesCase(caseData, context = {}) {
  const entityId = comparable(context.entityId || '');
  if (!entityId || !caseData) return false;

  if (String(context.system || '').includes('billing')) {
    return entityId === comparable(
      rawFactValue(caseData.identity?.billingId)
    );
  }

  if (context.system === 'userside') {
    if (context.pageKind === 'userside_customer') {
      return entityId === comparable(
        rawFactValue(caseData.identity?.customerId)
      );
    }
    if ([
      'userside_device',
      'device_poller',
      'device_interface_list',
      'device_interface_errors',
      'interface_mac_list'
    ].includes(context.pageKind)) {
      const expectedDeviceIds = [
        rawFactValue(caseData.network?.accessDeviceId),
        rawFactValue(caseData.pon?.locatedDeviceId),
        rawFactValue(caseData.pon?.tmcOltDeviceId),
        ...(caseData.locator?.candidates || []).map(item => item?.deviceId || '')
      ].map(comparable).filter(Boolean);
      return expectedDeviceIds.includes(entityId);
    }
  }

  return false;
}

function shouldContinueTabCase(caseData, context = {}) {
  if (!caseData || contextHasSubscriberIdentity(context)) {
    return false;
  }

  if (context.entityId) {
    return entityMatchesCase(caseData, context);
  }

  return new Set([
    'billing_other',
    'billing_user_list',
    'userside_other',
    'userside_customer_list',
    'userside_task',
    'userside_task_form',
    'interface_mac_list',
    'userside_device',
    'device_poller',
    'device_interface_list',
    'device_interface_errors',
    'olt_onu_list',
    'olt_pon_port_onu_list'
  ]).has(context.pageKind);
}

function resolveCaseId(state, context = {}) {
  const incoming = context.identity || {};
  const fields = [
    'login',
    'contract',
    'customerId',
    'billingId'
  ];

  for (const [caseId, caseData] of Object.entries(
    state.cases || {}
  )) {
    if (entityMatchesCase(caseData, context)) {
      return caseId;
    }

    for (const field of fields) {
      const newValue = comparable(
        rawFactValue(incoming[field])
      );

      const oldValue = comparable(
        rawFactValue(caseData.identity?.[field])
      );

      if (
        newValue
        && oldValue
        && newValue === oldValue
      ) {
        return caseId;
      }
    }
  }

  return chooseCaseId(context);
}

function emptyCase(caseId) {
  return ensureCaseShape(
    {
      id: caseId,
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    caseId
  );
}

function workbenchOwnedJournalEvent(event = {}) {
  if (!/^operator_/.test(String(event.type || ''))) return false;
  const details = event.details || {};
  const ids = [
    details.target?.id,
    details.rawTarget?.id,
    details.dom?.cssPath,
    details.dom?.targetHtml
  ].filter(Boolean).join(' ');
  return /(?:simnet-workbench-(?:rail|guide|call-registration)|simnet-graph-studio|simnet-data-audit)/i.test(ids)
    || /data-simnet-wb-owned/i.test(ids);
}

function compactOperatorDetails(type, details) {
  if (!/^operator_/.test(String(type || '')) || !details || typeof details !== 'object') {
    return details || null;
  }
  const next = clone(details);
  if (next.dom && typeof next.dom === 'object') {
    next.dom.targetHtml = truncateText(next.dom.targetHtml, 800);
    next.dom.parentHtml = truncateText(next.dom.parentHtml, 1050);
    next.dom.grandparentHtml = truncateText(next.dom.grandparentHtml, 1300);
    for (const key of ['cssPath', 'parentPath', 'grandparentPath']) {
      next.dom[key] = compact(next.dom[key], 700);
    }
  }
  if (next.selectionDom) next.selectionDom = truncateText(next.selectionDom, 2000);
  if (next.rawTarget && next.target) {
    try {
      if (JSON.stringify(next.rawTarget) === JSON.stringify(next.target)) delete next.rawTarget;
    } catch {}
  }
  return next;
}

function trimCaseJournal(journal = []) {
  const result = [];
  const signatures = new Set();
  let totalBytes = 2;
  for (const raw of Array.isArray(journal) ? journal : []) {
    if (!raw || typeof raw !== 'object' || workbenchOwnedJournalEvent(raw)) continue;
    const details = compactOperatorDetails(raw.type, raw.details);
    const payload = `${raw.type || ''}|${raw.message || ''}|${JSON.stringify(details || null)}`;
    const signature = `j2_${stableHash(payload)}`;
    if (signatures.has(signature)) continue;
    const item = {
      ...raw,
      message: compact(raw.message || '', 300),
      details,
      signature
    };
    const itemBytes = JSON.stringify(item).length + 1;
    if (result.length && totalBytes + itemBytes > MAX_JOURNAL_BYTES) break;
    result.push(item);
    signatures.add(signature);
    totalBytes += itemBytes;
    if (result.length >= MAX_JOURNAL) break;
  }
  return result;
}

function addJournal(
  caseData,
  type,
  message,
  details = null
) {
  const safeDetails = compactOperatorDetails(type, details);
  const signature = `j2_${stableHash(
    `${type}|${message}|${JSON.stringify(safeDetails || null)}`
  )}`;

  if (
    caseData.journal.some(
      item => item.signature === signature
    )
  ) {
    return false;
  }

  caseData.journal.unshift({
    id: (
      `${Date.now().toString(36)}-`
      + Math.random().toString(36).slice(2, 8)
    ),
    at: nowIso(),
    type,
    message: compact(message, 300),
    details: safeDetails,
    signature
  });

  caseData.journal = trimCaseJournal(caseData.journal);

  return true;
}

function normalizeFact(raw, fallbackSource) {
  if (raw == null || raw === '') return null;

  if (
    typeof raw !== 'object'
    || Array.isArray(raw)
  ) {
    return {
      value: raw,
      source: fallbackSource,
      confidence: 0.65,
      observedAt: nowIso()
    };
  }

  if (
    raw.value == null
    || raw.value === ''
  ) {
    return null;
  }

  return {
    value: raw.value,
    source: raw.source || fallbackSource,
    confidence: Number.isFinite(
      Number(raw.confidence)
    )
      ? Number(raw.confidence)
      : 0.65,
    observedAt: raw.observedAt || nowIso()
  };
}

function isGenericValue(
  groupName,
  key,
  value
) {
  const text = comparable(value);

  if (
    groupName === 'network'
    && key === 'connectionFamily'
  ) {
    return ['pon', 'ethernet'].includes(text);
  }

  return false;
}

function mergeFacts(
  caseData,
  groupName,
  incoming,
  contextSource
) {
  if (
    !incoming
    || typeof incoming !== 'object'
  ) {
    return [];
  }

  const target = caseData[groupName] ||= {};
  const changes = [];

  for (const [key, rawFact] of Object.entries(incoming)) {
    const fact = normalizeFact(
      rawFact,
      contextSource
    );
    if (!fact) continue;

    const old = target[key];
    const oldValue = factValue(old);

    if (equivalentFactValue(groupName, key, oldValue, fact.value)) {
      if (
        !old
        || Number(old?.confidence || 0) < fact.confidence
      ) {
        target[key] = fact;
      }
      continue;
    }

    if (
      oldValue != null
      && oldValue !== ''
    ) {
      const oldConfidence = Number(
        old?.confidence || 0
      );

      const incomingIsGeneric = isGenericValue(
        groupName,
        key,
        fact.value
      );

      const oldIsGeneric = isGenericValue(
        groupName,
        key,
        oldValue
      );

      const accepted = (
        (!incomingIsGeneric || oldIsGeneric)
        && fact.confidence + 0.05 >= oldConfidence
      );

      const conflict = {
        at: nowIso(),
        field: `${groupName}.${key}`,
        oldValue,
        newValue: fact.value,
        oldSource: old?.source || '',
        newSource: fact.source,
        oldConfidence,
        newConfidence: fact.confidence,
        accepted,
        count: 1
      };
      const keyValue = conflictKey(conflict);
      const existingConflict = caseData.conflicts.find(item => conflictKey(item) === keyValue);
      if (existingConflict) {
        existingConflict.at = conflict.at;
        existingConflict.count = Number(existingConflict.count || 1) + 1;
        existingConflict.oldConfidence = oldConfidence;
        existingConflict.newConfidence = fact.confidence;
      } else {
        caseData.conflicts.unshift(conflict);
        caseData.conflicts = caseData.conflicts.slice(0, 40);
      }

      if (!accepted) continue;
    }

    target[key] = fact;

    changes.push({
      field: `${groupName}.${key}`,
      from: oldValue ?? null,
      to: fact.value,
      source: fact.source,
      confidence: fact.confidence
    });
  }

  return changes;
}

function contextWasVisited(
  caseData,
  pageKind
) {
  return Object.values(
    caseData.contexts || {}
  ).some(
    context => context.pageKind === pageKind
  );
}

function validOltIp(caseData) {
  const subscriberIp = comparable(
    rawFactValue(caseData.network?.ip)
  );

  const oltIp = comparable(
    rawFactValue(caseData.pon?.oltIp)
  );

  return Boolean(
    oltIp
    && oltIp !== subscriberIp
  );
}

function diagnosticSnapshot(caseData) {
  const family = rawFactValue(
    caseData.network?.connectionFamily
  );

  const subtype = rawFactValue(
    caseData.pon?.pollType
  );

  const pollAction = rawFactValue(
    caseData.pon?.pollAction
  );

  const hasIdentity = [
    'login',
    'contract',
    'billingId',
    'customerId'
  ].some(
    key => hasFact(caseData.identity, key)
  );

  const hasIp = hasFact(
    caseData.network,
    'ip'
  );

  const hasSubscriberMac = hasFact(caseData.network, 'mac');

  const hasBillingOnuMac = Boolean(
    normalizeMac(factValue(caseData.pon?.onuMac))
  );

  const hasBillingOnuSerial = Boolean(
    normalizeSerial(factValue(caseData.pon?.onuSerial))
  );

  const hasBillingOnu = (
    hasBillingOnuMac
    || hasBillingOnuSerial
  );

  const hasTmcOnu = (
    hasFact(caseData.pon, 'tmcOnuMac')
    || hasFact(caseData.pon, 'tmcOnuSerial')
  );

  const hasOnu = hasBillingOnu || hasTmcOnu;

  const hasBillingOltName = hasFact(
    caseData.pon,
    'oltName'
  );

  const hasTmcOlt = (
    hasFact(caseData.pon, 'tmcOltName')
    && hasFact(caseData.pon, 'tmcOltIp')
  );

  const hasValidOltIp = validOltIp(caseData);
  const hasOlt = (
    hasBillingOltName
    || hasTmcOlt
    || hasValidOltIp
  );

  const technicalVisited = contextWasVisited(
    caseData,
    'billing_technical'
  );

  const usersideVisited = contextWasVisited(
    caseData,
    'userside_customer'
  );

  const isPon = comparable(family) === 'pon';
  const isEthernet = comparable(family) === 'ethernet';

  evaluateLocatorPolicy(caseData, {
    technicalVisited,
    usersideVisited
  });
  const locator = locatorSnapshot(caseData);
  const juniper = locator.sourceStatus?.juniper
    || locator.sourceStatus?.juniperPreview
    || (caseData.juniper?.dataStatus === 'available' ? {
      result: caseData.juniper?.result || '',
      details: caseData.juniper?.details || {},
      observedAt: caseData.juniper?.lastReadAt || caseData.juniper?.updatedAt || ''
    } : null);
  const juniperChecked = Boolean(
    juniper
    && String(juniper?.result || caseData.juniper?.result || '').toLowerCase() !== 'error'
  );
  const juniperReviewed = Boolean(caseData.juniper?.operatorOpened);

  const currentBindingRejected = Boolean(
    locator.currentBindingRejected
  );

  const recommendation = locator.recommendation || {};
  const candidateNeedsBillingSave = Boolean(
    [
      LocatorAction.FILL_BILLING_OLT,
      LocatorAction.FILL_BILLING_TECHNICAL
    ].includes(recommendation.action)
    && recommendation.params?.phase === 'save'
  );
  const writebackFlow = caseData?.workflow?.ponAcquisition || {};
  // Hard gate: live form values are not durable Billing evidence. When Workbench
  // has just written TMC values into Technical data, ONU polling stays locked
  // until the native Save is clicked and a fresh Billing document confirms the
  // persisted values. This prevents the UI from treating DOM-prefill as saved data.
  const tmcAppliedFields = Array.isArray(writebackFlow.tmcWritebackAppliedFields)
    ? writebackFlow.tmcWritebackAppliedFields
    : [];
  const technicalSavePending = Boolean(
    writebackFlow.tmcWritebackPending
    || (writebackFlow.tmcWritebackPendingSave && tmcAppliedFields.length > 0)
    || candidateNeedsBillingSave
  );

  const requiredTechnical = requiredDiagnosticTechnicalFields(caseData);
  const billingMissingTechnical = [];
  if (requiredTechnical.includes('olt') && !hasBillingOltName) billingMissingTechnical.push('olt');
  if (requiredTechnical.includes('onuSerial') && !hasBillingOnuSerial) billingMissingTechnical.push('onuSerial');
  if (requiredTechnical.includes('onuMac') && !hasBillingOnuMac) billingMissingTechnical.push('onuMac');

  const billingTechnicalComplete = Boolean(
    isPon
    && billingMissingTechnical.length === 0
    && hasBillingOltName
  );
  // Evidence precedence: when Billing already has a complete, non-rejected binding
  // and a known pollAction, do not keep the Case on fill_billing_technical merely
  // because an older locator recommendation still points at a save/fill phase.
  // (Regression: abon457445 — complete GPON binding stuck on fill_billing_technical.)
  const evidenceReadyForPoll = Boolean(
    isPon
    && billingTechnicalComplete
    && hasBillingOnuMac
    && pollAction
    && !currentBindingRejected
    && !technicalSavePending
    && locator.termination?.status !== LocatorTermination.CONFIRMED
  );
  // Prefer hard evidence over a stale fill/save recommendation.
  const canAttemptOnuPoll = evidenceReadyForPoll
    || Boolean(
      isPon
      && hasBillingOnuMac
      && pollAction
      && !currentBindingRejected
      && !technicalSavePending
      && locator.termination?.status !== LocatorTermination.CONFIRMED
    );
  const readyForOnuPoll = canAttemptOnuPoll;

  const hasLiveResult = (
    locator.termination?.status === LocatorTermination.CONFIRMED
  );
  const pollResponded = Boolean(
    hasLiveResult
    && (
      caseData.live?.oltSnapshot?.status === 'confirmed'
      || caseData.live?.oltSnapshot?.outcome === 'confirmed'
      || locator.termination?.pollResponded === true
      || locator.termination?.pollCompleted === true
    )
  );
  const crossSourceIdentityMatch = Boolean(
    (caseData.locator?.evidence || []).some(item => (
      item?.type === LocatorObservationType.TMC_RESULT
      && item?.result === 'found'
      && item?.details?.identityCheck?.isMatch === true
    ))
  );
  const bindingVerified = Boolean(
    locator.bestCandidate?.matchedCurrentSubscriber
    || locator.termination?.identityAssessment === 'matched'
    || crossSourceIdentityMatch
  );
  const liveOnuState = compact(
    caseData.live?.oltSnapshot?.onuStatus
    || rawFactValue(caseData.pon?.status)
    || '',
    40
  ).toLowerCase();
  const serviceHealthy = Boolean(
    pollResponded
    && ['online', 'up', 'active', 'ok'].includes(liveOnuState)
  );

  const terminal = Boolean(locator.termination);

  let completion = 0;
  if (hasIdentity) completion += 15;
  if (juniperChecked) completion += 6;
  if (technicalVisited) completion += 15;
  if (hasIp) completion += 8;
  if (family) completion += 8;
  if (hasSubscriberMac) completion += 8;
  if (usersideVisited) completion += 8;
  if (isEthernet && hasFact(caseData.network, 'accessDeviceId')) completion += 6;
  if (isEthernet && locator.sourceStatus?.ethernet_device?.result === 'confirmed') completion += 6;
  if (isEthernet && locator.sourceStatus?.ethernet_fdb) completion += 6;
  if (isEthernet && locator.sourceStatus?.ethernet_errors) completion += 5;
  if (hasOnu) completion += 8;
  if (hasBillingOltName || hasTmcOlt) completion += 8;
  completion += Math.min(14, Number(locator.attemptCount || 0) * 2);
  if (locator.bestCandidate) completion += 8;
  if (terminal) completion = 100;
  else completion = Math.min(99, completion);
  completion = Math.min(100, completion);

  let stage = 'identity';
  const terminationStatus = locator.termination?.status || '';

  if (!hasIdentity) {
    stage = 'empty';
  } else if (terminationStatus === LocatorTermination.CONFIRMED) {
    stage = 'confirmed';
  } else if (terminationStatus === LocatorTermination.NOT_FOUND) {
    stage = 'not-found';
  } else if (terminationStatus === LocatorTermination.INCONCLUSIVE) {
    stage = 'inconclusive';
  } else if (terminationStatus === LocatorTermination.BLOCKED) {
    stage = 'blocked';
  } else if (terminationStatus === LocatorTermination.MANUAL_REVIEW) {
    stage = 'manual-review';
  } else if (recommendation.action === LocatorAction.CHECK_JUNIPER) {
    stage = 'juniper-session';
  } else if (recommendation.action === LocatorAction.WAIT_POLL) {
    stage = 'polling';
  } else if (recommendation.action === LocatorAction.SWITCH_PORT) {
    stage = 'ethernet-route';
  } else if (recommendation.action === LocatorAction.CHECK_ETHERNET_FDB) {
    stage = 'ethernet-fdb';
  } else if (recommendation.action === LocatorAction.CHECK_ETHERNET_ERRORS) {
    stage = 'ethernet-errors';
  } else if (recommendation.action === LocatorAction.ETHERNET_SUMMARY) {
    stage = 'ethernet-complete';
  } else if (
    [
      LocatorAction.CHECK_TMC,
      LocatorAction.SEARCH_MAC,
      LocatorAction.SEARCH_UPLINK_DOWNLINK,
      LocatorAction.INSPECT_INTERFACE,
      LocatorAction.INSPECT_DEVICE,
      LocatorAction.INSPECT_ONU_DETAILS
    ].includes(recommendation.action)
  ) {
    stage = 'locating-subscriber';
  } else if (
    recommendation.action === LocatorAction.POLL_CURRENT_BINDING
    || recommendation.action === LocatorAction.POLL_CANDIDATE
    || recommendation.action === LocatorAction.RETRY_POLL
    || readyForOnuPoll
  ) {
    // Evidence-complete binding wins over a stale fill_billing_technical recommendation.
    stage = 'ready-for-poll';
  } else if ([
    LocatorAction.FILL_BILLING_OLT,
    LocatorAction.FILL_BILLING_TECHNICAL
  ].includes(recommendation.action)) {
    stage = 'candidate-found';
  } else if (!technicalVisited) {
    stage = 'need-technical-data';
  } else {
    stage = 'searching';
  }

  // When evidence already qualifies for live poll, surface poll_current_binding
  // even if the locator rule table has not yet advanced past fill/save.
  const nextRequiredSource = (
    readyForOnuPoll
    && [
      LocatorAction.FILL_BILLING_OLT,
      LocatorAction.FILL_BILLING_TECHNICAL,
      LocatorAction.WAIT_CONTEXT,
      ''
    ].includes(recommendation.action || '')
  )
    ? LocatorAction.POLL_CURRENT_BINDING
    : (recommendation.action || 'wait_context');

  return {
    stage,
    completion,
    family,
    subtype,
    pollAction,
    isPon,
    isEthernet,
    hasIdentity,
    hasIp,
    hasSubscriberMac,
    hasBillingOnu,
    hasBillingOnuMac,
    hasBillingOnuSerial,
    billingMissingTechnical,
    hasTmcOnu,
    hasOnu,
    hasBillingOltName,
    hasTmcOlt,
    hasOlt,
    hasValidOltIp,
    hasLiveResult,
    pollResponded,
    bindingVerified,
    serviceHealthy,
    serviceState: liveOnuState || 'unknown',
    juniperChecked,
    juniperReviewed,
    juniperResult: juniper?.result || '',
    juniper: juniper || null,
    technicalVisited,
    usersideVisited,
    readyForOnuPoll,
    canAttemptOnuPoll,
    billingTechnicalComplete,
    currentBindingRejected,
    locatorState: locator.state,
    locatorAction: nextRequiredSource || recommendation.action || '',
    locatorRuleId: (
      readyForOnuPoll
      && [
        LocatorAction.FILL_BILLING_OLT,
        LocatorAction.FILL_BILLING_TECHNICAL,
        LocatorAction.WAIT_CONTEXT,
        ''
      ].includes(recommendation.action || '')
    )
      ? 'evidence.ready-for-poll'
      : (recommendation.ruleId || ''),
    locatorReason: (
      readyForOnuPoll
      && [
        LocatorAction.FILL_BILLING_OLT,
        LocatorAction.FILL_BILLING_TECHNICAL,
        LocatorAction.WAIT_CONTEXT,
        ''
      ].includes(recommendation.action || '')
    )
      ? 'Billing technical complete and identity confirmed; stale fill/save recommendation overridden by evidence.'
      : (recommendation.reason || ''),
    terminationStatus,
    termination: locator.termination,
    bestCandidate: locator.bestCandidate,
    attemptCount: locator.attemptCount,
    candidateCount: locator.candidateCount,
    nextRequiredSource,
    conflictCount: caseData.conflicts?.length || 0,
    updatedAt: nowIso()
  };
}

function shouldCountObservation({
  previousContextKey,
  nextContextKey,
  changes,
  previousStage,
  nextStage
}) {
  return Boolean(
    previousContextKey !== nextContextKey
    || changes.length > 0
    || previousStage !== nextStage
  );
}

function trimCases(state) {
  const entries = Object.entries(
    state.cases
  );

  if (entries.length <= MAX_CASES) return;

  entries.sort((a, b) =>
    String(b[1].updatedAt)
      .localeCompare(String(a[1].updatedAt))
  );

  state.cases = Object.fromEntries(
    entries.slice(0, MAX_CASES)
  );
}

function purgeHandoffs(state) {
  const current = nowMs();

  for (const [token, handoff] of Object.entries(
    state.handoffs || {}
  )) {
    const ttl = handoff.status === 'claimed'
      ? CLAIMED_HANDOFF_TTL_MS
      : HANDOFF_TTL_MS;

    const reference = Number(
      handoff.claimedAtMs
      || handoff.createdAtMs
      || 0
    );

    if (
      !reference
      || current - reference > ttl
    ) {
      delete state.handoffs[token];
    }
  }
}

function validHandoffToken(token) {
  return /^simnet_wb_[a-z0-9_-]{8,160}$/i.test(
    String(token || '')
  );
}

function safeTargetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:'
      && url.hostname === 'userside.simnet.kiev.ua'
      && (
        /\/script\/gotouser\.php$/i.test(url.pathname)
        || /\/customer\/\d+\/?$/i.test(url.pathname)
      )
    );
  } catch {
    return false;
  }
}

function handoffIdentityFacts(handoff) {
  return {
    login: makeFact(
      handoff.login,
      'handoff:billing-login',
      0.98
    ),
    contract: makeFact(
      handoff.contract,
      'handoff:billing-contract',
      0.98
    ),
    billingId: makeFact(
      handoff.billingId,
      'handoff:billing-id',
      0.99
    ),
    customerId: makeFact(
      handoff.customerId,
      'handoff:known-customer-id',
      0.96
    )
  };
}

function findHandoffForContext(
  state,
  context,
  sender,
  claim = null
) {
  purgeHandoffs(state);

  const token = String(
    claim?.token || ''
  );

  if (
    validHandoffToken(token)
    && state.handoffs[token]
  ) {
    const handoff = state.handoffs[token];

    if (
      claim?.caseId
      && claim.caseId !== handoff.caseId
    ) {
      return null;
    }

    return handoff;
  }

  if (claim?.caseId) {
    const matching = Object.values(
      state.handoffs
    ).find(handoff =>
      handoff.caseId === claim.caseId
      && (
        !handoff.targetTabId
        || handoff.targetTabId === sender.tab?.id
      )
    );

    if (matching) return matching;
  }

  if (context.system !== 'userside') {
    return null;
  }

  const subscriberIp = comparable(
    rawFactValue(context.network?.ip)
  );

  const candidates = Object.values(
    state.handoffs
  )
    .filter(handoff => (
      handoff.status === 'pending'
      || handoff.status === 'claimed'
    ))
    .filter(handoff => (
      !handoff.targetTabId
      || handoff.targetTabId === sender.tab?.id
    ))
    .filter(handoff => (
      !subscriberIp
      || comparable(handoff.subscriberIp) === subscriberIp
    ))
    .sort(
      (a, b) =>
        Number(b.createdAtMs || 0)
        - Number(a.createdAtMs || 0)
    );

  return candidates[0] || null;
}

function attachHandoffToContext(
  context,
  handoff
) {
  if (!handoff) return context;

  const handoffIdentity = handoffIdentityFacts(handoff);
  const incomingIdentity = context.identity || {};

  context.identity = {
    ...incomingIdentity,
    login: handoffIdentity.login || incomingIdentity.login,
    contract: handoffIdentity.contract || incomingIdentity.contract,
    billingId: handoffIdentity.billingId || incomingIdentity.billingId,
    customerId: incomingIdentity.customerId || handoffIdentity.customerId
  };

  context.network = {
    ...(context.network || {}),
    ip: (
      context.network?.ip
      || makeFact(
        handoff.subscriberIp,
        'handoff:subscriber-ip',
        0.96
      )
    )
  };

  context.meta ||= {};
  context.meta.handoff = {
    token: handoff.token,
    purpose: handoff.purpose,
    sourceTabId: handoff.sourceTabId,
    claimed: true
  };

  return context;
}

function updateRoute(
  caseData,
  context,
  handoff = null
) {
  caseData.route ||= {};
  ensureGuideShape(caseData);
  caseData.route.handoffs ||= [];

  if (
    context.pageKind === 'billing_technical'
  ) {
    caseData.route.billingTechnicalVisitedAt ||= nowIso();

    if (
      caseData.route.billingOltInitiallyMissing == null
    ) {
      caseData.route.billingOltInitiallyMissing = (
        !hasFact(caseData.pon, 'oltName')
      );
    }

    if (!Array.isArray(caseData.route.billingTechnicalInitiallyMissing)) {
      const required = requiredDiagnosticTechnicalFields(caseData);
      const missing = [];
      if (required.includes('olt') && !hasFact(caseData.pon, 'oltName')) missing.push('olt');
      if (required.includes('onuSerial') && !normalizeSerial(factValue(caseData.pon?.onuSerial))) missing.push('onuSerial');
      if (required.includes('onuMac') && !normalizeMac(factValue(caseData.pon?.onuMac))) missing.push('onuMac');
      caseData.route.billingTechnicalInitiallyMissing = missing;
    }

    try {
      const url = new URL(context.url);
      if (url.searchParams.get('updated') === '1') {
        caseData.route.billingOltSavedAt = nowIso();
      }
    } catch {}

    if (
      hasFact(caseData.pon, 'oltName')
      && caseData.route.billingOltInitiallyMissing
      && hasFact(caseData.pon, 'tmcOltName')
    ) {
      caseData.route.billingOltFilledAt ||= nowIso();
    }
  }

  if (
    context.pageKind === 'userside_customer'
  ) {
    caseData.route.usersideVisitedAt ||= nowIso();
    // Do not persist a route-level "TMC reached" timestamp from passive DOM
    // parsing. TMC_RESULT/sourceStatus remain diagnostic facts; operator progress
    // is recorded only by the Workbench userside.tmc teleport after visible Focus.
    delete caseData.route.tmcFoundAt;
  }

  if (
    context.pageKind === 'billing_onu_poll'
    && context.meta?.poll?.outcome === 'confirmed'
    && context.routeRelation === RouteRelation.ON_ROUTE
  ) {
    const confirmedAt = nowIso();
    caseData.route.onuPollConfirmedAt ||= confirmedAt;
    const flow = ensureWorkflowShape(caseData);
    flow.updatedAt = confirmedAt;
  }

  if (handoff) {
    const exists = caseData.route.handoffs.some(
      item => item.token === handoff.token
    );

    if (!exists) {
      caseData.route.handoffs.push({
        token: handoff.token,
        purpose: handoff.purpose,
        sourceTabId: handoff.sourceTabId,
        targetTabId: handoff.targetTabId,
        preparedAt: handoff.createdAt,
        claimedAt: handoff.claimedAt || nowIso()
      });

      caseData.route.handoffs = (
        caseData.route.handoffs.slice(-20)
      );
    }
  }
}

function updateRouteCheckpoint(caseData, context = {}) {
  const recommendation = caseData.locator?.recommendation || null;
  const action = String(recommendation?.action || '');
  if (!action) return;

  caseData.route ||= {};
  caseData.route.checkpoints ||= [];

  const candidate = recommendation?.params?.candidate || null;
  const checkpoint = {
    action,
    ruleId: String(recommendation?.ruleId || ''),
    reason: compact(recommendation?.reason || '', 260),
    phase: String(recommendation?.params?.phase || ''),
    candidateId: String(candidate?.id || ''),
    stage: String(caseData.diagnostic?.stage || ''),
    pageKind: String(context.pageKind || ''),
    system: String(context.system || ''),
    updatedAt: nowIso()
  };

  const signature = [
    checkpoint.action,
    checkpoint.ruleId,
    checkpoint.phase,
    checkpoint.candidateId,
    checkpoint.stage
  ].join('|');

  const previous = caseData.route.resume || null;
  const previousSignature = previous
    ? [
        previous.action,
        previous.ruleId,
        previous.phase,
        previous.candidateId,
        previous.stage
      ].join('|')
    : '';

  caseData.route.resume = checkpoint;

  if (signature !== previousSignature) {
    caseData.route.checkpoints.push(checkpoint);
    caseData.route.checkpoints = (
      caseData.route.checkpoints.slice(-30)
    );
  }
}

async function applyContext(payload, sender) {
  return enqueue(state => {
    let context = clone(payload?.context || {});

    const tabId = sender.tab?.id != null
      ? String(sender.tab.id)
      : `unknown-${Date.now()}`;

    const handoff = findHandoffForContext(
      state,
      context,
      sender,
      payload?.handoffClaim || null
    );

    if (handoff) {
      handoff.status = 'claimed';
      handoff.targetTabId = sender.tab?.id ?? null;
      handoff.targetWindowId = sender.tab?.windowId ?? null;
      handoff.claimedAt ||= nowIso();
      handoff.claimedAtMs ||= nowMs();
      context = attachHandoffToContext(
        context,
        handoff
      );
    }

    const previousTabCaseId = String(
      state.tabs?.[tabId]?.caseId || ''
    );
    const previousTabCase = previousTabCaseId
      ? state.cases?.[previousTabCaseId]
      : null;
    const continuationCaseId = shouldContinueTabCase(
      previousTabCase,
      context
    )
      ? previousTabCaseId
      : '';

    const caseId = (
      handoff?.caseId
      || continuationCaseId
      || resolveCaseId(state, context)
    );

    const caseData = ensureCaseShape(
      state.cases[caseId] || emptyCase(caseId),
      caseId
    );

    const incomingEnvelopeCaseId = String(payload?.envelope?.caseId || '');
    const startsNewSubscriberCase = Boolean(
      incomingEnvelopeCaseId
      && incomingEnvelopeCaseId !== caseId
      && contextHasSubscriberIdentity(context)
    );
    const eventPayload = startsNewSubscriberCase
      ? {
          ...payload,
          envelope: {
            ...(payload?.envelope || {}),
            caseId,
            episodeId: caseData.episodeId,
            caseVersion: caseData.caseVersion,
            routeGeneration: caseData.routeGeneration,
            identityFingerprint: '',
            bindingFingerprint: ''
          }
        }
      : payload;
    const envelope = envelopeFor(
      MessageType.STORE_APPLY_CONTEXT,
      eventPayload,
      sender,
      caseData,
      caseId
    );
    const currentDocument = currentTabDocument(state, envelope);
    const isCorrelatedProducer = Boolean(
      eventPayload?.envelope?.caseId
      && eventPayload?.envelope?.episodeId
    );
    const pollRequiresAttempt = Boolean(
      context?.pageKind === 'billing_onu_poll'
      && context?.meta?.poll?.requestObserved
    );
    const correlation = validateCorrelation(caseData, envelope, {
      requireCase: true,
      requireEpisode: true,
      requireIdentity: isCorrelatedProducer,
      requireCurrentRoute: isCorrelatedProducer,
      currentDocument,
      requireCurrentDocument: Boolean(currentDocument),
      currentPollAttemptId: String(caseData.operations?.poll?.current?.pollAttemptId || ''),
      requirePollAttempt: pollRequiresAttempt,
      currentBindingFingerprint: String(caseData.operations?.poll?.current?.bindingFingerprint || ''),
      requireBinding: pollRequiresAttempt,
      processedEventIds: caseData.meta?.processedEventIds || []
    });

    const previousContextKey = (
      caseData.currentContext?.key || ''
    );

    const previousStage = (
      caseData.diagnostic?.stage || 'empty'
    );

    const source = (
      `${context.system || 'unknown'}:`
      + `${context.pageKind || 'other'}`
    );

    const rejectedContext = {
      key: context.key || '',
      system: context.system || 'unknown',
      pageKind: context.pageKind || 'other',
      entityId: context.entityId || '',
      subview: context.subview || '',
      title: compact(context.title || '', 160),
      url: context.url || '',
      meta: context.meta || {},
      quality: context.quality || {},
      routeRelation: correlation.verdict === CorrelationVerdict.FOREIGN
        ? RouteRelation.FOREIGN
        : RouteRelation.SUPPORTING,
      correlation: correlationDetails(envelope, correlation.verdict, correlation.reason),
      observedAt: nowIso()
    };

    if (!correlation.canMutate) {
      // Old documents/episodes/attempts may still be useful in the evidence log,
      // but they cannot merge canonical facts or execute policy.
      if (correlation.reason !== 'stale-document') {
        storeViewContext(caseData, envelope, rejectedContext);
      }
      const passiveObservations = markOutOfRouteObservationsPassive(
        caseData,
        [...(context.meta?.locatorObservations || [])],
        rejectedContext,
        String(caseData?.locator?.recommendation?.action || '')
      ).map(observation => ({
        ...observation,
        passive: true,
        passiveReason: `correlation-${correlation.reason}`,
        correlation: correlationDetails(envelope, correlation.verdict, correlation.reason)
      }));
      const locatorApplied = applyLocatorObservations(caseData, passiveObservations, rejectedContext);
      addCorrelationJournal(caseData, envelope, correlation);
      caseData.updatedAt = nowIso();
      state.cases[caseId] = caseData;
      return {
        state,
        caseId,
        applied: false,
        passive: locatorApplied.length > 0,
        correlation: correlationDetails(envelope, correlation.verdict, correlation.reason)
      };
    }

    rememberProcessedEvent(caseData, envelope);

    // v1.7.20 Route Controller: decide whether this page belongs to the current
    // required step BEFORE page facts are merged. This is the commit gate that
    // prevents an incidental Huawei/GPON/GCOM/MAC page from rewriting the route.
    const routeActionBefore = String(caseData?.locator?.recommendation?.action || '');
    const contextRelation = classifyContextRelation(caseData, context, routeActionBefore);
    const gatedContext = gateContextForCommit(caseData, context, contextRelation);
    const commitContext = gatedContext.context;

    const changes = [
      ...mergeFacts(
        caseData,
        'identity',
        commitContext.identity,
        source
      ),
      ...mergeFacts(
        caseData,
        'network',
        commitContext.network,
        source
      ),
      ...mergeFacts(
        caseData,
        'pon',
        commitContext.pon,
        source
      ),
      ...mergeFacts(
        caseData,
        'profile',
        commitContext.profile,
        source
      )
    ];

    const nextContext = {
      key: context.key || '',
      system: context.system || 'unknown',
      pageKind: context.pageKind || 'other',
      entityId: context.entityId || '',
      subview: context.subview || '',
      title: compact(
        context.title || '',
        160
      ),
      url: context.url || '',
      meta: context.meta || {},
      quality: context.quality || {},
      routeRelation: contextRelation,
      correlation: correlationDetails(envelope, CorrelationVerdict.ACCEPTED, correlation.reason),
      observedAt: nowIso()
    };

    // Full Billing navigation destroys the old content script before its Rail
    // can reliably observe the destination. Close the one-shot Save decision
    // here, using the previous context of the same tab, before route evaluation.
    closeTmcWritebackAfterTechnicalExit(caseData, envelope, nextContext);

    caseData.currentContext = nextContext;
    storeViewContext(caseData, envelope, nextContext);

    if (context.key) {
      caseData.contexts[context.key] = nextContext;
    }

    const locatorObservations = markOutOfRouteObservationsPassive(
      caseData,
      [
        ...(context.meta?.locatorObservations || [])
      ],
      nextContext,
      routeActionBefore
    );
    for (const observation of locatorObservations) {
      observation.correlation = correlationDetails(
        envelope,
        CorrelationVerdict.ACCEPTED,
        correlation.reason
      );
      observation.details = {
        ...(observation.details || {}),
        ...(envelope.operation?.pollAttemptId
          ? { pollAttemptId: envelope.operation.pollAttemptId }
          : {})
      };
      if (observation.type === LocatorObservationType.JUNIPER_SESSION) {
        const juniperState = applyJuniperCaseEvidence(caseData, observation, envelope, { automatic: false });
        if (!juniperState.parsed && String(observation.result || '').toLowerCase() === 'error') {
          void enqueueDiagnostic({
            severity: 'WARNING',
            code: 'JUNIPER_PARSE_FAILED',
            operationType: 'JUNIPER_READ',
            source: 'service-worker',
            stage: 'MANUAL_PAGE',
            caseId: String(caseData.id || ''),
            subscriber: String(rawFactValue(caseData.identity?.login) || ''),
            message: 'Открытая страница Juniper не дала уверенно разобранного результата',
            details: { method: observation.method || '', pageKind: nextContext.pageKind || '' }
          }).catch(() => {});
        }
      }
    }

    const pendingSave = caseData.route?.pendingBillingOltSave || null;
    if (
      pendingSave
      && context.pageKind === 'billing_technical'
      && nextContext.meta?.documentId
      && nextContext.meta.documentId !== pendingSave.sourceDocumentId
    ) {
      const binding = currentBillingBinding(caseData);
      const requiredFields = Array.isArray(pendingSave.requiredFields)
        && pendingSave.requiredFields.length
        ? pendingSave.requiredFields
        : ['olt'];
      const expectedTechnical = {
        ...pendingSave,
        ...(pendingSave.expectedTechnical && typeof pendingSave.expectedTechnical === 'object'
          ? pendingSave.expectedTechnical
          : {})
      };
      const observedTechnical = {
        oltName: binding?.oltName || '',
        oltIp: binding?.oltIp || '',
        onuSerial: rawFactValue(caseData.pon?.onuSerial),
        onuMac: rawFactValue(caseData.pon?.onuMac)
      };
      const sameIp = Boolean(
        expectedTechnical.oltIp
        && binding?.oltIp
        && comparable(expectedTechnical.oltIp) === comparable(binding.oltIp)
      );
      const sameName = Boolean(
        expectedTechnical.oltName
        && binding?.oltName
        && (
          comparable(binding.oltName).includes(comparable(expectedTechnical.oltName))
          || comparable(expectedTechnical.oltName).includes(comparable(binding.oltName))
        )
      );
      const sameAction = Boolean(
        !pendingSave.pollAction
        || !binding?.pollAction
        || pendingSave.pollAction === binding.pollAction
      );
      const checks = requiredFields.map(field => {
        if (field === 'olt') return (sameIp || sameName) && sameAction;
        if (field === 'onuSerial') {
          return Boolean(
            normalizeSerial(expectedTechnical.onuSerial)
            && normalizeSerial(expectedTechnical.onuSerial) === normalizeSerial(observedTechnical.onuSerial)
          );
        }
        if (field === 'onuMac') {
          return Boolean(
            normalizeMac(expectedTechnical.onuMac)
            && normalizeMac(expectedTechnical.onuMac) === normalizeMac(observedTechnical.onuMac)
          );
        }
        return true;
      });
      const requiredSaved = checks.length > 0 && checks.every(Boolean);

      if (requiredSaved) {
        locatorObservations.push({
          type: LocatorObservationType.BILLING_OLT_SAVED,
          result: 'saved',
          method: 'post-navigation-verification',
          source: 'billing',
          details: {
            ...pendingSave,
            oltName: binding?.oltName || pendingSave.oltName,
            oltIp: binding?.oltIp || pendingSave.oltIp,
            pollAction: binding?.pollAction || pendingSave.pollAction,
            technology: binding?.technology || pendingSave.technology
          },
          summary: `После загрузки нового документа подтверждены поля: ${requiredFields.join(', ')}.`
        });
      } else {
        locatorObservations.push({
          type: LocatorObservationType.BILLING_OLT_SAVE_FAILED,
          result: 'failed',
          method: 'post-navigation-verification',
          source: 'billing',
          reason: 'saved_value_mismatch',
          details: {
            expected: pendingSave,
            observed: {
              binding: binding || null,
              technical: observedTechnical
            },
            requiredFields
          },
          summary: `После сохранения Billing не подтвердил поля: ${requiredFields.join(', ')}.`
        });
      }

      delete caseData.route.pendingBillingOltSave;
    }

    const locatorApplied = applyLocatorObservations(
      caseData,
      locatorObservations,
      nextContext
    );
    const pollTransition = advancePollAttemptFromContext(caseData, envelope, nextContext);
    const liveSnapshot = commitConfirmedOltSnapshot(caseData, envelope, nextContext, pollTransition);
    if (pollTransition.recovered) {
      addJournal(caseData, 'poll_attempt', 'POLL CONFIRMED · получен поздний ответ OLT', {
        pollAttemptId: pollTransition.attempt?.pollAttemptId || '',
        recoveredFrom: pollTransition.attempt?.recoveredFromReason || '',
        responseDocumentId: pollTransition.attempt?.responseDocumentId || ''
      });
    }
    if (liveSnapshot.stored) {
      addJournal(caseData, 'live_snapshot', 'LIVE · сохранён подтверждённый снимок OLT', {
        pollAttemptId: liveSnapshot.snapshot?.pollAttemptId || '',
        pollAction: liveSnapshot.snapshot?.pollAction || '',
        pollType: liveSnapshot.snapshot?.pollType || '',
        oltIp: liveSnapshot.snapshot?.oltIp || '',
        onuStatus: liveSnapshot.snapshot?.onuStatus || '',
        evidenceBlocks: Number(liveSnapshot.snapshot?.evidence?.length || 0)
      });
    }

    rememberRouteControllerDecision(
      caseData,
      nextContext,
      routeActionBefore,
      contextRelation,
      gatedContext.blockedFacts,
      locatorObservations
    );

    updateRoute(
      caseData,
      nextContext,
      handoff
    );

    caseData.diagnostic = diagnosticSnapshot(
      caseData
    );
    syncPonWritebackWorkflow(caseData);
    updateRouteCheckpoint(caseData, nextContext);
    // Let the poll-terminal evidence close the active Guide step first. Only after
    // reconciliation do we latch the Guide episode closed.
    const guideProgress = reconcileGuideProgress(
      caseData,
      nextContext,
      locatorApplied
    );
    if (context.pageKind === 'billing_juniper') {
      const firstOpen = markJuniperOpened(caseData, nextContext);
      if (firstOpen) {
        addJournal(caseData, 'juniper_opened', 'JUNIPER · оператор открыл штатный раздел', {
          source: 'operator',
          pageKind: 'billing_juniper',
          result: caseData.juniper?.result || ''
        });
      }
    }
    if (caseData.route?.guide?.completed?.['billing.inspect-juniper']) {
      caseData.juniper.reviewStatus = 'reviewed';
      caseData.juniper.operatorOpened = true;
      caseData.juniper.openedAt ||= nowIso();
      ensureJuniperEvidenceShape(caseData).opened ||= {
        kind: 'JUNIPER_OPENED',
        at: caseData.juniper.openedAt,
        source: 'operator',
        pageKind: 'billing_juniper',
        documentId: ''
      };
    }
    if (caseData.locator?.termination?.status === LocatorTermination.CONFIRMED) {
      ensureGuideShape(caseData).active = null;
      promoteCompletedGuideToExperience(state, caseData);
    }

    const meaningful = shouldCountObservation({
      previousContextKey,
      nextContextKey: context.key || '',
      changes,
      previousStage,
      nextStage: caseData.diagnostic.stage
    });

    caseData.meta.scans = Number(
      caseData.meta.scans || 0
    ) + 1;

    if (meaningful) {
      caseData.meta.observations = Number(
        caseData.meta.observations || 0
      ) + 1;
      addCorrelationJournal(caseData, envelope, correlation);
    }

    caseData.updatedAt = nowIso();

    if (
      context.key
      && context.key !== previousContextKey
    ) {
      addJournal(
        caseData,
        'navigation',
        `Контекст: ${context.system || 'unknown'} / ${context.pageKind || 'other'}`,
        {
          entityId: context.entityId || '',
          subview: context.subview || '',
          title: compact(
            context.title || '',
            120
          )
        }
      );
    }

    if (handoff) {
      addJournal(
        caseData,
        'handoff',
        'Billing → UserSide: контекст прикреплён к текущему кейсу',
        {
          purpose: handoff.purpose,
          sourceTabId: handoff.sourceTabId,
          targetTabId: sender.tab?.id ?? null
        }
      );
    }

    for (const change of changes) {
      addJournal(
        caseData,
        'fact',
        `Обновлено ${change.field}: ${compact(change.to, 100)}`,
        change
      );
    }

    for (const item of locatorApplied) {
      addJournal(
        caseData,
        'locator',
        `Поиск абонента: ${item.observation.type} → ${item.observation.result || 'observed'}${item.passive ? ' · passive' : ''}`,
        {
          method: item.observation.method || '',
          summary: item.observation.summary || '',
          details: item.observation.details || null
        }
      );
      if (item.observation.type === LocatorObservationType.JUNIPER_SESSION) {
        const d = item.observation.details || {};
        addJournal(
          caseData,
          'juniper',
          `JUNIPER · ${item.observation.result || d.status || 'observed'}${item.passive ? ' · passive' : ''}`,
          {
            method: item.observation.method || '',
            summary: item.observation.summary || '',
            status: d.status || '',
            subscriberIp: d.subscriberIp || '',
            subscriberMac: d.subscriberMac || '',
            bras: [d.brasName, d.brasIp].filter(Boolean).join(' · '),
            source: d.source || '',
            sessionId: d.sessionId || '',
            authType: d.authType || '',
            startTime: d.startTime || '',
            speedRaw: d.speedRaw || '',
            hasTraffic: d.hasTraffic,
            lastEvent: [d.lastEventTime, d.lastEvent].filter(Boolean).join(' · '),
            vlan: d.vlan || '',
            staleRadius: Boolean(d.staleRadius),
            readOnly: true
          }
        );
      }
    }

    if (
      caseData.diagnostic.stage !== previousStage
    ) {
      addJournal(
        caseData,
        'diagnostic',
        `Этап диагностики: ${caseData.diagnostic.stage}`,
        {
          completion: caseData.diagnostic.completion,
          readyForOnuPoll: (
            caseData.diagnostic.readyForOnuPoll
          ),
          nextRequiredSource: (
            caseData.diagnostic.nextRequiredSource
          )
        }
      );
    }

    state.cases[caseId] = caseData;
    state.activeCaseId = caseId;

    state.tabs[tabId] = {
      tabId: Number(sender.tab?.id ?? -1),
      windowId: Number(sender.tab?.windowId ?? -1),
      caseId,
      documentId: String(envelope.origin?.documentId || context.meta?.documentId || ''),
      pageInstanceId: String(envelope.origin?.pageInstanceId || ''),
      pageInstanceStartedAt: Number(envelope.origin?.pageInstanceStartedAt || 0),
      context: nextContext,
      updatedAt: nowIso()
    };

    trimCases(state);

    return {
      state,
      caseId,
      changes,
      meaningful,
      handoff: handoff
        ? {
            token: handoff.token,
            purpose: handoff.purpose,
            sourceTabId: handoff.sourceTabId,
            targetTabId: handoff.targetTabId
          }
        : null,
      diagnostic: caseData.diagnostic,
      guideProgress,
      pollTransition,
      liveSnapshot,
      correlation: correlationDetails(envelope, correlation.verdict, correlation.reason)
    };
  });
}

async function addEvent(payload, sender = null) {
  return enqueue(state => {
    const tabId = sender?.tab?.id != null ? String(sender.tab.id) : '';
    const caseId = (
      payload?.caseId
      || state.tabs?.[tabId]?.caseId
      || state.activeCaseId
    );

    const caseData = state.cases[caseId];

    if (!caseData) {
      return {
        state,
        added: false
      };
    }

    const added = addJournal(
      caseData,
      payload.type || 'info',
      payload.message || '',
      payload.details || null
    );

    if (added) {
      caseData.updatedAt = nowIso();
      caseData.meta ||= {};
      if (/^operator_/.test(String(payload?.type || ''))) {
        caseData.meta.operatorActions = Number(caseData.meta.operatorActions || 0) + 1;
      }
    }

    return {
      state,
      added
    };
  });
}

async function patchUi(payload) {
  return enqueue(state => {
    const allowed = [
      'open',
      'section',
      'top',
      'compact',
      'navigationHelp'
    ];

    for (const key of allowed) {
      if (key in (payload || {})) {
        state.ui[key] = payload[key];
      }
    }

    return state;
  });
}

async function patchAppeal(payload, sender = null) {
  return enqueue(state => {
    const tabId = sender?.tab?.id != null ? String(sender.tab.id) : '';
    const tabCaseId = String(state.tabs?.[tabId]?.caseId || '');
    const requestedCaseId = String(payload?.caseId || '');

    if (tabCaseId && requestedCaseId && tabCaseId !== requestedCaseId) {
      return {
        state,
        accepted: false,
        reason: 'foreign-case'
      };
    }

    const caseId = tabCaseId || requestedCaseId || String(state.activeCaseId || '');
    const caseData = state.cases?.[caseId];
    if (!caseData) {
      return {
        state,
        accepted: false,
        reason: 'case-not-found'
      };
    }

    caseData.appeal = normalizeAppealState(payload?.appeal);
    caseData.updatedAt = nowIso();

    const transition = payload?.transition && typeof payload.transition === 'object'
      ? payload.transition
      : {};
    const action = compact(transition.action || 'update', 60);
    const answer = compact(transition.answer || '', 160);
    const question = compact(transition.question || '', 240);
    addJournal(
      caseData,
      'appeal',
      action === 'select'
        ? `Обращение · ${compact(transition.typeLabel || caseData.appeal.typeId, 120)}`
        : action === 'answer'
          ? `Ответ · ${answer || 'принят'}`
          : action === 'back'
            ? 'Обращение · шаг назад'
            : action === 'reset'
              ? 'Обращение · маршрут очищен'
              : 'Обращение · маршрут обновлён',
      {
        action,
        typeId: caseData.appeal.typeId,
        nodeId: caseData.appeal.nodeId,
        outcomeId: caseData.appeal.outcomeId,
        status: caseData.appeal.status,
        question,
        answer
      }
    );

    return {
      state,
      accepted: true,
      appeal: caseData.appeal
    };
  });
}


function applyActionSessionPatchToCase(caseData, caseId, rawPatch = {}) {
  const lifecycle = ensureActionSessionShape(caseData);
  const patch = rawPatch && typeof rawPatch === 'object' ? rawPatch : {};
  const active = patch.active && typeof patch.active === 'object' ? patch.active : null;
  const allowedStatuses = new Set(['REQUESTED','NAVIGATING','DESTINATION_REACHED','WAITING_TARGET','TARGET_READY','SHOWN','COMPLETED','INTERRUPTED','REJECTED','TIMEOUT','FAILED','DISMISSED']);
  if (active) {
    const operationId = compact(active.operationId || '', 100);
    const operationType = compact(active.operationType || 'GUIDED_ACTION', 100);
    const semanticTargetId = compact(active.semanticTargetId || '', 160);
    const status = compact(active.status || '', 40);
    const activeCaseId = compact(active.caseId || caseId, 140);
    if (!operationId || !semanticTargetId || !allowedStatuses.has(status) || activeCaseId !== caseId) {
      return { accepted: false, reason: 'invalid-action-session', workflow: lifecycle };
    }
    lifecycle.active = {
      operationId,
      operationType,
      intent: compact(active.intent || '', 40),
      navigationCapable: active.navigationCapable !== false,
      caseId,
      targetType: compact(active.targetType || 'semantic', 80),
      semanticTargetId,
      sourceSystem: compact(active.sourceSystem || '', 40),
      sourcePageKind: compact(active.sourcePageKind || '', 80),
      destinationSystem: compact(active.destinationSystem || '', 40),
      destinationPageKind: compact(active.destinationPageKind || '', 80),
      destinationEntityId: compact(active.destinationEntityId || '', 80),
      status,
      requestedAt: compact(active.requestedAt || '', 50),
      navigationStartedAt: compact(active.navigationStartedAt || '', 50),
      destinationReachedAt: compact(active.destinationReachedAt || '', 50),
      targetReadyAt: compact(active.targetReadyAt || '', 50),
      shownAt: compact(active.shownAt || '', 50),
      completedAt: compact(active.completedAt || '', 50),
      expectedPostCondition: compact(active.expectedPostCondition || '', 600),
      actualResult: compact(active.actualResult || '', 600),
      completionReason: compact(active.completionReason || '', 160),
      failureReason: compact(active.failureReason || '', 240),
      sourceAction: compact(active.sourceAction || '', 100),
      title: compact(active.title || '', 220),
      text: compact(active.text || '', 360),
      replayOnly: Boolean(active.replayOnly),
      planId: compact(active.planId || '', 160),
      targetTimeoutMs: Math.max(1000, Math.min(60000, Number(active.targetTimeoutMs || 12000))),
      showCount: Math.max(0, Math.min(20, Number(active.showCount || 0))),
      rebindCount: Math.max(0, Math.min(100, Number(active.rebindCount || 0))),
      lastTransitionAt: compact(active.lastTransitionAt || '', 50),
      terminalDiagnosticRecorded: Boolean(active.terminalDiagnosticRecorded)
    };
  } else if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
    lifecycle.active = null;
  }

  const lastTerminal = patch.lastTerminal && typeof patch.lastTerminal === 'object'
    ? patch.lastTerminal
    : null;
  if (lastTerminal) {
    const terminalStatus = compact(lastTerminal.status || '', 40);
    const terminalOperationId = compact(lastTerminal.operationId || '', 100);
    const terminalCaseId = compact(lastTerminal.caseId || caseId, 140);
    if (terminalOperationId && terminalCaseId === caseId && ['COMPLETED','INTERRUPTED','REJECTED','TIMEOUT','FAILED','DISMISSED'].includes(terminalStatus)) {
      lifecycle.lastTerminal = {
        operationId: terminalOperationId,
        operationType: compact(lastTerminal.operationType || 'GUIDED_ACTION', 100),
        intent: compact(lastTerminal.intent || '', 40),
        navigationCapable: lastTerminal.navigationCapable !== false,
        caseId,
        semanticTargetId: compact(lastTerminal.semanticTargetId || '', 160),
        destinationSystem: compact(lastTerminal.destinationSystem || '', 40),
        destinationPageKind: compact(lastTerminal.destinationPageKind || '', 80),
        destinationEntityId: compact(lastTerminal.destinationEntityId || '', 80),
        status: terminalStatus,
        requestedAt: compact(lastTerminal.requestedAt || '', 50),
        completedAt: compact(lastTerminal.completedAt || '', 50),
        actualResult: compact(lastTerminal.actualResult || '', 600),
        completionReason: compact(lastTerminal.completionReason || '', 160),
        failureReason: compact(lastTerminal.failureReason || '', 240),
        sourceAction: compact(lastTerminal.sourceAction || '', 100),
        planId: compact(lastTerminal.planId || '', 160),
        lastTransitionAt: compact(lastTerminal.lastTransitionAt || '', 50)
      };
    }
  }
  lifecycle.updatedAt = nowIso();
  return { accepted: true, workflow: lifecycle };
}

async function readFastActionSessions() {
  if (fastActionSessionsCache) return clone(fastActionSessionsCache);
  const result = await chrome.storage.local.get(ACTION_SESSION_FAST_KEY);
  const raw = result?.[ACTION_SESSION_FAST_KEY];
  fastActionSessionsCache = raw && typeof raw === 'object' ? raw : {};
  return clone(fastActionSessionsCache);
}

async function writeFastActionSession(caseId, workflow) {
  const map = await readFastActionSessions();
  map[caseId] = {
    active: workflow?.active || null,
    lastTerminal: workflow?.lastTerminal || null,
    updatedAt: workflow?.updatedAt || nowIso()
  };
  const entries = Object.entries(map)
    .sort((a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || '')))
    .slice(0, MAX_CASES);
  const bounded = Object.fromEntries(entries);
  await chrome.storage.local.set({ [ACTION_SESSION_FAST_KEY]: bounded });
  fastActionSessionsCache = clone(bounded);
  return bounded[caseId];
}

async function stateWithFastActionSessions(state = null) {
  const result = state || await readState();
  const map = await readFastActionSessions();
  for (const [caseId, workflow] of Object.entries(map || {})) {
    const caseData = result?.cases?.[caseId];
    if (!caseData || !workflow) continue;
    ensureCaseShape(caseData, caseId);
    caseData.workflow.actionSession = {
      ...ensureActionSessionShape(caseData),
      active: workflow.active || null,
      lastTerminal: workflow.lastTerminal || null,
      updatedAt: workflow.updatedAt || ''
    };
  }
  return result;
}

async function patchActionSessionFast(payload, sender = null) {
  const state = await readStateReference();
  const tabId = sender?.tab?.id != null ? String(sender.tab.id) : '';
  const tabCaseId = String(state.tabs?.[tabId]?.caseId || '');
  const requestedCaseId = String(payload?.caseId || '');
  if (tabCaseId && requestedCaseId && tabCaseId !== requestedCaseId) {
    return { accepted: false, reason: 'foreign-case', fastLane: true };
  }
  const caseId = tabCaseId || requestedCaseId || String(state.activeCaseId || '');
  const caseData = state.cases?.[caseId];
  if (!caseData) return { accepted: false, reason: 'case-not-found', fastLane: true };
  ensureCaseShape(caseData, caseId);
  const applied = applyActionSessionPatchToCase(caseData, caseId, payload?.patch || {});
  if (!applied.accepted) return { ...applied, fastLane: true };

  await writeFastActionSession(caseId, applied.workflow);
  // Keep the service-worker snapshot coherent without serializing the entire
  // Workbench State. The small fast key is the durable cross-page source of
  // truth for ActionSession and STORE_GET_STATE overlays it after worker restart.
  if (mainStateCache?.cases?.[caseId]) {
    ensureCaseShape(mainStateCache.cases[caseId], caseId);
    mainStateCache.cases[caseId].workflow.actionSession = clone(applied.workflow);
  }
  caseData.workflow.actionSession = clone(applied.workflow);
  return {
    accepted: true,
    workflow: clone(applied.workflow),
    fastLane: true
  };
}

async function patchWorkflow(payload, sender = null) {
  if (String(payload?.namespace || '') === 'actionSession') {
    return patchActionSessionFast(payload, sender);
  }
  return enqueue(state => {
    const tabId = sender?.tab?.id != null ? String(sender.tab.id) : '';
    const tabCaseId = String(state.tabs?.[tabId]?.caseId || '');
    const requestedCaseId = String(payload?.caseId || '');

    if (tabCaseId && requestedCaseId && tabCaseId !== requestedCaseId) {
      return { state, accepted: false, reason: 'foreign-case' };
    }

    const caseId = tabCaseId || requestedCaseId || String(state.activeCaseId || '');
    const caseData = state.cases?.[caseId];
    if (!caseData) return { state, accepted: false, reason: 'case-not-found' };

    ensureCaseShape(caseData, caseId);
    const namespace = String(payload?.namespace || '');
    if (namespace === 'actionSession') {
      const lifecycle = ensureActionSessionShape(caseData);
      const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
      const active = patch.active && typeof patch.active === 'object' ? patch.active : null;
      const allowedStatuses = new Set(['REQUESTED','NAVIGATING','DESTINATION_REACHED','WAITING_TARGET','TARGET_READY','SHOWN','COMPLETED','INTERRUPTED','REJECTED','TIMEOUT','FAILED','DISMISSED']);
      if (active) {
        const operationId = compact(active.operationId || '', 100);
        const operationType = compact(active.operationType || 'GUIDED_ACTION', 100);
        const semanticTargetId = compact(active.semanticTargetId || '', 160);
        const status = compact(active.status || '', 40);
        const activeCaseId = compact(active.caseId || caseId, 140);
        if (!operationId || !semanticTargetId || !allowedStatuses.has(status) || activeCaseId !== caseId) {
          return { state, accepted: false, reason: 'invalid-action-session' };
        }
        lifecycle.active = {
          operationId,
          operationType,
          intent: compact(active.intent || '', 40),
          navigationCapable: active.navigationCapable !== false,
          caseId,
          targetType: compact(active.targetType || 'semantic', 80),
          semanticTargetId,
          sourceSystem: compact(active.sourceSystem || '', 40),
          sourcePageKind: compact(active.sourcePageKind || '', 80),
          destinationSystem: compact(active.destinationSystem || '', 40),
          destinationPageKind: compact(active.destinationPageKind || '', 80),
          destinationEntityId: compact(active.destinationEntityId || '', 80),
          status,
          requestedAt: compact(active.requestedAt || '', 50),
          navigationStartedAt: compact(active.navigationStartedAt || '', 50),
          destinationReachedAt: compact(active.destinationReachedAt || '', 50),
          targetReadyAt: compact(active.targetReadyAt || '', 50),
          shownAt: compact(active.shownAt || '', 50),
          completedAt: compact(active.completedAt || '', 50),
          expectedPostCondition: compact(active.expectedPostCondition || '', 600),
          actualResult: compact(active.actualResult || '', 600),
          completionReason: compact(active.completionReason || '', 160),
          failureReason: compact(active.failureReason || '', 240),
          sourceAction: compact(active.sourceAction || '', 100),
          title: compact(active.title || '', 220),
          text: compact(active.text || '', 360),
          replayOnly: Boolean(active.replayOnly),
          planId: compact(active.planId || '', 160),
          targetTimeoutMs: Math.max(1000, Math.min(60000, Number(active.targetTimeoutMs || 12000))),
          showCount: Math.max(0, Math.min(20, Number(active.showCount || 0))),
          rebindCount: Math.max(0, Math.min(100, Number(active.rebindCount || 0))),
          lastTransitionAt: compact(active.lastTransitionAt || '', 50),
          terminalDiagnosticRecorded: Boolean(active.terminalDiagnosticRecorded)
        };
      } else if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
        lifecycle.active = null;
      }
      const lastTerminal = patch.lastTerminal && typeof patch.lastTerminal === 'object'
        ? patch.lastTerminal
        : null;
      if (lastTerminal) {
        const terminalStatus = compact(lastTerminal.status || '', 40);
        const terminalOperationId = compact(lastTerminal.operationId || '', 100);
        const terminalCaseId = compact(lastTerminal.caseId || caseId, 140);
        if (terminalOperationId && terminalCaseId === caseId && ['COMPLETED','INTERRUPTED','REJECTED','TIMEOUT','FAILED','DISMISSED'].includes(terminalStatus)) {
          lifecycle.lastTerminal = {
            operationId: terminalOperationId,
            operationType: compact(lastTerminal.operationType || 'GUIDED_ACTION', 100),
            intent: compact(lastTerminal.intent || '', 40),
            navigationCapable: lastTerminal.navigationCapable !== false,
            caseId,
            semanticTargetId: compact(lastTerminal.semanticTargetId || '', 160),
            destinationSystem: compact(lastTerminal.destinationSystem || '', 40),
            destinationPageKind: compact(lastTerminal.destinationPageKind || '', 80),
            destinationEntityId: compact(lastTerminal.destinationEntityId || '', 80),
            status: terminalStatus,
            requestedAt: compact(lastTerminal.requestedAt || '', 50),
            completedAt: compact(lastTerminal.completedAt || '', 50),
            actualResult: compact(lastTerminal.actualResult || '', 600),
            completionReason: compact(lastTerminal.completionReason || '', 160),
            failureReason: compact(lastTerminal.failureReason || '', 240),
            sourceAction: compact(lastTerminal.sourceAction || '', 100),
            planId: compact(lastTerminal.planId || '', 160),
            lastTransitionAt: compact(lastTerminal.lastTransitionAt || '', 50)
          };
        }
      }
      lifecycle.updatedAt = nowIso();
      caseData.updatedAt = lifecycle.updatedAt;
      return { state, accepted: true, workflow: lifecycle };
    }

    if (namespace === 'operatorTrace') {
      const trace = ensureOperatorTraceShape(caseData);
      const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
      const now = nowIso();
      if ('enabled' in patch) {
        const nextEnabled = Boolean(patch.enabled);
        if (trace.enabled !== nextEnabled) {
          trace.enabled = nextEnabled;
          if (nextEnabled) {
            trace.activatedAt = now;
            trace.startedAt = now;
            trace.stoppedAt = '';
          } else {
            trace.deactivatedAt = now;
            trace.stoppedAt = now;
          }
          trace.updatedAt = now;
          addJournal(
            caseData,
            'operator_trace',
            nextEnabled ? 'Подробная запись действий включена оператором' : 'Подробная запись действий выключена оператором',
            { enabled: nextEnabled }
          );
        }
      }
      caseData.updatedAt = now;
      return { state, accepted: true, workflow: trace };
    }
    if (namespace !== 'ponAcquisition') {
      return { state, accepted: false, reason: 'unsupported-workflow' };
    }

    const flow = ensureWorkflowShape(caseData);
    const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
    const now = nowIso();

    if ('tmcShownAt' in patch) flow.tmcShownAt = compact(patch.tmcShownAt || '', 40);
    if ('tmcShownOperationId' in patch) flow.tmcShownOperationId = compact(patch.tmcShownOperationId || '', 100);
    if ('tmcShownFields' in patch) flow.tmcShownFields = Array.isArray(patch.tmcShownFields)
      ? [...new Set(patch.tmcShownFields.filter(field => ['olt', 'serial', 'mac'].includes(field)))]
      : [];
    if ('tmcWritebackPending' in patch) flow.tmcWritebackPending = Boolean(patch.tmcWritebackPending);
    if ('tmcWritebackPendingSave' in patch) flow.tmcWritebackPendingSave = Boolean(patch.tmcWritebackPendingSave);
    if ('tmcWritebackRequestedAt' in patch) flow.tmcWritebackRequestedAt = compact(patch.tmcWritebackRequestedAt || '', 40);
    if ('tmcWritebackAppliedAt' in patch) flow.tmcWritebackAppliedAt = compact(patch.tmcWritebackAppliedAt || '', 40);
    if ('tmcWritebackVerifiedInForm' in patch) {
      flow.tmcWritebackVerifiedInForm = Boolean(patch.tmcWritebackVerifiedInForm);
      flow.tmcWritebackVerifiedInFormAt = flow.tmcWritebackVerifiedInForm ? compact(patch.tmcWritebackVerifiedInFormAt || now, 40) : '';
    }
    if ('tmcExpectedFields' in patch) flow.tmcExpectedFields = Array.isArray(patch.tmcExpectedFields) ? [...new Set(patch.tmcExpectedFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
    if ('tmcWritebackAppliedFields' in patch) flow.tmcWritebackAppliedFields = Array.isArray(patch.tmcWritebackAppliedFields) ? [...new Set(patch.tmcWritebackAppliedFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
    if ('tmcWritebackMatchedFields' in patch) flow.tmcWritebackMatchedFields = Array.isArray(patch.tmcWritebackMatchedFields) ? [...new Set(patch.tmcWritebackMatchedFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
    if ('tmcWritebackConflictFields' in patch) flow.tmcWritebackConflictFields = Array.isArray(patch.tmcWritebackConflictFields) ? [...new Set(patch.tmcWritebackConflictFields.filter(field => ['olt','onuSerial','onuMac'].includes(field)))] : [];
    if ('tmcWritebackSavedAt' in patch) flow.tmcWritebackSavedAt = compact(patch.tmcWritebackSavedAt || '', 40);
    if ('tmcWritebackLastStatus' in patch) flow.tmcWritebackLastStatus = compact(patch.tmcWritebackLastStatus || '', 80);
    if ('tmcWritebackLastAt' in patch) flow.tmcWritebackLastAt = compact(patch.tmcWritebackLastAt || '', 40);
    if ('tmcWritebackDeclinedAt' in patch) flow.tmcWritebackDeclinedAt = compact(patch.tmcWritebackDeclinedAt || '', 40);
    if ('tmcWritebackDeclineReason' in patch) flow.tmcWritebackDeclineReason = compact(patch.tmcWritebackDeclineReason || '', 120);
    if ('tmcWritebackPromptDismissedAt' in patch) flow.tmcWritebackPromptDismissedAt = compact(patch.tmcWritebackPromptDismissedAt || '', 40);
    if ('tmcWritebackPromptDismissReason' in patch) flow.tmcWritebackPromptDismissReason = compact(patch.tmcWritebackPromptDismissReason || '', 120);
    if ('tmcWritebackFields' in patch) {
      flow.tmcWritebackFields = Array.isArray(patch.tmcWritebackFields)
        ? [...new Set(patch.tmcWritebackFields.filter(field => ['olt', 'onuSerial', 'onuMac'].includes(field)))]
        : [];
    }
    if ('instructionAcknowledged' in patch) {
      flow.instructionAcknowledged = Boolean(patch.instructionAcknowledged);
      if (flow.instructionAcknowledged && !flow.instructionAcknowledgedAt) {
        flow.instructionAcknowledgedAt = now;
      }
      if (!flow.instructionAcknowledged) flow.instructionAcknowledgedAt = '';
    }
    if ('instructionAcknowledgedAt' in patch) {
      flow.instructionAcknowledgedAt = compact(patch.instructionAcknowledgedAt || '', 40);
    }
    if ('technicalWritebackVerified' in patch) {
      flow.technicalWritebackVerified = Boolean(patch.technicalWritebackVerified);
      if (flow.technicalWritebackVerified && !flow.technicalWritebackVerifiedAt) {
        flow.technicalWritebackVerifiedAt = now;
      }
      if (!flow.technicalWritebackVerified) flow.technicalWritebackVerifiedAt = '';
    }
    if ('expectedTechnicalWriteback' in patch) {
      const src = patch.expectedTechnicalWriteback;
      if (src && typeof src === 'object') {
        flow.expectedTechnicalWriteback = {
          oltName: compact(src.oltName || '', 220),
          oltIp: compact(src.oltIp || '', 80),
          onuSerial: compact(src.onuSerial || '', 120),
          onuMac: compact(src.onuMac || '', 120)
        };
      } else {
        flow.expectedTechnicalWriteback = null;
      }
    }
    flow.updatedAt = now;
    caseData.updatedAt = now;

    return { state, accepted: true, workflow: clone(flow) };
  });
}


async function resetCase(payload) {
  return enqueue(state => {
    const caseId = (
      payload?.caseId
      || state.activeCaseId
    );

    if (
      caseId
      && state.cases[caseId]
    ) {
      delete state.cases[caseId];
    }

    if (state.activeCaseId === caseId) {
      state.activeCaseId = '';
    }

    for (const tab of Object.values(state.tabs)) {
      if (tab.caseId === caseId) {
        tab.caseId = '';
      }
    }

    for (const [token, handoff] of Object.entries(
      state.handoffs
    )) {
      if (handoff.caseId === caseId) {
        delete state.handoffs[token];
      }
    }

    return state;
  });
}

function sanitizeHandoffActionSession(workflow, caseId = '') {
  if (!workflow || typeof workflow !== 'object') return null;
  const active = workflow.active && typeof workflow.active === 'object' ? workflow.active : null;
  const lastTerminal = workflow.lastTerminal && typeof workflow.lastTerminal === 'object' ? workflow.lastTerminal : null;
  if (!active && !lastTerminal) return null;
  const cleanSession = input => {
    if (!input || typeof input !== 'object') return null;
    const sessionCaseId = compact(input.caseId || caseId, 140);
    if (caseId && sessionCaseId && sessionCaseId !== caseId) return null;
    return {
      operationId: compact(input.operationId || '', 100),
      operationType: compact(input.operationType || 'GUIDE_NAVIGATION', 100),
      intent: compact(input.intent || '', 40),
      navigationCapable: input.navigationCapable !== false,
      caseId: sessionCaseId || caseId,
      targetType: compact(input.targetType || 'semantic', 80),
      semanticTargetId: compact(input.semanticTargetId || '', 160),
      sourceSystem: compact(input.sourceSystem || '', 40),
      sourcePageKind: compact(input.sourcePageKind || '', 80),
      destinationSystem: compact(input.destinationSystem || '', 40),
      destinationPageKind: compact(input.destinationPageKind || '', 80),
      destinationEntityId: compact(input.destinationEntityId || '', 80),
      status: compact(input.status || '', 40),
      requestedAt: compact(input.requestedAt || '', 50),
      navigationStartedAt: compact(input.navigationStartedAt || '', 50),
      destinationReachedAt: compact(input.destinationReachedAt || '', 50),
      targetReadyAt: compact(input.targetReadyAt || '', 50),
      shownAt: compact(input.shownAt || '', 50),
      completedAt: compact(input.completedAt || '', 50),
      expectedPostCondition: compact(input.expectedPostCondition || '', 600),
      actualResult: compact(input.actualResult || '', 600),
      completionReason: compact(input.completionReason || '', 160),
      failureReason: compact(input.failureReason || '', 240),
      sourceAction: compact(input.sourceAction || '', 100),
      title: compact(input.title || '', 220),
      text: compact(input.text || '', 360),
      replayOnly: Boolean(input.replayOnly),
      planId: compact(input.planId || '', 160),
      targetTimeoutMs: Math.max(1000, Math.min(60000, Number(input.targetTimeoutMs || 12000))),
      showCount: Math.max(0, Math.min(20, Number(input.showCount || 0))),
      rebindCount: Math.max(0, Math.min(20, Number(input.rebindCount || 0))),
      lastTransitionAt: compact(input.lastTransitionAt || '', 50),
      terminalDiagnosticRecorded: Boolean(input.terminalDiagnosticRecorded)
    };
  };
  const cleanActive = cleanSession(active);
  const cleanLastTerminal = cleanSession(lastTerminal);
  if (!cleanActive && !cleanLastTerminal) return null;
  return {
    schema: 'simnet-universal-action-session-v1',
    active: cleanActive,
    lastTerminal: cleanLastTerminal,
    updatedAt: compact(workflow.updatedAt || cleanActive?.lastTransitionAt || cleanLastTerminal?.lastTransitionAt || '', 50)
  };
}

async function prepareHandoff(
  payload,
  sender
) {
  return enqueue(state => {
    purgeHandoffs(state);

    const token = String(
      payload?.token || ''
    );

    const caseId = String(
      payload?.caseId || ''
    );

    if (!validHandoffToken(token)) {
      throw new Error(
        'Invalid handoff token'
      );
    }

    if (
      !caseId
      || !state.cases[caseId]
    ) {
      throw new Error(
        'Active case is required for handoff'
      );
    }

    if (!safeTargetUrl(payload?.targetUrl)) {
      throw new Error(
        'Unsupported handoff target'
      );
    }

    const handoff = {
      token,
      caseId,
      purpose: (
        payload?.purpose || 'userside-tmc'
      ),
      subscriberIp: compact(
        payload?.subscriberIp || '',
        64
      ),
      login: compact(
        payload?.login || '',
        80
      ),
      contract: compact(
        payload?.contract || '',
        80
      ),
      billingId: compact(
        payload?.billingId || '',
        80
      ),
      customerId: compact(
        payload?.customerId || '',
        80
      ),
      actionSession: sanitizeHandoffActionSession(payload?.actionSession || null, caseId),
      targetUrl: compact(
        payload?.targetUrl || '',
        1000
      ),
      sourceTabId: sender.tab?.id ?? null,
      sourceWindowId: sender.tab?.windowId ?? null,
      targetTabId: null,
      targetWindowId: null,
      status: 'pending',
      createdAt: nowIso(),
      createdAtMs: nowMs(),
      expiresAt: new Date(
        nowMs() + HANDOFF_TTL_MS
      ).toISOString()
    };

    state.handoffs[token] = handoff;

    const caseData = ensureCaseShape(
      state.cases[caseId],
      caseId
    );

    addJournal(
      caseData,
      'handoff',
      'Подготовлен переход Billing → UserSide',
      {
        purpose: handoff.purpose,
        subscriberIp: handoff.subscriberIp,
        sourceTabId: handoff.sourceTabId,
        operationId: handoff.actionSession?.active?.operationId || '',
        semanticTargetId: handoff.actionSession?.active?.semanticTargetId || ''
      }
    );

    return {
      token,
      caseId,
      expiresAt: handoff.expiresAt
    };
  });
}

function usersideCustomerIdFromTabUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.hostname !== 'userside.simnet.kiev.ua') return '';
    const match = url.pathname.match(/^\/customer\/(\d+)\/?$/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function focusExistingUsersideCase(payload = {}, sender = {}) {
  const caseId = String(payload?.caseId || '');
  const requestedCustomerId = String(payload?.customerId || '').replace(/\D+/g, '');
  if (!caseId || !requestedCustomerId) {
    return { focused: false, reason: 'case-or-customer-missing' };
  }

  // Zero-State fast path. customerId was already correlated into the source
  // Case, and /customer/<id> is the canonical UserSide subscriber identity.
  // Querying that exact URL is enough to prove the destination without waiting
  // for the serialized Workbench State queue or reading chrome.storage.
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({
      url: `https://userside.simnet.kiev.ua/customer/${requestedCustomerId}*`
    });
  } catch {
    try {
      tabs = (await chrome.tabs.query({ url: 'https://userside.simnet.kiev.ua/*' }))
        .filter(tab => usersideCustomerIdFromTabUrl(tab?.url) === requestedCustomerId);
    } catch {
      tabs = [];
    }
  }

  const targetTab = tabs.find(tab => (
    Number.isInteger(tab?.id)
    && usersideCustomerIdFromTabUrl(tab?.url) === requestedCustomerId
  )) || null;
  if (!targetTab?.id) return { focused: false, reason: 'same-customer-tab-not-found' };

  try {
    await chrome.tabs.update(targetTab.id, { active: true });
    if (targetTab.windowId != null) await chrome.windows.update(targetTab.windowId, { focused: true });

    // Focusing an already-open exact customer does not create a navigation,
    // hashchange or pageshow event. Explicitly bind/wake that live content
    // script so the pending one-shot ActionSession can continue all the way to
    // its semantic target (for example userside.tmc) without a second click.
    let bindAck = null;
    try {
      bindAck = await chrome.tabs.sendMessage(targetTab.id, {
        type: MessageType.HANDOFF_FAST_CASE_BIND,
        payload: {
          caseId,
          customerId: requestedCustomerId,
          purpose: 'userside-tmc-fast-focus',
          actionSession: sanitizeHandoffActionSession(payload?.actionSession || null, caseId)
        }
      });
    } catch (error) {
      bindAck = { accepted: false, reason: error?.message || String(error) };
    }

    return {
      focused: true,
      reusedWithoutReload: true,
      caseBound: bindAck?.accepted === true,
      bindReason: bindAck?.accepted === true ? '' : String(bindAck?.reason || 'fast-bind-not-acknowledged'),
      targetTabId: targetTab.id,
      customerId: requestedCustomerId
    };
  } catch (error) {
    return { focused: false, reason: error?.message || String(error) };
  }
}

async function openHandoffTarget(payload = {}, sender = {}) {
  const token = String(payload?.token || '');
  const caseId = String(payload?.caseId || '');
  if (!validHandoffToken(token) || !caseId) {
    return { opened: false, reused: false, reason: 'invalid-request' };
  }

  const state = await readState();
  purgeHandoffs(state);
  const handoff = state.handoffs?.[token] || null;
  const caseData = state.cases?.[caseId] || null;
  if (!handoff || handoff.caseId !== caseId || !caseData) {
    return { opened: false, reused: false, reason: 'handoff-not-found' };
  }
  if (!safeTargetUrl(handoff.targetUrl)) {
    return { opened: false, reused: false, reason: 'unsafe-target' };
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: 'https://userside.simnet.kiev.ua/*' });
  } catch {
    try {
      tabs = (await chrome.tabs.query({})).filter(tab => {
        try {
          return new URL(String(tab?.url || '')).hostname === 'userside.simnet.kiev.ua';
        } catch {
          return false;
        }
      });
    } catch {
      tabs = [];
    }
  }

  const customerId = String(
    rawFactValue(caseData?.identity?.customerId)
    || handoff.customerId
    || ''
  ).replace(/\D+/g, '');

  // Safest/fastest reuse: an already open tab showing this exact UserSide Case.
  let targetTab = customerId
    ? tabs.find(tab => usersideCustomerIdFromTabUrl(tab?.url) === customerId)
    : null;

  // Otherwise only reuse a tab that Workbench itself previously attached to
  // this Case. Never hijack an arbitrary UserSide tab belonging to another
  // subscriber just because it happens to be open.
  if (!targetTab) {
    const managedIds = new Set();
    for (const item of Object.values(state.handoffs || {})) {
      if (item?.caseId === caseId && item?.targetTabId != null) {
        managedIds.add(Number(item.targetTabId));
      }
    }
    for (const item of caseData?.route?.handoffs || []) {
      if (item?.targetTabId != null) managedIds.add(Number(item.targetTabId));
    }
    targetTab = tabs.find(tab => managedIds.has(Number(tab?.id))) || null;
  }

  if (!targetTab?.id) {
    return { opened: false, reused: false, reason: 'reusable-tab-not-found' };
  }

  try {
    const sameCustomer = Boolean(
      customerId
      && usersideCustomerIdFromTabUrl(targetTab.url) === customerId
    );

    // For an already-open exact customer this is only a hash change carrying
    // the one-shot handoff token, so UserSide itself is not reloaded. For a
    // Workbench-owned tab on another page we reuse the tab but navigate it.
    await chrome.tabs.update(targetTab.id, {
      active: true,
      url: handoff.targetUrl
    });
    if (targetTab.windowId != null) {
      await chrome.windows.update(targetTab.windowId, { focused: true });
    }

    await enqueue(liveState => {
      const liveHandoff = liveState.handoffs?.[token];
      const liveCase = liveState.cases?.[caseId];
      if (!liveHandoff || !liveCase) return null;
      liveHandoff.targetTabId = targetTab.id;
      liveHandoff.targetWindowId = targetTab.windowId ?? null;
      liveHandoff.reusedTargetTab = true;
      liveHandoff.reusedWithoutReload = sameCustomer;
      addJournal(
        liveCase,
        'handoff',
        sameCustomer
          ? 'UserSide: переиспользована уже открытая карточка текущего абонента'
          : 'UserSide: переиспользована вкладка Workbench',
        {
          purpose: liveHandoff.purpose,
          targetTabId: targetTab.id,
          reusedWithoutReload: sameCustomer
        }
      );
      return null;
    });

    return {
      opened: true,
      reused: true,
      targetTabId: targetTab.id,
      reusedWithoutReload: sameCustomer
    };
  } catch (error) {
    return {
      opened: false,
      reused: false,
      reason: error?.message || String(error)
    };
  }
}

async function claimHandoff(
  payload,
  sender
) {
  // A normal UserSide page often has no pending Billing handoff. Detect that
  // with a read-only pass so a null claim never rewrites the complete state.
  const preview = await readState();
  purgeHandoffs(preview);
  const previewToken = String(payload?.token || '');
  const previewIp = comparable(payload?.subscriberIp || '');
  const previewCandidate = validHandoffToken(previewToken)
    ? preview.handoffs?.[previewToken]
    : Object.values(preview.handoffs || {})
      .filter(item => item.status === 'pending')
      .find(item => !previewIp || comparable(item.subscriberIp) === previewIp);
  if (!previewCandidate) return null;

  return enqueue(state => {
    purgeHandoffs(state);

    const token = String(
      payload?.token || ''
    );

    let handoff = validHandoffToken(token)
      ? state.handoffs[token]
      : null;

    if (!handoff) {
      const subscriberIp = comparable(
        payload?.subscriberIp || ''
      );

      handoff = Object.values(
        state.handoffs
      )
        .filter(item => item.status === 'pending')
        .filter(item => (
          !subscriberIp
          || comparable(item.subscriberIp) === subscriberIp
        ))
        .sort(
          (a, b) =>
            Number(b.createdAtMs || 0)
            - Number(a.createdAtMs || 0)
        )[0] || null;
    }

    if (!handoff) {
      return null;
    }

    handoff.status = 'claimed';
    handoff.targetTabId = sender.tab?.id ?? null;
    handoff.targetWindowId = sender.tab?.windowId ?? null;
    handoff.claimedAt = nowIso();
    handoff.claimedAtMs = nowMs();
    handoff.currentUrl = compact(
      payload?.currentUrl || '',
      1000
    );

    return {
      token: handoff.token,
      caseId: handoff.caseId,
      purpose: handoff.purpose,
      sourceTabId: handoff.sourceTabId,
      sourceWindowId: handoff.sourceWindowId,
      targetTabId: handoff.targetTabId,
      subscriberIp: handoff.subscriberIp,
      actionSession: sanitizeHandoffActionSession(handoff.actionSession || null, handoff.caseId)
    };
  });
}

function safeBillingTechnicalTarget(rawUrl, sourceTabUrl = '') {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol !== 'https:') return '';
    if (!['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(url.hostname)) return '';
    if (!/\/cgi-bin\/adm\/adm\.pl$/i.test(url.pathname)) return '';
    if (String(url.searchParams.get('a') || '').toLowerCase() !== 'dopdata') return '';
    const billingId = String(url.searchParams.get('id') || '').trim();
    if (!/^\d+$/.test(billingId)) return '';
    // Hard invariant: never navigate source tab to authenticated Billing URL without pp.
    // Prefer pp from the proposed URL; else rebind from the live source tab URL.
    let pp = url.searchParams.get('pp') || '';
    if (!pp && sourceTabUrl) {
      try {
        const src = new URL(String(sourceTabUrl));
        pp = src.searchParams.get('pp') || '';
        const uu = src.searchParams.get('uu') || '';
        if (pp) url.searchParams.set('pp', pp);
        if (uu) url.searchParams.set('uu', uu);
      } catch {}
    }
    if (!url.searchParams.get('pp')) {
      // Refuse URL without pp — caller should focus-only without navigation.
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}


const BILLING_SEMANTIC_ROUTES = Object.freeze({
  'billing.technical': { path: '/cgi-bin/adm/adm.pl', a: 'dopdata', tmpl: '1', parent_type: '0' },
  'billing.user': { path: '/cgi-bin/adm/adm.pl', a: 'user' },
  'billing.juniper': { path: '/cgi-bin/adm/stat.pl', a: '252' },
  'billing.poll.entry': { path: '/cgi-bin/adm/adm.pl', a: 'user' },
  'billing.poll.huawei': { path: '/cgi-bin/adm/stat.pl', a: '313' },
  'billing.poll.epon': { path: '/cgi-bin/adm/stat.pl', a: '310' },
  'billing.poll.gpon': { path: '/cgi-bin/adm/stat.pl', a: '311' },
  'billing.poll.gcom': { path: '/cgi-bin/adm/stat.pl', a: '312' }
});

function safeBillingSemanticTarget(semanticTargetId, entityId, sourceTabUrl = '') {
  const spec = BILLING_SEMANTIC_ROUTES[String(semanticTargetId || '')] || null;
  const id = String(entityId || '').trim();
  if (!spec || !/^\d+$/.test(id)) return '';
  try {
    const source = new URL(String(sourceTabUrl || ''));
    if (source.protocol !== 'https:') return '';
    if (!['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(source.hostname)) return '';
    const pp = source.searchParams.get('pp') || '';
    const uu = source.searchParams.get('uu') || '';
    if (!pp) return '';
    const target = new URL(spec.path, source.origin);
    target.searchParams.set('pp', pp);
    if (uu) target.searchParams.set('uu', uu);
    target.searchParams.set('a', spec.a);
    target.searchParams.set('id', id);
    if (spec.tmpl) target.searchParams.set('tmpl', spec.tmpl);
    if (spec.parent_type != null) target.searchParams.set('parent_type', spec.parent_type);
    return target.href;
  } catch {
    return '';
  }
}

function sameBillingSemanticContext(currentUrl, targetUrl) {
  try {
    const current = new URL(String(currentUrl || ''));
    const target = new URL(String(targetUrl || ''));
    return current.origin === target.origin
      && current.pathname === target.pathname
      && String(current.searchParams.get('a') || '') === String(target.searchParams.get('a') || '')
      && String(current.searchParams.get('id') || '') === String(target.searchParams.get('id') || '');
  } catch {
    return false;
  }
}

function isSameBillingTechnicalContext(currentUrl, targetUrl) {
  try {
    const current = new URL(String(currentUrl || ''));
    const target = new URL(String(targetUrl || ''));
    return current.hostname === target.hostname
      && /\/cgi-bin\/adm\/adm\.pl$/i.test(current.pathname)
      && String(current.searchParams.get('a') || '').toLowerCase() === 'dopdata'
      && String(current.searchParams.get('id') || '') === String(target.searchParams.get('id') || '');
  } catch {
    return false;
  }
}

async function focusHandoffSource(payload) {
  const state = await readStateReference();

  const token = String(
    payload?.token || ''
  );

  const caseId = String(
    payload?.caseId || ''
  );

  const handoffFresh = item => {
    if (!item) return false;
    const ttl = item.status === 'claimed' ? CLAIMED_HANDOFF_TTL_MS : HANDOFF_TTL_MS;
    const reference = Number(item.claimedAtMs || item.createdAtMs || 0);
    return Boolean(reference && nowMs() - reference <= ttl);
  };

  let handoff = validHandoffToken(token)
    ? state.handoffs[token]
    : null;
  if (handoff && !handoffFresh(handoff)) handoff = null;

  if (!handoff && caseId) {
    handoff = Object.values(
      state.handoffs
    )
      .filter(item => item.caseId === caseId && handoffFresh(item))
      .sort(
        (a, b) =>
          Number(b.createdAtMs || 0)
          - Number(a.createdAtMs || 0)
      )[0] || null;
  }

  if (
    !handoff
    || handoff.sourceTabId == null
  ) {
    return {
      focused: false,
      reason: 'source-tab-not-found'
    };
  }

  try {
    let sourceTab = null;
    try {
      sourceTab = await chrome.tabs.get(handoff.sourceTabId);
    } catch {}
    const semanticTargetId = String(payload?.semanticTargetId || '');
    const requestedEntityId = String(payload?.entityId || '').trim();
    const caseData = state.cases?.[handoff.caseId] || null;
    const caseBillingId = String(rawFactValue(caseData?.identity?.billingId) || '').trim();
    if (caseId && String(handoff.caseId || '') !== caseId) {
      return { focused: false, reason: 'case-mismatch', code: 'BILLING_DESTINATION_CASE_MISMATCH' };
    }
    if (requestedEntityId && caseBillingId && requestedEntityId !== caseBillingId) {
      return { focused: false, reason: 'entity-mismatch', code: 'BILLING_DESTINATION_CASE_MISMATCH' };
    }
    const semanticUrl = semanticTargetId
      ? safeBillingSemanticTarget(semanticTargetId, requestedEntityId || caseBillingId, sourceTab?.url || '')
      : '';
    const legacyTechnicalUrl = !semanticTargetId
      ? safeBillingTechnicalTarget(payload?.targetUrl, sourceTab?.url || '')
      : '';
    const targetUrl = semanticUrl || legacyTechnicalUrl;
    const alreadyDestination = Boolean(
      targetUrl
      && (semanticTargetId
        ? sameBillingSemanticContext(sourceTab?.url || '', targetUrl)
        : isSameBillingTechnicalContext(sourceTab?.url || '', targetUrl))
    );
    const update = { active: true };
    // Replay/navigation is built from the live source tab session. If pp cannot
    // be recovered from that live tab, focus-only is not a successful destination.
    if (targetUrl && !alreadyDestination) update.url = targetUrl;

    await chrome.tabs.update(
      handoff.sourceTabId,
      update
    );

    if (handoff.sourceWindowId != null) {
      await chrome.windows.update(
        handoff.sourceWindowId,
        { focused: true }
      );
    }

    return {
      focused: true,
      sourceTabId: handoff.sourceTabId,
      navigated: Boolean(targetUrl && !alreadyDestination),
      alreadyTechnical: Boolean(!semanticTargetId && alreadyDestination),
      alreadyDestination,
      sessionConfirmed: Boolean(targetUrl),
      semanticTargetId
    };
  } catch (error) {
    return {
      focused: false,
      reason: error?.message || String(error)
    };
  }
}

function redactGuideSecretString(value) {
  const text = String(value == null ? '' : value);
  if (!/[?&]pp=/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.searchParams.has('pp')) url.searchParams.set('pp', '[redacted]');
    return url.href;
  } catch {
    return text.replace(/([?&]pp=)[^&#\s]*/gi, '$1%5Bredacted%5D');
  }
}

function sanitizeGuidePersistedDetails(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return redactGuideSecretString(value);
  if (Array.isArray(value)) return value.slice(0, 64).map(item => sanitizeGuidePersistedDetails(item, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (String(key).toLowerCase() === 'pp') {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = sanitizeGuidePersistedDetails(item, depth + 1);
  }
  return out;
}

async function markGuideStep(payload, sender) {
  return enqueue(state => {
    const caseId = String(payload?.envelope?.caseId || payload?.caseId || '');

    const stepId = compact(
      payload?.stepId || '',
      160
    );

    const caseData = state.cases[caseId];

    if (
      !caseData
      || !stepId
    ) {
      return {
        state,
        marked: false
      };
    }

    ensureCaseShape(caseData, caseId);
    const envelope = envelopeFor(MessageType.GUIDE_MARK_STEP, payload, sender, caseData, caseId);
    const correlation = validateCorrelation(caseData, envelope, {
      requireCase: true,
      requireEpisode: true,
      requireCurrentRoute: true,
      currentDocument: currentTabDocument(state, envelope),
      requireCurrentDocument: true,
      processedEventIds: caseData.meta?.processedEventIds || []
    });
    if (!correlation.canMutate) {
      addCorrelationJournal(caseData, envelope, correlation, 'GUIDE CORRELATION');
      caseData.updatedAt = nowIso();
      return {
        state,
        marked: false,
        reason: correlation.reason,
        correlation: correlationDetails(envelope, correlation.verdict, correlation.reason)
      };
    }
    const guide = ensureGuideShape(caseData);
    const step = guideStepRecord(caseData, stepId);
    const phase = ['hint', 'action', 'result', 'failed'].includes(payload?.phase)
      ? payload.phase
      : 'result';
    const details = payload?.details && typeof payload.details === 'object'
      ? sanitizeGuidePersistedDetails(payload.details)
      : null;
    const expected = normalizeGuideExpectation(payload?.expected);
    const at = nowIso();

    // Repeated clicks on an already-visible hint are a UI retry, not a new Case
    // mutation. Avoid another full persistent State rewrite and avoid growing the
    // processed-event list for the same semantic hint.
    if (
      phase === 'hint'
      && step.hintedAt
      && guide.active?.stepId === stepId
      && !['completed', 'result_failed'].includes(step.status)
    ) {
      return {
        __skipWrite: true,
        value: {
          state,
          marked: false,
          reason: 'hint-already-active',
          stepId,
          phase,
          step,
          active: guide.active
        }
      };
    }

    rememberProcessedEvent(caseData, envelope);
    if (expected) step.expected = expected;

    if (phase === 'hint') {
      if (step.status === 'completed' || guide.completed?.[stepId]) {
        if (guide.active?.stepId === stepId) guide.active = null;
        caseData.updatedAt = at;
        return { state, marked: false, reason: 'completed-step-is-terminal' };
      }
      if (guide.active?.stepId && guide.active.stepId !== stepId) {
        const previous = guide.steps[guide.active.stepId];
        if (previous && !['completed', 'result_failed'].includes(previous.status)) {
          previous.status = 'superseded';
          previous.supersededAt = at;
          previous.supersededBy = stepId;
        }
      }
      if (!step.hintedAt) {
        guide.sequence += 1;
        step.sequence = guide.sequence;
        step.hintedAt = at;
        step.hint = details;
        if (step.status === 'new') step.status = 'hinted';
        addJournal(
          caseData,
          'guide_hint',
          `HINT · ${stepId}`,
          details
        );
      }
      guide.active = {
        stepId,
        expected: expected || step.expected || null,
        hintedAt: step.hintedAt || at,
        title: compact(details?.title || '', 220),
        kind: compact(details?.kind || '', 80)
      };
    }

    if (phase === 'action') {
      if (step.status === 'completed' || guide.completed?.[stepId]) {
        if (guide.active?.stepId === stepId) guide.active = null;
        caseData.updatedAt = at;
        return { state, marked: false, reason: 'completed-step-is-terminal' };
      }
      if (!step.actionConfirmedAt) {
        step.actionConfirmedAt = at;
        step.action = details;
        if (step.status !== 'completed') step.status = 'action_confirmed';
        addJournal(
          caseData,
          'guide_action',
          `ACTION · ${stepId}`,
          details
        );
      }
      guide.active = {
        stepId,
        expected: expected || step.expected || guide.active?.expected || null,
        hintedAt: step.hintedAt || guide.active?.hintedAt || '',
        title: compact(details?.title || guide.active?.title || '', 220),
        kind: compact(details?.kind || guide.active?.kind || '', 80)
      };
    }

    if (phase === 'result') {
      if (step.status !== 'completed') {
        step.status = 'completed';
        step.resultConfirmedAt = at;
        step.result = details;
        guide.completed[stepId] = {
          at,
          details
        };
        addJournal(
          caseData,
          'guide_result',
          `STEP DONE · ${stepId}`,
          details
        );
      }
      if (guide.active?.stepId === stepId) guide.active = null;
      if (stepId === 'billing.inspect-juniper') {
        caseData.juniper.reviewStatus = 'reviewed';
        caseData.juniper.operatorOpened = true;
        caseData.juniper.openedAt ||= at;
        ensureJuniperEvidenceShape(caseData).opened ||= {
          kind: 'JUNIPER_OPENED',
          at: caseData.juniper.openedAt,
          source: 'operator',
          pageKind: 'billing_juniper',
          documentId: ''
        };
      }
    }

    if (phase === 'failed') {
      step.status = 'result_failed';
      step.failedAt = at;
      step.result = details;
      addJournal(
        caseData,
        'guide_result',
        `RESULT FAILED · ${stepId}`,
        details
      );
    }

    caseData.updatedAt = at;
    addCorrelationJournal(caseData, envelope, correlation, 'GUIDE CORRELATION');

    return {
      state,
      marked: true,
      stepId,
      phase,
      step,
      active: guide.active
    };
  });
}


async function applyLocatorObservation(payload, sender) {
  return enqueue(state => {
    // Route/canonical observations must name their case. Never resolve an async
    // response again through activeCaseId or the tab's current binding.
    const caseId = String(payload?.envelope?.caseId || payload?.caseId || '');
    const caseData = state.cases?.[caseId];
    if (!caseData) {
      return { state, applied: false, reason: 'case-not-found' };
    }

    ensureCaseShape(caseData, caseId);
    const envelope = envelopeFor(
      MessageType.LOCATOR_APPLY_OBSERVATION,
      payload,
      sender,
      caseData,
      caseId
    );
    const observation = clone(payload?.observation || {});
    if (!observation.type) {
      return { state, applied: false, reason: 'observation-required' };
    }

    const asynchronous = Boolean(envelope.operation?.requestId);
    const asynchronousJuniper = observation.type === LocatorObservationType.JUNIPER_SESSION
      && asynchronous;
    const correlation = validateCorrelation(caseData, envelope, {
      requireCase: true,
      requireEpisode: true,
      // A read-only Juniper response remains valid for the pinned Case even if
      // Guide advanced to technical data while the HTTP request was in flight.
      requireIdentity: !asynchronousJuniper,
      requireCurrentRoute: !asynchronousJuniper,
      currentDocument: currentTabDocument(state, envelope),
      requireCurrentDocument: !asynchronous,
      currentPollAttemptId: String(caseData.operations?.poll?.current?.pollAttemptId || ''),
      requirePollAttempt: observation.type === LocatorObservationType.POLL_RESULT,
      currentRequestId: observation.type === LocatorObservationType.JUNIPER_SESSION
        ? String(caseData.juniper?.requestId || '')
        : '',
      requireRequest: observation.type === LocatorObservationType.JUNIPER_SESSION
        && asynchronous,
      processedEventIds: caseData.meta?.processedEventIds || []
    });
    const observationContext = contextForEnvelope(caseData, envelope);
    observation.producerRouteRelation = observation.routeRelation || '';
    observation.producerPassive = Boolean(observation.passive);
    observation.passive = false;
    observation.passiveReason = '';

    const routeActionBefore = String(caseData?.locator?.recommendation?.action || '');
    observation.routeRelation = classifyObservationRelation(
      caseData,
      observation,
      observationContext,
      routeActionBefore
    );
    if (!correlation.canMutate || observation.routeRelation !== RouteRelation.ON_ROUTE) {
      observation.passive = true;
      observation.passiveReason = !correlation.canMutate
        ? `correlation-${correlation.reason}`
        : observation.details?.preview
          ? 'juniper-background-preview'
          : `route-${observation.routeRelation}`;
    }
    // Background Juniper data availability is separate from the mandatory review.
    if (observation.type === LocatorObservationType.JUNIPER_SESSION && observation.details?.preview) {
      observation.passive = true;
      observation.passiveReason = !correlation.canMutate
        ? `correlation-${correlation.reason}`
        : 'juniper-background-preview';
    }
    const correlationOutcome = observation.passive
      ? {
          verdict: CorrelationVerdict.PASSIVE,
          canMutate: false,
          reason: observation.passiveReason || `route-${observation.routeRelation}`
        }
      : correlation;
    observation.correlation = correlationDetails(
      envelope,
      correlationOutcome.verdict,
      correlationOutcome.reason
    );
    observation.details = {
      ...(observation.details || {}),
      ...(envelope.operation?.pollAttemptId
        ? { pollAttemptId: envelope.operation.pollAttemptId }
        : {})
    };

    if (!correlation.canMutate) {
      if (observation.type === LocatorObservationType.JUNIPER_SESSION) {
        caseData.juniper.dataStatus = 'stale';
      }
      const applied = applyLocatorObservations(caseData, [observation], observationContext);
      addCorrelationJournal(caseData, envelope, correlation);
      caseData.updatedAt = nowIso();
      return {
        state,
        applied: false,
        passive: applied.length > 0,
        reason: correlation.reason,
        correlation: correlationDetails(envelope, correlation.verdict, correlation.reason)
      };
    }

    rememberProcessedEvent(caseData, envelope);

    if (observation.type === LocatorObservationType.BILLING_OLT_SAVE_INTENT) {
      const selected = observation.details || {};
      const candidate = caseData.locator?.candidates?.find(item => (
        (
          selected.oltIp
          && item.oltIp
          && comparable(selected.oltIp) === comparable(item.oltIp)
        )
        || (
          selected.oltName
          && item.oltName
          && (
            comparable(selected.oltName).includes(comparable(item.oltName))
            || comparable(item.oltName).includes(comparable(selected.oltName))
          )
        )
      )) || null;

      if (!candidate) {
        return {
          state,
          applied: false,
          reason: 'selected-olt-does-not-match-locator-candidate'
        };
      }

      observation.details = {
        ...candidate,
        ...selected
      };
      caseData.route.pendingBillingOltSave = {
        ...observation.details,
        candidateId: candidate.id,
        sourceDocumentId: selected.sourceDocumentId || '',
        createdAt: nowIso(),
        createdAtMs: nowMs()
      };
    }

    if (observation.type === LocatorObservationType.BILLING_OLT_SAVED) {
      const binding = currentBillingBinding(caseData);
      const candidate = caseData.locator?.candidates?.find(item => (
        binding
        && (
          (item.oltIp && binding.oltIp && comparable(item.oltIp) === comparable(binding.oltIp))
          || (item.oltName && binding.oltName && comparable(item.oltName) === comparable(binding.oltName))
        )
      )) || null;

      if (!binding || !candidate) {
        return {
          state,
          applied: false,
          reason: 'saved-olt-does-not-match-candidate'
        };
      }

      observation.details = {
        ...candidate,
        ...(observation.details || {}),
        oltName: binding.oltName,
        oltIp: binding.oltIp,
        pollAction: binding.pollAction,
        technology: binding.technology
      };
    }

    // Juniper is a first-class Case evidence source. A correlated background
    // read may establish ONLINE/OFFLINE/NO_SESSION without forcing a manual visit.
    // Manual OPENED remains separate evidence. Identity conflicts never merge into
    // canonical network facts and are reported instead.
    if (observation.type === LocatorObservationType.JUNIPER_SESSION) {
      const d = observation.details || {};
      const juniperState = applyJuniperCaseEvidence(caseData, observation, envelope, { automatic: true });
      if (juniperState.applied) {
        const juniperFacts = {
          ...(d.subscriberIp ? { ip: { value: d.subscriberIp, source: 'billing:juniper', confidence: 0.92 } } : {}),
          ...(d.subscriberMac ? { mac: { value: d.subscriberMac, source: 'billing:juniper', confidence: 0.94 } } : {})
        };
        mergeFacts(caseData, 'network', juniperFacts, 'billing:juniper');
      }
      caseData.locator ||= {};
      caseData.locator.sourceStatus ||= {};
      if (juniperState.applied && juniperState.automatic) {
        caseData.locator.sourceStatus.juniperPreview = {
          result: juniperState.result,
          details: observation.details || {},
          summary: compact(observation.summary || '', 360),
          method: observation.method || '',
          readOnly: true,
          preview: true,
          observedAt: caseData.juniper?.lastReadAt || nowIso()
        };
      }
    }

    const applied = applyLocatorObservations(
      caseData,
      [observation],
      observationContext
    );
    if (
      observation.type === LocatorObservationType.JUNIPER_SESSION
      && observation.routeRelation === RouteRelation.ON_ROUTE
      && caseData.locator?.sourceStatus?.juniper
    ) {
      delete caseData.locator.sourceStatus.juniperPreview;
    }
    caseData.diagnostic = diagnosticSnapshot(caseData);
    syncPonWritebackWorkflow(caseData);
    if (caseData.locator?.termination?.status === LocatorTermination.CONFIRMED) {
      ensureGuideShape(caseData).active = null;
      promoteCompletedGuideToExperience(state, caseData);
    }
    caseData.updatedAt = nowIso();
    addCorrelationJournal(caseData, envelope, correlationOutcome);

    for (const item of applied) {
      addJournal(
        caseData,
        'locator',
        `Поиск абонента: ${item.observation.type} → ${item.observation.result || 'observed'}${item.passive ? ' · passive' : ''}`,
        {
          method: item.observation.method || '',
          summary: item.observation.summary || '',
          details: item.observation.details || null
        }
      );
      if (item.observation.type === LocatorObservationType.JUNIPER_SESSION) {
        const d = item.observation.details || {};
        addJournal(
          caseData,
          'juniper',
          `JUNIPER · ${item.observation.result || d.status || 'observed'}${item.passive ? ' · passive' : ''}`,
          {
            method: item.observation.method || '',
            summary: item.observation.summary || '',
            status: d.status || '',
            subscriberIp: d.subscriberIp || '',
            subscriberMac: d.subscriberMac || '',
            bras: [d.brasName, d.brasIp].filter(Boolean).join(' · '),
            source: d.source || '',
            sessionId: d.sessionId || '',
            authType: d.authType || '',
            startTime: d.startTime || '',
            speedRaw: d.speedRaw || '',
            hasTraffic: d.hasTraffic,
            lastEvent: [d.lastEventTime, d.lastEvent].filter(Boolean).join(' · '),
            vlan: d.vlan || '',
            staleRadius: Boolean(d.staleRadius),
            readOnly: true
          }
        );
      }
    }

    return {
      state,
      applied: applied.length > 0,
      diagnostic: caseData.diagnostic,
      correlation: correlationDetails(envelope, correlationOutcome.verdict, correlationOutcome.reason)
    };
  });
}

async function updatePollAttempt(payload, sender) {
  return enqueue(state => {
    const caseId = String(payload?.envelope?.caseId || payload?.caseId || '');
    const caseData = state.cases?.[caseId];
    if (!caseData) return { state, updated: false, reason: 'case-not-found' };
    ensureCaseShape(caseData, caseId);

    const envelope = envelopeFor(MessageType.POLL_ATTEMPT_UPDATE, payload, sender, caseData, caseId);
    const correlation = validateCorrelation(caseData, envelope, {
      requireCase: true,
      requireEpisode: true,
      requireCurrentRoute: true,
      currentDocument: currentTabDocument(state, envelope),
      requireCurrentDocument: true,
      processedEventIds: caseData.meta?.processedEventIds || []
    });
    if (!correlation.canMutate) {
      addCorrelationJournal(caseData, envelope, correlation, 'POLL CORRELATION');
      caseData.updatedAt = nowIso();
      return { state, updated: false, reason: correlation.reason };
    }

    const incoming = {
      ...(payload?.attempt || {}),
      pollAttemptId: String(
        payload?.attempt?.pollAttemptId
        || envelope.operation?.pollAttemptId
        || ''
      )
    };
    const currentAttempt = caseData.operations.poll.current;
    const currentStartedAt = Number(currentAttempt?.startedAt || 0);
    const currentIsStale = Boolean(
      pollAttemptPending(currentAttempt)
      && currentStartedAt
      && Date.now() - currentStartedAt > POLL_STALE_TIMEOUT_MS
    );
    // A content script may have been suspended or an older build may have left
    // INTENT_RECORDED pending forever. A deliberate new click is allowed to retire
    // that stale attempt atomically before accepting the new one.
    if (
      incoming.stage === PollAttemptStage.INTENT_RECORDED
      && currentIsStale
      && currentAttempt?.pollAttemptId !== incoming.pollAttemptId
    ) {
      const expired = {
        ...currentAttempt,
        stage: PollAttemptStage.TIMEOUT,
        status: 'timeout',
        pending: false,
        outcome: 'timeout',
        failureReason: 'poll-attempt-stale-before-retry',
        resolvedAt: Date.now(),
        updatedAt: nowIso()
      };
      caseData.operations.poll.current = expired;
      caseData.operations.poll.history.push(clone(expired));
      caseData.operations.poll.history = caseData.operations.poll.history.slice(-24);
      addJournal(caseData, 'poll_attempt', 'POLL TIMEOUT · разрешён повтор', {
        pollAttemptId: expired.pollAttemptId,
        verdict: CorrelationVerdict.STALE,
        reason: expired.failureReason
      });
    }
    const transition = nextPollAttempt(caseData.operations.poll.current, incoming);
    if (!transition.accepted) {
      const verdict = {
        verdict: transition.duplicate
          ? CorrelationVerdict.DUPLICATE
          : CorrelationVerdict.STALE,
        reason: transition.reason,
        canMutate: false
      };
      addCorrelationJournal(caseData, envelope, verdict, 'POLL CORRELATION');
      caseData.updatedAt = nowIso();
      return {
        state,
        updated: false,
        duplicate: Boolean(transition.duplicate),
        reason: transition.reason
      };
    }

    rememberProcessedEvent(caseData, envelope);
    caseData.operations.poll.current = {
      ...transition.attempt,
      caseId,
      episodeId: caseData.episodeId,
      routeGeneration: caseData.routeGeneration,
      identityFingerprint: identityFingerprint(caseData),
      requestTabId: envelope.origin?.tabId == null
        ? null
        : Number(envelope.origin.tabId),
      requestDocumentId: String(envelope.origin?.documentId || ''),
      updatedAt: nowIso()
    };
    if (!pollAttemptPending(caseData.operations.poll.current)) {
      const attemptId = String(caseData.operations.poll.current.pollAttemptId || '');
      if (!caseData.operations.poll.history.some(item => String(item?.pollAttemptId || '') === attemptId)) {
        caseData.operations.poll.history.push(clone(caseData.operations.poll.current));
        caseData.operations.poll.history = caseData.operations.poll.history.slice(-24);
      }
    }
    addCorrelationJournal(caseData, envelope, correlation, 'POLL CORRELATION');
    caseData.updatedAt = nowIso();
    return {
      state,
      updated: true,
      attempt: caseData.operations.poll.current,
      correlation: correlationDetails(envelope, correlation.verdict, correlation.reason)
    };
  });
}

async function updateJuniperPrefetchStatus(payload, sender) {
  return enqueue(state => {
    const caseId = String(payload?.envelope?.caseId || payload?.caseId || '');
    const caseData = state.cases?.[caseId];
    if (!caseData) return { state, updated: false, reason: 'case-not-found' };
    ensureCaseShape(caseData, caseId);
    const envelope = envelopeFor(MessageType.JUNIPER_PREFETCH_STATUS, payload, sender, caseData, caseId);
    const correlation = validateCorrelation(caseData, envelope, {
      requireCase: true,
      requireEpisode: true,
      // Loading/error status belongs to the pinned Case request, not to a Guide
      // step. Route or identity enrichment may legitimately change in parallel.
      requireIdentity: false,
      requireCurrentRoute: false,
      processedEventIds: caseData.meta?.processedEventIds || []
    });
    if (!correlation.canMutate) {
      addCorrelationJournal(caseData, envelope, correlation, 'JUNIPER CORRELATION');
      caseData.updatedAt = nowIso();
      return { state, updated: false, reason: correlation.reason };
    }
    rememberProcessedEvent(caseData, envelope);
    caseData.juniper.dataStatus = ['missing', 'loading', 'available', 'error', 'stale']
      .includes(payload?.status)
        ? payload.status
        : caseData.juniper.dataStatus;
    caseData.juniper.requestId = String(envelope.operation?.requestId || '');
    caseData.juniper.requestTabId = envelope.origin?.tabId == null
      ? null
      : Number(envelope.origin.tabId);
    caseData.juniper.requestDocumentId = String(envelope.origin?.documentId || '');
    caseData.juniper.updatedAt = nowIso();
    addCorrelationJournal(caseData, envelope, correlation, 'JUNIPER CORRELATION');
    caseData.updatedAt = nowIso();
    return { state, updated: true, juniper: caseData.juniper };
  });
}

function isUrlAllowed(rawUrl) {
  try {
    const url = new URL(rawUrl);

    return (
      url.protocol === 'https:'
      && ALLOWED_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

async function handleFetch({
  url,
  method = 'GET',
  headers = {},
  body = null
} = {}) {
  if (!isUrlAllowed(url)) {
    throw new Error(
      `Blocked URL: ${String(url || '')}`
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const requestHeaders = new Headers(headers);
    let requestBody = body;

    if (
      body
      && typeof body === 'object'
      && !(body instanceof FormData)
    ) {
      if (!requestHeaders.has('content-type')) {
        requestHeaders.set(
          'content-type',
          'application/json'
        );
      }
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: ['GET', 'HEAD'].includes(
        String(method).toUpperCase()
      )
        ? null
        : requestBody,
      credentials: 'include',
      signal: controller.signal
    });

    const contentType = (
      response.headers.get('content-type') || ''
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    let data = text;

    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(text || 'null');
      } catch {
        data = text;
      }
    }

    return {
      status: response.status,
      contentType,
      url: response.url || String(url || ''),
      redirected: Boolean(response.redirected),
      data
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function callCustomerId(raw) {
  const value = String(raw ?? '').trim();
  return /^\d{1,12}$/.test(value) ? value : '';
}

async function fetchCallRegistrationResponse(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const startedAt = nowMs();

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || null,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal
    });
    const data = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || '',
      contentType: response.headers.get('content-type') || '',
      url: response.url || String(url || ''),
      redirected: Boolean(response.redirected),
      data,
      durationMs: Math.max(0, nowMs() - startedAt),
      responseBytes: new TextEncoder().encode(data).byteLength,
      message: response.ok
        ? ''
        : `UserSide вернул HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ''}`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function callIpv4(raw) {
  const value = String(raw ?? '').trim();
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? value
    : '';
}

function pbxRecordId(raw) {
  const value = String(raw ?? '').trim().replace(/^pbx:/, '');
  return /^\d{9,12}\.\d{1,12}$/.test(value) ? value : '';
}

function pbxCallKey(raw) {
  const recordId = pbxRecordId(raw);
  return recordId ? `pbx:${recordId}` : '';
}

function normalizedPhone(raw) {
  const digits = String(raw ?? '').replace(/\D+/g, '');
  if (digits.length < 6 || digits.length > 15) return '';
  if (/^380\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^80\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}

function maskedPhone(raw) {
  const phone = normalizedPhone(raw);
  if (phone.length < 7) return phone ? '***' : '';
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

function normalizedContract(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^abon/, '')
    .replace(/\D+/g, '');
  return /^\d{3,14}$/.test(value) && !/^0+$/.test(value) ? value : '';
}

function senderHostname(sender = {}) {
  for (const raw of [sender?.url, sender?.tab?.url]) {
    try {
      const url = new URL(String(raw || ''));
      if (url.protocol === 'https:') return url.hostname;
    } catch {}
  }
  return '';
}

function ensurePbxTelephonyShape(state) {
  state.telephony ||= {};
  state.telephony.schema = 'simnet-pbx-call-context-v1';
  state.telephony.calls ||= {};
  state.telephony.bindings ||= {};
  state.telephony.updatedAt ||= '';
  return state.telephony;
}

function normalizePbxCall(raw = {}, fallbackObservedAt = nowIso()) {
  const recordId = pbxRecordId(raw.recordId || raw.callKey);
  if (!recordId) return null;
  const callKey = `pbx:${recordId}`;
  const callerId = normalizedPhone(raw.callerId);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || ''))
    ? String(raw.date)
    : '';
  const time = /^\d{2}:\d{2}(?::\d{2})?$/.test(String(raw.time || ''))
    ? String(raw.time)
    : '';
  const observedAt = Number.isFinite(Date.parse(String(raw.observedAt || '')))
    ? new Date(Date.parse(String(raw.observedAt))).toISOString()
    : fallbackObservedAt;
  const startedAtMs = Math.max(0, Number(raw.startedAtMs || 0));
  const duration = compact(raw.duration || '', 20);
  const durationSeconds = Math.max(0, Math.min(24 * 60 * 60, Number(raw.durationSeconds || 0)));
  const agent = compact(raw.agent || '', 120);
  const agentExtension = String(
    String(raw.agentExtension || '').match(/^\d{3,6}$/)?.[0]
    || agent.match(/^\s*(\d{3,6})\b/)?.[1]
    || ''
  );

  return {
    callKey,
    recordId,
    recordUrl: `${PBX_ORIGIN}/fop2/getrec.php?id=${encodeURIComponent(recordId)}`,
    date,
    time,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
    callerId,
    callerMasked: maskedPhone(callerId),
    providerCode: compact(raw.providerCode || raw.prov || '', 12),
    contract: compact(raw.contract || '', 40),
    subscriberIp: callIpv4(raw.subscriberIp),
    holdtime: Math.max(0, Math.min(24 * 60 * 60, Number(raw.holdtime || 0))),
    duration,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    queue: compact(raw.queue || '', 24),
    agent,
    agentExtension,
    observedAt,
    source: 'pbx:list.php'
  };
}

function prunePbxTelephony(telephony, atMs = nowMs()) {
  const calls = Object.entries(telephony.calls || {})
    .filter(([, call]) => {
      const occurred = Number(call?.startedAtMs || 0) || Date.parse(call?.observedAt || '');
      return occurred > 0 && atMs - occurred <= PBX_CALL_TTL_MS;
    })
    .sort((left, right) => (
      Number(right[1]?.startedAtMs || Date.parse(right[1]?.observedAt || '') || 0)
      - Number(left[1]?.startedAtMs || Date.parse(left[1]?.observedAt || '') || 0)
    ))
    .slice(0, MAX_PBX_CALLS);
  telephony.calls = Object.fromEntries(calls);
  for (const [callKey, binding] of Object.entries(telephony.bindings || {})) {
    if (telephony.calls[callKey]) continue;
    const boundAt = Date.parse(binding?.boundAt || '') || 0;
    if (!boundAt || atMs - boundAt > PBX_CALL_TTL_MS) delete telephony.bindings[callKey];
  }
  return telephony;
}


function pbxCallIdentitySignature(call = {}) {
  return [
    pbxCallKey(call.callKey || call.recordId),
    pbxRecordId(call.recordId || call.callKey),
    normalizedPhone(call.callerId),
    normalizedContract(call.contract),
    callIpv4(call.subscriberIp),
    compact(call.date || '', 16),
    compact(call.time || '', 16),
    compact(call.agentExtension || '', 12)
  ].join('|');
}

function pbxCallMatch(call = {}, caseData = {}) {
  const providerCode = compact(call.providerCode || '', 12);
  const contract = normalizedContract(call.contract);
  const caseContracts = [
    rawFactValue(caseData.identity?.contract),
    rawFactValue(caseData.identity?.login)
  ].map(normalizedContract).filter(Boolean);
  const subscriberIp = callIpv4(call.subscriberIp);
  const caseIp = callIpv4(rawFactValue(caseData.network?.ip));
  const matchedBy = [];
  const conflicts = [];

  // PBX `prov=1` is a legacy/provider namespace observed on LUKNET-origin rows.
  // Its `contract` value is not directly comparable with the current SIMNET abon contract.
  // We therefore keep the contract as context, but it can neither authorize nor contradict
  // the Case unless it happens to match exactly. Strong IP evidence is still required;
  // phone-only evidence remains supporting and can never authorize registration.
  const contractComparable = providerCode !== '1';

  if (contract && caseContracts.length) {
    if (caseContracts.includes(contract)) matchedBy.push('contract');
    else if (contractComparable) conflicts.push('contract');
  }
  if (subscriberIp && caseIp) {
    if (subscriberIp === caseIp) matchedBy.push('ip');
    else conflicts.push('ip');
  }
  if (conflicts.length) {
    return {
      level: 'conflict',
      matchedBy,
      conflicts,
      providerCode,
      contractComparable,
      confidence: 0
    };
  }
  if (matchedBy.length) {
    return {
      level: 'strong',
      matchedBy,
      conflicts: [],
      providerCode,
      contractComparable,
      confidence: matchedBy.includes('contract') ? 1 : 0.99
    };
  }

  const callerId = normalizedPhone(call.callerId);
  const casePhones = [
    caseData.profile?.phone,
    caseData.profile?.mobile,
    caseData.identity?.phone,
    caseData.contact?.phone
  ].map(rawFactValue).map(normalizedPhone).filter(Boolean);
  if (callerId && casePhones.includes(callerId)) {
    return {
      level: 'supporting',
      matchedBy: ['phone'],
      conflicts: [],
      providerCode,
      contractComparable,
      confidence: 0.93
    };
  }

  return {
    level: 'none',
    matchedBy: [],
    conflicts: [],
    providerCode,
    contractComparable,
    confidence: 0
  };
}

async function observePbxRecentCalls(payload = {}, sender = {}) {
  if (senderHostname(sender) !== 'pbx.simnet.kiev.ua') {
    throw new Error('PBX snapshot accepted only from the PBX page');
  }
  if (payload.schema !== 'simnet-pbx-recent-calls-v1' || !Array.isArray(payload.calls)) {
    throw new Error('Некорректный снимок PBX');
  }
  const fallbackObservedAt = Number.isFinite(Date.parse(String(payload.observedAt || '')))
    ? new Date(Date.parse(String(payload.observedAt))).toISOString()
    : nowIso();
  const normalized = payload.calls
    .slice(0, MAX_PBX_CALLS)
    .map(call => normalizePbxCall(call, fallbackObservedAt))
    .filter(Boolean);

  return enqueue(state => {
    const telephony = ensurePbxTelephonyShape(state);
    let stored = 0;
    for (const call of normalized) {
      const previous = telephony.calls[call.callKey] || null;
      telephony.calls[call.callKey] = {
        ...(previous || {}),
        ...call,
        firstObservedAt: previous?.firstObservedAt || call.observedAt
      };
      stored += 1;
    }
    telephony.updatedAt = fallbackObservedAt;
    prunePbxTelephony(telephony);
    return {
      accepted: true,
      stored,
      total: Object.keys(telephony.calls).length,
      updatedAt: telephony.updatedAt
    };
  });
}

async function queryPbxRecentCalls(payload = {}, sender = {}) {
  const state = await readState();
  const { caseId, caseData } = callCaseFromState(state, payload, sender);
  const requestedCustomerId = callCustomerId(payload.customerId);
  const knownCustomerId = callCustomerId(rawFactValue(caseData.identity?.customerId));
  if (requestedCustomerId && knownCustomerId && requestedCustomerId !== knownCustomerId) {
    throw new Error('Запрошенный Customer ID не относится к текущему кейсу');
  }
  const telephony = prunePbxTelephony(ensurePbxTelephonyShape(state));
  const calls = Object.values(telephony.calls)
    .sort((left, right) => (
      Number(right.startedAtMs || Date.parse(right.observedAt || '') || 0)
      - Number(left.startedAtMs || Date.parse(left.observedAt || '') || 0)
    ))
    .slice(0, 30)
    .map(call => ({
      ...clone(call),
      match: pbxCallMatch(call, caseData),
      binding: telephony.bindings?.[call.callKey]
        ? clone(telephony.bindings[call.callKey])
        : null
    }));
  return {
    schema: telephony.schema,
    caseId,
    customerId: knownCustomerId || requestedCustomerId,
    updatedAt: telephony.updatedAt,
    calls
  };
}

async function bindPbxCall(payload = {}, sender = {}) {
  return enqueue(state => {
    const { caseId, caseData } = callCaseFromState(state, payload, sender);
    const customerId = callCustomerId(payload.customerId)
      || callCustomerId(rawFactValue(caseData.identity?.customerId));
    const knownCustomerId = callCustomerId(rawFactValue(caseData.identity?.customerId));
    if (!customerId) throw new Error('UserSide Customer ID не определён');
    if (knownCustomerId && knownCustomerId !== customerId) {
      throw new Error('Customer ID не относится к текущему кейсу');
    }

    const callKey = pbxCallKey(payload.callKey);
    if (!callKey) throw new Error('Некорректный PBX callid');
    const telephony = prunePbxTelephony(ensurePbxTelephonyShape(state));
    const call = telephony.calls[callKey];
    if (!call) throw new Error('Звонок уже отсутствует в свежем снимке PBX');

    const match = pbxCallMatch(call, caseData);
    const operatorOverride = payload.operatorOverride === true && payload.overrideAcknowledged === true;
    if (match.level === 'conflict' && !operatorOverride) {
      throw new Error(`PBX-звонок конфликтует с текущим Case: ${match.conflicts.join(', ')}`);
    }
    if (match.level !== 'strong' && !operatorOverride) {
      throw new Error('Неоднозначный звонок: требуется точное совпадение договора или IP. Одного телефона недостаточно. Можно принять звонок только через явный режим «под ответственность оператора».');
    }

    const existing = telephony.bindings[callKey] || null;
    if (existing && String(existing.caseId || '') !== caseId) {
      throw new Error(`Этот звонок уже закреплён за другим Case: ${existing.caseLabel || existing.caseId}`);
    }
    if (existing && existing.customerId && existing.customerId !== customerId) {
      throw new Error('Этот звонок уже закреплён за другим UserSide Customer ID');
    }

    const tabId = sender?.tab?.id == null ? null : Number(sender.tab.id);
    const tabState = tabId == null ? null : state.tabs?.[String(tabId)] || null;
    const caseLabel = compact(
      rawFactValue(caseData.identity?.login)
      || rawFactValue(caseData.identity?.contract)
      || caseId,
      80
    );
    const boundAt = nowIso();
    const overrideAudit = operatorOverride ? {
      acknowledged: true,
      acknowledgedAt: boundAt,
      byTabId: tabId,
      byDocumentId: String(tabState?.documentId || ''),
      callSignature: pbxCallIdentitySignature(call),
      originalMatch: clone(match)
    } : null;
    const upgradedToOverride = Boolean(
      existing
      && operatorOverride
      && existing.mode !== 'operator-override'
      && String(existing.registrationStatus || 'bound') === 'bound'
    );
    const binding = existing || {
      schema: 'simnet-pbx-call-binding-v1',
      callKey,
      recordId: call.recordId,
      caseId,
      caseLabel,
      customerId,
      boundAt,
      boundByTabId: tabId,
      boundDocumentId: String(tabState?.documentId || ''),
      mode: operatorOverride ? 'operator-override' : 'dry-run',
      explicit: true,
      match,
      operatorOverride: overrideAudit,
      registrationStatus: 'bound'
    };
    if (upgradedToOverride) {
      binding.mode = 'operator-override';
      binding.match = clone(match);
      binding.operatorOverride = overrideAudit;
      binding.overrideUpgradedAt = boundAt;
      binding.overrideUpgradedByTabId = tabId;
      binding.overrideUpgradedDocumentId = String(tabState?.documentId || '');
    }
    telephony.bindings[callKey] = binding;
    telephony.updatedAt = nowIso();

    caseData.telephony ||= {};
    caseData.telephony.schema = 'simnet-case-call-bindings-v1';
    const prior = Array.isArray(caseData.telephony.callBindings)
      ? caseData.telephony.callBindings.filter(item => item?.callKey !== callKey)
      : [];
    caseData.telephony.callBindings = [...prior, {
      ...clone(binding),
      callerId: call.callerId,
      callerMasked: call.callerMasked,
      date: call.date,
      time: call.time,
      duration: call.duration,
      agent: call.agent,
      recordUrl: call.recordUrl
    }].slice(-MAX_CASE_CALL_BINDINGS);

    if (!existing || upgradedToOverride) {
      addJournal(
        caseData,
        'call_binding',
        operatorOverride
          ? 'PBX-звонок вручную принят под ответственность оператора и закреплён за Case'
          : 'PBX-звонок закреплён за Case без регистрации в UserSide',
        {
          callKey,
          recordId: call.recordId,
          caller: call.callerMasked,
          date: call.date,
          time: call.time,
          duration: call.duration,
          agentExtension: call.agentExtension,
          customerId,
          matchedBy: match.matchedBy,
          conflicts: match.conflicts,
          matchLevel: match.level,
          confidence: match.confidence,
          mode: operatorOverride ? 'operator-override' : 'dry-run',
          operatorOverride
        }
      );
    }
    caseData.updatedAt = nowIso();

    return {
      accepted: true,
      alreadyBound: Boolean(existing),
      binding: clone(binding),
      call: clone(call),
      match
    };
  });
}

async function validateCallSubmissionContext(payload = {}, sender = {}) {
  const state = await readState();
  const { caseId, customerId, callKey } = validateCallSubmissionState(state, payload, sender);
  return { caseId, customerId, callKey };
}

function validateCallSubmissionState(state, payload = {}, sender = {}) {
  const { caseId, caseData } = callCaseFromState(state, payload, sender);
  const customerId = callCustomerId(payload.customerId);
  const knownCustomerId = callCustomerId(rawFactValue(caseData.identity?.customerId));
  if (!customerId) throw new Error('Некорректный customerId');
  if (knownCustomerId && customerId !== knownCustomerId) {
    throw new Error('Сохранение заблокировано: Customer ID уже относится к другому Case');
  }

  const callKey = pbxCallKey(payload.pbxCallKey);
  if (!callKey) {
    throw new Error('Сохранение заблокировано: сначала закрепи завершённый PBX-звонок за текущим Case');
  }
  const telephony = ensurePbxTelephonyShape(state);
  const binding = telephony.bindings?.[callKey];
  if (!binding || binding.caseId !== caseId || binding.customerId !== customerId) {
    throw new Error('Сохранение заблокировано: PBX-звонок не закреплён за текущим Case');
  }
  const call = telephony.calls?.[callKey];
  if (!call) throw new Error('Сохранение заблокировано: PBX-звонок отсутствует в свежем снимке');
  const match = pbxCallMatch(call, caseData);
  const override = binding.operatorOverride && typeof binding.operatorOverride === 'object'
    ? binding.operatorOverride
    : null;
  const overrideValid = Boolean(
    binding.mode === 'operator-override'
    && override?.acknowledged === true
    && override.callSignature
    && override.callSignature === pbxCallIdentitySignature(call)
  );
  if (match.level === 'conflict' && !overrideValid) {
    throw new Error(`Сохранение заблокировано: данные PBX конфликтуют с Case (${match.conflicts.join(', ')})`);
  }
  if (match.level !== 'strong' && !overrideValid) {
    throw new Error('Сохранение заблокировано: нет точного совпадения договора или IP и нет подтверждённого ручного override');
  }
  return { caseId, customerId, callKey, caseData, telephony, binding, call, match, overrideValid };
}

function syncCaseCallBindingState(caseData, binding, call) {
  caseData.telephony ||= {};
  caseData.telephony.schema = 'simnet-case-call-bindings-v1';
  const previous = Array.isArray(caseData.telephony.callBindings)
    ? caseData.telephony.callBindings.find(item => item?.callKey === binding.callKey) || null
    : null;
  const other = Array.isArray(caseData.telephony.callBindings)
    ? caseData.telephony.callBindings.filter(item => item?.callKey !== binding.callKey)
    : [];
  caseData.telephony.callBindings = [...other, {
    ...(previous || {}),
    ...clone(binding),
    callerId: call?.callerId || previous?.callerId || '',
    callerMasked: call?.callerMasked || previous?.callerMasked || '',
    date: call?.date || previous?.date || '',
    time: call?.time || previous?.time || '',
    duration: call?.duration || previous?.duration || '',
    agent: call?.agent || previous?.agent || '',
    recordUrl: call?.recordUrl || previous?.recordUrl || ''
  }].slice(-MAX_CASE_CALL_BINDINGS);
  caseData.updatedAt = nowIso();
}

async function claimPbxCallSubmission(payload = {}, sender = {}) {
  const result = await enqueue(state => {
    const context = validateCallSubmissionState(state, payload, sender);
    const { caseId, customerId, callKey, caseData, telephony, binding, call } = context;
    const status = String(binding.registrationStatus || 'bound');
    if (status === 'registered') {
      throw new Error('Сохранение заблокировано: этот PBX-звонок уже зарегистрирован');
    }
    if (status === 'review_required') {
      throw new Error('Сохранение заблокировано: результат предыдущей отправки неизвестен. Сначала проверь историю звонков UserSide');
    }
    if (status === 'submitting') {
      const startedAtMs = Date.parse(String(binding.submissionStartedAt || ''));
      if (Number.isFinite(startedAtMs) && nowMs() - startedAtMs > 5 * 60 * 1000) {
        binding.registrationStatus = 'review_required';
        binding.reviewRequiredAt = nowIso();
        delete binding.submissionId;
        delete binding.submissionStartedAt;
        delete binding.submissionTabId;
        delete binding.submissionDocumentId;
        syncCaseCallBindingState(caseData, binding, call);
        addJournal(caseData, 'call_submission', 'Зависшая отправка требует ручной проверки в UserSide', {
          callKey,
          recordId: binding.recordId,
          customerId
        });
        return {
          blockedError: 'Сохранение заблокировано: предыдущая отправка зависла. Сначала проверь историю звонков UserSide'
        };
      }
      throw new Error('Сохранение заблокировано: этот PBX-звонок уже отправляется из другой вкладки');
    }

    const tabId = sender?.tab?.id == null ? null : Number(sender.tab.id);
    const tabState = tabId == null ? null : state.tabs?.[String(tabId)] || null;
    const submissionId = globalThis.crypto?.randomUUID?.()
      || `call_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    binding.registrationStatus = 'submitting';
    binding.submissionId = submissionId;
    binding.submissionStartedAt = nowIso();
    binding.submissionTabId = tabId;
    binding.submissionDocumentId = String(tabState?.documentId || '');
    telephony.updatedAt = nowIso();
    syncCaseCallBindingState(caseData, binding, call);
    addJournal(caseData, 'call_submission', 'Начата защищённая отправка звонка в UserSide', {
      callKey,
      recordId: binding.recordId,
      customerId,
      submissionId,
      tabId,
      bindingMode: binding.mode || 'dry-run',
      operatorOverride: binding.mode === 'operator-override'
    });

    return {
      submissionId,
      callKey,
      caseId,
      customerId,
      registrationStatus: binding.registrationStatus
    };
  });
  if (result?.blockedError) throw new Error(result.blockedError);
  return result;
}

async function finalizePbxCallSubmission(payload = {}, sender = {}) {
  return enqueue(state => {
    const caseId = String(payload.caseId || '');
    const customerId = callCustomerId(payload.customerId);
    const callKey = pbxCallKey(payload.callKey || payload.pbxCallKey);
    const submissionId = String(payload.submissionId || '');
    const resultStatus = String(payload.status || '');
    if (!caseId || !customerId || !callKey || !submissionId) {
      throw new Error('Некорректный ключ завершения регистрации звонка');
    }
    if (!['success', 'error', 'unknown'].includes(resultStatus)) {
      throw new Error('Некорректный результат регистрации звонка');
    }

    const { caseId: activeCaseId, caseData } = callCaseFromState(state, { caseId }, sender);
    if (activeCaseId !== caseId) throw new Error('Активная вкладка относится к другому Case');
    const telephony = ensurePbxTelephonyShape(state);
    const binding = telephony.bindings?.[callKey];
    const call = telephony.calls?.[callKey] || null;
    if (!binding || binding.caseId !== caseId || binding.customerId !== customerId) {
      throw new Error('PBX-звонок не относится к текущему Case');
    }
    if (binding.registrationStatus !== 'submitting' || binding.submissionId !== submissionId) {
      throw new Error('Отправка звонка уже завершена или принадлежит другой вкладке');
    }
    const senderTabId = sender?.tab?.id == null ? null : Number(sender.tab.id);
    if (binding.submissionTabId != null && senderTabId !== Number(binding.submissionTabId)) {
      throw new Error('Завершить отправку может только вкладка, которая её начала');
    }

    const finalizedAt = nowIso();
    if (resultStatus === 'success') {
      binding.registrationStatus = 'registered';
      binding.registeredAt = finalizedAt;
    } else if (resultStatus === 'unknown') {
      binding.registrationStatus = 'review_required';
      binding.reviewRequiredAt = finalizedAt;
    } else {
      binding.registrationStatus = 'bound';
    }
    delete binding.submissionId;
    delete binding.submissionStartedAt;
    delete binding.submissionTabId;
    delete binding.submissionDocumentId;
    telephony.updatedAt = finalizedAt;
    syncCaseCallBindingState(caseData, binding, call);
    addJournal(
      caseData,
      'call_submission',
      resultStatus === 'success'
        ? 'Звонок зарегистрирован в UserSide'
        : resultStatus === 'unknown'
          ? 'Результат регистрации неизвестен: повтор заблокирован до ручной проверки'
          : 'UserSide отклонил регистрацию: защищённая блокировка снята',
      {
        callKey,
        recordId: binding.recordId,
        customerId,
        resultStatus
      }
    );

    return {
      callKey,
      caseId,
      customerId,
      resultStatus,
      binding: clone(binding)
    };
  });
}

function customerIdFromCallUrl(rawUrl) {
  try {
    return callCustomerId(
      new URL(String(rawUrl || ''), USERSIDE_ORIGIN).pathname.match(/^\/customer\/(\d+)\/?$/i)?.[1]
    );
  } catch {
    return '';
  }
}

function unwrapCallSearchHtml(raw) {
  const text = String(raw ?? '');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed.data === 'string') return parsed.data;
  } catch {}
  return text;
}

function exactCustomerIdFromSearch(raw, caseData = {}) {
  const html = unwrapCallSearchHtml(raw);
  const login = comparable(rawFactValue(caseData.identity?.login));
  const contract = rawFactValue(caseData.identity?.contract).replace(/\D+/g, '');
  const candidates = [];
  const seen = new Set();
  const linkPattern = /href\s*=\s*["'][^"']*\/customer\/(\d+)[^"']*["']/ig;
  let match;
  while ((match = linkPattern.exec(html))) {
    const id = callCustomerId(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rowStart = Math.max(
      html.lastIndexOf('<tr', match.index),
      html.lastIndexOf('<li', match.index),
      match.index - 1200
    );
    const rowEndCandidates = [
      html.indexOf('</tr>', match.index),
      html.indexOf('</li>', match.index),
      match.index + 1800
    ].filter(index => index >= 0);
    const rowEnd = Math.min(...rowEndCandidates);
    const rowText = comparable(html.slice(Math.max(0, rowStart), rowEnd));
    const loginExact = Boolean(login && new RegExp(`(^|[^a-z0-9_])${login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i').test(rowText));
    const contractExact = Boolean(
      contract
      && (rowText.match(/\b\d{3,14}\b/g) || []).some(value => value.replace(/\D+/g, '') === contract)
    );
    candidates.push({ id, exact: loginExact || contractExact });
  }
  const exact = candidates.filter(item => item.exact);
  if (exact.length === 1) return exact[0].id;
  if (!exact.length && candidates.length === 1) return candidates[0].id;
  return '';
}

function callCaseFromState(state, payload = {}, sender = {}) {
  const requestedCaseId = String(payload.caseId || '');
  const tabId = sender?.tab?.id != null ? String(sender.tab.id) : '';
  const tabCaseId = String(state.tabs?.[tabId]?.caseId || '');
  if (requestedCaseId && tabCaseId && requestedCaseId !== tabCaseId) {
    throw new Error('Активная вкладка уже относится к другому абоненту');
  }
  const caseId = requestedCaseId || tabCaseId || '';
  const caseData = state.cases?.[caseId];
  if (!caseId || !caseData) throw new Error('Active case is required for call registration');
  return { caseId, caseData };
}

async function resolveCallCustomer(payload = {}, sender = {}) {
  const state = await readState();
  const { caseId, caseData } = callCaseFromState(state, payload, sender);
  const provided = callCustomerId(payload.customerId);
  const known = callCustomerId(rawFactValue(caseData.identity?.customerId));
  if (provided && known && provided !== known) {
    throw new Error('Запрошенный Customer ID не относится к текущему кейсу');
  }
  if (known) return { caseId, customerId: known, resolver: 'case', telemetry: [] };

  const telemetry = [];
  const request = async (url, label) => {
    const response = await fetchCallRegistrationResponse(url);
    telemetry.push({
      label,
      durationMs: Number(response.durationMs || 0),
      bytes: Number(response.responseBytes || 0),
      ok: Boolean(response.ok)
    });
    return response;
  };

  let customerId = '';
  let resolver = '';
  const subscriberIp = callIpv4(rawFactValue(caseData.network?.ip));
  if (subscriberIp) {
    const routed = await request(
      `${USERSIDE_ORIGIN}/script/gotouser.php?ip=${encodeURIComponent(subscriberIp)}`,
      'call-resolve-gotouser'
    ).catch(() => null);
    customerId = customerIdFromCallUrl(routed?.url);
    if (customerId) resolver = 'gotouser';
  }

  const searchValue = rawFactValue(caseData.identity?.login) || rawFactValue(caseData.identity?.contract);
  if (!customerId && searchValue) {
    const ajax = await request(
      `${USERSIDE_ORIGIN}/customer_list/ajax_search?token=${nowMs()}&search=${encodeURIComponent(searchValue)}`,
      'call-resolve-ajax'
    );
    customerId = exactCustomerIdFromSearch(ajax.data, caseData);
    if (customerId) resolver = 'ajax_search';
  }
  if (!customerId && searchValue) {
    const page = await request(
      `${USERSIDE_ORIGIN}/customer_list/search_page?search=${encodeURIComponent(searchValue)}`,
      'call-resolve-search-page'
    );
    customerId = exactCustomerIdFromSearch(page.data, caseData);
    if (customerId) resolver = 'search_page';
  }
  if (!customerId) throw new Error('UserSide Customer ID не найден для текущего абонента');

  await enqueue(nextState => {
    const current = nextState.cases?.[caseId];
    if (!current) throw new Error('Активный кейс изменился во время поиска UserSide');
    const existing = callCustomerId(rawFactValue(current.identity?.customerId));
    if (existing && existing !== customerId) {
      throw new Error('Найденный UserSide Customer ID конфликтует с текущим кейсом');
    }
    current.identity ||= {};
    current.identity.customerId = makeFact(
      customerId,
      `userside:${resolver}:call-registration`,
      resolver === 'gotouser' ? 0.99 : 0.97
    );
    addJournal(current, 'call_registration', 'UserSide Customer ID найден для регистрации звонка', {
      customerId,
      resolver
    });
  });
  return { caseId, customerId, resolver, telemetry };
}

async function loadCallRegistrationForm(payload = {}, sender = {}) {
  const resolved = await resolveCallCustomer(payload, sender);
  const customerId = resolved.customerId;

  const url = new URL(CALL_FORM_PATH, USERSIDE_ORIGIN);
  url.searchParams.set('section', 'call');
  url.searchParams.set('customer_id', customerId);
  const response = await fetchCallRegistrationResponse(url.href);
  return {
    ...response,
    customerId,
    resolver: resolved.resolver,
    telemetry: [
      ...resolved.telemetry,
      {
        label: 'call-form',
        durationMs: Number(response.durationMs || 0),
        bytes: Number(response.responseBytes || 0),
        ok: Boolean(response.ok)
      }
    ]
  };
}

function callRegistrationParams(payload = {}) {
  const customerId = callCustomerId(payload.customerId);
  if (!customerId) throw new Error('Некорректный customerId');
  if (!Array.isArray(payload.fields) || !payload.fields.length || payload.fields.length > 32) {
    throw new Error('Некорректный набор полей формы');
  }

  const params = new URLSearchParams();
  let totalLength = 0;
  for (const field of payload.fields) {
    const name = String(field?.name || '');
    const value = String(field?.value ?? '');
    if (!/^[a-z_][a-z0-9_]*(?:\[\])?$/i.test(name) || name.length > 64) {
      throw new Error('UserSide вернул неизвестное имя поля');
    }
    totalLength += name.length + value.length;
    if (totalLength > 50000) throw new Error('Форма слишком большая');
    params.append(name, value);
  }

  params.delete('customer_id');
  params.set('customer_id', customerId);
  const csrf = String(params.get('_csrf') || '');
  const phone = String(params.get('dopf_13') || '').trim();
  const standardComment = String(params.get('standart_comment') || '');
  if (!csrf || csrf.length > 512) throw new Error('В форме отсутствует актуальный _csrf');
  if (!phone || phone.length > 35) throw new Error('Укажите корректный телефон');
  if (!/^\d+$/.test(standardComment)) throw new Error('Некорректный типовой комментарий');
  if (!params.getAll('additional_fields[]').includes('13')) {
    throw new Error('В форме отсутствует служебное поле телефона');
  }
  return params;
}

async function submitCallRegistration(payload = {}, sender = {}) {
  const params = callRegistrationParams(payload);
  const claim = await claimPbxCallSubmission(payload, sender);
  try {
    const response = await fetchCallRegistrationResponse(
      new URL(CALL_SAVE_PATH, USERSIDE_ORIGIN).href,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: params.toString()
      }
    );
    return {
      ...response,
      pbxSubmission: claim,
      telemetry: [{
        label: 'call-submit',
        durationMs: Number(response.durationMs || 0),
        bytes: Number(response.responseBytes || 0),
        ok: Boolean(response.ok)
      }]
    };
  } catch (error) {
    await finalizePbxCallSubmission({
      ...claim,
      status: 'unknown'
    }, sender).catch(() => {});
    throw new Error(`${error?.message || String(error)}. Повтор заблокирован: сначала проверь историю звонков UserSide`);
  }
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    const type = message?.type;
    const payload = message?.payload;

    const respond = promise => Promise.resolve(promise).then(
      data => sendResponse({
        success: true,
        data
      }),
      error => {
        const diagnosticsMessage = [
          MessageType.DIAGNOSTICS_REPORT,
          MessageType.DIAGNOSTICS_GET,
          MessageType.DIAGNOSTICS_MARK_READ,
          MessageType.DIAGNOSTICS_CLEAR,
          MessageType.DIAGNOSTICS_EXPORT
        ].includes(type);
        if (!diagnosticsMessage) {
          console.error(`[SIMNET WB][SW][${String(type || 'UNKNOWN_MESSAGE')}]`, error);
          void enqueueDiagnostic({
            severity: 'ERROR',
            code: 'SERVICE_WORKER_MESSAGE_FAILED',
            operationType: String(type || 'UNKNOWN_MESSAGE'),
            source: 'service-worker-message',
            stage: 'HANDLER',
            message: error?.message || String(error),
            stack: error?.stack || '',
            caseId: String(payload?.caseId || payload?.envelope?.caseId || ''),
            operationId: String(payload?.envelope?.operation?.requestId || payload?.requestId || ''),
            details: {
              messageType: String(type || ''),
              senderTabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null
            }
          }, sender).catch(() => {});
        }
        sendResponse({
          success: false,
          error: error?.message || String(error)
        });
      }
    );

    if (type === MessageType.PING) {
      sendResponse({
        success: true,
        data: {
          status: 'pong',
          version: VERSION,
          ts: Date.now()
        }
      });
      return false;
    }

    if (type === MessageType.DIAGNOSTICS_REPORT) {
      respond(enqueueDiagnostic(payload?.entry || {}, sender));
      return true;
    }

    if (type === MessageType.DIAGNOSTICS_GET) {
      respond((async () => {
        await flushDiagnosticsBatch();
        const state = await readDiagnostics();
        await updateDiagnosticsBadge(state);
        return state;
      })());
      return true;
    }

    if (type === MessageType.DIAGNOSTICS_MARK_READ) {
      respond(markAllDiagnosticsRead());
      return true;
    }

    if (type === MessageType.DIAGNOSTICS_CLEAR) {
      respond(clearDiagnostics());
      return true;
    }

    if (type === MessageType.DIAGNOSTICS_EXPORT) {
      respond(exportDiagnosticsBundle());
      return true;
    }

    if (type === MessageType.STORE_GET_STATE) {
      respond(stateWithFastActionSessions());
      return true;
    }

    if (type === MessageType.STORE_APPLY_CONTEXT) {
      respond(applyContext(payload, sender));
      return true;
    }

    if (type === MessageType.STORE_ADD_EVENT) {
      respond(addEvent(payload, sender));
      return true;
    }

    if (type === MessageType.STORE_PATCH_UI) {
      respond(patchUi(payload));
      return true;
    }

    if (type === MessageType.STORE_PATCH_APPEAL) {
      respond(patchAppeal(payload, sender));
      return true;
    }

    if (type === MessageType.STORE_PATCH_WORKFLOW) {
      respond(patchWorkflow(payload, sender));
      return true;
    }

    if (type === MessageType.STORE_RESET_CASE) {
      respond(resetCase(payload));
      return true;
    }

    if (type === MessageType.HANDOFF_PREPARE) {
      respond(prepareHandoff(payload, sender));
      return true;
    }

    if (type === MessageType.HANDOFF_FOCUS_EXISTING_CASE) {
      respond(focusExistingUsersideCase(payload, sender));
      return true;
    }

    if (type === MessageType.HANDOFF_OPEN_TARGET) {
      respond(openHandoffTarget(payload, sender));
      return true;
    }

    if (type === MessageType.HANDOFF_CLAIM) {
      respond(claimHandoff(payload, sender));
      return true;
    }

    if (type === MessageType.HANDOFF_FOCUS_SOURCE) {
      respond(focusHandoffSource(payload));
      return true;
    }

    if (type === MessageType.GUIDE_MARK_STEP) {
      respond(markGuideStep(payload, sender));
      return true;
    }

    if (type === MessageType.LOCATOR_APPLY_OBSERVATION) {
      respond(applyLocatorObservation(payload, sender));
      return true;
    }

    if (type === MessageType.POLL_ATTEMPT_UPDATE) {
      respond(updatePollAttempt(payload, sender));
      return true;
    }

    if (type === MessageType.JUNIPER_PREFETCH_STATUS) {
      respond(updateJuniperPrefetchStatus(payload, sender));
      return true;
    }

    if (type === MessageType.FETCH_REQUEST) {
      respond(handleFetch(payload));
      return true;
    }

    if (type === MessageType.CALL_REGISTRATION_FORM) {
      respond(loadCallRegistrationForm(payload, sender));
      return true;
    }

    if (type === MessageType.PBX_RECENT_CALLS_OBSERVED) {
      respond(observePbxRecentCalls(payload, sender));
      return true;
    }

    if (type === MessageType.PBX_RECENT_CALLS_QUERY) {
      respond(queryPbxRecentCalls(payload, sender));
      return true;
    }

    if (type === MessageType.PBX_CALL_BIND) {
      respond(bindPbxCall(payload, sender));
      return true;
    }

    if (type === MessageType.CALL_REGISTRATION_SUBMIT) {
      respond(submitCallRegistration(payload, sender));
      return true;
    }

    if (type === MessageType.PBX_CALL_SUBMISSION_FINALIZE) {
      respond(finalizePbxCallSubmission(payload, sender));
      return true;
    }

    return false;
  }
);

async function finalizeLocalUpdate(details) {
  if (details?.reason !== 'update') return { handled: false };
  const stored = await chrome.storage.local.get(LOCAL_UPDATE_META_KEY);
  const meta = stored?.[LOCAL_UPDATE_META_KEY];
  if (!meta || String(meta.toVersion || '') !== VERSION) return { handled: false };

  await chrome.storage.local.remove(LOCAL_UPDATE_META_KEY);
  if (!meta.reloadMatchingTabs) {
    console.info('[SIMNET Workbench] local update applied; work tabs left untouched', VERSION);
    return { handled: true, reloadedTabs: 0 };
  }

  const urls = [
    'https://userside.simnet.kiev.ua/*',
    'https://admin.simnet.kiev.ua/*',
    'https://admin.looknet.kiev.ua/*',
    'https://pbx.simnet.kiev.ua/*'
  ];
  const tabs = await chrome.tabs.query({ url: urls });
  const targets = tabs.filter(tab => Number.isInteger(tab?.id));
  await Promise.allSettled(
    targets.map(tab => chrome.tabs.reload(tab.id, { bypassCache: true }))
  );
  console.info('[SIMNET Workbench] local update applied; work tabs reloaded', VERSION, targets.length);
  return { handled: true, reloadedTabs: targets.length };
}

chrome.runtime.onInstalled.addListener(
  async details => {
    const state = await readState();
    state.version = VERSION;
    await writeState(state);
    await reconcileOpenTabs().catch(error => {
      console.warn('[SIMNET Workbench] tab registry reconciliation failed', error);
    });
    await readDiagnostics().then(updateDiagnosticsBadge).catch(error => {
      console.warn('[SIMNET Workbench] diagnostics badge restore failed', error);
    });
    await finalizeLocalUpdate(details).catch(error => {
      console.warn('[SIMNET Workbench] local updater finalization failed', error);
    });

    console.info(
      '[SIMNET Workbench]',
      VERSION,
      details.reason
    );
  }
);

chrome.runtime.onStartup?.addListener(() => {
  void reconcileOpenTabs().catch(error => {
    console.warn('[SIMNET Workbench] startup tab reconciliation failed', error);
  });
  void readDiagnostics().then(updateDiagnosticsBadge).catch(error => {
    console.warn('[SIMNET Workbench] startup diagnostics badge restore failed', error);
  });
});

function handleTabRemoved(tabId) {
  return cleanupClosedTab(tabId).catch(error => {
    console.warn('[SIMNET Workbench] tab cleanup failed', tabId, error);
    return {
      changed: false,
      tabId: Number(tabId),
      error: error?.message || String(error)
    };
  });
}

chrome.tabs?.onRemoved?.addListener(handleTabRemoved);

globalThis.__SIMNET_WB_TEST_API__ = Object.freeze({
  callCustomerId,
  callIpv4,
  pbxRecordId,
  pbxCallKey,
  normalizedPhone,
  normalizedContract,
  normalizePbxCall,
  prunePbxTelephony,
  pbxCallMatch,
  pbxCallIdentitySignature,
  ensurePbxTelephonyShape,
  observePbxRecentCalls,
  queryPbxRecentCalls,
  bindPbxCall,
  validateCallSubmissionContext,
  claimPbxCallSubmission,
  finalizePbxCallSubmission,
  customerIdFromCallUrl,
  exactCustomerIdFromSearch,
  callRegistrationParams,
  trimCaseJournal,
  emptyCase,
  ensureCaseShape,
  finalizeCaseCommits,
  envelopeFor,
  contextForEnvelope,
  storeViewContext,
  latestViewContextForEnvelopeTab,
  closeTmcWritebackAfterTechnicalExit,
  cleanupClosedTabState,
  cleanupClosedTab,
  reconcileOpenTabs,
  handleTabRemoved,
  advancePollAttemptFromContext,
  durableSnapshotFacts,
  durableSnapshotValue,
  confirmedOltSnapshotFromContext,
  commitConfirmedOltSnapshot,
  mergeFacts,
  resolveCaseId,
  shouldContinueTabCase,
  updateRouteCheckpoint,
  ensureWorkflowShape,
  tmcTechnicalExpectation,
  syncPonWritebackWorkflow,
  ensureOperatorTraceShape,
  ensureGuideShape,
  evaluateGuideExpectation,
  reconcileGuideProgress,
  diagnosticSnapshot,
  shouldCountObservation,
  validOltIp,
  validHandoffToken,
  attachHandoffToContext,
  findHandoffForContext,
  applyLocatorObservations,
  evaluateLocatorPolicy,
  locatorSnapshot,
  isBindingRejected,
  currentBillingBinding,
  LocatorObservationType,
  LocatorAction,
  LocatorTermination
});
