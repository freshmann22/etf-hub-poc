// ETF 데이터 서비스 — provider 오케스트레이션.
// 모드(mock/live/hybrid) × capability 우선순위로 실데이터를 조회하고, TTL 캐시로 감싼다.
// 핵심 원칙: 데이터를 지어내지 않는다. live 에서 실패하면 정직하게 unavailable/partial 로 표기하고,
//           hybrid 에서만 mock 으로 폴백하되 meta 에 폴백 사실을 남긴다.
import { createRegistry } from '../providers/registry.js';
import { config as defaultConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { envelope, makeMeta } from '../schemas/etf.js';
import { Status, classifyError } from '../lib/errors.js';
import { normalizeEtfCode } from '../lib/normalize.js';

// capability 별 실(live) provider 우선순위. 위에서부터 available+supports 인 첫 provider 를 시도.
// mock 은 여기 넣지 않는다(모드 로직에서 별도 처리).
const PREFERENCE = Object.freeze({
  getEtfList: ['publicdata', 'krx'],
  getEtfSummary: ['toss', 'broker', 'krx', 'publicdata'],
  getEtfPrice: ['toss', 'broker', 'krx'],
  getEtfHoldings: ['issuer', 'seibro'],
  getEtfPerformance: [], // 실 provider 미지원 → hybrid 는 mock, live 는 unavailable
  getEtfDistributions: ['issuer', 'seibro'],
  getEtfDisclosures: ['dart', 'kind'],
});

// capability → 캐시 TTL 키(config.cache)
const TTL_KEY = Object.freeze({
  getEtfList: 'priceTtlSec',
  getEtfSummary: 'priceTtlSec',
  getEtfPrice: 'priceTtlSec',
  getEtfHoldings: 'holdingsTtlSec',
  getEtfPerformance: 'priceTtlSec',
  getEtfDistributions: 'holdingsTtlSec',
  getEtfDisclosures: 'metadataTtlSec',
});

// data 가 "비었는지"(폴백 판단용). null / 빈 배열 을 빈 것으로 본다.
function isEmptyData(data) {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

export function createEtfService({ config = defaultConfig, registry, cache, now } = {}) {
  const reg = registry || createRegistry(config);
  const ttlCache = cache || new TtlCache(now ? { now } : {});
  const mock = reg.get('mock');

  const ttlMsFor = (cap) => {
    const key = TTL_KEY[cap] || 'priceTtlSec';
    return (config.cache[key] || 0) * 1000;
  };
  const swrMs = () => (config.cache.swrSec || 0) * 1000;

  // 주어진 capability 에 대해 우선순위대로 실 provider 를 시도한다.
  // 반환: { env, providerId } | null(시도할 provider 없음 또는 전부 실패)
  async function tryLiveProviders(cap, args) {
    const order = PREFERENCE[cap] || [];
    for (const id of order) {
      const p = reg.get(id);
      if (!p || !p.isAvailable() || !p.supports(cap)) continue;
      try {
        const env = await p[cap](...args);
        // 실 provider 가 available 했지만 빈 결과를 정상 반환한 경우도 유효한 응답으로 본다
        // (단, 다음 provider 로 보강 기회를 주기 위해 빈 데이터는 계속 진행).
        if (env && !isEmptyData(env.data)) {
          return { env, providerId: id };
        }
        // 빈 데이터: 마지막 후보라면 그대로 반환, 아니면 다음 provider 시도.
      } catch (err) {
        // 실패는 삼키고 다음 provider 로. 마지막까지 실패하면 아래에서 처리.
        void classifyError(err);
        continue;
      }
    }
    return null;
  }

  // 캐시로 감싼 단일 capability 조회. 모드별 정책 적용.
  async function resolveCapability(cap, args, { cacheKey }) {
    const key = `${config.mode}:${cap}:${cacheKey}`;
    const { value } = await ttlCache.resolve(
      key,
      () => computeCapability(cap, args),
      { ttlMs: ttlMsFor(cap), swrMs: swrMs() }
    );
    return value;
  }

  async function computeCapability(cap, args) {
    if (config.mode === 'mock') {
      return mock[cap](...args);
    }

    const live = await tryLiveProviders(cap, args);
    if (live) return live.env;

    if (config.mode === 'live') {
      // live 는 폴백하지 않는다 — 정직하게 unavailable.
      return envelope(cap === 'getEtfList' ? [] : null, makeMeta({
        source: 'none',
        status: Status.UNAVAILABLE,
        quality: 0,
      }));
    }

    // hybrid: mock 으로 폴백하되 폴백 사실을 meta 에 남긴다.
    const fb = await mock[cap](...args);
    return {
      data: fb.data,
      meta: { ...fb.meta, source: 'mock', fallback: true, status: fb.meta.status },
    };
  }

  return {
    config,
    registry: reg,
    cache: ttlCache,

    describe() {
      return {
        mode: config.mode,
        providers: reg.describeAll(),
      };
    },

    getEtfList() {
      return resolveCapability('getEtfList', [], { cacheKey: 'all' });
    },
    getEtfSummary(code) {
      const c = normalizeEtfCode(code);
      return resolveCapability('getEtfSummary', [c], { cacheKey: c });
    },
    getEtfPrice(code) {
      const c = normalizeEtfCode(code);
      return resolveCapability('getEtfPrice', [c], { cacheKey: c });
    },
    getEtfHoldings(code) {
      const c = normalizeEtfCode(code);
      return resolveCapability('getEtfHoldings', [c], { cacheKey: c });
    },
    getEtfPerformance(code) {
      const c = normalizeEtfCode(code);
      return resolveCapability('getEtfPerformance', [c], { cacheKey: c });
    },
    getEtfDistributions(code) {
      const c = normalizeEtfCode(code);
      return resolveCapability('getEtfDistributions', [c], { cacheKey: c });
    },
    getEtfDisclosures(code) {
      const c = normalizeEtfCode(code);
      return resolveCapability('getEtfDisclosures', [c], { cacheKey: c });
    },

    // 차트용 캔들(가격 추이). toss 가용 시 실 OHLC, 아니면 정직한 unavailable(빈 points).
    async getEtfCandles(code, opts = {}) {
      const c = normalizeEtfCode(code);
      const toss = reg.get('toss');
      if (toss && toss.isAvailable() && config.mode !== 'mock') {
        try {
          return await toss.getCandles(c, opts);
        } catch {
          /* 실패 → 아래 unavailable */
        }
      }
      return envelope(
        { code: c, interval: opts.interval === '1m' ? '1m' : '1d', points: [] },
        makeMeta({ source: 'none', status: Status.UNAVAILABLE, quality: 0 })
      );
    },

    /**
     * 화면 초기 로드용 UI 번들.
     * - 구조(테마·종목·구성관계·콘텐츠·비교셋·시장요약)는 fixture 스캐폴드를 사용한다
     *   (내부 마스터/뉴스 미연동 — 지어내지 않기 위함).
     * - config.bundleOverlay 가 켜지고 mock 모드가 아니면, 실 시세(list)를 종가/등락률에만
     *   덧입힌다(단위 호환 필드 한정). 덧입힘 범위/커버리지는 meta 에 정직하게 표기.
     */
    async getBundle() {
      const base = await mock.getBundle(); // fixture 원형 (source: 'mock')
      const overlayEnabled = !!config.bundleOverlay && config.mode !== 'mock';

      const meta = {
        dataMode: config.mode,
        structureSource: 'mock',
        overlay: { enabled: overlayEnabled, applied: false, matched: 0, total: base.etfsRaw.length, fields: [] },
        asOfDate: base.asOfDate,
        sources: ['mock'],
      };

      if (!overlayEnabled) {
        return { ...base, meta };
      }

      const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
      const mean = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null);
      const sum = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0)) : null);
      const pctOf = (cur, base_) => (isNum(cur) && isNum(base_) && base_ !== 0 ? Math.round(((cur - base_) / base_) * 10000) / 100 : null);

      const toss = reg.get('toss');
      const pd = reg.get('publicdata');
      const tossOn = !!(toss && toss.isAvailable());

      // --- 1) 유니버스 확장: 공공데이터(ETF 전종목)를 fixture 큐레이션에 병합 ---
      // 큐레이션(24종)은 테마·구성종목·비교셋 관계를 위해 보존/보강하고, 나머지 전종목은
      // thin ETF(테마·구성종목 없음)로 추가한다. 코드로 매칭.
      let pdRows = [];
      let universeSource = 'mock';
      let pdAsOf = null;
      if (pd && pd.isAvailable()) {
        try {
          const listEnv = await this.getEtfList(); // PREFERENCE: publicdata 우선
          if (Array.isArray(listEnv?.data) && listEnv.data.length && listEnv.meta.status !== Status.UNAVAILABLE) {
            pdRows = listEnv.data;
            universeSource = listEnv.meta.source; // 'publicdata'
            pdAsOf = listEnv.meta.asOfDate;
          }
        } catch { /* 실패 시 fixture 24종만 */ }
      }

      const fixtureCodes = new Set(base.etfsRaw.map((e) => e.code));
      const pdByCode = new Map(pdRows.map((r) => [r.code, r]));

      // 큐레이션 24종: 공공데이터로 순자산/NAV/기초지수/시총 보강 + 전일종가 보관.
      let curated = base.etfsRaw.map((e) => {
        const r = pdByCode.get(e.code);
        const merged = { ...e, _curated: true, _prevClose: r ? r.prevClose : null };
        if (r) {
          if (isNum(r.netAssets)) merged.netAssets = r.netAssets;
          if (isNum(r.nav)) merged.nav = r.nav;
          if (r.indexName) merged.indexName = r.indexName;
          if (isNum(r.marketCap)) merged.marketCap = r.marketCap;
        }
        return merged;
      });

      // 나머지 전종목: thin ETF(테마·구성종목 없음). 현재가/등락은 공공데이터 T+1 기본값.
      const thin = pdRows
        .filter((r) => !fixtureCodes.has(r.code))
        .map((r) => ({
          id: 'etf-' + r.code,
          code: r.code,
          name: r.name,
          issuer: null,
          category: null,
          themeId: null,
          currentPrice: r.prevClose,
          changeRate1d: r.changeRate,
          return1w: null,
          return1m: null,
          tradingValue: r.tradingValue,
          tradingValueChangeRate: null,
          netAssets: r.netAssets,
          nav: r.nav,
          indexName: r.indexName,
          marketCap: r.marketCap,
          totalFee: null,
          volatilityScore: null,
          riskTags: [],
          summary: null,
          topHoldings: [],
          _curated: false,
          _prevClose: r.prevClose,
        }));

      // --- 2) Toss 실시간 시세 결합 ---
      let priceMatched = 0;
      const derived = [];
      if (tossOn) {
        // 큐레이션: 캔들 포함 풀 지표(현재가·등락·주간/월간·거래대금).
        try {
          const q = await toss.getQuotes(base.etfsRaw.map((e) => e.code).filter(Boolean));
          curated = curated.map((e) => {
            const live = q.get(e.code);
            if (!live) return e;
            const n = { ...e };
            if (isNum(live.price)) n.currentPrice = live.price;
            if (isNum(live.changeRate)) n.changeRate1d = live.changeRate;
            if (isNum(live.return1w)) n.return1w = live.return1w;
            if (isNum(live.return1m)) n.return1m = live.return1m;
            if (isNum(live.tradingValue)) n.tradingValue = live.tradingValue;
            if (isNum(live.tradingValueChangeRate)) n.tradingValueChangeRate = live.tradingValueChangeRate;
            priceMatched += 1;
            return n;
          });
        } catch { /* 실패 시 공공데이터/ fixture 값 유지 */ }

        // thin(대량): 현재가만 조회 + 공공데이터 전일종가로 당일 등락률 재계산.
        if (thin.length) {
          try {
            const pricesOnly = await toss.getPricesOnly(thin.map((e) => e.code));
            for (let i = 0; i < thin.length; i += 1) {
              const pr = pricesOnly.get(thin[i].code);
              if (pr && isNum(pr.price)) {
                thin[i].currentPrice = pr.price;
                const cr = pctOf(pr.price, thin[i]._prevClose);
                if (cr != null) thin[i].changeRate1d = cr;
                priceMatched += 1;
              }
            }
          } catch { /* 실패 시 공공데이터 T+1 값 유지 */ }
        }
      }

      // 내부 필드(_curated/_prevClose) 제거 후 유니버스 확정.
      const strip = ({ _curated, _prevClose, ...rest }) => rest;
      const etfsRaw = curated.map(strip).concat(thin.map(strip));

      // --- 3) 종목 등락·테마·시장요약 파생 (toss 확보 시) ---
      let stocksRaw = base.stocksRaw;
      let themesRaw = base.themesRaw;
      let marketSummaryByPeriod = base.marketSummaryByPeriod;
      let stockMatched = 0;

      if (tossOn) {
        // 종목 현재가 → changeRate1d(역검색 카드).
        try {
          const sQuotes = await toss.getQuotes(base.stocksRaw.map((s) => s.code).filter(Boolean));
          stocksRaw = base.stocksRaw.map((s) => {
            const q = sQuotes.get(s.code);
            if (q && isNum(q.changeRate)) { stockMatched += 1; return { ...s, changeRate1d: q.changeRate }; }
            return s;
          });
          if (stockMatched) derived.push('stocks.changeRate1d');
        } catch { /* fixture 유지 */ }

        // 테마 지표 = 큐레이션 멤버 집계(테마는 큐레이션 ETF 에만 부여).
        themesRaw = base.themesRaw.map((t) => {
          const members = curated.filter((e) => e.themeId === t.id);
          if (!members.length) return t;
          const pick = (f) => members.map((m) => m[f]).filter(isNum);
          const r1d = mean(pick('changeRate1d'));
          const r1w = mean(pick('return1w'));
          const r1m = mean(pick('return1m'));
          const tv = sum(pick('tradingValue'));
          const tvc = mean(pick('tradingValueChangeRate'));
          return {
            ...t,
            return1d: r1d != null ? r1d : t.return1d,
            return1w: r1w != null ? r1w : t.return1w,
            return1m: r1m != null ? r1m : t.return1m,
            tradingValue: tv != null ? tv : t.tradingValue,
            tradingValueChangeRate: tvc != null ? tvc : t.tradingValueChangeRate,
          };
        });
        derived.push('themes(return1d/1w/1m,tradingValue)');

        // 시장요약(1d) = 전종목 유니버스 집계. 문구는 중립·사실 서술(투자유도 표현 없음).
        const rates = etfsRaw.map((e) => e.changeRate1d).filter(isNum);
        const advancers = rates.filter((r) => r > 0).length;
        const decliners = rates.filter((r) => r < 0).length;
        const unchanged = etfsRaw.length - advancers - decliners;
        const totalTradingValue = sum(etfsRaw.map((e) => e.tradingValue).filter(isNum));
        const ranked = themesRaw.filter((t) => isNum(t.return1d));
        const strongest = ranked.length ? ranked.reduce((a, b) => (b.return1d > a.return1d ? b : a)) : null;
        const weakest = ranked.length ? ranked.reduce((a, b) => (b.return1d < a.return1d ? b : a)) : null;
        const base1d = base.marketSummaryByPeriod['1d'] || {};
        marketSummaryByPeriod = {
          ...base.marketSummaryByPeriod,
          '1d': {
            ...base1d,
            advancers,
            decliners,
            unchanged,
            totalTradingValue: totalTradingValue != null ? totalTradingValue : base1d.totalTradingValue,
            strongestThemeId: strongest ? strongest.id : base1d.strongestThemeId,
            weakestThemeId: weakest ? weakest.id : base1d.weakestThemeId,
            summary:
              `오늘 기준 상승 ${advancers} · 하락 ${decliners} · 보합 ${unchanged} 종목이에요.` +
              (strongest ? ` ${strongest.name} 테마가 상대적으로 강했어요.` : ''),
          },
        };
        derived.push('marketSummary.1d');
      }

      const sources = ['mock'];
      if (universeSource === 'publicdata') sources.push('publicdata');
      if (tossOn) sources.push('toss');

      meta.overlay = {
        enabled: true,
        applied: true,
        universeSize: etfsRaw.length,
        curatedSize: base.etfsRaw.length,
        universeSource,
        universeAsOf: pdAsOf,
        priceMatched,
        stockMatched,
        fields: ['currentPrice', 'changeRate1d', 'return1w', 'return1m', 'tradingValue', 'tradingValueChangeRate', 'netAssets', 'nav', 'indexName'],
        derived,
        stillMock: ['volatilityScore(전종목)', 'totalFee(thin)', 'riskTags(thin)', 'holdings(thin)', 'themes(thin)', 'contents'],
      };
      meta.sources = sources;
      meta.asOfDate = pdAsOf || base.asOfDate;
      return { ...base, etfsRaw, stocksRaw, themesRaw, marketSummaryByPeriod, meta };
    },
  };
}

// 프로세스 공용 기본 서비스 싱글턴(요청 간 캐시 공유).
export const etfService = createEtfService();

export default etfService;
