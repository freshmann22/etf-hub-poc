// ETF 구성자산 파이프라인 테스트 (node:test).
// 대상: Normalizer / BusinessValidator / Orchestrator(fallback) / Repository + e2e.
// 오케스트레이터/e2e 는 workstream A 의 schemaValidator 를 import 한다(통합 시 존재).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  ASSET_TYPE,
  PROVIDER,
  COLLECTION_STATUS,
} from '../server/holdings/constants.js';

import { normalize } from '../server/holdings/normalizer.js';
import { validateBusiness } from '../server/holdings/businessValidator.js';
import { resolveHoldings } from '../server/holdings/orchestrator.js';
import {
  getEtfHoldings,
  getEtfHoldingSummary,
  getCollectionStatus,
} from '../server/holdings/repository.js';
import { validateHoldingsDocument } from '../server/holdings/schemaValidator.js';

// ---------------------------------------------------------------------------
// 테스트용 가짜 공급자.
// ---------------------------------------------------------------------------
class FakeProvider {
  constructor(name, responder) {
    this.name = name;
    this._responder = responder;
    this.calls = 0;
  }
  isImplemented() {
    return true;
  }
  async fetchRaw(etfCode, baseDate) {
    this.calls += 1;
    return typeof this._responder === 'function'
      ? this._responder(etfCode, baseDate)
      : this._responder;
  }
}

function rawOk(rows, extra = {}) {
  return {
    ok: true,
    provider: PROVIDER.PYKRX,
    status: COLLECTION_STATUS.OK,
    sourceType: 'MOCK',
    raw: { etfName: 'TEST ETF', baseDate: '20260713', rows, ...extra },
  };
}
function rawNotImplemented(provider) {
  return {
    ok: false,
    provider,
    status: COLLECTION_STATUS.NOT_IMPLEMENTED,
    sourceType: null,
    raw: null,
    message: 'not implemented',
  };
}

const SAMPLE_ROWS = [
  { 종목코드: '005930', 종목명: '삼성전자', 유형: '주식', 비중: '60', 수량: '100' },
  { 종목코드: '000660', 종목명: 'SK하이닉스', 유형: '주식', 비중: '40', 수량: '80' },
];

// 최소 유효 문서(비즈니스 검증용).
function makeDoc(holdings, overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    etfCode: '069500',
    etfName: 'KODEX 200',
    baseDate: '2026-07-13',
    generatedAt: '2026-07-13T09:00:00+09:00',
    source: { provider: PROVIDER.MOCK, sourceType: null, isFallback: false },
    collection: { status: 'OK', attemptedProviders: [PROVIDER.MOCK], message: null },
    holdings,
    ...overrides,
  };
}

