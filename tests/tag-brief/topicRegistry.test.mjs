import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateTopicRegistry } from '../../src/js/tag-brief/assign.js';

const registry = JSON.parse(readFileSync('data/fixtures/topic-registry.json', 'utf8'));
const articles = JSON.parse(readFileSync('data/fixtures/news-articles.json', 'utf8')).articles;

test('topic registry is a non-empty controlled vocabulary with Korean labels', () => {
  const topicIds = Object.keys(registry.topics);
  assert.ok(topicIds.length >= 1);
  for (const topicId of topicIds) {
    assert.match(topicId, /^topic\./);
    assert.equal(typeof registry.topics[topicId].label, 'string');
    assert.ok(registry.topics[topicId].label.length > 0);
  }
});

test('every mentionedTopicIds entry across the news fixtures exists in the topic registry', () => {
  const violations = validateTopicRegistry(articles, registry);
  assert.deepEqual(violations, []);
});

test('news fixture set contains 18-22 articles as required by the work order', () => {
  assert.ok(articles.length >= 18 && articles.length <= 22, `expected 18-22 articles, got ${articles.length}`);
});

test('every article has a unique id and both anchor arrays present', () => {
  const ids = articles.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const article of articles) {
    assert.ok(Array.isArray(article.mentionedStockIds));
    assert.ok(Array.isArray(article.mentionedTopicIds));
  }
});
