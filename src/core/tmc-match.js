(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const valueOf = fact => (
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact
  );

  const normalizeMac = value => {
    const hex = String(value || '')
      .replace(/[^0-9a-f]/gi, '')
      .toUpperCase();
    return hex.length === 12 ? hex : '';
  };

  const normalizeSerial = value => String(value || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

  function expected(caseData) {
    return {
      mac: normalizeMac(valueOf(caseData?.pon?.onuMac) || ''),
      serial: normalizeSerial(valueOf(caseData?.pon?.onuSerial) || '')
    };
  }

  function observed(item = {}) {
    return {
      mac: normalizeMac(item.mac || item.onuMac || ''),
      serial: normalizeSerial(item.serial || item.onuSerial || '')
    };
  }

  function stateFor(expectedValue, observedValue) {
    if (!expectedValue) return 'not_required';
    if (!observedValue) return 'missing';
    return expectedValue === observedValue ? 'match' : 'mismatch';
  }

  function compare(item, caseData) {
    const wanted = expected(caseData);
    const actual = observed(item);
    const mac = stateFor(wanted.mac, actual.mac);
    const serial = stateFor(wanted.serial, actual.serial);
    const required = [wanted.mac, wanted.serial].filter(Boolean).length;
    const states = [mac, serial].filter(state => state !== 'not_required');
    const matchedCount = states.filter(state => state === 'match').length;
    const mismatchCount = states.filter(state => state === 'mismatch').length;
    const missingCount = states.filter(state => state === 'missing').length;

    return {
      expected: wanted,
      observed: actual,
      mac,
      serial,
      required,
      matchedCount,
      mismatchCount,
      missingCount,
      // Identity comparison is informational and is used to rank TMC blocks.
      // OLT discovery itself is not blocked by a mismatch or missing identifier.
      isMatch: required > 0 && matchedCount === required,
      isPartial: matchedCount > 0 && matchedCount < required,
      hasConflict: mismatchCount > 0,
      hasMissing: missingCount > 0
    };
  }

  function score(item, caseData) {
    const result = compare(item, caseData);
    let value = 0;
    if (result.mac === 'match') value += 100;
    if (result.serial === 'match') value += 100;
    if (result.mac === 'mismatch') value -= 140;
    if (result.serial === 'mismatch') value -= 140;
    if (result.mac === 'missing') value -= 40;
    if (result.serial === 'missing') value -= 40;
    if (item?.oltName) value += 10;
    if (item?.oltIp) value += 10;
    if (item?.interface) value += 5;
    return { value, ...result };
  }

  function resultLabel(comparison) {
    if (comparison?.isMatch) return 'matched';
    if (comparison?.hasConflict) return 'identity_mismatch';
    if (comparison?.isPartial || comparison?.hasMissing) return 'identity_incomplete';
    return 'ambiguous';
  }

  WB.tmcMatch = {
    normalizeMac,
    normalizeSerial,
    expected,
    observed,
    compare,
    score,
    resultLabel
  };
})();
