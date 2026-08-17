import assert from 'node:assert/strict';
import {
  RouteRelation,
  classifyContextRelation,
  classifyObservationRelation,
  gateContextForCommit
} from '../src/core/route-controller.js';
import {
  LocatorAction,
  LocatorObservationType,
  ensureLocatorShape,
  applyLocatorObservations
} from '../src/core/locator-policy.js';

const fact = value => ({ value, confidence: 0.99 });

function baseCase(action = LocatorAction.CHECK_TMC) {
  const c = {
    id: 'login:abon395581',
    identity: {
      login: fact('abon395581'),
      billingId: fact('39558')
    },
    network: {
      connectionFamily: fact('PON'),
      mac: fact('AA:BB:CC:DD:EE:01')
    },
    pon: {
      onuMac: fact('11:22:33:44:55:66'),
      pollAction: fact('313'),
      pollType: fact('Huawei')
    },
    profile: {},
    contexts: {},
    route: {},
    conflicts: []
  };
  const locator = ensureLocatorShape(c);
  locator.recommendation = { action, ruleId: 'test', reason: 'test', params: {} };
  return c;
}

// Regression: mandatory CHECK_TMC survives manual navigation to a poll page.
{
  const c = baseCase(LocatorAction.CHECK_TMC);
  const context = {
    system: 'billing',
    pageKind: 'billing_onu_poll',
    entityId: '39558',
    subview: 'a313',
    pon: {
      oltIp: fact('172.16.1.50'),
      oltName: fact('Some-Huawei')
    },
    meta: {
      poll: {
        openedAction: '313',
        expectedPollAction: '313',
        requestObserved: false,
        wrongPollTab: false,
        outcome: 'unknown'
      }
    }
  };
  const relation = classifyContextRelation(c, context);
  assert.equal(relation, RouteRelation.OFF_ROUTE);
  const gated = gateContextForCommit(c, context, relation);
  assert.equal(gated.context.pon.oltIp, undefined);
  assert.equal(gated.context.pon.oltName, undefined);
  assert.ok(gated.blockedFacts.some(item => item.key === 'oltIp'));
  assert.equal(c.locator.recommendation.action, LocatorAction.CHECK_TMC);
}

// TMC is on-route when it is actually required.
{
  const c = baseCase(LocatorAction.CHECK_TMC);
  const context = {
    system: 'userside',
    pageKind: 'userside_customer',
    identity: { login: fact('abon395581') },
    pon: { tmcOltIp: fact('172.16.1.50') },
    meta: { tmc: { checked: true, found: true } }
  };
  assert.equal(classifyContextRelation(c, context), RouteRelation.ON_ROUTE);
  const gated = gateContextForCommit(c, context, RouteRelation.ON_ROUTE);
  assert.ok(gated.context.pon.tmcOltIp);
}

// Wrong poll adapter stays passive even if somebody tries to claim a response.
{
  const c = baseCase(LocatorAction.POLL_CURRENT_BINDING);
  const context = {
    system: 'billing',
    pageKind: 'billing_onu_poll',
    entityId: '39558',
    subview: 'a311',
    meta: {
      poll: {
        openedAction: '311',
        expectedPollAction: '313',
        requestObserved: true,
        wrongPollTab: true,
        outcome: 'confirmed'
      }
    }
  };
  assert.equal(classifyContextRelation(c, context), RouteRelation.OFF_ROUTE);
  assert.equal(classifyObservationRelation(c, {
    type: LocatorObservationType.POLL_RESULT,
    result: 'confirmed',
    details: {
      pollAction: '311',
      expectedPollAction: '313',
      requestObserved: true,
      wrongPollTab: true,
      pollCompleted: true,
      pollResponded: true,
      uiStable: true
    }
  }, context), RouteRelation.OFF_ROUTE);
}

// The action pinned to the native request outranks a stale technology fact in
// the Case. This is the real G-COM naming case where an old GPON/a=311 value
// must not reject the valid a=312 response as an off-route tab.
{
  const c = baseCase(LocatorAction.POLL_CURRENT_BINDING);
  c.pon.oltName = fact('Vernadsky-24-GPON (172.16.1.250) G-COM');
  c.pon.pollType = fact('GPON');
  c.pon.pollAction = fact('311');
  const context = {
    system: 'billing',
    pageKind: 'billing_onu_poll',
    entityId: '39558',
    subview: 'a312',
    meta: {
      poll: {
        openedAction: '312',
        attemptAction: '312',
        expectedPollAction: '312',
        requestObserved: true,
        wrongPollTab: false,
        outcome: 'confirmed'
      }
    }
  };
  assert.equal(classifyContextRelation(c, context), RouteRelation.ON_ROUTE);
  assert.equal(classifyObservationRelation(c, {
    type: LocatorObservationType.POLL_RESULT,
    result: 'confirmed',
    details: {
      pollAction: '312',
      requestObserved: true,
      wrongPollTab: false
    }
  }, context), RouteRelation.ON_ROUTE);
}

