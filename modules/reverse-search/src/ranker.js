// 랭커 — intent + 데이터 컨텍스트를 받아 상위 10개 + 근거문구를 만든다. 순수 함수(단위테스트 가능).
// "주어진 ETF 종목 안에서만 열거" 원칙: 컨텍스트에 없는 종목/ETF 는 절대 만들어내지 않는다.
import { normalizeText } from './text.js';

const TOP_N = 10;

// 텍스트 조건이 사용할 수 있는 출처 필드 — 라벨(근거표시)과 가중치(신뢰도 구분).
// 공식명은 마케팅 표기라 우연 일치 여지가 있어 약간 낮게, 기초지수·투자목적은 ETF 가 실제로
// 추종/표방하는 권위 있는 근거라 높게 둔다. 따라서 "이름만 일치" < "기초지수·투자목적 일치".
const TEXT_FIELD_LABELS = { officialName: '공식명', benchmarkName: '기초지수', investmentObjective: '투자목적' };
const TEXT_FIELD_WEIGHTS = { officialName: 0.9, benchmarkName: 1, investmentObjective: 1 };
const TEXT_REQUIRED_WEIGHT = 1;
const TEXT_PREFERRED_WEIGHT = 0.6;

// 텍스트 조건별 매칭 검사어(값+alias)를 정규화해 한 번만 계산한다.
function constraintTerms(constraint) {
  return [constraint.value, ...(constraint.aliases || [])].map((t) => normalizeText(t)).filter(Boolean);
}

// searchIndex 원문 엔트리 -> { field: { raw, norm } } (존재하는 필드만).
function normalizeSearchEntry(rawEntry) {
  const out = {};
  for (const field of Object.keys(TEXT_FIELD_LABELS)) {
    const raw = rawEntry?.[field];
    if (typeof raw === 'string' && raw.trim()) out[field] = { raw, norm: normalizeText(raw) };
  }
  return out;
}

// 한 텍스트 조건에 대한 일치 결과. 일치 필드가 하나도 없으면 null.
function matchTextConstraint(normEntry, constraint, terms) {
  const matchedFields = [];
  for (const field of constraint.fields) {
    const fv = normEntry[field];
    if (!fv) continue;
    const term = terms.find((t) => fv.norm.includes(t));
    if (term) matchedFields.push({ field, raw: fv.raw, term });
  }
  if (!matchedFields.length) return null;
  // 근거 강도 = 매칭된 필드 중 가장 권위 있는 필드의 가중치. 기초지수/투자목적(1.0)이 공식명(0.9)보다 강하다.
  const fieldScore = Math.max(...matchedFields.map((m) => TEXT_FIELD_WEIGHTS[m.field] || 0.7));
  // 권위 있는 근거로 뒷받침되는지(이름만 우연 일치와 구분) — 결과에 노출해 설명 가능하게 한다.
  const authoritative = matchedFields.some((m) => m.field === 'benchmarkName' || m.field === 'investmentObjective');
  return { value: constraint.value, mode: constraint.mode, matchedFields, fieldScore, authoritative };
}

function buildTextEvidence(matchedText) {
  if (!matchedText || !matchedText.length) return null;
  const parts = matchedText.map((m) => {
    const fields = [...new Set(m.matchedFields.map((f) => TEXT_FIELD_LABELS[f.field]))].join('·');
    return `${fields} '${m.value}' 일치`;
  });
  return parts.join(', ');
}

// sector 개념의 텍스트 폴백 — 태그가 없어도 이름/기초지수에 근거가 있으면 개념을 충족한다.
// 태그 근거보다 낮게 평가(디스카운트)해 태그로 확정된 ETF 가 위에 오도록 한다.
const TAG_TEXT_FALLBACK_FACTOR = 0.7;

