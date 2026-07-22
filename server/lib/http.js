// 외부 호출용 안전 fetch 래퍼.
// - 호스트 allowlist 강제(임의 URL 요청 금지)
// - timeout(AbortController)
// - 제한된 횟수의 exponential backoff (무한 재시도 금지)
// - 응답 크기 상한
// - rate-limit(429) 감지
import { ProviderError, ErrorCodes } from './errors.js';

// 요청 허용 호스트 화이트리스트. 여기 없는 호스트는 요청하지 않는다.
export const DEFAULT_ALLOWLIST = [
  'data.krx.co.kr',
  'open.krx.co.kr',
  'openapi.krx.co.kr',
  'kind.krx.co.kr',
  'seibro.or.kr',
  'www.seibro.or.kr',
  'opendart.fss.or.kr',
  'openapi.tossinvest.com',
  'apis.data.go.kr',
  'investments.miraeasset.com',
  'www.samsungfund.com',
];

function hostAllowed(urlStr, allowlist) {
  let host;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return false;
  }
  return allowlist.some((h) => host === h || host.endsWith('.' + h));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 안전 fetch. 텍스트를 반환(파싱은 provider 책임).
 * opts: { method, headers, body, timeoutMs, retries, backoffBaseMs, maxBytes, allowlist, provider }
 */
export async function safeFetchText(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = 8000,
    retries = 2, // 최초 1회 + 재시도 2회
    backoffBaseMs = 300,
    maxBytes = 5 * 1024 * 1024,
    allowlist = DEFAULT_ALLOWLIST,
    provider = null,
  } = opts;

  if (!hostAllowed(url, allowlist)) {
    throw new ProviderError(
      ErrorCodes.BAD_REQUEST,
      'URL host not in allowlist',
      { provider }
    );
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429) {
        throw new ProviderError(ErrorCodes.RATE_LIMITED, 'rate limited', {
          retryable: true,
          provider,
        });
      }
      if (!res.ok) {
        throw new ProviderError(
          ErrorCodes.UPSTREAM_ERROR,
          `upstream ${res.status}`,
          { retryable: res.status >= 500, provider }
        );
      }

      // 크기 상한 체크
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > maxBytes) {
        throw new ProviderError(ErrorCodes.PARSE_ERROR, 'response too large', { provider });
      }
      const text = await res.text();
      if (text.length > maxBytes) {
        throw new ProviderError(ErrorCodes.PARSE_ERROR, 'response too large', { provider });
      }
      return text;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err && err.name === 'AbortError';
      const wrapped = isAbort
        ? new ProviderError(ErrorCodes.TIMEOUT, 'request timeout', { retryable: true, provider })
        : err;
      lastErr = wrapped;

      const retryable = wrapped instanceof ProviderError ? wrapped.retryable : false;
      if (attempt < retries && retryable) {
        // 지수 백오프 (상한 있는 유한 재시도)
        await sleep(backoffBaseMs * Math.pow(2, attempt));
        continue;
      }
      throw wrapped;
    }
  }
  throw lastErr;
}

/** JSON 파싱까지 (script 실행 없음 — 순수 JSON.parse). */
export async function safeFetchJson(url, opts = {}) {
  const text = await safeFetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ProviderError(ErrorCodes.PARSE_ERROR, 'invalid JSON', { provider: opts.provider });
  }
}
