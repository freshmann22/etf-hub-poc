import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterContents,
  formatKrw,
  formatPrice,
  formatSignedPercent,
  getComparison,
  getEtfsByStock,
  getEtfsByTheme,
  getMarketSummary,
  getRankedEtfs,
  getStrongWeakThemes,
  getThemeHeatmap,
  searchAll,
} from '../src/js/logic.js';

const clone = (value) => structuredClone(value);

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const etfs = [
  {
    id: 'etf-a',
    code: '111111',
    name: 'Alpha ETF',
    issuer: 'A',
    themeId: 'theme-semi',
    category: '주식형',
    currentPrice: 10000,
    changeRate1d: 2.5,
    return1w: 3.2,
    return1m: 7.5,
    tradingValue: 3000,
    tradingValueChangeRate: 11,
    netAssets: 12000,
    totalFee: 0.12,
    volatilityScore: 40,
    riskTags: [],
    summary: '반도체 ETF',
    topHoldings: ['stock-samsung', 'stock-sk', 'stock-naver'],
  },
  {
    id: 'etf-b',
    code: '222222',
    name: 'Beta ETF',
    issuer: 'B',
    themeId: 'theme-semi',
    category: '주식형',
    currentPrice: 20000,
    changeRate1d: -1.1,
    return1w: 0.1,
    return1m: 1.2,
    tradingValue: 9000,
    tradingValueChangeRate: 25,
    netAssets: 5000,
    totalFee: 0.2,
    volatilityScore: 70,
    riskTags: [],
    summary: '대형주 ETF',
    topHoldings: ['stock-sk', 'stock-samsung'],
  },
  {
    id: 'etf-c',
    code: '333333',
    name: 'Gamma ETF',
    issuer: 'C',
    themeId: 'theme-ai',
    category: '주식형',
    currentPrice: 30000,
    changeRate1d: 2.5,
    return1w: 1.1,
    return1m: 4.4,
    tradingValue: 1000,
    tradingValueChangeRate: 25,
    netAssets: 8000,
    totalFee: 0.15,
    volatilityScore: 70,
    riskTags: [],
    summary: 'AI ETF',
    topHoldings: ['stock-naver'],
  },
  {
    id: 'etf-d',
    code: '444444',
    name: 'Delta ETF',
    issuer: 'D',
    themeId: 'theme-car',
    category: '주식형',
    currentPrice: null,
    changeRate1d: null,
    return1w: null,
    return1m: null,
    tradingValue: null,
    tradingValueChangeRate: null,
    netAssets: null,
    totalFee: null,
    volatilityScore: null,
    riskTags: [],
    summary: '누락값 ETF',
    topHoldings: [],
  },
  {
    id: 'etf-b',
    code: '222222X',
    name: 'Duplicate Beta ETF',
    issuer: 'B',
    themeId: 'theme-semi',
    category: '주식형',
    currentPrice: 21000,
    changeRate1d: 9.9,
    return1w: 9.9,
    return1m: 9.9,
    tradingValue: 9999,
    tradingValueChangeRate: 99,
    netAssets: 9999,
    totalFee: 0.9,
    volatilityScore: 99,
    riskTags: [],
    summary: '중복 ETF',
    topHoldings: [],
  },
];

const themes = [
  {
    id: 'theme-semi',
    name: '반도체',
    return1d: 3,
    return1w: 1,
    return1m: 7,
    tradingValue: 10000,
    tradingValueChangeRate: 5,
    representativeEtfIds: ['etf-a', 'etf-b'],
    representativeStockIds: ['stock-samsung', 'stock-sk'],
    issueSummary: '반도체 흐름',
  },
  {
    id: 'theme-ai',
    name: 'AI',
    return1d: 3,
    return1w: 4,
    return1m: -1,
    tradingValue: 12000,
    tradingValueChangeRate: 4,
    representativeEtfIds: ['etf-c'],
    representativeStockIds: ['stock-naver'],
    issueSummary: 'AI 흐름',
  },
  {
    id: 'theme-car',
    name: '자동차',
    return1d: -2,
    return1w: -3,
    return1m: 9,
    tradingValue: 10000,
    tradingValueChangeRate: 3,
    representativeEtfIds: ['etf-d'],
    representativeStockIds: ['stock-hyundai'],
    issueSummary: '자동차 흐름',
  },
];

