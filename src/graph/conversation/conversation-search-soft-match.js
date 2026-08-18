(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const base = WB?.operatorGuideSearch;
  if (!WB || !base || typeof base.search !== 'function' || WB.__operatorGuideSoftMatchLoaded) return;

  WB.__operatorGuideSoftMatchLoaded = true;

  const GENERIC_QUALITY_RE = /(?:плох|никак|еле|слаб|ужас|кошмар|туп|глюч)/iu;
  const INTERNET_RE = /(?:интернет|инет)/iu;
  const EXPLICIT_OUTAGE_RE = /(?:нет\s+интернет|без\s+интернет|не\s+работает|ничего\s+не\s+открыва|пропада|отвалива|обрыв|рвет|рвёт)/iu;
  const SOFT_SCORE = 0.46;
  const NORMAL_MATCH_FLOOR = 0.34;

  function isGenericInternetComplaint(rawQuery) {
    const raw = String(rawQuery || '').toLowerCase();
    if (!INTERNET_RE.test(raw)) return false;
    if (EXPLICIT_OUTAGE_RE.test(raw)) return false;
    return GENERIC_QUALITY_RE.test(raw);
  }

  function search(rawQuery, options = {}) {
    const original = base.search(rawQuery, options);
    const results = Array.isArray(original) ? original.slice() : [];
    const bestScore = Number(results[0]?.score) || 0;
    if (bestScore >= NORMAL_MATCH_FLOOR || !isGenericInternetComplaint(rawQuery)) return original;

    const fallback = Object.freeze({
      topicId: 'low_speed',
      symptomId: 'internet_slow',
      score: SOFT_SCORE,
      reasons: Object.freeze(['generic-complaint: internet-quality'])
    });

    const withoutDuplicate = results.filter(item => !(item?.topicId === fallback.topicId && item?.symptomId === fallback.symptomId));
    const limit = Math.max(1, Number(options?.limit) || 8);
    return Object.freeze([fallback, ...withoutDuplicate]
      .sort((left, right) => (Number(right?.score) || 0) - (Number(left?.score) || 0))
      .slice(0, limit));
  }

  WB.operatorGuideSearch = Object.freeze({
    ...base,
    revision: 'operator-guide-local-search-engine-v1-soft-generic',
    search
  });
})();
