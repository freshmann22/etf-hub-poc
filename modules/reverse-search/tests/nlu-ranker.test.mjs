import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/nlu.js';
import { buildStockNameIndex } from '../src/adapters.js';
import { rankByStockWeight, rankByTag, rankBySortField, rankComposite, rankByQueryPlan } from '../src/ranker.js';

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
  { code: '069500', name: 'KODEX 200', volume: 1000, tradingValue: 5200, return1m: 2.3 },
  { code: '091230', name: 'KODEX 반도체', volume: 3000, tradingValue: 4300, return1m: 10.2 },
  { code: '157490', name: null, volume: null, tradingValue: null, return1m: null },
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
  assert.equal(parsed.sortField, 'volume');
  assert.equal(parsed.sortDir, 'desc');
});

test('parseQuery keeps trading volume and trading value separate', () => {
  const ctx = buildContext();
  assert.equal(parseQuery('거래량 많은 ETF', ctx.stockNameIndex).sortField, 'volume');
  assert.equal(parseQuery('거래대금 많은 ETF', ctx.stockNameIndex).sortField, 'tradingValue');
});

test('rankBySortField formats trading volume in shares', () => {
  const ctx = buildContext();
  const result = rankBySortField(ctx, marketSnapshot, 'volume', 'desc', '거래량');
  assert.deepEqual(result.items.map((item) => item.code), ['091230', '069500']);
  assert.equal(result.items[0].evidence, '거래량 3,000주');
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
  assert.equal(result.items[0].evidence, '거래대금 5,200억원');
  assert.match(result.note, /2개 ETF만 집계/);
});

test('rankComposite filters by tag then sorts by market metric', () => {
  const ctx = buildContext();
  const result = rankComposite(ctx, marketSnapshot, [{ tagIds: ['sector.semiconductor'], matchedKeyword: '반도체' }], 'tradingValue', 'desc', '거래대금');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items.map((i) => i.code), ['091230']);
});

// --- Phase 1: taxonomy 밖 의미를 위한 보조 텍스트 검색 -----------------------------

// 대표 실패 사례 487950 — taxonomy 에 대만 태그가 없지만 이름/기초지수에 대만·Taiwan 이 있다.
const textSearchIndex = new Map([
  ['487950', { officialName: 'KODEX 대만테크고배당다우존스', benchmarkName: 'Dow Jones Taiwan Technology Dividend 30 Index(TWD)(PR)' }],
  ['069500', { officialName: 'KODEX 200', benchmarkName: 'KOSPI 200 Index' }],
  ['999001', { officialName: 'SAMPLE 대만가치 ETF', benchmarkName: 'Some Taiwan Value Index' }],
]);

const textTagUniverse = {
  etfs: {
    '487950': { tags: [{ tagId: 'dividend.monthly', score: 1, confidence: 1 }, { tagId: 'asset.equity', score: 1, confidence: 0.6 }] },
    '069500': { tags: [{ tagId: 'strategy.benchmark.kospi200', score: 1, confidence: 0.6 }] },
    '999001': { tags: [{ tagId: 'asset.equity', score: 1, confidence: 0.5 }] },
  },
};

function textContext() {
  return {
    tagUniverse: textTagUniverse,
    searchIndex: textSearchIndex,
    master: { '487950': { name: 'KODEX 대만테크고배당다우존스' } },
    marketSnapshot: [
      { code: '487950', volume: 12000, tradingValue: 88 },
      { code: '999001', volume: 300, tradingValue: 4 },
    ],
  };
}

const taiwan = (mode = 'required') => ({ value: '대만', aliases: ['Taiwan'], mode, fields: ['officialName', 'benchmarkName', 'investmentObjective'] });

test('parseQuery extracts a taxonomy-absent country as a required text constraint', () => {
  const parsed = parseQuery('대만 기업들에 투자하는 ETF 좀 찾아줘', new Map());
  assert.equal(parsed.intent, 'TEXT_MATCH');
  assert.equal(parsed.textConstraints.length, 1);
  assert.equal(parsed.textConstraints[0].value, '대만');
  assert.equal(parsed.textConstraints[0].mode, 'required');
  assert.ok(parsed.textConstraints[0].aliases.includes('Taiwan'));
  assert.deepEqual(parsed.tagGroups, []);
});

test('parseQuery consumes text keyword so it does not leak into a tag (인도네시아 !-> region.india)', () => {
  const parsed = parseQuery('인도네시아 ETF', new Map());
  assert.equal(parsed.intent, 'TEXT_MATCH');
  assert.equal(parsed.textConstraints[0].value, '인도네시아');
  assert.deepEqual(parsed.tagGroups, []);
});