// ===========================================================================
// Normalizer
// ===========================================================================
test('normalizer: pykrx 유사 원시(한글 키) → 공통 스키마 매핑', () => {
  const raw = {
    etfName: 'KODEX 200',
    baseDate: '20260713',
    rows: [
      { 종목코드: '005930', 종목명: '삼성전자', 유형: '주식', 비중: '30.5', 수량: '1,250,000', 금액: '1,234,000,000', 시장: 'KOSPI', 통화: 'KRW', 순위: 1 },
    ],
  };
  const doc = normalize(raw, { provider: PROVIDER.PYKRX, etfCode: '069500', baseDate: '20260713' });

  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.equal(doc.etfCode, '069500');
  assert.equal(doc.etfName, 'KODEX 200');
  assert.equal(doc.baseDate, '2026-07-13');
  assert.equal(doc.source.provider, PROVIDER.PYKRX);
  assert.match(doc.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  const h = doc.holdings[0];
  assert.equal(h.assetCode, '005930');
  assert.equal(h.assetName, '삼성전자');
  assert.equal(h.assetType, ASSET_TYPE.EQUITY);
  assert.equal(h.market, 'KOSPI');
  assert.equal(h.currency, 'KRW');
  assert.equal(h.weightPct, 30.5);
});

test('normalizer: 콤마 포함 숫자문자열 파싱', () => {
  const doc = normalize({ rows: [{ 종목코드: '005930', 종목명: '삼성전자', 수량: '1,250,000', 금액: '1,234,000,000' }] }, { provider: PROVIDER.MOCK });
  assert.equal(doc.holdings[0].quantity, 1250000);
  assert.equal(doc.holdings[0].marketValue, 1234000000);
});

test('normalizer: NaN/비숫자 → null', () => {
  const doc = normalize({ rows: [{ 종목코드: '005930', 종목명: '삼성전자', 비중: 'abc', 수량: Number.NaN }] }, { provider: PROVIDER.MOCK });
  assert.equal(doc.holdings[0].weightPct, null);
  assert.equal(doc.holdings[0].quantity, null);
});

test('normalizer: quantity 와 contractCount 를 별도 필드로 구분', () => {
  const doc = normalize({
    rows: [
      { 종목코드: 'K2F', 종목명: '코스피200선물', 유형: '선물', 계약수: '1,200', 수량: null },
      { 종목코드: '005930', 종목명: '삼성전자', 유형: '주식', 수량: '500,000', 계약수: null },
    ],
  }, { provider: PROVIDER.MOCK });

  assert.equal(doc.holdings[0].contractCount, 1200);
  assert.equal(doc.holdings[0].quantity, null);
  assert.equal(doc.holdings[0].assetType, ASSET_TYPE.FUTURE);
  assert.equal(doc.holdings[1].quantity, 500000);
  assert.equal(doc.holdings[1].contractCount, null);
});

test('normalizer: rawAssetCode 원본 보존 + 해외코드는 6자리 강제 안함', () => {
  const doc = normalize({
    rows: [
      { assetCode: '5930', assetName: '삼성전자', type: 'EQUITY', weight: '10' },
      { assetCode: 'AAPL', assetName: 'Apple', type: 'EQUITY', weight: '12', currency: 'USD' },
    ],
  }, { provider: PROVIDER.MOCK });

  // 국내: 6자리 zero-pad, 원본 보존.
  assert.equal(doc.holdings[0].assetCode, '005930');
  assert.equal(doc.holdings[0].rawAssetCode, '5930');
  // 해외: 티커 그대로.
  assert.equal(doc.holdings[1].assetCode, 'AAPL');
  assert.equal(doc.holdings[1].rawAssetCode, 'AAPL');
});

test('normalizer: weightPct 는 null(공란)과 0(실제 0%)을 구분', () => {
  const doc = normalize({
    rows: [
      { 종목코드: '005930', 종목명: '삼성전자', 비중: '0' },
      { 종목코드: '000660', 종목명: 'SK하이닉스', 비중: '-' },
      { 종목코드: '035420', 종목명: 'NAVER', 비중: '' },
    ],
  }, { provider: PROVIDER.MOCK });
  assert.equal(doc.holdings[0].weightPct, 0);
  assert.equal(doc.holdings[1].weightPct, null);
  assert.equal(doc.holdings[2].weightPct, null);
});

test('normalizer: 구조적 실패(행 배열 없음) → throw', () => {
  assert.throws(() => normalize({ nope: true }, { provider: PROVIDER.MOCK }));
  assert.throws(() => normalize(null, { provider: PROVIDER.MOCK }));
});

// ===========================================================================
// BusinessValidator
// ===========================================================================
test('businessValidator: 정상 데이터 → OK, error 없음', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: '005930', assetName: '삼성전자', assetType: ASSET_TYPE.EQUITY, weightPct: 60 },
    { assetCode: '000660', assetName: 'SK하이닉스', assetType: ASSET_TYPE.EQUITY, weightPct: 40 },
  ]));
  assert.equal(r.status, COLLECTION_STATUS.OK);
  assert.equal(r.errors.length, 0);
});

test('businessValidator: 빈 holdings → EMPTY + error', () => {
  const r = validateBusiness(makeDoc([]));
  assert.equal(r.status, COLLECTION_STATUS.EMPTY);
  assert.ok(r.errors.length > 0);
});

test('businessValidator: 모든 비중 null → WEIGHT_MISSING(경고, error 아님)', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: '005930', assetName: '삼성전자', assetType: ASSET_TYPE.EQUITY, weightPct: null },
    { assetCode: '000660', assetName: 'SK하이닉스', assetType: ASSET_TYPE.EQUITY, weightPct: null },
  ]));
  assert.equal(r.status, COLLECTION_STATUS.WEIGHT_MISSING);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.length > 0);
});

