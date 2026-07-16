// ETF 구성자산 파이프라인 — 중앙 상수/enum 정의(단일 계약 원천).
// 상태·자산유형·공급자 문자열은 여기서만 정의한다(임의 문자열 생성 금지).
// schemas/etf-holdings.schema.json 의 enum 과 값이 일치해야 하며, 테스트로 교차검증한다.

export const SCHEMA_VERSION = '1.0.0';

// 자산유형 — 현물/파생/현금/외화/다른 ETF 등 "구성자산"을 포괄한다.
export const ASSET_TYPE = Object.freeze({
  EQUITY: 'EQUITY',
  ETF: 'ETF',
  FUTURE: 'FUTURE',
  OPTION: 'OPTION',
  SWAP: 'SWAP',
  BOND: 'BOND',
  CASH: 'CASH',
  CURRENCY: 'CURRENCY',
  REIT: 'REIT',
  FUND: 'FUND',
  DERIVATIVE: 'DERIVATIVE',
  OTHER: 'OTHER',
  UNKNOWN: 'UNKNOWN',
});

// 데이터 공급자.
export const PROVIDER = Object.freeze({
  PYKRX: 'PYKRX',
  KRX_DIRECT: 'KRX_DIRECT',
  SEIBRO: 'SEIBRO',
  ISSUER: 'ISSUER',
  MOCK: 'MOCK',
});

// 원천 형태(진단용). 과도한 강제는 피하되 중앙에서 관리한다.
export const SOURCE_TYPE = Object.freeze({
  KRX_PDF: 'KRX_PDF',
  KRX_API: 'KRX_API',
  SEIBRO_PDF: 'SEIBRO_PDF',
  ISSUER_FILE: 'ISSUER_FILE',
  MOCK: 'MOCK',
  UNKNOWN: 'UNKNOWN',
});

// 요청일 ↔ 실제 채택 기준일 해결 상태(영업일 보정).
export const DATE_RESOLUTION_STATUS = Object.freeze({
  EXACT: 'EXACT', // 요청일에 데이터 존재
  RESOLVED_PRIOR: 'RESOLVED_PRIOR', // 직전 영업일로 후퇴하여 채택
  UNRESOLVED: 'UNRESOLVED', // lookback 범위 내 유효 데이터 없음
  NOT_ATTEMPTED: 'NOT_ATTEMPTED', // 보정 미시도
});

// 수집 상태.
export const COLLECTION_STATUS = Object.freeze({
  OK: 'OK',
  PARTIAL: 'PARTIAL',
  EMPTY: 'EMPTY',
  REQUEST_FAILED: 'REQUEST_FAILED',
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  NORMALIZATION_FAILED: 'NORMALIZATION_FAILED',
  WEIGHT_MISSING: 'WEIGHT_MISSING',
  UNSUPPORTED: 'UNSUPPORTED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  UNRESOLVED: 'UNRESOLVED',
});

// fallback 기본 우선순위.
export const PROVIDER_PRIORITY = Object.freeze([
  PROVIDER.PYKRX,
  PROVIDER.KRX_DIRECT,
  PROVIDER.SEIBRO,
  PROVIDER.ISSUER,
]);

// 편의: 값 배열(검증/스키마 교차검사용).
export const DATE_RESOLUTION_STATUSES = Object.freeze(Object.values(DATE_RESOLUTION_STATUS));
export const ASSET_TYPES = Object.freeze(Object.values(ASSET_TYPE));
export const PROVIDERS = Object.freeze(Object.values(PROVIDER));
export const SOURCE_TYPES = Object.freeze(Object.values(SOURCE_TYPE));
export const COLLECTION_STATUSES = Object.freeze(Object.values(COLLECTION_STATUS));

export function isAssetType(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ASSET_TYPE, v);
}
export function isCollectionStatus(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(COLLECTION_STATUS, v);
}
export function isProvider(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER, v);
}
