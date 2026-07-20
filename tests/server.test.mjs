// 서버 데이터 공급 계층 테스트 (node --test, 러너 의존성 없음).
// 결정적 테스트만 — 외부 네트워크를 호출하지 않는다(mock/비활성 provider 로 고정).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nullify,
  parseNumber,
  normalizeCode,
  toSeoulIso,
  toPercent,
  signOf,
  computeDelay,
  cleanText,
} from '../server/lib/normalize.js';
import { TtlCache } from '../server/lib/cache.js';
import { makeMeta, envelope, combineStatus } from '../server/schemas/etf.js';
import { Status, errorCodeToHttp, ErrorCodes } from '../server/lib/errors.js';
import { createRegistry } from '../server/providers/registry.js';
import { createEtfService } from '../server/services/etf-service.js';
import { handleApiRequest } from '../server/routes/api.js';
import { createReverseSearchQueryPlanner } from '../server/services/reverse-search-query-planner.js';
import { OpenRouterQueryPlannerClient } from '../server/llm/openrouter-query-planner.js';
import { IssuerProvider, buildKoreanIsin, parseTigerHoldingsHtml } from '../server/providers/issuer/index.js';
import { OpenRouterTagBriefClient } from '../server/llm/openrouter-tag-brief.js';

// ---------------------------------------------------------------------------
// 공용 픽스처
// ---------------------------------------------------------------------------
function makeConfig(o = {}) {
  return {
    mode: o.mode || 'mock',
    defaultProvider: 'mock',
    port: 4173,
    bundleOverlay: !!o.bundleOverlay,
    cache: { priceTtlSec: 60, metadataTtlSec: 86400, holdingsTtlSec: 21600, swrSec: 120 },
    http: { timeoutMs: 8000, retries: 2 },
    providers: {
      mock: { enabled: true },
      krx: { enabled: o.krxEnabled === true }, // 기본 false → 네트워크 차단
      kind: { enabled: false },
      seibro: { enabled: false },
      dart: { apiKey: '' },
      broker: { baseUrl: '', apiKey: '', apiSecret: '', accountProfile: '' },
        issuer: { enabled: false },
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    _ended: false,
    writeHead(s, h) {
      this.statusCode = s;
      this.headers = h || {};
      return this;
    },
    end(b) {
      if (b !== undefined) this.body = String(b);
      this._ended = true;
    },
    get headersSent() {
      return this.statusCode !== null;
    },
  };
}

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------
test('normalize: nullify collapses blanks/dashes to null', () => {
  assert.equal(nullify('-'), null);
  assert.equal(nullify('  '), null);
  assert.equal(nullify('N/A'), null);
  assert.equal(nullify('삼성전자'), '삼성전자');
  assert.equal(nullify(0), 0);
});

test('normalize: parseNumber strips commas/percent/currency, rejects NaN', () => {
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('12.5%'), 12.5);
  assert.equal(parseNumber('₩38,250'), 38250);
  assert.equal(parseNumber('-'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(42), 42);
});

test('normalize: normalizeCode pads to 6 digits, rejects overflow', () => {
  assert.equal(normalizeCode('5930'), '005930');
  assert.equal(normalizeCode('A005930'), '005930');
  assert.equal(normalizeCode('069500'), '069500');
  assert.equal(normalizeCode('1234567'), null);
  assert.equal(normalizeCode('-'), null);
});

test('normalize: toSeoulIso handles YYYYMMDD / YYYY-MM-DD / epoch', () => {
  assert.equal(toSeoulIso('20260710'), '2026-07-10T00:00:00+09:00');
  assert.equal(toSeoulIso('2026-07-10'), '2026-07-10T00:00:00+09:00');
  assert.equal(toSeoulIso('-'), null);
  assert.equal(toSeoulIso('not-a-date'), null);
  // epoch(ms) → KST 벽시계
  assert.equal(toSeoulIso(0), '1970-01-01T09:00:00+09:00');
});

test('normalize: toPercent / signOf', () => {
  assert.equal(toPercent(0.0125, { fromRatio: true }), 1.25);
  assert.equal(toPercent('1.25%'), 1.25);
  assert.equal(signOf('2.1'), 1);
  assert.equal(signOf('-3'), -1);
  assert.equal(signOf('0'), 0);
  assert.equal(signOf('-'), null);
});

test('normalize: computeDelay uses injected now', () => {
  const asOf = '2026-07-10T00:00:00+09:00';
  const now = new Date('2026-07-10T00:05:00+09:00').getTime();
  const r = computeDelay(asOf, { now, thresholdMinutes: 1 });
  assert.equal(r.delayMinutes, 5);
  assert.equal(r.isDelayed, true);
  assert.deepEqual(computeDelay(null, { now }), { delayMinutes: null, isDelayed: false });
});

test('normalize: cleanText squashes whitespace', () => {
  assert.equal(cleanText('  삼성   전자 '), '삼성 전자');
  assert.equal(cleanText('-'), null);
});

// ---------------------------------------------------------------------------
// schemas: makeMeta / envelope / combineStatus
// ---------------------------------------------------------------------------
test('schemas: makeMeta marks stale when delayed beyond threshold', () => {
  const asOf = '2026-07-10T00:00:00+09:00';
  const now = new Date('2026-07-10T01:00:00+09:00').getTime();
  const m = makeMeta({ source: 'krx', asOfDate: asOf, now, delayThresholdMinutes: 1 });
  assert.equal(m.source, 'krx');
  assert.equal(m.isDelayed, true);
  assert.equal(m.status, Status.STALE); // ok + delayed → stale
  assert.equal(m.delayMinutes, 60);
});

test('schemas: envelope wraps data+meta; combineStatus aggregates', () => {
  const e = envelope([1, 2], { status: Status.OK });
  assert.deepEqual(e.data, [1, 2]);
  assert.equal(combineStatus([]), Status.UNAVAILABLE);
  assert.equal(combineStatus([{ status: Status.OK }, { status: Status.OK }]), Status.OK);
  assert.equal(combineStatus([{ status: Status.OK }, { status: Status.STALE }]), Status.STALE);
  assert.equal(combineStatus([{ status: Status.OK }, { status: Status.PARTIAL }]), Status.PARTIAL);
  assert.equal(combineStatus([{ status: Status.UNAVAILABLE }, { status: Status.UNAVAILABLE }]), Status.UNAVAILABLE);
});

// ---------------------------------------------------------------------------
// cache: TTL + SWR + dedup (주입된 now)
// ---------------------------------------------------------------------------
test('cache: fresh hit, stale serve, expired refetch', async () => {
  let t = 1000;
  const cache = new TtlCache({ now: () => t });
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return `v${calls}`;
  };
  const opt = { ttlMs: 100, swrMs: 50 };

  const r1 = await cache.resolve('k', fetcher, opt);
  assert.equal(r1.value, 'v1');
  assert.equal(r1.fromCache, false);

  t = 1050; // ttl 내 → fresh
  const r2 = await cache.resolve('k', fetcher, opt);
  assert.equal(r2.value, 'v1');
  assert.equal(r2.fromCache, true);
  assert.equal(r2.state, 'fresh');
  assert.equal(calls, 1);

  t = 1120; // ttl 초과, swr 내 → stale 즉시 반환 + 백그라운드 갱신
  const r3 = await cache.resolve('k', fetcher, opt);
  assert.equal(r3.value, 'v1');
  assert.equal(r3.state, 'stale');
  await new Promise((r) => setTimeout(r, 0)); // 백그라운드 갱신 완료 대기
  assert.equal(calls, 2);

  t = 5000; // ttl+swr 초과 → expired, 재조회 대기
  const r4 = await cache.resolve('k', fetcher, opt);
  assert.equal(r4.fromCache, false);
  assert.equal(r4.value, 'v3');
});

