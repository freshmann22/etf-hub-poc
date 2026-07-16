// 공공데이터포털(data.go.kr) provider — 금융위원회_증권상품시세정보 > ETF 시세.
// ETF "전종목" 유니버스(목록+T+1 스냅샷)를 확보한다. Toss(실시간 시세) 밖의 목록/순자산/기초지수 소스.
// serviceKey 는 사용자가 .env 에 직접 입력하며 로그/응답에 노출하지 않는다.
// 스펙: data.go.kr id 15094806, 오퍼레이션 getETFPriceInfo. 갱신 T+1(전영업일→익영업일 13시 이후).
import { BaseProvider } from '../types.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { Status, ProviderError, ErrorCodes } from '../../lib/errors.js';
import { safeFetchText } from '../../lib/http.js';
import { parseNumber, cleanText, toSeoulIso } from '../../lib/normalize.js';

const DEFAULT_URL =
  'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo';
const PER_PAGE = 1000;
const HOST = 'apis.data.go.kr';

export class PublicDataProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'publicdata', config });
    this.capabilities = {
      getEtfList: true,
      getEtfSummary: true,
      getEtfPrice: false,
      getEtfHoldings: false,
      getEtfPerformance: false,
      getEtfDistributions: false,
      getEtfDisclosures: false,
    };
    this._url = config.etfPriceUrl || DEFAULT_URL;
    this._cache = null; // { dayKey, basDt, rows }
  }

  isAvailable() {
    const c = this.config;
    return c.enabled !== false && typeof c.serviceKey === 'string' && c.serviceKey.trim() !== '';
  }

  _require() {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'publicdata serviceKey missing/disabled', { provider: 'publicdata' });
    }
  }

  // 단일 호출(JSON). resultCode 검증. serviceKey 는 URL 파라미터로만 전달(로그 금지).
  async _call({ numOfRows, pageNo, basDt }) {
    const p = new URLSearchParams({
      serviceKey: this.config.serviceKey,
      resultType: 'json',
      numOfRows: String(numOfRows),
      pageNo: String(pageNo),
    });
    if (basDt) p.set('basDt', basDt);
    const text = await safeFetchText(`${this._url}?${p.toString()}`, {
      provider: 'publicdata',
      allowlist: [HOST],
      timeoutMs: this.config.timeoutMs || 8000,
      retries: this.config.retries ?? 2,
      maxBytes: 8 * 1024 * 1024,
    });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError(ErrorCodes.PARSE_ERROR, 'publicdata json parse', { provider: 'publicdata' });
    }
    const header = json && json.response && json.response.header;
    if (header && header.resultCode && header.resultCode !== '00') {
      const code = header.resultCode === '22' || header.resultCode === '30' ? ErrorCodes.UNAVAILABLE : ErrorCodes.UPSTREAM_ERROR;
      throw new ProviderError(code, `publicdata result ${header.resultCode}`, { provider: 'publicdata' });
    }
    return json;
  }

  // 최신 basDt 판별 후 해당 일자 전종목 페이지네이션 수집. 일 단위 캐시.
  async _fetchAll() {
    const dayKey = new Date().toISOString().slice(0, 10);
    if (this._cache && this._cache.dayKey === dayKey) return this._cache;

    // 1) 최신 기준일자(basDt) — basDt 미지정 시 최신순 첫 행의 basDt.
    const probe = await this._call({ numOfRows: 1, pageNo: 1 });
    const first = itemsOf(probe)[0];
    const basDt = first ? cleanText(first.basDt) : null;
    if (!basDt) throw new ProviderError(ErrorCodes.PARSE_ERROR, 'publicdata no basDt', { provider: 'publicdata' });

    // 2) 해당 일자 전종목 수집.
    const page1 = await this._call({ numOfRows: PER_PAGE, pageNo: 1, basDt });
    const total = Number(bodyOf(page1).totalCount) || 0;
    let rows = itemsOf(page1);
    const pages = Math.ceil(total / PER_PAGE);
    for (let p = 2; p <= pages; p += 1) {
      const pg = await this._call({ numOfRows: PER_PAGE, pageNo: p, basDt });
      rows = rows.concat(itemsOf(pg));
    }

    const mapped = rows.map((r) => mapRow(r)).filter((x) => x.code);
    this._cache = { dayKey, basDt, rows: mapped };
    return this._cache;
  }

  _meta(basDt, status = Status.OK) {
    return makeMeta({ source: 'publicdata', asOfDate: toSeoulIso(basDt), status, quality: 0.9 });
  }

  async getEtfList() {
    this._require();
    const { basDt, rows } = await this._fetchAll();
    return envelope(rows, this._meta(basDt, rows.length ? Status.OK : Status.PARTIAL));
  }

  async getEtfSummary(code) {
    this._require();
    const target = String(code || '').trim();
    const { basDt, rows } = await this._fetchAll();
    const row = rows.find((r) => r.code === target);
    if (!row) return envelope(null, this._meta(basDt, Status.UNAVAILABLE));
    return envelope(row, this._meta(basDt));
  }
}

// --- 순수 헬퍼 ---
function bodyOf(json) {
  return (json && json.response && json.response.body) || {};
}
function itemsOf(json) {
  const item = bodyOf(json).items && bodyOf(json).items.item;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
}
// 원(KRW) → 억원(정수). null 안전.
function eok(v) {
  const n = parseNumber(v);
  return n == null ? null : Math.round(n / 1e8);
}
function mapRow(r) {
  return {
    code: cleanText(r.srtnCd), // 단축코드(표준 ETF 는 6자리 숫자)
    isin: cleanText(r.isinCd),
    name: cleanText(r.itmsNm),
    prevClose: parseNumber(r.clpr), // basDt 종가 = 익영업일 기준 전일종가
    change: parseNumber(r.vs),
    changeRate: parseNumber(r.fltRt),
    volume: parseNumber(r.trqu),
    tradingValue: eok(r.trPrc), // 거래대금(억원)
    netAssets: eok(r.nPptTotAmt), // 순자산총액(억원)
    marketCap: eok(r.mrktTotAmt), // 시가총액(억원)
    nav: parseNumber(r.nav),
    indexName: cleanText(r.bssIdxIdxNm), // 기초지수명
    indexClose: parseNumber(r.bssIdxClpr),
    listingShares: parseNumber(r.stLstgCnt),
    basDt: cleanText(r.basDt),
  };
}

export default PublicDataProvider;
