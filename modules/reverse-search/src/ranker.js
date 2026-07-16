// 랭커 — intent + 데이터 컨텍스트를 받아 상위 10개 + 근거문구를 만든다. 순수 함수(단위테스트 가능).
// "주어진 ETF 종목 안에서만 열거" 원칙: 컨텍스트에 없는 종목/ETF 는 절대 만들어내지 않는다.
const TOP_N = 10;

function resolveName(context, code, fallbackName) {
  return context.master?.[code]?.name || fallbackName || code;
}

export function rankByStockWeight(context, stockCode, stockName) {
  const { holdingsUniverse } = context;
  const rows = [];
  for (const etfCode of Object.keys(holdingsUniverse)) {
    const entry = holdingsUniverse[etfCode];
    const hit = (entry.holdings || []).find((h) => h.ticker === stockCode);
    if (hit) rows.push({ code: etfCode, name: resolveName(context, etfCode, entry.name), weight: hit.weight });
  }
  rows.sort((a, b) => b.weight - a.weight);
  const items = rows.slice(0, TOP_N).map((r) => ({
    code: r.code,
    name: r.name,
    evidence: `${stockName} 비중 ${r.weight.toFixed(1)}%`,
  }));
  const coverage = Object.keys(holdingsUniverse).length;
  const note = `구성종목 데이터가 있는 ${coverage}개 ETF 기준 결과예요`;
  if (items.length === 0) {
    return { status: 'empty', items: [], note: `${stockName}이 담긴 ETF를 ${coverage}개 ETF 안에서 찾지 못했어요` };
  }
  return { status: 'ok', items, note };
}

function tagScoreForGroup(tags, tagIds) {
  let best = null;
  for (const t of tags || []) {
    if (tagIds.includes(t.tagId)) {
      const combined = (t.score || 0) * (t.confidence || 0);
      if (!best || combined > best.combined) best = { tagId: t.tagId, score: t.score, confidence: t.confidence, combined };
    }
  }
  return best;
}

function matchTagGroups(tags, tagGroups, mode) {
  const matches = tagGroups.map((g) => tagScoreForGroup(tags, g.tagIds));
  if (mode === 'and' && matches.some((m) => !m)) return null;
  if (mode === 'or' && matches.every((m) => !m)) return null;
  const found = matches.filter(Boolean);
  if (found.length === 0) return null;
  const combined = found.reduce((sum, m) => sum + m.combined, 0);
  return { combined, matches };
}

function buildTagEvidence(tagGroups, matchResult) {
  const parts = tagGroups
    .map((g, i) => (matchResult.matches[i] ? { keyword: g.matchedKeyword, confidence: matchResult.matches[i].confidence } : null))
    .filter(Boolean);
  const keywordLabel = parts.map((p) => p.keyword).join('·');
  const avgConfidence = parts.reduce((s, p) => s + p.confidence, 0) / parts.length;
  return `${keywordLabel} 태그 매칭(신뢰도 ${Math.round(avgConfidence * 100)}%)`;
}

function rankByTagMode(context, tagGroups, mode) {
  const { tagUniverse } = context;
  const rows = [];
  for (const code of Object.keys(tagUniverse.etfs || {})) {
    const m = matchTagGroups(tagUniverse.etfs[code].tags, tagGroups, mode);
    if (m) rows.push({ code, name: resolveName(context, code), match: m });
  }
  rows.sort((a, b) => b.match.combined - a.match.combined);
  return rows.slice(0, TOP_N).map((r) => ({
    code: r.code,
    name: r.name,
    evidence: buildTagEvidence(tagGroups, r.match),
  }));
}

export function rankByTag(context, tagGroups) {
  const coverage = Object.keys(context.tagUniverse.etfs || {}).length;
  const primary = rankByTagMode(context, tagGroups, 'and');
  if (primary.length > 0) {
    return { status: 'ok', items: primary, note: `전체 ${coverage}개 ETF 기준 태그 매칭 결과예요` };
  }
  const fallback = rankByTagMode(context, tagGroups, 'or');
  if (fallback.length > 0) {
    return {
      status: 'fallback',
      items: fallback,
      note: '조건을 모두 만족하는 ETF가 없어 가장 가까운 결과를 보여드려요',
    };
  }
  return { status: 'empty', items: [], note: '조건에 맞는 ETF를 찾지 못했어요' };
}