test('businessValidator: 일부 비중 null → PARTIAL', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: '005930', assetName: '삼성전자', assetType: ASSET_TYPE.EQUITY, weightPct: 50 },
    { assetCode: '000660', assetName: 'SK하이닉스', assetType: ASSET_TYPE.EQUITY, weightPct: null },
  ]));
  assert.equal(r.status, COLLECTION_STATUS.PARTIAL);
  assert.equal(r.errors.length, 0);
});

test('businessValidator: 비중 합계 ≠ 100% → 경고만(절대 error 아님)', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: 'K2F', assetName: '선물', assetType: ASSET_TYPE.FUTURE, weightPct: 95 },
    { assetCode: 'KRW', assetName: '현금', assetType: ASSET_TYPE.CASH, weightPct: 30 },
  ]));
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.includes('100%')));
});

test('businessValidator: 중복 자산 → 경고', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: '005930', assetName: '삼성전자', assetType: ASSET_TYPE.EQUITY, weightPct: 50 },
    { assetCode: '005930', assetName: '삼성전자', assetType: ASSET_TYPE.EQUITY, weightPct: 50 },
  ]));
  assert.ok(r.warnings.some((w) => w.includes('중복')));
});

test('businessValidator: 음수 비중 → 경고(인버스/레버리지 정당), error 아님', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: 'K2F', assetName: '인버스선물', assetType: ASSET_TYPE.FUTURE, weightPct: -100 },
    { assetCode: 'KRW', assetName: '현금', assetType: ASSET_TYPE.CASH, weightPct: 200 },
  ]));
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.includes('음수')));
});

test('businessValidator: NaN/Infinity 비중 → error', () => {
  const r = validateBusiness(makeDoc([
    { assetCode: '005930', assetName: '삼성전자', assetType: ASSET_TYPE.EQUITY, weightPct: Number.POSITIVE_INFINITY },
    { assetCode: '000660', assetName: 'SK하이닉스', assetType: ASSET_TYPE.EQUITY, weightPct: Number.NaN },
  ]));
  assert.ok(r.errors.length >= 1);
});

// ===========================================================================
// Orchestrator (fallback) — schemaValidator import 포함
// ===========================================================================
test('orchestrator: 첫 공급자 성공 시 이후 공급자 미호출', async () => {
  const first = new FakeProvider(PROVIDER.PYKRX, rawOk(SAMPLE_ROWS));
  const second = new FakeProvider(PROVIDER.KRX_DIRECT, rawOk(SAMPLE_ROWS));
  const doc = await resolveHoldings('069500', '20260713', { providers: [first, second] });

  assert.equal(doc.collection.status, COLLECTION_STATUS.OK);
  assert.equal(doc.source.provider, PROVIDER.PYKRX);
  assert.equal(doc.source.isFallback, false);
  assert.equal(first.calls, 1);
  assert.equal(second.calls, 0); // 호출되지 않아야 함
  assert.deepEqual(doc.collection.attemptedProviders, [PROVIDER.PYKRX]);
});

test('orchestrator: 첫 공급자 실패 → 두번째 성공(fallback=true)', async () => {
  const first = new FakeProvider(PROVIDER.PYKRX, rawNotImplemented(PROVIDER.PYKRX));
  const second = new FakeProvider(PROVIDER.KRX_DIRECT, rawOk(SAMPLE_ROWS));
  const doc = await resolveHoldings('069500', '20260713', { providers: [first, second] });

  assert.equal(doc.collection.status, COLLECTION_STATUS.OK);
  assert.equal(doc.source.provider, PROVIDER.KRX_DIRECT);
  assert.equal(doc.source.isFallback, true);
  assert.equal(second.calls, 1);
  assert.deepEqual(doc.collection.attemptedProviders, [PROVIDER.PYKRX, PROVIDER.KRX_DIRECT]);
  // 앞선 실패가 진단에 보존되어야 함.
  assert.ok(doc.diagnostics.providerFailures.some((d) => d.provider === PROVIDER.PYKRX && d.status === COLLECTION_STATUS.NOT_IMPLEMENTED));
});

