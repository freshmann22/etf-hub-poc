// SEIBRO(예탁결제원) 공급자 — 스텁(미구현).
// 실제 구현 시 SEIBRO 공시/PDF 에서 원시 데이터를 받아온다.
// 현 단계에서는 NOT_IMPLEMENTED 만 반환한다(가짜 성공 금지).

import { PROVIDER } from '../constants.js';
import { BaseHoldingsProvider, notImplemented } from './base.js';

export class SeibroProvider extends BaseHoldingsProvider {
  constructor() {
    super(PROVIDER.SEIBRO);
  }

  isImplemented() {
    return false;
  }

  async fetchRaw(_etfCode, _baseDate) {
    return notImplemented(this.name, 'SEIBRO 수집은 아직 구현되지 않았습니다.');
  }
}

export default SeibroProvider;