test('parseQuery recognizes taxonomy-absent macro regions (북미, 유럽) as text constraints', () => {
  const bukmi = parseQuery('북미 2차전지 ETF', new Map());
  assert.equal(bukmi.textConstraints[0].value, '북미');
  assert.ok(bukmi.textConstraints[0].aliases.includes('North America'));
  // 태그(2차전지)와 텍스트(북미)가 함께 잡힌다 — 뉴스/테마 라우팅용 조합.
  assert.deepEqual(bukmi.tagGroups[0].tagIds, ['sector.ev_battery']);

  const europe = parseQuery('유럽 방산 ETF', new Map());
  assert.equal(europe.textConstraints[0].value, '유럽');
  assert.deepEqual(europe.tagGroups[0].tagIds, ['sector.aerospace_defense']);
});

test('parseQuery flips text constraint to excluded on a negation hint', () => {
  const parsed = parseQuery('대만 아닌 ETF', new Map());
  assert.equal(parsed.textConstraints[0].value, '대만');
  assert.equal(parsed.textConstraints[0].mode, 'excluded');
});

test('rankByQueryPlan finds 487950 by name/benchmark text evidence without a taxonomy tag', () => {
  const result = rankByQueryPlan(textContext(), { tags: [], textConstraints: [taiwan()], sort: null });
  assert.equal(result.status, 'ok');
  const codes = result.items.map((i) => i.code);
  assert.ok(codes.includes('487950'));
  const hit = result.items.find((i) => i.code === '487950');
  const fields = hit.matchedText.flatMap((m) => m.matchedFields.map((f) => f.field));
  assert.ok(fields.includes('officialName'));
  assert.ok(fields.includes('benchmarkName'));
  assert.match(hit.evidence, /공식명|기초지수/);
});

test('rankByQueryPlan combines a text constraint with a required taxonomy tag (대만 월배당)', () => {
  const plan = {
    tags: [{ tagId: 'dividend.monthly', facet: 'dividend', label: '월배당', queryScore: 1, mode: 'required' }],
    textConstraints: [taiwan()],
    sort: null,
  };
  const result = rankByQueryPlan(textContext(), plan);
  assert.deepEqual(result.items.map((i) => i.code), ['487950']); // 999001 은 대만이지만 월배당 태그가 없어 탈락
});

test('rankByQueryPlan excludes text-matched ETFs when the constraint is excluded', () => {
  const result = rankByQueryPlan(textContext(), { tags: [], textConstraints: [taiwan('excluded')], sort: null });
  const codes = result.items.map((i) => i.code);
  assert.ok(!codes.includes('487950'));
  assert.ok(!codes.includes('999001'));
});

test('rankByQueryPlan returns empty (not a trading-value list) when a required text constraint matches nothing', () => {
  const atlantis = { value: '아틀란티스', aliases: ['Atlantis'], mode: 'required', fields: ['officialName', 'benchmarkName', 'investmentObjective'] };
  const result = rankByQueryPlan(textContext(), { tags: [], textConstraints: [atlantis], sort: null });
  assert.equal(result.status, 'empty');
  assert.equal(result.items.length, 0);
});

test('rankByQueryPlan applies a market sort within the text-constrained candidate set', () => {
  const result = rankByQueryPlan(textContext(), {
    tags: [],
    textConstraints: [taiwan()],
    sort: { field: 'volume', direction: 'desc', label: '거래량' },
  });
  assert.deepEqual(result.items.map((i) => i.code), ['487950', '999001']);
});

test('rankByQueryPlan is deterministic for identical input', () => {
  const plan = { tags: [], textConstraints: [taiwan()], sort: null };
  const a = rankByQueryPlan(textContext(), plan).items.map((i) => i.code);
  const b = rankByQueryPlan(textContext(), plan).items.map((i) => i.code);
  assert.deepEqual(a, b);
});

// --- #4: sector 개념을 태그 gap 을 넘어 텍스트 폴백으로 충족(미국 반도체 유형) --------------

