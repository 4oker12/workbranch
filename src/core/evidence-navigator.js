(() => {
  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const factValue = value => (
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
      ? value.value
      : value
  );

  const asTime = value => {
    const text = String(value || '');
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : 0;
  };

  const latestContext = (caseData, pageKind) => {
    const contexts = Object.values(caseData?.contexts || {})
      .filter(item => String(item?.pageKind || '') === String(pageKind || ''))
      .sort((a, b) => asTime(b?.observedAt) - asTime(a?.observedAt));
    return contexts[0] || null;
  };

  const latestEvidence = (caseData, type) => {
    const evidence = Array.isArray(caseData?.locator?.evidence)
      ? caseData.locator.evidence
      : [];
    return evidence
      .filter(item => String(item?.type || '') === String(type || ''))
      .sort((a, b) => asTime(b?.at) - asTime(a?.at))[0] || null;
  };

  const completedGuideAt = (caseData, matcher) => {
    const completed = caseData?.route?.guide?.completed || {};
    let best = '';
    for (const [stepId, record] of Object.entries(completed)) {
      if (!matcher(stepId, record)) continue;
      const at = String(record?.at || '');
      if (asTime(at) >= asTime(best)) best = at;
    }
    return best;
  };

  const technicalMilestone = caseData => {
    const context = latestContext(caseData, 'billing_technical');
    if (!context && !caseData?.diagnostic?.technicalVisited) return null;
    const guideAt = completedGuideAt(caseData, stepId => (
      stepId.startsWith('billing.inspect-technical:')
      || stepId === 'billing.save-olt'
      || stepId === 'billing.save-technical-fields'
      || stepId.startsWith('billing.fill-technical:')
    ));
    const verified = Boolean(
      caseData?.diagnostic?.billingTechnicalComplete
      || caseData?.workflow?.ponAcquisition?.technicalWritebackVerified
      || guideAt
    );
    return {
      key: 'technical',
      label: 'Техданные',
      status: verified ? 'сверено' : 'просмотрено',
      level: verified ? 'verified' : 'read',
      at: guideAt || context?.observedAt || caseData?.updatedAt || '',
      source: 'billing',
      replay: true
    };
  };

  const tmcMilestone = caseData => {
    const explicitlyShownAt = String(caseData?.workflow?.ponAcquisition?.tmcShownAt || '');
    // STRICT OPERATOR MILESTONE:
    // passive TMC parsing, sourceStatus, TMC_RESULT and merely opening the
    // UserSide customer page are diagnostic facts only. They MUST NOT mean
    // "operator visited TMC". The milestone exists only after the Workbench
    // semantic teleport reached userside.tmc, the target was visible, and the
    // first-pass TMC value marks were actually shown (recorded as tmcShownAt).
    if (!explicitlyShownAt) return null;

    const evidence = latestEvidence(caseData, 'TMC_RESULT');
    const result = String(evidence?.result || caseData?.locator?.sourceStatus?.tmc?.result || '');
    const identity = evidence?.details?.identityCheck || caseData?.locator?.sourceStatus?.tmc?.details?.identityCheck || {};
    const verified = identity?.isMatch === true || evidence?.details?.matchedCurrentSubscriber === true;
    const status = verified
      ? 'сверено'
      : result === 'found'
        ? 'данные получены'
        : result === 'missing'
          ? 'данные не найдены'
          : 'показано';
    return {
      key: 'tmc',
      label: 'ТМЦ',
      status,
      level: verified ? 'verified' : result === 'found' ? 'read' : 'observed',
      // Progress time is the teleport/show time, never the earlier parser time.
      at: explicitlyShownAt,
      source: 'userside',
      replay: true
    };
  };

  const pollMilestone = caseData => {
    const evidence = latestEvidence(caseData, 'POLL_RESULT');
    const attempt = caseData?.operations?.poll?.current || null;
    const terminalAttempt = attempt && attempt.pending === false ? attempt : null;
    const termination = caseData?.locator?.termination || null;
    const snapshot = caseData?.live?.oltSnapshot || null;
    // A running request has its own transient LIVE card. It becomes part of
    // "Что уже сделано" only after a terminal result exists.
    const attempted = Boolean(evidence || terminalAttempt || termination || snapshot);
    if (!attempted) return null;

    const rawResult = String(
      evidence?.result
      || evidence?.details?.outcome
      || snapshot?.outcome
      || termination?.status
      || terminalAttempt?.stage
      || ''
    ).toLowerCase();
    const onuStatus = String(snapshot?.onuStatus || evidence?.details?.onuStatus || '').toLowerCase();
    let status = 'выполнено';
    let level = 'observed';
    if (['confirmed', 'success', 'online', 'up'].includes(rawResult) || snapshot?.status === 'confirmed') {
      status = onuStatus ? `ONU ${onuStatus.toUpperCase()}` : 'ответ получен';
      level = 'verified';
    } else if (rawResult.includes('not_found') || rawResult.includes('not-found') || rawResult === 'not_found') {
      status = 'ONU не найдена';
      level = 'attention';
    } else if (rawResult.includes('timeout')) {
      status = 'timeout';
      level = 'attention';
    } else if (rawResult.includes('failed') || rawResult.includes('error') || rawResult.includes('blocked')) {
      status = 'ошибка';
      level = 'attention';
    }

    return {
      key: 'poll',
      label: 'Опрос ONU',
      status,
      level,
      at: evidence?.at || snapshot?.capturedAt || snapshot?.updatedAt || termination?.at || terminalAttempt?.updatedAt || terminalAttempt?.startedAt || caseData?.updatedAt || '',
      source: 'olt',
      replay: true
    };
  };

  const juniperMilestone = caseData => {
    const evidence = latestEvidence(caseData, 'JUNIPER_SESSION');
    const source = caseData?.locator?.sourceStatus?.juniper
      || caseData?.locator?.sourceStatus?.juniperPreview
      || null;
    const state = caseData?.juniper || {};
    const evidenceState = state?.evidence || {};
    const openedAt = String(evidenceState?.opened?.at || state?.openedAt || '');
    const readAt = String(evidenceState?.read?.at || state?.readAt || '');
    const verifiedAt = String(evidenceState?.verified?.at || state?.verifiedAt || '');
    const successfulRead = Boolean(
      readAt
      || verifiedAt
      || (state?.dataStatus === 'available' && String(state?.result || '').toLowerCase() !== 'error')
      || (source && String(source?.result || '').toLowerCase() !== 'error')
      || (evidence && String(evidence?.result || '').toLowerCase() !== 'error')
    );

    // Juniper differs from TMC/Technical: a correlated, successfully parsed
    // background snapshot is already a diagnostic fact. Manual OPENED remains a
    // separate evidence field, but LIVE aggregates both into one history row.
    if (!successfulRead && !openedAt) return null;

    const details = state?.details || source?.details || evidence?.details || {};
    const result = String(state?.result || source?.result || evidence?.result || details?.status || '').toLowerCase();
    const status = successfulRead
      ? result === 'online'
        ? 'Online'
        : result === 'offline'
          ? 'Offline'
          : result === 'no_session'
            ? 'сессия не найдена'
            : result === 'unknown'
              ? 'состояние неизвестно'
              : 'данные получены'
      : 'открыт';
    const at = readAt || openedAt || source?.observedAt || evidence?.at || state?.updatedAt || caseData?.updatedAt || '';
    return {
      key: 'juniper',
      label: 'Juniper',
      status,
      level: successfulRead ? 'verified' : 'read',
      at,
      source: String(evidenceState?.read?.source || state?.readSource || (successfulRead ? 'automatic' : 'operator')),
      replay: true,
      opened: Boolean(openedAt),
      verified: Boolean(verifiedAt || state?.verified === true),
      result
    };
  };

  function trail(caseData) {
    if (!caseData) return [];
    return [
      technicalMilestone(caseData),
      tmcMilestone(caseData),
      pollMilestone(caseData),
      juniperMilestone(caseData)
    ]
      .filter(Boolean)
      .sort((a, b) => {
        const diff = asTime(a.at) - asTime(b.at);
        if (diff) return diff;
        return a.key.localeCompare(b.key);
      });
  }

  function achieved(caseData, key) {
    return trail(caseData).some(item => item.key === key);
  }

  function planMilestoneKey(plan = {}) {
    const id = String(plan?.id || '');
    if (!id) return '';
    if (/technical|fill-olt|save-olt/i.test(id)) return 'technical';
    if (/tmc|userside\.find|userside\.inspect|open-userside|return-for-userside|resume-userside/i.test(id)) return 'tmc';
    if (/poll|ask-olt/i.test(id)) return 'poll';
    if (/juniper/i.test(id)) return 'juniper';
    return '';
  }

  function recommendationAllowed(caseData, plan = {}) {
    const key = planMilestoneKey(plan);
    if (!key) return true;
    return !achieved(caseData, key);
  }

  WB.evidenceNavigator = {
    trail,
    achieved,
    planMilestoneKey,
    recommendationAllowed,
    latestEvidence,
    latestContext,
    factValue
  };
})();