test('cache: concurrent miss dedups to a single fetch', async () => {
  const cache = new TtlCache({ now: () => 0 });
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return 'x';
  };
  const [a, b] = await Promise.all([
    cache.resolve('k', fetcher, { ttlMs: 100 }),
    cache.resolve('k', fetcher, { ttlMs: 100 }),
  ]);
  assert.equal(a.value, 'x');
  assert.equal(b.value, 'x');
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------
test('registry: builds all providers; mock available, disabled krx unavailable', () => {
  const reg = createRegistry(makeConfig({ mode: 'hybrid', krxEnabled: false }));
  const ids = reg.ids;
  for (const id of ['mock', 'krx', 'kind', 'seibro', 'dart', 'toss', 'broker', 'issuer', 'publicdata']) {
    assert.ok(ids.includes(id), `missing provider ${id}`);
  }
  assert.equal(reg.get('mock').isAvailable(), true);
  assert.equal(reg.get('krx').isAvailable(), false);
  assert.equal(reg.get('broker').isAvailable(), false); // 자격 없음
  assert.equal(reg.get('publicdata').isAvailable(), false); // serviceKey 없음
  const desc = reg.describeAll();
  assert.equal(desc.length, 9);
  assert.ok(desc.every((d) => 'available' in d && 'capabilities' in d));
});

test('issuer: derives Korean ETF ISIN and parses TIGER holdings rows', () => {
  assert.equal(buildKoreanIsin('102110'), 'KR7102110004');
  assert.equal(buildKoreanIsin('069500'), 'KR7069500007');
  const html = `<tr data-tot-cnt="1">
    <td>1</td><td>005930</td><td class="subject">삼성전자</td>
    <td class="price">6,984</td><td class="price">1,777,428,000</td>
    <td class="price">32.72</td><td class="price">-21.09</td>
  </tr>`;
  const parsed = parseTigerHoldingsHtml(html);
  assert.equal(parsed.declaredCount, 1);
  assert.deepEqual(parsed.rows[0], {
    stockCode: '005930', stockName: '삼성전자', weight: 32.72,
    shares: 6984, marketValue: 1777428000, rank: 1, asOfDate: null,
  });
});

test('issuer: fetches official TIGER holdings and rejects unsupported codes honestly', async () => {
  const oldFetch = globalThis.fetch;
  const html = '<tr data-tot-cnt="1"><td>1</td><td>005930</td><td>삼성전자</td><td>10</td><td>1000</td><td>25.5</td><td>0</td></tr>';
  globalThis.fetch = async (_url, init) => {
    assert.match(String(init.body), /ksdFund=KR7102110004/);
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
  };
  try {
    const provider = new IssuerProvider({ enabled: true, retries: 0 });
    const env = await provider.getEtfHoldings('102110');
    assert.equal(env.meta.source, 'issuer_tiger');
    assert.equal(env.data.length, 1);
    assert.equal(env.data[0].stockName, '삼성전자');
    const unsupported = await provider.getEtfHoldings('0000D0');
    assert.deepEqual(unsupported.data, []);
    assert.equal(unsupported.meta.status, Status.UNAVAILABLE);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

// ---------------------------------------------------------------------------
// service — mock 모드
// ---------------------------------------------------------------------------
test('service(mock): getEtfList / getEtfPrice return raw-number envelopes', async () => {
  const svc = createEtfService({ config: makeConfig({ mode: 'mock' }) });
  const list = await svc.getEtfList();
  assert.ok(Array.isArray(list.data) && list.data.length > 0);
  assert.equal(list.meta.source, 'mock');

  const price = await svc.getEtfPrice('069500');
  assert.equal(price.data.code, '069500');
  assert.equal(typeof price.data.price, 'number');

  const missing = await svc.getEtfPrice('999999');
  assert.equal(missing.data, null);
  assert.equal(missing.meta.status, Status.UNAVAILABLE);
});

test('service(mock): getBundle includes all UI collections', async () => {
  const svc = createEtfService({ config: makeConfig({ mode: 'mock' }) });
  const b = await svc.getBundle();
  assert.ok(Array.isArray(b.etfsRaw) && b.etfsRaw.length > 0);
  assert.ok(b.etfsRaw.every((etf) => typeof etf.volume === 'number' || etf.volume === null));
  assert.ok(Array.isArray(b.themesRaw) && b.themesRaw.length > 0);
  assert.ok(Array.isArray(b.stocksRaw));
  assert.ok(Array.isArray(b.holdingsRaw));
  assert.ok(Array.isArray(b.contentsRaw));
  assert.ok(Array.isArray(b.comparisonSetsRaw));
  assert.ok(b.marketSummaryByPeriod && b.marketSummaryByPeriod['1d']);
  assert.equal(b.meta.dataMode, 'mock');
  assert.equal(b.meta.overlay.applied, false);
});

// ---------------------------------------------------------------------------
// service — live/hybrid 정직성 (네트워크 없음: 실 provider 전부 unavailable)
// ---------------------------------------------------------------------------
test('service(live): no available provider → honest unavailable, not fabricated', async () => {
  const svc = createEtfService({ config: makeConfig({ mode: 'live', krxEnabled: false }) });
  const price = await svc.getEtfPrice('069500');
  assert.equal(price.data, null);
  assert.equal(price.meta.status, Status.UNAVAILABLE);
  const list = await svc.getEtfList();
  assert.deepEqual(list.data, []);
  assert.equal(list.meta.status, Status.UNAVAILABLE);
});

test('service(hybrid): falls back to mock and flags it in meta', async () => {
  const svc = createEtfService({ config: makeConfig({ mode: 'hybrid', krxEnabled: false }) });
  const price = await svc.getEtfPrice('069500');
  assert.equal(price.data.code, '069500');
  assert.equal(price.meta.source, 'mock');
  assert.equal(price.meta.fallback, true);
});

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
test('router: ignores non-/api paths', async () => {
  const svc = createEtfService({ config: makeConfig() });
  const res = fakeRes();
  const handled = await handleApiRequest({ method: 'GET', url: '/index.html' }, res, { service: svc });
  assert.equal(handled, false);
});

test('router: /api/health and /api/bundle', async () => {
  const svc = createEtfService({ config: makeConfig() });
  const r1 = fakeRes();
  await handleApiRequest({ method: 'GET', url: '/api/health' }, r1, { service: svc });
  assert.equal(r1.statusCode, 200);
  assert.deepEqual(JSON.parse(r1.body), { ok: true });

  const r2 = fakeRes();
  await handleApiRequest({ method: 'GET', url: '/api/bundle' }, r2, { service: svc });
  assert.equal(r2.statusCode, 200);
  const bundle = JSON.parse(r2.body);
  assert.ok(bundle.etfsRaw.length > 0 && bundle.themesRaw.length > 0);
});

test('router: /api/etf/:code/:field routes to service', async () => {
  const svc = createEtfService({ config: makeConfig() });
  const res = fakeRes();
  await handleApiRequest({ method: 'GET', url: '/api/etf/069500/price' }, res, { service: svc });
  assert.equal(res.statusCode, 200);
  const env = JSON.parse(res.body);
  assert.equal(env.data.code, '069500');
  assert.ok(env.meta && typeof env.meta.status === 'string');
});

test('router: unknown field → 404, non-GET → 405', async () => {
  const svc = createEtfService({ config: makeConfig() });
  const r404 = fakeRes();
  await handleApiRequest({ method: 'GET', url: '/api/etf/069500/bogus' }, r404, { service: svc });
  assert.equal(r404.statusCode, 404);

  const r405 = fakeRes();
  await handleApiRequest({ method: 'POST', url: '/api/bundle' }, r405, { service: svc });
  assert.equal(r405.statusCode, 405);
});

test('router: reverse-search planner accepts POST and returns a validated plan', async () => {
  const req = {
    method: 'POST',
    url: '/api/reverse-search/plan',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ query: '반도체 ETF' }));
    },
  };
  const queryPlanner = {
    async createPlan(query) {
      return { source: 'rules', taxonomyVersion: '2.0.0', warnings: [], plan: { intent: 'TAG_MATCH', query, tags: [] } };
    },
  };
  const res = fakeRes();
  await handleApiRequest(req, res, { service: createEtfService({ config: makeConfig() }), queryPlanner });
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.source, 'rules');
  assert.equal(payload.plan.query, '반도체 ETF');
});

