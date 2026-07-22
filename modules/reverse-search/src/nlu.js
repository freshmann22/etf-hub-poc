// 질의 해석기 — 순수 함수, DOM/fetch 없음(노드 단위테스트 가능).
// PoC 단계는 규칙+사전 기반(dictionary.js). 나중에 실시간 LLM 해석으로 교체하더라도
// 이 함수의 반환 계약(intent + payload)만 지키면 ranker.js/app.js 는 변경 없이 재사용된다.
import { normalizeText } from './text.js';
import {
  STOCK_ALIASES,
  TAG_KEYWORD_GROUPS,
  SORT_KEYWORD_GROUPS,
  DIR_ASC_HINTS,
  TEXT_CONSTRAINT_KEYWORDS,
  TEXT_NEGATION_HINTS,
} from './dictionary.js';

function findStockMatch(normalizedQuery, stockNameIndex) {
  const candidates = [];
  for (const [key, entry] of stockNameIndex.entries()) {
    candidates.push({ matchText: key, code: entry.code, name: entry.name });
  }
  for (const alias of Object.keys(STOCK_ALIASES)) {
    const canonical = STOCK_ALIASES[alias];
    const entry = stockNameIndex.get(normalizeText(canonical));
    if (entry) candidates.push({ matchText: normalizeText(alias), code: entry.code, name: entry.name });
  }
  candidates.sort((a, b) => b.matchText.length - a.matchText.length);
  for (const c of candidates) {
    if (c.matchText && normalizedQuery.includes(c.matchText)) return c;
  }
  return null;
}

function findTagGroups(normalizedQuery) {
  const flat = [];
  TAG_KEYWORD_GROUPS.forEach((group, groupIdx) => {
    group.keywords.forEach((kw) => flat.push({ keyword: normalizeText(kw), groupIdx }));
  });
  flat.sort((a, b) => b.keyword.length - a.keyword.length);

  let working = normalizedQuery;
  const matchedGroupIdx = new Set();
  for (const { keyword, groupIdx } of flat) {
    if (matchedGroupIdx.has(groupIdx) || !keyword) continue;
    if (working.includes(keyword)) {
      matchedGroupIdx.add(groupIdx);
      working = working.split(keyword).join(' ');
    }
  }
  return [...matchedGroupIdx].map((idx) => ({
    tagIds: TAG_KEYWORD_GROUPS[idx].tagIds,
    matchedKeyword: TAG_KEYWORD_GROUPS[idx].keywords[0],
  }));
}

// taxonomy 밖 의미(국가 등)를 텍스트 조건으로 추출한다. 매칭된 키워드는 residual 에서 소비해
// 이후 태그 매칭(예: '인도네시아' 안의 '인도')이 오작동하지 않게 한다. 긴 키워드 우선.
function findTextConstraints(normalizedQuery) {
  const flat = [];
  TEXT_CONSTRAINT_KEYWORDS.forEach((group, groupIdx) => {
    group.keywords.forEach((kw) => flat.push({ keyword: normalizeText(kw), groupIdx }));
  });
  flat.sort((a, b) => b.keyword.length - a.keyword.length);

  const excluded = TEXT_NEGATION_HINTS.some((h) => normalizedQuery.includes(normalizeText(h)));
  const mode = excluded ? 'excluded' : 'required';

  let working = normalizedQuery;
  const matchedGroupIdx = new Set();
  for (const { keyword, groupIdx } of flat) {
    if (matchedGroupIdx.has(groupIdx) || !keyword) continue;
    if (working.includes(keyword)) {
      matchedGroupIdx.add(groupIdx);
      working = working.split(keyword).join(' ');
    }
  }
  const constraints = [...matchedGroupIdx].map((idx) => ({
    value: TEXT_CONSTRAINT_KEYWORDS[idx].value,
    aliases: TEXT_CONSTRAINT_KEYWORDS[idx].aliases || [],
    mode,
    fields: ['officialName', 'benchmarkName', 'investmentObjective'],
  }));
  return { constraints, residual: working };
}

function findSortMetric(normalizedQuery) {
  const flat = [];
  SORT_KEYWORD_GROUPS.forEach((group, groupIdx) => {
    group.keywords.forEach((kw) => flat.push({ keyword: normalizeText(kw), groupIdx }));
  });
  flat.sort((a, b) => b.keyword.length - a.keyword.length);
  for (const { keyword, groupIdx } of flat) {
    if (keyword && normalizedQuery.includes(keyword)) {
      const group = SORT_KEYWORD_GROUPS[groupIdx];
      const dir = DIR_ASC_HINTS.some((h) => normalizedQuery.includes(normalizeText(h))) ? 'asc' : 'desc';
      return { field: group.field, label: group.label, dir };
    }
  }
  return null;
}

// stockNameIndex: adapters.buildStockNameIndex() 의 반환값(Map).
export function parseQuery(rawQuery, stockNameIndex) {
  const raw = String(rawQuery || '').trim();
  const normalizedQuery = normalizeText(raw);
  if (!normalizedQuery) return { raw, intent: 'EMPTY' };

  const stockMatch = findStockMatch(normalizedQuery, stockNameIndex || new Map());
  if (stockMatch) {
    return { raw, intent: 'STOCK_WEIGHT', stockCode: stockMatch.code, stockName: stockMatch.name };
  }

  // 텍스트 조건을 먼저 소비한 뒤 residual 로 태그/정렬을 해석한다.
  const { constraints: textConstraints, residual } = findTextConstraints(normalizedQuery);
  const tagGroups = findTagGroups(residual);
  const sort = findSortMetric(residual);
  const hasText = textConstraints.length > 0;

  if (tagGroups.length > 0 && sort) {
    return { raw, intent: 'COMPOSITE', tagGroups, textConstraints, sortField: sort.field, sortLabel: sort.label, sortDir: sort.dir };
  }
  if (tagGroups.length > 0) {
    return { raw, intent: 'TAG_MATCH', tagGroups, textConstraints };
  }
  if (hasText && sort) {
    return { raw, intent: 'TEXT_MATCH', tagGroups: [], textConstraints, sortField: sort.field, sortLabel: sort.label, sortDir: sort.dir };
  }
  if (hasText) {
    return { raw, intent: 'TEXT_MATCH', tagGroups: [], textConstraints };
  }
  if (sort) {
    return { raw, intent: 'MARKET_SORT', sortField: sort.field, sortLabel: sort.label, sortDir: sort.dir };
  }
  return { raw, intent: 'UNKNOWN' };
}
