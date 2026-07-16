// 질의 해석기 — 순수 함수, DOM/fetch 없음(노드 단위테스트 가능).
// PoC 단계는 규칙+사전 기반(dictionary.js). 나중에 실시간 LLM 해석으로 교체하더라도
// 이 함수의 반환 계약(intent + payload)만 지키면 ranker.js/app.js 는 변경 없이 재사용된다.
import { normalizeText } from './text.js';
import {
  STOCK_ALIASES,
  TAG_KEYWORD_GROUPS,
  SORT_KEYWORD_GROUPS,
  DIR_ASC_HINTS,
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

  const tagGroups = findTagGroups(normalizedQuery);
  const sort = findSortMetric(normalizedQuery);

  if (tagGroups.length > 0 && sort) {
    return { raw, intent: 'COMPOSITE', tagGroups, sortField: sort.field, sortLabel: sort.label, sortDir: sort.dir };
  }
  if (tagGroups.length > 0) {
    return { raw, intent: 'TAG_MATCH', tagGroups };
  }
  if (sort) {
    return { raw, intent: 'MARKET_SORT', sortField: sort.field, sortLabel: sort.label, sortDir: sort.dir };
  }
  return { raw, intent: 'UNKNOWN' };
}
