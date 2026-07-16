// 구성자산 공급자(provider) 공통 인터페이스.
// 모든 공급자는 "원시(raw) 공급자 형태" 데이터를 반환한다 — 공통 스키마 변환은 normalizer 소관.
// 성공/실패는 아래 헬퍼가 만드는 표준 rawResult 로 표현한다(예외 대신 상태 객체 우선).
//
// rawResult 형태:
//   성공  : { ok: true,  provider, status: OK,             sourceType, raw }
//   실패  : { ok: false, provider, status: <실패 상태>,    sourceType: null, raw: null, message }

import { PROVIDER, COLLECTION_STATUS, SOURCE_TYPE, isProvider } from '../constants.js';

export class BaseHoldingsProvider {
  // name 은 PROVIDER enum 값이어야 한다.
  constructor(name) {
    if (!isProvider(name)) {
      throw new Error('알 수 없는 공급자 이름: ' + name);
    }
    this._name = name;
  }

  get name() {
    return this._name;
  }

  // 하위 공급자가 실제 수집을 구현했는지 여부.
  isImplemented() {
    return false;
  }

  // 원시 데이터 수집. 기본 구현은 미구현(NOT_IMPLEMENTED) 표식을 반환한다.
  // 절대 실패 시 가짜 holdings 를 만들지 않는다.
  async fetchRaw(_etfCode, _baseDate) {
    return notImplemented(this._name);
  }
}

// 표준 실패/성공 표식 헬퍼 -------------------------------------------------

export function notImplemented(provider, message) {
  return {
    ok: false,
    provider,
    status: COLLECTION_STATUS.NOT_IMPLEMENTED,
    sourceType: null,
    raw: null,
    message: message ?? `${provider} 공급자는 아직 구현되지 않았습니다.`,
  };
}

export function requestFailed(provider, message) {
  return {
    ok: false,
    provider,
    status: COLLECTION_STATUS.REQUEST_FAILED,
    sourceType: null,
    raw: null,
    message: message ?? `${provider} 수집 요청이 실패했습니다.`,
  };
}

export function unsupported(provider, message) {
  return {
    ok: false,
    provider,
    status: COLLECTION_STATUS.UNSUPPORTED,
    sourceType: null,
    raw: null,
    message: message ?? `${provider} 는 해당 요청을 지원하지 않습니다.`,
  };
}

export function rawSuccess(provider, raw, sourceType = SOURCE_TYPE.UNKNOWN) {
  return {
    ok: true,
    provider,
    status: COLLECTION_STATUS.OK,
    sourceType,
    raw,
  };
}
