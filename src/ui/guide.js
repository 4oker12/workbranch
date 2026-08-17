(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const OVERLAY_ID = 'simnet-workbench-guide-overlay';

  const valueOf = fact =>
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact;

  const normalizeMac = value =>
    String(value || '')
      .replace(/[^0-9a-f]/gi, '')
      .toUpperCase();

  const normalizeSerial = value =>
    String(value || '')
      .replace(/[^0-9a-z]/gi, '')
      .toUpperCase();

  const pageInfo = () => {
    const system = WB.contextEngine.detectSystem();
    const detected = WB.contextEngine.detectPageKind(system);
    return {
      system,
      pageKind: detected.kind,
      entityId: detected.entityId,
      subview: detected.subview || ''
    };
  };

  function parseUrl(anchor) {
    try {
      return new URL(anchor.href, location.href);
    } catch {
      return null;
    }
  }

  function findTechnicalDataLink(caseData) {
    const billingId = String(
      valueOf(caseData?.identity?.billingId) || ''
    );

    return [...document.querySelectorAll('a[href]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        if (!url) return false;

        return (
          /\/adm\.pl$/i.test(url.pathname)
          && url.searchParams.get('a') === 'dopdata'
          && url.searchParams.get('parent_type') === '0'
          && url.searchParams.get('tmpl') === '1'
          && (
            !billingId
            || url.searchParams.get('id') === billingId
          )
        );
      }) || null;
  }

  function findUsersideLink(caseData) {
    const expectedIp = String(
      valueOf(caseData?.network?.ip) || ''
    );

    return [...document.querySelectorAll('a[href]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        if (!url) return false;

        const isHandoff = (
          url.hostname === 'userside.simnet.kiev.ua'
          && /\/script\/gotouser\.php$/i.test(url.pathname)
        );

        return (
          isHandoff
          && (
            !expectedIp
            || url.searchParams.get('ip') === expectedIp
          )
        );
      }) || null;
  }


  function findJuniperLink(caseData) {
    const billingId = String(valueOf(caseData?.identity?.billingId) || '');
    return [...document.querySelectorAll('a[href]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        if (!url) return false;
        return /\/stat\.pl$/i.test(url.pathname)
          && url.searchParams.get('a') === '252'
          && !url.searchParams.get('act')
          && /Juniper\s*\(NEW\)/i.test(String(anchor.textContent || ''))
          && (!billingId || url.searchParams.get('id') === billingId);
      })
      || [...document.querySelectorAll('a[href*="a=252"]')]
        .find(anchor => !parseUrl(anchor)?.searchParams.get('act'))
      || null;
  }

  function findJuniperSessionBlock() {
    const candidates = [
      ...document.querySelectorAll('table.table10, div.message table, div.message')
    ];
    return candidates.find(node => {
      const text = String(node.textContent || '').replace(/\s+/g, ' ');
      return /Статус\s+сесії|Джерело\s+сесії|\bBRAS\s*-|сесія\s+є\s+в\s+Radius/i.test(text);
    }) || null;
  }

  function findJuniperSemanticNode(pattern) {
    const block = findJuniperSessionBlock();
    if (!block) return null;
    const candidates = [
      ...block.querySelectorAll('tr,[role="row"],li,p,.row,.form-group,div')
    ].filter(node => pattern.test(String(node.textContent || '').replace(/\s+/g, ' ')));
    candidates.sort((a, b) => (
      String(a.textContent || '').length - String(b.textContent || '').length
    ));
    return candidates[0] || block;
  }

  function findJuniperStatusTarget() {
    return findJuniperSemanticNode(/Статус\s+сесії|сесія\s+є\s+в\s+Radius/i)
      || findJuniperSessionBlock();
  }

  function findJuniperRelatedTargets() {
    const primary = findJuniperStatusTarget();
    const definitions = [
      ['Привязка', /\bBRAS\s*-|Джерело\s+сесії|\bUSERNAME\s*-|\bVLAN\s*-/i],
      ['Трафик', /Швидкість\s+прийом|Байти\s+прийнято/i],
      ['Время', /Час\s+старту|Час\s+останньої\s+події|Остання\s+подія/i]
    ];
    const seen = new Set(primary ? [primary] : []);
    return definitions.map(([label, pattern]) => {
      const element = findJuniperSemanticNode(pattern);
      if (!element || seen.has(element)) return null;
      seen.add(element);
      return { element, label };
    }).filter(Boolean);
  }

  function juniperEducation(caseData) {
    const source = caseData?.locator?.sourceStatus?.juniper
      || caseData?.locator?.sourceStatus?.juniperPreview
      || null;
    const details = source?.details || {};
    const status = String(details.status || source?.result || 'unknown');
    const traffic = details.hasTraffic === true
      ? 'Сейчас есть обмен пакетами.'
      : details.hasTraffic === false
        ? 'В момент снимка заметного обмена пакетами нет.'
        : 'Текущий обмен пакетами не определён.';
    const state = status === 'online'
      ? `Сессия online. ${traffic}`
      : details.staleRadius
        ? 'Radius помнит сессию, но на BRAS она не найдена: активную L3-сессию считать подтверждённой нельзя.'
        : status === 'offline'
          ? 'Сессия offline. Это L3-состояние; ONU/OLT проверяем отдельно.'
          : source?.result === 'no_session'
            ? 'Активная Juniper-сессия не найдена. Это не равнозначно отсутствию линка ONU.'
            : 'Juniper даёт L3-снимок абонента; выводы по ONU/оптике делаются на следующих шагах.';
    const facts = [
      details.subscriberIp ? `IP ${details.subscriberIp}` : '',
      details.subscriberMac ? `MAC ${details.subscriberMac}` : '',
      details.brasName ? `BRAS ${details.brasName}` : '',
      details.startTime ? `старт ${details.startTime}` : '',
      details.vlan ? `VLAN ${details.vlan}` : ''
    ].filter(Boolean).join(' · ');
    return `${state}${facts ? ` ${facts}.` : ''}`;
  }

  function findOltField() {
    const select = document.querySelector(
      'select#dopfield_29,select[name="dopfield_29"]'
    );

    if (!select) return null;

    const row = select.closest('tr');
    const visual = row?.querySelector(
      '.selectize-control,.selectize-input'
    );

    return visual || row || select;
  }


  function oltLookupTransliterate(value) {
    const map = {
      а:'a',б:'b',в:'v',г:'g',ґ:'g',д:'d',е:'e',ё:'e',є:'e',ж:'zh',з:'z',и:'i',і:'i',ї:'i',й:'i',
      к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',
      щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya',ь:'',ъ:''
    };
    return String(value || '').toLowerCase().split('').map(ch => map[ch] ?? ch).join('');
  }

  function canonicalOltLookupText(value) {
    return oltLookupTransliterate(value)
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function oltLookupTokens(value) {
    const stop = new Set([
      'bdcom','huawei','gcom','olt','onu','ont','gpon','epon','pon','core','agg',
      'device','oborudovanie','equipment','kiev','kyiv','ul','ulitsa','prov','pereulok',
      's','c','p','podval','podvaln','etazh','floor'
    ]);
    return canonicalOltLookupText(value)
      .split(' ')
      .filter(token => token.length >= 4 && !stop.has(token) && !/^p\d{3,}/.test(token));
  }

  function oltTechnologyTag(value) {
    const text = String(value || '');
    if (/huawei/i.test(text)) return 'huawei';
    if (/\bgcom\b/i.test(text)) return 'gcom';
    if (/\bgpon\b/i.test(text)) return 'gpon';
    if (/\bepon\b|bdcom\s+olt\s+p36/i.test(text)) return 'epon';
    return '';
  }

  function scoreOltOption(candidateName, optionText) {
    const candidate = canonicalOltLookupText(candidateName);
    const option = canonicalOltLookupText(optionText);
    if (!candidate || !option) return 0;

    const candidateTech = oltTechnologyTag(candidateName);
    const optionTech = oltTechnologyTag(optionText);
    if (candidateTech && optionTech && candidateTech !== optionTech) return 0;

    let score = 0;
    if (candidate === option) score = 100;
    else if (candidate.includes(option) || option.includes(candidate)) score = 88;

    const candidateTokens = oltLookupTokens(candidateName);
    const optionTokens = oltLookupTokens(optionText);
    const optionSet = new Set(optionTokens);
    const shared = candidateTokens.filter(token => optionSet.has(token));
    const longestShared = shared.reduce((max, token) => Math.max(max, token.length), 0);
    score = Math.max(score, shared.length * 24 + Math.min(22, longestShared * 2));
    if (candidateTech && optionTech && candidateTech === optionTech) score += 12;

    // Common transliteration difference: Хотов -> Hotov/Khotov. Accept the same
    // unique location stem without making a weak generic match decisive.
    for (const cToken of candidateTokens) {
      for (const oToken of optionTokens) {
        const c = cToken.replace(/^kh/, 'h');
        const o = oToken.replace(/^kh/, 'h');
        if (c.length >= 5 && o.length >= 5 && (c === o || c.includes(o) || o.includes(c))) {
          score = Math.max(score, 64 + Math.min(18, Math.min(c.length, o.length) * 2));
        }
      }
    }
    return Math.min(120, score);
  }

  function selectizeLookupContext(select) {
    if (!(select instanceof Element)) return null;
    const row = select.closest('tr');
    const control = row?.querySelector('.selectize-control')
      || select.parentElement?.querySelector?.('.selectize-control')
      || null;
    if (!control) return null;
    const display = control.querySelector('.selectize-input');
    const input = display?.querySelector('input') || control.querySelector('input');
    const dropdown = control.querySelector('.selectize-dropdown')
      || row?.querySelector('.selectize-dropdown')
      || null;
    return { control, display, input, dropdown };
  }

  function selectizeInstance(select, context = selectizeLookupContext(select)) {
    if (!(select instanceof Element)) return null;
    // Selectize exposes the live instance on the original <select> in the
    // Billing build. Keep two read-only fallbacks for older wrappers, but never
    // fabricate an instance or depend on jQuery being globally exported.
    return select.selectize
      || context?.control?.selectize
      || context?.display?.selectize
      || null;
  }

  let selectizeFocusSink = null;
  let selectizeFocusSinkTimer = 0;

  function selectizeRuntimeNodes(select, context = selectizeLookupContext(select)) {
    const instance = selectizeInstance(select, context);
    const jqNode = value => value?.[0] instanceof Element ? value[0] : null;
    return {
      instance,
      control: jqNode(instance?.$control) || context?.control || null,
      display: jqNode(instance?.$control) || context?.display || null,
      input: jqNode(instance?.$control_input) || context?.input || null,
      dropdown: jqNode(instance?.$dropdown) || context?.dropdown || null
    };
  }

  function parkFocusAwayFromSelectize(select) {
    const nodes = selectizeRuntimeNodes(select);
    if (!nodes.control && !nodes.input) return false;
    try {
      if (document.activeElement && (nodes.control?.contains?.(document.activeElement) || document.activeElement === nodes.input)) {
        document.activeElement.blur?.();
      }
    } catch {}

    // Keep the focus sink alive for the whole bounded Selectize settle window.
    // Removing it in a microtask allowed the legacy widget to restore focus to
    // its search input one frame later and reopen the OLT option list.
    if (!(selectizeFocusSink instanceof Element) || !selectizeFocusSink.isConnected) {
      selectizeFocusSink = document.createElement('span');
      selectizeFocusSink.dataset.simnetWbOwned = '1';
      selectizeFocusSink.dataset.simnetWbFocusSink = 'selectize';
      selectizeFocusSink.tabIndex = -1;
      Object.assign(selectizeFocusSink.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        left: '-10000px',
        top: '-10000px',
        opacity: '0',
        pointerEvents: 'none'
      });
      (document.body || document.documentElement).appendChild(selectizeFocusSink);
    }
    try { selectizeFocusSink.focus({ preventScroll: true }); } catch { try { selectizeFocusSink.focus(); } catch {} }
    if (selectizeFocusSinkTimer) window.clearTimeout(selectizeFocusSinkTimer);
    selectizeFocusSinkTimer = window.setTimeout(() => {
      selectizeFocusSink?.remove?.();
      selectizeFocusSink = null;
      selectizeFocusSinkTimer = 0;
    }, 450);
    return true;
  }

  function closeSelectizeLookup(select) {
    const context = selectizeLookupContext(select);
    if (!context) return false;
    const nodes = selectizeRuntimeNodes(select, context);
    const { instance, control, display, input, dropdown } = nodes;

    if (instance) {
      if (typeof instance.close === 'function') { try { instance.close(); } catch {} }
      try { instance.blur?.(); } catch {}
      // Selectize keeps these flags/classes independently from DOM visibility in
      // some Billing builds. Normalize both the API state and its live jQuery DOM.
      try { instance.isOpen = false; } catch {}
      try { instance.$control_input?.trigger?.('blur'); } catch {}
      try { instance.$dropdown?.removeClass?.('active').hide?.(); } catch {}
      try { instance.$control?.removeClass?.('focus input-active dropdown-active'); } catch {}
    }

    // Escape+blur handles builds where the API object exists but its internal
    // state lags behind the rendered dropdown.
    if (input) {
      try {
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' }));
      } catch {}
      try { input.blur?.(); } catch {}
      try { input.setAttribute('aria-expanded', 'false'); } catch {}
    }
    try {
      if (document.activeElement && (control?.contains?.(document.activeElement) || document.activeElement === input)) {
        document.activeElement.blur?.();
      }
    } catch {}

    display?.classList?.remove('dropdown-active', 'focus', 'input-active');
    control?.classList?.remove('dropdown-active', 'focus', 'input-active');
    dropdown?.classList?.remove('active');
    if (dropdown) {
      dropdown.style.display = 'none';
      dropdown.setAttribute('aria-hidden', 'true');
    }
    return true;
  }

  function settleSelectizeAfterProgrammaticSelection(select) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const settle = () => {
      closeSelectizeLookup(select);
      parkFocusAwayFromSelectize(select);
    };
    settle();
    const raf = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    raf(() => {
      settle();
      raf(settle);
    });
    // Legacy Billing can repaint Selectize after its change handlers complete.
    // Two delayed closes are still bounded and leave no permanent observer/timer.
    window.setTimeout(settle, 60);
    window.setTimeout(settle, 180);
    return true;
  }

  function selectizeCandidateNodes(context) {
    if (!context) return [];
    const local = context.dropdown
      ? [...context.dropdown.querySelectorAll('[data-value]')]
      : [];
    if (local.length) return local;
    // Some old Selectize builds append the dropdown next to the control/body.
    return [...document.querySelectorAll('.selectize-dropdown [data-value]')]
      .filter(node => {
        const dropdown = node.closest('.selectize-dropdown');
        if (!dropdown) return false;
        const owner = dropdown.previousElementSibling;
        return owner === context.control || context.control.contains(owner) || owner?.contains?.(context.control);
      });
  }

  function triggerSelectizeOltLookup(select, candidateIp = '', candidateName = '') {
    const context = selectizeLookupContext(select);
    if (!context) return { status: 'unavailable', context: null };
    if (context.display) dispatchSyntheticClick(context.display);

    const query = String(candidateIp || candidateName || '').trim();
    if (context.input && query) {
      const current = String(context.input.value || '').trim();
      if (current !== query) {
        try {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(context.input, query);
          else context.input.value = query;
        } catch {
          context.input.value = query;
        }
        context.input.dispatchEvent(new Event('input', { bubbles: true }));
        context.input.dispatchEvent(new KeyboardEvent('keyup', {
          bubbles: true,
          cancelable: true,
          key: query.slice(-1) || '0'
        }));
      }
    }
    return { status: 'triggered', context };
  }

  function rankOltOptionNodes(nodes, candidateName = '', candidateIp = '') {
    const prepared = nodes
      .map(node => ({
        node,
        value: String(node.getAttribute?.('data-value') || node.value || ''),
        text: String(node.textContent || '').replace(/\s+/g, ' ').trim()
      }))
      .filter(item => item.value && item.text);
    const ipMatches = candidateIp
      ? prepared.filter(item => item.text.includes(candidateIp))
      : [];
    if (ipMatches.length === 1) return { status: 'unique', item: ipMatches[0], score: 120 };
    const ranked = prepared
      .map(item => ({ ...item, score: scoreOltOption(candidateName, item.text) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0] || null;
    const second = ranked[1] || null;
    if (!best || best.score < 60) return { status: 'not_found', ranked: ranked.slice(0, 3) };
    if (second && second.score >= best.score - 10) return { status: 'ambiguous', ranked: ranked.slice(0, 3) };
    return { status: 'unique', item: best, score: best.score };
  }

  function resolveOltOptionByName(caseData) {
    const select = document.querySelector('select#dopfield_29,select[name="dopfield_29"]');
    const candidate = recommendedCandidate(caseData) || recommendation(caseData)?.params?.candidate || {};
    const expected = recommendation(caseData)?.params?.expectedTechnical || {};
    const candidateName = String(
      candidate.oltName
      || expected.oltName
      || valueOf(caseData?.pon?.tmcOltName)
      || ''
    ).trim();
    const candidateIp = String(
      candidate.oltIp
      || expected.oltIp
      || valueOf(caseData?.pon?.tmcOltIp)
      || ''
    ).trim();
    if (!select || (!candidateName && !candidateIp)) {
      return { status: 'unavailable', select, candidateName, candidateIp };
    }

    const options = [...select.options].filter(option => {
      const text = String(option.textContent || '').replace(/\s+/g, ' ').trim();
      return option.value && option.value !== '0' && text && !/выбер|оберіть|не\s+указ|нет\s+данн/i.test(text);
    });
    const nativeRanked = rankOltOptionNodes(options, candidateName, candidateIp);
    if (nativeRanked.status === 'unique') {
      return {
        status: 'unique',
        select,
        candidateName,
        candidateIp,
        option: nativeRanked.item.node,
        optionValue: nativeRanked.item.value,
        optionText: nativeRanked.item.text,
        score: nativeRanked.score,
        resolvedBy: candidateIp && nativeRanked.item.text.includes(candidateIp) ? 'native-ip' : 'native-name'
      };
    }

    // Billing uses Selectize. In production the native <select> can contain only
    // the placeholder until the widget is opened/searched. The previous bridge
    // treated that state as a definitive miss and silently dropped the pending
    // writeback. Open/search the real widget and let the caller retry while its
    // option list is being populated.
    const lookup = triggerSelectizeOltLookup(select, candidateIp, candidateName);
    const selectizeNodes = selectizeCandidateNodes(lookup.context);
    const selectizeRanked = rankOltOptionNodes(selectizeNodes, candidateName, candidateIp);
    if (selectizeRanked.status === 'unique') {
      return {
        status: 'unique',
        select,
        candidateName,
        candidateIp,
        dropdownOption: selectizeRanked.item.node,
        optionValue: selectizeRanked.item.value,
        optionText: selectizeRanked.item.text,
        score: selectizeRanked.score,
        resolvedBy: candidateIp && selectizeRanked.item.text.includes(candidateIp) ? 'selectize-ip' : 'selectize-name'
      };
    }
    if (selectizeNodes.length) {
      return {
        status: selectizeRanked.status,
        select,
        candidateName,
        candidateIp,
        ranked: selectizeRanked.ranked || nativeRanked.ranked || [],
        resolvedBy: 'selectize-options'
      };
    }
    if (lookup.status === 'triggered') {
      return {
        status: 'not_ready',
        select,
        candidateName,
        candidateIp,
        ranked: nativeRanked.ranked || [],
        resolvedBy: 'selectize-loading'
      };
    }
    return {
      status: nativeRanked.status,
      select,
      candidateName,
      candidateIp,
      ranked: nativeRanked.ranked || []
    };
  }

  function dispatchSyntheticClick(element) {
    if (!(element instanceof Element)) return;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function applyOltOptionSelection(match) {
    const select = match?.select;
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = match?.option instanceof HTMLOptionElement ? match.option : null;
    const dropdownOption = match?.dropdownOption instanceof Element ? match.dropdownOption : null;
    const value = String(match?.optionValue || option?.value || dropdownOption?.getAttribute?.('data-value') || '');
    const text = String(match?.optionText || option?.textContent || dropdownOption?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!value) return false;

    const context = selectizeLookupContext(select);
    const control = context?.control || select.closest('tr')?.querySelector('.selectize-control') || select.parentElement?.querySelector?.('.selectize-control');
    const instance = selectizeInstance(select, context);

    // Prefer the widget's own API. This updates both Selectize's model and the
    // backing <select>, and lets us explicitly close the dropdown afterwards.
    if (String(select.value) !== value && instance?.setValue) {
      try { instance.setValue(value, false); } catch {}
    }

    if (String(select.value) !== value) {
      const input = control?.querySelector('.selectize-input');
      if (input) dispatchSyntheticClick(input);

      const liveDropdownOption = dropdownOption
        || [...document.querySelectorAll('.selectize-dropdown [data-value]')]
          .find(node => String(node.getAttribute('data-value') || '') === value);
      if (liveDropdownOption) dispatchSyntheticClick(liveDropdownOption);
    }

    // After a Selectize choice its backing <select> should contain/select the
    // chosen value. Only fall back to native assignment when that real option is
    // present; never invent a Billing option or ID.
    const nativeOption = [...select.options].find(item => String(item.value) === value) || option;
    if (String(select.value) !== value && nativeOption) {
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const selected = String(select.value) === value
      || String(instance?.getValue?.() || '') === value;
    const visualItem = control?.querySelector('.selectize-input > .item');
    if (visualItem && selected) {
      visualItem.textContent = text || String(nativeOption?.textContent || '').replace(/\s+/g, ' ').trim();
      visualItem.setAttribute('data-value', value);
    }

    // Never leave Billing's OLT dropdown/caret covering Save/Guide after
    // auto-prefill. The legacy widget may restore focus one frame later, so use
    // a bounded settle sequence and park focus outside the Selectize control.
    settleSelectizeAfterProgrammaticSelection(select);
    return selected;
  }

  function resolveAndApplyOltByName(caseData) {
    const match = resolveOltOptionByName(caseData);
    if (match.status !== 'unique') return match;
    const selected = applyOltOptionSelection(match);
    if (!selected) return { ...match, status: 'apply_failed' };
    const candidate = recommendedCandidate(caseData) || recommendation(caseData)?.params?.candidate || {};
    if (match.select) {
      match.select.dataset.simnetWbAutoOlt = '1';
      match.select.dataset.simnetWbAutoOltSource = String(candidate.oltName || match.candidateName || '').slice(0, 240);
      match.select.dataset.simnetWbAutoOltDeviceId = String(candidate.deviceId || '').slice(0, 80);
      match.select.dataset.simnetWbAutoOltInterface = String(candidate.interface || '').slice(0, 120);
    }
    return {
      ...match,
      status: 'selected',
      selectedValue: String(match.option?.value || ''),
      selectedText: String(match.option?.textContent || '').replace(/\s+/g, ' ').trim()
    };
  }

  function applyTechnicalTextValue(control, rawValue, normalize = value => String(value || '').trim()) {
    if (!(control instanceof Element) || !('value' in control)) {
      return { status: 'control_missing', changed: false };
    }
    const value = String(rawValue || '').trim();
    if (!value) return { status: 'source_missing', changed: false, control };
    if (normalize(control.value) === normalize(value)) {
      return { status: 'matched', changed: false, control, value };
    }
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    const applied = normalize(control.value) === normalize(value);
    if (applied) {
      control.dataset.simnetWbTmcPrefill = '1';
      control.dataset.simnetWbTmcPrefillAt = new Date().toISOString();
    }
    return {
      status: applied ? 'applied' : 'apply_failed',
      changed: applied,
      control,
      value
    };
  }

  function technicalControlHasOperatorValue(field, control) {
    if (!(control instanceof Element) || !('value' in control)) return false;
    if (field === 'onuSerial') return Boolean(normalizeSerial(control.value));
    if (field === 'onuMac') return Boolean(normalizeMac(control.value));
    if (field === 'olt') {
      const raw = String(control.value || '').trim();
      if (!raw) return false;
      const option = control.options?.[control.selectedIndex] || null;
      const text = String(option?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return !/^(?:0|-1)$/.test(raw) && !/(?:выберите|не выбрано|---|^-$)/i.test(text);
    }
    return Boolean(String(control.value || '').trim());
  }

  /**
   * Automatic TMC prefill is intentionally stricter than the explicit action:
   * it may fill only controls that are still empty in the live Billing DOM.
   * A value already entered/selected by the operator is never overwritten.
   */
  function applyMissingTmcTechnicalValues(caseData, requestedFields = []) {
    const requested = [...new Set(Array.isArray(requestedFields) ? requestedFields : [])]
      .filter(field => ['olt', 'onuSerial', 'onuMac'].includes(field));
    const expected = {
      oltName: String(valueOf(caseData?.pon?.tmcOltName) || ''),
      oltIp: String(valueOf(caseData?.pon?.tmcOltIp) || ''),
      onuSerial: String(valueOf(caseData?.pon?.tmcOnuSerial) || ''),
      onuMac: String(valueOf(caseData?.pon?.tmcOnuMac) || '')
    };
    const writable = [];
    const skippedExisting = [];
    const conflictingExisting = [];
    const controlsMissing = [];

    for (const field of requested) {
      const control = technicalControl(field);
      if (!(control instanceof Element)) {
        controlsMissing.push(field);
        writable.push(field);
        continue;
      }
      if (!technicalControlHasOperatorValue(field, control)) {
        writable.push(field);
        continue;
      }
      // Never call an arbitrary operator-entered value "already matching".
      // Existing data is read-only for missing-only writeback and is classified
      // against the confirmed TMC evidence before the action may advance.
      if (currentTechnicalMatches([field], expected)) skippedExisting.push(field);
      else conflictingExisting.push(field);
    }

    if (!writable.length) {
      return {
        ok: false,
        status: conflictingExisting.length ? 'conflict' : skippedExisting.length ? 'already_present' : 'not_ready',
        fields: [],
        requestedFields: requested,
        completed: [],
        unresolved: conflictingExisting.map(field => ({ field, status: 'conflict' })),
        skippedExisting,
        conflictingExisting,
        controlsMissing,
        expected
      };
    }

    const result = applyTmcTechnicalValues(caseData, writable);
    return {
      ...result,
      requestedFields: requested,
      skippedExisting,
      conflictingExisting,
      unresolved: [
        ...(Array.isArray(result.unresolved) ? result.unresolved : []),
        ...conflictingExisting.map(field => ({ field, status: 'conflict' }))
      ],
      controlsMissing
    };
  }

  /**
   * Explicit operator-requested prefill. Values are copied from the already
   * resolved UserSide TMC evidence into Billing controls, but the native Save
   * button is never clicked here.
   */
  function applyTmcTechnicalValues(caseData, requestedFields = []) {
    const expected = {
      oltName: String(valueOf(caseData?.pon?.tmcOltName) || ''),
      oltIp: String(valueOf(caseData?.pon?.tmcOltIp) || ''),
      onuSerial: String(valueOf(caseData?.pon?.tmcOnuSerial) || ''),
      onuMac: String(valueOf(caseData?.pon?.tmcOnuMac) || '')
    };
    const available = {
      olt: Boolean(expected.oltName || expected.oltIp),
      onuSerial: Boolean(normalizeSerial(expected.onuSerial)),
      onuMac: Boolean(normalizeMac(expected.onuMac))
    };
    const requested = Array.isArray(requestedFields) && requestedFields.length
      ? requestedFields
      : Object.keys(available).filter(field => available[field]);
    const fields = [...new Set(requested)]
      .filter(field => ['olt', 'onuSerial', 'onuMac'].includes(field) && available[field]);
    const results = {};

    if (fields.includes('olt')) {
      const olt = resolveAndApplyOltByName(caseData);
      results.olt = {
        status: olt.status,
        changed: olt.status === 'selected',
        selectedText: olt.selectedText || '',
        candidateName: olt.candidateName || expected.oltName,
        candidateIp: olt.candidateIp || expected.oltIp
      };
    }
    if (fields.includes('onuSerial')) {
      results.onuSerial = applyTechnicalTextValue(
        technicalControl('onuSerial'),
        expected.onuSerial,
        normalizeSerial
      );
    }
    if (fields.includes('onuMac')) {
      results.onuMac = applyTechnicalTextValue(
        technicalControl('onuMac'),
        expected.onuMac,
        normalizeMac
      );
    }

    const entries = Object.entries(results);
    const completed = entries
      .filter(([, result]) => ['selected', 'applied', 'matched'].includes(result.status))
      .map(([field]) => field);
    const unresolved = entries
      .filter(([, result]) => !['selected', 'applied', 'matched'].includes(result.status))
      .map(([field, result]) => ({ field, status: result.status }));
    const controlsMissing = entries.length > 0
      && entries.every(([, result]) => result.status === 'control_missing');

    return {
      ok: completed.length > 0,
      status: controlsMissing || !entries.length ? 'not_ready' : unresolved.length ? 'partial' : 'applied',
      fields,
      completed,
      unresolved,
      expected,
      results
    };
  }

  function findSaveButton() {
    return (
      document.querySelector(
        '#savediv1 input[type="submit"],' +
        '#savediv1 button[type="submit"],' +
        'input.button[type="submit"][value*="Сохран"],' +
        'button[type="submit"]'
      )
      || null
    );
  }

  function isRenderedTmcElement(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (WB.interactionGuards?.isElementUsable) return WB.interactionGuards.isElementUsable(element);
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function rectIntersectsViewport(rect, margin = 8) {
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    const width = Math.max(1, Number(window.innerWidth || document.documentElement?.clientWidth || 0));
    const height = Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || 0));
    return Boolean(
      rect.right > margin
      && rect.bottom > margin
      && rect.left < width - margin
      && rect.top < height - margin
    );
  }

  function tmcElementInViewport(element) {
    if (!isRenderedTmcElement(element)) return false;
    try { return rectIntersectsViewport(element.getBoundingClientRect()); } catch { return false; }
  }

  function renderedTmcTarget(element) {
    if (!(element instanceof Element) || !element.isConnected) return null;
    if (isRenderedTmcElement(element)) return element;

    // UserSide AJAX/gallery widgets may keep a connected zero-size clone of the
    // same text. Do not focus that clone. Walk only a few semantic ancestors and
    // accept the first actually rendered container that still owns the TMC phrase.
    let current = element.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const text = String(current.innerText || current.textContent || '');
      const ownsTmc = /(?:найдено|знайдено)\s+на\s+olt/i.test(text);
      const ownsDevice = Boolean(current.querySelector?.('a[href*="/device/"]'));
      if (ownsTmc && ownsDevice && isRenderedTmcElement(current)) return current;
    }
    return null;
  }

  function uniqueElements(elements = []) {
    const seen = new Set();
    return elements.filter(element => {
      if (!(element instanceof Element) || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function tmcCandidates() {
    const parserBlocks = WB.tmcParser?.findBlocks?.(document);
    if (Array.isArray(parserBlocks) && parserBlocks.length) {
      const rendered = uniqueElements(parserBlocks.map(renderedTmcTarget).filter(Boolean));
      if (rendered.length) return rendered;
    }
    return uniqueElements(
      [...document.querySelectorAll('td,div')]
        .filter(element => {
          const text = element.innerText || element.textContent || '';
          return (
            /(?:найдено|знайдено)\s+на\s+olt/i.test(text)
            && element.querySelector('a[href*="/device/"]')
          );
        })
        .filter(element =>
          ![...element.children].some(child =>
            /(?:найдено|знайдено)\s+на\s+olt/i.test(
              child.innerText || child.textContent || ''
            )
          )
        )
        .map(renderedTmcTarget)
        .filter(Boolean)
    );
  }

  function tmcIdentityFromElement(element) {
    const parsed = WB.tmcParser?.parseBlock?.(element, {
      normalizeMac: value => {
        const raw = normalizeMac(value);
        return raw.length === 12 ? raw.match(/.{2}/g).join(':') : '';
      },
      normalizeSerial
    }) || null;
    if (parsed) {
      return {
        mac: normalizeMac(parsed.mac || ''),
        serial: normalizeSerial(parsed.serial || ''),
        oltName: String(parsed.oltName || '').trim(),
        oltIp: String(parsed.oltIp || '').trim(),
        interface: String(parsed.interface || '').trim()
      };
    }
    const text = element?.innerText || element?.textContent || '';
    return {
      mac: normalizeMac(
        text.match(
          /(?:^|\s)MAC\s*[:#]?\s*((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{12})/i
        )?.[1] || ''
      ),
      serial: normalizeSerial(
        text.match(
          /(?:s\/n|serial|серийн\w*|серійн\w*)\s*[:#]?\s*([A-Z0-9:-]{6,64})/i
        )?.[1] || ''
      ),
      oltName: String(
        [...(element?.querySelectorAll?.('a[href*="/device/"]') || [])]
          .find(anchor => !/история|history/i.test(anchor.textContent || ''))
          ?.textContent || ''
      ).trim(),
      oltIp: text.match(
        /(?:^|\s)IP\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i
      )?.[1] || '',
      interface: text.match(/Interface\s*:\s*([^\n\r]+)/i)?.[1] || ''
    };
  }

  function findTmcBlock(caseData) {
    const scored = tmcCandidates().map(element => {
      const identity = tmcIdentityFromElement(element);
      const comparison = WB.tmcMatch?.score?.(identity, caseData) || {
        value: 0,
        isMatch: false
      };
      return { element, identity, comparison };
    }).sort((a, b) => b.comparison.value - a.comparison.value);

    // Highlight the best block that actually contains an OLT.
    // Serial/MAC comparison only ranks candidates and never blocks display.
    return scored.find(entry => (
      entry.identity.oltName || entry.identity.oltIp
    ))?.element || null;
  }

  function unionRects(rects) {
    const usable = rects.filter(rect => (
      rect
      && rect.width > 0
      && rect.height > 0
    ));

    if (!usable.length) return null;

    const left = Math.min(...usable.map(rect => rect.left));
    const top = Math.min(...usable.map(rect => rect.top));
    const right = Math.max(...usable.map(rect => rect.right));
    const bottom = Math.max(...usable.map(rect => rect.bottom));

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function tmcHighlightTarget(caseData) {
    const element = findTmcBlock(caseData);
    if (!element) return null;

    const tokens = [
      'найдено на olt',
      String(valueOf(caseData?.pon?.tmcOltName) || '').toLowerCase(),
      String(valueOf(caseData?.pon?.tmcOltIp) || '').toLowerCase(),
      normalizeMac(valueOf(caseData?.pon?.tmcOnuMac) || '').toLowerCase(),
      normalizeSerial(valueOf(caseData?.pon?.tmcOnuSerial) || '').toLowerCase(),
      String(valueOf(caseData?.pon?.tmcPort) || '').toLowerCase()
    ].filter(Boolean);

    return {
      element,
      getRect() {
        const rects = [];
        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT
        );

        while (walker.nextNode()) {
          const node = walker.currentNode;
          const raw = String(node.nodeValue || '');
          const compact = raw
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!compact) continue;

          const normalized = compact.toLowerCase();
          const compactMac = normalizeMac(compact).toLowerCase();
          const compactSerial = normalizeSerial(compact).toLowerCase();
          const relevant = (
            /(?:найдено|знайдено)\s+на\s+olt/i.test(compact)
            || /^(?:ip|interface|s\/n|serial|mac)\s*:/i.test(compact)
            || tokens.some(token => (
              normalized.includes(token)
              || (compactMac && compactMac.includes(token))
              || (compactSerial && compactSerial.includes(token))
            ))
          );

          if (!relevant) continue;

          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...range.getClientRects());
          range.detach?.();
        }

        return unionRects(rects) || element.getBoundingClientRect();
      }
    };
  }

  function tmcReviewStepId(caseData) {
    const mac = normalizeMac(
      valueOf(caseData?.pon?.tmcOnuMac)
      || valueOf(caseData?.pon?.onuMac)
      || ''
    ) || 'no-mac';
    const serial = normalizeSerial(
      valueOf(caseData?.pon?.tmcOnuSerial)
      || valueOf(caseData?.pon?.onuSerial)
      || ''
    ) || 'no-serial';
    const oltIp = String(
      valueOf(caseData?.pon?.tmcOltIp) || 'no-ip'
    ).replace(/[^0-9a-z.-]/gi, '');
    return `userside.inspect-tmc:${mac}:${serial}:${oltIp}`;
  }

  const TECH_FIELD_LABELS = {
    connectionFamily: 'Тип подключения',
    subscriberMac: 'MAC устройства',
    olt: 'OLT',
    onuSerial: 'ONU S/N',
    onuMac: 'ONU MAC'
  };

  const TECH_FIELD_SPECS = Object.freeze({
    connectionFamily: {
      patterns: [
        /^тип\s+подключ/i,
        /^тип\s+підключ/i,
        /^технолог/i,
        /технологи.{0,35}подключ/i
      ]
    },
    subscriberMac: {
      patterns: [
        /мак-?адрес\s+абонента/i,
        /mac-?адрес\s+абонента/i,
        /mac.{0,20}клиент/i,
        /мак.{0,20}клієнт/i,
        /mac.{0,20}роут/i,
        /мак.{0,20}роут/i
      ]
    },
    olt: {
      selector: 'select#dopfield_29,select[name="dopfield_29"]',
      patterns: [/^olt$/i, /\bolt\b/i, /головн.*станц/i, /голов.*станц/i]
    },
    onuSerial: {
      selector: 'input[name="dopfield_38"]',
      patterns: [
        /gpon.*(?:серийн|серійн|serial|sn)/i,
        /ont.*(?:серийн|серійн|serial|sn)/i,
        /onu.*(?:серийн|серійн|serial|sn)/i,
        /(?:серийн|серійн).*onu/i
      ]
    },
    onuMac: {
      selector: 'input[name="dopfield_19"]',
      patterns: [
        /epon.*(?:мак|mac)/i,
        /(?:мак|mac).*epon/i,
        /onu.*(?:мак|mac)/i,
        /(?:мак|mac).*onu/i
      ]
    }
  });

  function technicalRows() {
    return [...document.querySelectorAll('tr')]
      .map(row => {
        const cells = [...row.querySelectorAll(':scope > td,:scope > th')];
        const label = String(
          cells[0]?.innerText || cells[0]?.textContent || ''
        ).replace(/\s+/g, ' ').trim();
        return { row, cells, label };
      })
      .filter(item => item.cells.length >= 2 && item.label);
  }

  function technicalRow(field) {
    const spec = TECH_FIELD_SPECS[field];
    if (!spec) return null;
    const direct = spec.selector
      ? document.querySelector(spec.selector)
      : null;
    if (direct?.closest?.('tr')) return direct.closest('tr');
    return technicalRows().find(item => (
      spec.patterns.some(pattern => pattern.test(item.label))
    ))?.row || null;
  }

  function controlDisplayValue(control) {
    if (!control) return '';
    if (control.tagName === 'SELECT') {
      const option = control.options?.[control.selectedIndex] || null;
      const text = String(option?.textContent || '').replace(/\s+/g, ' ').trim();
      return /выбер|оберіть|не\s+указ|нет\s+данн/i.test(text) ? '' : text;
    }
    return String(control.value || '').replace(/\s+/g, ' ').trim();
  }

  function technicalValue(field, caseData) {
    const control = technicalControl(field);
    // If the real Billing control exists, its DOM value is the field truth — even
    // when it is empty. Never fall through to helper/status cells or cached case
    // facts, otherwise our own UI text can make an empty field look "filled".
    if (control) return controlDisplayValue(control);

    const row = technicalRow(field);
    const cells = [...(row?.querySelectorAll?.(':scope > td,:scope > th') || [])];
    const valueCell = cells[1] || null;
    const fromRow = String(
      valueCell?.innerText || valueCell?.textContent || ''
    ).replace(/\s+/g, ' ').trim();
    if (fromRow && !/выбер|оберіть|не\s+указ|нет\s+данн/i.test(fromRow)) {
      return fromRow;
    }

    if (field === 'connectionFamily') {
      return String(
        valueOf(caseData?.network?.connectionRaw)
        || valueOf(caseData?.network?.connectionFamily)
        || ''
      );
    }
    if (field === 'subscriberMac') {
      return String(
        valueOf(caseData?.network?.mac)
        || valueOf(caseData?.network?.routerMac)
        || ''
      );
    }
    if (field === 'olt') {
      return String(
        valueOf(caseData?.pon?.oltName)
        || valueOf(caseData?.pon?.oltIp)
        || ''
      );
    }
    if (field === 'onuSerial') {
      return String(valueOf(caseData?.pon?.onuSerial) || '');
    }
    if (field === 'onuMac') {
      return String(valueOf(caseData?.pon?.onuMac) || '');
    }
    return '';
  }

  function technicalConnectionKind(caseData) {
    const text = [
      technicalValue('connectionFamily', caseData),
      valueOf(caseData?.pon?.pollType),
      valueOf(caseData?.pon?.oltName),
      valueOf(caseData?.pon?.tmcOltName)
    ].filter(Boolean).join(' ');
    if (/ethernet|коммутатор|switch|utp|витая\s+пара/i.test(text)) return 'ethernet';
    if (/huawei/i.test(text)) return 'huawei';
    if (/gcom/i.test(text)) return 'gcom';
    if (/gpon/i.test(text)) return 'gpon';
    if (/epon|bdcom\s+olt\s+p36/i.test(text)) return 'epon';
    if (/\bpon\b/i.test(text)) return 'pon';
    return 'unknown';
  }

  function sameTechnicalValue(field, actual, expected) {
    if (!actual || !expected) return true;
    if (field === 'onuMac' || field === 'subscriberMac') {
      return normalizeMac(actual) === normalizeMac(expected);
    }
    if (field === 'onuSerial') {
      return normalizeSerial(actual) === normalizeSerial(expected);
    }
    const left = String(actual).replace(/\s+/g, ' ').trim().toLowerCase();
    const right = String(expected).replace(/\s+/g, ' ').trim().toLowerCase();
    return left === right || left.includes(right) || right.includes(left);
  }

  function technicalFieldRequirements(kind = 'unknown') {
    const isPon = ['pon', 'epon', 'gpon', 'gcom', 'huawei'].includes(kind);
    return [
      {
        field: 'connectionFamily',
        required: true,
        meaning: 'Определяет ветку: Ethernet или PON и тип штатного опроса.'
      },
      {
        field: 'subscriberMac',
        required: false,
        importantIfMissing: true,
        meaning: 'Независимый след для поиска порта; нужен для fallback через MAC и UPLINK/DOWNLINK.'
      },
      {
        field: 'olt',
        required: false,
        conditional: isPon,
        meaning: 'Желательна для точной привязки. Первый best-effort опрос иногда проходит и без OLT; при ошибке её восстанавливаем через ТМЦ.'
      },
      {
        field: 'onuMac',
        required: isPon,
        meaning: 'Обязательный минимальный идентификатор для попытки PON-опроса.'
      },
      {
        field: 'onuSerial',
        required: false,
        conditional: ['pon', 'gpon', 'gcom', 'huawei', 'unknown'].includes(kind),
        meaning: 'Может требоваться конкретным типом OLT/Billing. Если первый опрос без S/N не проходит, значение добирается через ТМЦ/оборудование.'
      }
    ];
  }

  function technicalInspection(caseData) {
    const kind = technicalConnectionKind(caseData);
    const actual = Object.fromEntries(
      Object.keys(TECH_FIELD_LABELS).map(field => [field, technicalValue(field, caseData)])
    );
    const expected = {
      olt: String(
        valueOf(caseData?.pon?.tmcOltIp)
        || valueOf(caseData?.pon?.tmcOltName)
        || ''
      ),
      onuSerial: String(valueOf(caseData?.pon?.tmcOnuSerial) || ''),
      onuMac: String(valueOf(caseData?.pon?.tmcOnuMac) || '')
    };

    const definitions = technicalFieldRequirements(kind);

    const fields = definitions.map(item => {
      const value = actual[item.field] || '';
      const hasValue = item.field === 'onuMac' || item.field === 'subscriberMac'
        ? Boolean(normalizeMac(value))
        : item.field === 'onuSerial'
          ? Boolean(normalizeSerial(value))
          : Boolean(String(value).trim());
      const conflict = Boolean(
        expected[item.field]
        && hasValue
        && !sameTechnicalValue(item.field, value, expected[item.field])
      );

      let status = 'ok';
      let statusLabel = '✓ заполнено';
      if (conflict) {
        status = 'conflict';
        statusLabel = '! конфликт с ТМЦ';
      } else if (!hasValue && item.required) {
        status = 'missing';
        statusLabel = '! не заполнено';
      } else if (!hasValue && item.importantIfMissing) {
        status = 'missing';
        statusLabel = '— не заполнено · fallback недоступен';
      } else if (!hasValue && item.conditional) {
        status = 'conditional';
        statusLabel = '— не заполнено · зависит от технологии';
      } else if (!hasValue) {
        status = 'optional';
        statusLabel = '— не заполнено · сейчас не требуется';
      } else if (!item.required) {
        status = 'reference';
        statusLabel = '✓ есть для сверки';
      }

      return {
        ...item,
        value,
        expected: expected[item.field] || '',
        status,
        statusLabel,
        label: TECH_FIELD_LABELS[item.field]
      };
    });

    const missing = fields.filter(item => item.status === 'missing');
    const conflicts = fields.filter(item => item.status === 'conflict');
    const summary = conflicts.length
      ? `Есть расхождение: ${conflicts.map(item => item.label).join(', ')}. Не исправляй вслепую — сначала подтверди другим источником.`
      : missing.length
        ? `Не хватает: ${missing.map(item => item.label).join(', ')}. Ниже указано, для какой ветки нужно каждое поле.`
        : 'Ключевые поля заполнены. Проверь их назначение и только затем переходи к следующему источнику.';
    const signature = fields
      .map(item => `${item.field}-${item.status}`)
      .join('_')
      .replace(/[^a-z0-9_-]/gi, '');

    return { kind, fields, missing, conflicts, summary, signature };
  }

  function technicalInspectionTarget(caseData) {
    const inspection = technicalInspection(caseData);
    const elements = inspection.fields
      .map(item => technicalRow(item.field) || technicalControl(item.field))
      .filter(Boolean);
    if (!elements.length) {
      return document.querySelector('form table,table.tbg3,form') || null;
    }
    return {
      element: elements[0],
      getRect() {
        return unionRects(elements.map(element => element.getBoundingClientRect()));
      }
    };
  }

  function technicalReviewPlan(caseData) {
    const inspection = technicalInspection(caseData);
    const inspectionStepId = `billing.inspect-technical:${inspection.signature}`;
    if (guideCompleted(caseData, inspectionStepId)) return null;
    return {
      id: inspectionStepId,
      title: 'Разбери поля технических данных',
      text: inspection.summary,
      kind: 'highlight',
      resolver: () => technicalInspectionTarget(caseData),
      markOnClick: false,
      stickyEvidence: true,
      fieldSummary: inspection.fields,
      overlayAction: 'complete-step',
      overlayActionLabel: 'Поля просмотрены'
    };
  }

  function technicalFieldLabels(fields = []) {
    return [...new Set(fields)]
      .map(field => TECH_FIELD_LABELS[field] || field)
      .join(', ');
  }

  function tmcFoundText(caseData, fields = []) {
    const requested = new Set(fields || []);
    const includeAll = requested.size === 0;
    const values = [
      (includeAll || requested.has('olt')) && valueOf(caseData?.pon?.tmcOltName)
        ? `OLT: ${valueOf(caseData.pon.tmcOltName)}${valueOf(caseData?.pon?.tmcOltIp) ? ` (${valueOf(caseData.pon.tmcOltIp)})` : ''}`
        : '',
      (includeAll || requested.has('onuSerial')) && valueOf(caseData?.pon?.tmcOnuSerial)
        ? `ONU S/N: ${valueOf(caseData.pon.tmcOnuSerial)}`
        : '',
      (includeAll || requested.has('onuMac')) && valueOf(caseData?.pon?.tmcOnuMac)
        ? `ONU MAC: ${valueOf(caseData.pon.tmcOnuMac)}`
        : ''
    ].filter(Boolean);

    return values.length
      ? values.join(' · ')
      : 'Сверь блок «Найдено на OLT» с техническими данными Billing.';
  }

  function technicalControl(field) {
    const spec = TECH_FIELD_SPECS[field];
    const direct = spec?.selector
      ? document.querySelector(spec.selector)
      : null;
    if (direct) return direct;
    return technicalRow(field)?.querySelector('input,select,textarea') || null;
  }

  function technicalFieldsTarget(fields = []) {
    const controls = [...new Set(fields)]
      .map(technicalControl)
      .filter(Boolean);
    if (!controls.length) return null;
    const elements = controls.map(control => {
      const row = control.closest('tr');
      return row || fieldVisual(control) || control;
    });
    return {
      element: elements[0],
      getRect() {
        return unionRects(elements.map(element => element.getBoundingClientRect()));
      }
    };
  }

  function fieldVisual(control) {
    if (!control) return null;
    if (control.matches?.('select#dopfield_29,select[name="dopfield_29"]')) {
      const row = control.closest('tr');
      return row?.querySelector('.selectize-control,.selectize-input') || null;
    }
    return null;
  }

  function currentTechnicalMatches(fields = [], expected = {}) {
    if (!fields.length) return false;
    return fields.every(field => {
      const control = technicalControl(field);
      if (!control) return false;
      if (field === 'olt') {
        const option = control.options?.[control.selectedIndex] || null;
        const text = String(option?.textContent || '').replace(/\s+/g, ' ').trim();
        const expectedIp = String(expected.oltIp || '').trim();
        const expectedName = String(expected.oltName || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (expectedIp && text.includes(expectedIp)) return true;
        return Boolean(expectedName && text.toLowerCase().includes(expectedName));
      }
      if (field === 'onuSerial') {
        return Boolean(
          normalizeSerial(expected.onuSerial)
          && normalizeSerial(control.value) === normalizeSerial(expected.onuSerial)
        );
      }
      if (field === 'onuMac') {
        return Boolean(
          normalizeMac(expected.onuMac)
          && normalizeMac(control.value) === normalizeMac(expected.onuMac)
        );
      }
      return false;
    });
  }

  const VALID_POLL_ACTIONS = new Set(['310', '311', '312', '313']);

  function authoritativePollAction(caseData) {
    // Readiness is computed from the current Case binding. The Guide must use
    // that same binding first; an older Locator candidate may still describe a
    // previous/fallback technology and must never redirect the operator to the
    // wrong native poll tab.
    const candidates = [
      valueOf(caseData?.diagnostic?.pollAction),
      valueOf(caseData?.pon?.pollAction),
      recommendation(caseData)?.params?.pollAction,
      recommendedCandidate(caseData)?.pollAction
    ];
    for (const candidate of candidates) {
      const action = String(candidate || '');
      if (VALID_POLL_ACTIONS.has(action)) return action;
    }
    return '';
  }

  function findPollTab(caseData) {
    const action = authoritativePollAction(caseData);
    const billingId = String(
      valueOf(caseData?.identity?.billingId) || ''
    );

    if (!action) return null;

    return [...document.querySelectorAll('a[href]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        if (!url) return false;

        return (
          /\/stat\.pl$/i.test(url.pathname)
          && url.searchParams.get('a') === action
          && (
            !billingId
            || url.searchParams.get('id') === billingId
          )
        );
      }) || null;
  }

  function pollRows(caseData) {
    const oltIp = String(
      valueOf(caseData?.pon?.oltIp)
      || valueOf(caseData?.pon?.tmcOltIp)
      || ''
    );
    const onuMac = normalizeMac(
      valueOf(caseData?.pon?.onuMac)
      || valueOf(caseData?.pon?.tmcOnuMac)
      || ''
    );
    const serial = normalizeSerial(
      valueOf(caseData?.pon?.onuSerial)
      || valueOf(caseData?.pon?.tmcOnuSerial)
      || ''
    );

    return [...document.querySelectorAll('tr')]
      .map(row => {
        const text = row.innerText || row.textContent || '';
        const compactMac = normalizeMac(text);
        const compactSerial = normalizeSerial(text);
        let score = 0;

        if (oltIp && text.includes(oltIp)) score += 100;
        if (onuMac && compactMac.includes(onuMac)) score += 100;
        if (serial && compactSerial.includes(serial)) score += 100;
        if (row.querySelector('a[href*="act=askolt"]')) score += 20;

        return { row, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function findAskOltLink(caseData) {
    const row = pollRows(caseData)[0]?.row || null;
    return (
      row?.querySelector('a[href*="act=askolt"]')
      || document.querySelector('a[href*="act=askolt"]')
      || null
    );
  }

  function askOltHighlightTarget(caseData) {
    const expectedAction = authoritativePollAction(caseData);
    const currentAction = new URLSearchParams(location.search).get('a') || '';
    if (expectedAction && currentAction && expectedAction !== currentAction) {
      return null;
    }
    const link = findAskOltLink(caseData);
    return link?.closest?.('td,th') || link || null;
  }

  function expectedGuidePollAction(caseData) {
    return authoritativePollAction(caseData);
  }

  function hasExpectedTerminalResult(caseData) {
    if (!WB.pollTerminal?.hasResult?.()) return false;
    const expectedAction = expectedGuidePollAction(caseData);
    const currentAction = new URLSearchParams(location.search).get('a') || '';
    return !expectedAction || !currentAction || expectedAction === currentAction;
  }

  function billingCardUrl(caseData) {
    // Centralized safe builder: never returns authenticated Billing URL without confirmed pp.
    if (WB.billingNavigation?.safeCardUrl) {
      return WB.billingNavigation.safeCardUrl(caseData) || '';
    }
    const billingId = String(valueOf(caseData?.identity?.billingId) || '');
    if (!billingId) return '';
    try {
      const current = new URL(location.href);
      const pp = current.searchParams.get('pp') || '';
      if (!pp || !/admin\.(simnet|looknet)\.kiev\.ua$/i.test(location.hostname)) {
        // Hard refuse: no fallback URL without pp
        return '';
      }
      const url = new URL('/cgi-bin/adm/adm.pl', location.origin);
      url.searchParams.set('pp', pp);
      const uu = current.searchParams.get('uu');
      if (uu) url.searchParams.set('uu', uu);
      url.searchParams.set('a', 'user');
      url.searchParams.set('id', billingId);
      return url.href;
    } catch {
      return '';
    }
  }

  function billingTechnicalUrl(caseData) {
    // Centralized safe builder: never returns authenticated Billing URL without confirmed pp.
    if (WB.billingNavigation?.safeTechnicalUrl) {
      return WB.billingNavigation.safeTechnicalUrl(caseData) || '';
    }
    const billingId = String(valueOf(caseData?.identity?.billingId) || '');
    if (!billingId) return '';
    try {
      const current = new URL(location.href);
      const pp = current.searchParams.get('pp') || '';
      if (!pp || !/admin\.(simnet|looknet)\.kiev\.ua$/i.test(location.hostname)) {
        return '';
      }
      const url = new URL('/cgi-bin/adm/adm.pl', location.origin);
      url.searchParams.set('pp', pp);
      const uu = current.searchParams.get('uu');
      if (uu) url.searchParams.set('uu', uu);
      url.searchParams.set('a', 'dopdata');
      url.searchParams.set('parent_type', '0');
      url.searchParams.set('id', billingId);
      url.searchParams.set('tmpl', '1');
      return url.href;
    } catch {
      return '';
    }
  }

  function usersideCustomerUrl(caseData) {
    const customerId = String(
      valueOf(caseData?.identity?.customerId) || ''
    );
    if (!customerId) return '';
    return new URL(
      `/customer/${customerId}`,
      'https://userside.simnet.kiev.ua'
    ).href;
  }

  function currentUpdatedFlag() {
    return new URLSearchParams(location.search)
      .get('updated') === '1';
  }

  function guideCompleted(caseData, stepId) {
    return Boolean(
      caseData?.route?.guide?.completed?.[stepId]
    );
  }

  function recommendation(caseData) {
    return caseData?.locator?.recommendation || null;
  }

  function recommendedCandidate(caseData) {
    return recommendation(caseData)?.params?.candidate
      || caseData?.diagnostic?.bestCandidate
      || caseData?.locator?.candidates?.[0]
      || null;
  }

  function findCustomerMacSearchLink(caseData) {
    const recMacs = recommendation(caseData)?.params?.macs || [];
    const preferred = normalizeMac(
      recMacs[0]?.mac
      || valueOf(caseData?.network?.mac)
      || valueOf(caseData?.network?.routerMac)
      || ''
    );

    const links = [...document.querySelectorAll(
      'a[href*="find_typer=machistory"][href*="search="]'
    )];

    return links.find(anchor => {
      const url = parseUrl(anchor);
      return preferred && normalizeMac(url?.searchParams.get('search') || '') === preferred;
    }) || links[0] || null;
  }

  // Guide highlights should explain a semantic row, not a tiny icon/link.
  // The anchor remains the interaction element so ACTION evidence still comes
  // only from the operator's real click, while the visual ring covers the
  // whole IP/MAC or MAC-history result row.
  function rowHighlightTarget(anchor) {
    if (!(anchor instanceof Element)) return null;
    const block = anchor.closest?.('.table_block');
    if (block) {
      return {
        element: anchor,
        getRect() {
          return block.getBoundingClientRect();
        }
      };
    }
    const row = anchor.closest?.('tr');
    if (!row) {
      const item = anchor.closest?.('.item');
      return item ? {
        element: anchor,
        getRect() {
          return item.getBoundingClientRect();
        }
      } : anchor;
    }
    return {
      element: anchor,
      getRect() {
        const cells = [...row.querySelectorAll(':scope > th, :scope > td')]
          .filter(cell => {
            const rect = cell.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        return unionRects(cells.map(cell => cell.getBoundingClientRect()))
          || row.getBoundingClientRect();
      }
    };
  }

  function findCandidateResultRow(caseData) {
    const candidate = recommendedCandidate(caseData);
    if (!candidate) return null;
    const deviceId = String(candidate.deviceId || '');
    const iface = String(candidate.interface || '').trim().toLowerCase();
    const name = String(candidate.oltName || '').trim().toLowerCase();

    const rows = [...document.querySelectorAll('tr')];
    return rows.find(row => {
      const text = String(row.innerText || row.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const hasDevice = deviceId
        ? Boolean(row.querySelector(`a[href*="/device/${deviceId}"]`))
        : false;
      const hasIface = iface && text.includes(iface);
      const hasName = name && (text.includes(name) || name.includes(text));
      return hasDevice || hasIface || hasName;
    }) || null;
  }

  function candidateResultTarget(caseData) {
    const link = findCandidateDeviceLink(caseData);
    if (link) return rowHighlightTarget(link);
    const row = findCandidateResultRow(caseData);
    return row || null;
  }

  function macCandidateResultText(caseData) {
    const candidate = recommendedCandidate(caseData) || {};
    const parts = [
      candidate.oltName ? `Оборудование: ${candidate.oltName}` : '',
      candidate.interface ? `порт: ${candidate.interface}` : '',
      candidate.vlan ? `VLAN: ${candidate.vlan}` : ''
    ].filter(Boolean);
    const found = parts.length
      ? parts.join(' · ')
      : 'MAC найден на сетевом оборудовании.';
    if (!candidate.oltIp) {
      return `${found}. IP в этой строке не показан. Открой карточку найденной OLT, чтобы добрать IP и тип оборудования.`;
    }
    return `${found} · IP: ${candidate.oltIp}. Зафиксируй найденную точку; переход на OLT не требуется.`;
  }

  function macResultOverlayAction(candidate = null) {
    const details = candidate || {};
    return details.oltIp
      ? {
          action: 'return-customer',
          label: 'Вернуться к абоненту'
        }
      : {
          action: 'open-candidate-device',
          label: 'Открыть OLT и посмотреть IP'
        };
  }

  function shouldPreserveEvidenceOverlay(currentPlan, targetElement) {
    return Boolean(
      currentPlan?.stickyEvidence
      && targetElement?.isConnected
    );
  }

  function findUplinkDownlinkLink() {
    return document.querySelector(
      'a[href*="uplinkport=1"],a[href*="UPLINK"][href*="DOWNLINK"]'
    );
  }

  function findCandidateInterfaceLink(caseData) {
    const candidate = recommendedCandidate(caseData);
    if (!candidate) return null;

    return [...document.querySelectorAll('a[href*="/interface_mac_list"]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        const deviceId = url?.pathname.match(/\/device\/(\d+)/i)?.[1] || '';
        const ifIndex = url?.searchParams.get('if_index') || '';
        const text = String(anchor.innerText || anchor.textContent || '').trim();
        return (
          (candidate.interfaceHref && url?.href === candidate.interfaceHref)
          || (
            candidate.deviceId
            && deviceId === String(candidate.deviceId)
            && (!candidate.ifIndex || ifIndex === String(candidate.ifIndex))
          )
          || (
            candidate.interface
            && text.toUpperCase() === String(candidate.interface).toUpperCase()
          )
        );
      }) || null;
  }

  function findCandidateDeviceLink(caseData) {
    const candidate = recommendedCandidate(caseData);
    if (!candidate) return null;

    return [...document.querySelectorAll('a[href*="/device/"]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        const deviceId = url?.pathname.match(/\/device\/(\d+)/i)?.[1] || '';
        return candidate.deviceId && deviceId === String(candidate.deviceId);
      }) || null;
  }

  function candidateDeviceUrl(caseData) {
    const candidate = recommendedCandidate(caseData);
    if (!candidate?.deviceId) return '';
    return new URL(`/device/${candidate.deviceId}`, 'https://userside.simnet.kiev.ua').href;
  }

  function ethernetDeviceId(caseData) {
    return String(valueOf(caseData?.network?.accessDeviceId) || '');
  }

  function ethernetDeviceUrl(caseData) {
    const deviceId = ethernetDeviceId(caseData);
    return deviceId
      ? new URL(`/device/${deviceId}`, 'https://userside.simnet.kiev.ua').href
      : '';
  }

  function ethernetErrorsUrl(caseData) {
    const deviceId = ethernetDeviceId(caseData);
    return deviceId
      ? new URL(`/device/error_iface_list?device_id=${deviceId}`, 'https://userside.simnet.kiev.ua').href
      : '';
  }

  function findEthernetConnectionPoint(caseData) {
    const expectedDeviceId = ethernetDeviceId(caseData);
    return [...document.querySelectorAll('.item')]
      .find(item => {
        const label = String(
          item.querySelector('.left_data')?.textContent || ''
        ).replace(/\s+/g, ' ').trim();
        if (!/^(?:Точка\s+подключения|Точка\s+підключення)\s*:?$/i.test(label)) return false;
        const link = [...item.querySelectorAll('a[href*="/device/"]')]
          .find(anchor => {
            const deviceId = parseUrl(anchor)?.pathname.match(/\/device\/(\d+)/i)?.[1] || '';
            return !expectedDeviceId || deviceId === expectedDeviceId;
          });
        return Boolean(link);
      }) || null;
  }

  function findEthernetFdbLink(caseData) {
    const deviceId = ethernetDeviceId(caseData);
    return [...document.querySelectorAll('a[href*="device_poller_data"]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        return url?.searchParams.get('data_type') === 'fdb_table'
          && (!deviceId || url.pathname.includes(`/device/${deviceId}/`));
      }) || null;
  }

  function findEthernetErrorsLink(caseData) {
    const deviceId = ethernetDeviceId(caseData);
    return [...document.querySelectorAll('a[href*="error_iface_list"]')]
      .find(anchor => {
        const url = parseUrl(anchor);
        return !deviceId || url?.searchParams.get('device_id') === deviceId;
      }) || null;
  }

  function planLocator(caseData, page) {
    const rec = recommendation(caseData);
    if (!rec?.action) return null;
    const candidate = recommendedCandidate(caseData);

    switch (rec.action) {
      case 'check_juniper':
        if (page.pageKind === 'billing_user') {
          return {
            id: 'billing.open-juniper',
            title: 'Проверь Juniper',
            text: 'Открой Juniper только если нужна ручная детализация уже полученного L3-снимка: статус сессии, время старта и текущий трафик.',
            kind: 'highlight',
            resolver: () => findJuniperLink(caseData),
            markOnClick: false
          };
        }
        if (page.pageKind === 'billing_juniper') {
          return {
            id: 'billing.inspect-juniper',
            title: 'Сверь сессию Juniper',
            text: juniperEducation(caseData),
            kind: 'highlight',
            resolver: findJuniperStatusTarget,
            relatedResolver: findJuniperRelatedTargets,
            markOnClick: false,
            stickyEvidence: true
          };
        }
        return null;

      case 'open_technical':
        if (page.pageKind === 'billing_user') {
          return {
            id: 'billing.open-technical',
            title: 'Перейди в технические данные',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findTechnicalDataLink(caseData),
            markOnClick: false
          };
        }
        return {
          id: 'billing.resume-technical',
          title: 'Вернись в технические данные',
          text: rec.reason,
          kind: page.system === 'userside' ? 'focus-source' : 'navigate',
          focusSource: page.system === 'userside',
          semanticTargetId: 'billing.technical',
          url: page.system === 'userside'
            ? ''
            : billingTechnicalUrl(caseData)
        };

      case 'poll_current_binding':
      case 'poll_candidate':
      case 'retry_poll':
        if (page.pageKind === 'billing_user') {
          return {
            id: 'billing.open-poll-tab',
            title: rec.action === 'retry_poll'
              ? 'Повтори штатный опрос'
              : `Открой ${candidate?.technology || caseData?.diagnostic?.subtype || 'PON'}-опрос`,
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findPollTab(caseData),
            markOnClick: false
          };
        }
        if (page.pageKind === 'billing_onu_poll') {
          const expectedAction = expectedGuidePollAction(caseData);
          const currentAction = new URLSearchParams(location.search).get('a') || '';
          if (expectedAction && currentAction && expectedAction !== currentAction) {
            return {
              id: 'billing.switch-correct-poll-tab',
              title: `Переключись на ${({ '310': 'EPON', '311': 'GPON', '312': 'GCOM', '313': 'Huawei' }[expectedAction]) || recommendedCandidate(caseData)?.technology || 'нужный'}-опрос`,
              text: 'Открыта другая технология. Этот экран не может завершить текущую диагностику.',
              kind: 'highlight',
              resolver: () => findPollTab(caseData),
              markOnClick: false
            };
          }
          return {
            id: 'billing.ask-olt',
            title: rec.action === 'retry_poll' ? 'Повтори запрос OLT' : 'Запусти запрос OLT',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => askOltHighlightTarget(caseData),
            markOnClick: false
          };
        }
        if (page.pageKind === 'billing_technical') {
          return {
            id: 'billing.return-card-for-poll',
            title: 'Вернись на карточку Billing',
            text: 'На карточке будет подсвечена нужная вкладка опроса.',
            kind: 'navigate',
            url: billingCardUrl(caseData)
          };
        }
        return {
          id: 'resume-billing-for-poll',
          title: 'Вернись к опросу в Billing',
          text: rec.reason,
          kind: page.system === 'userside' ? 'focus-source' : 'navigate',
          focusSource: page.system === 'userside',
          url: page.system === 'userside'
            ? ''
            : billingCardUrl(caseData)
        };

      case 'wait_poll':
        return {
          id: 'poll.wait',
          title: 'Дождись результата опроса',
          text: rec.reason,
          kind: 'none'
        };

      case 'switch_port':
        if (page.pageKind === 'userside_customer') {
          return {
            id: 'ethernet.open-switch',
            knowledgeId: 'userside.ethernet-access-point',
            title: 'Открой коммутатор абонента',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findEthernetConnectionPoint(caseData),
            markOnClick: false,
            stickyEvidence: true
          };
        }
        if (page.pageKind === 'billing_user') {
          return {
            id: 'ethernet.open-userside',
            knowledgeId: 'billing.userside-link',
            title: 'Перейди в UserSide к точке подключения',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findUsersideLink(caseData),
            markOnClick: false
          };
        }
        if (page.system === 'userside' && ethernetDeviceUrl(caseData)) {
          return {
            id: 'ethernet.resume-switch',
            knowledgeId: 'userside.ethernet-access-point',
            title: 'Открой коммутатор точки подключения',
            text: rec.reason,
            kind: 'navigate',
            url: ethernetDeviceUrl(caseData)
          };
        }
        return {
          id: 'ethernet.return-card',
          title: 'Вернись на карточку Billing',
          text: 'На карточке находится штатный переход USERSIDE к Ethernet-точке подключения.',
          kind: page.system === 'userside' ? 'focus-source' : 'navigate',
          focusSource: page.system === 'userside',
          url: page.system === 'userside' ? '' : billingCardUrl(caseData)
        };

      case 'check_ethernet_fdb':
        if (page.pageKind === 'userside_device') {
          return {
            id: 'ethernet.open-fdb',
            knowledgeId: 'userside.ethernet-fdb',
            title: 'Открой FDB-таблицу',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findEthernetFdbLink(caseData),
            markOnClick: false
          };
        }
        return {
          id: 'ethernet.return-switch-for-fdb',
          knowledgeId: 'userside.ethernet-fdb',
          title: 'Вернись на коммутатор',
          text: rec.reason,
          kind: ethernetDeviceUrl(caseData) ? 'navigate' : 'none',
          url: ethernetDeviceUrl(caseData)
        };

      case 'check_ethernet_errors':
        if (page.pageKind === 'userside_device') {
          return {
            id: 'ethernet.open-errors',
            knowledgeId: 'userside.ethernet-errors',
            title: 'Проверь ошибки порта',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findEthernetErrorsLink(caseData),
            markOnClick: false
          };
        }
        return {
          id: 'ethernet.open-errors-direct',
          knowledgeId: 'userside.ethernet-errors',
          title: 'Открой ошибки интерфейсов',
          text: rec.reason,
          kind: ethernetErrorsUrl(caseData) ? 'navigate' : 'none',
          url: ethernetErrorsUrl(caseData)
        };

      case 'ethernet_summary':
        return {
          id: 'ethernet.summary',
          knowledgeId: 'userside.ethernet-summary',
          title: 'Ethernet-путь проверен',
          text: rec.reason,
          kind: 'none'
        };

      case 'check_tmc':
        if (page.pageKind === 'billing_user') {
          return {
            id: 'billing.open-userside',
            title: 'Перейди в UserSide → ТМЦ',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findUsersideLink(caseData),
            markOnClick: false
          };
        }
        if (page.pageKind === 'billing_technical') {
          const inspection = technicalInspection(caseData);
          const reviewPlan = technicalReviewPlan(caseData);
          if (reviewPlan) return reviewPlan;
          return {
            id: 'billing.return-for-userside',
            title: 'Вернись на карточку Billing',
            text: `${inspection.summary} Ссылка USERSIDE находится на карточке абонента.`,
            kind: 'navigate',
            url: billingCardUrl(caseData)
          };
        }
        if (page.pageKind === 'userside_customer') {
          const tmcBlock = findTmcBlock(caseData);
          const hasTmcOlt = Boolean(
            valueOf(caseData?.pon?.tmcOltName)
            || valueOf(caseData?.pon?.tmcOltIp)
          );
          const inspectFields = rec.params?.inspectFields || rec.params?.missingBilling || [];
          return {
            id: tmcReviewStepId(caseData),
            title: hasTmcOlt ? 'Сверь ТМЦ с Billing' : 'Проверь ТМЦ абонента',
            text: hasTmcOlt ? tmcFoundText(caseData, inspectFields) : rec.reason,
            kind: 'highlight',
            resolver: () => tmcHighlightTarget(caseData) || tmcBlock,
            markOnClick: false,
            focusSource: hasTmcOlt,
            stickyEvidence: true
          };
        }
        if (page.system.includes('billing')) {
          return {
            id: 'billing.resume-userside-tmc',
            title: 'Вернись к переходу в UserSide',
            text: rec.reason,
            kind: 'navigate',
            url: billingCardUrl(caseData)
          };
        }
        return {
          id: 'userside.return-customer',
          title: 'Вернись на карточку абонента',
          text: rec.reason,
          kind: usersideCustomerUrl(caseData) ? 'navigate' : 'none',
          url: usersideCustomerUrl(caseData)
        };

      case 'search_mac':
        if (page.pageKind === 'userside_customer') {
          return {
            id: 'userside.search-mac',
            title: 'Проверь, где виден MAC устройства',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => rowHighlightTarget(findCustomerMacSearchLink(caseData)),
            markOnClick: false
          };
        }
        if (page.system === 'userside') {
          return {
            id: 'userside.return-customer-for-mac',
            title: 'Открой карточку абонента',
            text: 'Ссылка поиска находится рядом с MAC устройства на карточке абонента.',
            kind: usersideCustomerUrl(caseData) ? 'navigate' : 'none',
            url: usersideCustomerUrl(caseData)
          };
        }
        return {
          id: 'billing.open-userside-for-mac',
          title: 'Перейди в UserSide',
          text: rec.reason,
          kind: page.pageKind === 'billing_user' ? 'highlight' : 'navigate',
          resolver: page.pageKind === 'billing_user'
            ? () => findUsersideLink(caseData)
            : undefined,
          url: page.pageKind === 'billing_user' ? '' : billingCardUrl(caseData)
        };

      case 'search_uplink_downlink':
        if (page.pageKind === 'userside_customer_list') {
          return {
            id: 'userside.search-topology',
            title: 'Расширь поиск MAC на UPLINK/DOWNLINK',
            text: rec.reason,
            kind: 'highlight',
            resolver: findUplinkDownlinkLink,
            markOnClick: false
          };
        }
        return {
          id: 'userside.return-mac-search',
          title: 'Вернись к результатам MAC-поиска',
          text: rec.reason,
          kind: 'none'
        };

      case 'inspect_interface':
        if (page.pageKind === 'userside_customer_list') {
          return {
            id: 'userside.inspect-interface',
            title: `Открой интерфейс ${candidate?.interface || ''}`.trim(),
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findCandidateInterfaceLink(caseData),
            markOnClick: false,
            stickyEvidence: true
          };
        }
        return {
          id: 'userside.interface-wait',
          title: 'Открой найденный интерфейс',
          text: rec.reason,
          kind: 'none'
        };

      case 'inspect_device':
        if (
          page.pageKind === 'interface_mac_list'
          || page.pageKind === 'userside_customer_list'
        ) {
          const resultTarget = candidateResultTarget(caseData);
          if (resultTarget) {
            const resultAction = macResultOverlayAction(candidate);
            return {
              id: 'userside.mac-result',
              knowledgeId: 'userside.mac-result',
              title: 'MAC найден на оборудовании',
              text: macCandidateResultText(caseData),
              kind: 'highlight',
              resolver: () => candidateResultTarget(caseData),
              markOnClick: false,
              stickyEvidence: true,
              overlayAction: resultAction.action,
              overlayActionLabel: resultAction.label
            };
          }
          return {
            id: 'userside.mac-result',
            knowledgeId: 'userside.mac-result',
            title: 'MAC найден на оборудовании',
            text: macCandidateResultText(caseData),
            kind: 'none'
          };
        }
        return {
          id: 'userside.device-details',
          title: 'Сверь IP и тип найденной OLT',
          text: rec.reason,
          kind: 'none'
        };

      case 'inspect_onu_details': {
        const missing = rec.params?.missingBilling || [];
        if (page.pageKind === 'userside_device') {
          return {
            id: 'userside.inspect-onu-details',
            title: `Добери ${technicalFieldLabels(missing) || 'идентификаторы ONU'}`,
            text: rec.reason,
            kind: 'none'
          };
        }
        if (
          page.pageKind === 'interface_mac_list'
          || page.pageKind === 'userside_customer_list'
        ) {
          const link = findCandidateDeviceLink(caseData);
          return link ? {
            id: 'userside.open-device-for-onu',
            title: 'Открой найденное оборудование',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findCandidateDeviceLink(caseData),
            markOnClick: false
          } : {
            id: 'userside.open-device-for-onu',
            title: 'Открой найденное оборудование',
            text: rec.reason,
            kind: candidateDeviceUrl(caseData) ? 'navigate' : 'none',
            url: candidateDeviceUrl(caseData)
          };
        }
        return {
          id: 'userside.resume-device-for-onu',
          title: 'Вернись к найденному оборудованию',
          text: rec.reason,
          kind: candidateDeviceUrl(caseData) ? 'navigate' : 'none',
          url: candidateDeviceUrl(caseData)
        };
      }

      case 'fill_billing_technical': {
        const fields = rec.params?.fields || [];
        const expected = rec.params?.expectedTechnical || {};
        const labels = technicalFieldLabels(fields) || 'технические поля';
        if (page.system === 'userside') {
          const fromTmc = rec.params?.source === 'tmc';
          return {
            id: fromTmc ? tmcReviewStepId(caseData) : 'userside.candidate-ready-for-billing',
            title: `Данных достаточно для Billing: ${labels}`,
            text: fromTmc
              ? tmcFoundText(caseData, fields)
              : 'Фактическая привязка подтверждена. Вернись в Billing и сверь только указанные поля.',
            kind: fromTmc ? 'highlight' : 'focus-source',
            resolver: fromTmc ? () => tmcHighlightTarget(caseData) : undefined,
            markOnClick: false,
            focusSource: true,
            semanticTargetId: 'billing.technical',
            stickyEvidence: fromTmc
          };
        }
        if (page.pageKind === 'billing_user') {
          return {
            id: 'billing.reopen-technical-for-fields',
            title: `Открой техданные: ${labels}`,
            text: 'Workbench не подставляет значения автоматически: оператор должен сверить источник и сам подтвердить изменение.',
            kind: 'highlight',
            resolver: () => findTechnicalDataLink(caseData),
            markOnClick: false
          };
        }
        if (page.pageKind === 'billing_technical') {
          if (currentTechnicalMatches(fields, expected)) {
            return {
              id: 'billing.save-technical-fields',
              title: `Данные подставлены — сохрани: ${labels}`,
              text: 'Поля уже заполнены в форме, но это ещё не сохранённые данные Billing. Нажми штатную «Сохранить»; только после повторного чтения станет доступен опрос ONU.',
              kind: 'highlight',
              resolver: findSaveButton,
              markOnClick: true
            };
          }
          return {
            id: `billing.fill-technical:${fields.join('+')}`,
            title: `Сверь и заполни: ${labels}`,
            text: rec.reason,
            kind: 'highlight',
            resolver: () => technicalFieldsTarget(fields),
            markOnClick: false
          };
        }
        return {
          id: 'billing.resume-fill-technical',
          title: `Вернись к техданным: ${labels}`,
          text: rec.reason,
          kind: page.system === 'userside' ? 'focus-source' : 'navigate',
          focusSource: page.system === 'userside',
          semanticTargetId: 'billing.technical',
          url: page.system === 'userside' ? '' : billingTechnicalUrl(caseData)
        };
      }

      case 'fill_billing_olt':
        if (rec.params?.source === 'mac_name' && page.system === 'userside') {
          const resultTarget = candidateResultTarget(caseData);
          if (resultTarget) {
            return {
              id: 'userside.mac-name-ready-for-billing',
              knowledgeId: 'userside.mac-result',
              title: 'OLT найдена по MAC',
              text: `${candidate?.oltName || 'OLT найдена'}. IP для этого шага не нужен: Workbench попробует подобрать эту OLT в штатном списке Billing.`,
              kind: 'highlight',
              resolver: () => candidateResultTarget(caseData),
              markOnClick: false,
              stickyEvidence: true,
              overlayAction: 'return-billing-technical',
              overlayActionLabel: 'Вернуться в тех. данные'
            };
          }
          return {
            id: 'userside.mac-name-ready-for-billing',
            title: 'OLT найдена по MAC',
            text: rec.reason,
            kind: 'focus-source',
            focusSource: true,
            semanticTargetId: 'billing.technical'
          };
        }
        if (page.system === 'userside') {
          return {
            id: tmcReviewStepId(caseData),
            title: 'OLT найдена в ТМЦ',
            text: tmcFoundText(caseData),
            kind: 'highlight',
            resolver: () => tmcHighlightTarget(caseData),
            markOnClick: false,
            focusSource: true,
            semanticTargetId: 'billing.technical',
            stickyEvidence: true
          };
        }
        if (page.pageKind === 'billing_user') {
          return {
            id: 'billing.reopen-technical-for-olt',
            title: 'Открой технические данные',
            text: rec.reason,
            kind: 'highlight',
            resolver: () => findTechnicalDataLink(caseData),
            markOnClick: false
          };
        }
        if (page.pageKind === 'billing_technical') {
          if (rec.params?.phase === 'save') {
            return {
              id: 'billing.save-olt',
              title: 'Сохрани выбранную OLT',
              text: rec.reason,
              kind: 'highlight',
              resolver: findSaveButton,
              markOnClick: true
            };
          }
          if (rec.params?.source === 'mac_name') {
            const resolved = resolveAndApplyOltByName(caseData);
            if (resolved.status === 'selected') {
              window.setTimeout(() => WB.runtime.forceScan?.('olt-name-auto-selected'), 0);
              return {
                id: 'billing.save-olt',
                title: 'OLT найдена и подставлена',
                text: `${resolved.selectedText}. Проверь выбранную OLT и нажми «Сохранить».`,
                kind: 'highlight',
                resolver: findSaveButton,
                markOnClick: true
              };
            }
            if (resolved.status === 'ambiguous' || resolved.status === 'not_found') {
              return {
                id: 'billing.resolve-olt-name',
                title: 'Не удалось однозначно подобрать OLT',
                text: `По MAC найдена «${candidate?.oltName || 'OLT'}», но штатный список Billing не дал одного надёжного совпадения. Только теперь нужен дополнительный источник — карточка оборудования/IP.`,
                kind: 'highlight',
                resolver: findOltField,
                markOnClick: false,
                overlayAction: 'open-candidate-device',
                overlayActionLabel: 'Открыть OLT для уточнения'
              };
            }
          }
          return {
            id: 'billing.fill-olt',
            title: 'Выбери найденную OLT',
            text: `${rec.reason}${candidate?.oltIp ? ` IP: ${candidate.oltIp}.` : ''}`,
            kind: 'highlight',
            resolver: findOltField,
            markOnClick: false
          };
        }
        return {
          id: 'billing.resume-fill-olt',
          title: 'Вернись к выбору OLT',
          text: rec.reason,
          kind: page.system === 'userside' ? 'focus-source' : 'navigate',
          focusSource: page.system === 'userside',
          url: page.system === 'userside'
            ? ''
            : billingTechnicalUrl(caseData)
        };

      case 'complete_confirmed':
        // Terminal command blocks are visual/educational semantics, not automatic route steps.
        // A successful ONU poll terminates the locator route. Do not tell the operator to
        // inspect Ethernet merely because an `ont port state` block happens to exist.
        // Context-specific follow-ups (link down, 100M negotiation, optical issue, etc.)
        // must be raised by a separate diagnostic rule when that symptom is actually relevant.
        return {
          id: 'result.confirmed',
          title: 'Опрос ONU выполнен',
          text: rec.reason,
          kind: 'none'
        };

      case 'complete_not_found':
        return {
          id: 'result.not-found',
          title: 'Абонент не найден',
          text: rec.reason,
          kind: 'none'
        };

      case 'resolve_conflict':
        return {
          id: 'result.conflict',
          title: 'Нужно разрешить конфликт данных',
          text: rec.reason,
          kind: 'none'
        };

      case 'manual_review':
        return {
          id: 'result.manual-review',
          title: 'Нужна ручная проверка',
          text: rec.reason,
          kind: 'none'
        };

      case 'switch_port':
        return {
          id: 'ethernet.route',
          title: 'Проверить порт коммутатора',
          text: rec.reason,
          kind: 'none'
        };

      case 'wait_context':
        return {
          id: 'route.wait-context',
          title: 'Ожидание подтверждения',
          text: rec.reason,
          kind: 'none'
        };

      default:
        return null;
    }
  }

  function plan(caseData) {
    const page = pageInfo();
    const diagnostic = caseData?.diagnostic || {};
    const route = caseData?.route || {};

    if (!caseData) {
      return {
        id: 'no-case',
        title: 'Открой карточку абонента',
        text: 'Guide Mode запускается после определения текущего кейса.',
        kind: 'none'
      };
    }

    // DOM evidence wins over a briefly stale Locator recommendation. Billing can
    // replace the Ask OLT row before the async case update reaches the rail. Once
    // terminal output exists, the old action must never be offered or resolved again.
    if (
      page.pageKind === 'billing_onu_poll'
      && hasExpectedTerminalResult(caseData)
    ) {
      return {
        id: 'result.review-terminal',
        title: 'Сверить результаты',
        text: 'Вывод OLT уже получен. Подсветка терминальных блоков запускается автоматически.',
        kind: 'none'
      };
    }

    // A durable, correlated OLT snapshot is the end of the acquisition route on
    // every page. Never send the operator backwards to Juniper/Technical/UserSide
    // after they have already completed the real ONU poll themselves.
    if (
      caseData?.locator?.termination?.status === 'confirmed'
      || caseData?.live?.oltSnapshot?.status === 'confirmed'
    ) {
      return {
        id: 'result.confirmed',
        title: 'Опрос ONU выполнен',
        text: 'Ответ OLT сохранён в LIVE. Дополнительный маршрут сбора данных завершён.',
        kind: 'none'
      };
    }

    const writebackFlow = caseData?.workflow?.ponAcquisition || {};
    // Hard logical wall: DOM-prefilled Technical values are still unsaved.
    // No Guide route may expose ONU polling until native Save is confirmed by
    // the next Billing document. This guard intentionally outranks stale
    // locator/diagnostic recommendations.
    if (writebackFlow.tmcWritebackPendingSave && Array.isArray(writebackFlow.tmcWritebackAppliedFields) && writebackFlow.tmcWritebackAppliedFields.length) {
      const fields = Array.isArray(writebackFlow.tmcWritebackAppliedFields) && writebackFlow.tmcWritebackAppliedFields.length
        ? writebackFlow.tmcWritebackAppliedFields
        : Array.isArray(writebackFlow.tmcWritebackFields)
          ? writebackFlow.tmcWritebackFields
          : ['olt'];
      const labels = technicalFieldLabels(fields) || 'технические данные';
      if (page.pageKind === 'billing_technical') {
        return {
          id: 'billing.save-technical-fields',
          title: `Данные подставлены — сохрани: ${labels}`,
          text: 'Поля заполнены только в текущей форме. Нажми штатную «Сохранить»; опрос ONU откроется только после подтверждения сохранённых данных.',
          kind: 'highlight',
          resolver: findSaveButton,
          markOnClick: true
        };
      }
      return {
        id: 'billing.resume-fill-technical',
        title: 'Сначала сохрани технические данные',
        text: `В форме Billing остались несохранённые изменения: ${labels}. Вернись и нажми штатную «Сохранить».`,
        kind: page.system === 'userside' ? 'focus-source' : 'navigate',
        focusSource: page.system === 'userside',
        semanticTargetId: 'billing.technical',
        url: page.system === 'userside' ? '' : billingTechnicalUrl(caseData)
      };
    }


    // Juniper remains useful read-only evidence, but it is no longer a hard
    // acquisition gate. LIVE may show the background session snapshot and the
    // operator may open Juniper whenever it is useful; the approved PON flow
    // itself starts from Billing technical data and follows missing knowledge.

    const locatorAction = recommendation(caseData)?.action || '';
    if (
      page.pageKind === 'billing_technical'
      && !['fill_billing_technical', 'fill_billing_olt'].includes(locatorAction)
    ) {
      const reviewPlan = technicalReviewPlan(caseData);
      if (reviewPlan) return reviewPlan;
    }

    const locatorPlan = planLocator(caseData, page);
    if (locatorPlan) return locatorPlan;

    if (!diagnostic.technicalVisited) {
      if (page.pageKind === 'billing_user') {
        return {
          id: 'billing.open-technical',
          title: 'Перейди в технические данные',
          text: 'После read-only проверки Juniper сверяем тип подключения, ONU и OLT.',
          kind: 'highlight',
          resolver: () => findTechnicalDataLink(caseData),
          markOnClick: false
        };
      }

      return {
        id: 'billing.return-card',
        title: 'Открой карточку Billing',
        text: 'На карточке будет подсвечена ссылка «Технические данные».',
        kind: 'navigate',
        url: page.system.includes('billing')
          ? billingCardUrl(caseData)
          : '',
        focusSource: page.system === 'userside'
      };
    }

    if (diagnostic.isEthernet) {
      return {
        id: 'ethernet.route',
        title: 'Проверить порт коммутатора',
        text: 'Для Ethernet используются Juniper, коммутатор, MAC и события порта.',
        kind: 'none'
      };
    }

    if (
      diagnostic.isPon
      && !diagnostic.hasBillingOltName
    ) {
      if (
        diagnostic.hasTmcOlt
        && page.pageKind === 'billing_technical'
      ) {
        const selectedNow = Boolean(
          valueOf(caseData?.pon?.oltName)
        );

        if (
          selectedNow
          && route.billingOltInitiallyMissing
          && !currentUpdatedFlag()
        ) {
          return {
            id: 'billing.save-olt',
            title: 'Сохрани выбранную OLT',
            text: 'OLT найдена по ТМЦ. После проверки выбора нажми «Сохранить».',
            kind: 'highlight',
            resolver: findSaveButton,
            markOnClick: false
          };
        }

        return {
          id: 'billing.fill-olt',
          title: 'Выбери OLT из данных ТМЦ',
          text: `Найдена ${valueOf(caseData?.pon?.tmcOltName) || 'OLT'} (${valueOf(caseData?.pon?.tmcOltIp) || 'IP не указан'}).`,
          kind: 'highlight',
          resolver: findOltField,
          markOnClick: false
        };
      }

      if (
        diagnostic.hasTmcOlt
        && page.system === 'userside'
      ) {
        return {
          id: tmcReviewStepId(caseData),
          title: 'OLT найдена в ТМЦ',
          text: tmcFoundText(caseData),
          kind: 'highlight',
          resolver: () => tmcHighlightTarget(caseData),
          markOnClick: false,
          focusSource: true,
          semanticTargetId: 'billing.technical',
          stickyEvidence: true
        };
      }

      if (page.pageKind === 'billing_user') {
        if (diagnostic.hasTmcOlt) {
          return {
            id: 'billing.reopen-technical-for-olt',
            title: 'Вернись в технические данные',
            text: 'OLT найдена в ТМЦ. Теперь выбери её в поле Billing и сохрани.',
            kind: 'highlight',
            resolver: () => findTechnicalDataLink(caseData),
            markOnClick: false
          };
        }

        return {
          id: 'billing.open-userside',
          title: 'Перейди в UserSide → ТМЦ',
          text: 'В Billing OLT отсутствует. Второй шаг — проверить ТМЦ.',
          kind: 'highlight',
          resolver: () => findUsersideLink(caseData),
          markOnClick: false
        };
      }

      if (page.pageKind === 'billing_technical') {
        return {
          id: 'billing.return-for-userside',
          title: 'Вернись на карточку Billing',
          text: 'Ссылка USERSIDE находится на карточке абонента.',
          kind: 'navigate',
          url: billingCardUrl(caseData)
        };
      }

      if (page.system === 'userside') {
        return {
          id: 'userside.find-tmc',
          title: 'Найди ONU в ТМЦ',
          text: 'Если прямого совпадения нет — следующим этапом будет поиск по MAC.',
          kind: 'highlight',
          resolver: () => findTmcBlock(caseData),
          markOnClick: true
        };
      }
    }

    if (
      diagnostic.isPon
      && diagnostic.hasBillingOltName
      && page.pageKind === 'billing_technical'
    ) {
      if (
        route.billingOltInitiallyMissing
        && diagnostic.hasTmcOlt
        && !currentUpdatedFlag()
      ) {
        return {
          id: 'billing.save-olt',
          title: 'Сохрани выбранную OLT',
          text: 'После сохранения вернись на карточку Billing.',
          kind: 'highlight',
          resolver: findSaveButton,
          markOnClick: false
        };
      }

      return {
        id: 'billing.return-card-for-poll',
        title: 'Вернись на карточку Billing',
        text: 'OLT определена. На карточке будет подсвечена нужная вкладка опроса.',
        kind: 'navigate',
        url: billingCardUrl(caseData)
      };
    }

    if (
      diagnostic.readyForOnuPoll
      && page.pageKind === 'billing_user'
    ) {
      return {
        id: 'billing.open-poll-tab',
        title: `Открой ${diagnostic.subtype || 'PON'}-опрос`,
        text: `Тип определён по названию OLT. Используется a=${diagnostic.pollAction}.`,
        kind: 'highlight',
        resolver: () => findPollTab(caseData),
        markOnClick: false
      };
    }

    if (
      diagnostic.readyForOnuPoll
      && page.pageKind === 'billing_onu_poll'
      && !diagnostic.hasLiveResult
    ) {
      return {
        id: 'billing.ask-olt',
        title: 'Запусти запрос OLT',
        text: 'Подсветится ссылка только в строке, совпавшей по OLT IP и ONU.',
        kind: 'highlight',
        resolver: () => askOltHighlightTarget(caseData),
        markOnClick: false
      };
    }

    if (diagnostic.hasLiveResult) {
      return {
        id: 'result.ready',
        title: 'Результат опроса зафиксирован',
        text: 'Маршрут завершён, данные сохранены в кейс.',
        kind: 'none'
      };
    }

    return {
      id: 'route.wait',
      title: 'Продолжи сверку данных',
      text: 'Workbench ожидает следующий подтверждённый факт.',
      kind: 'none'
    };
  }


  function expectedTechnicalSnapshot(caseData, fields = []) {
    const rec = recommendation(caseData);
    const candidate = recommendedCandidate(caseData) || {};
    const explicit = rec?.params?.expectedTechnical || {};
    const result = {
      oltName: explicit.oltName
        || candidate.oltName
        || valueOf(caseData?.pon?.tmcOltName)
        || '',
      oltIp: explicit.oltIp
        || candidate.oltIp
        || valueOf(caseData?.pon?.tmcOltIp)
        || '',
      onuSerial: explicit.onuSerial
        || candidate.onuSerial
        || valueOf(caseData?.pon?.tmcOnuSerial)
        || '',
      onuMac: explicit.onuMac
        || candidate.onuMac
        || valueOf(caseData?.pon?.tmcOnuMac)
        || ''
    };
    return Object.fromEntries(
      Object.entries(result).filter(([key]) => (
        !fields.length
        || (key.startsWith('olt') && fields.includes('olt'))
        || (key === 'onuSerial' && fields.includes('onuSerial'))
        || (key === 'onuMac' && fields.includes('onuMac'))
      ))
    );
  }

  function guideExpectation(currentPlan, caseData) {
    if (!currentPlan?.id) return null;
    const id = String(currentPlan.id);
    const rec = recommendation(caseData);
    const recFields = Array.isArray(rec?.params?.fields)
      ? rec.params.fields.slice()
      : [];

    const pageKind = (kind, system = '') => ({
      type: 'page_kind',
      pageKind: kind,
      system,
      actionMode: 'click'
    });

    if (
      id === 'billing.open-technical'
      || id === 'billing.reopen-technical-for-fields'
      || id === 'billing.reopen-technical-for-olt'
      || id === 'billing.resume-technical'
      || id === 'billing.resume-fill-technical'
      || id === 'billing.resume-fill-olt'
    ) return pageKind('billing_technical', 'billing');

    if (
      id === 'billing.return-card'
      || id === 'billing.return-card-for-poll'
      || id === 'billing.return-for-userside'
      || id === 'billing.resume-userside-tmc'
    ) return pageKind('billing_user', 'billing');

    if (
      id === 'billing.open-userside'
      || id === 'billing.open-userside-for-mac'
      || id === 'userside.return-customer'
      || id === 'userside.return-customer-for-mac'
    ) return pageKind('userside_customer', 'userside');

    if (id === 'billing.open-poll-tab') {
      return pageKind('billing_onu_poll', 'billing');
    }

    if (id === 'resume-billing-for-poll' || id === 'userside.candidate-ready-for-billing') {
      return {
        type: 'page_kind',
        pageKind: '',
        system: 'billing',
        actionMode: 'click'
      };
    }

    if (id.startsWith('userside.inspect-tmc:') || id === 'userside.find-tmc') {
      return {
        type: 'tmc_checked',
        actionMode: 'context'
      };
    }

    if (id === 'userside.search-mac') {
      return {
        type: 'mac_search',
        searchMode: 'direct',
        actionMode: 'click'
      };
    }

    if (id === 'userside.search-topology') {
      return {
        type: 'mac_search',
        searchMode: 'uplink_downlink',
        actionMode: 'click'
      };
    }

    if (id === 'userside.inspect-interface') {
      return {
        type: 'interface_checked',
        actionMode: 'click'
      };
    }

    if (
      id === 'userside.inspect-device'
      || id === 'userside.open-device-for-onu'
      || id === 'userside.resume-device-for-onu'
    ) {
      return {
        type: 'device_checked',
        actionMode: 'click'
      };
    }

    if (id === 'billing.ask-olt') {
      return {
        type: 'poll_terminal',
        actionMode: 'click',
        outcomes: [
          'confirmed',
          'not_found',
          'parser_error',
          'olt_unreachable',
          'timeout',
          'conflict',
          'partial'
        ]
      };
    }

    if (id === 'billing.fill-olt') {
      const fields = ['olt'];
      return {
        type: 'technical_fields_match',
        fields,
        expectedTechnical: expectedTechnicalSnapshot(caseData, fields),
        actionMode: 'change'
      };
    }

    if (id.startsWith('billing.fill-technical:')) {
      const fields = recFields.length
        ? recFields
        : id.split(':')[1]?.split('+').filter(Boolean) || [];
      return {
        type: 'technical_fields_match',
        fields,
        expectedTechnical: expectedTechnicalSnapshot(caseData, fields),
        actionMode: 'change'
      };
    }

    if (id === 'billing.save-olt') {
      const fields = ['olt'];
      return {
        type: 'billing_save_verified',
        fields,
        expectedTechnical: expectedTechnicalSnapshot(caseData, fields),
        actionMode: 'click'
      };
    }

    if (id === 'billing.save-technical-fields') {
      const fields = recFields.length ? recFields : ['olt'];
      return {
        type: 'billing_save_verified',
        fields,
        expectedTechnical: expectedTechnicalSnapshot(caseData, fields),
        actionMode: 'click'
      };
    }

    return null;
  }

  function semanticTargetForPlan(currentPlan, caseData = WB.store.activeCase?.() || null) {
    const explicit = String(currentPlan?.semanticTargetId || '');
    if (explicit) return explicit;
    const id = String(currentPlan?.id || '');
    if (id === 'billing.open-technical' || id === 'billing.resume-technical' || id.startsWith('billing.reopen-technical')) return 'billing.technical';
    if (id === 'userside.find-tmc' || id.startsWith('userside.inspect-tmc:') || id === 'billing.open-userside' || id === 'billing.return-for-userside' || id === 'billing.resume-userside-tmc' || id === 'replay.tmc') return 'userside.tmc';
    if (id === 'billing.open-poll-tab' || id === 'billing.switch-correct-poll-tab' || id === 'billing.return-card-for-poll' || id === 'replay.poll') return 'billing.poll.entry';
    if (id === 'billing.ask-olt') return 'billing.olt.request';
    if (id === 'billing.open-juniper' || id === 'billing.inspect-juniper' || id === 'replay.juniper') return 'billing.juniper';
    if (id === 'replay.technical') return 'billing.technical';
    return WB.actionLifecycle?.semanticForPlanId?.(id) || (id ? `guide.${id}` : 'guide.unknown');
  }

  function actionDestinationForPlan(currentPlan, caseData = WB.store.activeCase?.() || null) {
    const semanticTargetId = semanticTargetForPlan(currentPlan, caseData);
    const billingId = String(valueOf(caseData?.identity?.billingId) || '');
    const customerId = String(valueOf(caseData?.identity?.customerId) || '');
    if (semanticTargetId === 'billing.technical') return { destinationSystem: 'billing', destinationPageKind: 'billing_technical', destinationEntityId: billingId };
    if (semanticTargetId === 'userside.tmc') return { destinationSystem: 'userside', destinationPageKind: 'userside_customer', destinationEntityId: customerId };
    if (semanticTargetId === 'billing.poll.entry') return { destinationSystem: 'billing', destinationPageKind: 'billing_user', destinationEntityId: billingId };
    if (semanticTargetId === 'billing.olt.request') return { destinationSystem: 'billing', destinationPageKind: 'billing_onu_poll', destinationEntityId: billingId };
    if (semanticTargetId === 'billing.juniper') return { destinationSystem: 'billing', destinationPageKind: 'billing_juniper', destinationEntityId: billingId };
    return { destinationSystem: pageInfo().system || '', destinationPageKind: pageInfo().pageKind || '', destinationEntityId: '' };
  }

  function ensureActionSession(currentPlan, caseData, options = {}) {
    if (!WB.actionLifecycle || !currentPlan || !caseData?.id) return null;
    const semanticTargetId = semanticTargetForPlan(currentPlan, caseData);
    const existing = WB.actionLifecycle.current?.();
    if (existing && !WB.actionLifecycle.isTerminal?.(existing) && String(existing.caseId || '') === String(caseData.id) && String(existing.semanticTargetId || '') === semanticTargetId) {
      return existing;
    }
    const destination = actionDestinationForPlan(currentPlan, caseData);
    const sourcePage = pageInfo();
    const destinationChangesContext = Boolean(
      destination.destinationSystem
      && (
        destination.destinationSystem !== sourcePage.system
        || (destination.destinationPageKind && destination.destinationPageKind !== sourcePage.pageKind)
      )
    );
    const started = WB.actionLifecycle.start({
      operationType: options.operationType || (currentPlan?.replayOnly ? 'DIRECT_REPLAY' : 'GUIDE_ACTION'),
      intent: currentPlan?.replayOnly ? 'DIRECT_REPLAY' : 'GUIDED_NAVIGATION',
      navigationCapable: Boolean(
        currentPlan?.replayOnly
        || currentPlan?.kind === 'navigate'
        || currentPlan?.kind === 'focus-source'
        || currentPlan?.focusSource
        || destinationChangesContext
        || semanticTargetId === 'billing.olt.request'
      ),
      caseId: caseData.id,
      semanticTargetId,
      targetType: 'semantic',
      ...destination,
      expectedPostCondition: options.expectedPostCondition || (currentPlan?.replayOnly
        ? `semantic destination ${semanticTargetId} подтверждён для текущего Case`
        : `semantic target ${semanticTargetId} достигнут, evidence подтверждено и Focus показан`),
      sourceAction: options.sourceAction || (currentPlan?.replayOnly ? 'live-history-replay' : 'guide'),
      title: currentPlan.title || '',
      text: currentPlan.text || '',
      replayOnly: Boolean(currentPlan.replayOnly),
      planId: currentPlan.id || '',
      targetTimeoutMs: options.targetTimeoutMs || 12000
    });
    return started?.session || null;
  }

  function guideTargetDetails(targetElement, currentPlan) {
    const element = targetElement instanceof Element ? targetElement : null;
    const anchor = navigationAnchor(element);
    return {
      title: String(currentPlan?.title || '').slice(0, 220),
      kind: String(currentPlan?.kind || '').slice(0, 80),
      pageKind: pageInfo().pageKind,
      targetTag: String(element?.tagName || '').toLowerCase(),
      targetId: String(element?.id || '').slice(0, 120),
      targetName: String(element?.getAttribute?.('name') || '').slice(0, 120),
      targetText: String(
        element?.innerText
        || element?.textContent
        || element?.value
        || ''
      ).replace(/\s+/g, ' ').trim().slice(0, 220),
      targetHref: allowedGuideUrl(anchor?.href || '')
    };
  }

  async function markPlanHint(currentPlan, caseData, targetElement = null) {
    const expected = guideExpectation(currentPlan, caseData);
    if (!expected || !currentPlan?.id) return null;
    const result = await WB.store.markGuideHint(
      currentPlan.id,
      {
        ...guideTargetDetails(targetElement, currentPlan),
        text: String(currentPlan.text || '').slice(0, 320)
      },
      expected
    );
    // Focus is latched to the operator's explicit request. Showing a hint must
    // never trigger a scan that can immediately invalidate the same hint.
    return result;
  }

  async function markPlanAction(currentPlan, caseData, targetElement = null, method = 'target-click', extra = {}) {
    const expected = guideExpectation(currentPlan, caseData);
    if (!expected || !currentPlan?.id) return null;
    return WB.store.markGuideAction(
      currentPlan.id,
      {
        ...guideTargetDetails(targetElement, currentPlan),
        method,
        ...extra
      },
      expected
    );
  }

  function interactionElementsForPlan(currentPlan, caseData, targetElement) {
    const expected = guideExpectation(currentPlan, caseData);
    if (!expected) return [];
    if (expected.actionMode === 'change') {
      return (expected.fields || [])
        .map(technicalControl)
        .filter(Boolean);
    }
    if (expected.actionMode === 'click') {
      const anchor = navigationAnchor(targetElement);
      return [anchor || targetElement].filter(Boolean);
    }
    return [];
  }

  function allowedGuideUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      return (
        ['https:', 'http:'].includes(url.protocol)
        && [
          'admin.simnet.kiev.ua',
          'admin.looknet.kiev.ua',
          'userside.simnet.kiev.ua'
        ].includes(url.hostname)
      ) ? url.href : '';
    } catch {
      return '';
    }
  }

  function semanticBillingTargetFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      if (!/^admin\.(?:simnet|looknet)\.kiev\.ua$/i.test(url.hostname)) return '';
      if (url.searchParams.get('act')) return '';
      const action = String(url.searchParams.get('a') || '');
      if (action === 'user') return 'billing.user';
      if (action === 'dopdata') return 'billing.technical';
      if (action === '252') return 'billing.juniper';
      if (action === '310') return 'billing.poll.epon';
      if (action === '311') return 'billing.poll.gpon';
      if (action === '312') return 'billing.poll.gcom';
      if (action === '313') return 'billing.poll.huawei';
      return '';
    } catch {
      return '';
    }
  }

  function navigationAnchor(targetElement) {
    if (!(targetElement instanceof Element)) return null;
    if (targetElement.matches('a[href]')) return targetElement;
    return (
      targetElement.closest?.('a[href]')
      || targetElement.querySelector?.('a[href]')
      || null
    );
  }

  function targetNavigationUrl(targetElement) {
    const anchor = navigationAnchor(targetElement);
    return allowedGuideUrl(anchor?.href || '');
  }

  async function executePlanNavigation(currentPlan, caseData, targetElement = null) {
    if (!currentPlan) return { ok: false, reason: 'missing-plan' };

    const actionSession = ensureActionSession(currentPlan, caseData, {
      operationType: 'GUIDE_NAVIGATION',
      sourceAction: 'guide-navigation'
    });
    const semanticTargetId = String(
      currentPlan.semanticTargetId
      || semanticTargetForPlan(currentPlan, caseData)
      || ''
    );

    // Never perform a cross-page Guide navigation without its ActionSession.
    // Previously a stale navigation lock could make start() return no session,
    // while the handoff still opened UserSide. The operator then landed on the
    // right customer card with no surviving command to scroll/focus TMC.
    if (!actionSession && semanticTargetId) {
      void WB.observability?.report?.({
        severity: 'WARNING',
        code: 'GUIDE_NAVIGATION_SESSION_MISSING',
        operationType: 'GUIDE_NAVIGATION',
        source: 'guide',
        stage: 'START',
        message: 'Навигация остановлена: semantic ActionSession не создана',
        details: {
          caseId: caseData?.id || '',
          semanticTargetId,
          planId: currentPlan?.id || ''
        }
      });
      return { ok: false, reason: 'action-session-unavailable', plan: currentPlan };
    }

    // Cross-page safety needs one durable NAVIGATING snapshot before the source
    // document disappears. Do not serialize hint/action bookkeeping in front of
    // that critical write: those records are informative and may persist after
    // navigation is already dispatched.
    const persistNavigationIntent = async actualResult => {
      if (!actionSession) return true;
      WB.actionLifecycle?.navigationStarted?.(actionSession, { actualResult });
      return WB.actionLifecycle?.flushPersistence?.();
    };
    const recordActionLater = (extra = {}) => {
      void markPlanAction(
        currentPlan,
        caseData,
        targetElement,
        'guide-navigation',
        extra
      ).catch?.(() => {});
    };

    if (currentPlan.kind === 'focus-source' || currentPlan.focusSource) {
      await persistNavigationIntent('focus-source');
      recordActionLater();
      const billingId = String(valueOf(caseData?.identity?.billingId) || '');
      if (semanticTargetId.startsWith('billing.') && WB.billingNavigation?.navigate) {
        const result = await WB.billingNavigation.navigate({
          caseId: caseData?.id || '',
          semanticTargetId,
          entityId: billingId,
          intent: 'GUIDED_NAVIGATION',
          operationId: actionSession?.operationId || '',
          sourceAction: 'guide-focus-source'
        });
        return {
          ok: Boolean(result?.ok),
          reason: result?.ok ? '' : (result?.reason || 'billing-navigation-rejected'),
          plan: currentPlan,
          result
        };
      }
      const result = await WB.handoff.focusSource(caseData);
      return {
        ok: Boolean(result?.focused),
        reason: result?.focused ? '' : 'source-tab-unavailable',
        plan: currentPlan,
        result
      };
    }

    // The TMC route is semantic, not a literal replay of the old anchor. Use
    // the handoff broker directly so an already-open same-Case UserSide card can
    // be focused without any storage write or reload.
    if (semanticTargetId === 'userside.tmc' && WB.handoff?.openUsersideForCase) {
      await persistNavigationIntent('userside.tmc');
      recordActionLater({ semanticTargetId: 'userside.tmc' });
      const result = await WB.handoff.openUsersideForCase(caseData);
      return {
        ok: Boolean(result?.ok),
        reason: result?.ok ? '' : (result?.reason || 'userside-navigation-failed'),
        plan: currentPlan,
        result
      };
    }

    const directUrl = currentPlan.kind === 'navigate'
      ? allowedGuideUrl(currentPlan.url || '')
      : '';
    const anchor = currentPlan.kind === 'highlight'
      ? navigationAnchor(targetElement)
      : null;
    const targetUrl = directUrl || targetNavigationUrl(targetElement);

    if (!targetUrl) {
      return {
        ok: false,
        reason: currentPlan.kind === 'highlight'
          ? 'highlight-target-is-not-a-link'
          : 'navigation-url-unavailable',
        plan: currentPlan
      };
    }

    await persistNavigationIntent(targetUrl);
    recordActionLater({ targetUrl });

    const semanticBillingTarget = semanticBillingTargetFromUrl(targetUrl);
    if (semanticBillingTarget && WB.billingNavigation?.navigate) {
      const result = await WB.billingNavigation.navigate({
        caseId: caseData?.id || '',
        semanticTargetId: semanticBillingTarget,
        entityId: String(valueOf(caseData?.identity?.billingId) || ''),
        intent: 'GUIDED_NAVIGATION',
        operationId: actionSession?.operationId || '',
        sourceAction: 'guide-semantic-navigation'
      });
      return {
        ok: Boolean(result?.ok),
        reason: result?.ok ? '' : (result?.reason || 'billing-navigation-rejected'),
        plan: currentPlan,
        result
      };
    }

    if (anchor && WB.handoff?.isUsersideHandoffLink?.(anchor)) {
      const prepared = await WB.handoff.prepareFromAnchor(anchor);
      if (!prepared) return { ok: false, reason: 'handoff-prepare-failed', plan: currentPlan };
      const opened = window.open(anchor.href, anchor.target || '_blank');
      return {
        ok: Boolean(opened),
        reason: opened ? '' : 'popup-blocked',
        plan: currentPlan,
        url: anchor.href
      };
    }

    const target = anchor?.target || '';
    if (target && target !== '_self') {
      const opened = window.open(targetUrl, target);
      return {
        ok: Boolean(opened),
        reason: opened ? '' : 'popup-blocked',
        plan: currentPlan,
        url: targetUrl
      };
    }

    location.assign(targetUrl);
    return { ok: true, plan: currentPlan, url: targetUrl };
  }

  class GuideOverlay {
    constructor() {
      this.root = null;
      this.ring = null;
      this.tip = null;
      this.shades = [];
      this.relatedLayer = null;
      this.relatedMarkers = [];
      this.target = null;
      this.targetElement = null;
      this.rectResolver = null;
      this.currentPlan = null;
      this.caseData = null;
      this.caseId = '';
      this.boundUpdate = this.update.bind(this);
      this.boundTargetClick = null;
      this.boundTargetPointerDown = null;
      this.boundTargetChange = null;
      this.boundTargetInput = null;
      this.interactionElements = [];
      this.actionRecorded = false;
      this.pointerSnapshot = null;
      this.boundShadeClick = null;
      this.boundCloseClick = null;
      this.boundNavigateClick = null;
      this.boundKeydown = null;
      this.active = false;
      this.requestId = 0;
      this.actionSession = null;
      this.lastKnownRect = null;
    }

    normalizeTarget(target) {
      if (target instanceof Element) {
        return {
          element: target,
          getRect: () => target.getBoundingClientRect()
        };
      }

      if (target?.element instanceof Element) {
        return {
          element: target.element,
          getRect: typeof target.getRect === 'function'
            ? target.getRect
            : () => target.element.getBoundingClientRect()
        };
      }

      return null;
    }

    emitActive(active) {
      document.documentElement?.classList?.toggle('simnet-wb-guide-active', Boolean(active));
      if (this.active === active) return;
      this.active = active;
      WB.runtime.guideActive = active;
      WB.bus.emit('guide:active', {
        active,
        plan: active ? this.currentPlan : null
      });
    }

    ensure() {
      if (this.root?.isConnected) return;

      this.root = document.createElement('div');
      this.root.id = OVERLAY_ID;
      this.root.innerHTML = `
        <style>
          @keyframes simnetWbGuidePulse {
            0%,100% {
              box-shadow:
                0 0 0 3px rgba(165,0,70,.18),
                0 0 18px rgba(165,0,70,.34);
            }
            50% {
              box-shadow:
                0 0 0 7px rgba(165,0,70,.07),
                0 0 28px rgba(165,0,70,.52);
            }
          }
          #${OVERLAY_ID} {
            position: fixed;
            inset: 0;
            z-index: 2147483644;
            pointer-events: none;
            visibility: hidden;
            font-family: Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
          }
          #${OVERLAY_ID} .shade {
            position: fixed;
            display: block;
            background: rgba(5,10,16,.22);
            pointer-events: auto;
            transition: left .16s ease, top .16s ease, width .16s ease, height .16s ease;
          }
          #${OVERLAY_ID} .ring {
            position: fixed;
            border: 2px solid rgba(165,0,70,.92);
            border-radius: 12px;
            background: rgba(165,0,70,.045);
            animation: simnetWbGuidePulse .7s ease-out 1;
            animation-fill-mode: forwards;
            transition: left .16s ease, top .16s ease, width .16s ease, height .16s ease;
            pointer-events: none;
          }
          #${OVERLAY_ID} .ring-badge,
          #${OVERLAY_ID} .related-badge {
            position:absolute;
            left:-2px;
            top:-24px;
            min-height:20px;
            padding:0 7px;
            display:flex;
            align-items:center;
            gap:4px;
            border-radius:7px 7px 7px 2px;
            color:#fff;
            background:#A50046;
            box-shadow:0 6px 16px rgba(0,0,0,.24);
            font:800 9px/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
            white-space:nowrap;
          }
          #${OVERLAY_ID} .related-marker {
            position:fixed;
            border:1px solid rgba(34,211,238,.68);
            border-radius:9px;
            background:rgba(34,211,238,.035);
            box-shadow:inset 3px 0 0 rgba(34,211,238,.42);
            transition:left .16s ease,top .16s ease,width .16s ease,height .16s ease;
            pointer-events:none;
          }
          #${OVERLAY_ID} .related-badge {
            left:-1px;
            top:-19px;
            min-height:17px;
            padding:0 5px;
            color:#dffbff;
            background:rgba(9,43,53,.96);
            border:1px solid rgba(34,211,238,.55);
            font-size:8px;
          }
          #${OVERLAY_ID} .tip {
            position: fixed;
            width: min(310px, calc(100vw - 88px));
            max-height: calc(100vh - 20px);
            overflow: auto;
            padding: 13px 14px 12px;
            border: 1px solid rgba(165,0,70,.46);
            border-radius: 14px;
            color: #fff;
            background:
              radial-gradient(circle at 100% 0,rgba(165,0,70,.12),transparent 38%),
              rgba(13,18,24,.975);
            box-shadow: 0 18px 42px rgba(0,0,0,.46),0 0 0 1px rgba(165,0,70,.10);
            font-size: 12px;
            font-weight: 500;
            line-height: 1.36;
            pointer-events: auto;
          }
          #${OVERLAY_ID} .tip-close {
            position: absolute;
            top: 7px;
            right: 7px;
            width: 28px;
            height: 28px;
            display: grid;
            place-items: center;
            border: 0;
            border-radius: 8px;
            color: rgba(255,255,255,.66);
            background: transparent;
            font: 500 22px/1 system-ui,sans-serif;
            cursor: pointer;
          }
          #${OVERLAY_ID} .tip-close:hover,
          #${OVERLAY_ID} .tip-close:focus-visible {
            color: #fff;
            background: rgba(255,255,255,.08);
            outline: none;
          }
          #${OVERLAY_ID} .tip-title {
            margin: 0 34px 7px 0;
            color: #fff;
            font-size: 15px;
            font-weight: 800;
            line-height: 1.2;
          }
          #${OVERLAY_ID} .tip-eyebrow {
            margin:0 34px 5px 0;
            color:rgba(244,190,214,.92);
            font-size:9px;
            font-weight:850;
            letter-spacing:.11em;
            text-transform:uppercase;
          }
          #${OVERLAY_ID} .tip-line {
            margin-top: 4px;
            color: rgba(255,255,255,.78);
          }
          #${OVERLAY_ID} .tip-line b {
            color: rgba(255,255,255,.95);
            font-weight: 750;
          }
          /* Compact Focus Layer: hide long what/why/simple blocks by default. */
          #${OVERLAY_ID} .tip-what,
          #${OVERLAY_ID} .tip-why,
          #${OVERLAY_ID} .tip-simple,
          #${OVERLAY_ID} .tip-context {
            display: none !important;
          }
          #${OVERLAY_ID} .tip-now {
            margin-top: 6px;
            padding-top: 0;
            border-top: none;
            color: rgba(255,226,239,.94);
            font-size: 12px;
            line-height: 1.35;
          }
          #${OVERLAY_ID} .tip-context {
            margin-top: 5px;
            color: rgba(255,255,255,.5);
            font-size: 11px;
          }
          #${OVERLAY_ID} .tip-simple {
            margin-top: 7px;
            padding: 7px 8px;
            border: 1px solid rgba(165,0,70,.25);
            border-radius: 8px;
            color: rgba(255,226,239,.90);
            background: rgba(165,0,70,.10);
            font-size: 11px;
          }
          #${OVERLAY_ID} .tip-fields {
            display:grid;
            gap:6px;
            margin-top:9px;
          }
          #${OVERLAY_ID} .tip-fields[hidden] {
            display:none!important;
          }
          #${OVERLAY_ID} .tip-field {
            padding:7px 8px;
            border:1px solid rgba(255,255,255,.1);
            border-left:3px solid rgba(156,242,195,.68);
            border-radius:8px;
            background:rgba(255,255,255,.035);
          }
          #${OVERLAY_ID} .tip-field[data-status="missing"],
          #${OVERLAY_ID} .tip-field[data-status="conflict"] {
            border-left-color:#ffb454;
            background:rgba(255,180,84,.075);
          }
          #${OVERLAY_ID} .tip-field[data-status="conditional"] {
            border-left-color:#6fb8ff;
          }
          #${OVERLAY_ID} .tip-field-head {
            color:#fff;
            font-size:11px;
            font-weight:800;
          }
          #${OVERLAY_ID} .tip-field-meaning {
            margin-top:2px;
            color:rgba(255,255,255,.62);
            font-size:10.5px;
          }
          #${OVERLAY_ID} .tip-actions {
            display:flex;
            flex-wrap:wrap;
            gap:7px;
            margin-top:10px;
          }
          #${OVERLAY_ID} .tip-actions[hidden] {
            display:none!important;
          }
          #${OVERLAY_ID} .tip-action {
            min-height:34px;
            padding:0 12px;
            border:1px solid rgba(216,91,145,.52);
            border-radius:9px;
            color:#fff;
            background:#A50046;
            font:800 12px/1.2 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
            cursor:pointer;
          }
          #${OVERLAY_ID} .tip-action:hover {
            filter:brightness(1.08);
          }
          #${OVERLAY_ID} .tip-action:disabled {
            color:rgba(255,255,255,.58);
            background:rgba(255,255,255,.08);
            border-color:rgba(255,255,255,.12);
            cursor:default;
            filter:none;
          }
        </style>
        <div class="shade shade-top" data-dismiss-guide></div>
        <div class="shade shade-left" data-dismiss-guide></div>
        <div class="shade shade-right" data-dismiss-guide></div>
        <div class="shade shade-bottom" data-dismiss-guide></div>
        <div class="related-layer"></div>
        <div class="ring"><span class="ring-badge">1 · Сейчас</span></div>
        <section class="tip" role="dialog" aria-label="Контекстная подсказка">
          <button type="button" class="tip-close" aria-label="Закрыть подсказку">×</button>
          <div class="tip-eyebrow">Сейчас</div>
          <div class="tip-title"></div>
          <div class="tip-line tip-what" hidden></div>
          <div class="tip-line tip-why" hidden></div>
          <div class="tip-simple" hidden></div>
          <div class="tip-line tip-now"></div>
          <div class="tip-context" hidden></div>
          <div class="tip-fields" hidden></div>
          <div class="tip-actions" hidden>
            <button type="button" class="tip-action"></button>
          </div>
        </section>
      `;

      document.documentElement.appendChild(this.root);
      this.ring = this.root.querySelector('.ring');
      this.tip = this.root.querySelector('.tip');
      this.shades = [...this.root.querySelectorAll('.shade')];
      this.relatedLayer = this.root.querySelector('.related-layer');
    }

    brief(value, maxLength = 180) {
      const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length <= maxLength) return text;
      return `${text.slice(0, maxLength - 1).trimEnd()}…`;
    }

    async waitForStableTarget(element, rectResolver, requestId) {
      let previous = null;
      let stableSince = 0;
      const started = performance.now();
      const stableForMs = 100;
      const maxWaitMs = 700;

      while (performance.now() - started <= maxWaitMs) {
        await new Promise(resolve => (window.requestAnimationFrame || window.setTimeout)(resolve));
        if (requestId !== this.requestId || !element?.isConnected) return null;
        if (WB.interactionGuards?.isElementUsable && !WB.interactionGuards.isElementUsable(element)) {
          previous = null;
          stableSince = 0;
          continue;
        }

        let rect = null;
        try {
          rect = rectResolver?.() || element.getBoundingClientRect();
        } catch {
          return null;
        }
        if (!rect || rect.width < 2 || rect.height < 2) {
          previous = null;
          stableSince = 0;
          continue;
        }

        if (previous) {
          const delta = Math.max(
            Math.abs(rect.left - previous.left),
            Math.abs(rect.top - previous.top),
            Math.abs(rect.width - previous.width),
            Math.abs(rect.height - previous.height)
          );
          if (delta < 1) {
            if (!stableSince) stableSince = performance.now();
            if (performance.now() - stableSince >= stableForMs) return rect;
          } else {
            stableSince = 0;
          }
        }
        previous = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        };
      }
      return null;
    }

    async waitForOperatorScrollIdle(requestId, { quietMs = 110, maxWaitMs = 480 } = {}) {
      // Transient guard only while a target is about to be focused. It prevents
      // Workbench from fighting an operator who is actively scrolling, without
      // installing a permanent listener/poller. No scroll activity -> resolve on
      // the next animation frame; active scrolling -> wait for a short quiet gap.
      return await new Promise(resolve => {
        let settled = false;
        let activitySeen = false;
        let quietTimer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (quietTimer) clearTimeout(quietTimer);
          clearTimeout(maxTimer);
          window.removeEventListener('wheel', onActivity, true);
          window.removeEventListener('touchmove', onActivity, true);
          window.removeEventListener('scroll', onActivity, true);
          resolve(requestId === this.requestId);
        };
        const onActivity = event => {
          if (event?.isTrusted === false) return;
          activitySeen = true;
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quietMs);
        };
        const maxTimer = setTimeout(finish, maxWaitMs);
        window.addEventListener('wheel', onActivity, { passive: true, capture: true });
        window.addEventListener('touchmove', onActivity, { passive: true, capture: true });
        window.addEventListener('scroll', onActivity, { passive: true, capture: true });
        const raf = window.requestAnimationFrame || (callback => setTimeout(callback, 0));
        raf(() => {
          if (!activitySeen) finish();
        });
      });
    }

    async show(target, currentPlan, caseData) {
      let tmcTeleportVisual = null;
      const normalizedTarget = this.normalizeTarget(target);
      if (!normalizedTarget || !normalizedTarget.element.isConnected) {
        return {
          ok: false,
          reason: 'target-not-found'
        };
      }

      if (
        currentPlan?.id === 'billing.ask-olt'
        && hasExpectedTerminalResult(caseData)
      ) {
        return {
          ok: false,
          reason: 'terminal-result-active'
        };
      }

      if (
        this.active
        && this.currentPlan?.id === currentPlan?.id
        && this.targetElement === normalizedTarget.element
      ) {
        this.caseData = caseData;
        this.update();
        return { ok: true, alreadyActive: true };
      }

      this.clear('ACTION_SUPERSEDED');
      const requestId = ++this.requestId;
      this.target = target;
      this.targetElement = normalizedTarget.element;
      this.rectResolver = normalizedTarget.getRect;
      this.currentPlan = currentPlan;
      this.caseData = caseData;
      this.caseId = String(caseData?.id || '');
      this.actionSession = currentPlan?.replayOnly
        ? WB.actionLifecycle?.current?.() || null
        : ensureActionSession(currentPlan, caseData, { operationType: 'GUIDE_HIGHLIGHT', sourceAction: 'guide-highlight' });
      this.actionRecorded = false;
      this.pointerSnapshot = null;

      if (!this.targetElement?.isConnected) {
        let refreshedTarget = null;
        try {
          refreshedTarget = typeof currentPlan?.resolver === 'function'
            ? currentPlan.resolver()
            : null;
        } catch {}
        const refreshed = this.normalizeTarget(refreshedTarget);
        if (!refreshed?.element?.isConnected) {
          this.clear();
          return {
            ok: false,
            reason: 'target-detached'
          };
        }
        this.target = refreshedTarget;
        this.targetElement = refreshed.element;
        this.rectResolver = refreshed.getRect;
      }
      if (this.actionSession) {
        const page = pageInfo();
        if (WB.actionLifecycle?.destinationMatches?.(this.actionSession, page)) {
          if (['REQUESTED','NAVIGATING'].includes(this.actionSession.status)) WB.actionLifecycle.destinationReached(this.actionSession, { actualResult: page.pageKind || '' });
          if (this.actionSession.status === 'DESTINATION_REACHED') WB.actionLifecycle.waitingTarget(this.actionSession);
        }
        if (['REQUESTED','NAVIGATING','DESTINATION_REACHED','WAITING_TARGET'].includes(this.actionSession.status)) WB.actionLifecycle.targetReady(this.actionSession, { actualResult: this.actionSession.semanticTargetId });
      }

      const scrollMayContinue = await this.waitForOperatorScrollIdle(requestId);
      if (!scrollMayContinue || requestId !== this.requestId) {
        return { ok: false, reason: 'hint-superseded' };
      }

      try {
        this.targetElement.scrollIntoView({
          behavior: 'auto',
          block: 'center',
          inline: 'center'
        });
      } catch {
        this.clear();
        return {
          ok: false,
          reason: 'target-detached'
        };
      }

      let stableRect = await this.waitForStableTarget(
        this.targetElement,
        this.rectResolver,
        requestId
      );
      if (requestId !== this.requestId) {
        return {
          ok: false,
          reason: 'hint-superseded'
        };
      }
      if (!stableRect || !this.targetElement?.isConnected) {
        this.clear();
        return {
          ok: false,
          reason: 'target-not-stable'
        };
      }

      // scrollIntoView() may be ignored by a legacy nested scroller or land on
      // a still-offscreen semantic rect. For the TMC teleport, "shown" means the
      // real block physically intersects the viewport. Retry once with an
      // explicit document scroll before allowing Focus/milestone persistence.
      const requiresViewportTeleport = Boolean(
        this.actionSession
        && String(this.actionSession.semanticTargetId || '') === 'userside.tmc'
        && !currentPlan?.replayOnly
      );
      if (requiresViewportTeleport && !rectIntersectsViewport(stableRect)) {
        try {
          const currentY = Number(window.scrollY || document.documentElement?.scrollTop || 0);
          const desiredY = Math.max(0, currentY + Number(stableRect.top || 0) - Math.max(80, Number(window.innerHeight || 0) * 0.42));
          window.scrollTo({ top: desiredY, behavior: 'auto' });
        } catch {}
        await new Promise(resolve => (window.requestAnimationFrame || window.setTimeout)(resolve));
        stableRect = await this.waitForStableTarget(
          this.targetElement,
          this.rectResolver,
          requestId
        );
        if (!stableRect || !rectIntersectsViewport(stableRect)) {
          this.clear('TARGET_SEMANTICALLY_INVALID');
          void WB.observability?.report?.({
            severity: 'ERROR',
            code: 'TMC_TELEPORT_VIEWPORT_NOT_REACHED',
            operationType: this.actionSession?.operationType || 'GUIDE_NAVIGATION',
            operationId: this.actionSession?.operationId || '',
            source: 'guide',
            stage: 'SCROLL',
            message: 'TMC target найден, но Workbench не смог физически довести его в viewport',
            details: { caseId: caseData?.id || '', semanticTargetId: 'userside.tmc' }
          });
          return { ok: false, reason: 'tmc-target-not-in-viewport' };
        }
      }

      if (
        this.actionSession
        && (
          WB.actionLifecycle?.isTerminal?.(this.actionSession)
          || String(WB.actionLifecycle?.current?.()?.operationId || '') !== String(this.actionSession.operationId || '')
        )
      ) {
        this.clear('ACTION_SESSION_TERMINAL');
        return {
          ok: false,
          reason: 'action-session-terminal-before-focus'
        };
      }

      // The visual response must not wait behind the serialized Case write queue.
      // Persist the semantic hint after the target is already stable, but do it
      // asynchronously: a slow chrome.storage commit may never make the first
      // operator click look dead. Replay remains read-only.
      if (!currentPlan?.replayOnly) {
        void markPlanHint(
          currentPlan,
          caseData,
          this.targetElement
        ).catch?.(() => {});
      }
      if (requestId !== this.requestId || this.currentPlan !== currentPlan) {
        return { ok: false, reason: 'hint-superseded' };
      }
      if (currentPlan?.id === 'billing.ask-olt' && hasExpectedTerminalResult(caseData)) {
        this.clear();
        return { ok: false, reason: 'terminal-result-active' };
      }

      // Create the visual surface only after the target exists and has stopped moving.
      // This prevents the one-frame ring/tip flash at (0,0) during Billing DOM reloads.
      this.ensure();

      // Restore the exact v29.32 TMC evidence visual for FIRST-PASS Guide:
      // separate plum marks for OLT/IP/SN/MAC, aligned to the widest marked line.
      // History Replay stays lightweight and does not re-run this teaching layer.
      if (
        !currentPlan?.replayOnly
        && (
          this.actionSession?.semanticTargetId === 'userside.tmc'
          || currentPlan?.id === 'userside.find-tmc'
          || String(currentPlan?.id || '').startsWith('userside.inspect-tmc:')
        )
      ) {
        const tmcVisualRoot = traceVisualElement(this.targetElement) || this.targetElement;
        highlightTmcValues(caseData, tmcVisualRoot);
        tmcTeleportVisual = tmcTeleportVisualConfirmation(caseData, tmcVisualRoot);
      }

      this.relatedMarkers = [];
      let relatedTargets = [];
      if (typeof currentPlan?.relatedResolver === 'function') {
        try {
          relatedTargets = currentPlan.relatedResolver() || [];
        } catch {
          relatedTargets = [];
        }
      }
      for (const item of relatedTargets.slice(0, 3)) {
        const normalized = this.normalizeTarget(item);
        if (
          !normalized?.element?.isConnected
          || normalized.element === this.targetElement
        ) continue;
        const marker = document.createElement('div');
        marker.className = 'related-marker';
        const badge = document.createElement('span');
        badge.className = 'related-badge';
        badge.textContent = `${this.relatedMarkers.length + 2} · ${item?.label || 'Связано'}`;
        marker.appendChild(badge);
        this.relatedLayer.appendChild(marker);
        this.relatedMarkers.push({
          element: normalized.element,
          getRect: normalized.getRect,
          marker
        });
      }

      const knowledge = WB.knowledge?.resolve?.(currentPlan) || null;
      const title = knowledge?.title || currentPlan.title || 'Следующий шаг';
      // Compact Focus Layer: title + one short action. No What/Why/Simple walls of text.
      const action = this.brief(
        knowledge?.action || currentPlan.text || currentPlan.title || 'Нажмите на выделенный элемент.',
        140
      );

      this.tip.querySelector('.tip-title').textContent = title;
      this.tip.querySelector('.tip-eyebrow').textContent = this.relatedMarkers.length
        ? `1 + ${this.relatedMarkers.length}`
        : 'Сейчас';
      this.tip.querySelector('.tip-what').textContent = '';
      this.tip.querySelector('.tip-why').textContent = '';
      this.tip.querySelector('.tip-simple').textContent = '';
      this.tip.querySelector('.tip-now').textContent = action;
      this.tip.querySelector('.tip-context').textContent = '';
      this.tip.querySelector('.tip-what').hidden = true;
      this.tip.querySelector('.tip-why').hidden = true;
      this.tip.querySelector('.tip-simple').hidden = true;
      this.tip.querySelector('.tip-context').hidden = true;
      if (this.tip) {
        this.tip.title = [knowledge?.what, knowledge?.why, knowledge?.simple]
          .filter(Boolean)
          .join(' — ')
          .slice(0, 280);
      }

      const fieldList = this.tip.querySelector('.tip-fields');
      fieldList.replaceChildren();
      const fieldSummary = Array.isArray(currentPlan.fieldSummary)
        ? currentPlan.fieldSummary
        : [];
      for (const field of fieldSummary) {
        const item = document.createElement('div');
        item.className = 'tip-field';
        item.dataset.status = String(field.status || 'ok');
        const head = document.createElement('div');
        head.className = 'tip-field-head';
        head.textContent = `${field.label || field.field} · ${field.statusLabel || ''}`;
        const meaning = document.createElement('div');
        meaning.className = 'tip-field-meaning';
        meaning.textContent = field.meaning || '';
        item.append(head, meaning);
        fieldList.appendChild(item);
      }
      fieldList.hidden = fieldSummary.length === 0;

      // A highlight is guidance only. Never turn a highlighted DOM target into an
      // implicit navigation action just because that subtree happens to contain an <a>.
      // The operator clicks the highlighted page control directly; ACTION/RESULT evidence
      // is captured from that real interaction. This also prevents terminal blocks from
      // accidentally reloading/re-polling through an unrelated nested link.
      const utilityReturnCustomer = currentPlan.overlayAction === 'return-customer'
        && Boolean(usersideCustomerUrl(caseData));
      const utilityOpenCandidate = currentPlan.overlayAction === 'open-candidate-device'
        && Boolean(candidateDeviceUrl(caseData));
      const utilityCompleteStep = currentPlan.overlayAction === 'complete-step';
      const utilityReturnBillingTechnical = currentPlan.overlayAction === 'return-billing-technical';
      const operatorMustClickPageControl = currentPlan?.id === 'billing.ask-olt';
      const canNavigate = Boolean(
        !operatorMustClickPageControl
        && (
          utilityReturnCustomer
          || utilityOpenCandidate
          || utilityCompleteStep
          || utilityReturnBillingTechnical
          || currentPlan.focusSource
          || currentPlan.kind === 'focus-source'
          || (currentPlan.kind === 'navigate' && allowedGuideUrl(currentPlan.url || ''))
        )
      );
      const actions = this.tip.querySelector('.tip-actions');
      const navigateButton = this.tip.querySelector('.tip-action');
      actions.hidden = !canNavigate;
      navigateButton.disabled = false;
      navigateButton.textContent = (
        utilityReturnCustomer
        || utilityOpenCandidate
        || utilityCompleteStep
        || utilityReturnBillingTechnical
      )
        ? (currentPlan.overlayActionLabel || 'Продолжить')
        : (
          currentPlan.focusSource
          || currentPlan.kind === 'focus-source'
        )
          ? 'Вернуться в Billing'
          : 'Перейти';

      this.boundNavigateClick = canNavigate ? async event => {
        event.preventDefault();
        event.stopPropagation();
        navigateButton.disabled = true;
        const originalLabel = navigateButton.textContent;
        navigateButton.textContent = 'Переход…';

        // Context utility only: return to the subscriber card. It is intentionally
        // NOT a diagnostic ACTION confirmation and never opens the equipment link.
        if (this.currentPlan?.overlayAction === 'return-customer') {
          const customerUrl = usersideCustomerUrl(this.caseData);
          if (customerUrl) {
            this.clear('PAGE_NAVIGATION');
            location.assign(customerUrl);
            return;
          }
          navigateButton.disabled = false;
          navigateButton.textContent = originalLabel;
          return;
        }

        if (this.currentPlan?.overlayAction === 'return-billing-technical') {
          const result = await WB.billingNavigation?.navigate?.({
            caseId: this.caseData?.id || '',
            semanticTargetId: 'billing.technical',
            entityId: String(valueOf(this.caseData?.identity?.billingId) || ''),
            intent: 'GUIDED_NAVIGATION',
            sourceAction: 'guide-return-billing-technical'
          });
          if (result?.ok) {
            this.clear('PAGE_NAVIGATION');
            return;
          }
          navigateButton.disabled = false;
          navigateButton.textContent = originalLabel;
          return;
        }

        if (this.currentPlan?.overlayAction === 'open-candidate-device') {
          const deviceUrl = candidateDeviceUrl(this.caseData);
          if (deviceUrl) {
            this.clear('PAGE_NAVIGATION');
            location.assign(deviceUrl);
            return;
          }
          navigateButton.disabled = false;
          navigateButton.textContent = originalLabel;
          return;
        }

        if (this.currentPlan?.overlayAction === 'complete-step') {
          await WB.store.markGuideStep(
            this.currentPlan.id,
            {
              ...guideTargetDetails(this.targetElement, this.currentPlan),
              method: 'operator-reviewed-fields',
              fields: (this.currentPlan.fieldSummary || []).map(field => ({
                field: field.field,
                status: field.status,
                value: String(field.value || '').slice(0, 220)
              }))
            },
            { phase: 'result' }
          );
          this.clear('TARGET_ACTIVATED');
          WB.runtime.forceScan?.('technical-fields-reviewed');
          return;
        }

        const result = await executePlanNavigation(
          this.currentPlan,
          this.caseData,
          this.targetElement
        );

        if (result?.ok) {
          this.clear('PAGE_NAVIGATION');
          return;
        }

        navigateButton.disabled = false;
        navigateButton.textContent = result?.reason === 'source-tab-unavailable'
          ? 'Вкладка Billing не найдена'
          : result?.reason === 'popup-blocked'
            ? 'Разрешите открытие вкладки'
            : originalLabel;
      } : null;
      if (this.boundNavigateClick) {
        navigateButton.addEventListener('click', this.boundNavigateClick);
      }

      this.boundCloseClick = event => {
        event.preventDefault();
        event.stopPropagation();
        this.clear('CLOSE_BUTTON');
      };
      this.tip.querySelector('.tip-close').addEventListener(
        'click',
        this.boundCloseClick
      );

      this.boundShadeClick = event => {
        if (event.target.closest?.('[data-dismiss-guide]')) {
          this.clear('BACKDROP_CLICK');
        }
      };
      for (const shade of this.shades) {
        shade.addEventListener('click', this.boundShadeClick);
      }

      this.boundKeydown = event => {
        if (event.key === 'Escape') this.clear('ESC');
      };
      window.addEventListener('keydown', this.boundKeydown, true);

      this.update();
      if (this.root) this.root.style.visibility = 'visible';

      window.addEventListener(
        'scroll',
        this.boundUpdate,
        true
      );
      window.addEventListener(
        'resize',
        this.boundUpdate
      );

      const expected = currentPlan?.replayOnly ? null : guideExpectation(currentPlan, caseData);
      this.interactionElements = interactionElementsForPlan(
        currentPlan,
        caseData,
        this.targetElement
      );

      const recordActionOnce = (method, eventTarget = null) => {
        if (this.actionRecorded) return;
        this.actionRecorded = true;
        const targetElement = eventTarget instanceof Element
          ? eventTarget
          : this.targetElement;
        void markPlanAction(
          currentPlan,
          caseData,
          targetElement,
          method,
          expected?.actionMode === 'change'
            ? {
                field: String(targetElement?.getAttribute?.('name') || ''),
                value: String(targetElement?.value || '').slice(0, 220)
              }
            : {}
        ).finally(() => {
          WB.runtime.forceScan?.('guide-action-confirmed');
        });
      };

      this.boundTargetPointerDown = event => {
        if (expected?.actionMode !== 'click') return;
        const logicalTarget = event.currentTarget instanceof Element
          ? event.currentTarget
          : this.targetElement;
        this.pointerSnapshot = WB.interactionGuards?.captureElementState?.(logicalTarget) || null;
      };
      this.boundTargetClick = event => {
        if (expected?.actionMode !== 'click') return;
        const logicalTarget = event.currentTarget instanceof Element
          ? event.currentTarget
          : this.targetElement;
        const guardKey = `guide:${caseData?.id || ''}:${currentPlan?.id || ''}`;
        const guarded = WB.interactionGuards?.guardLogicalAction
          ? WB.interactionGuards.guardLogicalAction(event, guardKey, {
              snapshot: this.pointerSnapshot,
              target: logicalTarget,
              lockMs: currentPlan?.id === 'billing.ask-olt' ? 900 : 1400,
              // The document-level Poll guard has already checked exact
              // href/action/billing/OLT binding and target connectivity. Guide is
              // only bookkeeping and must not cancel that accepted native click
              // because an unrelated Billing counter changed meanwhile.
              requireQuiet: false,
              // Navigation links such as USERSIDE must never feel "dead" merely
              // because legacy CRM mutated unrelated DOM between pointerdown/click.
              // We skip Guide ACTION recording in that case but let the native click
              // pass through. Poll requests remain strict and cancellable.
              cancelOnStale: false
            })
          : { ok: true };
        this.pointerSnapshot = null;
        if (!guarded?.ok) {
          this.actionRecorded = false;
          WB.log?.warn?.('GUIDE', 'Клик отклонён защитой стабильности', {
            stepId: currentPlan?.id || '',
            reason: guarded?.reason || 'guarded'
          });
          void WB.observability?.report?.({
            severity: 'WARNING',
            code: 'GUIDE_ACTION_GUARDED',
            operationType: currentPlan?.id === 'billing.ask-olt' ? 'OLT_POLL' : 'GUIDE_ACTION',
            source: 'guide',
            stage: currentPlan?.id || 'click',
            message: 'Штатный клик оператора был отклонён защитой стабильности',
            reason: guarded?.reason || 'guarded',
            details: { stepId: currentPlan?.id || '' }
          });
          return;
        }

        // Persist ACTION only after a real, stable click. Pointerdown alone is never
        // evidence that the requested action actually happened.
        recordActionOnce('target-click', logicalTarget);

        // A normal Focus Layer is a one-shot pointer. For the asynchronous
        // native OLT request, however, the click is only intent: the visual hint
        // closes while the ActionSession remains active until a validated terminal
        // result (or a real timeout/failure) arrives.
        if (currentPlan?.id !== 'billing.ask-olt') {
          this.clear('TARGET_ACTIVATED');
        }

        if (currentPlan?.id === 'billing.ask-olt') {
          WB.log?.info?.('GUIDE', 'Оператор запустил Запрос OLT', {
            stepId: currentPlan.id,
            method: 'native-page-click'
          });
          this.clear('TARGET_ACTIVATED_PENDING_RESULT');
          WB.bus?.emit?.('guide:poll-action-ended', {
            stepId: currentPlan.id,
            action: 'ask-olt'
          });
        }
      };
      this.boundTargetChange = event => {
        if (expected?.actionMode !== 'change') return;
        recordActionOnce('field-change', event.target);
      };
      this.boundTargetInput = event => {
        if (expected?.actionMode !== 'change') return;
        recordActionOnce('field-input', event.target);
      };

      for (const element of this.interactionElements) {
        element.addEventListener(
          'pointerdown',
          this.boundTargetPointerDown,
          { capture: true }
        );
        element.addEventListener(
          'click',
          this.boundTargetClick,
          { capture: true }
        );
        element.addEventListener(
          'change',
          this.boundTargetChange,
          { capture: true }
        );
        element.addEventListener(
          'input',
          this.boundTargetInput,
          { capture: true }
        );
      }


      this.emitActive(true);
      const shownResult = this.actionSession
        ? WB.actionLifecycle?.shown?.(this.actionSession, { actualResult: 'focus-visible' })
        : { ok: true };
      if (!shownResult?.ok) {
        this.clear('ACTION_SESSION_TERMINAL');
        return {
          ok: false,
          reason: shownResult?.reason || 'action-focus-transition-rejected'
        };
      }
      WB.operatorTrace?.recordSystemEvent?.('FOCUS_SHOW', {
        operationId: this.actionSession?.operationId || '',
        semanticTargetId: this.actionSession?.semanticTargetId || semanticTargetForPlan(currentPlan, caseData),
        planId: currentPlan?.id || ''
      });

      let tmcTeleportConfirmed = false;
      if (
        this.actionSession
        && !currentPlan?.replayOnly
        && String(this.actionSession.semanticTargetId || '') === 'userside.tmc'
      ) {
        tmcTeleportConfirmed = await recordTmcTeleportShown(
          caseData,
          this.actionSession,
          tmcTeleportVisual || { confirmed: false, expectedKinds: [], kinds: [], visibleCount: 0 }
        );
      }

      return {
        ok: true,
        operationId: this.actionSession?.operationId || '',
        tmcTeleportConfirmed,
        tmcValuesMarked: Number(tmcTeleportVisual?.visibleCount || 0),
        tmcMarkedKinds: tmcTeleportVisual?.kinds || []
      };
    }

    railLeftBoundary() {
      const host = document.getElementById('simnet-workbench-rail-host');
      const rect = host?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.left > 80) {
        return rect.left;
      }
      return Math.max(80, window.innerWidth - 58);
    }

    tryRebindTarget() {
      if (!this.active || !this.currentPlan || !this.actionSession || this.actionSession.status !== 'SHOWN') return false;
      let fresh = null;
      try {
        const resolved = WB.actionLifecycle?.resolve?.(this.actionSession, this.caseData);
        fresh = resolved?.raw || (resolved?.element ? resolved.element : null);
        if (!fresh && typeof this.currentPlan?.resolver === 'function') fresh = this.currentPlan.resolver();
      } catch {}
      const normalized = this.normalizeTarget(fresh);
      if (!normalized?.element?.isConnected) {
        WB.actionLifecycle?.beginRebind?.(this.actionSession);
        return false;
      }
      const previous = this.targetElement;
      for (const element of this.interactionElements || []) {
        if (this.boundTargetPointerDown) element.removeEventListener('pointerdown', this.boundTargetPointerDown, true);
        if (this.boundTargetClick) element.removeEventListener('click', this.boundTargetClick, true);
        if (this.boundTargetChange) element.removeEventListener('change', this.boundTargetChange, true);
        if (this.boundTargetInput) element.removeEventListener('input', this.boundTargetInput, true);
      }
      this.target = fresh;
      this.targetElement = normalized.element;
      this.rectResolver = normalized.getRect;
      this.interactionElements = interactionElementsForPlan(this.currentPlan, this.caseData, this.targetElement);
      for (const element of this.interactionElements) {
        if (this.boundTargetPointerDown) element.addEventListener('pointerdown', this.boundTargetPointerDown, { capture: true });
        if (this.boundTargetClick) element.addEventListener('click', this.boundTargetClick, { capture: true });
        if (this.boundTargetChange) element.addEventListener('change', this.boundTargetChange, { capture: true });
        if (this.boundTargetInput) element.addEventListener('input', this.boundTargetInput, { capture: true });
      }
      WB.actionLifecycle?.rebound?.(this.actionSession, {
        previousConnected: Boolean(previous?.isConnected),
        targetTag: String(this.targetElement?.tagName || '').toLowerCase()
      });
      return true;
    }

    update() {
      if (!this.root) return;
      if (!this.targetElement || !this.targetElement.isConnected) {
        if (!this.tryRebindTarget()) return;
      }

      let rect = null;
      try {
        rect = this.rectResolver?.()
          || this.targetElement.getBoundingClientRect();
      } catch {
        if (!this.tryRebindTarget()) return;
        rect = this.rectResolver?.() || this.targetElement.getBoundingClientRect();
      }
      if (!rect) {
        WB.actionLifecycle?.beginRebind?.(this.actionSession);
        return;
      }
      this.lastKnownRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };

      const pad = 7;
      const left = Math.max(4, rect.left - pad);
      const top = Math.max(4, rect.top - pad);
      const right = Math.min(window.innerWidth, rect.right + pad);
      const bottom = Math.min(window.innerHeight, rect.bottom + pad);
      const width = Math.max(24, right - left);
      const height = Math.max(24, bottom - top);

      Object.assign(this.ring.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      });

      for (const related of this.relatedMarkers || []) {
        if (!related.element?.isConnected) {
          related.marker.style.display = 'none';
          continue;
        }
        let relatedRect = null;
        try {
          relatedRect = related.getRect?.() || related.element.getBoundingClientRect();
        } catch {
          relatedRect = null;
        }
        if (!relatedRect || relatedRect.width < 2 || relatedRect.height < 2) {
          related.marker.style.display = 'none';
          continue;
        }
        const relatedPad = 4;
        related.marker.style.display = 'block';
        Object.assign(related.marker.style, {
          left: `${Math.max(3, relatedRect.left - relatedPad)}px`,
          top: `${Math.max(3, relatedRect.top - relatedPad)}px`,
          width: `${Math.max(18, Math.min(window.innerWidth, relatedRect.right + relatedPad) - Math.max(3, relatedRect.left - relatedPad))}px`,
          height: `${Math.max(18, Math.min(window.innerHeight, relatedRect.bottom + relatedPad) - Math.max(3, relatedRect.top - relatedPad))}px`
        });
      }

      const [shadeTop, shadeLeft, shadeRight, shadeBottom] = this.shades;
      Object.assign(shadeTop.style, {
        left: '0px',
        top: '0px',
        width: '100vw',
        height: `${top}px`
      });
      Object.assign(shadeLeft.style, {
        left: '0px',
        top: `${top}px`,
        width: `${left}px`,
        height: `${height}px`
      });
      Object.assign(shadeRight.style, {
        left: `${right}px`,
        top: `${top}px`,
        width: `${Math.max(0, window.innerWidth - right)}px`,
        height: `${height}px`
      });
      Object.assign(shadeBottom.style, {
        left: '0px',
        top: `${bottom}px`,
        width: '100vw',
        height: `${Math.max(0, window.innerHeight - bottom)}px`
      });

      const railLeft = this.railLeftBoundary();
      const gap = 14;
      const safeRight = Math.max(80, railLeft - gap);
      const tipWidth = Math.min(
        310,
        Math.max(230, safeRight - 20)
      );
      this.tip.style.width = `${tipWidth}px`;

      const measuredWidth = this.tip.offsetWidth || tipWidth;
      const measuredHeight = this.tip.offsetHeight || 220;
      const maxLeft = Math.max(10, safeRight - measuredWidth);

      let tipLeft;
      if (right + gap + measuredWidth <= safeRight) {
        tipLeft = right + gap;
      } else if (left - gap - measuredWidth >= 10) {
        tipLeft = left - gap - measuredWidth;
      } else {
        tipLeft = Math.min(maxLeft, Math.max(10, left));
      }

      let tipTop = top;
      if (tipTop + measuredHeight > window.innerHeight - 10) {
        tipTop = window.innerHeight - measuredHeight - 10;
      }
      tipTop = Math.max(10, tipTop);

      Object.assign(this.tip.style, {
        top: `${tipTop}px`,
        left: `${Math.min(maxLeft, Math.max(10, tipLeft))}px`
      });
    }

    clear(reason = 'UNEXPECTED_INTERNAL_CLEAR') {
      this.requestId += 1;
      const wasActive = this.active;
      const session = this.actionSession;
      const validDismiss = new Set(['BACKDROP_CLICK','ESC','CLOSE_BUTTON']);
      const savePlanDismissed = Boolean(
        wasActive
        && validDismiss.has(reason)
        && ['billing.save-technical-fields', 'billing.save-olt'].includes(String(this.currentPlan?.id || ''))
        && String((WB.runtime.lastContext || this.caseData?.currentContext || {}).pageKind || '') === 'billing_technical'
        && this.caseData?.workflow?.ponAcquisition?.tmcWritebackPendingSave
      );
      if (savePlanDismissed) {
        const dismissReason = `save-guide-${String(reason || '').toLowerCase()}`;
        // Closing the visual Save Guide is not equivalent to refusing the
        // writeback. Keep the semantic route frozen on Technical until either
        // native Save is clicked+verified or the operator leaves Technical.
        void WB.store?.dismissTmcWritebackPrompt?.(dismissReason).then(() => {
          document.querySelectorAll?.('.simnet-wb-native-save-attention').forEach(node => node.classList.remove('simnet-wb-native-save-attention'));
          WB.rail?.update?.(WB.store?.state);
        });
      }
      if (wasActive && session?.status === 'SHOWN') {
        const validComplete = new Set(['TARGET_ACTIVATED','TERMINAL_RESULT']);
        const validInterrupt = new Set(['PAGE_NAVIGATION','CASE_CHANGED','USER_INTERRUPTED','ACTION_SUPERSEDED','TARGET_SEMANTICALLY_INVALID']);
        const visualOnly = new Set(['TARGET_ACTIVATED_PENDING_RESULT','ACTION_SESSION_TERMINAL']);
        if (visualOnly.has(reason)) {
          // Deliberately no lifecycle transition: the native asynchronous action
          // owns completion and will terminalize this session from evidence.
        } else if (validDismiss.has(reason)) WB.actionLifecycle?.dismiss?.(session, reason);
        else if (validComplete.has(reason)) WB.actionLifecycle?.complete?.(session, reason, reason);
        else if (validInterrupt.has(reason)) WB.actionLifecycle?.interrupt?.(session, reason);
        else WB.actionLifecycle?.unexpectedFocusDrop?.(session, reason);
        WB.operatorTrace?.recordSystemEvent?.('FOCUS_HIDE', {
          operationId: session.operationId || '', semanticTargetId: session.semanticTargetId || '', reason
        });
      }

      window.removeEventListener(
        'scroll',
        this.boundUpdate,
        true
      );
      window.removeEventListener(
        'resize',
        this.boundUpdate
      );
      if (this.boundKeydown) {
        window.removeEventListener(
          'keydown',
          this.boundKeydown,
          true
        );
      }

      for (const element of this.interactionElements || []) {
        if (this.boundTargetPointerDown) {
          element.removeEventListener(
            'pointerdown',
            this.boundTargetPointerDown,
            true
          );
        }
        if (this.boundTargetClick) {
          element.removeEventListener(
            'click',
            this.boundTargetClick,
            true
          );
        }
        if (this.boundTargetChange) {
          element.removeEventListener(
            'change',
            this.boundTargetChange,
            true
          );
        }
        if (this.boundTargetInput) {
          element.removeEventListener(
            'input',
            this.boundTargetInput,
            true
          );
        }
      }

      for (const shade of this.shades || []) {
        if (this.boundShadeClick) {
          shade.removeEventListener('click', this.boundShadeClick);
        }
      }

      const closeButton = this.tip?.querySelector('.tip-close');
      if (closeButton && this.boundCloseClick) {
        closeButton.removeEventListener('click', this.boundCloseClick);
      }

      const navigateButton = this.tip?.querySelector('.tip-action');
      if (navigateButton && this.boundNavigateClick) {
        navigateButton.removeEventListener(
          'click',
          this.boundNavigateClick
        );
      }

      this.target = null;
      this.targetElement = null;
      this.rectResolver = null;
      this.currentPlan = null;
      this.caseData = null;
      this.caseId = '';
      this.actionSession = null;
      this.lastKnownRect = null;
      this.boundTargetClick = null;
      this.boundTargetPointerDown = null;
      this.boundTargetChange = null;
      this.boundTargetInput = null;
      this.interactionElements = [];
      this.actionRecorded = false;
      this.boundShadeClick = null;
      this.boundCloseClick = null;
      this.boundNavigateClick = null;
      this.boundKeydown = null;
      this.root?.remove();
      this.root = null;
      this.ring = null;
      this.tip = null;
      this.shades = [];
      this.relatedLayer = null;
      this.relatedMarkers = [];
      // Focus is a one-shot pointer, not persistent decoration. Any TMC point
      // marks owned by this focus disappear together with the backdrop.
      clearTmcValueMarks(document);

      if (wasActive) this.emitActive(false);
    }
  }

  const TRACE_STYLE_ID = 'simnet-workbench-evidence-trace-style';
  const REMINDER_STYLE_ID = 'simnet-workbench-familiar-reminder-style';
  let traceRefreshQueued = false;
  let reminderRefreshQueued = false;

  function learnedTargets() {
    return WB.store?.state?.experience?.learnedTargets || {};
  }

  function hasLearnedTarget(target) {
    return Boolean(target && learnedTargets()?.[target]?.completedCount > 0);
  }

  function ensureReminderStyle() {
    if (document.getElementById(REMINDER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = REMINDER_STYLE_ID;
    style.textContent = `
      [data-simnet-wb-reminder] {
        position: relative !important;
        outline: 1px solid rgba(165,0,70,.16) !important;
        outline-offset: 1px;
        box-shadow: inset 2px 0 0 rgba(165,0,70,.20) !important;
        background-image: linear-gradient(90deg,rgba(165,0,70,.018),transparent 42%) !important;
        transition: outline-color .14s ease, box-shadow .14s ease, background-image .14s ease;
      }
      [data-simnet-wb-reminder]:hover {
        outline-color: rgba(165,0,70,.34) !important;
        box-shadow: inset 2px 0 0 rgba(165,0,70,.38) !important;
        background-image: linear-gradient(90deg,rgba(165,0,70,.04),transparent 48%) !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function setFamiliarReminder(element, target, label, activeElements) {
    if (!(element instanceof Element) || !hasLearnedTarget(target)) return;
    // Current terminal trail is stronger and already explains the current case.
    if (element.hasAttribute('data-simnet-wb-trace')) return;
    activeElements.add(element);
    element.setAttribute('data-simnet-wb-reminder', target);
    element.setAttribute('data-simnet-wb-reminder-label', String(label || 'Знакомый элемент').slice(0, 120));
  }

  function clearStaleFamiliarReminders(activeElements) {
    for (const element of document.querySelectorAll('[data-simnet-wb-reminder]')) {
      if (activeElements.has(element)) continue;
      element.removeAttribute('data-simnet-wb-reminder');
      element.removeAttribute('data-simnet-wb-reminder-label');
    }
  }

  function refreshFamiliarReminders() {
    // v1.7.29.28: learned-target outlines are intentionally disabled. Repeated
    // guidance is available only through LIVE history replay, never as ambient
    // glowing controls during normal operator navigation.
    clearStaleFamiliarReminders(new Set());
  }

  function scheduleFamiliarReminderRefresh() {
    if (reminderRefreshQueued) return;
    reminderRefreshQueued = true;
    const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    schedule(() => {
      reminderRefreshQueued = false;
      refreshFamiliarReminders();
    });
  }

  function latestPassiveDiscovery(caseData) {
    const currentPageKind = pageInfo().pageKind;
    return (caseData?.locator?.evidence || []).find(item => (
      item?.passive
      && item.pageKind === currentPageKind
      && ['TMC_RESULT', 'CUSTOMER_MACS', 'MAC_SEARCH_RESULT', 'INTERFACE_CONFIRMATION', 'DEVICE_DETAILS'].includes(item.type)
    )) || null;
  }

  function highlightPassiveDiscovery(caseData = WB.store.activeCase?.() || null) {
    const discovery = latestPassiveDiscovery(caseData);
    if (!discovery) return { ok: false, reason: 'no-passive-discovery' };
    let target = null;
    if (discovery.type === 'TMC_RESULT') target = traceVisualElement(findTmcBlock(caseData));
    if (discovery.type === 'CUSTOMER_MACS') target = traceVisualElement(rowHighlightTarget(findCustomerMacSearchLink(caseData)));
    if (discovery.type === 'MAC_SEARCH_RESULT' || discovery.type === 'INTERFACE_CONFIRMATION') target = traceVisualElement(candidateResultTarget(caseData));
    if (discovery.type === 'DEVICE_DETAILS') target = traceVisualElement(findCandidateDeviceLink(caseData));
    if (!(target instanceof Element)) return { ok: false, reason: 'passive-target-not-found' };
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    target.setAttribute('data-simnet-wb-reminder', 'passive-discovery');
    window.setTimeout(() => scheduleFamiliarReminderRefresh(), 1800);
    return { ok: true, discovery };
  }


  function clearTmcValueMarks(root = document) {
    for (const mark of root.querySelectorAll?.('[data-simnet-wb-tmc-value]') || []) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize?.();
    }
  }

  function ensureTmcValueStyle() {
    if (document.getElementById('simnet-wb-tmc-value-style')) return;
    const style = document.createElement('style');
    style.id = 'simnet-wb-tmc-value-style';
    style.textContent = `
      [data-simnet-wb-tmc-value],
      [data-simnet-wb-tmc-value="olt"],
      [data-simnet-wb-tmc-value="serial"],
      [data-simnet-wb-tmc-value="mac"]{
        position:relative!important;
        display:inline-block!important;
        box-sizing:border-box!important;
        min-width:var(--simnet-wb-tmc-mark-width,auto)!important;
        margin:1px 0!important;
        padding:2px 7px!important;
        background:rgba(165,0,70,.075)!important;
        outline:2px solid rgba(165,0,70,.34)!important;
        outline-offset:1px!important;
        border-radius:5px!important;
        box-shadow:0 0 0 2px rgba(165,0,70,.055)!important;
        color:inherit!important;
        line-height:1.2!important;
        transition:outline-color .14s ease,background-color .14s ease,box-shadow .14s ease;
      }
      html.simnet-wb-guide-active [data-simnet-wb-tmc-value]{
        z-index:2147483645!important;
        background:#FFEAF2!important;
        outline:2px solid rgba(165,0,70,.88)!important;
        box-shadow:0 0 0 4px rgba(165,0,70,.13)!important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Point-highlight Serial / MAC / OLT / IP text inside the matched TMC row.
   * Workbench-owned spans only; no MutationObserver; cleaned on case/page change.
   */
  function highlightTmcValues(caseData, root) {
    if (!(root instanceof Element)) return 0;
    ensureTmcValueStyle();
    clearTmcValueMarks(root);

    const serial = normalizeSerial(valueOf(caseData?.pon?.tmcOnuSerial) || valueOf(caseData?.pon?.onuSerial) || '');
    const mac = normalizeMac(valueOf(caseData?.pon?.tmcOnuMac) || valueOf(caseData?.pon?.onuMac) || '');
    const oltIp = String(valueOf(caseData?.pon?.tmcOltIp) || '').trim();
    const oltName = String(valueOf(caseData?.pon?.tmcOltName) || '').trim();
    if (!serial && !mac && !oltIp && !oltName) return 0;

    const targets = [];
    if (serial) targets.push({ kind: 'serial', match: (text) => normalizeSerial(text) === serial || normalizeSerial(text).includes(serial) });
    if (mac) targets.push({ kind: 'mac', match: (text) => normalizeMac(text) === mac || normalizeMac(text).includes(mac) });
    if (oltIp) targets.push({ kind: 'olt', match: (text) => String(text).includes(oltIp) });
    if (oltName && oltName.length >= 4) {
      const needle = oltName.toLowerCase();
      targets.push({
        kind: 'olt',
        match: (text) => {
          const n = String(text).toLowerCase();
          return n.includes(needle) || needle.includes(n.trim());
        }
      });
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest?.('[data-simnet-wb-tmc-value],[data-simnet-wb-owned]')) continue;
      const raw = String(node.nodeValue || '');
      if (!raw.trim()) continue;
      for (const item of targets) {
        if (!item.match(raw)) continue;
        hits.push({ node, kind: item.kind });
        break;
      }
    }

    let marked = 0;
    const marks = [];
    for (const hit of hits) {
      try {
        const span = document.createElement('span');
        span.dataset.simnetWbTmcValue = hit.kind;
        span.dataset.simnetWbOwned = '1';
        const parent = hit.node.parentNode;
        if (!parent) continue;
        parent.insertBefore(span, hit.node);
        span.appendChild(hit.node);
        marks.push(span);
        marked += 1;
      } catch {
        // Ignore nodes that disappear mid-walk.
      }
    }

    // Keep the point highlights visually aligned: all marked values in the
    // same TMC block use the width of the longest marked line. This preserves
    // the native table layout while making the evidence read as one clean set.
    if (marks.length > 1) {
      const widest = Math.ceil(Math.max(...marks.map(mark => mark.getBoundingClientRect?.().width || 0)));
      if (widest > 0) {
        for (const mark of marks) {
          mark.style.setProperty('--simnet-wb-tmc-mark-width', `${widest}px`);
        }
      }
    }
    return marked;
  }

  function expectedTmcValueKinds(caseData) {
    const kinds = new Set();
    const serial = normalizeSerial(valueOf(caseData?.pon?.tmcOnuSerial) || valueOf(caseData?.pon?.onuSerial) || '');
    const mac = normalizeMac(valueOf(caseData?.pon?.tmcOnuMac) || valueOf(caseData?.pon?.onuMac) || '');
    const oltIp = String(valueOf(caseData?.pon?.tmcOltIp) || '').trim();
    const oltName = String(valueOf(caseData?.pon?.tmcOltName) || '').trim();
    if (serial) kinds.add('serial');
    if (mac) kinds.add('mac');
    if (oltIp || oltName) kinds.add('olt');
    return [...kinds];
  }

  function tmcValueMarkSummary(root) {
    if (!(root instanceof Element)) return { count: 0, kinds: [], visibleCount: 0, viewportCount: 0, viewportKinds: [] };
    const marks = [...root.querySelectorAll?.('[data-simnet-wb-tmc-value]') || []];
    const visible = marks.filter(mark => isRenderedTmcElement(mark));
    const viewport = visible.filter(mark => tmcElementInViewport(mark));
    return {
      count: marks.length,
      visibleCount: visible.length,
      kinds: [...new Set(visible.map(mark => String(mark.dataset?.simnetWbTmcValue || '')).filter(Boolean))],
      viewportCount: viewport.length,
      viewportKinds: [...new Set(viewport.map(mark => String(mark.dataset?.simnetWbTmcValue || '')).filter(Boolean))]
    };
  }

  function tmcTeleportVisualConfirmation(caseData, root) {
    const expectedKinds = expectedTmcValueKinds(caseData);
    const summary = tmcValueMarkSummary(root);
    const confirmed = Boolean(
      tmcElementInViewport(root)
      && expectedKinds.length > 0
      && summary.viewportCount > 0
      && expectedKinds.every(kind => summary.viewportKinds.includes(kind))
    );
    return { confirmed, expectedKinds, ...summary };
  }

  async function recordTmcTeleportShown(caseData, actionSession, visual = {}) {
    if (!caseData?.id || !actionSession || actionSession.replayOnly) return false;
    if (String(actionSession.semanticTargetId || '') !== 'userside.tmc') return false;
    if (!visual?.confirmed) {
      void WB.observability?.report?.({
        severity: 'ERROR',
        code: 'TMC_TELEPORT_VISUAL_NOT_CONFIRMED',
        operationType: actionSession.operationType || 'GUIDE_NAVIGATION',
        operationId: actionSession.operationId || '',
        source: 'guide',
        stage: 'SHOWN',
        message: 'TMC target reached, but required native TMC values were not visibly highlighted; milestone not recorded',
        details: {
          caseId: caseData.id || '',
          expectedKinds: visual.expectedKinds || [],
          markedKinds: visual.kinds || [],
          visibleCount: Number(visual.visibleCount || 0),
          viewportKinds: visual.viewportKinds || [],
          viewportCount: Number(visual.viewportCount || 0)
        }
      });
      return false;
    }
    const at = new Date().toISOString();
    // Make the local Case immediately obey the invariant; durable persistence
    // follows through the normal workflow patch channel.
    caseData.workflow ||= {};
    caseData.workflow.ponAcquisition ||= {};
    caseData.workflow.ponAcquisition.tmcShownAt = at;
    caseData.workflow.ponAcquisition.tmcShownOperationId = String(actionSession.operationId || '');
    caseData.workflow.ponAcquisition.tmcShownFields = [...(visual.kinds || [])];
    await WB.store.patchWorkflow?.('ponAcquisition', {
      tmcShownAt: at,
      tmcShownOperationId: String(actionSession.operationId || ''),
      tmcShownFields: [...(visual.kinds || [])]
    });
    WB.operatorTrace?.recordSystemEvent?.('TMC_TELEPORT_CONFIRMED', {
      operationId: actionSession.operationId || '',
      semanticTargetId: 'userside.tmc',
      markedKinds: visual.kinds || [],
      visibleCount: Number(visual.visibleCount || 0),
      viewportKinds: visual.viewportKinds || [],
      viewportCount: Number(visual.viewportCount || 0)
    });
    return true;
  }

  function highlightTmcBlockDirect(caseData = WB.store.activeCase?.() || null) {
    clearTmcValueMarks(document);
    const page = pageInfo();
    if (page.pageKind !== 'userside_customer') {
      return { ok: false, reason: 'not-userside-customer' };
    }
    const target = traceVisualElement(
      tmcHighlightTarget(caseData)
      || findTmcBlock(caseData)
    );
    if (!(target instanceof Element) || !target.isConnected) {
      return { ok: false, reason: 'tmc-target-not-found' };
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    target.setAttribute('data-simnet-wb-reminder', 'tmc-review');
    const valuesMarked = highlightTmcValues(caseData, target);
    window.setTimeout(() => scheduleFamiliarReminderRefresh(), 1800);
    return { ok: true, targetKind: 'tmc', target, valuesMarked };
  }

  function ensureTraceStyle() {
    if (document.getElementById(TRACE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = TRACE_STYLE_ID;
    style.textContent = `
      [data-simnet-wb-trace] {
        position: relative !important;
        outline: 1px solid rgba(63,110,88,.26) !important;
        outline-offset: 1px;
        box-shadow: inset 2px 0 0 rgba(63,110,88,.34) !important;
        background-image: linear-gradient(90deg,rgba(63,110,88,.025),transparent 46%) !important;
      }
      [data-simnet-wb-trace]:hover {
        outline-color: rgba(63,110,88,.42) !important;
        box-shadow: inset 2px 0 0 rgba(63,110,88,.50) !important;
        background-image: linear-gradient(90deg,rgba(63,110,88,.045),transparent 52%) !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function traceVisualElement(target) {
    const element = target instanceof Element ? target : target?.element;
    if (!(element instanceof Element)) return null;
    return element.closest?.('.table_block,tr,.item') || element;
  }

  function setEvidenceTrace(element, label, title, activeElements) {
    if (!(element instanceof Element)) return;
    activeElements.add(element);
    const values = {
      'data-simnet-wb-trace': '1',
      'data-simnet-wb-trace-label': String(label || '').slice(0, 120),
      'data-simnet-wb-trace-title': String(title || label || '').slice(0, 420)
    };
    element.removeAttribute('data-simnet-wb-trace-status');
    element.removeAttribute('data-simnet-wb-reminder');
    element.removeAttribute('data-simnet-wb-reminder-label');
    for (const [name, value] of Object.entries(values)) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
  }

  function clearStaleEvidenceTraces(activeElements) {
    for (const element of document.querySelectorAll('[data-simnet-wb-trace]')) {
      if (activeElements.has(element)) continue;
      element.removeAttribute('data-simnet-wb-trace');
      element.removeAttribute('data-simnet-wb-trace-status');
      element.removeAttribute('data-simnet-wb-trace-label');
      element.removeAttribute('data-simnet-wb-trace-title');
    }
  }

  function diagnosticPathFinished(caseData) {
    // Trail is route memory, not a data-completeness indicator. It becomes visible
    // only after an explicit terminal latch. A 99/100-like progress score, cached
    // evidence or a transient page state can never activate it.
    return Boolean(caseData?.locator?.termination?.status);
  }

  function completedTechnicalTrailFields(completed = {}) {
    const fields = new Set();
    for (const [stepId, record] of Object.entries(completed || {})) {
      const details = record?.details || {};
      if (stepId.startsWith('billing.inspect-technical:')) {
        for (const item of Array.isArray(details.fields) ? details.fields : []) {
          const field = typeof item === 'string' ? item : item?.field;
          if (field) fields.add(field);
        }
      }
      if (
        stepId === 'billing.fill-olt'
        || stepId === 'billing.save-olt'
        || stepId.startsWith('billing.fill-technical:')
        || stepId === 'billing.save-technical-fields'
      ) {
        for (const item of Array.isArray(details.fields) ? details.fields : []) {
          const field = typeof item === 'string' ? item : item?.field;
          if (field) fields.add(field);
        }
      }
    }
    return fields;
  }

  function completedStepStartsWith(completed, prefix) {
    return Object.keys(completed || {}).some(stepId => stepId.startsWith(prefix));
  }

  function refreshEvidenceTrail() {
    // v1.7.29.28: completed evidence belongs in LIVE/Graph history. Native CRM
    // controls stay visually untouched until the operator explicitly replays a
    // completed milestone from LIVE.
    clearStaleEvidenceTraces(new Set());
  }

  function scheduleEvidenceTrailRefresh() {
    if (traceRefreshQueued) return;
    traceRefreshQueued = true;
    const schedule = window.requestAnimationFrame
      || (callback => window.setTimeout(callback, 0));
    schedule(() => {
      traceRefreshQueued = false;
      refreshEvidenceTrail();
    });
  }

  const overlay = new GuideOverlay();
  let focusShowInFlight = false;
  let actionContinuationInFlight = false;
  let actionContinuationQueued = false;
  const TARGET_RETRY_DELAYS_MS = Object.freeze([120, 220, 360, 560, 850, 1250, 1800, 2400]);
  const targetRetryState = new Map();
  const targetMutationWatchState = new Map();

  function clearSemanticTargetMutationWatch(operationId = '') {
    const key = String(operationId || '');
    if (!key) return;
    const entry = targetMutationWatchState.get(key);
    try { entry?.observer?.disconnect?.(); } catch {}
    if (entry?.timer) clearTimeout(entry.timer);
    targetMutationWatchState.delete(key);
  }

  function armSemanticTargetMutationWatch(session) {
    if (!session?.operationId || session.semanticTargetId !== 'userside.tmc' || typeof MutationObserver === 'undefined') return false;
    const operationId = String(session.operationId);
    if (targetMutationWatchState.has(operationId)) return false;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const current = WB.actionLifecycle?.current?.() || null;
        const caseData = WB.store.activeCase?.() || null;
        if (
          !current
          || String(current.operationId || '') !== operationId
          || WB.actionLifecycle?.isTerminal?.(current)
          || current.status === 'SHOWN'
          || !caseData?.id
          || String(caseData.id) !== String(current.caseId || '')
        ) {
          clearSemanticTargetMutationWatch(operationId);
          return;
        }
        const resolved = WB.actionLifecycle?.resolve?.(current, caseData) || null;
        if (!resolved?.found) return;
        clearSemanticTargetMutationWatch(operationId);
        void continueActiveActionSession(caseData);
      });
    });
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class']
      });
    } catch {
      return false;
    }
    const timeoutMs = Math.max(1000, Math.min(20000, Number(session.targetTimeoutMs || 12000)));
    const timer = setTimeout(() => clearSemanticTargetMutationWatch(operationId), timeoutMs);
    targetMutationWatchState.set(operationId, { observer, timer });
    return true;
  }

  function clearSemanticTargetRetry(operationId = '') {
    const key = String(operationId || '');
    if (!key) return;
    const entry = targetRetryState.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    targetRetryState.delete(key);
    clearSemanticTargetMutationWatch(key);
  }

  function scheduleSemanticTargetRetry(session) {
    if (!session?.operationId || WB.actionLifecycle?.isTerminal?.(session) || session.status === 'SHOWN') return false;
    const semanticTargetId = String(session.semanticTargetId || '');
    const retryableReplayTarget = Boolean(
      (session.intent === 'DIRECT_REPLAY' || session.replayOnly)
      && ['billing.technical', 'userside.tmc', 'billing.poll.entry', 'billing.juniper'].includes(semanticTargetId)
    );
    if (!['userside.tmc', 'billing.olt.request'].includes(semanticTargetId) && !retryableReplayTarget) return false;
    if (semanticTargetId === 'userside.tmc') armSemanticTargetMutationWatch(session);
    const operationId = String(session.operationId);
    const existing = targetRetryState.get(operationId) || { attempt: 0, timer: null };
    if (existing.timer) return false;
    if (existing.attempt >= TARGET_RETRY_DELAYS_MS.length) {
      // A History Replay is an explicit operator command. Do not leave it in a
      // silent WAITING_TARGET state forever if the CRM page opened but the real
      // native block never materialised. Close the bounded retry loop with a
      // diagnostic ActionSession timeout so Recorder/Errors can explain it.
      if (retryableReplayTarget) {
        clearSemanticTargetRetry(operationId);
        WB.actionLifecycle?.timeout?.(session, 'replay-target-timeout', {
          code: 'ACTION_REPLAY_TARGET_TIMEOUT',
          message: `Страница открылась, но native target ${semanticTargetId} не найден после ограниченного ожидания`,
          actualResult: semanticTargetId
        });
      }
      return false;
    }
    const delay = TARGET_RETRY_DELAYS_MS[existing.attempt];
    existing.timer = setTimeout(() => {
      existing.timer = null;
      existing.attempt += 1;
      targetRetryState.set(operationId, existing);
      const current = WB.actionLifecycle?.current?.() || null;
      const caseData = WB.store.activeCase?.() || null;
      if (
        !current
        || String(current.operationId || '') !== operationId
        || WB.actionLifecycle?.isTerminal?.(current)
        || current.status === 'SHOWN'
        || !caseData?.id
        || String(caseData.id) !== String(current.caseId || '')
      ) {
        clearSemanticTargetRetry(operationId);
        return;
      }
      void continueActiveActionSession(caseData).finally(() => {
        const latest = WB.actionLifecycle?.current?.() || null;
        if (
          latest
          && String(latest.operationId || '') === operationId
          && !WB.actionLifecycle?.isTerminal?.(latest)
          && latest.status !== 'SHOWN'
        ) {
          scheduleSemanticTargetRetry(latest);
        } else {
          clearSemanticTargetRetry(operationId);
        }
      });
    }, delay);
    targetRetryState.set(operationId, existing);
    return true;
  }

  async function highlight(caseData) {
    const currentPlan = plan(caseData);
    const actionSession = ensureActionSession(currentPlan, caseData, { operationType: 'GUIDE_HIGHLIGHT', sourceAction: 'guide-cta' });

    // Do not wait for the entire legacy CRM to become globally quiet before
    // responding to a Guide click. The concrete target is stabilised below by
    // GuideOverlay.waitForStableTarget(). Global clocks/traffic widgets must not
    // turn the first click into an 800 ms no-op.
    if (document.readyState === 'loading') {
      const uiReady = WB.interactionGuards?.waitForUiReady
        ? await WB.interactionGuards.waitForUiReady({ timeoutMs: 220, quietMs: 35 })
        : false;
      if (!uiReady && document.readyState === 'loading') {
        return { ok: false, reason: 'page-not-ready', plan: currentPlan };
      }
    }

    WB.log?.info?.('GUIDE', 'Запрошена подсказка', {
      stepId: currentPlan?.id || '',
      title: currentPlan?.title || '',
      kind: currentPlan?.kind || 'none'
    });


    if (
      currentPlan.kind !== 'highlight'
      || typeof currentPlan.resolver !== 'function'
    ) {
      WB.log?.warn?.('GUIDE', 'Подсказка сейчас недоступна', {
        stepId: currentPlan?.id || '',
        reason: 'not-highlightable'
      });
      return {
        ok: false,
        reason: 'not-highlightable',
        plan: currentPlan
      };
    }

    let target = null;
    try {
      target = currentPlan.resolver();
    } catch (error) {
      WB.log?.warn?.('GUIDE', 'Ошибка поиска целевого DOM-узла', {
        stepId: currentPlan?.id || '',
        reason: 'target-resolve-failed'
      });
      void WB.observability?.report?.({
        severity: 'ERROR',
        code: 'GUIDE_TARGET_RESOLVE_FAILED',
        operationType: 'GUIDE_HIGHLIGHT',
        source: 'guide',
        stage: currentPlan?.id || 'resolve',
        message: error?.message || 'Не удалось вычислить целевой DOM-узел Guide',
        error,
        details: { stepId: currentPlan?.id || '' }
      });
      if (actionSession) WB.actionLifecycle?.fail?.(actionSession, 'target-resolve-failed', { code: 'ACTION_TARGET_RESOLVE_FAILED', message: error?.message || 'Guide target resolver failed' });
      return {
        ok: false,
        reason: 'target-resolve-failed',
        plan: currentPlan
      };
    }
    const targetElement = target instanceof Element
      ? target
      : target?.element || null;

    if (actionSession) {
      const page = pageInfo();
      if (WB.actionLifecycle?.destinationMatches?.(actionSession, page)) {
        if (['REQUESTED','NAVIGATING'].includes(actionSession.status)) WB.actionLifecycle.destinationReached(actionSession, { actualResult: page.pageKind || '' });
        if (actionSession.status === 'DESTINATION_REACHED') WB.actionLifecycle.waitingTarget(actionSession);
      }
      if (targetElement?.isConnected && ['REQUESTED','NAVIGATING','DESTINATION_REACHED','WAITING_TARGET'].includes(actionSession.status)) {
        WB.actionLifecycle.targetReady(actionSession, { actualResult: actionSession.semanticTargetId });
      }
    }
    if (focusShowInFlight) return { ok: false, reason: 'focus-show-busy', plan: currentPlan };
    focusShowInFlight = true;
    let result = null;
    try {
      result = await overlay.show(
        target,
        currentPlan,
        caseData
      );
    } finally {
      focusShowInFlight = false;
    }

    if (result?.ok) {
      WB.log?.info?.('GUIDE', 'Подсказка показана', {
        stepId: currentPlan?.id || '',
        target: targetElement?.tagName || ''
      });
    } else {
      WB.log?.warn?.('GUIDE', 'Подсказка не показана', {
        stepId: currentPlan?.id || '',
        reason: result?.reason || 'unknown'
      });
      if (actionSession && ['target-not-found','target-detached','target-not-stable','page-not-ready'].includes(result?.reason || '')) {
        if (['REQUESTED','NAVIGATING','DESTINATION_REACHED'].includes(actionSession.status)) WB.actionLifecycle?.waitingTarget?.(actionSession, { actualResult: result?.reason || '' });
      } else if (actionSession && !WB.actionLifecycle?.isTerminal?.(actionSession)) {
        WB.actionLifecycle?.fail?.(actionSession, result?.reason || 'highlight-not-shown', { code: 'ACTION_FOCUS_NOT_SHOWN', message: 'Запрошенный Focus не был показан' });
      }
      void WB.observability?.report?.({
        severity: 'WARNING',
        code: 'GUIDE_HIGHLIGHT_NOT_SHOWN',
        operationType: 'GUIDE_HIGHLIGHT',
        source: 'guide',
        stage: currentPlan?.id || 'show',
        message: 'Запрошенная подсказка Guide не была показана',
        reason: result?.reason || 'unknown',
        details: { stepId: currentPlan?.id || '' }
      });
    }

    return {
      ...result,
      plan: currentPlan
    };
  }

  let replayOrientationTimer = null;
  let replayOrientationTarget = null;
  let replayOrientationNode = null;

  function ensureReplayOrientationStyle() {
    if (document.getElementById('simnet-wb-replay-orientation-style')) return;
    const style = document.createElement('style');
    style.id = 'simnet-wb-replay-orientation-style';
    style.setAttribute('data-simnet-wb-owned', '1');
    style.textContent = `
      #simnet-wb-replay-orientation-rect {
        position: fixed !important;
        z-index: 2147483645 !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
        border: 3px solid #A50046 !important;
        box-shadow: 0 0 0 4px rgba(165,0,70,.12) !important;
        border-radius: 5px !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearReplayOrientation() {
    if (replayOrientationTimer) clearTimeout(replayOrientationTimer);
    replayOrientationTimer = null;
    replayOrientationNode?.remove?.();
    replayOrientationNode = null;
    replayOrientationTarget = null;
  }

  function showReplayOrientation(target, session = null) {
    const element = target instanceof Element ? target : target?.element || null;
    if (!element?.isConnected) return false;
    clearReplayOrientation();
    ensureReplayOrientationStyle();

    let rect = null;
    try {
      rect = typeof target?.getRect === 'function'
        ? target.getRect()
        : element.getBoundingClientRect();
    } catch {}
    if (!rect || rect.width < 2 || rect.height < 2) return false;

    replayOrientationTarget = target;
    const node = document.createElement('div');
    node.id = 'simnet-wb-replay-orientation-rect';
    node.setAttribute('data-simnet-wb-owned', '1');
    node.style.left = `${Math.max(2, rect.left - 5)}px`;
    node.style.top = `${Math.max(2, rect.top - 5)}px`;
    node.style.width = `${Math.max(2, rect.width + 10)}px`;
    node.style.height = `${Math.max(2, rect.height + 10)}px`;
    document.documentElement.appendChild(node);
    replayOrientationNode = node;

    try { element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch {}
    // Recompute once after scroll without creating a reposition loop.
    try {
      const next = typeof target?.getRect === 'function' ? target.getRect() : element.getBoundingClientRect();
      if (next?.width >= 2 && next?.height >= 2) {
        node.style.left = `${Math.max(2, next.left - 5)}px`;
        node.style.top = `${Math.max(2, next.top - 5)}px`;
        node.style.width = `${Math.max(2, next.width + 10)}px`;
        node.style.height = `${Math.max(2, next.height + 10)}px`;
      }
    } catch {}

    WB.operatorTrace?.recordSystemEvent?.('REPLAY_ORIENTATION_SHOW', {
      operationId: session?.operationId || '',
      semanticTargetId: session?.semanticTargetId || ''
    });
    replayOrientationTimer = setTimeout(() => {
      const stillConnected = Boolean(element?.isConnected);
      clearReplayOrientation();
      WB.operatorTrace?.recordSystemEvent?.('REPLAY_ORIENTATION_HIDE', {
        operationId: session?.operationId || '',
        semanticTargetId: session?.semanticTargetId || '',
        targetStillConnected: stillConnected
      });
    }, 1800);
    return true;
  }

  async function replayMilestone(key, caseData = WB.store.activeCase?.() || null) {
    if (!caseData) return { ok: false, reason: 'case-missing' };
    const page = pageInfo();
    const id = String(key || '');
    let target = null;
    let targetPageKind = '';
    if (id === 'technical') {
      targetPageKind = 'billing_technical';
      if (page.pageKind !== targetPageKind) return { ok: false, reason: 'replay-navigation-required', targetPageKind };
      target = technicalInspectionTarget(caseData) || technicalRows()[0]?.row || document.querySelector('form');
    } else if (id === 'tmc') {
      targetPageKind = 'userside_customer';
      if (page.pageKind !== targetPageKind) return { ok: false, reason: 'replay-navigation-required', targetPageKind };
      target = tmcHighlightTarget(caseData) || findTmcBlock(caseData);
    } else if (id === 'poll') {
      targetPageKind = page.pageKind === 'billing_onu_poll' ? 'billing_onu_poll' : 'billing_user';
      if (!['billing_onu_poll','billing_user'].includes(page.pageKind)) return { ok: false, reason: 'replay-navigation-required', targetPageKind: 'billing_user' };
      target = page.pageKind === 'billing_onu_poll'
        ? (askOltHighlightTarget(caseData) || pollRows(caseData)[0]?.row || null)
        : findPollTab(caseData);
    } else if (id === 'juniper') {
      targetPageKind = 'billing_juniper';
      if (page.pageKind !== targetPageKind) return { ok: false, reason: 'replay-navigation-required', targetPageKind };
      target = findJuniperStatusTarget();
    } else {
      return { ok: false, reason: 'unknown-milestone' };
    }
    if (!target) return { ok: false, reason: 'replay-target-not-found', targetPageKind };
    showReplayOrientation(target, WB.actionLifecycle?.current?.() || null);
    return { ok: true, replay: true, milestone: id, targetPageKind, orientationOnly: true };
  }

  async function navigate(caseData) {
    const currentPlan = plan(caseData);
    const target = (
      currentPlan.kind === 'highlight'
      && typeof currentPlan.resolver === 'function'
    )
      ? currentPlan.resolver()
      : null;
    const targetElement = target instanceof Element
      ? target
      : target?.element || null;

    return executePlanNavigation(
      currentPlan,
      caseData,
      targetElement
    );
  }

  async function runNext(caseData) {
    const currentPlan = plan(caseData);


    // A combined plan such as the UserSide TMC result may also expose
    // focusSource. The compact quick button is a hint trigger first, so
    // highlighting the current-page target has priority over navigation.
    if (currentPlan.kind === 'highlight') {
      return highlight(caseData);
    }

    if (
      currentPlan.kind === 'navigate'
      || currentPlan.kind === 'focus-source'
      || currentPlan.focusSource
    ) {
      return navigate(caseData);
    }

    return {
      ok: false,
      reason: 'no-active-guide-action',
      plan: currentPlan
    };
  }


  function keepLatchedOverlayOrClear(reason = 'state-update') {
    if (!overlay.active || !overlay.currentPlan?.id) return;
    const caseData = WB.store.activeCase?.() || null;
    const activeCaseId = String(caseData?.id || '');
    if (overlay.caseId && activeCaseId && overlay.caseId !== activeCaseId) {
      overlay.clear('CASE_CHANGED');
      return;
    }

    // A terminal ActionSession owns Focus teardown even if the old Guide hint is
    // still persisted as route/presentation memory. Otherwise the four shade
    // elements (pointer-events:auto) can remain over the CRM and make native
    // controls look completely dead after a cross-tab terminal transition.
    const overlayOperationId = String(overlay.actionSession?.operationId || '');
    const lifecycleStore = caseData?.workflow?.actionSession || {};
    const lastTerminal = lifecycleStore.lastTerminal || null;
    if (
      overlayOperationId
      && String(lastTerminal?.operationId || '') === overlayOperationId
      && WB.actionLifecycle?.isTerminal?.(lastTerminal)
    ) {
      overlay.clear('ACTION_SESSION_TERMINAL');
      return;
    }
    if (!overlay.targetElement?.isConnected) {
      overlay.tryRebindTarget();
      return;
    }
    if (hasExpectedTerminalResult(caseData) && overlay.currentPlan?.id === 'billing.ask-olt') {
      overlay.clear('TERMINAL_RESULT');
      return;
    }
    // Routine scans/store/context updates must not take attention away from the
    // operator. The focus stays latched until a meaningful dismiss/action event.
    overlay.caseData = caseData;
    overlay.update();
  }

  function completeActivePollActionFromEvidence(caseData = WB.store.activeCase?.() || null) {
    const session = WB.actionLifecycle?.current?.() || null;
    if (!session || WB.actionLifecycle?.isTerminal?.(session)) return false;
    if (session.semanticTargetId !== 'billing.olt.request') return false;
    if (String(session.caseId || '') !== String(caseData?.id || '')) return false;
    if (!hasExpectedTerminalResult(caseData)) return false;
    WB.actionLifecycle?.complete?.(session, 'TERMINAL_RESULT', 'validated-olt-terminal-result');
    return true;
  }

  WB.bus.on('context:changed', () => {
    scheduleEvidenceTrailRefresh();
    scheduleFamiliarReminderRefresh();
    keepLatchedOverlayOrClear('context:changed');
    queueMicrotask(() => { void continueActiveActionSession(); });
  });

  WB.bus.on('terminal:result-view', () => {
    const caseData = WB.store.activeCase?.() || null;
    const completed = completeActivePollActionFromEvidence(caseData);
    if (hasExpectedTerminalResult(caseData) && overlay.currentPlan?.id === 'billing.ask-olt') {
      overlay.clear(completed ? 'TARGET_ACTIVATED_PENDING_RESULT' : 'TERMINAL_RESULT');
    }
  });

  WB.bus.on('poll:attempt-resolved', payload => {
    const session = WB.actionLifecycle?.current?.() || null;
    if (!session || WB.actionLifecycle?.isTerminal?.(session) || session.semanticTargetId !== 'billing.olt.request') return;
    if (String(payload?.caseId || '') && String(payload.caseId) !== String(session.caseId || '')) return;
    const outcome = String(payload?.outcome || '').toLowerCase();
    if (outcome === 'timeout') {
      WB.actionLifecycle?.timeout?.(session, 'poll-attempt-timeout', { code: 'ACTION_TARGET_TIMEOUT', actualResult: outcome });
    } else if (outcome && outcome !== 'confirmed') {
      WB.actionLifecycle?.fail?.(session, 'poll-attempt-failed', { code: 'ACTION_FAILED', actualResult: outcome });
    } else if (outcome === 'confirmed') {
      completeActivePollActionFromEvidence(WB.store.activeCase?.() || null);
    }
  });

  WB.bus.on('store:state', () => {
    scheduleEvidenceTrailRefresh();
    scheduleFamiliarReminderRefresh();
    keepLatchedOverlayOrClear('store:state');
    queueMicrotask(() => { void continueActiveActionSession(); });
  });

  function genericPlanForSession(session, caseData) {
    return {
      id: session?.planId || `action.${session?.semanticTargetId || 'target'}`,
      title: session?.title || 'Подсказка',
      text: session?.text || 'Нажмите на выделенный элемент.',
      kind: 'highlight',
      replayOnly: Boolean(session?.replayOnly),
      stickyEvidence: true,
      semanticTargetId: session?.semanticTargetId || '',
      resolver: () => WB.actionLifecycle?.resolve?.(session, caseData)?.raw || null
    };
  }

  async function resumeTmcHandoff(caseData = WB.store.activeCase?.() || null, options = {}) {
    if (!caseData?.id || !WB.actionLifecycle) return { ok: false, reason: 'action-lifecycle-unavailable' };
    const page = pageInfo();
    const expectedCustomerId = String(valueOf(caseData?.identity?.customerId) || '');
    if (page.pageKind !== 'userside_customer' || page.system !== 'userside') {
      return { ok: false, reason: 'tmc-destination-not-active' };
    }
    if (expectedCustomerId && String(page.entityId || '') && String(page.entityId) !== expectedCustomerId) {
      return { ok: false, reason: 'destination-case-mismatch' };
    }

    let current = WB.actionLifecycle.current?.() || null;
    if (
      current
      && !WB.actionLifecycle.isTerminal?.(current)
      && String(current.caseId || '') === String(caseData.id)
      && String(current.semanticTargetId || '') === 'userside.tmc'
    ) {
      return continueActiveActionSession(caseData);
    }

    // Explicit Billing -> UserSide TMC handoff is an operator command. A stale
    // unrelated Guide lock must not turn it into a bare page jump. Supersede
    // only same-Case non-poll actions; a live OLT request remains protected.
    if (current && !WB.actionLifecycle.isTerminal?.(current) && String(current.caseId || '') === String(caseData.id)) {
      if (String(current.semanticTargetId || '') === 'billing.olt.request') {
        return { ok: false, reason: 'poll-action-active' };
      }
      WB.actionLifecycle.interrupt?.(current, 'ACTION_SUPERSEDED_BY_OPERATOR', { actualResult: 'userside.tmc' });
    }

    const syntheticPlan = {
      id: tmcReviewStepId(caseData),
      title: 'ТМЦ',
      text: 'Проверить данные ТМЦ текущего абонента.',
      kind: 'highlight',
      semanticTargetId: 'userside.tmc',
      stickyEvidence: true,
      resolver: () => tmcHighlightTarget(caseData) || findTmcBlock(caseData)
    };
    const session = ensureActionSession(syntheticPlan, caseData, {
      operationType: 'GUIDE_NAVIGATION',
      sourceAction: String(options.sourceAction || 'userside-tmc-handoff'),
      targetTimeoutMs: 12000
    });
    if (!session) return { ok: false, reason: 'action-session-unavailable' };
    if (['REQUESTED','NAVIGATING'].includes(session.status)) {
      WB.actionLifecycle.destinationReached?.(session, { actualResult: page.pageKind || 'userside_customer' });
    }
    return continueActiveActionSession(caseData);
  }

  async function continueActiveActionSession(caseData = WB.store.activeCase?.() || null) {
    if (!WB.actionLifecycle || !caseData?.id) return { ok: false, reason: 'action-lifecycle-unavailable' };
    if (actionContinuationInFlight || focusShowInFlight) {
      // Do not drop the only destination/context event just because another
      // continuation is finishing. Coalesce it into one trailing pass instead.
      actionContinuationQueued = true;
      return { ok: false, reason: 'action-continuation-busy', queued: true };
    }
    actionContinuationInFlight = true;
    try {
    const session = WB.actionLifecycle.syncFromCase?.(caseData) || WB.actionLifecycle.current?.();
    if (!session || WB.actionLifecycle.isTerminal?.(session) || String(session.caseId || '') !== String(caseData.id)) return { ok: false, reason: 'no-active-action' };
    if (session.status === 'SHOWN') {
      if (!overlay.targetElement?.isConnected) overlay.tryRebindTarget();
      return { ok: true, alreadyShown: true, session };
    }
    const page = pageInfo();
    if (!WB.actionLifecycle.destinationMatches?.(session, page)) {
      const expectedEntity = String(session.destinationEntityId || '');
      const actualEntity = String(page.entityId || '');
      const sameDestinationSystem = Boolean(session.destinationSystem && page.system === session.destinationSystem);
      const stillOnSource = Boolean(page.system === session.sourceSystem && page.pageKind === session.sourcePageKind);
      if (sameDestinationSystem && expectedEntity && actualEntity && expectedEntity !== actualEntity) {
        WB.actionLifecycle.fail(session, 'destination-case-mismatch', {
          code: 'ACTION_DESTINATION_CASE_MISMATCH',
          message: 'Открыт destination другого Case — шаг не засчитан',
          actualResult: `${page.pageKind || 'unknown'}:${actualEntity}`
        });
        return { ok: false, reason: 'destination-case-mismatch', session };
      }
      if (sameDestinationSystem && session.destinationPageKind && page.pageKind && page.pageKind !== session.destinationPageKind) {
        WB.actionLifecycle.interrupt(session, 'ACTION_ROUTE_INTERRUPTED', {
          actualResult: `${page.pageKind || 'unknown'}:${actualEntity}`
        });
        return { ok: false, reason: 'route-interrupted', session };
      }
      if (!stillOnSource && page.system && session.sourceSystem && page.system !== session.sourceSystem) {
        // ActionSession is Case-wide, therefore another visible tab of the same
        // subscriber can observe it while the real source/destination tab is
        // still executing the route. Such a passive tab must never terminate
        // the shared action merely because its own system/pageKind differs.
        // A real wrong destination is handled above by destination-system +
        // entity/pageKind checks; an unrelated tab is read-only for lifecycle.
        WB.operatorTrace?.recordSystemEvent?.('ACTION_PASSIVE_TAB_IGNORED', {
          operationId: session.operationId || '',
          semanticTargetId: session.semanticTargetId || '',
          passiveSystem: page.system || '',
          passivePageKind: page.pageKind || '',
          destinationSystem: session.destinationSystem || '',
          destinationPageKind: session.destinationPageKind || ''
        });
        return { ok: false, reason: 'passive-tab-ignored', session };
      }
      if (session.status === 'REQUESTED') WB.actionLifecycle.navigationStarted(session, { actualResult: `waiting:${session.destinationPageKind || session.destinationSystem || ''}` });
      return { ok: false, reason: 'destination-not-reached', session };
    }
    if (['REQUESTED','NAVIGATING'].includes(session.status)) WB.actionLifecycle.destinationReached(session, { actualResult: page.pageKind || '' });
    if (session.intent === 'DIRECT_REPLAY' || session.replayOnly) {
      // DIRECT_REPLAY is not complete merely because the correct page opened.
      // The replay arrow promises "show me that place": wait for the real native
      // semantic target, scroll/orient to it, and only then complete the session.
      if (session.status === 'DESTINATION_REACHED') WB.actionLifecycle.waitingTarget(session);
      const resolvedReplay = WB.actionLifecycle.resolve(session, caseData);
      if (!resolvedReplay?.found) {
        WB.actionLifecycle.waitingTarget(session, { actualResult: resolvedReplay?.reason || 'replay-target-not-ready' });
        scheduleSemanticTargetRetry(session);
        return { ok: false, reason: resolvedReplay?.reason || 'replay-target-not-ready', directReplay: true, destinationVerified: true, session };
      }
      const oriented = showReplayOrientation(resolvedReplay.raw || resolvedReplay.element, session);
      if (!oriented) {
        WB.actionLifecycle.waitingTarget(session, { actualResult: 'replay-target-not-visible' });
        scheduleSemanticTargetRetry(session);
        return { ok: false, reason: 'replay-target-not-visible', directReplay: true, destinationVerified: true, session };
      }
      clearSemanticTargetRetry(session.operationId);
      if (session.status === 'WAITING_TARGET') WB.actionLifecycle.targetReady(session, { actualResult: session.semanticTargetId });
      WB.actionLifecycle.completeDirect(session, 'direct-replay-target-oriented', page.pageKind || session.semanticTargetId || '');
      return { ok: true, directReplay: true, destinationVerified: true, oriented: true, session: WB.actionLifecycle.inspect?.() || session };
    }
    if (session.status === 'DESTINATION_REACHED') WB.actionLifecycle.waitingTarget(session);
    const resolved = WB.actionLifecycle.resolve(session, caseData);
    if (!resolved?.found) {
      WB.actionLifecycle.waitingTarget(session, { actualResult: resolved?.reason || 'target-not-ready' });
      scheduleSemanticTargetRetry(session);
      return { ok: false, reason: resolved?.reason || 'target-not-ready', session };
    }
    clearSemanticTargetRetry(session.operationId);
    if (session.status === 'WAITING_TARGET') WB.actionLifecycle.targetReady(session, { actualResult: session.semanticTargetId });
    const activePlan = plan(caseData);
    const matchingPlan = activePlan && semanticTargetForPlan(activePlan, caseData) === session.semanticTargetId
      ? { ...activePlan, semanticTargetId: session.semanticTargetId, replayOnly: Boolean(session.replayOnly) }
      : genericPlanForSession(session, caseData);
    focusShowInFlight = true;
    let result = null;
    try {
      result = await overlay.show(resolved.raw || resolved.element, matchingPlan, caseData);
    } finally {
      focusShowInFlight = false;
    }
    return { ...result, session: WB.actionLifecycle.inspect?.() || session };
    } finally {
      actionContinuationInFlight = false;
      if (actionContinuationQueued) {
        actionContinuationQueued = false;
        queueMicrotask(() => {
          const latestCase = WB.store.activeCase?.() || caseData || null;
          if (latestCase?.id) void continueActiveActionSession(latestCase);
        });
      }
    }
  }

  WB.actionLifecycle?.registerResolver?.('billing.technical', () => technicalInspectionTarget(WB.store.activeCase?.()) || technicalRows()[0]?.row || document.querySelector('form'));
  WB.actionLifecycle?.registerResolver?.('userside.tmc', () => tmcHighlightTarget(WB.store.activeCase?.()) || findTmcBlock(WB.store.activeCase?.()));
  WB.actionLifecycle?.registerResolver?.('billing.poll.entry', () => findPollTab(WB.store.activeCase?.()));
  WB.actionLifecycle?.registerResolver?.('billing.olt.request', () => askOltHighlightTarget(WB.store.activeCase?.()));
  WB.actionLifecycle?.registerResolver?.('billing.juniper', () => pageInfo().pageKind === 'billing_juniper' ? findJuniperStatusTarget() : findJuniperLink(WB.store.activeCase?.()));

  WB.bus.on('action:rebind-timeout', () => {
    if (overlay.active) overlay.clear('TARGET_SEMANTICALLY_INVALID');
  });

  WB.guide = {
    plan,
    highlight,
    navigate,
    runNext,
    clear: (reason = 'UNEXPECTED_EXTERNAL_CLEAR') => overlay.clear(reason),
    refreshEvidenceTrail,
    refreshFamiliarReminders,
    latestPassiveDiscovery,
    highlightPassiveDiscovery,
    highlightTmcBlockDirect,
    replayMilestone,
    orientReplayTarget: showReplayOrientation,
    resumeTmcHandoff,
    continueActiveActionSession,
    semanticTargetForPlan,
    resolvers: {
      findTechnicalDataLink,
      findUsersideLink,
      findCustomerMacSearchLink,
      findOltField,
      findSaveButton,
      findTmcBlock,
      tmcHighlightTarget,
      tmcReviewStepId,
      tmcFoundText,
      authoritativePollAction,
      findPollTab,
      findAskOltLink,
      technicalInspection,
      technicalInspectionTarget,
      technicalRow,
      technicalControl,
      currentTechnicalMatches,
      closeSelectizeLookup,
      applyTmcTechnicalValues,
      applyMissingTmcTechnicalValues,
      rowHighlightTarget,
      candidateResultTarget
    },
    urls: {
      billingCard: billingCardUrl,
      billingTechnical: billingTechnicalUrl,
      usersideCustomer: usersideCustomerUrl
    }
  };

  window.addEventListener('pageshow', scheduleEvidenceTrailRefresh);
  window.addEventListener('pageshow', scheduleFamiliarReminderRefresh);
  window.setTimeout(scheduleEvidenceTrailRefresh, 0);
})();
