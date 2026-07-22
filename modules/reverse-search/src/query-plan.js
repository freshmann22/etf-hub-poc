const TAG_MODES = new Set(['required', 'preferred', 'excluded']);
const SORT_FIELDS = new Set(['volume', 'tradingValue', 'return1m', 'volatilityScore', 'totalFee']);

// 보조 텍스트 검색 — taxonomy 에 없는 의미(국가·상품 특성 등)를 ETF 정본 텍스트 근거로 찾기 위한 계약.
// 태그와 달리 "검증 가능한 출처 필드"에서만 exact/substring 근거를 사용한다(embedding 유사도 아님).
export const TEXT_CONSTRAINT_FIELDS = ['officialName', 'benchmarkName', 'investmentObjective'];

// sector 개념의 tag↔text 폴백 — taxonomy 에서 sector 태그가 국내 종목에만 붙고 해외 ETF 에는
// 빠진 gap(예: 미국 반도체 ETF 는 region.us 만 있고 sector.semiconductor 는 없음)을 메운다.
// 개념은 "태그가 있거나 이름/기초지수에 텍스트 근거가 있으면" 충족된 것으로 본다.
// alias 는 부분문자열 오탐을 피하려고 충분히 구별되는 단어만 둔다('ev'·'ai' 같은 짧은 토큰 금지).
// alias 는 실데이터 검증(scripts 프로브)으로 부분문자열 오탐을 배제한 표기만 채택한다.
// 배제 예: '수소'(→필수소비재), '칩/chip'(→블루칩), '소부장'(sector 교차), '우주'(과다매칭).
export const TAG_TEXT_FALLBACKS = {
  'sector.semiconductor': { value: '반도체', aliases: ['Semiconductor'] },
  'sector.ev_battery': { value: '2차전지', aliases: ['이차전지', '전기차', '배터리', 'Battery', '리튬', 'Lithium'] },
  'sector.clean_energy': { value: '신재생', aliases: ['클린에너지', '태양광', '풍력', 'Renewable', 'Clean Energy', 'Solar', 'Hydrogen'] },
  'sector.autonomous_mobility': { value: '자율주행', aliases: ['모빌리티', 'Autonomous', 'Mobility'] },
  'sector.aerospace_defense': { value: '방산', aliases: ['우주항공', '항공우주', 'Defense', 'Aerospace', 'Space'] },
  'sector.shipbuilding': { value: '조선', aliases: ['Shipbuilding', 'Shipbuilder'] },
  'sector.nuclear_power': { value: '원자력', aliases: ['원전', 'Nuclear', 'Uranium', 'SMR', '우라늄'] },
  'sector.robotics': { value: '로봇', aliases: ['로보틱스', 'Robot', 'Robotics', '휴머노이드', 'Humanoid'] },
  'sector.healthcare_bio_pharma': { value: '바이오', aliases: ['헬스케어', '제약', 'Healthcare', 'Biotech', 'Pharma', '의료'] },
};
const TEXT_FIELD_SET = new Set(TEXT_CONSTRAINT_FIELDS);
const MAX_TEXT_CONSTRAINTS = 4;
const MAX_TEXT_ALIASES = 8;
const MAX_TEXT_VALUE_LEN = 40;

// 제어문자 제거 + 트림. 정규화(소문자/공백제거)는 검색 시점(ranker)에서 수행하므로 여기선 원문 가독성을 유지한다.
function sanitizeTextValue(raw) {
  if (typeof raw !== 'string') return '';
  const stripped = [...raw].filter((ch) => { const cp = ch.codePointAt(0); return cp >= 32 && cp !== 127; }).join('');
  return stripped.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_VALUE_LEN);
}

