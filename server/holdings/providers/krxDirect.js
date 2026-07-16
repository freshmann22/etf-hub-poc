// KRX 직접 수집 공급자 — 스텁(미구현).
// 실제 구현 시 KRX 정보데이터시스템(정적 파일/API)에서 원시 데이터를 받아온다.
// 현 단계에서는 오프라인/결정성 유지를 위해 NOT_IMPLEMENTED 만 반환한다(가짜 성공 금지).

import { PROVIDER } from '../constants.js';
import { BaseHoldingsProvider, notImplemented } from './base.js';

export class KrxDirectProvider extends BaseHoldingsProvider {
  constructor() {
    super(PROVIDER.KRX_DIRECT);
  }

  isImplemented() {
    return false;
  }

  async fetchRaw(_etfCode, _baseDate) {
    return notImplemented(this.name, 'KRX 직접 수집은 아직 구현되지 않았습니다.');
  }
}

export default KrxDirectProvider;