test('reverse-search planner validates LLM output against canonical taxonomy', async () => {
  const planner = createReverseSearchQueryPlanner({
    llmClient: {
      async createPlan() {
        return {
          intent: 'TAG_MATCH',
          tags: [
            { tagId: 'sector.semiconductor', queryScore: 0.92, mode: 'required', reason: 'direct match' },
            { tagId: 'sector.fabricated', queryScore: 1, mode: 'required' },
          ],
        };
      },
    },
  });
  const result = await planner.createPlan('반도체 ETF');
  assert.equal(result.source, 'llm');
  assert.deepEqual(result.plan.tags.map((tag) => tag.tagId), ['sector.semiconductor']);
  assert.deepEqual(result.warnings, ['unknown_tag:sector.fabricated']);
});

test('openrouter query planner sends a structured request and parses JSON content', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'TAG_MATCH',
        tags: [{ tagId: 'sector.semiconductor', queryScore: 0.9, mode: 'required', reason: '반도체 요청' }],
        sort: null,
      }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const client = new OpenRouterQueryPlannerClient({
      apiKey: 'SECRET_KEY',
      model: 'deepseek/deepseek-v4-flash',
      retries: 0,
    });
    const plan = await client.createPlan({
      query: '반도체 ETF',
      taxonomy: { tags: [{ id: 'sector.semiconductor', facet: 'sector', label: '반도체', definition: '반도체 ETF', enabled: true }] },
    });
    assert.equal(plan.tags[0].tagId, 'sector.semiconductor');
    assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(captured.options.headers.Authorization, 'Bearer SECRET_KEY');
    const body = JSON.parse(captured.options.body);
    assert.equal(body.model, 'deepseek/deepseek-v4-flash');
    assert.deepEqual(body.response_format, { type: 'json_object' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('openrouter tag-brief client sends evidence and validates JSON content', async () => {
  const oldFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: '반도체 브리핑',
        summary: '공급 계약 소식이 있었어요.',
        keyPoints: ['공급 계약이 발표됐어요.'],
        mentionedStockIds: ['005930', '005930'],
        mentionedTopicIds: [],
      }) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new OpenRouterTagBriefClient({ apiKey: 'secret', model: 'test/model', retries: 0 });
    const content = await client.createContent({
      tagUniverse: { tagId: 'sector.semiconductor', label: '반도체', stockIds: ['005930'], topicIds: [], etfIds: [] },
      articles: [{ id: 'n1', title: '계약 발표', summary: '공급 계약 체결', source: '테스트', publishedAt: '2026-07-16', mentionedStockIds: ['005930'], mentionedTopicIds: [] }],
    });
    assert.equal(requestBody.model, 'test/model');
    assert.ok(requestBody.messages[1].content.includes('n1'));
    assert.deepEqual(content.mentionedStockIds, ['005930']);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

// ---------------------------------------------------------------------------
// 오류코드 → HTTP 매핑
// ---------------------------------------------------------------------------
test('errors: errorCodeToHttp mapping', () => {
  assert.equal(errorCodeToHttp(ErrorCodes.NOT_FOUND), 404);
  assert.equal(errorCodeToHttp(ErrorCodes.RATE_LIMITED), 429);
  assert.equal(errorCodeToHttp(ErrorCodes.UNAVAILABLE), 503);
  assert.equal(errorCodeToHttp(ErrorCodes.TIMEOUT), 504);
  assert.equal(errorCodeToHttp(ErrorCodes.UPSTREAM_ERROR), 502);
});

// ---------------------------------------------------------------------------
// 비밀값 비노출 — 자격을 넣어도 describeConfig 는 상태만 노출한다
// ---------------------------------------------------------------------------
test('config: describeConfig never leaks secret values', async () => {
  process.env.DART_API_KEY = 'SECRET_SHOULD_NOT_LEAK';
  process.env.BROKER_API_KEY = 'BROKER_SECRET_XYZ';
  process.env.BROKER_API_SECRET = 'BROKER_SECRET_XYZ';
  process.env.OPENROUTER_API_KEY = 'OPENROUTER_SECRET_XYZ';
  process.env.BROKER_API_BASE_URL = 'https://example.invalid';
  // 캐시버스터로 새 모듈 인스턴스를 만들어 현재 env 를 반영.
  const mod = await import('../server/config.js?secrettest=1');
  const d = mod.describeConfig();
  const serialized = JSON.stringify(d);
  assert.ok(!serialized.includes('SECRET_SHOULD_NOT_LEAK'));
  assert.ok(!serialized.includes('OPENROUTER_SECRET_XYZ'));
  assert.equal(d.reverseSearch.configured, true);
  assert.ok(!serialized.includes('BROKER_SECRET_XYZ'));
  assert.equal(d.providers.dart, 'configured');
  assert.equal(d.providers.broker, 'configured');
  // 값 자체가 아니라 상태 문자열만.
  for (const v of Object.values(d.providers)) {
    assert.ok(v === 'configured' || v === 'unconfigured');
  }
  delete process.env.DART_API_KEY;
  delete process.env.BROKER_API_KEY;
  delete process.env.BROKER_API_SECRET;
  delete process.env.BROKER_API_BASE_URL;
});

// ---------------------------------------------------------------------------
// toss provider — OAuth2 + prices + candles (네트워크 모킹, 결정적)
// ---------------------------------------------------------------------------
test('toss: token→prices→candles yields price & changeRate; token is reused', async () => {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'TESTTOKEN', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('/api/v1/prices')) {
      return new Response(JSON.stringify({ result: [
        { symbol: '069500', lastPrice: '107875', currency: 'KRW', timestamp: '2026-07-14T11:00:00+09:00' },
      ] }), { status: 200 });
    }
    if (u.includes('/api/v1/candles')) {
      // 최신순: [당일, 전일]. 전일 종가 108820.
      return new Response(JSON.stringify({ result: { candles: [
        { closePrice: '107855' }, { closePrice: '108820' },
      ] } }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const { TossProvider } = await import('../server/providers/toss/index.js');
    const p = new TossProvider({ clientId: 'id', clientSecret: 'sec', timeoutMs: 5000, retries: 0 });
    assert.equal(p.isAvailable(), true);
    const env = await p.getEtfPrice('069500');
    assert.equal(env.data.code, '069500');
    assert.equal(env.data.price, 107875);
    assert.equal(env.data.change, 107875 - 108820);
    assert.equal(env.data.changeRate, -0.87); // (107875-108820)/108820*100 반올림
    assert.equal(env.meta.source, 'toss');
    // asOf(모의 타임스탬프)가 현재보다 과거이면 지연(stale)로 표기되는 것이 정상.
    assert.ok([Status.OK, Status.STALE].includes(env.meta.status));
    // 토큰은 1회만 발급되어 재사용된다.
    assert.equal(calls.filter((c) => c.includes('/oauth2/token')).length, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

test('toss: computes return1w/return1m/tradingValue from daily candles', async () => {
  // 22개 일봉(최신순). index 0=당일,1=전일,5=주간기준,20=월간기준.
  const candles = [];
  for (let i = 0; i < 22; i++) candles.push({ closePrice: '90000', volume: '1000000' });
  candles[0] = { closePrice: '100000', volume: '12000000' }; // tvToday = 100000*12e6/1e8 = 12000
  candles[1] = { closePrice: '98000', volume: '10000000' };  // tvPrev  = 98000*1e7/1e8  = 9800
  candles[5] = { closePrice: '95000', volume: '1000000' };
  candles[20] = { closePrice: '80000', volume: '1000000' };

  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 }), { status: 200 });
    if (u.includes('/api/v1/prices')) return new Response(JSON.stringify({ result: [{ symbol: '069500', lastPrice: '100000', currency: 'KRW' }] }), { status: 200 });
    if (u.includes('/api/v1/candles')) return new Response(JSON.stringify({ result: { candles } }), { status: 200 });
    return new Response('x', { status: 404 });
  };
  try {
    const { TossProvider } = await import('../server/providers/toss/index.js');
    const p = new TossProvider({ clientId: 'id', clientSecret: 'sec', retries: 0 });
    const q = (await p.getQuotes(['069500'])).get('069500');
    assert.equal(q.price, 100000);
    assert.equal(q.changeRate, 2.04); // vs 98000
    assert.equal(q.return1w, 5.26); // vs 95000
    assert.equal(q.return1m, 25); // vs 80000
    assert.equal(q.volume, 12000000);
    assert.equal(q.tradingValue, 12000); // 억원
    assert.equal(q.tradingValueChangeRate, 22.45); // 12000 vs 9800
  } finally {
    globalThis.fetch = orig;
  }
});

test('toss: getQuotes batches prices; missing price → null change', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 }), { status: 200 });
    if (u.includes('/api/v1/prices')) {
      return new Response(JSON.stringify({ result: [
        { symbol: '069500', lastPrice: '100000', currency: 'KRW' },
      ] }), { status: 200 });
    }
    if (u.includes('/api/v1/candles')) return new Response(JSON.stringify({ result: { candles: [{ closePrice: '99000' }, { closePrice: '95000' }] } }), { status: 200 });
    return new Response('x', { status: 404 });
  };
  try {
    const { TossProvider } = await import('../server/providers/toss/index.js');
    const p = new TossProvider({ clientId: 'id', clientSecret: 'sec', retries: 0 });
    const q = await p.getQuotes(['069500', '999999']);
    assert.equal(q.get('069500').price, 100000);
    assert.equal(q.get('069500').changeRate, 5.26); // (100000-95000)/95000*100
    assert.equal(q.get('999999').price, null);
    assert.equal(q.get('999999').changeRate, null);
  } finally {
    globalThis.fetch = orig;
  }
});

