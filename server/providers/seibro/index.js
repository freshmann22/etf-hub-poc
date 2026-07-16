// SEIBRO provider — 예탁결제원 증권정보포털(seibro.or.kr). ETF 구성종목(PDF)·분배금 등.
// 공식 API 부재로 스크래핑 필요 → 운영 기본 provider 로 채택하지 않는다(rule 15).
// 기본 비활성(SEIBRO_ENABLED=true 로만 활성). 활성 시에도 베스트에포트.
import { BaseProvider } from '../types.js';
import { ProviderError, ErrorCodes } from '../../lib/errors.js';

export class SeibroProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'seibro', config });
    this.capabilities = {
      getEtfList: false,
      getEtfSummary: false,
      getEtfPrice: false,
      getEtfHoldings: true, // 활성 시 구성종목(PDF). 기본 비활성.
      getEtfPerformance: false,
      getEtfDistributions: true, // 활성 시 분배금. 기본 비활성.
      getEtfDisclosures: false,
    };
  }

  isAvailable() {
    return this.config.enabled === true;
  }

  async getEtfHoldings(_code) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'seibro scraping disabled', { provider: 'seibro' });
    }
    throw new ProviderError(ErrorCodes.NOT_SUPPORTED, 'seibro scraping not implemented', { provider: 'seibro' });
  }

  async getEtfDistributions(_code) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'seibro scraping disabled', { provider: 'seibro' });
    }
    throw new ProviderError(ErrorCodes.NOT_SUPPORTED, 'seibro scraping not implemented', { provider: 'seibro' });
  }
}

export default SeibroProvider;