function tagFallbackContribution(planned, normEntry) {
  const fb = planned?.textFallback;
  if (!fb) return null;
  const m = matchTextConstraint(normEntry, { value: fb.value, mode: 'required', fields: fb.fields }, constraintTerms(fb));
  if (!m) return null;
  const contribution = Math.round(planned.queryScore * m.fieldScore * TAG_TEXT_FALLBACK_FACTOR * 1000) / 1000;
  return { contribution, match: m };
}

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
  const textConstraints = (Array.isArray(plan?.textConstraints) ? plan.textConstraints : []).map((c) => ({
    ...c,
    fields: Array.isArray(c.fields) && c.fields.length ? c.fields : Object.keys(TEXT_FIELD_LABELS),
    _terms: constraintTerms(c),
  }));
  // 태그·텍스트 조건이 모두 없고 정렬만 있으면 순수 시황 정렬로 처리.
  if (!plannedTags.length && !textConstraints.length && plan?.sort) {
    return rankBySortField(
      context,
      context.marketSnapshot,
      plan.sort.field,
      plan.sort.direction,
      plan.sort.label
    );
  }

  const marketByCode = new Map((context.marketSnapshot || []).map((row) => [row.code, row]));
  let rows = scoreQueryPlanRows(context, plannedTags, textConstraints, marketByCode, false);
  let status = 'ok';
  let relaxed = false;

  const hasRequired =
    plannedTags.some((tag) => tag.mode === 'required') || textConstraints.some((c) => c.mode === 'required');
  if (!rows.length && hasRequired) {
    rows = scoreQueryPlanRows(context, plannedTags, textConstraints, marketByCode, true);
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
    const tagEvidence = row.matchedTags.length
      ? `${row.matchedTags.slice(0, 2).map((tag) => tag.label).join('·')} 적합도 ${row.relevanceScore}%`
      : null;
    const textEvidence = buildTextEvidence(row.matchedText);
    const metricEvidence = plan?.sort ? `${plan.sort.label} ${formatMetric(plan.sort.field, row.market[plan.sort.field])}` : null;
    return {
      code: row.code,
      name: row.name,
      relevanceScore: row.relevanceScore,
      matchedTags: row.matchedTags,
      matchedText: row.matchedText,
      evidence: [tagEvidence, textEvidence, metricEvidence].filter(Boolean).join(' · '),
    };
  });

  if (!items.length) return { status: 'empty', items: [], note: '해석된 조건과 데이터가 함께 있는 ETF를 찾지 못했어요' };
  // 완화·적용 note 는 어떤 필수 조건이 걸려 있었는지 이름으로 밝힌다(정직성).
  const requiredLabels = [
    ...new Set(plannedTags.filter((tag) => tag.mode === 'required').map((tag) => tag.label)),
    ...textConstraints.filter((c) => c.mode === 'required').map((c) => c.value),
  ];
  const labelText = requiredLabels.join('·');
  const note = relaxed
    ? `필수 조건을 모두 만족하는 ETF가 없어 조건을 완화했어요${requiredLabels.length ? `(완화한 조건: ${labelText})` : ''}`
    : `${requiredLabels.length ? `필수 조건(${labelText})을 적용하고 ` : ''}질의 적합도 점수로 계산한 결과예요`;
  const result = { status, items, note };
  if (relaxed && requiredLabels.length) result.relaxedConditions = requiredLabels;
  return result;
}