const stocks = [
  { id: 'stock-samsung', code: '005930', name: '삼성전자', sector: '반도체', changeRate1d: 1, relatedEtfIds: ['etf-a', 'etf-b'] },
  { id: 'stock-sk', code: '000660', name: 'SK하이닉스', sector: '반도체', changeRate1d: 2, relatedEtfIds: ['etf-a', 'etf-b'] },
  { id: 'stock-naver', code: '035420', name: 'NAVER', sector: '인터넷', changeRate1d: -1, relatedEtfIds: ['etf-a', 'etf-c'] },
  { id: 'stock-hyundai', code: '005380', name: '현대차', sector: '자동차', changeRate1d: 0, relatedEtfIds: [] },
];

const holdings = [
  { etfId: 'etf-a', stockId: 'stock-samsung', weight: 20, rank: 1 },
  { etfId: 'etf-a', stockId: 'stock-sk', weight: 10, rank: 2 },
  { etfId: 'etf-a', stockId: 'stock-naver', weight: 5, rank: 3 },
  { etfId: 'etf-b', stockId: 'stock-sk', weight: 35, rank: 1 },
  { etfId: 'etf-b', stockId: 'stock-samsung', weight: 35, rank: 2 },
  { etfId: 'etf-c', stockId: 'stock-naver', weight: 40, rank: 1 },
  { etfId: 'missing-etf', stockId: 'stock-samsung', weight: 99, rank: 1 },
];

const contents = [
  { id: 'content-b', type: 'news', title: 'B', summary: 'B', publishedAt: '2026-07-09T10:00:00+09:00', relatedEtfIds: ['etf-a'], relatedStockIds: [], relatedThemeIds: [], source: null },
  { id: 'content-a', type: 'news', title: 'A', summary: 'A', publishedAt: '2026-07-10T10:00:00+09:00', relatedEtfIds: ['etf-b'], relatedStockIds: [], relatedThemeIds: [], source: 'source' },
  { id: 'content-c', type: 'news', title: 'C', summary: 'C', publishedAt: '2026-07-10T10:00:00+09:00', relatedEtfIds: ['etf-c'], relatedStockIds: [], relatedThemeIds: [], source: null },
  { id: 'content-d', type: 'disclosure', title: 'D', summary: 'D', publishedAt: '2026-07-08T10:00:00+09:00', relatedEtfIds: [], relatedStockIds: [], relatedThemeIds: [], source: null },
  { id: 'content-r', type: 'research', title: 'R', summary: 'R', publishedAt: '2026-07-07T10:00:00+09:00', relatedEtfIds: [], relatedStockIds: [], relatedThemeIds: [], source: null },
];

test('getRankedEtfs covers all ranking tabs, null-key exclusion, duplicate ids, ties, empty input, and invalid tab errors', () => {
  const input = deepFreeze(clone(etfs));
  const before = clone(input);

  assert.deepEqual(getRankedEtfs(input, 'gainers').map((etf) => etf.id), ['etf-a', 'etf-c', 'etf-b']);
  assert.deepEqual(getRankedEtfs(input, 'losers').map((etf) => etf.id), ['etf-b', 'etf-a', 'etf-c']);
  assert.deepEqual(getRankedEtfs(input, 'volume').map((etf) => etf.id), ['etf-b', 'etf-c', 'etf-a']);
  assert.deepEqual(getRankedEtfs(input, 'volatility').map((etf) => etf.id), ['etf-b', 'etf-c', 'etf-a']);
  assert.deepEqual(
    getRankedEtfs([
      { ...etfs[0], id: 'tie-a', name: 'Beta Tie', changeRate1d: 1, tradingValue: 100 },
      { ...etfs[0], id: 'tie-b', name: 'Alpha Tie', changeRate1d: 1, tradingValue: 100 },
      { ...etfs[0], id: 'tie-c', name: 'Aardvark Tie', changeRate1d: 1, tradingValue: null },
    ], 'gainers').map((etf) => etf.id),
    ['tie-b', 'tie-a', 'tie-c'],
  );
  assert.deepEqual(getRankedEtfs([], 'gainers'), []);
  assert.throws(() => getRankedEtfs(input, 'bad'), { message: '알 수 없는 순위 탭: bad' });
  assert.deepEqual(input, before);
});