export function rankBySortField(context, marketSnapshot, field, dir, label) {
  const rows = (marketSnapshot || []).filter((r) => typeof r[field] === 'number');
  rows.sort((a, b) => (dir === 'asc' ? a[field] - b[field] : b[field] - a[field]));
  const items = rows.slice(0, TOP_N).map((r) => ({
    code: r.code,
    name: resolveName(context, r.code, r.name),
    evidence: `${label} ${formatMetric(field, r[field])}`,
  }));
  const total = (marketSnapshot || []).length;
  const note =
    rows.length < total
      ? `시황 데이터가 있는 ${rows.length}개 ETF만 집계돼요(전체 ${total}개 중, 나머지는 데이터 없음)`
      : `${label} 기준 상위 결과예요`;
  if (items.length === 0) return { status: 'empty', items: [], note: `${label} 데이터가 있는 ETF가 없어요` };
  return { status: 'ok', items, note };
}

function formatMetric(field, value) {
  if (field === 'volume') return `${Math.round(value).toLocaleString()}주`;
  if (field === 'tradingValue') return `${value.toLocaleString()}억원`;
  if (field === 'return1m') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  if (field === 'totalFee') return `${value.toFixed(2)}%`;
  return String(value);
}

export function rankComposite(context, marketSnapshot, tagGroups, sortField, sortDir, sortLabel) {
  const { tagUniverse } = context;
  const codesInTag = new Set(
    Object.keys(tagUniverse.etfs || {}).filter((code) => matchTagGroups(tagUniverse.etfs[code].tags, tagGroups, 'and'))
  );
  if (codesInTag.size === 0) {
    return rankByTag(context, tagGroups); // 태그 조건 자체가 안 맞으면 태그 결과(fallback 포함)로 대체
  }
  const rows = (marketSnapshot || []).filter((r) => codesInTag.has(r.code) && typeof r[sortField] === 'number');
  rows.sort((a, b) => (sortDir === 'asc' ? a[sortField] - b[sortField] : b[sortField] - a[sortField]));
  const items = rows.slice(0, TOP_N).map((r) => ({
    code: r.code,
    name: resolveName(context, r.code, r.name),
    evidence: `${sortLabel} ${formatMetric(sortField, r[sortField])}`,
  }));
  if (items.length === 0) {
    return {
      status: 'fallback',
      items: rankByTagMode(context, tagGroups, 'and').slice(0, TOP_N),
      note: `${sortLabel} 데이터가 없어 태그 매칭 순으로 보여드려요(태그 조건은 ${codesInTag.size}개 ETF에서 만족)`,
    };
  }
  return { status: 'ok', items, note: `태그 조건(${codesInTag.size}개 ETF) 중 ${sortLabel} 기준 상위 결과예요` };
}

export function rankFallbackDefault(context, marketSnapshot) {
  return rankBySortField(context, marketSnapshot, 'tradingValue', 'desc', '거래대금');
}

