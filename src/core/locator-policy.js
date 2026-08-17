export const LocatorObservationType = Object.freeze({
  POLL_RESULT: 'POLL_RESULT',
  JUNIPER_SESSION: 'JUNIPER_SESSION',
  TMC_RESULT: 'TMC_RESULT',
  CUSTOMER_MACS: 'CUSTOMER_MACS',
  MAC_SEARCH_RESULT: 'MAC_SEARCH_RESULT',
  INTERFACE_CONFIRMATION: 'INTERFACE_CONFIRMATION',
  DEVICE_DETAILS: 'DEVICE_DETAILS',
  ETHERNET_ACCESS_POINT: 'ETHERNET_ACCESS_POINT',
  ETHERNET_DEVICE: 'ETHERNET_DEVICE',
  ETHERNET_FDB_RESULT: 'ETHERNET_FDB_RESULT',
  ETHERNET_PORT_ERRORS: 'ETHERNET_PORT_ERRORS',
  BILLING_OLT_SAVE_INTENT: 'BILLING_OLT_SAVE_INTENT',
  BILLING_OLT_SAVE_FAILED: 'BILLING_OLT_SAVE_FAILED',
  BILLING_OLT_SAVED: 'BILLING_OLT_SAVED'
});

export const LocatorAction = Object.freeze({
  CHECK_JUNIPER: 'check_juniper',
  OPEN_TECHNICAL: 'open_technical',
  POLL_CURRENT_BINDING: 'poll_current_binding',
  WAIT_POLL: 'wait_poll',
  RETRY_POLL: 'retry_poll',
  CHECK_TMC: 'check_tmc',
  SEARCH_MAC: 'search_mac',
  SEARCH_UPLINK_DOWNLINK: 'search_uplink_downlink',
  INSPECT_INTERFACE: 'inspect_interface',
  INSPECT_DEVICE: 'inspect_device',
  FILL_BILLING_OLT: 'fill_billing_olt',
  FILL_BILLING_TECHNICAL: 'fill_billing_technical',
  INSPECT_ONU_DETAILS: 'inspect_onu_details',
  POLL_CANDIDATE: 'poll_candidate',
  COMPLETE_CONFIRMED: 'complete_confirmed',
  COMPLETE_NOT_FOUND: 'complete_not_found',
  RESOLVE_CONFLICT: 'resolve_conflict',
  MANUAL_REVIEW: 'manual_review',
  SWITCH_PORT: 'switch_port',
  CHECK_ETHERNET_FDB: 'check_ethernet_fdb',
  CHECK_ETHERNET_ERRORS: 'check_ethernet_errors',
  ETHERNET_SUMMARY: 'ethernet_summary',
  WAIT_CONTEXT: 'wait_context'
});

export const LocatorTermination = Object.freeze({
  CONFIRMED: 'confirmed',
  NOT_FOUND: 'not_found',
  INCONCLUSIVE: 'inconclusive',
  BLOCKED: 'blocked',
  MANUAL_REVIEW: 'manual_review'
});

const MAX_ATTEMPTS = 120;
const MAX_EVIDENCE = 160;
const MAX_CANDIDATES = 40;
const POLL_PARTIAL_GRACE_MS = 3000;
const TMC_UNCONFIRMED_RESULTS = new Set([
  'missing',
  'identity_mismatch',
  'identity_incomplete',
  'ambiguous'
]);

function nowIso() {
  return new Date().toISOString();
}

export function pollPartialStable(locator, now = Date.now()) {
  const poll = locator?.sourceStatus?.poll || null;
  if (!poll || poll.result !== 'partial') return false;
  const started = Date.parse(poll.partialSinceAt || poll.updatedAt || '');
  if (!Number.isFinite(started)) return false;
  return Math.max(0, Number(now || Date.now()) - started) >= Number(poll.partialGraceMs || POLL_PARTIAL_GRACE_MS);
}

function comparable(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isLikelyPonOltCandidate(candidate) {
  const name = comparable(candidate?.oltName || candidate?.deviceName || '');
  const iface = comparable(candidate?.interface || '');
  if (!name && !iface) return false;

  // MAC history often lands first on an aggregation/access switch. That is a useful
  // topology hop, but it is not an OLT and must never be written into Billing as one.
  const obviousTransit = /(?:arista|dcs-|cisco|juniper|mikrotik|port-channel|etherchannel|switch)/i.test(`${name} ${iface}`);
  if (obviousTransit) return false;

  const oltIdentity = /(?:\bolt\b|huawei\s+ma\d{3,5}|bdcom|gcom|zte|c-data|v-sol|fiberhome)/i.test(name);
  const ponInterface = /\b(?:epon|gpon|xpon)\b/i.test(`${name} ${iface}`);
  return Boolean(oltIdentity && (ponInterface || /\bolt\b|huawei\s+ma\d{3,5}/i.test(name)));
}

function compact(value, max = 260) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max
    ? `${text.slice(0, max)}…`
    : text;
}

