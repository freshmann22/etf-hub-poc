// Broker provider — 증권사 오픈API(예: 실시간/지연 시세·기본정보). 인증정보 필요.
// BROKER_API_BASE_URL/KEY/SECRET 미설정 시 unavailable. 사용자가 .env 에 직접 입력한다.
// Claude 는 키를 생성/추정하지 않는다. 계정 profile 입력이 필요할 수 있어 문서에 명시.
import { BaseProvider } from '../types.js';
import { makeMeta, envelope } from '../../schemas/etf.js';
import { Status, ProviderError, ErrorCodes } from '../../lib/errors.js';
import { safeFetchJson } from '../../lib/http.js';
import { normalizeCode, parseNumber, toSeoulIso } from '../../lib/normalize.js';

export class BrokerProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'broker', config });
    this.capabilities = {
      getEtfList: false,
      getEtfSummary: true,
      getEtfPrice: true,
      getEtfHoldings: false,
      getEtfPerformance: false,
      getEtfDistributions: false,
      getEtfDisclosures: false,
    };
  }

  isAvailable() {
    const c = this.config;
    return !!(c.baseUrl && c.apiKey && c.apiSecret);
  }

  _requireCreds() {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'broker credentials missing', { provider: 'broker' });
    }
  }

  async getEtfPrice(code) {
    this._requireCreds();
    const target = normalizeCode(code);
    // 증권사별 실제 엔드포인트/헤더 규격은 계약에 따라 다르다. 아래는 표준화 지점의 골격이며
    // baseUrl 이 allowlist 에 포함돼야 실제 호출된다(보안). 미포함이면 BAD_REQUEST.
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/etf/${target}/price`;
    const json = await safeFetchJson(url, {
      provider: 'broker',
      allowlist: [safeHost(this.config.baseUrl)].filter(Boolean),
      headers: brokerAuthHeaders(this.config), // 비밀 — 로그 금지
      timeoutMs: this.config.timeoutMs || 8000,
    });
    return envelope(
      {
        code: target,
        price: parseNumber(json.price ?? json.stck_prpr),
        change: parseNumber(json.change ?? json.prdy_vrss),
        changeRate: parseNumber(json.changeRate ?? json.prdy_ctrt),
        volume: parseNumber(json.volume ?? json.acml_vol),
        tradingValue: parseNumber(json.tradingValue ?? json.acml_tr_pbmn),
        nav: parseNumber(json.nav),
        inav: parseNumber(json.inav),
        marketCap: parseNumber(json.marketCap),
        netAssets: parseNumber(json.netAssets),
        premiumDiscountRate: parseNumber(json.premiumDiscountRate),
        trackingError: parseNumber(json.trackingError),
      },
      makeMeta({
        source: 'broker',
        asOfDate: toSeoulIso(json.asOf || new Date()),
        isDelayedHint: true,
        status: Status.OK,
        quality: 1,
      })
    );
  }

  async getEtfSummary(code) {
    return this.getEtfPrice(code);
  }
}

function safeHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

// 인증 헤더 구성 — 실제 값은 절대 로깅하지 않는다.
function brokerAuthHeaders(config) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    'X-Api-Secret': config.apiSecret,
    ...(config.accountProfile ? { 'X-Account-Profile': config.accountProfile } : {}),
  };
}

export default BrokerProvider;
