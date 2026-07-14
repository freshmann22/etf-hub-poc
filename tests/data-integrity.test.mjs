import test from 'node:test';
import assert from 'node:assert/strict';

import {
  comparisonSets,
  contents,
  etfs,
  holdings,
  marketSummaryByPeriod,
  stocks,
  themes,
} from '../src/js/data.js';

const isNumberOrNull = (value) => typeof value === 'number' || value === null;
const groupBy = (items, getKey) => {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  return grouped;
};
const assertUnique = (items, field, label) => {
  const values = items.map((item) => item[field]);
  assert.equal(new Set(values).size, values.length, `${label}.${field} must be unique`);
};
const byId = (items) => new Map(items.map((item) => [item.id, item]));

test('sample data meets minimum collection sizes and required comparison seed', () => {
  assert.ok(etfs.length >= 22, 'etfs must contain at least 22 items');
  assert.ok(themes.length >= 12, 'themes must contain at least 12 items');
  assert.ok(stocks.length >= 12, 'stocks must contain at least 12 items');
  assert.ok(holdings.length >= 60, 'holdings must contain at least 60 rows');
  assert.ok(contents.filter((content) => content.type === 'news').length >= 8, 'news content must contain at least 8 items');
  assert.ok(contents.filter((content) => content.type === 'disclosure').length >= 3, 'disclosure content must contain at least 3 items');
  assert.ok(contents.filter((content) => content.type === 'research').length >= 3, 'research content must contain at least 3 items');
  assert.deepEqual(Object.keys(marketSummaryByPeriod).sort(), ['1d', '1m', '1w']);
  assert.ok(comparisonSets.length >= 2, 'comparisonSets must contain at least 2 items');
  assert.equal(byId(themes).get(comparisonSets[0].themeId)?.name, '반도체');
  assert.ok(comparisonSets[0].etfIds.length >= 3, 'first comparison set must contain at least 3 ETFs');
});

test('id, code, and name fields are unique in primary collections', () => {
  for (const [label, items] of [['etfs', etfs], ['themes', themes], ['stocks', stocks]]) {
    assertUnique(items, 'id', label);
    assertUnique(items, 'name', label);
  }
  assertUnique(etfs, 'code', 'etfs');
  assertUnique(stocks, 'code', 'stocks');
  assertUnique(contents, 'id', 'contents');
});

test('all declared references point to existing IDs', () => {
  const etfIds = new Set(etfs.map((etf) => etf.id));
  const themeIds = new Set(themes.map((theme) => theme.id));
  const stockIds = new Set(stocks.map((stock) => stock.id));
  const assertExisting = (set, id, message) => assert.ok(set.has(id), `${message}: ${id}`);

  for (const etf of etfs) {
    assertExisting(themeIds, etf.themeId, `etf.themeId reference missing for ${etf.id}`);
    for (const stockId of etf.topHoldings) assertExisting(stockIds, stockId, `etf.topHoldings reference missing for ${etf.id}`);
  }
  for (const theme of themes) {
    for (const etfId of theme.representativeEtfIds) assertExisting(etfIds, etfId, `theme.representativeEtfIds reference missing for ${theme.id}`);
    for (const stockId of theme.representativeStockIds) assertExisting(stockIds, stockId, `theme.representativeStockIds reference missing for ${theme.id}`);
  }
  for (const stock of stocks) {
    for (const etfId of stock.relatedEtfIds) assertExisting(etfIds, etfId, `stock.relatedEtfIds reference missing for ${stock.id}`);
  }
  for (const holding of holdings) {
    assertExisting(etfIds, holding.etfId, 'holding.etfId reference missing');
    assertExisting(stockIds, holding.stockId, 'holding.stockId reference missing');
  }
  for (const content of contents) {
    for (const etfId of content.relatedEtfIds) assertExisting(etfIds, etfId, `content.relatedEtfIds reference missing for ${content.id}`);
    for (const stockId of content.relatedStockIds) assertExisting(stockIds, stockId, `content.relatedStockIds reference missing for ${content.id}`);
    for (const themeId of content.relatedThemeIds) assertExisting(themeIds, themeId, `content.relatedThemeIds reference missing for ${content.id}`);
  }
  for (const comparisonSet of comparisonSets) {
    assertExisting(themeIds, comparisonSet.themeId, 'comparisonSet.themeId reference missing');
    for (const etfId of comparisonSet.etfIds) assertExisting(etfIds, etfId, `comparisonSet.etfIds reference missing for ${comparisonSet.themeId}`);
  }
});