test('a required sector tag is satisfied by name/benchmark text when the tag is missing (미국 반도체 gap)', () => {
  // US1: region.us 태그 O, sector.semiconductor 태그 X, 이름/기초지수에 반도체/Semiconductor O  -> 매칭돼야 함
  // US2: region.us 태그 O, 반도체와 무관         -> 반도체 개념 미충족 -> 탈락
  // KR : sector.semiconductor 태그 O 이지만 region.us 아님 -> region 개념 미충족 -> 탈락
  const ctx = {
    tagUniverse: { etfs: {
      US1: { tags: [{ tagId: 'region.us', score: 0.9, confidence: 0.9 }] },
      US2: { tags: [{ tagId: 'region.us', score: 0.9, confidence: 0.9 }] },
      KR: { tags: [{ tagId: 'sector.semiconductor', score: 1, confidence: 0.9 }] },
    } },
    searchIndex: new Map([
      ['US1', { officialName: 'TIGER 미국필라델피아반도체나스닥', benchmarkName: 'PHLX Semiconductor Sector Index' }],
      ['US2', { officialName: 'TIGER 미국S&P500', benchmarkName: 'S&P 500 Index' }],
      ['KR', { officialName: 'KODEX 반도체', benchmarkName: 'KRX Semiconductor' }],
    ]),
    master: {},
    marketSnapshot: [],
  };
  const plan = {
    tags: [
      { tagId: 'region.us', facet: 'region', label: '미국', queryScore: 1, mode: 'required' },
      { tagId: 'sector.semiconductor', facet: 'sector', label: '반도체', queryScore: 1, mode: 'required',
        textFallback: { value: '반도체', aliases: ['Semiconductor'], fields: ['officialName', 'benchmarkName', 'investmentObjective'] } },
    ],
    textConstraints: [],
    sort: null,
  };
  const result = rankByQueryPlan(ctx, plan);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items.map((i) => i.code), ['US1']);
  // US1 은 태그(미국)와 텍스트 폴백(반도체) 근거가 함께 표시된다.
  assert.match(result.items[0].evidence, /미국/);
  assert.match(result.items[0].evidence, /반도체/);
  assert.ok(result.items[0].matchedText.some((m) => m.value === '반도체'));
});

test('authoritative benchmark/objective match outranks a name-only match for the same term', () => {
  // BENCH: 기초지수에 Taiwan 있고 이름엔 없음(권위 근거) / NAMEONLY: 이름에만 대만(우연 일치 여지)
  const ctx = {
    tagUniverse: { etfs: { BENCH: { tags: [] }, NAMEONLY: { tags: [] } } },
    searchIndex: new Map([
      ['BENCH', { officialName: 'KODEX 글로벌테크', benchmarkName: 'MSCI Taiwan Tech Index' }],
      ['NAMEONLY', { officialName: 'KODEX 대만여행레저', benchmarkName: 'KRX Leisure Index' }],
    ]),
    master: {}, marketSnapshot: [],
  };
  const result = rankByQueryPlan(ctx, { tags: [], textConstraints: [taiwan()], sort: null });
  assert.deepEqual(result.items.map((i) => i.code), ['BENCH', 'NAMEONLY']);
  assert.ok(result.items[0].relevanceScore > result.items[1].relevanceScore);
  // 권위 근거 여부가 결과에 노출돼 "이름만 일치"와 구분된다.
  assert.equal(result.items[0].matchedText[0].authoritative, true);
  assert.equal(result.items[1].matchedText[0].authoritative, false);
});

test('tag evidence outranks text-fallback evidence for the same concept', () => {
  // 태그로 확정된 ETF 가 이름만 일치한 ETF 보다 위에 온다.
  const ctx = {
    tagUniverse: { etfs: {
      TAGGED: { tags: [{ tagId: 'sector.semiconductor', score: 1, confidence: 1 }] },
      NAMEONLY: { tags: [] },
    } },
    searchIndex: new Map([
      ['TAGGED', { officialName: 'KODEX 반도체', benchmarkName: 'KRX Semiconductor' }],
      ['NAMEONLY', { officialName: '어떤 반도체 소부장 ETF', benchmarkName: 'Some Semiconductor Materials' }],
    ]),
    master: {},
    marketSnapshot: [],
  };
  const plan = {
    tags: [{ tagId: 'sector.semiconductor', facet: 'sector', label: '반도체', queryScore: 1, mode: 'required',
      textFallback: { value: '반도체', aliases: ['Semiconductor'], fields: ['officialName', 'benchmarkName', 'investmentObjective'] } }],
    textConstraints: [],
    sort: null,
  };
  const result = rankByQueryPlan(ctx, plan);
  assert.deepEqual(result.items.map((i) => i.code), ['TAGGED', 'NAMEONLY']);
  assert.ok(result.items[0].relevanceScore > result.items[1].relevanceScore);
});