function valueOf(fact) {
  return fact && typeof fact === 'object' && 'value' in fact
    ? fact.value
    : fact;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function pollBindingFromCase(caseData, details = {}) {
  const current = currentBillingBinding(caseData) || {};
  return {
    ...current,
    ...details,
    oltName: firstNonEmpty(details.oltName, current.oltName),
    oltIp: firstNonEmpty(details.oltIp, current.oltIp),
    onuMac: firstNonEmpty(details.onuMac, current.onuMac),
    onuSerial: firstNonEmpty(details.onuSerial, current.onuSerial),
    subscriberMac: firstNonEmpty(details.subscriberMac, current.subscriberMac),
    pollAction: firstNonEmpty(details.pollAction, current.pollAction),
    technology: firstNonEmpty(details.technology, current.technology)
  };
}

function normalizeMac(value) {
  const hex = String(value || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
  return hex.length === 12 ? hex : '';
}

function normalizeSerial(value) {
  return String(value || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();
}

/** Extract IPv4 from free-form OLT labels like "V_Pokotilova-7-2-GPON (172.16.13.185)". */
function extractOltIp(value) {
  const text = String(value || '');
  const match = text.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return match ? match[1] : '';
}

/**
 * OLT identity match prioritises canonical IP over display labels.
 * Billing often stores a site-specific label while TMC stores vendor model + IP.
 */
function sameOltIdentity(billing, tmc) {
  const billingIp = comparable(billing.oltIp || extractOltIp(billing.oltName));
  const tmcIp = comparable(tmc.oltIp || extractOltIp(tmc.oltName));
  if (billingIp && tmcIp) return billingIp === tmcIp;

  const bName = comparable(billing.oltName);
  const tName = comparable(tmc.oltName);
  if (!bName || !tName) return false;
  if (bName === tName) return true;
  if (bName.includes(tName) || tName.includes(bName)) return true;
  // Shared vendor token (e.g. BDCOM) alone is not enough without IP; require a stronger token.
  const strongTokens = ['gp3600', 'ma5800', 'ma5600', 'gpon', 'epon'];
  for (const token of strongTokens) {
    if (bName.includes(token) && tName.includes(token)) return true;
  }
  return false;
}

function technologyFromName(name) {
  const text = String(name || '');
  if (/huawei/i.test(text)) {
    return { type: 'Huawei', action: '313' };
  }
  // Billing uses GCOM, G-COM and G COM. The explicit vendor suffix must win
  // over an earlier generic GPON token in the same OLT display name.
  if (/\bg[\s_-]*com\b/i.test(text)) {
    return { type: 'GCOM', action: '312' };
  }
  if (/\bgpon\b/i.test(text)) {
    return { type: 'GPON', action: '311' };
  }
  if (/\bepon\b|bdcom\s+olt\s+p36/i.test(text)) {
    return { type: 'EPON', action: '310' };
  }
  return { type: '', action: '' };
}

function technologyFromEvidence(name, interfaceName = '', explicit = '') {
  const iface = String(interfaceName || '');
  const declared = String(explicit || '');
  const label = String(name || '');

  // Poll adapter is selected by the actual OLT/vendor, not by the subscriber
  // access-port wording. A Huawei chassis can expose an EPON interface after a
  // network migration, but Billing must still use the Huawei poll section a=313.
  if (/huawei/i.test(label)) {
    return { type: 'Huawei', action: '313', derivedBy: 'olt-vendor' };
  }
  if (/\bG[\s_-]*COM\b/i.test(declared) || /\bG[\s_-]*COM\b/i.test(label)) {
    return { type: 'GCOM', action: '312', derivedBy: 'label' };
  }
  if (/\bEPON\b/i.test(iface) || /\bEPON\b/i.test(declared)) {
    return { type: 'EPON', action: '310', derivedBy: 'interface' };
  }
  if (/\bGPON\b/i.test(iface) || /\bGPON\b/i.test(declared)) {
    return { type: 'GPON', action: '311', derivedBy: 'interface' };
  }
  return { ...technologyFromName(`${declared} ${label}`), derivedBy: 'name' };
}

function technologyFromAction(action) {
  const key = String(action || '');
  if (key === '310') return { type: 'EPON', action: '310' };
  if (key === '311') return { type: 'GPON', action: '311' };
  if (key === '312') return { type: 'GCOM', action: '312' };
  if (key === '313') return { type: 'Huawei', action: '313' };
  return { type: '', action: '' };
}

function billingTechnology(caseData, billing = {}, locator = null) {
  const tmcDetails = locator?.sourceStatus?.tmc?.details || {};
  if (locator?.sourceStatus?.tmc?.result === 'found') {
    const tmcTech = technologyFromEvidence(
      tmcDetails.oltName || valueOf(caseData.pon?.tmcOltName) || '',
      tmcDetails.interface || valueOf(caseData.pon?.tmcPort) || '',
      tmcDetails.technology || ''
    );
    if (tmcTech.type) return tmcTech;
  }

  const byAction = technologyFromAction(valueOf(caseData.pon?.pollAction));
  if (byAction.type) return byAction;
  const explicit = String(valueOf(caseData.pon?.pollType) || '');
  const byEvidence = technologyFromEvidence(
    billing.oltName || '',
    valueOf(caseData.pon?.port) || '',
    explicit
  );
  return byEvidence.type ? byEvidence : { type: explicit, action: '' };
}

function tmcSerialIsSourceOptional(caseData, tmc = {}) {
  const flow = caseData?.workflow?.ponAcquisition || {};
  if (!flow.tmcShownAt) return false;

  const hasOlt = Boolean(String(tmc.oltName || '').trim() || String(tmc.oltIp || '').trim());
  const hasMac = Boolean(normalizeMac(tmc.onuMac));
  const hasSerial = Boolean(normalizeSerial(tmc.onuSerial));

  // Source-limited contract: once the operator has actually reached TMC, fields
  // absent from that real TMC block are not manufactured as new obligations.
  // If TMC confirms OLT + ONU MAC but exposes no serial, Serial is optional for
  // this route and must not block Billing readiness or force a writeback.
  return hasOlt && hasMac && !hasSerial;
}

function requiredTechnicalFields(caseData, billing = {}, locator = null) {
  if (comparable(valueOf(caseData.network?.connectionFamily)) === 'ethernet') {
    return [];
  }

  const tmcDetails = locator?.sourceStatus?.tmc?.details || {};
  const tmc = {
    oltName: String(valueOf(caseData.pon?.tmcOltName) || tmcDetails.oltName || ''),
    oltIp: String(valueOf(caseData.pon?.tmcOltIp) || tmcDetails.oltIp || ''),
    onuSerial: String(valueOf(caseData.pon?.tmcOnuSerial) || tmcDetails.onuSerial || ''),
    onuMac: String(valueOf(caseData.pon?.tmcOnuMac) || tmcDetails.onuMac || '')
  };
  if (locator?.sourceStatus?.tmc?.result === 'found' && tmcSerialIsSourceOptional(caseData, tmc)) {
    return ['olt', 'onuMac'];
  }

  const technology = billingTechnology(caseData, billing, locator);
  const type = comparable(technology.type);
  if (type === 'epon') return ['olt', 'onuMac'];
  if (['gpon', 'gcom', 'huawei'].includes(type)) return ['olt', 'onuSerial', 'onuMac'];
  // Unknown PON stays conservative until the OLT/technology is resolved.
  return ['olt', 'onuSerial', 'onuMac'];
}

function billingTechnicalState(caseData, locator = null) {
  const tmcStatus = locator?.sourceStatus?.tmc || null;
  const tmcDetails = tmcStatus?.details || {};
  const billing = {
    oltName: String(valueOf(caseData.pon?.oltName) || ''),
    oltIp: String(valueOf(caseData.pon?.oltIp) || ''),
    onuSerial: String(valueOf(caseData.pon?.onuSerial) || ''),
    onuMac: String(valueOf(caseData.pon?.onuMac) || ''),
    subscriberMac: String(valueOf(caseData.network?.mac) || ''),
    routerMac: String(valueOf(caseData.network?.routerMac) || '')
  };
  const tmc = {
    oltName: String(valueOf(caseData.pon?.tmcOltName) || tmcDetails.oltName || ''),
    oltIp: String(valueOf(caseData.pon?.tmcOltIp) || tmcDetails.oltIp || ''),
    onuSerial: String(valueOf(caseData.pon?.tmcOnuSerial) || tmcDetails.onuSerial || ''),
    onuMac: String(valueOf(caseData.pon?.tmcOnuMac) || tmcDetails.onuMac || '')
  };
  const requiredFields = requiredTechnicalFields(caseData, billing, locator);
  const missingBilling = [];
  if (requiredFields.includes('olt') && !billing.oltName && !billing.oltIp) missingBilling.push('olt');
  if (requiredFields.includes('onuSerial') && !normalizeSerial(billing.onuSerial)) missingBilling.push('onuSerial');
  if (requiredFields.includes('onuMac') && !normalizeMac(billing.onuMac)) missingBilling.push('onuMac');

  const conflicts = [];
  if ((billing.oltName || billing.oltIp) && (tmc.oltName || tmc.oltIp)) {
    if (!sameOltIdentity(billing, tmc)) {
      conflicts.push({ field: 'olt', billing: billing.oltName || billing.oltIp, tmc: tmc.oltName || tmc.oltIp });
    }
  }
  if (normalizeSerial(billing.onuSerial) && normalizeSerial(tmc.onuSerial)
      && normalizeSerial(billing.onuSerial) !== normalizeSerial(tmc.onuSerial)) {
    conflicts.push({ field: 'onuSerial', billing: billing.onuSerial, tmc: tmc.onuSerial });
  }
  if (normalizeMac(billing.onuMac) && normalizeMac(tmc.onuMac)
      && normalizeMac(billing.onuMac) !== normalizeMac(tmc.onuMac)) {
    conflicts.push({ field: 'onuMac', billing: billing.onuMac, tmc: tmc.onuMac });
  }

  const effective = {
    oltName: billing.oltName || tmc.oltName,
    oltIp: billing.oltIp || tmc.oltIp,
    onuSerial: billing.onuSerial || tmc.onuSerial,
    onuMac: billing.onuMac || tmc.onuMac
  };
  const remainingAfterTmc = [];
  if (requiredFields.includes('olt') && !effective.oltName && !effective.oltIp) remainingAfterTmc.push('olt');
  if (requiredFields.includes('onuSerial') && !normalizeSerial(effective.onuSerial)) remainingAfterTmc.push('onuSerial');
  if (requiredFields.includes('onuMac') && !normalizeMac(effective.onuMac)) remainingAfterTmc.push('onuMac');

  const identityConflicts = conflicts.filter(item => item.field === 'onuSerial' || item.field === 'onuMac');
  const correctionFields = [...new Set([
    ...missingBilling.filter(field => (
      field === 'olt' ? Boolean(tmc.oltName || tmc.oltIp)
        : field === 'onuSerial' ? Boolean(normalizeSerial(tmc.onuSerial))
          : Boolean(normalizeMac(tmc.onuMac))
    )),
    ...conflicts.filter(item => item.field === 'olt').map(item => item.field)
  ])];

  const customerMacs = locator?.sourceStatus?.customer_macs?.macs || [];
  const searchMacs = [];
  for (const raw of [billing.subscriberMac, billing.routerMac, ...customerMacs.map(item => item?.mac || '')]) {
    const mac = normalizeMac(raw);
    if (!mac || searchMacs.some(item => normalizeMac(item.mac) === mac)) continue;
    searchMacs.push({ mac: raw, normalized: mac });
  }

  return {
    billing,
    tmc,
    missingBilling,
    conflicts,
    identityConflicts,
    correctionFields,
    remainingAfterTmc,
    searchMacs,
    billingReadyCore: missingBilling.length === 0,
    hasBillingOnuMac: Boolean(normalizeMac(billing.onuMac)),
    requiredFields,
    technology: billingTechnology(caseData, billing, locator),
    tmcObserved: tmcStatus != null,
    tmcFound: tmcStatus?.result === 'found',
    expectedTechnical: {
      oltName: tmc.oltName,
      oltIp: tmc.oltIp,
      onuSerial: tmc.onuSerial,
      onuMac: tmc.onuMac
    }
  };
}

export function requiredTechnicalFieldsForCase(caseData) {
  const locator = ensureLocatorShape(caseData);
  return billingTechnicalState(caseData, locator).requiredFields;
}

function candidateTechnicalState(caseData, candidate) {
  const billing = billingTechnicalState(caseData).billing;
  const expected = {
    oltName: String(candidate?.oltName || ''),
    oltIp: String(candidate?.oltIp || ''),
    onuSerial: String(candidate?.onuSerial || ''),
    onuMac: String(candidate?.onuMac || '')
  };
  const fields = [];
  const billingHasOlt = Boolean(billing.oltName || billing.oltIp);
  const candidateHasOlt = Boolean(expected.oltName || expected.oltIp);
  if (candidateHasOlt) {
    const sameOlt = billingHasOlt && sameOltIdentity(billing, expected);
    if (!billingHasOlt || !sameOlt) fields.push('olt');
  }
  if (!normalizeSerial(billing.onuSerial) && normalizeSerial(expected.onuSerial)) fields.push('onuSerial');
  if (!normalizeMac(billing.onuMac) && normalizeMac(expected.onuMac)) fields.push('onuMac');

  const remainingMissing = [];
  const finalOlt = billingHasOlt || candidateHasOlt;
  const finalSerial = normalizeSerial(billing.onuSerial) || normalizeSerial(expected.onuSerial);
  const finalMac = normalizeMac(billing.onuMac) || normalizeMac(expected.onuMac);
  const candidateCase = {
    ...caseData,
    pon: {
      ...(caseData.pon || {}),
      pollType: candidate?.technology || valueOf(caseData.pon?.pollType) || '',
      pollAction: candidate?.pollAction || valueOf(caseData.pon?.pollAction) || '',
      oltName: candidate?.oltName || valueOf(caseData.pon?.oltName) || ''
    }
  };
  let requiredFields = requiredTechnicalFields(candidateCase, {
    ...billing,
    oltName: expected.oltName || billing.oltName,
    oltIp: expected.oltIp || billing.oltIp
  });
  if (
    candidate?.source === 'userside-tmc'
    && tmcSerialIsSourceOptional(caseData, expected)
  ) {
    requiredFields = ['olt', 'onuMac'];
  }
  if (requiredFields.includes('olt') && !finalOlt) remainingMissing.push('olt');
  if (requiredFields.includes('onuSerial') && !finalSerial) remainingMissing.push('onuSerial');
  if (requiredFields.includes('onuMac') && !finalMac) remainingMissing.push('onuMac');

  // Do not turn supplemental identity into a mandatory correction. For EPON,
  // for example, a Serial found in TMC is useful evidence but OLT + ONU MAC are
  // the route requirements; the operator must not be forced to fill GPON Serial.
  const actionableFields = [...new Set(fields)].filter(field => (
    field === 'olt' || requiredFields.includes(field)
  ));

  return { fields: actionableFields, remainingMissing, expectedTechnical: expected, requiredFields };
}

function bindingFingerprint(binding = {}) {
  const olt = comparable(binding.oltIp || binding.oltName || binding.deviceId);
  const onu = normalizeMac(binding.onuMac)
    || normalizeSerial(binding.onuSerial)
    || comparable(binding.interface)
    || comparable(binding.subscriberMac)
    || 'unknown-onu';
  const action = comparable(binding.pollAction || binding.technology || '');
  return [olt || 'unknown-olt', onu, action].join('|');
}

function candidateId(candidate = {}) {
  const device = comparable(candidate.deviceId || candidate.oltIp || candidate.oltName);
  const iface = comparable(candidate.interface || candidate.ifIndex || '');
  const identity = normalizeMac(candidate.onuMac)
    || normalizeSerial(candidate.onuSerial)
    || normalizeMac(candidate.subscriberMac)
    || 'unknown';
  return [device || 'unknown-device', iface || 'unknown-interface', identity].join('|');
}

function observationSignature(observation = {}) {
  const details = observation.details || observation.candidate || {};
  return [
    observation.type,
    observation.result,
    observation.method,
    observation.searchMode,
    bindingFingerprint({
      ...details,
      ...observation
    }),
    candidateId({
      ...details,
      ...observation
    }),
    comparable(observation.searchedMac),
    comparable(observation.pageKind)
  ].join('|');
}

function emptyLocator() {
  return {
    schemaVersion: 1,
    state: 'idle',
    attempts: [],
    evidence: [],
    candidates: [],
    hypotheses: [],
    sourceStatus: {},
    recommendation: {
      action: LocatorAction.WAIT_CONTEXT,
      ruleId: 'locator.wait-context',
      reason: 'Недостаточно данных для выбора ветки.',
      params: {}
    },
    termination: null,
    currentBinding: null,
    lastObservationAt: '',
    updatedAt: nowIso()
  };
}

export function ensureLocatorShape(caseData) {
  caseData.locator ||= emptyLocator();
  const locator = caseData.locator;
  locator.schemaVersion = 1;
  locator.state ||= 'idle';
  locator.attempts ||= [];
  locator.evidence ||= [];
  locator.candidates ||= [];
  locator.hypotheses ||= [];
  locator.sourceStatus ||= {};
  locator.recommendation ||= emptyLocator().recommendation;
  locator.termination = locator.termination || null;
  locator.currentBinding = locator.currentBinding || null;

  // v1.7.13 could reopen a case after a confirmed poll. Recover that terminal
  // latch on upgrade from the durable candidate/attempt history so an already
  // confirmed subscriber does not stay in `searching / wait_context`.
  if (!locator.termination) {
    const confirmedCandidate = locator.candidates.find(item => item?.status === 'direct_confirmed') || null;
    const confirmedAttempt = locator.attempts.find(item => (
      item?.type === LocatorObservationType.POLL_RESULT
      && item?.result === 'confirmed'
    )) || null;
    if (confirmedCandidate || confirmedAttempt) {
      locator.state = 'confirmed';
      locator.termination = {
        status: LocatorTermination.CONFIRMED,
        reason: 'direct_olt_poll_completed',
        pollCompleted: true,
        pollResponded: true,
        confirmedBy: ['onu_response'],
        identityAssessment: confirmedAttempt?.details?.identityAssessment || (confirmedAttempt?.details?.matchedBy?.length ? 'matched' : 'unverified'),
        identityMatchedBy: confirmedAttempt?.details?.matchedBy || [],
        identityConflicts: confirmedAttempt?.details?.identityConflicts || [],
        candidateId: confirmedCandidate?.id || '',
        completedAt: confirmedAttempt?.at || confirmedCandidate?.updatedAt || nowIso(),
        recovered: true
      };
    }
  }

  locator.updatedAt ||= nowIso();
  return locator;
}

export function currentBillingBinding(caseData) {
  const oltName = String(valueOf(caseData.pon?.oltName) || '');
  const oltIp = String(valueOf(caseData.pon?.oltIp) || '');
  const onuMac = String(valueOf(caseData.pon?.onuMac) || '');
  const onuSerial = String(valueOf(caseData.pon?.onuSerial) || '');
  const subscriberMac = String(valueOf(caseData.network?.mac) || '');
  const pollAction = String(valueOf(caseData.pon?.pollAction) || '');
  const technology = String(valueOf(caseData.pon?.pollType) || '');

  if (!oltName && !oltIp) return null;

  return {
    source: 'billing',
    oltName,
    oltIp,
    onuMac,
    onuSerial,
    subscriberMac,
    pollAction,
    technology,
    fingerprint: bindingFingerprint({
      oltName,
      oltIp,
      onuMac,
      onuSerial,
      subscriberMac,
      pollAction,
      technology
    })
  };
}

function setSourceStatus(locator, key, patch) {
  locator.sourceStatus[key] = {
    ...(locator.sourceStatus[key] || {}),
    ...patch,
    updatedAt: nowIso()
  };
}

function upsertCandidate(locator, candidate = {}, evidence = {}) {
  const normalized = {
    id: candidate.id || candidateId(candidate),
    source: candidate.source || evidence.source || 'unknown',
    status: candidate.status || 'candidate',
    oltName: compact(candidate.oltName || '', 220),
    oltIp: compact(candidate.oltIp || '', 80),
    deviceId: compact(candidate.deviceId || '', 80),
    interface: compact(candidate.interface || '', 120),
    ifIndex: compact(candidate.ifIndex || '', 80),
    vlan: compact(candidate.vlan || '', 40),
    technology: compact(candidate.technology || '', 40),
    pollAction: compact(candidate.pollAction || '', 20),
    onuMac: normalizeMac(candidate.onuMac),
    onuSerial: normalizeSerial(candidate.onuSerial),
    subscriberMac: normalizeMac(candidate.subscriberMac),
    customerId: compact(candidate.customerId || '', 80),
    login: compact(candidate.login || '', 80),
    matchedCurrentSubscriber: Boolean(candidate.matchedCurrentSubscriber),
    confidence: Number(candidate.confidence || 0.6),
    evidence: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const index = locator.candidates.findIndex(item => item.id === normalized.id);
  const old = index >= 0 ? locator.candidates[index] : null;
  const merged = {
    ...(old || {}),
    ...Object.fromEntries(
      Object.entries(normalized).filter(([, value]) => (
        value !== ''
        && value !== false
        && value != null
        && !(Array.isArray(value) && value.length === 0)
      ))
    ),
    evidence: [
      ...(old?.evidence || []),
      ...(evidence.signature ? [evidence.signature] : [])
    ].slice(-30),
    updatedAt: nowIso()
  };

  if (old?.status === 'direct_confirmed') {
    merged.status = 'direct_confirmed';
  } else if (candidate.status) {
    merged.status = candidate.status;
  }

  if (index >= 0) {
    locator.candidates[index] = merged;
  } else {
    locator.candidates.unshift(merged);
    locator.candidates = locator.candidates.slice(0, MAX_CANDIDATES);
  }

  return merged;
}

function findCandidate(locator, details = {}) {
  const id = details.id || candidateId(details);
  return locator.candidates.find(item => item.id === id)
    || locator.candidates.find(item => (
      details.deviceId
      && item.deviceId === String(details.deviceId)
      && (!details.interface || comparable(item.interface) === comparable(details.interface))
    ))
    || locator.candidates.find(item => (
      details.oltIp
      && item.oltIp === String(details.oltIp)
      && (!details.interface || comparable(item.interface) === comparable(details.interface))
    ))
    || null;
}

function storeEvidence(locator, observation, context = {}) {
  const signature = observation.signature || observationSignature(observation);
  const existing = locator.evidence.find(item => item.signature === signature);
  if (existing) {
    // A fact may first be seen outside the active route. If the operator later
    // revisits it while that source is actually requested, promote the same
    // evidence instead of creating a duplicate or losing it to dedupe.
    if (existing.passive && !observation.passive && !observation.passiveAfterTermination) {
      existing.passive = false;
      existing.promotedAt = nowIso();
      return existing;
    }
    return null;
  }

  const entry = {
    signature,
    at: nowIso(),
    type: observation.type,
    result: observation.result || '',
    method: observation.method || '',
    source: observation.source || context.system || '',
    pageKind: observation.pageKind || context.pageKind || '',
    summary: compact(observation.summary || observation.reason || '', 320),
    details: observation.details || observation.candidate || null,
    passive: Boolean(observation.passiveAfterTermination || observation.passive),
    passiveReason: observation.passiveReason || '',
    routeRelation: observation.routeRelation || ''
  };

  locator.evidence.unshift(entry);
  locator.evidence = locator.evidence.slice(0, MAX_EVIDENCE);
  locator.lastObservationAt = entry.at;
  return entry;
}

function storeAttempt(locator, observation, context = {}) {
  const signature = observation.signature || observationSignature(observation);
  if (locator.attempts.some(item => item.signature === signature)) {
    return null;
  }

  const entry = {
    signature,
    at: nowIso(),
    type: observation.type,
    result: observation.result || '',
    method: observation.method || '',
    source: observation.source || context.system || '',
    pageKind: observation.pageKind || context.pageKind || '',
    searchMode: observation.searchMode || '',
    bindingFingerprint: observation.bindingFingerprint || bindingFingerprint({
      ...(observation.details || {}),
      ...observation
    }),
    summary: compact(observation.summary || observation.reason || '', 320),
    details: observation.details || observation.candidate || null
  };

  locator.attempts.unshift(entry);
  locator.attempts = locator.attempts.slice(0, MAX_ATTEMPTS);
  return entry;
}

function markHypothesis(locator, hypothesis) {
  const fingerprint = hypothesis.fingerprint || bindingFingerprint(hypothesis);
  const index = locator.hypotheses.findIndex(item => item.fingerprint === fingerprint);
  const merged = {
    ...(index >= 0 ? locator.hypotheses[index] : {}),
    ...hypothesis,
    fingerprint,
    updatedAt: nowIso()
  };

  if (index >= 0) locator.hypotheses[index] = merged;
  else locator.hypotheses.unshift(merged);

  locator.hypotheses = locator.hypotheses.slice(0, 50);
  return merged;
}

function processPollResult(caseData, locator, observation, evidence) {
  const details = observation.details || {};
  const fingerprint = observation.bindingFingerprint || bindingFingerprint({
    ...details,
    ...observation
  });
  const result = observation.result || 'unknown';

  const hypothesis = markHypothesis(locator, {
    source: details.source || 'billing-poll',
    status: result === 'confirmed'
      ? 'direct_confirmed'
      : result === 'not_found'
        ? 'rejected'
        : 'unconfirmed',
    rejectionScope: result === 'not_found'
      ? 'binding'
      : '',
    reason: result,
    oltName: details.oltName || '',
    oltIp: details.oltIp || '',
    onuMac: details.onuMac || '',
    onuSerial: details.onuSerial || '',
    subscriberMac: details.subscriberMac || '',
    interface: details.interface || '',
    pollAction: details.pollAction || '',
    technology: details.technology || '',
    fingerprint,
    evidence: evidence?.signature || ''
  });

  const previousPoll = locator.sourceStatus.poll || {};
  const samePartialEpisode = Boolean(
    result === 'partial'
    && previousPoll.result === 'partial'
    && previousPoll.fingerprint === fingerprint
    && previousPoll.partialSinceAt
  );
  setSourceStatus(locator, 'poll', {
    result,
    fingerprint,
    details,
    count: Number(previousPoll.count || 0) + 1,
    partialSinceAt: result === 'partial'
      ? (samePartialEpisode ? previousPoll.partialSinceAt : nowIso())
      : '',
    partialGraceMs: POLL_PARTIAL_GRACE_MS
  });

  if (result === 'confirmed') {
    const pollBinding = pollBindingFromCase(caseData, details);
    const identityMatchedBy = observation.matchedBy || details.matchedBy || [];
    const identityConflicts = Array.isArray(details.identityConflicts)
      ? details.identityConflicts
      : [];
    const identityAssessment = details.identityAssessment
      || (identityConflicts.length ? 'mismatch' : identityMatchedBy.length ? 'matched' : 'unverified');

    const candidate = upsertCandidate(locator, {
      ...pollBinding,
      status: 'direct_confirmed',
      source: 'direct-olt-poll',
      confidence: 1,
      // A completed poll is not the same thing as an identity match.  Keep the
      // identity flag truthful while still closing the diagnostic route.
      matchedCurrentSubscriber: identityAssessment === 'matched'
    }, evidence || {});
    candidate.matchedCurrentSubscriber = identityAssessment === 'matched';

    locator.state = 'confirmed';
    locator.termination = {
      status: LocatorTermination.CONFIRMED,
      reason: 'direct_olt_poll_completed',
      pollCompleted: true,
      pollResponded: details.pollResponded !== false,
      confirmedBy: ['onu_response'],
      identityAssessment,
      identityMatchedBy,
      identityConflicts,
      expected: details.expected || null,
      observed: details.observed || null,
      candidateId: candidate.id,
      completedAt: nowIso()
    };
    hypothesis.status = 'direct_confirmed';
    hypothesis.reason = 'poll_completed';
    return;
  }

  if (result === 'conflict') {
    locator.state = 'inconclusive';
    locator.termination = {
      status: LocatorTermination.INCONCLUSIVE,
      reason: 'poll_identity_conflict',
      expected: details.expected || null,
      observed: details.observed || null,
      completedAt: nowIso()
    };
    return;
  }

  if (result === 'not_found') {
    // Reject only this OLT + ONU/subscriber binding. The OLT itself may
    // become valid later with other identifiers or another interface.
    locator.state = 'searching';
    locator.termination = null;
    return;
  }

  if (['timeout', 'olt_unreachable', 'parser_error'].includes(result)) {
    locator.state = 'blocked';
    locator.termination = null;
    return;
  }

  if (result === 'pending') {
    locator.state = 'polling';
    locator.termination = null;
  }
}

function processTmcResult(locator, observation, evidence) {
  const details = observation.details || observation.candidate || {};
  const result = observation.result || 'unknown';
  const nested = details.bestObserved || {};
  const candidateDetails = (
    details.oltName || details.oltIp
      ? details
      : nested
  );
  const hasOlt = Boolean(
    candidateDetails.oltName || candidateDetails.oltIp
  );

  setSourceStatus(locator, 'tmc', {
    result: hasOlt ? 'found' : result,
    observedResult: result,
    details: candidateDetails,
    identityCheck: details.identityCheck || null
  });

  if (hasOlt) {
    const tech = technologyFromEvidence(candidateDetails.oltName || '', candidateDetails.interface || '', candidateDetails.technology || '');
    upsertCandidate(locator, {
      ...candidateDetails,
      source: 'userside-tmc',
      status: 'candidate',
      technology: candidateDetails.technology || tech.type,
      pollAction: candidateDetails.pollAction || tech.action,
      confidence: Number(candidateDetails.confidence || 0.9)
    }, evidence || {});
    locator.state = 'candidate_found';
    locator.termination = null;
  } else if (TMC_UNCONFIRMED_RESULTS.has(result)) {
    locator.state = 'searching';
    locator.termination = null;
  }
}

function processCustomerMacs(locator, observation) {
  const details = observation.details || {};
  const macs = Array.isArray(details.macs) ? details.macs : [];
  setSourceStatus(locator, 'customer_macs', {
    result: macs.length ? 'found' : 'missing',
    macs
  });
}

function processMacSearch(locator, observation, evidence) {
  const result = observation.result || 'unknown';
  const searchMode = observation.searchMode === 'uplink_downlink'
    ? 'mac_topology'
    : 'mac_direct';
  const details = observation.details || {};
  const candidates = Array.isArray(details.candidates)
    ? details.candidates
    : (observation.candidate ? [observation.candidate] : []);

  setSourceStatus(locator, searchMode, {
    result,
    searchedMac: observation.searchedMac || details.searchedMac || '',
    candidateCount: candidates.length
  });

  for (const candidate of candidates) {
    const tech = technologyFromName(candidate.oltName || '');
    upsertCandidate(locator, {
      ...candidate,
      source: searchMode,
      status: candidate.matchedCurrentSubscriber
        ? 'candidate'
        : 'weak_candidate',
      technology: candidate.technology || tech.type,
      pollAction: candidate.pollAction || tech.action,
      confidence: Number(candidate.confidence || (
        candidate.matchedCurrentSubscriber ? 0.85 : 0.62
      ))
    }, evidence || {});
  }

  locator.state = candidates.length
    ? 'candidate_found'
    : 'searching';
  locator.termination = null;
}

function processInterfaceConfirmation(locator, observation, evidence) {
  const details = observation.details || observation.candidate || {};
  const result = observation.result || 'unknown';

  setSourceStatus(locator, 'interface', {
    result,
    details
  });

  if (result === 'confirmed') {
    const existing = findCandidate(locator, details);
    const candidate = upsertCandidate(locator, {
      ...(existing || {}),
      ...details,
      source: details.source || 'interface-mac-list',
      status: 'interface_confirmed',
      matchedCurrentSubscriber: true,
      confidence: Math.max(Number(existing?.confidence || 0), 0.94)
    }, evidence || {});
    locator.state = 'interface_confirmed';
    locator.termination = null;
    return candidate;
  }

  if (result === 'not_found') {
    locator.state = 'searching';
  }
  return null;
}

function processDeviceDetails(locator, observation, evidence) {
  const details = observation.details || observation.candidate || {};
  const tech = technologyFromName(
    `${details.oltName || ''} ${details.systemName || ''} ${details.model || ''}`
  );
  const candidate = findCandidate(locator, details);

  const enriched = upsertCandidate(locator, {
    ...(candidate || {}),
    ...details,
    source: details.source || candidate?.source || 'userside-device',
    status: candidate?.status || 'candidate',
    technology: details.technology || candidate?.technology || tech.type,
    pollAction: details.pollAction || candidate?.pollAction || tech.action,
    confidence: Math.max(Number(candidate?.confidence || 0), 0.9)
  }, evidence || {});

  setSourceStatus(locator, 'device_details', {
    result: enriched.oltIp || enriched.oltName ? 'found' : 'partial',
    candidateId: enriched.id
  });
  locator.state = enriched.status === 'interface_confirmed'
    ? 'interface_confirmed'
    : 'candidate_found';
  locator.termination = null;
}

function processEthernetEvidence(locator, key, observation) {
  const details = observation.details || {};
  const result = observation.result || 'unknown';
  setSourceStatus(locator, key, {
    result,
    details,
    summary: compact(observation.summary || '', 420),
    method: observation.method || ''
  });
  locator.state = key === 'ethernet_errors'
    ? 'ethernet_checked'
    : key === 'ethernet_fdb'
      ? 'ethernet_fdb_checked'
      : key === 'ethernet_device'
        ? 'ethernet_switch_opened'
        : 'ethernet_access_confirmed';
  locator.termination = null;
}

function processJuniperSession(locator, observation) {
  const details = observation.details || {};
  const result = observation.result || details.status || 'unknown';
  setSourceStatus(locator, 'juniper', {
    result,
    details,
    summary: compact(observation.summary || '', 360),
    method: observation.method || '',
    readOnly: true
  });
  locator.state = 'juniper_checked';
  locator.termination = null;
}

function processBillingOltSaveIntent(locator, observation) {
  const details = observation.details || {};
  setSourceStatus(locator, 'billing_save_intent', {
    result: 'intent',
    details,
    sourceDocumentId: details.sourceDocumentId || ''
  });
  locator.state = 'saving_candidate';
  locator.termination = null;
}

function processBillingOltSaveFailed(locator, observation) {
  const details = observation.details || {};
  setSourceStatus(locator, 'billing_save_intent', {
    result: 'failed',
    details,
    failureReason: observation.reason || 'saved_value_mismatch'
  });
  locator.state = 'candidate_found';
  locator.termination = null;
}

function processBillingOltSaved(locator, observation, evidence) {
  const details = observation.details || {};
  setSourceStatus(locator, 'billing_saved', {
    result: 'saved',
    details
  });
  if (locator.sourceStatus.billing_save_intent) {
    locator.sourceStatus.billing_save_intent.result = 'confirmed';
    locator.sourceStatus.billing_save_intent.confirmedAt = nowIso();
  }
  const candidate = findCandidate(locator, details);
  if (candidate) {
    const nameResolved = details.resolvedBy === 'billing_olt_name';
    upsertCandidate(locator, {
      ...candidate,
      ...details,
      status: (candidate.status === 'interface_confirmed' || nameResolved)
        ? 'billing_ready'
        : candidate.status,
      confidence: Math.max(Number(candidate.confidence || 0), nameResolved ? 0.95 : 0.92)
    }, evidence || {});
  }
  locator.state = 'ready_to_poll';
  locator.termination = null;
}

export function applyLocatorObservations(caseData, observations = [], context = {}) {
  const locator = ensureLocatorShape(caseData);
  const applied = [];

  for (const raw of observations || []) {
    if (!raw?.type) continue;
    const observation = {
      ...raw,
      pageKind: raw.pageKind || context.pageKind || '',
      source: raw.source || context.system || ''
    };

    // Defense in depth: no caller can turn a click/tab/render into a confirmed
    // ONU poll merely by sending result=confirmed. A real confirmation must carry
    // the request/response guards from the Billing adapter and must be on-route.
    if (
      observation.type === LocatorObservationType.POLL_RESULT
      && observation.result === 'confirmed'
    ) {
      const details = observation.details || {};
      const validConfirmedPoll = Boolean(
        details.pollCompleted === true
        && details.pollResponded === true
        && details.requestObserved === true
        && details.wrongPollTab !== true
        && details.uiStable !== false
        && (!observation.routeRelation || observation.routeRelation === 'on_route')
      );
      if (!validConfirmedPoll) {
        observation.result = 'unknown';
        observation.passive = true;
        observation.passiveReason = observation.passiveReason || 'invalid-poll-confirmation';
      }
    }

    if (observation.routeRelation && observation.routeRelation !== 'on_route') {
      observation.passive = true;
      observation.passiveReason ||= `route-${observation.routeRelation}`;
    }

    observation.signature ||= observationSignature(observation);

    const confirmedLatched = locator.termination?.status === LocatorTermination.CONFIRMED;
    if (confirmedLatched && !(
      observation.type === LocatorObservationType.POLL_RESULT
      && observation.result === 'confirmed'
    )) {
      observation.passiveAfterTermination = true;
    }

    const evidence = storeEvidence(locator, observation, context);
    if (!evidence) continue;
    const isPassive = Boolean(observation.passiveAfterTermination || observation.passive);
    const attempt = isPassive ? null : storeAttempt(locator, observation, context);

    // Passive discovery is evidence memory only. It cannot move the route until
    // the operator revisits the source while that source is actually requested.
    if (isPassive) {
      applied.push({ observation, evidence, attempt, passive: true });
      continue;
    }

    switch (observation.type) {
      case LocatorObservationType.POLL_RESULT:
        processPollResult(caseData, locator, observation, evidence);
        break;
      case LocatorObservationType.JUNIPER_SESSION:
        processJuniperSession(locator, observation);
        break;
      case LocatorObservationType.TMC_RESULT:
        processTmcResult(locator, observation, evidence);
        break;
      case LocatorObservationType.CUSTOMER_MACS:
        processCustomerMacs(locator, observation);
        break;
      case LocatorObservationType.MAC_SEARCH_RESULT:
        processMacSearch(locator, observation, evidence);
        break;
      case LocatorObservationType.INTERFACE_CONFIRMATION:
        processInterfaceConfirmation(locator, observation, evidence);
        break;
      case LocatorObservationType.DEVICE_DETAILS:
        processDeviceDetails(locator, observation, evidence);
        break;
      case LocatorObservationType.ETHERNET_ACCESS_POINT:
        processEthernetEvidence(locator, 'ethernet_access', observation);
        break;
      case LocatorObservationType.ETHERNET_DEVICE:
        processEthernetEvidence(locator, 'ethernet_device', observation);
        break;
      case LocatorObservationType.ETHERNET_FDB_RESULT:
        processEthernetEvidence(locator, 'ethernet_fdb', observation);
        break;
      case LocatorObservationType.ETHERNET_PORT_ERRORS:
        processEthernetEvidence(locator, 'ethernet_errors', observation);
        break;
      case LocatorObservationType.BILLING_OLT_SAVE_INTENT:
        processBillingOltSaveIntent(locator, observation);
        break;
      case LocatorObservationType.BILLING_OLT_SAVE_FAILED:
        processBillingOltSaveFailed(locator, observation);
        break;
      case LocatorObservationType.BILLING_OLT_SAVED:
        processBillingOltSaved(locator, observation, evidence);
        break;
      default:
        break;
    }

    applied.push({ observation, evidence, attempt });
  }

  locator.updatedAt = nowIso();
  return applied;
}

function latestPoll(locator) {
  return locator.attempts.find(item => item.type === LocatorObservationType.POLL_RESULT) || null;
}

function pollAttemptsFor(locator, fingerprint) {
  return locator.attempts.filter(item => (
    item.type === LocatorObservationType.POLL_RESULT
    && (!fingerprint || item.bindingFingerprint === fingerprint)
  ));
}

function bestCandidate(locator) {
  const rank = {
    direct_confirmed: 100,
    billing_ready: 90,
    interface_confirmed: 80,
    candidate: 60,
    weak_candidate: 30
  };
  return [...locator.candidates]
    .sort((a, b) => (
      (rank[b.status] || 0) - (rank[a.status] || 0)
      || Number(b.confidence || 0) - Number(a.confidence || 0)
    ))[0] || null;
}

function candidateMatchesBilling(candidate, binding) {
  if (!candidate || !binding) return false;
  const ipMatch = candidate.oltIp && binding.oltIp
    && comparable(candidate.oltIp) === comparable(binding.oltIp);
  const nameMatch = candidate.oltName && binding.oltName
    && comparable(candidate.oltName) === comparable(binding.oltName);
  const actionMatch = !candidate.pollAction || !binding.pollAction
    || candidate.pollAction === binding.pollAction;
  return Boolean((ipMatch || nameMatch) && actionMatch);
}

export function isBindingRejected(caseData, binding = null) {
  const locator = ensureLocatorShape(caseData);
  const target = binding || currentBillingBinding(caseData);
  if (!target) return false;
  const fingerprint = target.fingerprint || bindingFingerprint(target);
  return locator.hypotheses.some(item => (
    item.fingerprint === fingerprint
    && item.status === 'rejected'
  ));
}

function recommendation(action, ruleId, reason, params = {}) {
  return { action, ruleId, reason, params };
}

function allSearchSourcesExhausted(locator) {
  return (
    TMC_UNCONFIRMED_RESULTS.has(locator.sourceStatus.tmc?.result)
    && locator.sourceStatus.mac_direct?.result === 'not_found'
    && locator.sourceStatus.mac_topology?.result === 'not_found'
    && !locator.candidates.some(item => (
      ['candidate', 'interface_confirmed', 'billing_ready', 'direct_confirmed']
        .includes(item.status)
    ))
  );
}

function tmcWritebackDeclined(caseData) {
  const flow = caseData?.workflow?.ponAcquisition || {};
  return Boolean(
    flow.tmcWritebackDeclinedAt
    || String(flow.tmcWritebackLastStatus || '') === 'declined'
  );
}

function tmcWritebackScope(caseData) {
  const initial = Array.isArray(caseData?.route?.billingTechnicalInitiallyMissing)
    ? caseData.route.billingTechnicalInitiallyMissing
    : [];
  return [...new Set(initial.filter(field => ['olt', 'onuSerial', 'onuMac'].includes(field)))];
}

function scopedIdentityConflicts(caseData, technical) {
  const conflicts = Array.isArray(technical?.identityConflicts) ? technical.identityConflicts : [];
  const scope = tmcWritebackScope(caseData);
  // If TMC was opened specifically to fill missing Billing fields, unrelated
  // differences in already-populated fields are evidence only. They must not
  // hijack the route into a correction loop.
  if (scope.length) return conflicts.filter(item => scope.includes(item.field));
  return conflicts;
}

function declinedWritebackPollCandidate(caseData, candidate, technical) {
  if (!candidate) return null;
  const scope = tmcWritebackScope(caseData);
  const billing = technical?.billing || {};
  const useTmc = field => scope.includes(field);
  const hybrid = {
    ...candidate,
    source: 'tmc-writeback-declined',
    oltName: useTmc('olt') ? candidate.oltName : (billing.oltName || candidate.oltName || ''),
    oltIp: useTmc('olt') ? candidate.oltIp : (billing.oltIp || candidate.oltIp || ''),
    onuSerial: useTmc('onuSerial') ? candidate.onuSerial : (billing.onuSerial || candidate.onuSerial || ''),
    onuMac: useTmc('onuMac') ? candidate.onuMac : (billing.onuMac || candidate.onuMac || '')
  };
  const tech = technologyFromEvidence(hybrid.oltName || '', hybrid.interface || '', hybrid.technology || '');
  if (tech.action) {
    hybrid.technology = tech.type;
    hybrid.pollAction = tech.action;
  }
  hybrid.id = candidateId(hybrid);
  hybrid.writebackDecision = 'declined';
  return hybrid;
}

function allAvailableSourcesBlocked(locator) {
  const pollResult = latestPoll(locator)?.result || '';
  const tmc = locator.sourceStatus.tmc?.result || '';
  const direct = locator.sourceStatus.mac_direct?.result || '';
  const topology = locator.sourceStatus.mac_topology?.result || '';
  const sourceResults = [tmc, direct, topology].filter(Boolean);

  return (
    ['timeout', 'olt_unreachable', 'parser_error'].includes(pollResult)
    && sourceResults.length > 0
    && sourceResults.some(result => result === 'blocked')
    && sourceResults.every(result => (
      ['blocked', 'missing', 'identity_mismatch', 'identity_incomplete', 'ambiguous', 'not_found'].includes(result)
    ))
    && !locator.candidates.some(item => (
      ['candidate', 'interface_confirmed', 'billing_ready', 'direct_confirmed']
        .includes(item.status)
    ))
  );
}

// Rules are intentionally declarative and ordered. New branches should be
// added here without changing adapters or Guide Mode resolvers.
const POLICY_RULES = [
  {
    id: 'terminal.confirmed',
    priority: 1000,
    when: ({ locator }) => locator.termination?.status === LocatorTermination.CONFIRMED,
    decide: ({ locator }) => recommendation(
      LocatorAction.COMPLETE_CONFIRMED,
      'terminal.confirmed',
      'Штатный опрос OLT/ONU выполнен: оборудование вернуло ответ. Маршрут завершён.',
      { termination: locator.termination }
    )
  },
  {
    id: 'terminal.inconclusive',
    priority: 990,
    when: ({ locator }) => locator.termination?.status === LocatorTermination.INCONCLUSIVE,
    decide: ({ locator }) => recommendation(
      LocatorAction.RESOLVE_CONFLICT,
      'terminal.inconclusive',
      'Получены противоречивые идентификаторы. Требуется сверка.',
      { termination: locator.termination }
    )
  },
  {
    id: 'terminal.blocked-existing',
    priority: 988,
    when: ({ locator }) => locator.termination?.status === LocatorTermination.BLOCKED,
    decide: ({ locator }) => recommendation(
      LocatorAction.MANUAL_REVIEW,
      'terminal.blocked-existing',
      'Автоматизированный поиск заблокирован недоступностью источников.',
      { termination: locator.termination }
    )
  },
  {
    id: 'terminal.manual-review-existing',
    priority: 986,
    when: ({ locator }) => locator.termination?.status === LocatorTermination.MANUAL_REVIEW,
    decide: ({ locator }) => recommendation(
      LocatorAction.MANUAL_REVIEW,
      'terminal.manual-review-existing',
      'Дальнейшее продолжение требует ручной проверки или NOC.',
      { termination: locator.termination }
    )
  },
  {
    id: 'terminal.blocked',
    priority: 984,
    when: ({ locator }) => allAvailableSourcesBlocked(locator),
    decide: ({ locator }) => {
      locator.termination = {
        status: LocatorTermination.BLOCKED,
        reason: 'available_sources_unreachable',
        attemptedSources: ['billing-poll', 'userside-tmc', 'mac-direct', 'mac-uplink-downlink'],
        completedAt: nowIso()
      };
      locator.state = 'blocked';
      return recommendation(
        LocatorAction.MANUAL_REVIEW,
        'terminal.blocked',
        'Источники проверены, но необходимые системы или оборудование недоступны.',
        { termination: locator.termination }
      );
    }
  },
  {
    id: 'terminal.not-found',
    priority: 980,
    when: ({ locator }) => allSearchSourcesExhausted(locator),
    decide: ({ locator }) => {
      locator.termination = {
        status: LocatorTermination.NOT_FOUND,
        reason: 'search_sources_exhausted',
        attemptedSources: ['billing-poll', 'userside-tmc', 'mac-direct', 'mac-uplink-downlink'],
        completedAt: nowIso()
      };
      locator.state = 'not_found';
      return recommendation(
        LocatorAction.COMPLETE_NOT_FOUND,
        'terminal.not-found',
        'Доступные автоматизированные ветки исчерпаны: абонент не найден.',
        { termination: locator.termination }
      );
    }
  },
  {
    id: 'route.open-technical',
    priority: 900,
    when: ({ technicalVisited }) => !technicalVisited,
    decide: () => recommendation(
      LocatorAction.OPEN_TECHNICAL,
      'route.open-technical',
      'Первый источник — технические данные Billing.'
    )
  },
  {
    id: 'route.ethernet-open-switch',
    priority: 886,
    when: ({ isEthernet, locator }) => (
      isEthernet
      && locator.sourceStatus.ethernet_device?.result !== 'confirmed'
    ),
    decide: ({ caseData }) => recommendation(
      LocatorAction.SWITCH_PORT,
      'route.ethernet-open-switch',
      'Тип подтверждён: Ethernet по витой паре. В UserSide открой «Точка подключения» и перейди на указанный коммутатор; ONU и OLT здесь не используются.',
      {
        deviceId: String(valueOf(caseData.network?.accessDeviceId) || ''),
        deviceName: String(valueOf(caseData.network?.accessDeviceName) || ''),
        deviceIp: String(valueOf(caseData.network?.accessDeviceIp) || ''),
        port: String(valueOf(caseData.network?.accessPort) || ''),
        interface: String(valueOf(caseData.network?.accessInterface) || ''),
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'route.ethernet-check-fdb',
    priority: 884,
    when: ({ isEthernet, locator }) => (
      isEthernet
      && locator.sourceStatus.ethernet_device?.result === 'confirmed'
      && locator.sourceStatus.ethernet_fdb == null
    ),
    decide: ({ caseData }) => recommendation(
      LocatorAction.CHECK_ETHERNET_FDB,
      'route.ethernet-check-fdb',
      'Коммутатор открыт. Проверь FDB-таблицу: MAC текущего абонента должен находиться на его порту; VLAN берём из этой же строки.',
      {
        deviceId: String(valueOf(caseData.network?.accessDeviceId) || ''),
        interface: String(valueOf(caseData.network?.accessInterface) || ''),
        subscriberMac: String(valueOf(caseData.network?.mac) || ''),
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'route.ethernet-check-errors',
    priority: 882,
    when: ({ isEthernet, locator }) => (
      isEthernet
      && locator.sourceStatus.ethernet_fdb != null
      && locator.sourceStatus.ethernet_errors == null
    ),
    decide: ({ caseData, locator }) => recommendation(
      LocatorAction.CHECK_ETHERNET_ERRORS,
      'route.ethernet-check-errors',
      locator.sourceStatus.ethernet_fdb?.result === 'confirmed'
        ? 'MAC и порт подтверждены. Теперь открой «Ошибки на интерфейсах» и проверь именно порт абонента.'
        : 'FDB не дала чистого подтверждения. Всё равно проверь счётчики ошибок целевого порта и сохрани расхождение как отдельный факт.',
      {
        deviceId: String(valueOf(caseData.network?.accessDeviceId) || ''),
        interface: String(valueOf(caseData.network?.accessInterface) || ''),
        fdbResult: locator.sourceStatus.ethernet_fdb?.result || '',
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'route.ethernet-summary',
    priority: 880,
    when: ({ isEthernet, locator }) => (
      isEthernet
      && locator.sourceStatus.ethernet_errors != null
    ),
    decide: ({ caseData, locator }) => recommendation(
      LocatorAction.ETHERNET_SUMMARY,
      'route.ethernet-summary',
      [
        `Ethernet-ветка проверена: ${String(valueOf(caseData.network?.accessDeviceName) || 'коммутатор')}`,
        String(valueOf(caseData.network?.accessInterface) || valueOf(caseData.network?.accessPort) || ''),
        `FDB: ${locator.sourceStatus.ethernet_fdb?.result || 'нет данных'}`,
        `ошибки порта: ${locator.sourceStatus.ethernet_errors?.result || 'нет данных'}`
      ].filter(Boolean).join(' · '),
      {
        fdb: locator.sourceStatus.ethernet_fdb || null,
        errors: locator.sourceStatus.ethernet_errors || null,
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'poll.pending',
    priority: 850,
    when: ({ latestPollAttempt }) => latestPollAttempt?.result === 'pending',
    decide: () => recommendation(
      LocatorAction.WAIT_POLL,
      'poll.pending',
      'Опрос выполняется. Нужно дождаться результата.'
    )
  },
  {
    id: 'poll.partial-stabilizing',
    priority: 848,
    when: ({ locator, latestPollAttempt }) => (
      latestPollAttempt?.result === 'partial'
      && !pollPartialStable(locator)
    ),
    decide: () => recommendation(
      LocatorAction.WAIT_POLL,
      'poll.partial-stabilizing',
      'Вывод OLT ещё формируется. Workbench ждёт стабилизации результата и не запускает fallback раньше времени.'
    )
  },
  {
    id: 'poll.retry-once',
    priority: 840,
    when: ({ latestPollAttempt, currentPollAttempts }) => (
      ['timeout', 'olt_unreachable'].includes(latestPollAttempt?.result)
      && currentPollAttempts.length <= 1
    ),
    decide: ({ latestPollAttempt }) => recommendation(
      LocatorAction.RETRY_POLL,
      'poll.retry-once',
      latestPollAttempt.result === 'timeout'
        ? 'Опрос завершился таймаутом. Это не означает отсутствие ONU; повтори один раз.'
        : 'OLT недоступна. Это не отрицательное доказательство; повтори или проверь альтернативный источник.'
    )
  },
  {
    id: 'poll.error-missing-tech-check-tmc',
    priority: 837,
    when: ({ locator, latestPollAttempt, technical }) => (
      latestPollAttempt?.result === 'parser_error'
      && technical.missingBilling.length > 0
      && locator.sourceStatus.tmc == null
    ),
    decide: ({ technical }) => recommendation(
      LocatorAction.CHECK_TMC,
      'poll.error-missing-tech-check-tmc',
      `Billing не дал пригодного ответа с текущими неполными данными. Проверь ТМЦ и восстанови: ${technical.missingBilling.join(', ')}.`,
      { missingBilling: technical.missingBilling, inspectFields: technical.missingBilling, progressiveDisclosure: true }
    )
  },
  {
    id: 'poll.parser-error',
    priority: 835,
    when: ({ latestPollAttempt }) => latestPollAttempt?.result === 'parser_error',
    decide: ({ locator }) => {
      locator.termination = {
        status: LocatorTermination.MANUAL_REVIEW,
        reason: 'poll_parser_error',
        completedAt: nowIso()
      };
      locator.state = 'manual_review';
      return recommendation(
        LocatorAction.MANUAL_REVIEW,
        'poll.parser-error',
        'Страница опроса не распознана. Диагностический вывод не изменён.',
        { termination: locator.termination }
      );
    }
  },
  {
    id: 'billing.incomplete-check-tmc',
    priority: 825,
    when: ({ locator, technical, family }) => (
      family === 'pon'
      && technical.missingBilling.length > 0
      && locator.sourceStatus.tmc == null
    ),
    decide: ({ technical }) => recommendation(
      LocatorAction.CHECK_TMC,
      'billing.incomplete-check-tmc',
      `В технических данных не хватает: ${technical.missingBilling.join(', ')}. Следующий источник — ТМЦ.`,
      {
        missingBilling: technical.missingBilling,
        inspectFields: technical.missingBilling,
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'fallback.check-tmc',
    priority: 800,
    when: ({ locator, latestPollAttempt, hasBillingOlt }) => (
      locator.sourceStatus.tmc == null
      && (
        latestPollAttempt?.result === 'not_found'
        || latestPollAttempt?.result === 'timeout'
        || latestPollAttempt?.result === 'olt_unreachable'
        || (latestPollAttempt?.result === 'partial' && pollPartialStable(locator))
        || !hasBillingOlt
      )
    ),
    decide: ({ technical }) => recommendation(
      LocatorAction.CHECK_TMC,
      'fallback.check-tmc',
      'Проверь ТМЦ как следующий независимый источник. Workbench уже может иметь фоновые факты, но не раскрывает их до нужного шага.',
      {
        missingBilling: technical.missingBilling,
        inspectFields: technical.missingBilling.length ? technical.missingBilling : ['olt', 'onuSerial', 'onuMac'],
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'tmc.identity-conflict-fill-billing',
    priority: 797,
    when: ({ caseData, locator, technical }) => (
      !tmcWritebackDeclined(caseData)
      && locator.sourceStatus.tmc?.result === 'found'
      && scopedIdentityConflicts(caseData, technical).length > 0
    ),
    decide: ({ caseData, technical, best }) => {
      const conflicts = scopedIdentityConflicts(caseData, technical);
      const scope = tmcWritebackScope(caseData);
      const fields = [...new Set([
        ...technical.correctionFields.filter(field => !scope.length || scope.includes(field)),
        ...conflicts.map(item => item.field)
      ])];
      return recommendation(
        LocatorAction.FILL_BILLING_TECHNICAL,
        'tmc.identity-conflict-fill-billing',
        `Billing и ТМЦ расходятся по данным ONU. Используй значения из ТМЦ для Billing: ${fields.join(', ')}.`,
        {
          candidate: best,
          fields,
          expectedTechnical: technical.expectedTechnical,
          source: 'tmc',
          conflicts,
          progressiveDisclosure: true
        }
      );
    }
  },
  {
    id: 'tmc.writeback-declined-ready-poll',
    priority: 798,
    when: ({ caseData, locator, technical }) => {
      if (!tmcWritebackDeclined(caseData)) return false;
      if (locator.sourceStatus.tmc?.result !== 'found') return false;
      if (technical.remainingAfterTmc.length > 0) return false;
      const sourceCandidate = locator.candidates.find(item => item.source === 'userside-tmc' && item.pollAction);
      const candidate = declinedWritebackPollCandidate(caseData, sourceCandidate, technical);
      if (!candidate?.pollAction) return false;
      const fingerprint = bindingFingerprint(candidate);
      return !pollAttemptsFor(locator, fingerprint).some(item => item.result === 'confirmed');
    },
    decide: ({ caseData, locator, technical }) => {
      const sourceCandidate = locator.candidates.find(item => item.source === 'userside-tmc' && item.pollAction);
      const candidate = declinedWritebackPollCandidate(caseData, sourceCandidate, technical);
      return recommendation(
        LocatorAction.POLL_CANDIDATE,
        'tmc.writeback-declined-ready-poll',
        'ТМЦ уже проверена. Возможность сохранить изменения в Technical пропущена оператором; этот этап закрыт. Выполни штатный опрос ONU.',
        { candidate, source: 'tmc+current-billing', writeback: 'declined', progressiveDisclosure: true }
      );
    }
  },
  {
    id: 'tmc.writeback-await-save',
    priority: 794,
    when: ({ caseData, locator }) => {
      const flow = caseData.workflow?.ponAcquisition || {};
      const saved = locator.sourceStatus.billing_saved || {};
      const requestedAt = Date.parse(flow.tmcWritebackRequestedAt || '') || 0;
      const savedAt = Date.parse(saved.updatedAt || '') || 0;
      const savedAfterRequest = saved.result === 'saved'
        && (!requestedAt || savedAt >= requestedAt);
      return Boolean(flow.tmcWritebackPendingSave)
        && !tmcWritebackDeclined(caseData)
        && !savedAfterRequest
        && locator.sourceStatus.billing_save_intent?.result !== 'intent';
    },
    decide: ({ caseData, best }) => {
      const flow = caseData.workflow?.ponAcquisition || {};
      const expected = flow.expectedTechnicalWriteback || {};
      const fields = Array.isArray(flow.tmcWritebackFields)
        ? flow.tmcWritebackFields
        : [];
      return recommendation(
        LocatorAction.FILL_BILLING_TECHNICAL,
        'tmc.writeback-await-save',
        'Данные из ТМЦ уже подставлены в Billing. Проверь значения и сохрани технические данные.',
        {
          candidate: best,
          fields,
          expectedTechnical: expected,
          source: 'tmc',
          phase: 'save',
          progressiveDisclosure: true
        }
      );
    }
  },
  {
    id: 'tmc.complete-billing',
    priority: 792,
    when: ({ caseData, locator, technical, best }) => (
      !tmcWritebackDeclined(caseData)
      && locator.sourceStatus.tmc?.result === 'found'
      && best
      && technical.identityConflicts.length === 0
      && technical.correctionFields.length > 0
      && technical.remainingAfterTmc.length === 0
    ),
    decide: ({ technical, best }) => recommendation(
      LocatorAction.FILL_BILLING_TECHNICAL,
      'tmc.complete-billing',
      `ТМЦ дала данные, которых не хватает для штатного опроса. Сверь и исправь: ${technical.correctionFields.join(', ')}.`,
      {
        candidate: best,
        fields: technical.correctionFields,
        expectedTechnical: technical.expectedTechnical,
        source: 'tmc',
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'tmc.ready-poll',
    priority: 790,
    when: ({ locator, technical }) => {
      if (locator.sourceStatus.tmc?.result !== 'found') return false;
      if (technical.identityConflicts.length > 0) return false;
      if (technical.correctionFields.length > 0 || technical.remainingAfterTmc.length > 0) return false;
      const candidate = locator.candidates.find(item => item.source === 'userside-tmc' && item.pollAction);
      if (!candidate?.pollAction) return false;
      const fingerprint = bindingFingerprint(candidate);
      return !pollAttemptsFor(locator, fingerprint).some(item => item.result === 'confirmed');
    },
    decide: ({ locator }) => {
      const candidate = locator.candidates.find(item => item.source === 'userside-tmc' && item.pollAction);
      return recommendation(
        LocatorAction.POLL_CANDIDATE,
        'tmc.ready-poll',
        'ТМЦ уже дала пригодную привязку. Следующий шаг — штатный опрос на типе OLT, определённом по ТМЦ.',
        { candidate, source: 'tmc', progressiveDisclosure: true }
      );
    }
  },
  {
    id: 'tmc.incomplete-search-mac',
    priority: 788,
    when: ({ locator, technical }) => (
      locator.sourceStatus.tmc?.result === 'found'
      && technical.identityConflicts.length === 0
      && technical.remainingAfterTmc.length > 0
      && locator.sourceStatus.mac_direct == null
      && technical.searchMacs.length > 0
    ),
    decide: ({ technical }) => recommendation(
      LocatorAction.SEARCH_MAC,
      'tmc.incomplete-search-mac',
      `ТМЦ не закрыла все пробелы (${technical.remainingAfterTmc.join(', ')}). Следующий независимый след — MAC устройства.`,
      {
        macs: technical.searchMacs,
        missingBilling: technical.remainingAfterTmc,
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'tmc.poll-rejected-search-mac',
    priority: 784,
    when: ({ locator, technical, binding, currentPollAttempts }) => (
      locator.sourceStatus.tmc?.result === 'found'
      && technical.identityConflicts.length === 0
      && technical.correctionFields.length === 0
      && locator.sourceStatus.mac_direct == null
      && technical.searchMacs.length > 0
      && (
        isFingerprintRejected(locator, binding?.fingerprint)
        || currentPollAttempts.filter(item => ['timeout', 'olt_unreachable', 'partial'].includes(item.result)).length >= 2
      )
    ),
    decide: ({ technical }) => recommendation(
      LocatorAction.SEARCH_MAC,
      'tmc.poll-rejected-search-mac',
      'ТМЦ подтверждает текущую привязку, но штатный опрос её не подтвердил. Проверь фактический путь по MAC устройства.',
      { macs: technical.searchMacs, progressiveDisclosure: true }
    )
  },
  {
    id: 'tmc.unconfirmed-search-mac',
    priority: 780,
    when: ({ locator, technical }) => (
      TMC_UNCONFIRMED_RESULTS.has(locator.sourceStatus.tmc?.result)
      && locator.sourceStatus.mac_direct == null
      && technical.searchMacs.length > 0
    ),
    decide: ({ locator, technical }) => {
      const result = locator.sourceStatus.tmc?.result;
      const reason = result === 'missing'
        ? 'ТМЦ не дала ONU/OLT. Используй MAC устройства как следующий независимый след.'
        : 'ТМЦ не дала пригодного результата. Продолжи поиск по MAC устройства.';
      return recommendation(
        LocatorAction.SEARCH_MAC,
        'tmc.unconfirmed-search-mac',
        reason,
        { macs: technical.searchMacs, progressiveDisclosure: true }
      );
    }
  },
  {
    id: 'mac.direct-name-to-billing',
    priority: 775,
    when: ({ locator, best }) => {
      const direct = locator.sourceStatus.mac_direct || null;
      if (direct?.result !== 'candidate_found' || !best?.oltName || best.oltIp) return false;
      if (locator.sourceStatus.billing_save_intent?.result === 'intent') return false;
      if (locator.sourceStatus.billing_saved?.result === 'saved') return false;
      const searched = normalizeMac(direct.searchedMac || '');
      const observed = normalizeMac(best.subscriberMac || '');
      return Boolean(
        direct.candidateCount === 1
        && searched
        && observed
        && searched === observed
        && isLikelyPonOltCandidate(best)
      );
    },
    decide: ({ best }) => recommendation(
      LocatorAction.FILL_BILLING_OLT,
      'mac.direct-name-to-billing',
      'MAC устройства однозначно вывел на OLT. IP для этого шага не нужен: вернись в технические данные, Workbench найдёт OLT в штатном списке по имени и подставит её; оператору останется сохранить.',
      {
        candidate: best,
        fields: ['olt'],
        expectedTechnical: {
          oltName: best.oltName || '',
          oltIp: '',
          onuSerial: best.onuSerial || '',
          onuMac: best.onuMac || ''
        },
        source: 'mac_name',
        phase: 'select_by_name',
        progressiveDisclosure: true
      }
    )
  },
  {
    id: 'mac.direct-candidate-interface',
    priority: 770,
    when: ({ locator, best }) => (
      locator.sourceStatus.mac_direct?.result === 'candidate_found'
      && best
      && !['interface_confirmed', 'billing_ready', 'direct_confirmed'].includes(best.status)
    ),
    decide: ({ best }) => recommendation(
      LocatorAction.INSPECT_INTERFACE,
      'mac.direct-candidate-interface',
      'MAC устройства дал кандидата оборудования. Подтверди этот MAC на найденном интерфейсе.',
      { candidate: best, progressiveDisclosure: true }
    )
  },
  {
    id: 'mac.direct-empty-topology',
    priority: 760,
    when: ({ locator }) => (
      locator.sourceStatus.mac_direct?.result === 'not_found'
      && locator.sourceStatus.mac_topology == null
    ),
    decide: ({ locator }) => recommendation(
      LocatorAction.SEARCH_UPLINK_DOWNLINK,
      'mac.direct-empty-topology',
      'Прямой поиск MAC устройства пуст. Расширь поиск на UPLINK/DOWNLINK.',
      { searchedMac: locator.sourceStatus.mac_direct?.searchedMac || '', progressiveDisclosure: true }
    )
  },
  {
    id: 'mac.topology-candidate-interface',
    priority: 750,
    when: ({ locator, best }) => (
      locator.sourceStatus.mac_topology?.result === 'candidate_found'
      && best
      && !['interface_confirmed', 'billing_ready', 'direct_confirmed'].includes(best.status)
    ),
    decide: ({ best }) => recommendation(
      LocatorAction.INSPECT_INTERFACE,
      'mac.topology-candidate-interface',
      'Кандидат найден через UPLINK/DOWNLINK. Подтверди MAC устройства на интерфейсе.',
      { candidate: best, progressiveDisclosure: true }
    )
  },
  {
    id: 'candidate.inspect-device',
    priority: 740,
    when: ({ best }) => (
      best?.status === 'interface_confirmed'
      && (!best.oltIp || !best.pollAction)
    ),
    decide: ({ best }) => recommendation(
      LocatorAction.INSPECT_DEVICE,
      'candidate.inspect-device',
      'Интерфейс подтверждён. Открой оборудование, чтобы получить OLT IP и тип.',
      { candidate: best, progressiveDisclosure: true }
    )
  },
  {
    id: 'candidate.inspect-onu-details',
    priority: 736,
    when: ({ best, caseData }) => {
      if (!best || !best.oltIp || !best.pollAction) return false;
      const correction = candidateTechnicalState(caseData, best);
      return correction.remainingMissing.some(field => field === 'onuSerial' || field === 'onuMac');
    },
    decide: ({ best, caseData }) => {
      const correction = candidateTechnicalState(caseData, best);
      return recommendation(
        LocatorAction.INSPECT_ONU_DETAILS,
        'candidate.inspect-onu-details',
        `OLT и порт найдены по MAC устройства, но для Billing ещё не хватает: ${correction.remainingMissing.join(', ')}. Добери идентификаторы ONU на найденном оборудовании/порту.`,
        {
          candidate: best,
          missingBilling: correction.remainingMissing,
          progressiveDisclosure: true
        }
      );
    }
  },
  {
    id: 'candidate.fill-billing',
    priority: 730,
    when: ({ best, caseData }) => {
      if (!best || !best.oltIp || !best.pollAction) return false;
      const correction = candidateTechnicalState(caseData, best);
      return correction.fields.length > 0 && correction.remainingMissing.length === 0;
    },
    decide: ({ best, caseData }) => {
      const correction = candidateTechnicalState(caseData, best);
      return recommendation(
        LocatorAction.FILL_BILLING_TECHNICAL,
        'candidate.fill-billing',
        `Фактическая привязка определена. Сверь и исправь в Billing: ${correction.fields.join(', ')}.`,
        {
          candidate: best,
          fields: correction.fields,
          expectedTechnical: correction.expectedTechnical,
          source: best.source || 'network',
          progressiveDisclosure: true
        }
      );
    }
  },
  {
    id: 'candidate.wait-save-confirmation',
    priority: 805,
    when: ({ locator }) => (
      locator.sourceStatus.billing_save_intent?.result === 'intent'
      && locator.sourceStatus.billing_saved?.result !== 'saved'
    ),
    decide: () => recommendation(
      LocatorAction.WAIT_CONTEXT,
      'candidate.wait-save-confirmation',
      'Сохранение отправлено. Workbench ждёт новую страницу и повторно проверяет изменённые технические поля.'
    )
  },
  {
    id: 'candidate.save-billing',
    priority: 725,
    when: ({ best, binding, locator, readyForPoll, caseData, technical }) => {
      if (!best || !readyForPoll || !candidateMatchesBilling(best, binding)) return false;
      if (locator.sourceStatus.billing_saved?.result === 'saved') return false;
      // If Billing already has a complete core binding, do not demand a redundant save
      // just because an earlier route remembered initially-missing fields.
      if (technical?.billingReadyCore) return false;
      const initiallyMissing = Array.isArray(caseData.route?.billingTechnicalInitiallyMissing)
        ? caseData.route.billingTechnicalInitiallyMissing
        : [];
      const hadRejectedBinding = locator.hypotheses.some(item => item.status === 'rejected');
      return initiallyMissing.length > 0 || hadRejectedBinding;
    },
    decide: ({ best, caseData }) => {
      const initiallyMissing = Array.isArray(caseData.route?.billingTechnicalInitiallyMissing)
        ? caseData.route.billingTechnicalInitiallyMissing
        : [];
      const fields = initiallyMissing.length ? initiallyMissing : ['olt'];
      return recommendation(
        LocatorAction.FILL_BILLING_TECHNICAL,
        'candidate.save-billing',
        `Найденные технические данные уже выставлены. Сохрани изменения: ${fields.join(', ')}.`,
        {
          candidate: best,
          fields,
          expectedTechnical: {
            oltName: best.oltName || '',
            oltIp: best.oltIp || '',
            onuSerial: best.onuSerial || valueOf(caseData.pon?.onuSerial) || '',
            onuMac: best.onuMac || valueOf(caseData.pon?.onuMac) || ''
          },
          source: best.source || 'locator',
          phase: 'save',
          progressiveDisclosure: true
        }
      );
    }
  },
  {
    id: 'candidate.poll',
    priority: 720,
    when: ({ best, binding, locator, readyForPoll }) => (
      best
      && best.oltIp
      && best.pollAction
      && readyForPoll
      && candidateMatchesBilling(best, binding)
      && locator.sourceStatus.billing_saved?.result === 'saved'
      && !pollAttemptsFor(locator, binding?.fingerprint).some(item => item.result === 'confirmed')
      && !isFingerprintRejected(locator, binding?.fingerprint)
    ),
    decide: ({ best }) => recommendation(
      LocatorAction.POLL_CANDIDATE,
      'candidate.poll',
      'Технические данные сохранены. Теперь выполни штатный опрос для окончательного подтверждения.',
      { candidate: best }
    )
  },
  {
    id: 'billing.poll-current',
    priority: 700,
    when: ({ hasBillingOlt, readyForPoll, binding, locator }) => (
      hasBillingOlt
      && readyForPoll
      && binding
      && !pollAttemptsFor(locator, binding.fingerprint).length
      && !isFingerprintRejected(locator, binding.fingerprint)
    ),
    decide: ({ binding }) => {
      const isEpon = comparable(binding?.technology) === 'epon';
      return recommendation(
        LocatorAction.POLL_CURRENT_BINDING,
        'billing.poll-current',
        isEpon
          ? 'OLT и ONU MAC в Billing заполнены. Данных достаточно для штатного EPON-опроса; GPON Serial здесь не обязателен.'
          : 'OLT, ONU S/N и ONU MAC в Billing заполнены. Проверь текущую связку штатным опросом.',
        { binding, progressiveDisclosure: true }
      );
    }
  },
  {
    id: 'fallback.no-mac',
    priority: 500,
    when: ({ locator, technical }) => (
      locator.sourceStatus.tmc != null
      && (
        TMC_UNCONFIRMED_RESULTS.has(locator.sourceStatus.tmc?.result)
        || technical.remainingAfterTmc.length > 0
        || technical.identityConflicts.length > 0
      )
      && technical.searchMacs.length === 0
    ),
    decide: ({ locator, technical }) => {
      locator.termination = {
        status: LocatorTermination.MANUAL_REVIEW,
        reason: 'no_search_identifiers',
        completedAt: nowIso()
      };
      locator.state = 'manual_review';
      return recommendation(
        LocatorAction.MANUAL_REVIEW,
        'fallback.no-mac',
        `ТМЦ не закрыла проверку, а пригодного MAC устройства нет${technical.remainingAfterTmc.length ? ` (${technical.remainingAfterTmc.join(', ')})` : ''}. Нужна ручная проверка истории или NOC.`,
        { termination: locator.termination }
      );
    }
  },
  {
    id: 'fallback.network-exhausted-after-tmc',
    priority: 490,
    when: ({ locator }) => (
      locator.sourceStatus.tmc?.result === 'found'
      && locator.sourceStatus.mac_direct?.result === 'not_found'
      && locator.sourceStatus.mac_topology?.result === 'not_found'
    ),
    decide: ({ locator }) => {
      locator.termination = {
        status: LocatorTermination.MANUAL_REVIEW,
        reason: 'tmc_present_but_network_trace_missing',
        completedAt: nowIso()
      };
      locator.state = 'manual_review';
      return recommendation(
        LocatorAction.MANUAL_REVIEW,
        'fallback.network-exhausted-after-tmc',
        'ТМЦ дала часть данных, но MAC устройства не найден ни прямым поиском, ни через UPLINK/DOWNLINK. Дальше нужна ручная разборка истории.',
        { termination: locator.termination }
      );
    }
  },
  {
    id: 'route.wait',
    priority: 0,
    when: () => true,
    decide: () => recommendation(
      LocatorAction.WAIT_CONTEXT,
      'route.wait',
      'Workbench ожидает новый результат или подтверждённый факт.'
    )
  }
];

function isFingerprintRejected(locator, fingerprint) {
  if (!fingerprint) return false;
  return locator.hypotheses.some(item => (
    item.fingerprint === fingerprint
    && item.status === 'rejected'
  ));
}

function synchronizeFacts(caseData, locator) {
  const tmcOltName = String(valueOf(caseData.pon?.tmcOltName) || '');
  const tmcOltIp = String(valueOf(caseData.pon?.tmcOltIp) || '');
  const tmcDeviceId = String(valueOf(caseData.pon?.tmcOltDeviceId) || '');
  const tmcInterface = String(valueOf(caseData.pon?.tmcPort) || '');
  const tmcOnuMac = String(valueOf(caseData.pon?.tmcOnuMac) || '');
  const tmcOnuSerial = String(valueOf(caseData.pon?.tmcOnuSerial) || '');

  const passiveSources = caseData.route?.passiveSources || {};

  if ((tmcOltName || tmcOltIp) && locator.sourceStatus.tmc == null && !passiveSources.tmc) {
    const tech = technologyFromEvidence(tmcOltName, tmcInterface, '');
    setSourceStatus(locator, 'tmc', {
      result: 'found',
      details: {
        oltName: tmcOltName,
        oltIp: tmcOltIp,
        deviceId: tmcDeviceId,
        interface: tmcInterface
      },
      inferredFromFacts: true
    });
    upsertCandidate(locator, {
      source: 'userside-tmc',
      status: 'candidate',
      oltName: tmcOltName,
      oltIp: tmcOltIp,
      deviceId: tmcDeviceId,
      interface: tmcInterface,
      onuMac: tmcOnuMac,
      onuSerial: tmcOnuSerial,
      technology: tech.type,
      pollAction: tech.action,
      matchedCurrentSubscriber: true,
      confidence: 0.94
    });
  }

  const locatedDeviceId = String(valueOf(caseData.pon?.locatedDeviceId) || '');
  const locatedName = String(
    valueOf(caseData.pon?.locatedOltName)
    || valueOf(caseData.pon?.locatedDeviceName)
    || ''
  );
  const locatedIp = String(valueOf(caseData.pon?.locatedOltIp) || '');
  const locatedInterface = String(valueOf(caseData.pon?.locatedInterface) || '');
  const locatedIfIndex = String(valueOf(caseData.pon?.locatedIfIndex) || '');
  const locatedMac = String(valueOf(caseData.pon?.locatedSubscriberMac) || '');
  const locatedType = String(valueOf(caseData.pon?.locatedPollType) || '');
  const locatedAction = String(valueOf(caseData.pon?.locatedPollAction) || '');

  if ((locatedDeviceId || locatedName || locatedInterface) && !passiveSources.networkLocator) {
    const tech = technologyFromEvidence(locatedName, locatedInterface, locatedType);
    upsertCandidate(locator, {
      source: 'userside-locator-facts',
      status: locatedInterface ? 'interface_confirmed' : 'candidate',
      deviceId: locatedDeviceId,
      oltName: locatedName,
      oltIp: locatedIp,
      interface: locatedInterface,
      ifIndex: locatedIfIndex,
      subscriberMac: locatedMac,
      technology: locatedType || tech.type,
      pollAction: locatedAction || tech.action,
      matchedCurrentSubscriber: Boolean(locatedInterface),
      confidence: locatedInterface ? 0.94 : 0.8
    });
  }
}

const NETWORK_FALLBACK_ACTIONS = new Set([
  LocatorAction.SEARCH_MAC,
  LocatorAction.SEARCH_UPLINK_DOWNLINK,
  LocatorAction.INSPECT_INTERFACE,
  LocatorAction.INSPECT_DEVICE,
  LocatorAction.INSPECT_ONU_DETAILS
]);

function guardRecommendation(input, proposed) {
  if (!proposed?.action) return proposed;
  const { locator, technical } = input;

  // Hard route invariant: network/MAC reconstruction is a fallback.
  // It may be observed passively at any time, but the operational route must
  // visit TMC first. This prevents an incidental MAC result from hijacking Guide.
  const macDrivenBilling = proposed.action === LocatorAction.FILL_BILLING_OLT
    && /^(?:mac|network)/i.test(String(proposed.params?.source || ''));
  if ((NETWORK_FALLBACK_ACTIONS.has(proposed.action) || macDrivenBilling)
      && locator.sourceStatus.tmc == null) {
    return recommendation(
      LocatorAction.CHECK_TMC,
      'guard.tmc-before-network',
      'Сначала проверь ТМЦ. Поиск по MAC и оборудование — только fallback, если ТМЦ не дала достаточных данных.',
      {
        blockedAction: proposed.action,
        blockedRuleId: proposed.ruleId || '',
        missingBilling: technical?.missingBilling || [],
        inspectFields: technical?.missingBilling?.length
          ? technical.missingBilling
          : ['olt', 'onuSerial', 'onuMac'],
        progressiveDisclosure: true
      }
    );
  }

  return proposed;
}

export function evaluateLocatorPolicy(caseData, options = {}) {
  const locator = ensureLocatorShape(caseData);
  synchronizeFacts(caseData, locator);

  // Upgrade/recovery for cases created before interface-first technology inference.
  // Stored TMC candidates such as `Huawei MA5800` + `EPON ...` must resolve to
  // Billing EPON action 310 instead of remaining permanently stuck on 313.
  for (const candidate of locator.candidates || []) {
    if (candidate?.source !== 'userside-tmc') continue;
    const tech = technologyFromEvidence(
      candidate.oltName || '',
      candidate.interface || '',
      candidate.technology || ''
    );
    if (tech.action) {
      candidate.technology = tech.type;
      candidate.pollAction = tech.action;
    }
  }
  const binding = currentBillingBinding(caseData);
  locator.currentBinding = binding;

  const family = comparable(valueOf(caseData.network?.connectionFamily));
  const technicalVisited = Object.values(caseData.contexts || {})
    .some(context => context.pageKind === 'billing_technical');
  const billingSubscriberVisited = Object.values(caseData.contexts || {})
    .some(context => ['billing_user', 'billing_technical', 'billing_juniper'].includes(context.pageKind));
  const hasBillingOlt = Boolean(binding?.oltName || binding?.oltIp);
  const hasOnu = Boolean(
    valueOf(caseData.pon?.onuMac)
    || valueOf(caseData.pon?.onuSerial)
    || valueOf(caseData.pon?.tmcOnuMac)
    || valueOf(caseData.pon?.tmcOnuSerial)
  );
  const technical = billingTechnicalState(caseData, locator);
  const pollAction = String(valueOf(caseData.pon?.pollAction) || '');
  const canAttemptPoll = Boolean(
    family === 'pon'
    && technical.hasBillingOnuMac
    && pollAction
  );
  const readyForPoll = Boolean(
    canAttemptPoll
    && hasBillingOlt
    && technical.billingReadyCore
    && binding?.pollAction
  );
  const latestPollAttempt = latestPoll(locator);
  const currentPollAttempts = pollAttemptsFor(locator, binding?.fingerprint);
  const best = bestCandidate(locator);

  const input = {
    caseData,
    locator,
    binding,
    best,
    family,
    isEthernet: family === 'ethernet',
    technicalVisited,
    billingSubscriberVisited,
    hasBillingOlt,
    hasOnu,
    technical,
    canAttemptPoll,
    readyForPoll,
    latestPollAttempt,
    currentPollAttempts,
    options
  };

  const ordered = [...POLICY_RULES]
    .sort((a, b) => b.priority - a.priority);

  for (const rule of ordered) {
    if (!rule.when(input)) continue;
    const proposed = rule.decide(input);
    locator.recommendation = guardRecommendation(input, proposed);
    locator.updatedAt = nowIso();
    return locator.recommendation;
  }

  return locator.recommendation;
}

export function locatorSnapshot(caseData) {
  const locator = ensureLocatorShape(caseData);
  const recommendation = evaluateLocatorPolicy(caseData);
  const best = bestCandidate(locator);
  return {
    state: locator.state,
    recommendation,
    termination: locator.termination,
    bestCandidate: best,
    attemptCount: locator.attempts.length,
    evidenceCount: locator.evidence.length,
    candidateCount: locator.candidates.length,
    currentBindingRejected: isBindingRejected(caseData),
    sourceStatus: locator.sourceStatus,
    updatedAt: locator.updatedAt
  };
}

export const __test = Object.freeze({
  bindingFingerprint,
  candidateId,
  observationSignature,
  currentBillingBinding,
  bestCandidate,
  candidateMatchesBilling,
  technologyFromName,
  technologyFromEvidence,
  requiredTechnicalFields,
  billingTechnicalState,
  tmcSerialIsSourceOptional,
  allSearchSourcesExhausted,
  pollPartialStable,
  POLICY_RULES
});