test('toss: unavailable without credentials', async () => {
  const { TossProvider } = await import('../server/providers/toss/index.js');
  const p = new TossProvider({});
  assert.equal(p.isAvailable(), false);
  await assert.rejects(() => p.getEtfPrice('069500'), (e) => e.code === ErrorCodes.UNAVAILABLE);
});

test('registry+service: toss is registered and preferred for price', async () => {
  const cfg = makeConfig({ mode: 'hybrid' });
  cfg.providers.toss = { clientId: '', clientSecret: '' }; // 미설정 → unavailable
  const reg = createRegistry(cfg);
  assert.ok(reg.ids.includes('toss'));
  assert.equal(reg.get('toss').isAvailable(), false);
  // toss 미가용 + krx 비활성 → hybrid 는 mock 폴백(정직).
  const svc = createEtfService({ config: cfg, registry: reg });
  const price = await svc.getEtfPrice('069500');
  assert.equal(price.meta.fallback, true);
});

// ---------------------------------------------------------------------------
// publicdata provider (공공데이터 ETF 전종목) — 네트워크 모킹
// ---------------------------------------------------------------------------
function pdRow(code, name, over = {}) {
  return {
    basDt: '20260713', srtnCd: code, isinCd: 'KR' + code, itmsNm: name,
    clpr: '10000', vs: '100', fltRt: '1.01', trqu: '1000', trPrc: '100000000',
    nPptTotAmt: '50000000000', mrktTotAmt: '50000000000', nav: '10001',
    bssIdxIdxNm: '테스트지수', bssIdxClpr: '100', stLstgCnt: '1000000', ...over,
  };
}
function pdResponse(rows) {
  return new Response(JSON.stringify({
    response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { totalCount: rows.length, items: { item: rows } } },
  }), { status: 200 });
}

