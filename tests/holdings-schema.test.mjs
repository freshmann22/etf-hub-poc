import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  validateHoldingsDocument,
  validateHolding,
  checkSchemaSupport,
} from '../server/holdings/schemaValidator.js';
import {
  ASSET_TYPES,
  PROVIDERS,
  SOURCE_TYPES,
  COLLECTION_STATUSES,
} from '../server/holdings/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(resolve(__dirname, '../schemas/etf-holdings.schema.json'), 'utf8'),
);

// 유효한 현물 ETF 문서 기본형(각 테스트에서 깊은 복제 후 변형).
function baseDocument() {
  return {
    schemaVersion: '1.0.0',
    etfCode: '069500',
    etfName: 'KODEX 200',
    baseDate: '2026-07-13',
    generatedAt: '2026-07-14T09:00:00+09:00',
    source: { provider: 'PYKRX', sourceType: 'KRX_API', isFallback: false },
    collection: {
      status: 'OK',
      attemptedProviders: ['PYKRX'],
      message: null,
    },
    holdings: [
      {
        assetCode: '005930',
        assetName: '삼성전자',
        assetType: 'EQUITY',
        market: 'KOSPI',
        currency: 'KRW',
        quantity: 1000,
        contractCount: null,
        marketValue: 70000000,
        weightPct: 25.5,
        rank: 1,
        rawAssetCode: '005930',
      },
    ],
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

test('유효한 현물 ETF 문서는 통과한다', () => {
  const result = validateHoldingsDocument(baseDocument());
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.deepEqual(result.errors, []);
});

test('weightPct null(공란)은 허용된다', () => {
  const doc = clone(baseDocument());
  doc.holdings[0].weightPct = null;
  const result = validateHoldingsDocument(doc);
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('weightPct 0(실제 0%)은 허용된다', () => {
  const doc = clone(baseDocument());
  doc.holdings[0].weightPct = 0;
  const result = validateHoldingsDocument(doc);
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('잘못된 baseDate 형식은 거부된다', () => {
  const doc = clone(baseDocument());
  doc.baseDate = '2026/07/13';
  const result = validateHoldingsDocument(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('baseDate')));
});

test('필수 항목 누락은 거부된다', () => {
  const doc = clone(baseDocument());
  delete doc.etfName;
  const result = validateHoldingsDocument(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('etfName')));
});

test('정의되지 않은 assetType 은 거부된다', () => {
  const doc = clone(baseDocument());
  doc.holdings[0].assetType = 'CRYPTO';
  const result = validateHoldingsDocument(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('assetType')));
});

test('해외 자산코드(6자리 아님)는 허용된다', () => {
  const doc = clone(baseDocument());
  doc.holdings[0].assetCode = 'US0378331005'; // Apple ISIN
  doc.holdings[0].assetName = 'APPLE INC';
  doc.holdings[0].market = 'NASDAQ';
  doc.holdings[0].currency = 'USD';
  const result = validateHoldingsDocument(doc);
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('CASH/FUTURE/SWAP 자산유형은 허용된다', () => {
  for (const assetType of ['CASH', 'FUTURE', 'SWAP']) {
    const holding = {
      assetCode: assetType + '-001',
      assetName: assetType + ' 자산',
      assetType,
      market: null,
      currency: 'KRW',
      quantity: null,
      contractCount: assetType === 'FUTURE' ? 10 : null,
      marketValue: 1000,
      weightPct: null,
      rank: null,
      rawAssetCode: null,
    };
    const result = validateHolding(holding);
    assert.equal(result.valid, true, `${assetType}: ${result.errors.join('; ')}`);
  }
});

test('validateHolding 은 정의되지 않은 assetType 을 거부한다', () => {
  const result = validateHolding({
    assetCode: 'X',
    assetName: 'X',
    assetType: 'BOGUS',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('assetType')));
});

test('validateHolding 은 허용되지 않은 속성을 거부한다', () => {
  const result = validateHolding({
    assetCode: '005930',
    assetName: '삼성전자',
    assetType: 'EQUITY',
    unexpected: true,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('unexpected')));
});

// constants.js 의 enum 배열과 스키마의 enum 목록이 절대 어긋나지 않도록 교차검증.
function assertSameSet(actual, expected, label) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} enum 불일치`,
  );
}

test('assetType enum 이 constants.js 와 스키마에서 일치한다', () => {
  const schemaEnum = schema.$defs.holding.properties.assetType.enum;
  assertSameSet(ASSET_TYPES, schemaEnum, 'assetType');
});

test('provider enum 이 constants.js 와 스키마에서 일치한다', () => {
  const schemaEnum = schema.properties.source.properties.provider.enum;
  assertSameSet(PROVIDERS, schemaEnum, 'provider');
});

test('collection status enum 이 constants.js 와 스키마에서 일치한다', () => {
  const schemaEnum = schema.properties.collection.properties.status.enum;
  assertSameSet(COLLECTION_STATUSES, schemaEnum, 'collection status');
});

test('sourceType enum 이 constants.js 와 스키마에서 일치한다(null 제외)', () => {
  const schemaEnum = schema.properties.source.properties.sourceType.enum.filter(
    (v) => v !== null,
  );
  assertSameSet(SOURCE_TYPES, schemaEnum, 'sourceType');
});

test('번들 스키마는 미지원 키워드가 없다', () => {
  const { supported, unsupportedKeywords } = checkSchemaSupport(schema);
  assert.equal(supported, true, unsupportedKeywords.join(', '));
  assert.deepEqual(unsupportedKeywords, []);
});

test('미지원 키워드는 checkSchemaSupport 로 드러난다', () => {
  const synthetic = {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 0 },
      choice: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
  };
  const { supported, unsupportedKeywords } = checkSchemaSupport(synthetic);
  assert.equal(supported, false);
  assert.ok(unsupportedKeywords.includes('minimum'));
  assert.ok(unsupportedKeywords.includes('oneOf'));
});