export function rankByQueryPlan(context, plan) {
  const plannedTags = Array.isArray(plan?.tags) ? plan.tags : [];
  if (!plannedTags.length && plan?.sort) {
    return rankBySortField(
      context,
      context.marketSnapshot,
      plan.sort.field,
      plan.sort.direction,
      plan.sort.label
    );
  }

  const marketByCode = new Map((context.marketSnapshot || []).map((row) => [row.code, row]));
  let rows = scoreQueryPlanRows(context, plannedTags, marketByCode, false);
  let status = 'ok';
  let relaxed = false;

  if (!rows.length && plannedTags.some((tag) => tag.mode === 'required')) {
    rows = scoreQueryPlanRows(context, plannedTags, marketByCode, true);
    status = rows.length ? 'fallback' : 'empty';
    relaxed = rows.length > 0;
  }

  if (plan?.sort) {
    rows = rows.filter((row) => typeof row.market?.[plan.sort.field] === 'number');
    rows.sort((a, b) => {
      const av = a.market[plan.sort.field];
      const bv = b.market[plan.sort.field];
      const metricOrder = plan.sort.direction === 'asc' ? av - bv : bv - av;
      return metricOrder || b.relevanceScore - a.relevanceScore || a.code.localeCompare(b.code);
    });
  } else {
    rows.sort((a, b) => b.relevanceScore - a.relevanceScore || a.code.localeCompare(b.code));
  }

  const items = rows.slice(0, TOP_N).map((row) => {
    const tagEvidence = `${row.matchedTags.slice(0, 2).map((tag) => tag.label).join('·')} 적합도 ${row.relevanceScore}%`;
    const metricEvidence = plan?.sort ? `${plan.sort.label} ${formatMetric(plan.sort.field, row.market[plan.sort.field])}` : null;
    return {
      code: row.code,
      name: row.name,
      relevanceScore: row.relevanceScore,
      matchedTags: row.matchedTags,
      evidence: [tagEvidence, metricEvidence].filter(Boolean).join(' · '),
    };
  });

  if (!items.length) return { status: 'empty', items: [], note: '해석된 조건과 데이터가 함께 있는 ETF를 찾지 못했어요' };
  const requiredFacetCount = new Set(plannedTags.filter((tag) => tag.mode === 'required').map((tag) => tag.facet)).size;
  const note = relaxed
    ? '필수 조건을 모두 만족하는 ETF가 없어 태그 적합도가 가까운 결과를 보여드려요'
    : `${requiredFacetCount ? `필수 조건 ${requiredFacetCount}개 영역을 적용하고 ` : ''}질의 태그 점수로 계산한 결과예요`;
  return { status, items, note };
}

function scoreQueryPlanRows(context, plannedTags, marketByCode, relaxRequired) {
  const requiredByFacet = new Map();
  for (const tag of plannedTags.filter((item) => item.mode === 'required')) {
    if (!requiredByFacet.has(tag.facet)) requiredByFacet.set(tag.facet, []);
    requiredByFacet.get(tag.facet).push(tag);
  }

  const rows = [];
  for (const [code, entry] of Object.entries(context.tagUniverse.etfs || {})) {
    const etfTags = new Map((entry.tags || []).map((tag) => [tag.tagId, tag]));
    if (plannedTags.some((tag) => tag.mode === 'excluded' && etfTags.has(tag.tagId))) continue;
    if (!relaxRequired) {
      const requiredSatisfied = [...requiredByFacet.values()].every((group) => group.some((tag) => etfTags.has(tag.tagId)));
      if (!requiredSatisfied) continue;
    }

    const matchedTags = [];
    let weightedScore = 0;
    let totalWeight = 0;

    for (const group of requiredByFacet.values()) {
      totalWeight += Math.max(...group.map((tag) => tag.queryScore));
      const best = group
        .map((planned) => buildTagContribution(planned, etfTags.get(planned.tagId)))
        .filter(Boolean)
        .sort((a, b) => b.contribution - a.contribution)[0];
      if (best) {
        weightedScore += best.contribution;
        matchedTags.push(best);
      }
    }

    for (const planned of plannedTags.filter((tag) => tag.mode === 'preferred')) {
      totalWeight += planned.queryScore;
      const matched = buildTagContribution(planned, etfTags.get(planned.tagId));
      if (!matched) continue;
      weightedScore += matched.contribution;
      matchedTags.push(matched);
    }
    if (!matchedTags.length) continue;
    matchedTags.sort((a, b) => b.contribution - a.contribution);
    rows.push({
      code,
      name: resolveName(context, code),
      market: marketByCode.get(code) || null,
      matchedTags,
      relevanceScore: totalWeight ? Math.round((weightedScore / totalWeight) * 100) : 0,
    });
  }
  return rows;
}

function buildTagContribution(planned, assigned) {
  if (!assigned) return null;
  const contribution = planned.queryScore * (assigned.score || 0) * (assigned.confidence || 0);
  return {
    tagId: planned.tagId,
    label: planned.label,
    queryScore: planned.queryScore,
    etfScore: assigned.score,
    confidence: assigned.confidence,
    contribution: Math.round(contribution * 1000) / 1000,
  };
}
