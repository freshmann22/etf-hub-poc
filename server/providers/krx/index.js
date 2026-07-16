// KRX provider — 한국거래소 공개 데이터(data.krx.co.kr) 베스트에포트 어댑터.
// 공식 공개 데이터이나 계약상 재배포/호출제한 조건이 불명확하므로 "베스트에포트"로 표기하고
// 운영 채택 전 이용조건 확인이 필요하다(docs/ETF_DATA_LIMITATIONS.md).
// 인증키는 불필요하나 안정성/약관 리스크가 있어 hybrid 에서 실패 시 mock 으로 폴백된다.
import { BaseProvider } from '../types.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { Status, ProviderError, ErrorCodes } from '../../lib/errors.js';
import { safeFetchText } from '../../lib/http.js';
import { normalizeCode, parseNumber, toSeoulIso, cleanText } from '../../lib/normalize.js';

const KRX_BLD =
  'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const ETF_LIST_BLD = 'dbms/MDC/STAT/standard/MDCSTAT04601'; // ETF 전종목 시세

export class KrxProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'krx', config });
    // 공개 시세/목록은 지원, 구성종목/분배는 KRX 단독으로 불충분 → 미지원.
    this.capabilities = {
      getEtfList: true,
      getEtfSummary: true,
      getEtfPrice: true,
      getEtfHoldings: false,
      getEtfPerformance: false,
      getEtfDistributions: false,
      getEtfDisclosures: false,
    };
  }

  isAvailable() {
    return this.config.enabled !== false;
  }

  _meta(status = Status.OK) {
    return makeMeta({
      source: 'krx',
      asOfDate: toSeoulIso(new Date()),
      status,
      quality: 0.9,
    });
  }

  async _fetchEtfList() {
    if (!this.isAvailable()) throw new ProviderError(ErrorCodes.UNAVAILABLE, 'krx disabled', { provider: 'krx' });
    const body = new URLSearchParams({
      bld: ETF_LIST_BLD,
      locale: 'ko_KR',
      trdDd: '', // 최근 영업일 (빈값 시 서버 기본)
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
    }).toString();
    const text = await safeFetchText(KRX_BLD, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: 'http://data.krx.co.kr/',
      },
      body,
      provider: 'krx',
      timeoutMs: this.config.timeoutMs || 8000,
      retries: this.config.retries ?? 2,
    });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError(ErrorCodes.PARSE_ERROR, 'krx json parse', { provider: 'krx' });
    }
    const rows = json.output || json.OutBlock_1 || json.block1 || [];
    return rows;
  }

  // KRX row → 공통 형태로 정규화 (원시 숫자).
  _mapRow(r) {
    const code = normalizeCode(r.ISU_SRT_CD || r.SHRT_ISU_CD || r.isuCd);
    return {
      code,
      standardCode: cleanText(r.ISU_CD) || (code ? 'KR' + code : null),
      name: cleanText(r.ISU_ABBRV || r.ISU_NM),
      issuer: null,
      price: parseNumber(r.TDD_CLSPRC),
      change: parseNumber(r.CMPPREVDD_PRC),
      changeRate: parseNumber(r.FLUC_RT),
      volume: parseNumber(r.ACC_TRDVOL),
      tradingValue: parseNumber(r.ACC_TRDVAL),
      marketCap: parseNumber(r.MKTCAP),
      netAssets: parseNumber(r.NETASST_TOTAMT),
      nav: parseNumber(r.NAV),
      inav: null,
      premiumDiscountRate: null,
      trackingError: null,
      expenseRatio: null,
    };
  }

  async getEtfList() {
    const rows = await this._fetchEtfList();
    const data = rows.map((r) => this._mapRow(r)).filter((x) => x.code);
    return envelope(data, this._meta(data.length ? Status.OK : Status.PARTIAL));
  }

  async getEtfPrice(code) {
    const target = normalizeCode(code);
    const rows = await this._fetchEtfList();
    const row = rows.map((r) => this._mapRow(r)).find((x) => x.code === target);
    if (!row) return envelope(null, this._meta(Status.UNAVAILABLE));
    return envelope(row, this._meta());
  }

  async getEtfSummary(code) {
    return this.getEtfPrice(code);
  }
}

export default KrxProvider;