// Locator itself rejects a fake confirmation even if a caller labels it confirmed.
{
  const c = baseCase(LocatorAction.POLL_CURRENT_BINDING);
  applyLocatorObservations(c, [{
    type: LocatorObservationType.POLL_RESULT,
    result: 'confirmed',
    routeRelation: RouteRelation.ON_ROUTE,
    details: {
      pollAction: '313',
      expectedPollAction: '313',
      requestObserved: false,
      wrongPollTab: false,
      pollCompleted: false,
      pollResponded: false,
      uiStable: true
    }
  }], { system: 'billing', pageKind: 'billing_onu_poll' });
  assert.equal(c.locator.termination, null);
  assert.equal(c.locator.evidence[0].passive, true);
  assert.equal(c.locator.evidence[0].passiveReason, 'invalid-poll-confirmation');
}

// A valid on-route, stable response still closes the route.
{
  const c = baseCase(LocatorAction.POLL_CURRENT_BINDING);
  c.pon.oltName = fact('Test-Huawei');
  c.pon.oltIp = fact('172.16.1.50');
  applyLocatorObservations(c, [{
    type: LocatorObservationType.POLL_RESULT,
    result: 'confirmed',
    routeRelation: RouteRelation.ON_ROUTE,
    details: {
      source: 'billing-poll',
      oltName: 'Test-Huawei',
      oltIp: '172.16.1.50',
      onuMac: '11:22:33:44:55:66',
      pollAction: '313',
      expectedPollAction: '313',
      requestObserved: true,
      wrongPollTab: false,
      pollCompleted: true,
      pollResponded: true,
      uiStable: true,
      observed: { onuSerial: 'TEST1234', interface: 'GPON0/1/1:1' }
    }
  }], { system: 'billing', pageKind: 'billing_onu_poll' });
  assert.equal(c.locator.termination?.status, 'confirmed');
}

// A real manual poll closes the acquisition route even when Guide still points
// to Juniper. The exact response guards are required; merely opening a tab is not.
{
  const c = baseCase(LocatorAction.CHECK_JUNIPER);
  c.pon.oltName = fact('Test-Huawei');
  c.pon.oltIp = fact('172.16.1.50');
  const context = {
    system: 'billing',
    pageKind: 'billing_onu_poll',
    entityId: '39558',
    subview: 'a313',
    meta: {
      poll: {
        openedAction: '313',
        attemptAction: '313',
        expectedPollAction: '313',
        requestObserved: true,
        responseEvidence: true,
        wrongPollTab: false,
        outcome: 'confirmed'
      }
    }
  };
  const observation = {
    type: LocatorObservationType.POLL_RESULT,
    result: 'confirmed',
    details: {
      source: 'billing-poll',
      oltName: 'Test-Huawei',
      oltIp: '172.16.1.50',
      onuMac: '11:22:33:44:55:66',
      pollAction: '313',
      expectedPollAction: '313',
      requestObserved: true,
      responseEvidence: true,
      wrongPollTab: false,
      pollCompleted: true,
      pollResponded: true,
      uiStable: true,
      observed: { onuSerial: 'TEST1234', interface: 'GPON0/1/1:1' }
    }
  };
  assert.equal(classifyContextRelation(c, context), RouteRelation.ON_ROUTE);
  assert.equal(classifyObservationRelation(c, observation, context), RouteRelation.ON_ROUTE);
  observation.routeRelation = RouteRelation.ON_ROUTE;
  applyLocatorObservations(c, [observation], context);
  assert.equal(c.locator.termination?.status, 'confirmed');
}


// Juniper prefetch is on-route only while the dedicated first step is active.
{
  const c = baseCase(LocatorAction.CHECK_JUNIPER);
  const context = {
    system: 'billing',
    pageKind: 'billing_user',
    entityId: '39558'
  };
  const observation = {
    type: LocatorObservationType.JUNIPER_SESSION,
    result: 'online',
    details: { status: 'online', subscriberIp: '10.0.0.25', hasTraffic: true }
  };
  assert.equal(
    classifyObservationRelation(c, observation, context),
    RouteRelation.ON_ROUTE
  );
  c.locator.recommendation = { action: LocatorAction.OPEN_TECHNICAL, ruleId: 'test', reason: 'test', params: {} };
  assert.equal(
    classifyObservationRelation(c, observation, context),
    RouteRelation.OFF_ROUTE
  );
}

console.log('route_controller_unit_test: PASS');