test('publicdata: lists ETFs and converts amounts to 억원 (mocked)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => pdResponse([pdRow('069500', 'KODEX 200'), pdRow('900001', '새 ETF A')]);
  try {
    const { PublicDataProvider } = await import('../server/providers/publicdata/index.js');
    const p = new PublicDataProvider({ serviceKey: 'k', enabled: true, retries: 0 });
    assert.equal(p.isAvailable(), true);
    const env = await p.getEtfList();
    assert.equal(env.data.length, 2);
    const kodex = env.data.find((r) => r.code === '069500');
    assert.equal(kodex.name, 'KODEX 200');
    assert.equal(kodex.prevClose, 10000);
    assert.equal(kodex.netAssets, 500); // 50,000,000,000 / 1e8 = 500 억원
    assert.equal(kodex.volume, 1000);
    assert.equal(kodex.tradingValue, 1); // 100,000,000 / 1e8 = 1 억원
    assert.equal(kodex.indexName, '테스트지수');
    assert.equal(env.meta.source, 'publicdata');
  } finally {
    globalThis.fetch = orig;
  }
});

test('publicdata: unavailable without serviceKey', async () => {
  const { PublicDataProvider } = await import('../server/providers/publicdata/index.js');
  assert.equal(new PublicDataProvider({ serviceKey: '', enabled: true }).isAvailable(), false);
  assert.equal(new PublicDataProvider({ serviceKey: 'k', enabled: false }).isAvailable(), false);
  const p = new PublicDataProvider({ serviceKey: '', enabled: true });
  await assert.rejects(() => p.getEtfList(), (e) => e.code === ErrorCodes.UNAVAILABLE);
});

