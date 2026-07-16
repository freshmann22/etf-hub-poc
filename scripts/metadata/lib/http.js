// ETF 메타데이터 수집 전용 안전 fetch 래퍼.
// server/lib/http.js 와 같은 원칙(호스트 allowlist, timeout, 유한 재시도+backoff, 응답 크기 상한)을
// 이 파이프라인이 실제로 쓰는 무인증 소스(finance.naver.com, navercomp.wisereport.co.kr)에 맞춰 재구현한다.
// (server/lib/http.js 는 서버 provider 전용 allowlist라 여기 소스가 없어 재사용하지 않음.)

export const ALLOWLIST = ['finance.naver.com', 'navercomp.wisereport.co.kr'];

const USER_AGENT =
  'Mozilla/5.0 (compatible; etf-hub-metadata-pipeline/0.1; personal-poc; +local-only)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hostAllowed(urlStr) {
  let host;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return false;
  }
  return ALLOWLIST.some((h) => host === h || host.endsWith('.' + h));
}

/**
 * 안전 fetch. opts: { timeoutMs, retries, backoffBaseMs, maxBytes, encoding }
 * encoding: 'utf-8'(기본) | 'euc-kr' — 소스별 실제 응답 인코딩(실측 확인 필요, 추정 금지).
 */
export async function safeFetchText(url, opts = {}) {
  const {
    timeoutMs = 8000,
    retries = 2,
    backoffBaseMs = 500,
    maxBytes = 5 * 1024 * 1024,
    encoding = 'utf-8',
  } = opts;

  if (!hostAllowed(url)) {
    throw new Error(`허용되지 않은 호스트: ${url}`);
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        throw Object.assign(new Error('rate limited'), { retryable: true, status: 429 });
      }
      if (!res.ok) {
        throw Object.assign(new Error(`upstream ${res.status}`), {
          retryable: res.status >= 500,
          status: res.status,
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) {
        throw new Error('response too large');
      }
      return new TextDecoder(encoding).decode(buf);
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err && err.name === 'AbortError';
      const wrapped = isAbort ? Object.assign(new Error('request timeout'), { retryable: true }) : err;
      lastErr = wrapped;
      if (attempt < retries && wrapped.retryable) {
        await sleep(backoffBaseMs * Math.pow(2, attempt));
        continue;
      }
      throw wrapped;
    }
  }
  throw lastErr;
}

export async function safeFetchJson(url, opts = {}) {
  const text = await safeFetchText(url, opts);
  return JSON.parse(text);
}

export { sleep };
