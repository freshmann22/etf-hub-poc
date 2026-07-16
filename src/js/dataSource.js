// 데이터 소스 로더 (브라우저 전용).
// 화면은 서버 API(/api/bundle)에서 데이터를 받고, 서버가 없거나(파일 직접 열람) 응답이
// 불완전하면 로컬 fixture(./data.js)로 폴백한다. 두 경로 모두 동일한 named collection 을 반환한다.
// → 서버(mock/live/hybrid)로 실데이터를 공급받으면서도, 오프라인·정적 열람에서 화면이 깨지지 않는다.
import {
  etfs,
  themes,
  stocks,
  holdings,
  contents,
  marketSummaryByPeriod,
  comparisonSets,
} from './data.js';

const BUNDLE_URL = '/api/bundle';

// 로컬 fixture 를 표준 collection 형태로.
function fixtureData() {
  return {
    etfs,
    themes,
    stocks,
    holdings,
    contents,
    marketSummaryByPeriod,
    comparisonSets,
    meta: { dataMode: 'fixture', structureSource: 'fixture', sources: ['fixture'] },
  };
}

// 서버 번들(원시 키) → 화면 collection.
function mapBundle(b) {
  return {
    etfs: b.etfsRaw,
    themes: b.themesRaw,
    stocks: b.stocksRaw,
    holdings: b.holdingsRaw,
    contents: b.contentsRaw,
    marketSummaryByPeriod: b.marketSummaryByPeriod,
    comparisonSets: b.comparisonSetsRaw,
    meta: b.meta || null,
  };
}

// 화면이 요구하는 모든 collection 이 존재하는지(부분 응답이면 fixture 로 폴백).
function isComplete(d) {
  return (
    d &&
    Array.isArray(d.etfs) && d.etfs.length > 0 &&
    Array.isArray(d.themes) && d.themes.length > 0 &&
    Array.isArray(d.stocks) &&
    Array.isArray(d.holdings) &&
    Array.isArray(d.contents) &&
    d.marketSummaryByPeriod &&
    Array.isArray(d.comparisonSets)
  );
}

/**
 * 데이터 로드. 항상 완전한 collection 을 resolve 한다(실패해도 fixture 로).
 */
export async function loadData() {
  // 정적 파일 직접 열람(file://) 또는 fetch 미지원 환경 → 즉시 fixture.
  const isFile = typeof location !== 'undefined' && location.protocol === 'file:';
  if (isFile || typeof fetch !== 'function') {
    return fixtureData();
  }

  try {
    const res = await fetch(BUNDLE_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return fixtureData();
    const bundle = await res.json();
    const mapped = mapBundle(bundle);
    return isComplete(mapped) ? mapped : fixtureData();
  } catch {
    // 네트워크/파싱 실패 → 정직하게 fixture 로 폴백(화면 유지).
    return fixtureData();
  }
}

export default loadData;
