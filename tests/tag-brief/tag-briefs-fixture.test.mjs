import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateBrief, FORBIDDEN_PHRASES, MAX_SUMMARY_LENGTH } from '../../src/js/tag-brief/policyGate.js';

const fixture = JSON.parse(readFileSync('data/fixtures/tag-briefs.json', 'utf8'));
const articles = JSON.parse(readFileSync('data/fixtures/news-articles.json', 'utf8')).articles;
const registry = JSON.parse(readFileSync('data/fixtures/topic-registry.json', 'utf8'));
const articleById = new Map(articles.map((article) => [article.id, article]));

const REQUIRED_FIELDS = [
  'id', 'type', 'tagId', 'tagCategory', 'briefDate', 'title', 'summary', 'keyPoints',
  'sourceArticles', 'relatedEtfIds', 'mentionedStockIds', 'mentionedTopicIds',
  'taxonomyVersion', 'universeSnapshot', 'generatedAt', 'generator',
];

test('tag-briefs.json contains a brief for each of the 6 in-scope tags (all had >=2 assigned articles)', () => {
  assert.equal(fixture.generationMode, 'manual');
  const tagIds = fixture.briefs.map((brief) => brief.tagId).sort();
  assert.deepEqual(tagIds, [
    'asset.bond',
    'sector.aerospace_defense',
    'sector.ev_battery',
    'sector.semiconductor',
    'sector.shipbuilding',
    'strategy.benchmark.sp500',
  ]);
  assert.deepEqual(fixture.unpublished, []);
});

test('every brief conforms to the §4 output schema', () => {
  for (const brief of fixture.briefs) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(brief, field), `${brief.tagId} missing field ${field}`);
    }
    assert.equal(brief.type, 'tag_brief');
    assert.ok(brief.keyPoints.length >= 2 && brief.keyPoints.length <= 3);
    assert.ok(brief.summary.length > 0 && brief.summary.length <= MAX_SUMMARY_LENGTH, `${brief.tagId} summary must be a short general one-liner (<=${MAX_SUMMARY_LENGTH} chars)`);
    assert.equal(brief.generator, 'manual-sample');
    assert.equal(typeof brief.universeSnapshot.stockCount, 'number');
    assert.equal(typeof brief.universeSnapshot.etfCount, 'number');
    assert.equal(typeof brief.universeSnapshot.provisional, 'boolean');
  }
});

test('no fixture brief is flagged provisional under taxonomy v2 (shipbuilding and bond were promoted)', () => {
  const byTag = new Map(fixture.briefs.map((b) => [b.tagId, b]));
  for (const brief of fixture.briefs) {
    assert.equal(brief.universeSnapshot.provisional, false, `${brief.tagId} should not be provisional under v2`);
  }
  assert.ok(byTag.has('sector.shipbuilding'));
  assert.ok(byTag.has('asset.bond'));
});

test('index/asset-class briefs (empty stockIds universes) still publish with topic-based evidence', () => {
  const byTag = new Map(fixture.briefs.map((b) => [b.tagId, b]));
  const sp500 = byTag.get('strategy.benchmark.sp500');
  assert.equal(sp500.universeSnapshot.stockCount, 0);
  assert.ok(sp500.mentionedTopicIds.length > 0);
  assert.deepEqual(sp500.mentionedStockIds, []);
});

test('the forbidden-word scanner passes over every briefing fixture (title/summary/keyPoints)', () => {
  for (const brief of fixture.briefs) {
    const text = [brief.title, brief.summary, ...brief.keyPoints].join(' ');
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(!text.includes(phrase), `${brief.tagId} contains forbidden phrase: ${phrase}`);
    }
  }
});

test('every published brief independently re-passes the policy gate against its declared source articles', () => {
  for (const brief of fixture.briefs) {
    const sourceArticles = brief.sourceArticles.map((sa) => articleById.get(sa.id)).filter(Boolean);
    assert.equal(sourceArticles.length, brief.sourceArticles.length, `${brief.tagId} references an unknown source article`);
    const { valid, violations } = validateBrief(brief, sourceArticles);
    assert.ok(valid, `${brief.tagId} failed policy gate: ${JSON.stringify(violations)}`);
  }
});

test('mentionedTopicIds used in briefs are all registered in the topic vocabulary', () => {
  const validTopicIds = new Set(Object.keys(registry.topics));
  for (const brief of fixture.briefs) {
    for (const topicId of brief.mentionedTopicIds) {
      assert.ok(validTopicIds.has(topicId), `${brief.tagId} uses unregistered topic ${topicId}`);
    }
  }
});
