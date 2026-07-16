// 토스증권 Open API provider — 실 시세 채널.
// OAuth2 client_credentials 로 액세스 토큰을 발급/캐시하고, /api/v1/prices(현재가 배치)와
// /api/v1/candles(일봉)로 등락률·주간/월간 수익률·거래대금을 계산한다.
// 비밀값(client_secret·토큰)은 로그/응답에 싣지 않는다.
// 스펙: https://openapi.tossinvest.com/openapi-docs (OAuth2 client_credentials, Bearer)
import { BaseProvider } from '../types.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { Status, ProviderError, ErrorCodes } from '../../lib/errors.js';
import { safeFetchText } from '../../lib/http.js';
import { parseNumber, toSeoulIso } from '../../lib/normalize.js';

const DEFAULT_BASE = 'https://openapi.tossinvest.com';
const CANDLE_COUNT = 25; // 최근 25영업일(월간 20 + 여유)
const IDX_PREV = 1; // 직전 영업일
const IDX_1W = 5; // 5영업일 전(주간)
const IDX_1M = 20; // 20영업일 전(월간)
const EOKWON = 1e8; // 억원 환산

export class TossProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'toss', config });
    this.capabilities = {
      getEtfList: false, // 토스는 전종목 열거 API 미제공 → 코드 목록 필요
      getEtfSummary: true,
      getEtfPrice: true,
      getEtfHoldings: false,
      getEtfPerformance: true, // 일봉으로 1w/1m 수익률 계산 제공
      getEtfDistributions: false,
      getEtfDisclosures: false,
    };
    this._base = (config.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this._tokenUrl = config.tokenUrl || `${this._base}/oauth2/token`;
    this._host = safeHost(this._base);
    this._token = null; // { value, expMs }
    this._history = new Map(); // code -> { dayKey, prevClose, close1w, close1m, tvToday, tvPrev }
  }

  isAvailable() {
    const c = this.config;
    return !!(c.clientId && c.clientSecret);
  }

  _allow() {
    return [this._host, safeHost(this._tokenUrl)].filter(Boolean);
  }

  _requireCreds() {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'toss credentials missing', { provider: 'toss' });
    }
  }

  // OAuth2 액세스 토큰(캐시). client_credentials, x-www-form-urlencoded.
  // ★ single-flight: 토스는 "1 클라이언트 1 토큰"이라 재발급 시 기존 토큰이 즉시 무효화된다.
  //    동시 요청이 각각 토큰을 발급하면 서로 무효화되어 401 이 나므로, 발급은 반드시 1회로 병합한다.
  async _accessToken() {
    this._requireCreds();
    const now = Date.now();
    if (this._token && this._token.expMs > now + 5000) return this._token.value;
    if (this._tokenPromise) return this._tokenPromise; // 진행 중 발급에 합류
    this._tokenPromise = this._issueToken().finally(() => { this._tokenPromise = null; });
    return this._tokenPromise;
  }

  async _issueToken() {
    const now = Date.now();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }).toString();

    const text = await safeFetchText(this._tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      provider: 'toss',
      allowlist: this._allow(),
      timeoutMs: this.config.timeoutMs || 8000,
      retries: this.config.retries ?? 1,
    });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError(ErrorCodes.PARSE_ERROR, 'toss token parse', { provider: 'toss' });
    }
    if (!json.access_token) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'toss token missing', { provider: 'toss' });
    }
    const ttlMs = (parseNumber(json.expires_in) || 3600) * 1000;
    this._token = { value: json.access_token, expMs: now + Math.max(ttlMs - 60000, 30000) };
    return this._token.value;
  }

  async _get(path) {
    const token = await this._accessToken();
    const text = await safeFetchText(`${this._base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }, // 비밀 — 로그 금지
      provider: 'toss',
      allowlist: this._allow(),
      timeoutMs: this.config.timeoutMs || 8000,
      retries: this.config.retries ?? 1,
    });
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError(ErrorCodes.PARSE_ERROR, 'toss json parse', { provider: 'toss' });
    }
  }

  // 현재가 배치. codes → Map(code -> { lastPrice, timestamp })
  // Toss /prices 는 symbols 최대 200개 → 200 단위로 청킹해 병렬 조회 후 병합.
  async _fetchPrices(codes) {
    const chunks = chunk(codes, 200);
    const map = new Map();
    await runPool(chunks, 4, async (group) => {
      const symbols = group.join(',');
      const json = await this._get(`/api/v1/prices?symbols=${encodeURIComponent(symbols)}`);
      const rows = (json && json.result) || [];
      for (const r of rows) {
        const code = tossSymbol(r.symbol);
        map.set(code, { lastPrice: parseNumber(r.lastPrice), timestamp: r.timestamp || null });
      }
    });
    return map;
  }

  // 현재가만(캔들 없이) — 대량 유니버스 시세용. Map(code -> { price, timestamp }).
  async getPricesOnly(codes) {
    this._requireCreds();
    const norm = codes.map((c) => tossSymbol(c));
    const prices = await this._fetchPrices(norm);
    const out = new Map();
    for (const code of norm) {
      const p = prices.get(code);
      out.set(code, { price: p ? p.lastPrice : null, timestamp: p ? p.timestamp : null });
    }
    return out;
  }

  // 일봉 파생 과거값(전일종가·주간/월간 기준종가·거래대금). 일 단위 캐시.
  async _fetchHistory(code) {
    const dayKey = new Date().toISOString().slice(0, 10);
    const cached = this._history.get(code);
    if (cached && cached.dayKey === dayKey) return cached;

    let hist = { dayKey, prevClose: null, close1w: null, close1m: null, tvToday: null, tvPrev: null };
    try {
      const json = await this._get(`/api/v1/candles?symbol=${encodeURIComponent(code)}&interval=1d&count=${CANDLE_COUNT}`);
      const candles = (json && json.result && json.result.candles) || []; // 최신순
      hist.prevClose = closeAt(candles, IDX_PREV);
      hist.close1w = closeAt(candles, IDX_1W);
      hist.close1m = closeAt(candles, IDX_1M);
      hist.tvToday = tradingValueAt(candles, 0);
      hist.tvPrev = tradingValueAt(candles, IDX_PREV);
    } catch {
      // 과거값 실패는 등락률/수익률만 포기(현재가는 유효).
    }
    this._history.set(code, hist);
    return hist;
  }

  /**
   * 코드 목록 → Map(code -> 시세지표).
   * price/change/changeRate 는 현재가(fresh) 기준, return1w/1m·tradingValue 는 일봉(일 캐시) 기준.
   */
  async getQuotes(codes, { concurrency = 8 } = {}) {
    this._requireCreds();
    const norm = codes.map((c) => tossSymbol(c));
    const prices = await this._fetchPrices(norm);

    const out = new Map();
    for (const code of norm) {
      const p = prices.get(code);
      out.set(code, {
        price: p ? p.lastPrice : null,
        change: null,
        changeRate: null,
        return1w: null,
        return1m: null,
        tradingValue: null,
        tradingValueChangeRate: null,
        timestamp: p ? p.timestamp : null,
      });
    }

    const targets = norm.filter((code) => out.get(code).price != null);
    await runPool(targets, concurrency, async (code) => {
      const h = await this._fetchHistory(code);
      const q = out.get(code);
      const price = q.price;
      if (h.prevClose != null) {
        q.change = price - h.prevClose;
        q.changeRate = pct(price, h.prevClose);
      }
      q.return1w = pct(price, h.close1w);
      q.return1m = pct(price, h.close1m);
      if (h.tvToday != null) q.tradingValue = Math.round(h.tvToday); // 억원(정수)
      q.tradingValueChangeRate = pct(h.tvToday, h.tvPrev);
    });
    return out;
  }

  _meta(status = Status.OK, timestamp = null) {
    return makeMeta({
      source: 'toss',
      asOfDate: timestamp ? toSeoulIso(timestamp) : toSeoulIso(new Date()),
      status,
      quality: 1,
    });
  }

  async getEtfPrice(code) {
    const target = tossSymbol(code);
    const quotes = await this.getQuotes([target]);
    const q = quotes.get(target);
    if (!q || q.price == null) return envelope(null, this._meta(Status.UNAVAILABLE));
    return envelope(
      {
        code: target,
        price: q.price,
        change: q.change,
        changeRate: q.changeRate,
        return1w: q.return1w,
        return1m: q.return1m,
        volume: null,
        tradingValue: q.tradingValue,
        tradingValueChangeRate: q.tradingValueChangeRate,
        marketCap: null,
        netAssets: null,
        nav: null,
        inav: null,
        premiumDiscountRate: null,
        trackingError: null,
      },
      this._meta(Status.OK, q.timestamp)
    );
  }

  async getEtfSummary(code) {
    return this.getEtfPrice(code);
  }

  // 차트용 OHLC 캔들. interval: '1d'|'1m'. 토스는 1회 최대 200개라, count>200 이면
  // before/nextBefore 커서로 과거를 이어받아 합친다(1Y/3Y 등 장기). 오래된→최신 순 반환.
  async getCandles(code, { interval = '1d', count = 60 } = {}) {
    const target = tossSymbol(code);
    const iv = interval === '1m' ? '1m' : '1d';
    const want = Math.max(Number(count) || 60, 2);
    const PER = 200;
    const byTs = new Map(); // timestamp -> point (페이지 경계 중복 제거)
    let before = null;
    const maxPages = Math.min(Math.ceil(want / PER) + 2, 12); // 무한루프 방지
    for (let page = 0; page < maxPages && byTs.size < want; page += 1) {
      let path = `/api/v1/candles?symbol=${encodeURIComponent(target)}&interval=${iv}&count=${PER}`;
      if (before) path += `&before=${encodeURIComponent(before)}`;
      const json = await this._get(path);
      const candles = (json && json.result && json.result.candles) || []; // 최신순
      if (!candles.length) break;
      for (const c of candles) {
        const t = c.timestamp || null;
        if (t && !byTs.has(t)) {
          byTs.set(t, {
            t,
            o: parseNumber(c.openPrice),
            h: parseNumber(c.highPrice),
            l: parseNumber(c.lowPrice),
            c: parseNumber(c.closePrice),
            v: parseNumber(c.volume),
          });
        }
      }
      before = (json && json.result && json.result.nextBefore) || null;
      if (!before) break; // 더 과거 데이터 없음
    }
    // 오래된→최신 정렬(동일 오프셋 ISO 문자열이라 사전순=시간순) 후 요청 개수만큼 최근분.
    const all = [...byTs.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const points = all.slice(Math.max(0, all.length - want));
    return envelope(
      { code: target, interval: iv, points },
      this._meta(points.length ? Status.OK : Status.UNAVAILABLE, points.length ? points[points.length - 1].t : null)
    );
  }

  async getEtfPerformance(code) {
    const target = tossSymbol(code);
    const quotes = await this.getQuotes([target]);
    const q = quotes.get(target);
    if (!q || q.price == null) return envelope(null, this._meta(Status.UNAVAILABLE));
    return envelope(
      {
        code: target,
        return1d: q.changeRate,
        return1w: q.return1w,
        return1m: q.return1m,
        return3m: null,
        return6m: null,
        return1y: null,
      },
      this._meta(Status.OK, q.timestamp)
    );
  }
}

// --- 순수 헬퍼 ---
function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// 토스 심볼: 순수 숫자 단축코드는 6자리 zero-pad, 영문 포함 KRX 단축코드(예: 0000D0)는 대문자 원형 유지.
// (normalizeCode 는 영문을 제거해 알파뉴메릭 코드를 망가뜨리므로 시세 조회엔 쓰지 않는다.)
function tossSymbol(code) {
  const s = String(code == null ? '' : code).trim();
  if (/^\d+$/.test(s)) return s.padStart(6, '0');
  return s.toUpperCase();
}

// 백분율 변화(둘째자리). 기준값 없거나 0이면 null.
function pct(cur, base) {
  if (cur == null || base == null || base === 0) return null;
  return Math.round(((cur - base) / base) * 10000) / 100;
}

function closeAt(candles, idx) {
  if (!candles.length) return null;
  const c = candles[idx] || candles[candles.length - 1];
  return parseNumber(c.closePrice);
}

// 억원 단위 거래대금 근사(종가×거래량). 원시 거래대금 필드가 없어 표준 근사 사용.
function tradingValueAt(candles, idx) {
  const c = candles[idx];
  if (!c) return null;
  const close = parseNumber(c.closePrice);
  const vol = parseNumber(c.volume);
  if (close == null || vol == null) return null;
  return (close * vol) / EOKWON;
}

// 배열을 size 단위로 분할.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 간단한 동시성 풀 (외부 의존성 없음).
async function runPool(items, limit, worker) {
  const queue = items.slice();
  const runners = new Array(Math.min(limit, queue.length)).fill(0).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default TossProvider;
