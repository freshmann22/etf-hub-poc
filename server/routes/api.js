// ETF 허브 API 라우터 — 순수 node:http 핸들러(외부 의존성 없음).
// GET 전용, JSON 응답. 오류는 표준 오류코드→HTTP 상태로 매핑하며 비밀값을 절대 싣지 않는다.
import { etfService as defaultService } from '../services/etf-service.js';
import { describeConfig } from '../config.js';
import { ProviderError, errorCodeToHttp, classifyError, ErrorCodes } from '../lib/errors.js';

const API_PREFIX = '/api';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function errorPayload(err) {
  if (err instanceof ProviderError) {
    return { status: errorCodeToHttp(err.code), body: { error: err.code } };
  }
  const { errorCode } = classifyError(err);
  return { status: errorCodeToHttp(errorCode) || 502, body: { error: errorCode } };
}

// 경로 매칭: /api/etf/:code/:field
function matchEtf(pathname) {
  const m = pathname.match(/^\/api\/etf\/([^/]+)\/([a-zA-Z]+)\/?$/);
  if (!m) return null;
  return { code: decodeURIComponent(m[1]), field: m[2] };
}

const ETF_FIELD_METHOD = {
  price: 'getEtfPrice',
  summary: 'getEtfSummary',
  holdings: 'getEtfHoldings',
  performance: 'getEtfPerformance',
  distributions: 'getEtfDistributions',
  disclosures: 'getEtfDisclosures',
};

/**
 * API 요청을 처리한다. 처리했으면 true, 이 라우터 소관이 아니면 false 를 반환한다.
 * service 주입 가능(테스트용).
 */
export async function handleApiRequest(req, res, { service = defaultService } = {}) {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return false;
  }
  if (!pathname.startsWith(API_PREFIX)) return false;

  // API 는 GET 만 허용.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: ErrorCodes.BAD_REQUEST });
    return true;
  }

  try {
    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (pathname === '/api/config') {
      sendJson(res, 200, describeConfig());
      return true;
    }
    if (pathname === '/api/providers') {
      sendJson(res, 200, service.describe());
      return true;
    }
    if (pathname === '/api/bundle') {
      const bundle = await service.getBundle();
      sendJson(res, 200, bundle);
      return true;
    }

    const etf = matchEtf(pathname);
    // 차트용 캔들: /api/etf/:code/candles?interval=1d|1m&count=N
    if (etf && etf.field === 'candles') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const interval = q.get('interval') === '1m' ? '1m' : '1d';
      // count>200 은 서비스/Toss 에서 before 커서로 페이지네이션(1Y/3Y). 상한은 남용 방지용.
      const count = Math.min(Math.max(parseInt(q.get('count') || '60', 10) || 60, 2), 1000);
      const env = await service.getEtfCandles(etf.code, { interval, count });
      sendJson(res, 200, env);
      return true;
    }
    if (etf) {
      const method = ETF_FIELD_METHOD[etf.field];
      if (!method) {
        sendJson(res, 404, { error: ErrorCodes.NOT_FOUND });
        return true;
      }
      const env = await service[method](etf.code);
      // 데이터가 없더라도(정직한 unavailable) 200 + envelope 로 반환한다 —
      // 상태는 meta.status 로 전달(프런트가 표기). 라우팅/파싱 오류만 4xx/5xx.
      sendJson(res, 200, env);
      return true;
    }

    sendJson(res, 404, { error: ErrorCodes.NOT_FOUND });
    return true;
  } catch (err) {
    const { status, body } = errorPayload(err);
    sendJson(res, status, body);
    return true;
  }
}

export default handleApiRequest;
