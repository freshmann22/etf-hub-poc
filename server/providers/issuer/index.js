// Issuer provider — 운용사 공식 공개 데이터(구성종목 PDF/CSV, 분배 일정 등).
// 운용사별 공개 다운로드 URL 규격이 달라 ISSUER_DATA_BASE_URL 설정 시에만 동작.
// 미설정 시 unavailable. 스크래핑이 아닌 공식 다운로드를 우선한다.
import { BaseProvider } from '../types.js';
import { ProviderError, ErrorCodes } from '../../lib/errors.js';

export class IssuerProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'issuer', config });
    this.capabilities = {
      getEtfList: false,
      getEtfSummary: false,
      getEtfPrice: false,
      getEtfHoldings: true, // 설정 시 공식 구성종목 다운로드
      getEtfPerformance: false,
      getEtfDistributions: true, // 설정 시 분배 일정
      getEtfDisclosures: false,
    };
  }

  isAvailable() {
    return typeof this.config.configUrl === 'string' && this.config.configUrl.trim() !== '';
  }

  async getEtfHoldings(_code) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'issuer data source not configured', { provider: 'issuer' });
    }
    // 운용사별 파서 매핑이 필요 → 설정 전까지 미지원으로 정직 처리.
    throw new ProviderError(ErrorCodes.NOT_SUPPORTED, 'issuer parser not configured', { provider: 'issuer' });
  }

  async getEtfDistributions(_code) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'issuer data source not configured', { provider: 'issuer' });
    }
    throw new ProviderError(ErrorCodes.NOT_SUPPORTED, 'issuer parser not configured', { provider: 'issuer' });
  }
}

export default IssuerProvider;