test('getThemeHeatmap selects period returnRate, sorts by tradingValue/name, rejects invalid period, and preserves input', () => {
  const input = deepFreeze(clone(themes));
  const before = clone(input);

  assert.deepEqual(getThemeHeatmap(input, '1d').map(({ themeId, returnRate }) => [themeId, returnRate]), [
    ['theme-ai', 3],
    ['theme-semi', 3],
    ['theme-car', -2],
  ]);
  assert.deepEqual(getThemeHeatmap(input, '1w').map(({ themeId, returnRate }) => [themeId, returnRate]), [
    ['theme-ai', 4],
    ['theme-semi', 1],
    ['theme-car', -3],
  ]);
  assert.deepEqual(getThemeHeatmap(input, '1m').map(({ themeId, returnRate }) => [themeId, returnRate]), [
    ['theme-ai', -1],
    ['theme-semi', 7],
    ['theme-car', 9],
  ]);
  assert.throws(() => getThemeHeatmap(input, '1y'), { message: '알 수 없는 기간: 1y' });
  assert.deepEqual(input, before);
});

test('getStrongWeakThemes returns strongest/weakest by period with tie rules and empty fallback', () => {
  const input = deepFreeze(clone(themes));

  assert.equal(getStrongWeakThemes(input, '1d').strongest.id, 'theme-ai');
  assert.equal(getStrongWeakThemes(input, '1d').weakest.id, 'theme-car');
  assert.equal(getStrongWeakThemes(input, '1w').strongest.id, 'theme-ai');
  assert.equal(getStrongWeakThemes(input, '1m').weakest.id, 'theme-ai');
  assert.deepEqual(getStrongWeakThemes([], '1d'), { strongest: null, weakest: null });
  assert.throws(() => getStrongWeakThemes(input, 'bad'), { message: '알 수 없는 기간: bad' });
});

test('getEtfsByTheme filters by theme, removes duplicate ids, and returns [] for missing or empty themeId', () => {
  assert.deepEqual(getEtfsByTheme(etfs, 'theme-semi').map((etf) => etf.id), ['etf-a', 'etf-b']);
  assert.deepEqual(getEtfsByTheme(etfs, 'theme-missing'), []);
  assert.deepEqual(getEtfsByTheme(etfs, ''), []);
});

test('getEtfsByStock reverse lookup sorts by weight, excludes missing ETF relations, removes duplicate ETFs, and handles missing stockId', () => {
  const holdingList = [...holdings, { etfId: 'etf-b', stockId: 'stock-samsung', weight: 1, rank: 9 }];

  assert.deepEqual(
    getEtfsByStock(etfs, holdingList, 'stock-samsung').map(({ etf, weight, rank }) => [etf.id, weight, rank]),
    [
      ['etf-b', 35, 2],
      ['etf-a', 20, 1],
    ],
  );
  assert.deepEqual(getEtfsByStock(etfs, holdings, 'stock-missing'), []);
});

test('searchAll trims, ignores English case, supports Korean partial and code search, de-duplicates, and handles empty query', () => {
  const dataset = deepFreeze({
    etfs: clone(etfs),
    stocks: clone(stocks),
    themes: clone(themes),
  });

  assert.deepEqual(searchAll(dataset, '   '), { etfs: [], stocks: [], themes: [], isEmptyQuery: true });
  assert.deepEqual(searchAll(dataset, 'alpha').etfs.map((etf) => etf.id), ['etf-a']);
  assert.deepEqual(searchAll(dataset, '전자').stocks.map((stock) => stock.id), ['stock-samsung']);
  assert.deepEqual(searchAll(dataset, '005930').stocks.map((stock) => stock.id), ['stock-samsung']);
  assert.deepEqual(searchAll(dataset, '222222').etfs.map((etf) => etf.id), ['etf-b']);
  assert.equal(searchAll(dataset, '반도').themes[0].id, 'theme-semi');
});

