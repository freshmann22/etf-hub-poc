import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRuleQueryPlan, createTaxonomyIndex, validateQueryPlan } from '../src/query-plan.js';
import { rankByQueryPlan } from '../src/ranker.js';

const taxonomyIndex = createTaxonomyIndex({
  tags: [
    { id: 'sector.semiconductor', facet: 'sector', label: '반도체', enabled: true },
    { id: 'sector.healthcare', facet: 'sector', label: '헬스케어', enabled: true },
    { id: 'region.us', facet: 'region', label: '미국', enabled: true },
    { id: 'region.china', facet: 'region', label: '중국', enabled: true },
    { id: 'strategy.leverage', facet: 'strategy', label: '레버리지', enabled: true },
  ],
});

const context = {
  master: {
    A: { name: '미국 반도체 ETF' },
    B: { name: '국내 반도체 ETF' },
    C: { name: '미국 헬스케어 ETF' },
  },
  tagUniverse: {
    etfs: {
      A: { tags: [
        { tagId: 'sector.semiconductor', score: 1, confidence: 0.9 },
        { tagId: 'region.us', score: 0.8, confidence: 0.8 },
      ] },
      B: { tags: [{ tagId: 'sector.semiconductor', score: 0.7, confidence: 0.8 }] },
      C: { tags: [
        { tagId: 'sector.healthcare', score: 0.9, confidence: 0.9 },
        { tagId: 'region.us', score: 0.9, confidence: 0.9 },
      ] },
    },
  },
  marketSnapshot: [
    { code: 'A', volume: 100 },
    { code: 'B', volume: 500 },
    { code: 'C', volume: 1000 },
  ],
};

function validated(candidate) {
  return validateQueryPlan(candidate, taxonomyIndex).plan;
}

test('query plan validation rejects unknown tags, clamps scores, and supplies taxonomy labels', () => {
  const result = validateQueryPlan({
    intent: 'TAG_MATCH',
    tags: [
      { tagId: 'sector.semiconductor', queryScore: 1.4, mode: 'required' },
      { tagId: 'invented.tag', queryScore: 0.9, mode: 'preferred' },
    ],
  }, taxonomyIndex);
  assert.equal(result.plan.tags.length, 1);
  assert.deepEqual(result.plan.tags[0], {
    tagId: 'sector.semiconductor', facet: 'sector', label: '반도체', queryScore: 1, mode: 'required', reason: '',
  });
  assert.deepEqual(result.warnings, ['unknown_tag:invented.tag']);
});

test('rule parser output converts to the same weighted query-plan contract', () => {
  const plan = buildRuleQueryPlan({
    intent: 'COMPOSITE',
    tagGroups: [{ tagIds: ['sector.semiconductor'], matchedKeyword: '반도체' }],
    sortField: 'volume', sortDir: 'desc', sortLabel: '거래량',
  });
  assert.equal(plan.tags[0].queryScore, 1);
  assert.equal(plan.tags[0].mode, 'required');
  assert.equal(plan.sort.field, 'volume');
});

test('weighted ranking combines query score, ETF tag score, and confidence', () => {
  const plan = validated({ tags: [
    { tagId: 'sector.semiconductor', queryScore: 1, mode: 'required' },
    { tagId: 'region.us', queryScore: 0.8, mode: 'preferred' },
  ] });
  const result = rankByQueryPlan(context, plan);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items.map((item) => item.code), ['A', 'B']);
  assert.ok(result.items[0].relevanceScore > result.items[1].relevanceScore);
  assert.deepEqual(result.items[0].matchedTags.map((tag) => tag.tagId), ['sector.semiconductor', 'region.us']);
});

test('required tags use OR within a facet and AND across facets', () => {
  const plan = validated({ tags: [
    { tagId: 'sector.semiconductor', queryScore: 1, mode: 'required' },
    { tagId: 'sector.healthcare', queryScore: 0.6, mode: 'required' },
    { tagId: 'region.us', queryScore: 0.9, mode: 'required' },
  ] });
  const result = rankByQueryPlan(context, plan);
  assert.deepEqual(result.items.map((item) => item.code), ['A', 'C']);
  assert.ok(result.items[0].relevanceScore >= 75);
});

test('explicit market sort applies after required tag filtering', () => {
  const plan = validated({
    tags: [{ tagId: 'sector.semiconductor', queryScore: 1, mode: 'required' }],
    sort: { field: 'volume', direction: 'desc', label: '거래량' },
  });
  const result = rankByQueryPlan(context, plan);
  assert.deepEqual(result.items.map((item) => item.code), ['B', 'A']);
  assert.match(result.items[0].evidence, /거래량 500주/);
});

test('unsatisfied cross-facet requirements return an explicit relaxed fallback', () => {
  const plan = validated({ tags: [
    { tagId: 'sector.semiconductor', queryScore: 1, mode: 'required' },
    { tagId: 'region.china', queryScore: 1, mode: 'required' },
  ] });
  const result = rankByQueryPlan(context, plan);
  assert.equal(result.status, 'fallback');
  assert.ok(result.items.length > 0);
  assert.match(result.note, /필수 조건을 모두 만족/);
});
