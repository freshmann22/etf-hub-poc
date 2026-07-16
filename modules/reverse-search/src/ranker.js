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
  if (field === 'tradingValue') return `${value.toLocaleString()}백만원`;
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