function normalizeTextConstraints(candidate, warnings) {
  const rawList = Array.isArray(candidate?.textConstraints) ? candidate.textConstraints : [];
  const out = [];
  const seen = new Set();
  for (const raw of rawList.slice(0, MAX_TEXT_CONSTRAINTS)) {
    const value = sanitizeTextValue(raw?.value);
    if (!value) {
      warnings.push(`invalid_text_value:${String(raw?.value || '').slice(0, 20)}`);
      continue;
    }
    const mode = TAG_MODES.has(raw?.mode) ? raw.mode : 'required';
    const aliasSet = new Map();
    for (const aliasRaw of Array.isArray(raw?.aliases) ? raw.aliases.slice(0, MAX_TEXT_ALIASES) : []) {
      const alias = sanitizeTextValue(aliasRaw);
      if (alias) aliasSet.set(alias.toLowerCase(), alias);
    }
    let fields = Array.isArray(raw?.fields) ? raw.fields.filter((f) => TEXT_FIELD_SET.has(f)) : [];
    if (!fields.length) fields = [...TEXT_CONSTRAINT_FIELDS];
    else fields = [...new Set(fields)];
    const dedupeKey = `${mode}::${value.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ value, aliases: [...aliasSet.values()], mode, fields });
  }
  return out;
}

export function createTaxonomyIndex(taxonomy) {
  return new Map(
    (taxonomy?.tags || [])
      .filter((tag) => tag?.enabled !== false && tag?.id)
      .map((tag) => [tag.id, { tagId: tag.id, facet: tag.facet, label: tag.label }])
  );
}

export function buildRuleQueryPlan(parsed) {
  const tags = [];
  for (const group of parsed?.tagGroups || []) {
    const queryScore = group.tagIds.length === 1 ? 1 : 0.7;
    for (const tagId of group.tagIds) {
      tags.push({
        tagId,
        queryScore,
        mode: 'required',
        reason: `${group.matchedKeyword} 키워드 매칭`,
      });
    }
  }

  return {
    version: '1.0',
    intent: parsed?.intent || 'UNKNOWN',
    tags,
    textConstraints: Array.isArray(parsed?.textConstraints) ? parsed.textConstraints : [],
    sort: parsed?.sortField
      ? { field: parsed.sortField, direction: parsed.sortDir || 'desc', label: parsed.sortLabel || parsed.sortField }
      : null,
  };
}

// warnings(검증 중 버려진 조건)를 사용자에게 보여줄 짧은 한국어 요약으로 변환한다.
// 지원하지 못한 핵심 조건을 조용히 삼키지 않기 위한 정직성 장치. 해당 없으면 null.
const WARNING_LABELS = {
  unknown_tag: '지원하지 않는 태그',
  invalid_sort: '지원하지 않는 정렬',
  invalid_text_value: '잘못된 텍스트 조건',
};
export function summarizeDroppedConditions(warnings) {
  const kinds = [];
  for (const w of Array.isArray(warnings) ? warnings : []) {
    const kind = String(w).split(':')[0];
    if (WARNING_LABELS[kind] && !kinds.includes(WARNING_LABELS[kind])) kinds.push(WARNING_LABELS[kind]);
  }
  return kinds.length ? kinds.join(', ') : null;
}

export function validateQueryPlan(candidate, taxonomyIndex) {
  const warnings = [];
  const deduped = new Map();

  for (const raw of Array.isArray(candidate?.tags) ? candidate.tags.slice(0, 12) : []) {
    const canonical = taxonomyIndex.get(raw?.tagId);
    if (!canonical) {
      warnings.push(`unknown_tag:${String(raw?.tagId || '')}`);
      continue;
    }
    const score = Number(raw.queryScore);
    if (!Number.isFinite(score)) {
      warnings.push(`invalid_score:${canonical.tagId}`);
      continue;
    }
    const mode = TAG_MODES.has(raw.mode) ? raw.mode : 'preferred';
    const normalized = {
      ...canonical,
      queryScore: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
      mode,
      reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 120) : '',
    };
    // sector 개념이면 tagId 기준으로 텍스트 폴백을 자동 부착(규칙·LLM 경로 공통).
    const fb = TAG_TEXT_FALLBACKS[canonical.tagId];
    if (fb) normalized.textFallback = { value: fb.value, aliases: [...fb.aliases], fields: [...TEXT_CONSTRAINT_FIELDS] };
    const previous = deduped.get(normalized.tagId);
    if (!previous || normalized.queryScore > previous.queryScore) deduped.set(normalized.tagId, normalized);
  }

  let sort = null;
  if (candidate?.sort?.field && SORT_FIELDS.has(candidate.sort.field)) {
    sort = {
      field: candidate.sort.field,
      direction: candidate.sort.direction === 'asc' ? 'asc' : 'desc',
      label: typeof candidate.sort.label === 'string' ? candidate.sort.label.slice(0, 30) : candidate.sort.field,
    };
  } else if (candidate?.sort?.field) {
    warnings.push(`invalid_sort:${candidate.sort.field}`);
  }

  const textConstraints = normalizeTextConstraints(candidate, warnings);

  return {
    plan: {
      version: '1.0',
      intent: typeof candidate?.intent === 'string' ? candidate.intent : 'UNKNOWN',
      tags: [...deduped.values()].sort((a, b) => b.queryScore - a.queryScore || a.tagId.localeCompare(b.tagId)),
      textConstraints,
      sort,
    },
    warnings,
  };
}
