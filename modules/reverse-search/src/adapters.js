// 데이터 어댑터 — 기존 파이프라인 산출물을 읽기 전용으로 fetch 만 한다.
// UI/로직은 이 파일이 반환하는 모양만 알고, 원본 JSON 스키마·경로를 직접 알지 못한다.
// 저장소 루트가 정적으로 서빙되며, 시황 정렬은 /api/bundle 공통 계약을 사용한다.
import { normalizeText } from './text.js';

const TAG_MAP_URL = '/data/tagging/etf-filter-map.json';
const MASTER_URL = '/data/tagging/etf-universe-index-names.json';
const HOLDINGS_URL = '/public/data/etf-holdings.json';
const SEARCH_INDEX_URL = '/public/data/reverse-search-index.json';
const BUNDLE_URL = '/api/bundle';

async function fetchJson(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadTagUniverse(fetchImpl = fetch) {
  const payload = await fetchJson(TAG_MAP_URL, fetchImpl);
  if (!payload || !payload.etfs) return { taxonomyVersion: null, etfs: {} };
  return { taxonomyVersion: payload.taxonomyVersion || null, etfs: payload.etfs };
}

export async function loadEtfMaster(fetchImpl = fetch) {
  const payload = await fetchJson(MASTER_URL, fetchImpl);
  const byCode = {};
  for (const item of payload?.items || []) {
    if (item?.etfCode) byCode[item.etfCode] = { code: item.etfCode, name: item.name, indexName: item.indexName || null };
  }
  return byCode;
}

export async function loadHoldingsUniverse(fetchImpl = fetch) {
  const payload = await fetchJson(HOLDINGS_URL, fetchImpl);
  return payload?.etfs || {};
}

// 시황 정렬 질의용. 커버리지가 좁다(큐레이션 종목 + Toss 실시간 연동 종목) — 정직하게 없는 값은 null 로 둔다.
export async function loadMarketSnapshot(fetchImpl = fetch) {
  const payload = await fetchJson(BUNDLE_URL, fetchImpl);
  return (payload?.etfsRaw || []).map((e) => ({
    code: e.code,
    name: e.name,
    volume: typeof e.volume === 'number' ? e.volume : null,
    tradingValue: typeof e.tradingValue === 'number' ? e.tradingValue : null,
    return1m: typeof e.return1m === 'number' ? e.return1m : null,
    volatilityScore: typeof e.volatilityScore === 'number' ? e.volatilityScore : null,
    totalFee: typeof e.totalFee === 'number' ? e.totalFee : null,
  }));
}

// 보조 텍스트 검색 인덱스 — scripts/build-reverse-search-index.mjs 가 canonical metadata 에서 생성한 정본.
// code -> { officialName, benchmarkName, investmentObjective }(존재하는 필드만). 값은 원문(정규화는 ranker 담당).
export function buildSearchIndexMap(payload) {
  const map = new Map();
  for (const item of payload?.etfs || []) {
    if (!item?.code) continue;
    const entry = {};
    for (const field of ['officialName', 'benchmarkName', 'investmentObjective']) {
      if (typeof item[field] === 'string' && item[field].trim()) entry[field] = item[field];
    }
    map.set(item.code, entry);
  }
  return map;
}

export async function loadSearchIndex(fetchImpl = fetch) {
  const payload = await fetchJson(SEARCH_INDEX_URL, fetchImpl);
  return buildSearchIndexMap(payload);
}

// 순수 함수 — 네트워크 없이 단위테스트 가능. 종목명(정규화) -> {code, name} 정본 사전.
// 동일 정규화명이 여러 티커에 걸리는 경우는 실무상 드물어 첫 등장을 우선한다.
export function buildStockNameIndex(holdingsUniverse) {
  const index = new Map();
  for (const etfCode of Object.keys(holdingsUniverse || {})) {
    for (const h of holdingsUniverse[etfCode].holdings || []) {
      const key = normalizeText(h.name);
      if (key && !index.has(key)) index.set(key, { code: h.ticker, name: h.name });
    }
  }
  return index;
}

export async function loadReverseSearchContext(fetchImpl = fetch) {
  const [tagUniverse, master, holdingsUniverse, marketSnapshot, searchIndex] = await Promise.all([
    loadTagUniverse(fetchImpl),
    loadEtfMaster(fetchImpl),
    loadHoldingsUniverse(fetchImpl),
    loadMarketSnapshot(fetchImpl),
    loadSearchIndex(fetchImpl),
  ]);
  return {
    tagUniverse,
    master,
    holdingsUniverse,
    marketSnapshot,
    searchIndex,
    stockNameIndex: buildStockNameIndex(holdingsUniverse),
  };
}
