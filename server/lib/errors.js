// 공급자/서비스 오류를 공통 코드로 매핑한다. 비밀값/원문 인증정보를 오류에 절대 싣지 않는다.

export const ErrorCodes = Object.freeze({
  OK: 'OK',
  UNAVAILABLE: 'PROVIDER_UNAVAILABLE', // 인증정보 없음/비활성
  TIMEOUT: 'PROVIDER_TIMEOUT',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  UPSTREAM_ERROR: 'PROVIDER_UPSTREAM_ERROR', // 4xx/5xx
  NOT_SUPPORTED: 'CAPABILITY_NOT_SUPPORTED',
  PARSE_ERROR: 'PROVIDER_PARSE_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL: 'INTERNAL_ERROR',
});

// status 값(스키마 envelope 의 status 와 정렬)
export const Status = Object.freeze({
  OK: 'ok',
  STALE: 'stale',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
});

export class ProviderError extends Error {
  constructor(code, message, { retryable = false, provider = null, cause = null } = {}) {
    super(message || code);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.provider = provider;
  }
}

// HTTP 상태코드 → 오류코드
export function mapHttpStatus(httpStatus) {
  if (httpStatus === 429) return ErrorCodes.RATE_LIMITED;
  if (httpStatus === 404) return ErrorCodes.NOT_FOUND;
  if (httpStatus >= 400 && httpStatus < 500) return ErrorCodes.UPSTREAM_ERROR;
  if (httpStatus >= 500) return ErrorCodes.UPSTREAM_ERROR;
  return ErrorCodes.OK;
}

// 임의 오류 → { errorCode, retryable } 로 정규화 (민감정보 제거).
export function classifyError(err) {
  if (err instanceof ProviderError) {
    return { errorCode: err.code, retryable: !!err.retryable };
  }
  const name = err && err.name;
  const msg = (err && err.message) || '';
  if (name === 'AbortError' || /timeout/i.test(msg)) {
    return { errorCode: ErrorCodes.TIMEOUT, retryable: true };
  }
  if (/rate.?limit|429/i.test(msg)) {
    return { errorCode: ErrorCodes.RATE_LIMITED, retryable: true };
  }
  return { errorCode: ErrorCodes.UPSTREAM_ERROR, retryable: false };
}

// 오류코드 → HTTP 응답 상태
export function errorCodeToHttp(code) {
  switch (code) {
    case ErrorCodes.NOT_FOUND:
      return 404;
    case ErrorCodes.BAD_REQUEST:
      return 400;
    case ErrorCodes.RATE_LIMITED:
      return 429;
    case ErrorCodes.UNAVAILABLE:
    case ErrorCodes.NOT_SUPPORTED:
      return 503;
    case ErrorCodes.TIMEOUT:
      return 504;
    default:
      return 502;
  }
}