test('orchestrator: PROVIDER_PRIORITY 순서로 시도(입력 순서와 무관)', async () => {
  // 입력을 뒤섞어도 우선순위 순서(PYKRX→KRX_DIRECT→SEIBRO→ISSUER)로 시도.
  const issuer = new FakeProvider(PROVIDER.ISSUER, rawNotImplemented(PROVIDER.ISSUER));
  const pykrx = new FakeProvider(PROVIDER.PYKRX, rawNotImplemented(PROVIDER.PYKRX));
  const seibro = new FakeProvider(PROVIDER.SEIBRO, rawOk(SAMPLE_ROWS));
  const doc = await resolveHoldings('069500', '20260713', { providers: [issuer, seibro, pykrx] });
  assert.deepEqual(doc.collection.attemptedProviders, [PROVIDER.PYKRX, PROVIDER.SEIBRO]);
  assert.equal(doc.source.provider, PROVIDER.SEIBRO);
});

test('orchestrator: 모든 공급자 실패 → UNRESOLVED + 진단 보존', async () => {
  const a = new FakeProvider(PROVIDER.PYKRX, rawNotImplemented(PROVIDER.PYKRX));
  const b = new FakeProvider(PROVIDER.KRX_DIRECT, rawNotImplemented(PROVIDER.KRX_DIRECT));
  const doc = await resolveHoldings('069500', '20260713', { providers: [a, b] });

  assert.equal(doc.collection.status, COLLECTION_STATUS.UNRESOLVED);
  assert.equal(doc.holdings.length, 0);
  assert.deepEqual(doc.collection.attemptedProviders, [PROVIDER.PYKRX, PROVIDER.KRX_DIRECT]);
  assert.equal(doc.diagnostics.providerFailures.length, 2);
  // UNRESOLVED 문서도 스키마상 유효해야 한다.
  assert.equal(validateHoldingsDocument(doc).valid, true);
});

test('orchestrator: 정규화 실패한 공급자는 건너뛰고 다음으로', async () => {
  const bad = new FakeProvider(PROVIDER.PYKRX, { ok: true, provider: PROVIDER.PYKRX, status: 'OK', sourceType: null, raw: { nope: true } });
  const good = new FakeProvider(PROVIDER.KRX_DIRECT, rawOk(SAMPLE_ROWS));
  const doc = await resolveHoldings('069500', '20260713', { providers: [bad, good] });
  assert.equal(doc.source.provider, PROVIDER.KRX_DIRECT);
  assert.ok(doc.diagnostics.providerFailures.some((d) => d.status === COLLECTION_STATUS.NORMALIZATION_FAILED));
});

test('orchestrator: 스키마 위반 데이터는 건너뛴다(INVALID_SCHEMA 진단)', async () => {
  // assetName 누락 → 정규화 후 null → 스키마 위반.
  const bad = new FakeProvider(PROVIDER.PYKRX, rawOk([{ 종목코드: '005930', 비중: '50' }]));
  const good = new FakeProvider(PROVIDER.KRX_DIRECT, rawOk(SAMPLE_ROWS));
  const doc = await resolveHoldings('069500', '20260713', { providers: [bad, good] });
  assert.equal(doc.source.provider, PROVIDER.KRX_DIRECT);
  assert.ok(doc.diagnostics.providerFailures.some((d) => d.status === COLLECTION_STATUS.INVALID_SCHEMA));
});

// ===========================================================================
// Repository (기본 공급자 세트: 상위 스텁 NOT_IMPLEMENTED → MOCK 성공)
// ===========================================================================
test('repository: 코드로 조회(069500) → MOCK fallback 성공, 스키마 유효', async () => {
  const doc = await getEtfHoldings('069500');
  assert.equal(doc.etfCode, '069500');
  assert.equal(doc.etfName, 'KODEX 200');
  assert.equal(doc.source.provider, PROVIDER.MOCK);
  assert.equal(doc.source.isFallback, true); // MOCK 은 최우선이 아님
  assert.deepEqual(doc.collection.attemptedProviders, [
    PROVIDER.KRX_DIRECT, PROVIDER.SEIBRO, PROVIDER.ISSUER, PROVIDER.MOCK,
  ]);
  assert.equal(validateHoldingsDocument(doc).valid, true);
  assert.equal(doc.collection.status, COLLECTION_STATUS.OK);
});