function scoreQueryPlanRows(context, plannedTags, textConstraints, marketByCode, relaxRequired) {
  const requiredByFacet = new Map();
  for (const tag of plannedTags.filter((item) => item.mode === 'required')) {
    if (!requiredByFacet.has(tag.facet)) requiredByFacet.set(tag.facet, []);
    requiredByFacet.get(tag.facet).push(tag);
  }

  const tagEtfs = context.tagUniverse?.etfs || {};
  const searchIndex = context.searchIndex || null;
  // 텍스트 조건이 있으면 태그 유니버스 + 검색 인덱스의 합집합을 순회한다(태그 없는 ETF도 텍스트로 찾기 위함).
  const codes = textConstraints.length && searchIndex
    ? new Set([...Object.keys(tagEtfs), ...searchIndex.keys()])
    : Object.keys(tagEtfs);

  const rows = [];
  for (const code of codes) {
    const entry = tagEtfs[code];
    const etfTags = new Map(((entry && entry.tags) || []).map((tag) => [tag.tagId, tag]));
    if (plannedTags.some((tag) => tag.mode === 'excluded' && etfTags.has(tag.tagId))) continue;

    // 텍스트 조건 평가 (excluded 는 완화와 무관하게 항상 제외).
    const normEntry = searchIndex ? normalizeSearchEntry(searchIndex.get(code)) : {};
    const matchedText = [];
    let textWeighted = 0;
    let textTotal = 0;
    let excludedByText = false;
    let requiredTextOk = true;
    for (const constraint of textConstraints) {
      const m = matchTextConstraint(normEntry, constraint, constraint._terms);
      if (constraint.mode === 'excluded') {
        if (m) excludedByText = true;
        continue;
      }
      const weight = constraint.mode === 'required' ? TEXT_REQUIRED_WEIGHT : TEXT_PREFERRED_WEIGHT;
      textTotal += weight;
      if (m) {
        textWeighted += weight * m.fieldScore;
        matchedText.push(m);
      } else if (constraint.mode === 'required') {
        requiredTextOk = false;
      }
    }
    if (excludedByText) continue;

    if (!relaxRequired) {
      // 개념 = 태그 OR sector 텍스트 폴백. 두 방식 중 하나라도 충족하면 그 facet 은 만족.
      const requiredTagSatisfied = [...requiredByFacet.values()].every((group) =>
        group.some((tag) => etfTags.has(tag.tagId) || tagFallbackContribution(tag, normEntry))
      );
      if (!requiredTagSatisfied) continue;
      if (!requiredTextOk) continue;
    }

    const matchedTags = [];
    let weightedScore = 0;
    let totalWeight = 0;

    for (const group of requiredByFacet.values()) {
      totalWeight += Math.max(...group.map((tag) => tag.queryScore));
      const tagBest = group
        .map((planned) => buildTagContribution(planned, etfTags.get(planned.tagId)))
        .filter(Boolean)
        .sort((a, b) => b.contribution - a.contribution)[0];
      if (tagBest) {
        weightedScore += tagBest.contribution;
        matchedTags.push(tagBest);
        continue;
      }
      // 태그 근거가 없으면 sector 텍스트 폴백으로 개념 충족(텍스트 근거로 표시).
      const fbBest = group
        .map((planned) => tagFallbackContribution(planned, normEntry))
        .filter(Boolean)
        .sort((a, b) => b.contribution - a.contribution)[0];
      if (fbBest) {
        weightedScore += fbBest.contribution;
        matchedText.push(fbBest.match);
      }
    }

    for (const planned of plannedTags.filter((tag) => tag.mode === 'preferred')) {
      totalWeight += planned.queryScore;
      const matched = buildTagContribution(planned, etfTags.get(planned.tagId));
      if (!matched) continue;
      weightedScore += matched.contribution;
      matchedTags.push(matched);
    }
    // 태그 근거도 텍스트 근거도 없으면 후보가 아니다.
    if (!matchedTags.length && !matchedText.length) continue;
    matchedTags.sort((a, b) => b.contribution - a.contribution);

    const combinedWeighted = weightedScore + textWeighted;
    const combinedTotal = totalWeight + textTotal;
    rows.push({
      code,
      name: resolveName(context, code, normEntry.officialName?.raw),
      market: marketByCode.get(code) || null,
      matchedTags,
      matchedText,
      relevanceScore: combinedTotal ? Math.round((combinedWeighted / combinedTotal) * 100) : 0,
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
