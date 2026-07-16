// KIND provider — KRX 기업공시채널(kind.krx.co.kr). ETF 상장/변경/운용사 공지 등.
// 공식 API 부재로 HTML 스크래핑이 필요 → 운영 기본 provider 로 채택하지 않는다(rule 15).
// 기본 비활성(KIND_ENABLED=true 로만 활성). 활성 시에도 베스트에포트.
// 스크래핑 조건 점검: robots.txt / 약관 / 인증 / 호출제한 / 재배포 / HTML 변경 위험
//  → docs/ETF_DATA_SOURCES.md, docs/ETF_DATA_LIMITATIONS.md 에 기록.
import { BaseProvider } from '../types.js';
import { ProviderError, ErrorCodes } from '../../lib/errors.js';

export class KindProvider extends BaseProvider {
  constructor(config = {}) {
    super({ id: 'kind', config });
    this.capabilities = {
      getEtfList: false,
      getEtfSummary: false,
      getEtfPrice: false,
      getEtfHoldings: false,
      getEtfPerformance: false,
      getEtfDistributions: false,
      getEtfDisclosures: true, // 활성 시 상장/변경 공시. 기본 비활성.
    };
  }

  isAvailable() {
    return this.config.enabled === true;
  }

  async getEtfDisclosures(_code) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'kind scraping disabled', { provider: 'kind' });
    }
    // 스크래핑 구현은 약관/robots 확인 후에만 활성화. 미구현 상태에서는 미지원으로 정직 처리.
    throw new ProviderError(ErrorCodes.NOT_SUPPORTED, 'kind scraping not implemented', { provider: 'kind' });
  }
}

export default KindProvider;
