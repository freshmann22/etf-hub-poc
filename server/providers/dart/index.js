// DART provider — 금융감독원 전자공시 OpenAPI(opendart.fss.or.kr).
// 공식 API, DART_API_KEY 필요. 키가 없으면 unavailable.
// ETF 관련 공시(운용사 정기공시 등) 조회에 사용. 구성종목 상세는 미지원.
import { BaseProvider } from '../types.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { Status, ProviderError, ErrorCodes } from '../../lib/errors.js';
import { safeFetchJson } from '../../lib/http.js';
import { toSeoulIso, cleanText } from '../../lib/normalize.js';

const DART_LIST = 'https://opendart.fss.or.kr/api/list.json';

export class DartProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'dart', config });
    this.capabilities = {
      getEtfList: false,
      getEtfSummary: false,
      getEtfPrice: false,
      getEtfHoldings: false,
      getEtfPerformance: false,
      getEtfDistributions: false,
      getEtfDisclosures: true,
    };
  }

  isAvailable() {
    return typeof this.config.apiKey === 'string' && this.config.apiKey.trim() !== '';
  }

  async getEtfDisclosures(code, opts = {}) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'DART_API_KEY missing', { provider: 'dart' });
    }
    // corp_code 매핑 테이블이 필요(운용사/종목→corp_code). PoC 범위에서는 corp_code 를
    // opts 로 받거나, 없으면 최근 공시 목록을 제한 조회한다.
    const params = new URLSearchParams({
      crtfc_key: this.config.apiKey, // 비밀 — 로그 금지
      page_count: String(opts.pageCount || 20),
    });
    if (opts.corpCode) params.set('corp_code', opts.corpCode);
    if (opts.bgnDe) params.set('bgn_de', opts.bgnDe);

    const url = `${DART_LIST}?${params.toString()}`;
    const json = await safeFetchJson(url, {
      provider: 'dart',
      allowlist: undefined, // DEFAULT_ALLOWLIST 에 opendart 포함
      timeoutMs: this.config.timeoutMs || 8000,
    });

    if (json.status && json.status !== '000') {
      // DART 오류코드 → 표준 오류 (키 노출 없이)
      const code2 = json.status === '020' ? ErrorCodes.RATE_LIMITED : ErrorCodes.UPSTREAM_ERROR;
      throw new ProviderError(code2, `dart status ${json.status}`, { provider: 'dart' });
    }

    const rows = (json.list || []).map((r) => ({
      id: r.rcept_no,
      disclosureType: 'disclosure',
      title: cleanText(r.report_nm),
      summary: cleanText(r.corp_name),
      date: toSeoulIso(r.rcept_dt),
      url: r.rcept_no ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}` : null,
      source: 'DART',
    }));
    return envelope(rows, makeMeta({ source: 'dart', asOfDate: toSeoulIso(new Date()), status: Status.OK, quality: 1 }));
  }
}

export default DartProvider;
