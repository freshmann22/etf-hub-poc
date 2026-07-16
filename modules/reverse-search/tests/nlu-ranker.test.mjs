import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/nlu.js';
import { buildStockNameIndex } from '../src/adapters.js';
import { rankByStockWeight, rankByTag, rankBySortField, rankComposite } from '../src/ranker.js';

const holdingsUniverse = {
  '069500': { name: 'KODEX 200', holdings: [{ ticker: '005930', name: '삼성전자', weight: 24.5 }] },
  '091230': {
    name: 'KODEX 반도체',
    holdings: [
      { ticker: '000660', name: 'SK하이닉스', weight: 28.4 },
      { ticker: '005930', name: '삼성전자', weight: 22.1 },
    ],
  },
  '157490': {
    name: 'TIGER Fn반도체TOP10',
    holdings: [{ ticker: '000660', name: 'SK하이닉스', weight: 30.2 }],
  },
};

const tagUniverse = {
  taxonomyVersion: '2.0.0',
  etfs: {
    '069500': { tags: [{ tagId: 'strategy.benchmark.kospi200', score: 1, confidence: 0.6 }] },
    '091230': { tags: [{ tagId: 'sector.semiconductor', score: 1, confidence: 0.9 }] },
    '157490': {
      tags: [
        { tagId: 'sector.semiconductor', score: 0.9, confidence: 0.85 },
        { tagId: 'dividend.monthly', score: 0.5, confidence: 0.5 },
      ],
    },
  },
};

const master = {
  '069500': { code: '069500', name: 'KODEX 200' },
  '091230': { code: '091230', name: 'KODEX 반도체' },
  '157490': { code: '157490', name: 'TIGER Fn반도체TOP10' },
};

const marketSnapshot = [
  { code: '069500', name: 'KODEX 200', tradingValue: 5200, return1m: 2.3 },
  { code: '091230', name: 'KODEX 반도체', tradingValue: 4300, return1m: 10.2 },
  { code: '157490', name: null, tradingValue: null, return1m: null },
];

function buildContext() {
  return {
    holdingsUniverse,
    tagUniverse,
    master,
    marketSnapshot,
    stockNameIndex: buildStockNameIndex(holdingsUniverse),
  };
}

test('parseQuery detects STOCK_WEIGHT via alias', () => {
  const ctx = buildContext();
  const parsed = parseQuery('하이닉스 비중높은 ETF?', ctx.stockNameIndex);
  assert.equal(parsed.intent, 'STOCK_WEIGHT');
  assert.equal(parsed.stockCode, '000660');
});

test('parseQuery detects TAG_MATCH for sector keyword', () => {
  const ctx = buildContext();
  const parsed = parseQuery('반도체 ETF 뭐야', ctx.stockNameIndex);
  assert.equal(parsed.intent, 'TAG_MATCH');
  assert.deepEqual(parsed.tagGroups[0].tagIds, ['sector.semiconductor']);
});

test('parseQuery detects COMPOSITE for tag + sort keyword', () => {
  const ctx = buildContext();
  const parsed = parseQuery('반도체 중에서 거래량 많은 ETF', ctx.stockNameIndex);
  assert.equal(parsed.intent, 'COMPOSITE');
  assert.equal(parsed.sortField, 'tradingValue');
  assert.equal(parsed.sortDir, 'desc');
});

test('parseQuery detects MARKET_SORT and ascending direction hint', () => {
  const ctx = buildContext();
  const parsed = parseQuery('총보수 낮은 ETF', ctx.stockNameIndex);
  assert.equal(parsed.intent, 'MARKET_SORT');
  assert.equal(parsed.sortField, 'totalFee');
  assert.equal(parsed.sortDir, 'asc');
});

test('rankByStockWeight sorts by weight desc and reports coverage', () => {
  const ctx = buildContext();
  const result = rankByStockWeight(ctx, '000660', 'SK하이닉스');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items.map((i) => i.code), ['157490', '091230']);
  assert.equal(result.items[0].evidence, 'SK하이닉스 비중 30.2%');
});

test('rankByStockWeight returns empty status when stock not held anywhere', () => {
  const ctx = buildContext();
  const result = rankByStockWeight(ctx, '999999', '존재안함');
  assert.equal(result.status, 'empty');
  assert.equal(result.items.length, 0);
});

test('rankByTag AND-matches across groups, falls back to OR when AND yields nothing', () => {
  const ctx = buildContext();
  const semiOnly = rankByTag(ctx, [{ tagIds: ['sector.semiconductor'], matchedKeyword: '반도체' }]);
  assert.equal(semiOnly.status, 'ok');
  assert.deepEqual(semiOnly.items.map((i) => i.code).sort(), ['091230', '157490']);

  const impossible = rankByTag(ctx, [
    { tagIds: ['sector.semiconductor'], matchedKeyword: '반도체' },
    { tagIds: ['dividend.monthly'], matchedKeyword: '월배당' },
  ]);
  // 157490 has both -> AND should still succeed here
  assert.equal(impossible.status, 'ok');
  assert.deepEqual(impossible.items.map((i) => i.code), ['157490']);
});

test('rankBySortField skips missing values and notes partial coverage', () => {
  const ctx = buildContext();
  const result = rankBySortField(ctx, marketSnapshot, 'tradingValue', 'desc', '거래대금');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].code, '069500');
  assert.match(result.note, /2개 ETF만 집계/);
});

test('rankComposite filters by tag then sorts by market metric', () => {
  const ctx = buildContext();
  const result = rankComposite(ctx, marketSnapshot, [{ tagIds: ['sector.semiconductor'], matchedKeyword: '반도체' }], 'tradingValue', 'desc', '거래대금');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items.map((i) => i.code), ['091230']);
});
