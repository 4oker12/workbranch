export const RouteRelation = Object.freeze({
  ON_ROUTE: 'on_route',
  SUPPORTING: 'supporting',
  OFF_ROUTE: 'off_route',
  FOREIGN: 'foreign'
});

const POLL_ACTIONS = new Set([
  'poll_current_binding',
  'poll_candidate',
  'retry_poll',
  'wait_poll'
]);

const SAVE_ACTIONS = new Set([
  'fill_billing_olt',
  'fill_billing_technical',
  'wait_context'
]);

const ACTION_PAGE_KINDS = Object.freeze({
  check_juniper: new Set(['billing_juniper']),
  open_technical: new Set(['billing_technical']),
  check_tmc: new Set(['userside_customer']),
  search_mac: new Set(['userside_customer_list']),
  search_uplink_downlink: new Set(['userside_customer_list']),
  inspect_interface: new Set(['interface_mac_list']),
  inspect_device: new Set(['userside_device']),
  inspect_onu_details: new Set(['userside_device']),
  switch_port: new Set(['userside_customer', 'userside_device']),
  check_ethernet_fdb: new Set(['userside_device', 'device_poller']),
  check_ethernet_errors: new Set(['userside_device', 'device_interface_errors']),
  ethernet_summary: new Set(['userside_customer', 'userside_device', 'device_poller', 'device_interface_errors']),
  fill_billing_olt: new Set(['billing_technical']),
  fill_billing_technical: new Set(['billing_technical'])
});

