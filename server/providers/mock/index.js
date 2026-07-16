// Mock provider — 로컬 fixture(src/js/data.js)에서 모든 데이터를 제공한다.
// 전체 capability 지원, 항상 available. live/hybrid 의 fallback 으로도 사용된다.
import {
  etfs,
  themes,
  holdings,
  stocks,
  contents,
  marketSummaryByPeriod,
  comparisonSets,
} from '../../../src/js/data.js';
import { BaseProvider, CAPABILITIES } from '../types.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { Status } from '../../lib/errors.js';
import { normalizeCode } from '../../lib/normalize.js';

const FIXTURE_ASOF = marketSummaryByPeriod['1d'].asOf; // '2026-07-10T15:30:00+09:00'
const stockById = new Map(stocks.map((s) => [s.id, s]));
const etfByCode = new Map(etfs.map((e) => [e.code, e]));

// data.js ETF → 공통 EtfSummary(원시 숫자). 표시 포매팅 없음.
function toSummary(e) {
  return {
    code: e.code,
    standardCode: 'KR' + e.code, // 표준코드(ISIN 유사) — mock 파생값
    name: e.name,
    issuer: e.issuer,
    indexName: null,
    listingDate: null,
    etfType: e.category,
    region: /미국|나스닥|차이나|중국/.test(e.name) ? 'overseas' : 'domestic',
    assetClass: e.category,
    theme: e.themeId,
    price: e.currentPrice,
    change:
      typeof e.currentPrice === 'number' && typeof e.changeRate1d === 'number'
        ? Math.round(e.currentPrice * (e.changeRate1d / 100))
        : null,
    changeRate: e.changeRate1d,
    volume: null,
    tradingValue: e.tradingValue, // 단위: 억원 (fixture 규약)
    tradingValueChangeRate: e.tradingValueChangeRate,
    marketCap: e.netAssets,
    netAssets: e.netAssets,
    nav: e.currentPrice, // mock: NAV≈종가
    inav: e.currentPrice,
    premiumDiscountRate: 0,
    trackingError: null,
    expenseRatio: e.totalFee,
    volatilityScore: e.volatilityScore,
    riskTags: e.riskTags,
    summary: e.summary,
  };
}

function meta(overrides = {}) {
  return makeMeta({ source: 'mock', asOfDate: FIXTURE_ASOF, status: Status.OK, quality: 0.5, ...overrides });
}

export class MockProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'mock', config });
    this.capabilities = CAPABILITIES.reduce((acc, k) => ((acc[k] = true), acc), {});
  }

  isAvailable() {
    return true; // fixture 는 항상 사용 가능
  }

  async getEtfList() {
    return envelope(etfs.map(toSummary), meta());
  }

  async getEtfSummary(code) {
    const e = etfByCode.get(normalizeCode(code) || code);
    if (!e) return envelope(null, meta({ status: Status.UNAVAILABLE }));
    return envelope(toSummary(e), meta());
  }

  async getEtfPrice(code) {
    const e = etfByCode.get(normalizeCode(code) || code);
    if (!e) return envelope(null, meta({ status: Status.UNAVAILABLE }));
    const s = toSummary(e);
    return envelope(
      {
        code: e.code,
        price: s.price,
        change: s.change,
        changeRate: s.changeRate,
        volume: s.volume,
        tradingValue: s.tradingValue,
        marketCap: s.marketCap,
        netAssets: s.netAssets,
        nav: s.nav,
        inav: s.inav,
        premiumDiscountRate: s.premiumDiscountRate,
        trackingError: s.trackingError,
      },
      meta()
    );
  }

  async getEtfHoldings(code) {
    const e = etfByCode.get(normalizeCode(code) || code);
    if (!e) return envelope([], meta({ status: Status.UNAVAILABLE }));
    const rows = holdings
      .filter((h) => h.etfId === e.id)
      .sort((a, b) => a.rank - b.rank)
      .map((h) => {
        const st = stockById.get(h.stockId);
        return {
          stockCode: st ? st.code : null,
          stockName: st ? st.name : null,
          weight: h.weight,
          shares: null,
          marketValue: null,
          rank: h.rank,
          asOfDate: FIXTURE_ASOF,
        };
      });
    return envelope(rows, meta());
  }

  async getEtfPerformance(code) {
    const e = etfByCode.get(normalizeCode(code) || code);
    if (!e) return envelope(null, meta({ status: Status.UNAVAILABLE }));
    return envelope(
      {
        code: e.code,
        return1d: e.changeRate1d,
        return1w: e.return1w,
        return1m: e.return1m,
        return3m: null,
        return6m: null,
        return1y: null,
      },
      meta()
    );
  }

  async getEtfDistributions(code) {
    // mock: 분배금 fixture 미보유 → partial(빈 배열)로 정직하게 표기.
    const e = etfByCode.get(normalizeCode(code) || code);
    if (!e) return envelope([], meta({ status: Status.UNAVAILABLE }));
    return envelope([], meta({ status: Status.PARTIAL }));
  }

  async getEtfDisclosures(code) {
    const e = etfByCode.get(normalizeCode(code) || code);
    if (!e) return envelope([], meta({ status: Status.UNAVAILABLE }));
    const rows = contents
      .filter((c) => c.relatedEtfIds.includes(e.id))
      .map((c) => ({
        id: c.id,
        disclosureType: c.type,
        title: c.title,
        summary: c.summary,
        date: c.publishedAt,
        url: null,
        source: c.source,
      }));
    return envelope(rows, meta());
  }

  // 화면 초기 로드용: UI 번들 전체를 fixture 그대로 노출(어댑터가 UI 형태로 변환).
  async getBundle() {
    return {
      etfsRaw: etfs,
      themesRaw: themes,
      holdingsRaw: holdings,
      stocksRaw: stocks,
      contentsRaw: contents,
      comparisonSetsRaw: comparisonSets,
      marketSummaryByPeriod,
      asOfDate: FIXTURE_ASOF,
      source: 'mock',
    };
  }
}

export default MockProvider;