test('repository: 존재하지 않는 ETF → UNRESOLVED(예외 없음)', async () => {
  const doc = await getEtfHoldings('000001'); // 픽스처 없음
  assert.equal(doc.collection.status, COLLECTION_STATUS.UNRESOLVED);
  assert.equal(doc.holdings.length, 0);
  const status = await getCollectionStatus('000001');
  assert.equal(status.isResolved, false);
});

test('repository: 모든 provider 실패 픽스처(999998) → UNRESOLVED', async () => {
  const doc = await getEtfHoldings('999998');
  assert.equal(doc.collection.status, COLLECTION_STATUS.UNRESOLVED);
});

test('repository: TOP-N 정렬(비중 내림차순, null 은 뒤로)', async () => {
  const summary = await getEtfHoldingSummary('091230', undefined, { topN: 3 });
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.top.length, 3);
  // 비중 있는 항목이 먼저(24.5, 22.0), 그 다음 null.
  assert.equal(summary.top[0].weightPct, 24.5);
  assert.equal(summary.top[1].weightPct, 22.0);
  assert.equal(summary.top[2].weightPct, null);
});

test('repository: 완전 공란 픽스처(445290) → WEIGHT_MISSING, 비중 모두 null', async () => {
  const doc = await getEtfHoldings('445290');
  assert.equal(doc.collection.status, COLLECTION_STATUS.WEIGHT_MISSING);
  assert.ok(doc.holdings.length > 0);
  assert.ok(doc.holdings.every((h) => h.weightPct === null));
});

test('repository: source + baseDate 전달(passthrough)', async () => {
  const doc = await getEtfHoldings('069500', '20260710');
  assert.equal(doc.baseDate, '2026-07-10'); // 호출 baseDate 우선
  assert.equal(doc.source.provider, PROVIDER.MOCK);
  const summary = await getEtfHoldingSummary('069500', '20260710');
  assert.equal(summary.baseDate, '2026-07-10');
  assert.equal(summary.source.provider, PROVIDER.MOCK);
});

test('repository: 해외자산 포함(379810) → 티커/통화 보존, 6자리 강제 안함', async () => {
  const doc = await getEtfHoldings('379810');
  const apple = doc.holdings.find((h) => h.assetName.includes('Apple'));
  assert.equal(apple.assetCode, 'AAPL');
  assert.equal(apple.currency, 'USD');
  assert.equal(apple.assetType, ASSET_TYPE.EQUITY);
});

// ===========================================================================
// e2e: Mock → Normalizer → SchemaValidator → BusinessValidator → Orchestrator → Repository
// ===========================================================================
test('e2e: 전체 파이프라인이 실제로 실행되어 유효 문서를 생성', async () => {
  const summary = await getEtfHoldingSummary('069500');
  assert.equal(summary.etfCode, '069500');
  assert.equal(summary.status, COLLECTION_STATUS.OK);
  assert.ok(summary.totalCount >= 1);
  assert.ok(summary.top.length >= 1);
  // TOP1 은 비중 최상위(삼성전자 30.5).
  assert.equal(summary.top[0].weightPct, 30.5);

  const status = await getCollectionStatus('069500');
  assert.equal(status.provider, PROVIDER.MOCK);
  assert.equal(status.isFallback, true);
  assert.equal(status.isResolved, true);
});

test('e2e: 선물/레버리지(122630) → 계약수 보존, 비중 합계≠100 경고, 스키마 유효', async () => {
  const doc = await getEtfHoldings('122630');
  assert.equal(validateHoldingsDocument(doc).valid, true);
  const fut = doc.holdings.find((h) => h.assetType === ASSET_TYPE.FUTURE);
  assert.equal(fut.contractCount, 1200);
  assert.equal(fut.quantity, null);
  // 스왑 행: 실제 0% (null 아님).
  const swap = doc.holdings.find((h) => h.assetType === ASSET_TYPE.SWAP);
  assert.equal(swap.weightPct, 0);
  // 합계 120% → 경고 존재.
  assert.ok((doc.collection.message ?? '').includes('100%'));
});