function factValue(value) {
  return value && typeof value === 'object' && 'value' in value
    ? value.value
    : value;
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

function normalizeIdentityValue(key, value) {
  const text = String(factValue(value) ?? '').trim();
  if (!text) return '';
  if (key === 'login') return comparable(text);
  if (key === 'contract' || key === 'billingId' || key === 'customerId') {
    return text.replace(/\D+/g, '');
  }
  return comparable(text);
}

function currentAction(caseData) {
  return String(caseData?.locator?.recommendation?.action || '');
}

function isTerminal(caseData) {
  return String(caseData?.locator?.termination?.status || '') === 'confirmed';
}

function identityConflicts(caseData, context) {
  const incoming = context?.identity || {};
  const current = caseData?.identity || {};
  for (const key of ['login', 'billingId', 'customerId']) {
    const left = normalizeIdentityValue(key, current?.[key]);
    const right = normalizeIdentityValue(key, incoming?.[key]);
    if (left && right && left !== right) return true;
  }
  return false;
}

function expectedPollAction(caseData, context = {}) {
  return String(
    context?.meta?.poll?.attemptAction
    || context?.meta?.poll?.expectedPollAction
    || factValue(caseData?.pon?.pollAction)
    || ''
  );
}

function openedPollAction(context = {}) {
  return String(
    context?.meta?.poll?.openedAction
    || context?.subview?.replace(/^a/i, '')
    || ''
  );
}

function pollActionsMatch(caseData, context = {}, details = {}) {
  const expected = String(
    details.expectedPollAction
    || expectedPollAction(caseData, context)
    || ''
  );
  const actual = String(
    details.pollAction
    || openedPollAction(context)
    || ''
  );
  return !expected || !actual || expected === actual;
}

// A real response from the operator's current, correlated PollAttempt is stronger
// evidence than the order in which Guide suggested Juniper/Technical/UserSide.
// Background correlation still checks case, episode, document, binding and attempt.
function isConfirmedPollContext(caseData, context = {}) {
  const poll = context?.meta?.poll || {};
  return Boolean(
    context?.pageKind === 'billing_onu_poll'
    && poll.outcome === 'confirmed'
    && poll.requestObserved === true
    && poll.responseEvidence === true
    && poll.wrongPollTab !== true
    && pollActionsMatch(caseData, context, poll)
  );
}

function isConfirmedPollObservation(caseData, observation = {}, context = {}) {
  const details = observation?.details || {};
  return Boolean(
    observation?.type === 'POLL_RESULT'
    && observation?.result === 'confirmed'
    && details.pollCompleted === true
    && details.pollResponded === true
    && details.requestObserved === true
    && details.wrongPollTab !== true
    && details.uiStable !== false
    && pollActionsMatch(caseData, context, details)
  );
}

export function classifyContextRelation(caseData, context = {}, forcedAction = '') {
  if (identityConflicts(caseData, context)) return RouteRelation.FOREIGN;
  if (isTerminal(caseData)) return RouteRelation.SUPPORTING;

  if (isConfirmedPollContext(caseData, context)) return RouteRelation.ON_ROUTE;

  const action = String(forcedAction || currentAction(caseData) || '');
  const pageKind = String(context?.pageKind || '');
  if (!action || action === 'wait_context') return RouteRelation.SUPPORTING;

  if (POLL_ACTIONS.has(action)) {
    if (pageKind !== 'billing_onu_poll') return RouteRelation.OFF_ROUTE;
    const poll = context?.meta?.poll || {};
    const expected = expectedPollAction(caseData, context);
    const opened = openedPollAction(context);
    if (poll.wrongPollTab) return RouteRelation.OFF_ROUTE;
    if (expected && opened && expected !== opened) return RouteRelation.OFF_ROUTE;
    return RouteRelation.ON_ROUTE;
  }

  const expectedKinds = ACTION_PAGE_KINDS[action];
  if (expectedKinds?.has(pageKind)) return RouteRelation.ON_ROUTE;

  // Same-case subscriber pages may be useful context while the operator is on the
  // way to the requested source, but they must not advance the route by themselves.
  if (['billing_user', 'billing_juniper', 'userside_customer'].includes(pageKind)) {
    return RouteRelation.SUPPORTING;
  }

  return RouteRelation.OFF_ROUTE;
}

export function classifyObservationRelation(caseData, observation = {}, context = {}, forcedAction = '') {
  if (identityConflicts(caseData, context)) return RouteRelation.FOREIGN;
  if (isTerminal(caseData)) return RouteRelation.SUPPORTING;

  const action = String(forcedAction || currentAction(caseData) || '');
  const type = String(observation?.type || '');
  const details = observation?.details || {};

  if (type === 'JUNIPER_SESSION') {
    return action === 'check_juniper' ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  if (type === 'POLL_RESULT') {
    if (isConfirmedPollObservation(caseData, observation, context)) {
      return RouteRelation.ON_ROUTE;
    }
    if (!POLL_ACTIONS.has(action)) return RouteRelation.OFF_ROUTE;
    const expected = String(details.expectedPollAction || expectedPollAction(caseData, context) || '');
    const actual = String(details.pollAction || openedPollAction(context) || '');
    if (details.wrongPollTab) return RouteRelation.OFF_ROUTE;
    if (expected && actual && expected !== actual) return RouteRelation.OFF_ROUTE;
    if (!details.requestObserved) return RouteRelation.OFF_ROUTE;
    return RouteRelation.ON_ROUTE;
  }

  if (type === 'TMC_RESULT') {
    return action === 'check_tmc' ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  if (type === 'CUSTOMER_MACS') {
    return ['check_tmc', 'search_mac', 'search_uplink_downlink'].includes(action)
      ? RouteRelation.ON_ROUTE
      : RouteRelation.OFF_ROUTE;
  }

  if (type === 'MAC_SEARCH_RESULT') {
    return ['search_mac', 'search_uplink_downlink'].includes(action)
      ? RouteRelation.ON_ROUTE
      : RouteRelation.OFF_ROUTE;
  }

  if (type === 'INTERFACE_CONFIRMATION') {
    return action === 'inspect_interface' ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  if (type === 'DEVICE_DETAILS') {
    return ['inspect_device', 'inspect_onu_details'].includes(action)
      ? RouteRelation.ON_ROUTE
      : RouteRelation.OFF_ROUTE;
  }

  if (type === 'ETHERNET_ACCESS_POINT') {
    return action === 'switch_port' ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  if (type === 'ETHERNET_DEVICE') {
    return ['switch_port', 'check_ethernet_fdb'].includes(action)
      ? RouteRelation.ON_ROUTE
      : RouteRelation.OFF_ROUTE;
  }

  if (type === 'ETHERNET_FDB_RESULT') {
    return action === 'check_ethernet_fdb' ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  if (type === 'ETHERNET_PORT_ERRORS') {
    return action === 'check_ethernet_errors' ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  if (['BILLING_OLT_SAVE_INTENT', 'BILLING_OLT_SAVED', 'BILLING_OLT_SAVE_FAILED'].includes(type)) {
    return SAVE_ACTIONS.has(action) ? RouteRelation.ON_ROUTE : RouteRelation.OFF_ROUTE;
  }

  return classifyContextRelation(caseData, context, action);
}

const PASSIVE_PON_FIELDS = new Set([
  'oltName',
  'oltIp',
  'onuMac',
  'onuSerial',
  'pollAction',
  'pollType',
  'locatedDeviceId',
  'locatedDeviceName',
  'locatedOltName',
  'locatedOltIp',
  'locatedInterface',
  'locatedIfIndex',
  'locatedSubscriberMac',
  'locatedPollType',
  'locatedPollAction',
  'tmcOltName',
  'tmcOltIp',
  'tmcOltDeviceId',
  'tmcPort',
  'tmcOnuMac',
  'tmcOnuSerial',
  'status',
  'rx',
  'tx',
  'distance'
]);

function shouldGatePonFacts(caseData, context, relation) {
  const pageKind = String(context?.pageKind || '');
  const action = currentAction(caseData);

  // Before a route exists we are still discovering the subscriber context.
  if (!action) return relation === RouteRelation.FOREIGN;
  if (pageKind === 'billing_technical') return false;

  if (pageKind === 'billing_onu_poll') {
    const poll = context?.meta?.poll || {};
    return !(
      relation === RouteRelation.ON_ROUTE
      && poll.requestObserved
      && !poll.wrongPollTab
      && poll.outcome === 'confirmed'
    );
  }

  if (pageKind === 'userside_customer') {
    if (isTerminal(caseData)) return false;
    return relation !== RouteRelation.ON_ROUTE;
  }

  if (['userside_customer_list', 'interface_mac_list', 'userside_device'].includes(pageKind)) {
    if (isTerminal(caseData)) return false;
    return relation !== RouteRelation.ON_ROUTE;
  }

  return relation === RouteRelation.FOREIGN;
}

export function gateContextForCommit(caseData, rawContext = {}, relation = null) {
  const context = JSON.parse(JSON.stringify(rawContext || {}));
  const effectiveRelation = relation || classifyContextRelation(caseData, context);
  const blockedFacts = [];

  if (shouldGatePonFacts(caseData, context, effectiveRelation) && context.pon && typeof context.pon === 'object') {
    for (const key of Object.keys(context.pon)) {
      if (!PASSIVE_PON_FIELDS.has(key)) continue;
      const value = factValue(context.pon[key]);
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        blockedFacts.push({ group: 'pon', key, value: String(value).slice(0, 220) });
      }
      delete context.pon[key];
    }
  }

  if (effectiveRelation === RouteRelation.FOREIGN) {
    // A foreign subscriber page must never overwrite the current case identity or
    // network binding. The caller may resolve it into a separate case instead.
    for (const group of ['identity', 'network', 'pon', 'profile']) {
      if (!context[group] || typeof context[group] !== 'object') continue;
      for (const [key, raw] of Object.entries(context[group])) {
        const value = factValue(raw);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          blockedFacts.push({ group, key, value: String(value).slice(0, 220) });
        }
      }
      context[group] = {};
    }
  }

  return {
    context,
    relation: effectiveRelation,
    blockedFacts
  };
}

export function routeControllerSnapshot(caseData, context = {}, forcedAction = '') {
  const action = String(forcedAction || currentAction(caseData) || '');
  return {
    requiredAction: action,
    relation: classifyContextRelation(caseData, context, action),
    terminal: isTerminal(caseData),
    expectedPollAction: expectedPollAction(caseData, context),
    openedPollAction: openedPollAction(context),
    subscriberMac: normalizeMac(factValue(caseData?.network?.mac))
  };
}

export const __test = Object.freeze({
  factValue,
  identityConflicts,
  expectedPollAction,
  openedPollAction,
  pollActionsMatch,
  isConfirmedPollContext,
  isConfirmedPollObservation,
  shouldGatePonFacts
});
