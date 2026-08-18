(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const data = WB?.operatorGuideSearchData;
  const content = WB?.conversationGraphContent;
  if (!WB || !data || !content || WB.operatorGuideSearch) return;

  let immutableIndex = null;

  const TOKEN_ALIASES = Object.freeze({
    'інтернет': 'интернет', 'інет': 'интернет', 'инет': 'интернет', 'интернетик': 'интернет',
    'дуже': 'очень', 'повільно': 'медленно', 'повильно': 'медленно', 'повилно': 'медленно',
    'працює': 'работает', 'працюет': 'работает', 'працюєт': 'работает', 'нема': 'нет',
    'кожні': 'каждые', 'кожни': 'каждые', 'каждіе': 'каждые', 'хвилин': 'минут', 'хвилини': 'минут',
    'пристроях': 'устройствах', 'пристрої': 'устройства', 'протязі': 'протяжении', 'протязи': 'протяжении',
    'вікідує': 'выкидывает', 'вікідует': 'выкидывает', 'викидує': 'выкидывает', 'викидует': 'выкидывает', 'выкидует': 'выкидывает',
    'робоча': 'рабочая', 'робочий': 'рабочий', 'робочої': 'рабочей', 'рабочй': 'рабочая', 'робочй': 'рабочая',
    'прога': 'программа', 'прогу': 'программа', 'програма': 'программа', 'програми': 'программа', 'програму': 'программа',
    'підвисає': 'подвисает', 'підвисает': 'подвисает', 'удалёнка': 'удаленка', 'віддаленка': 'удаленка',
    'рве': 'обрывает', 'рвет': 'обрывает', 'саме': 'само', 'знову': 'заново', 'є': 'есть', 'пише': 'пишет',
    'ютуб': 'youtube', 'вайфай': 'wifi', 'вафля': 'wifi'
  });

  const STOPWORDS = new Set([
    'абон', 'абонент', 'жалуется', 'говорит', 'сейчас', 'просто', 'очень', 'нормально', 'работает', 'работают',
    'потом', 'снова', 'через', 'только', 'есть', 'нет', 'весь', 'все', 'всех', 'один', 'одна', 'одно', 'при',
    'когда', 'после', 'перед', 'домашний', 'домашняя'
  ]);

  const SIGNAL_KIND = Object.freeze({
    all_devices: 'scope', phone: 'scope', laptop: 'scope', one_device_ok: 'scope',
    periodic: 'pattern', self_recovers: 'pattern', evening: 'pattern',
    wifi: 'environment', vpn: 'environment', remote: 'environment', work_app: 'environment'
  });
  const KIND_WEIGHT = Object.freeze({ concept: 0.18, scope: 0.10, pattern: 0.12, environment: 0.10 });

  const deepFreeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };

  function normalizeBase(value) {
    const cleaned = String(value ?? '')
      .normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[’'`´]/g, '')
      .replace(/wi[\s_-]*fi/g, ' wifi ').replace(/вай[\s_-]*фай/g, ' wifi ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    return cleaned.split(' ').map(token => TOKEN_ALIASES[token] || token).join(' ').replace(/\s+/g, ' ').trim();
  }

  function stripLimitations(normalized) {
    let symptomText = ` ${normalized} `;
    const matched = [];
    for (const raw of data.limitations || []) {
      const limitation = normalizeBase(raw);
      if (!limitation || !symptomText.includes(` ${limitation} `)) continue;
      matched.push(limitation);
      symptomText = symptomText.replaceAll(` ${limitation} `, ' ');
    }
    return { text: symptomText.replace(/\s+/g, ' ').trim(), limitations: Object.freeze(matched) };
  }

  function normalize(value) { return stripLimitations(normalizeBase(value)).text; }
  function tokens(value) { return String(value || '').split(' ').filter(Boolean); }

  function uniqueNormalized(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values || []) {
      const value = normalizeBase(raw);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      previous = current;
    }
    return previous[b.length];
  }

  function similarity(a, b) {
    const left = String(a || ''), right = String(b || '');
    if (!left || !right) return 0;
    if (left === right) return 1;
    const longest = Math.max(left.length, right.length);
    return longest ? 1 - (levenshtein(left, right) / longest) : 0;
  }

  function buildIndex() {
    if (immutableIndex) return immutableIndex;
    const topics = content.topics?.() || [];
    const topicById = new Map(topics.map(topic => [String(topic.id), topic]));
    const profileByKey = new Map();
    const phraseOwner = new Map();
    const entries = [];

    for (const rawProfile of data.profiles || []) {
      const topicId = String(rawProfile?.topicId || ''), symptomId = String(rawProfile?.symptomId || ''), key = `${topicId}:${symptomId}`;
      if (!topicById.has(topicId)) throw new Error(`Operator Guide Search orphan topicId: ${topicId}`);
      const topic = topicById.get(topicId);
      if (!topic?.variants?.some(item => String(item.id) === symptomId)) throw new Error(`Operator Guide Search orphan symptomId: ${key}`);
      if (profileByKey.has(key)) throw new Error(`Operator Guide Search duplicate profile: ${key}`);
      profileByKey.set(key, rawProfile);

      const normalizedPhrases = [];
      for (const item of rawProfile.phrases || []) {
        const text = normalizeBase(item?.text);
        if (!text) continue;
        const owner = phraseOwner.get(text);
        if (owner && owner !== key) throw new Error(`Operator Guide Search duplicate phrase: ${text}`);
        phraseOwner.set(text, key);
        normalizedPhrases.push(Object.freeze({
          text, weight: Math.max(0.1, Math.min(1.5, Number(item?.weight) || 1)),
          source: String(item?.source || 'curated'), approved: item?.approved !== false, tokens: Object.freeze(tokens(text))
        }));
      }
      if (!normalizedPhrases.length) throw new Error(`Operator Guide Search empty profile: ${key}`);

      const keywords = uniqueNormalized(rawProfile.keywords);
      const concepts = [...new Set((rawProfile.concepts || []).map(String).filter(Boolean))];
      const negativeSignals = uniqueNormalized(rawProfile.negativeSignals);
      const searchableTokens = new Set();
      for (const item of normalizedPhrases) item.tokens.forEach(token => searchableTokens.add(token));
      keywords.forEach(keyword => tokens(keyword).forEach(token => searchableTokens.add(token)));
      entries.push(Object.freeze({ topicId, symptomId, phrases: Object.freeze(normalizedPhrases), keywords: Object.freeze(keywords), concepts: Object.freeze(concepts), negativeSignals: Object.freeze(negativeSignals), searchableTokens: Object.freeze([...searchableTokens]) }));
    }

    for (const topic of topics) for (const variant of topic?.variants || []) {
      const key = `${topic.id}:${variant.id}`;
      if (!profileByKey.has(key)) throw new Error(`Operator Guide Search missing profile: ${key}`);
    }

    const conceptLexicon = {};
    for (const [conceptId, phrases] of Object.entries(data.conceptLexicon || {})) conceptLexicon[conceptId] = Object.freeze(uniqueNormalized(phrases));

    immutableIndex = deepFreeze({
      revision: data.revision,
      entries: Object.freeze(entries),
      conceptLexicon: Object.freeze(conceptLexicon),
      topicConcepts: data.topicConcepts,
      stats: Object.freeze({
        topicCount: topics.length,
        profileCount: entries.length,
        phraseCount: entries.reduce((sum, entry) => sum + entry.phrases.length, 0),
        tokenCount: entries.reduce((sum, entry) => sum + entry.searchableTokens.length, 0)
      })
    });
    return immutableIndex;
  }

  function detectConcepts(query, index) {
    const queryTokens = new Set(tokens(query));
    const found = new Set();
    for (const [conceptId, phrases] of Object.entries(index.conceptLexicon)) {
      for (const phrase of phrases) {
        const phraseTokens = tokens(phrase);
        const matched = phraseTokens.length === 1 ? queryTokens.has(phraseTokens[0]) : query.includes(phrase);
        if (matched) { found.add(conceptId); break; }
      }
    }
    return found;
  }

  function phraseScore(query, queryTokenSet, phraseEntry, reasons) {
    const phrase = phraseEntry.text, weight = phraseEntry.weight;
    if (query.includes(phrase)) { reasons.push(`phrase: ${phrase}`); return 0.56 * weight; }
    const phraseTokens = phraseEntry.tokens.filter(token => !STOPWORDS.has(token));
    if (!phraseTokens.length) return 0;
    const matched = phraseTokens.filter(token => queryTokenSet.has(token)).length;
    const coverage = matched / phraseTokens.length;
    if (matched >= 2 && coverage >= 0.55) { reasons.push(`phrase-fragment: ${phrase}`); return 0.30 * coverage * weight; }
    return 0;
  }

  function fuzzyScore(queryTokens, targetTokens, reasons) {
    let best = null;
    for (const left of queryTokens) {
      if (left.length < 5 || STOPWORDS.has(left)) continue;
      for (const right of targetTokens) {
        if (right.length < 5 || STOPWORDS.has(right) || left === right || Math.abs(left.length - right.length) > 3) continue;
        const score = similarity(left, right), threshold = Math.max(left.length, right.length) <= 7 ? 0.80 : 0.74;
        if (score >= threshold && (!best || score > best.score)) best = { left, right, score };
      }
    }
    if (!best) return 0;
    reasons.push(`fuzzy: ${best.left}~${best.right}`);
    return Math.min(0.14, 0.14 * best.score);
  }

  function conflictPenalty(topicId, concepts, reasons) {
    let penalty = 0;
    if (topicId === 'no_internet' && concepts.has('internet_ok')) { penalty += 0.30; reasons.push('conflict: internet_ok'); }
    if (topicId === 'low_speed' && concepts.has('no_access') && !concepts.has('slow')) { penalty += 0.18; reasons.push('conflict: no_access_without_slow'); }
    if (topicId === 'low_speed' && concepts.has('internet_ok') && !concepts.has('slow') && !concepts.has('load_slow')) { penalty += 0.24; reasons.push('conflict: internet_ok_without_slow'); }
    if (topicId === 'unstable' && concepts.has('no_access') && !concepts.has('unstable') && !concepts.has('periodic')) { penalty += 0.12; reasons.push('conflict: no_unstable_signal'); }
    if (topicId === 'other' && concepts.has('no_access') && !['work_app', 'vpn', 'remote', 'logout', 'microfreeze'].some(id => concepts.has(id))) { penalty += 0.12; reasons.push('conflict: general_outage'); }
    return penalty;
  }

  function scoreEntry(query, queryTokens, queryTokenSet, concepts, entry, index) {
    let score = 0;
    const reasons = [], signalGroups = new Set();
    for (const phraseEntry of entry.phrases) {
      const addition = phraseScore(query, queryTokenSet, phraseEntry, reasons);
      if (addition > 0) { score += addition; signalGroups.add('phrase'); }
    }
    let keywordScore = 0;
    for (const keyword of entry.keywords) {
      const keywordTokens = tokens(keyword);
      const exact = keywordTokens.length === 1 ? queryTokenSet.has(keywordTokens[0]) : query.includes(keyword);
      if (!exact) continue;
      keywordScore += 0.13; reasons.push(`keyword: ${keyword}`);
    }
    if (keywordScore) { score += Math.min(0.30, keywordScore); signalGroups.add('keyword'); }

    let conceptScore = 0;
    for (const conceptId of entry.concepts) {
      if (!concepts.has(conceptId)) continue;
      const kind = SIGNAL_KIND[conceptId] || 'concept';
      conceptScore += KIND_WEIGHT[kind] || KIND_WEIGHT.concept;
      reasons.push(`${kind}: ${conceptId}`); signalGroups.add(kind);
    }
    score += Math.min(0.44, conceptScore);

    const topicConcepts = index.topicConcepts?.[entry.topicId] || [];
    if (score > 0 && topicConcepts.some(conceptId => concepts.has(conceptId))) { score += 0.08; reasons.push(`topic: ${entry.topicId}`); signalGroups.add('topic'); }
    const fuzzy = fuzzyScore(queryTokens, entry.searchableTokens, reasons);
    if (fuzzy) { score += fuzzy; signalGroups.add('fuzzy'); }
    for (const negative of entry.negativeSignals) if (query.includes(negative)) { score -= 0.28; reasons.push(`negative: ${negative}`); }
    score -= conflictPenalty(entry.topicId, concepts, reasons);
    if (signalGroups.size >= 2) score += 0.06;
    if (signalGroups.size >= 4) score += 0.04;
    return { topicId: entry.topicId, symptomId: entry.symptomId, score: Math.max(0, Math.min(1, Number(score.toFixed(4)))), reasons: Object.freeze(reasons) };
  }

  function search(rawQuery, options = {}) {
    const index = buildIndex();
    const stripped = stripLimitations(normalizeBase(rawQuery));
    const query = stripped.text;
    if (!query || tokens(query).every(token => STOPWORDS.has(token))) return [];
    const queryTokens = tokens(query), queryTokenSet = new Set(queryTokens), concepts = detectConcepts(query, index);
    const minScore = Number.isFinite(options.minScore) ? Math.max(0, Number(options.minScore)) : 0.12;
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(64, Number(options.limit))) : 16;
    return index.entries.map(entry => scoreEntry(query, queryTokens, queryTokenSet, concepts, entry, index))
      .filter(result => result.score >= minScore)
      .sort((left, right) => right.score - left.score || left.topicId.localeCompare(right.topicId) || left.symptomId.localeCompare(right.symptomId))
      .slice(0, limit)
      .map(result => Object.freeze({ topicId: result.topicId, symptomId: result.symptomId, score: result.score, reasons: result.reasons }));
  }

  function indexStats() { return { ...buildIndex().stats }; }
  function validate() { const index = buildIndex(); return Object.freeze({ valid: true, revision: index.revision, ...index.stats }); }

  WB.operatorGuideSearch = Object.freeze({
    revision: 'operator-guide-local-search-engine-v1',
    providers: Object.freeze(['lexical', 'fuzzy']),
    normalize,
    search,
    indexStats,
    validate
  });
})();