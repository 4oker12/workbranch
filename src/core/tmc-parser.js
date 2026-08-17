(() => {
  'use strict';

  const API_VERSION = '1.2.0';
  const DOM_TRACE_MAX_LEVELS = 4;
  const DOM_TRACE_MAX_NODES = 220;
  const DOM_TRACE_MAX_TEXT = 12000;

  const compact = (value, max = 300) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const normalizeMac = value => {
    const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (hex.length !== 12) return '';
    return hex.match(/.{2}/g).join(':');
  };

  const normalizeSerial = value => String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();

  const validIp = value => {
    const text = String(value || '').trim();
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) return '';
    const parts = text.split('.').map(Number);
    return parts.some(part => part < 0 || part > 255) ? '' : text;
  };

  const textOf = element => compact(
    element?.innerText || element?.textContent || '',
    5000
  );

  const hasTmcPhrase = text => /(?:найдено|знайдено)\s+на\s+olt/i.test(String(text || ''));

  function findBlocks(root) {
    if (!root?.querySelectorAll) return [];
    const all = [...root.querySelectorAll('tr,td,div')]
      .filter(element => hasTmcPhrase(textOf(element)));

    const withDeviceLink = all.filter(element =>
      element.querySelector?.('a[href*="/device/"]')
    );

    // Prefer the smallest element that still contains the OLT device link.
    // This mirrors the live UserSide adapter and avoids grabbing the whole page.
    const source = withDeviceLink.length ? withDeviceLink : all;
    return source.filter(element => !source.some(other => (
      other !== element
      && element.contains?.(other)
      && hasTmcPhrase(textOf(other))
      && (!withDeviceLink.length || other.querySelector?.('a[href*="/device/"]'))
    )));
  }

  function chooseOltLink(block) {
    const anchors = [...(block?.querySelectorAll?.('a[href*="/device/"]') || [])];
    if (!anchors.length) return null;
    return anchors.find(anchor => {
      const label = compact(anchor.innerText || anchor.textContent || '', 220);
      return /\bOLT\b|Huawei|BDCOM|GCOM|ZTE|MA\d{3,5}|GP\d{3,5}|P36\d+/i.test(label)
        && !/история|history/i.test(label);
    }) || anchors.find(anchor => {
      const label = compact(anchor.innerText || anchor.textContent || '', 220);
      return label && !/история|history/i.test(label);
    }) || null;
  }

  function parseBlock(block, helpers = {}) {
    const compactFn = helpers.compact || compact;
    const validIpFn = helpers.validIp || validIp;
    const normalizeMacFn = helpers.normalizeMac || normalizeMac;
    const normalizeSerialFn = helpers.normalizeSerial || normalizeSerial;
    const text = compactFn(
      block?.innerText || block?.textContent || '',
      5000
    );

    // UserSide AJAX fragments often collapse label boundaries in textContent,
    // e.g. `S/N: FGXP15A2CB5FMAC:B4:64:...`.  Do not let the Serial
    // capture consume the following MAC label and do not require whitespace
    // before `MAC`.
    const serialMatch = text.match(
      /(?:s\/n|serial|серийн\w*|серійн\w*)\s*[:#]?\s*([A-Z0-9:-]{6,64}?)(?=\s*(?:MAC\s*[:#]|IP\s*:|Interface\s*:|(?:найдено|знайдено)\s+на\s+OLT|$))/i
    );
    const serial = String(serialMatch?.[1] || '').replace(/[:#\s]+$/g, '').toUpperCase();

    const macMatch = text.match(
      /MAC\s*[:#]?\s*((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{12})/i
    );
    const mac = normalizeMacFn(macMatch?.[1] || '');

    const oltLink = chooseOltLink(block);
    let oltName = compactFn(
      oltLink?.innerText || oltLink?.textContent || '',
      220
    );

    // Some customer/tab responses render the OLT as text rather than a useful
    // anchor. Keep the same semantic marker and recover the label from text.
    if (!oltName) {
      oltName = compactFn(
        text.match(
          /(?:найдено|знайдено)\s+на\s+OLT\s*:\s*(?:\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}\s*)?(.{1,220}?)(?=\s+IP\s*:|\s+Interface\s*:|\s+MAC\s*:|\s+(?:S\/N|Serial)\s*:|$)/i
        )?.[1] || '',
        220
      );
    }
    if (/^(?:IP\b|Interface\b|MAC\b|S\/N\b|Serial\b|нет\b|відсут|отсутств)/i.test(oltName)) {
      oltName = '';
    }

    const deviceMatch = String(
      oltLink?.getAttribute?.('href') || ''
    ).match(/\/device\/(\d+)/i);

    let oltIp = validIpFn(
      text.match(
        /(?:^|\s)IP\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i
      )?.[1] || ''
    );
    if (!oltIp) {
      const afterPhrase = text.split(/(?:найдено|знайдено)\s+на\s+olt/i)[1] || '';
      oltIp = validIpFn(afterPhrase.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '');
    }

    const iface = compactFn(
      text.match(
        /Interface\s*:\s*([^\n\r]+?)(?=\s+Расстояние|\s+Distance|\s+ONU\s+Rx|\s+MAC\s*:|\s+(?:S\/N|Serial)\s*:|$)/i
      )?.[1] || '',
      120
    );

    return {
      element: block || null,
      text,
      phraseFound: hasTmcPhrase(text),
      deviceLinkFound: Boolean(oltLink),
      serial,
      serialKey: normalizeSerialFn(serial),
      mac,
      oltName,
      oltIp,
      deviceId: deviceMatch?.[1] || '',
      interface: iface
    };
  }

  function nodeLabel(element) {
    if (!element) return '';
    const tag = String(element.tagName || '').toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const cls = String(element.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(x => `.${x}`).join('');
    return `${tag}${id}${cls}` || 'node';
  }

  function scopeStats(element) {
    const text = textOf(element);
    let nodes = 1;
    try { nodes = 1 + Number(element?.querySelectorAll?.('*')?.length || 0); } catch {}
    return { nodes, textLength: text.length };
  }

  function sameIdentity(base, candidate) {
    if (!base || !candidate) return false;
    if (base.deviceId && candidate.deviceId) return base.deviceId === candidate.deviceId;
    if (base.serialKey && candidate.serialKey) return base.serialKey === candidate.serialKey;
    if (base.mac && candidate.mac) return base.mac === candidate.mac;
    return false;
  }

  // Diagnostic-only bounded DOM escalation. It never walks to body/document and
  // never replaces the primary value with an unanchored value from a wider scope.
  function buildDomTrace(startElement, baseItem, helpers = {}) {
    const levels = [];
    let current = startElement || null;
    const ownerDoc = startElement?.ownerDocument || null;
    let level = 0;
    while (current && level < DOM_TRACE_MAX_LEVELS) {
      if (current === ownerDoc?.body || current === ownerDoc?.documentElement) {
        levels.push({ level, scope: nodeLabel(current), status: 'BOUNDARY_REACHED', reason: 'page_root_forbidden' });
        break;
      }
      const stats = scopeStats(current);
      if (stats.nodes > DOM_TRACE_MAX_NODES || stats.textLength > DOM_TRACE_MAX_TEXT) {
        levels.push({ level, scope: nodeLabel(current), status: 'BOUNDARY_REACHED', reason: 'scope_too_large', ...stats });
        break;
      }
      const parsed = parseBlock(current, helpers);
      const anchors = [parsed.deviceId ? `device:${parsed.deviceId}` : '', parsed.serialKey ? `serial:${parsed.serialKey}` : '', parsed.mac ? `mac:${parsed.mac}` : ''].filter(Boolean);
      const anchored = level === 0 || sameIdentity(baseItem, parsed);
      levels.push({
        level,
        scope: nodeLabel(current),
        status: anchored ? 'OBSERVED' : 'AMBIGUOUS',
        anchored,
        anchors,
        seen: { serial: parsed.serial || '', mac: parsed.mac || '', oltName: parsed.oltName || '', oltIp: parsed.oltIp || '', interface: parsed.interface || '', deviceId: parsed.deviceId || '' },
        ...stats
      });
      const parent = current.parentElement;
      if (!parent || parent === ownerDoc?.body || parent === ownerDoc?.documentElement) break;
      current = parent;
      level += 1;
    }
    const confirmed = levels.filter(x => x.anchored).length;
    return {
      maxLevels: DOM_TRACE_MAX_LEVELS,
      levels,
      sourceLevel: 0,
      confidence: baseItem?.deviceId || (baseItem?.serialKey && baseItem?.mac) ? 'high' : (baseItem?.serialKey || baseItem?.mac || baseItem?.oltIp ? 'medium' : 'low'),
      confirmationLevels: confirmed,
      finalStatus: baseItem && (baseItem.serial || baseItem.mac || baseItem.oltName || baseItem.oltIp) ? 'FOUND' : (levels.some(x => x.status === 'AMBIGUOUS') ? 'AMBIGUOUS' : 'NOT_FOUND')
    };
  }

  function scoreCandidate(item, expected = {}) {
    let score = 0;
    if (item?.phraseFound) score += 200;
    if (item?.oltIp) score += 100;
    if (item?.oltName) score += 80;
    if (item?.deviceLinkFound) score += 40;

    const expectedSerial = normalizeSerial(expected.onuSerial || expected.serial || '');
    const expectedMac = normalizeMac(expected.onuMac || expected.mac || '');
    if (expectedSerial && item?.serialKey) score += item.serialKey === expectedSerial ? 140 : -20;
    if (expectedMac && item?.mac) score += item.mac === expectedMac ? 140 : -20;
    return score;
  }

  function parseDocument(root, options = {}) {
    const blocks = findBlocks(root);
    const candidates = blocks
      .map(block => {
        const item = parseBlock(block, options.helpers || {});
        return { item, score: scoreCandidate(item, options.expected || {}) };
      })
      .sort((a, b) => b.score - a.score);

    const best = candidates.find(entry => entry.item.oltName || entry.item.oltIp) || null;
    const phraseFound = candidates.some(entry => entry.item.phraseFound);
    const deviceLinkFound = candidates.some(entry => entry.item.deviceLinkFound);

    const item = best?.item || null;
    const domTrace = item?.element ? buildDomTrace(item.element, item, options.helpers || {}) : { maxLevels: DOM_TRACE_MAX_LEVELS, levels: [], sourceLevel: null, confidence: 'low', confirmationLevels: 0, finalStatus: phraseFound ? 'AMBIGUOUS' : 'NOT_FOUND' };

    return {
      parserVersion: API_VERSION,
      result: best ? 'found' : (phraseFound ? 'unparsed' : 'missing'),
      blockFound: phraseFound,
      deviceLinkFound,
      candidateCount: candidates.length,
      item,
      domTrace,
      candidates
    };
  }

  const api = {
    version: API_VERSION,
    hasTmcPhrase,
    findBlocks,
    parseBlock,
    parseDocument,
    buildDomTrace,
    normalizeMac,
    normalizeSerial,
    validIp,
    compact
  };

  globalThis.SIMNET_TMC_PARSER = api;
  if (globalThis.SIMNET_WB) globalThis.SIMNET_WB.tmcParser = api;
})();