test('getComparison keeps requested order, removes duplicate ids, ignores missing ids, maps top holdings, and computes top-two concentration', () => {
  assert.deepEqual(getComparison(etfs, holdings, stocks, ['etf-b', 'missing', 'etf-a', 'etf-b', 'etf-c']), [
    {
      etfId: 'etf-b',
      name: 'Beta ETF',
      topHoldingNames: ['SK하이닉스', '삼성전자'],
      top2Concentration: 70,
      netAssets: 5000,
      tradingValue: 9000,
      totalFee: 0.2,
      return1m: 1.2,
    },
    {
      etfId: 'etf-a',
      name: 'Alpha ETF',
      topHoldingNames: ['삼성전자', 'SK하이닉스', 'NAVER'],
      top2Concentration: 30,
      netAssets: 12000,
      tradingValue: 3000,
      totalFee: 0.12,
      return1m: 7.5,
    },
    {
      etfId: 'etf-c',
      name: 'Gamma ETF',
      topHoldingNames: ['NAVER'],
      top2Concentration: null,
      netAssets: 8000,
      tradingValue: 1000,
      totalFee: 0.15,
      return1m: 4.4,
    },
  ]);
});

test('filterContents filters by type, sorts by publishedAt desc then id asc, and rejects invalid type', () => {
  assert.deepEqual(filterContents(contents, 'news').map((content) => content.id), ['content-a', 'content-c', 'content-b']);
  assert.deepEqual(filterContents(contents, 'disclosure').map((content) => content.id), ['content-d']);
  assert.deepEqual(filterContents(contents, 'research').map((content) => content.id), ['content-r']);
  assert.throws(() => filterContents(contents, 'video'), { message: '알 수 없는 콘텐츠 유형: video' });
});

test('getMarketSummary returns period summaries and rejects invalid periods', () => {
  const summaries = deepFreeze({
    '1d': { asOf: '2026-07-10', advancers: 1, decliners: 1, unchanged: 0, totalTradingValue: 1, tradingValueChangeRate: 2, strongestThemeId: 'theme-ai', weakestThemeId: 'theme-car', summary: '1d' },
    '1w': { asOf: '2026-07-10', advancers: 2, decliners: 0, unchanged: 0, totalTradingValue: 2, tradingValueChangeRate: 3, strongestThemeId: 'theme-ai', weakestThemeId: 'theme-car', summary: '1w' },
    '1m': { asOf: '2026-07-10', advancers: 0, decliners: 2, unchanged: 0, totalTradingValue: 3, tradingValueChangeRate: 4, strongestThemeId: 'theme-car', weakestThemeId: 'theme-ai', summary: '1m' },
  });

  assert.equal(getMarketSummary(summaries, '1d').summary, '1d');
  assert.equal(getMarketSummary(summaries, '1w').summary, '1w');
  assert.equal(getMarketSummary(summaries, '1m').summary, '1m');
  assert.throws(() => getMarketSummary(summaries, 'bad'), { message: '알 수 없는 기간: bad' });
});

test('format helpers produce signed percentages and Korean currency/price fallbacks', () => {
  assert.equal(formatSignedPercent(1.234), '+1.23%');
  assert.equal(formatSignedPercent(-0.45), '-0.45%');
  assert.equal(formatSignedPercent(0), '0.00%');
  assert.equal(formatSignedPercent(null), '정보 없음');
  assert.equal(formatSignedPercent(Number.NaN), '정보 없음');

  assert.equal(formatKrw(12345), '1조 2,345억원');
  assert.equal(formatKrw(3420), '3,420억원');
  assert.equal(formatKrw(10000), '1조원');
  assert.equal(formatKrw(null), '정보 없음');
  assert.equal(formatKrw(-1), '정보 없음');

  assert.equal(formatPrice(10250), '10,250원');
  assert.equal(formatPrice(null), '정보 없음');
});