test('holdings have unique ETF-stock pairs, valid weights, and unique ranks within each ETF', () => {
  const pairs = new Set();
  const ranksByEtf = new Map();

  for (const holding of holdings) {
    const pairKey = `${holding.etfId}:${holding.stockId}`;
    assert.ok(!pairs.has(pairKey), `duplicate holding pair: ${pairKey}`);
    pairs.add(pairKey);
    assert.ok(holding.weight > 0 && holding.weight <= 100, `invalid holding weight for ${pairKey}`);

    const ranks = ranksByEtf.get(holding.etfId) ?? new Set();
    assert.ok(!ranks.has(holding.rank), `duplicate rank ${holding.rank} in ${holding.etfId}`);
    ranks.add(holding.rank);
    ranksByEtf.set(holding.etfId, ranks);
  }
});

test('etf.topHoldings and stocks.relatedEtfIds are consistent with holdings', () => {
  const holdingKeys = new Set(holdings.map((holding) => `${holding.etfId}:${holding.stockId}`));
  const holdingsByEtf = groupBy(holdings, (holding) => holding.etfId);
  const holdingsByStock = groupBy(holdings, (holding) => holding.stockId);

  for (const etf of etfs) {
    for (const stockId of etf.topHoldings) {
      assert.ok(holdingKeys.has(`${etf.id}:${stockId}`), `topHoldings item missing holding relation: ${etf.id}:${stockId}`);
    }
    const rankedStockIds = (holdingsByEtf.get(etf.id) ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((holding) => holding.stockId)
      .slice(0, etf.topHoldings.length);
    assert.deepEqual(etf.topHoldings, rankedStockIds, `topHoldings must follow holding rank order for ${etf.id}`);
  }

  for (const stock of stocks) {
    const expectedEtfIds = (holdingsByStock.get(stock.id) ?? [])
      .map((holding) => holding.etfId)
      .sort();
    assert.deepEqual([...stock.relatedEtfIds].sort(), expectedEtfIds, `relatedEtfIds must match holdings for ${stock.id}`);
  }
});

test('market summaries balance ETF counts and point to truly strongest and weakest themes', () => {
  const themesById = byId(themes);
  const periodToField = { '1d': 'return1d', '1w': 'return1w', '1m': 'return1m' };

  for (const [period, summary] of Object.entries(marketSummaryByPeriod)) {
    assert.equal(summary.advancers + summary.decliners + summary.unchanged, etfs.length, `${period} market counts must sum to ETF count`);
    const strongest = themesById.get(summary.strongestThemeId);
    const weakest = themesById.get(summary.weakestThemeId);
    assert.ok(strongest, `${period} strongestThemeId must exist`);
    assert.ok(weakest, `${period} weakestThemeId must exist`);
    assert.ok(strongest[periodToField[period]] > weakest[periodToField[period]], `${period} strongest theme return must exceed weakest theme return`);
  }
});

test('required six stock names exist', () => {
  const stockNames = new Set(stocks.map((stock) => stock.name));
  for (const name of ['삼성전자', 'SK하이닉스', 'NAVER', '한화에어로스페이스', '두산에너빌리티', '현대차']) {
    assert.ok(stockNames.has(name), `required stock missing: ${name}`);
  }
});

test('numeric fields use number or null only, and at least two ETFs include explicit null numeric fields', () => {
  const etfNumericFields = [
    'currentPrice',
    'changeRate1d',
    'return1w',
    'return1m',
    'tradingValue',
    'tradingValueChangeRate',
    'netAssets',
    'totalFee',
    'volatilityScore',
  ];
  const themeNumericFields = ['return1d', 'return1w', 'return1m', 'tradingValue', 'tradingValueChangeRate'];
  const stockNumericFields = ['changeRate1d'];
  const holdingNumericFields = ['weight', 'rank'];
  const summaryNumericFields = ['advancers', 'decliners', 'unchanged', 'totalTradingValue', 'tradingValueChangeRate'];

  let etfsWithNullNumericField = 0;
  for (const etf of etfs) {
    if (etfNumericFields.some((field) => etf[field] === null)) etfsWithNullNumericField += 1;
    for (const field of etfNumericFields) assert.ok(isNumberOrNull(etf[field]), `etf.${field} must be number or null for ${etf.id}`);
  }
  for (const theme of themes) {
    for (const field of themeNumericFields) assert.equal(typeof theme[field], 'number', `theme.${field} must be number for ${theme.id}`);
  }
  for (const stock of stocks) {
    for (const field of stockNumericFields) assert.equal(typeof stock[field], 'number', `stock.${field} must be number for ${stock.id}`);
  }
  for (const holding of holdings) {
    for (const field of holdingNumericFields) assert.equal(typeof holding[field], 'number', `holding.${field} must be number for ${holding.etfId}:${holding.stockId}`);
  }
  for (const [period, summary] of Object.entries(marketSummaryByPeriod)) {
    for (const field of summaryNumericFields) assert.equal(typeof summary[field], 'number', `marketSummaryByPeriod.${period}.${field} must be number`);
  }
  assert.ok(etfsWithNullNumericField >= 2, 'at least two ETFs must include explicit null numeric fields');
});