test('service: publicdata expands universe with thin ETFs (toss off)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => pdResponse([
    pdRow('069500', 'KODEX 200'), // fixture 코드와 매칭 → 큐레이션 보강
    pdRow('900001', '신규 ETF A'), // thin 추가
    pdRow('900002', '신규 ETF B'), // thin 추가
  ]);
  try {
    const cfg = makeConfig({ mode: 'hybrid', bundleOverlay: true });
    cfg.providers.publicdata = { serviceKey: 'k', enabled: true };
    cfg.providers.toss = { clientId: '', clientSecret: '' }; // toss off
    const svc = createEtfService({ config: cfg });
    const b = await svc.getBundle();

    assert.equal(b.meta.overlay.universeSource, 'publicdata');
    assert.equal(b.meta.overlay.universeSize, b.etfsRaw.length);
    assert.equal(b.etfsRaw.length, b.meta.overlay.curatedSize + 2); // +2 thin

    // thin ETF 안전성: id/code/name + topHoldings 배열(렌더 필수).
    const thin = b.etfsRaw.find((e) => e.code === '900001');
    assert.ok(thin && thin.id === 'etf-900001' && thin.name === '신규 ETF A');
    assert.equal(thin.themeId, null);
    assert.ok(Array.isArray(thin.topHoldings));
    assert.equal(thin.currentPrice, 10000); // toss off → 공공데이터 종가
    assert.equal(thin.volume, 1000);
    assert.equal(thin.netAssets, 500);
    // 모든 유니버스 항목이 렌더 안전(topHoldings 배열 + id/code/name).
    assert.ok(b.etfsRaw.every((e) => e.id && e.code && e.name && Array.isArray(e.topHoldings)));
    // 내부 필드 미노출.
    assert.ok(!b.etfsRaw.some((e) => '_curated' in e || '_prevClose' in e));

    // 큐레이션 보강: 069500 은 fixture 관계 유지 + 공공데이터 순자산 반영.
    const kodex = b.etfsRaw.find((e) => e.code === '069500');
    assert.equal(kodex.themeId, 'theme-index');
    assert.equal(kodex.topHoldings.length, 3);
    assert.equal(kodex.netAssets, 500);
  } finally {
    globalThis.fetch = orig;
  }
});
