import test from 'node:test';
import assert from 'node:assert/strict';

import { articleMatchesUniverse, assignArticles, validateTopicRegistry } from '../../src/js/tag-brief/assign.js';

const semiUniverse = { tagId: 'sector.semiconductor', stockIds: ['000660', '005930'], topicIds: [] };
const sp500Universe = { tagId: 'strategy.sp500', stockIds: [], topicIds: ['topic.us_index', 'topic.rates'] };
const bondUniverse = { tagId: 'provisional.bond_krw', stockIds: [], topicIds: ['topic.rates', 'topic.credit'] };

const registry = {
  topics: {
    'topic.us_index': { label: '미국 대표지수' },
    'topic.rates': { label: '금리/통화정책' },
    'topic.credit': { label: '크레딧/스프레드' },
    'topic.fx': { label: '환율' },
  },
};

test('article with a matching stock anchor only joins the sector universe', () => {
  const article = { id: 'a1', mentionedStockIds: ['000660'], mentionedTopicIds: [] };
  assert.equal(articleMatchesUniverse(article, semiUniverse), true);
});

test('article with a matching topic anchor only joins the index universe', () => {
  const article = { id: 'a2', mentionedStockIds: [], mentionedTopicIds: ['topic.us_index'] };
  assert.equal(articleMatchesUniverse(article, sp500Universe), true);
  assert.equal(articleMatchesUniverse(article, semiUniverse), false);
});

test('article with both stock and topic anchors matches via either', () => {
  const article = { id: 'a3', mentionedStockIds: ['005930'], mentionedTopicIds: ['topic.rates'] };
  assert.equal(articleMatchesUniverse(article, semiUniverse), true);
  assert.equal(articleMatchesUniverse(article, sp500Universe), true);
});

test('a single article can be assigned to multiple tags (rates article joins sp500 and bond)', () => {
  const article = { id: 'a4', mentionedStockIds: [], mentionedTopicIds: ['topic.us_index', 'topic.rates'] };
  const { byTag, unassigned } = assignArticles([article], [sp500Universe, bondUniverse, semiUniverse]);
  assert.deepEqual(byTag.get('strategy.sp500').map((x) => x.id), ['a4']);
  assert.deepEqual(byTag.get('provisional.bond_krw').map((x) => x.id), ['a4']);
  assert.deepEqual(byTag.get('sector.semiconductor'), []);
  assert.deepEqual(unassigned, []);
});

test('article matching no universe is reported as unassigned', () => {
  const article = { id: 'a5', mentionedStockIds: ['005380'], mentionedTopicIds: ['topic.fx'] };
  const { byTag, unassigned } = assignArticles([article], [semiUniverse, sp500Universe, bondUniverse]);
  for (const list of byTag.values()) assert.deepEqual(list, []);
  assert.deepEqual(unassigned.map((x) => x.id), ['a5']);
});

test('a tag with zero matching articles yields an empty (not missing) list', () => {
  const { byTag } = assignArticles([], [semiUniverse]);
  assert.ok(byTag.has('sector.semiconductor'));
  assert.deepEqual(byTag.get('sector.semiconductor'), []);
});

test('assignArticles accepts a Map of universes (as returned by buildTagUniverses)', () => {
  const universes = new Map([['sector.semiconductor', semiUniverse]]);
  const article = { id: 'a6', mentionedStockIds: ['000660'], mentionedTopicIds: [] };
  const { byTag } = assignArticles([article], universes);
  assert.deepEqual(byTag.get('sector.semiconductor').map((x) => x.id), ['a6']);
});

test('validateTopicRegistry reports violations for topic ids missing from the registry', () => {
  const articles = [
    { id: 'good', mentionedTopicIds: ['topic.rates'] },
    { id: 'bad', mentionedTopicIds: ['topic.made_up'] },
  ];
  const violations = validateTopicRegistry(articles, registry);
  assert.deepEqual(violations, [{ articleId: 'bad', topicId: 'topic.made_up' }]);
});

test('validateTopicRegistry passes when every topic id is registered', () => {
  const articles = [{ id: 'ok', mentionedTopicIds: ['topic.us_index', 'topic.fx'] }];
  assert.deepEqual(validateTopicRegistry(articles, registry), []);
});
