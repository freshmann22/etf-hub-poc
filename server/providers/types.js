// Provider 공통 인터페이스 + capability 모델.
// 모든 provider 가 모든 기능을 지원할 필요는 없다. capability 로 지원 여부를 명시한다.
import { ProviderError, ErrorCodes } from '../lib/errors.js';

export const CAPABILITIES = Object.freeze([
  'getEtfList',
  'getEtfSummary',
  'getEtfPrice',
  'getEtfHoldings',
  'getEtfPerformance',
  'getEtfDistributions',
  'getEtfDisclosures',
]);

/**
 * BaseProvider — 기본 동작: 모든 기능 미지원(NOT_SUPPORTED), unavailable.
 * 각 provider 는 이를 상속하고 지원 메서드 + capabilities + available 을 채운다.
 */
export class BaseProvider {
  constructor({ id, config = {} } = {}) {
    this.id = id;
    this.config = config;
    // 기본: 아무 기능도 지원하지 않음
    this.capabilities = CAPABILITIES.reduce((acc, k) => ((acc[k] = false), acc), {});
  }

  /** 인증정보/설정이 갖춰져 실제 호출 가능한지. 기본 false. */
  isAvailable() {
    return false;
  }

  supports(capability) {
    return !!this.capabilities[capability];
  }

  _notSupported(capability) {
    throw new ProviderError(
      ErrorCodes.NOT_SUPPORTED,
      `${this.id} does not support ${capability}`,
      { provider: this.id }
    );
  }

  _unavailable(capability) {
    throw new ProviderError(
      ErrorCodes.UNAVAILABLE,
      `${this.id} is unavailable (missing credentials/config)`,
      { provider: this.id }
    );
  }

  // --- 공통 인터페이스 (기본 구현은 미지원) ---
  async getEtfList() { return this._notSupported('getEtfList'); }
  async getEtfSummary(_code) { return this._notSupported('getEtfSummary'); }
  async getEtfPrice(_code) { return this._notSupported('getEtfPrice'); }
  async getEtfHoldings(_code) { return this._notSupported('getEtfHoldings'); }
  async getEtfPerformance(_code) { return this._notSupported('getEtfPerformance'); }
  async getEtfDistributions(_code) { return this._notSupported('getEtfDistributions'); }
  async getEtfDisclosures(_code) { return this._notSupported('getEtfDisclosures'); }

  /** 진단용 상태(비밀값 미포함). */
  describe() {
    return {
      id: this.id,
      available: this.isAvailable(),
      capabilities: { ...this.capabilities },
    };
  }
}
