import test from 'node:test';
import assert from 'node:assert/strict';

import { generateBrief } from '../../src/js/tag-brief/generate.js';

const tagUniverse = {
  tagId: 'sector.semiconductor',
  tagCategory: 'sector',
  label: '반도체',
  stockIds: ['000660'],
  topicIds: [],
  etfIds: ['091160'],
  provisional: false,
};

const twoArticles = [
  { id: 'n1', title: '기사1', source: '샘플 뉴스', publishedAt: '2026-07-14T00:00:00+09:00', mentionedStockIds: ['000660'], mentionedTopicIds: [] },
  { id: 'n2', title: '기사2', source: '샘플 뉴스', publishedAt: '2026-07-13T00:00:00+09:00', mentionedStockIds: ['000660'], mentionedTopicIds: [] },
];

const validContentProvider = () => ({
  title: '반도체 브리핑',
  summary: 'HBM 공급 소식이 있었어요.',
  keyPoints: ['거래대금이 늘었어요.'],
  mentionedStockIds: ['000660'],
  mentionedTopicIds: [],
});

test('fewer than 2 assigned articles yields an unpublished result, never a padded brief', () => {
  const result = generateBrief({
    tagUniverse,
    articles: [twoArticles[0]],
    briefDate: '2026-07-16',
    taxonomyVersion: '1.0.0',
    generatedAt: '2026-07-16T00:00:00+09:00',
    generator: 'manual-sample',
    contentProvider: validContentProvider,
  });
  assert.deepEqual(result, { tagId: 'sector.semiconductor', briefDate: '2026-07-16', unpublished: true, reason: 'insufficient_articles', articleCount: 1 });
});

test('a valid content provider produces a full schema-conformant brief on the first attempt', () => {
  const result = generateBrief({
    tagUniverse,
    articles: twoArticles,
    briefDate: '2026-07-16',
    taxonomyVersion: '1.0.0',
    generatedAt: '2026-07-16T00:00:00+09:00',
    generator: 'manual-sample',
    contentProvider: validContentProvider,
  });
  assert.equal(result.unpublished, undefined);
  assert.equal(result.id, 'tag-brief-sector.semiconductor-20260716');
  assert.equal(result.type, 'tag_brief');
  assert.equal(result.tagId, 'sector.semiconductor');
  assert.deepEqual(result.sourceArticles.map((a) => a.id), ['n1', 'n2']);
  assert.deepEqual(result.relatedEtfIds, ['091160']);
  assert.deepEqual(result.universeSnapshot, { stockCount: 1, etfCount: 1, provisional: false });
});

test('a policy-gate failure on attempt 1 that succeeds on attempt 2 (regenerate-once) returns a valid brief', () => {
  let calls = 0;
  const flakyProvider = () => {
    calls += 1;
    if (calls === 1) return { ...validContentProvider(), summary: '지금 사야 할 시점이에요.' };
    return validContentProvider();
  };
  const result = generateBrief({
    tagUniverse,
    articles: twoArticles,
    briefDate: '2026-07-16',
    taxonomyVersion: '1.0.0',
    generatedAt: '2026-07-16T00:00:00+09:00',
    generator: 'manual-sample',
    contentProvider: flakyProvider,
  });
  assert.equal(calls, 2);
  assert.equal(result.unpublished, undefined);
  assert.equal(result.summary, 'HBM 공급 소식이 있었어요.');
});

test('a policy-gate failure on both attempts marks the tag unpublished', () => {
  const alwaysBadProvider = () => ({ ...validContentProvider(), summary: '지금 사야 할 시점이에요.' });
  const result = generateBrief({
    tagUniverse,
    articles: twoArticles,
    briefDate: '2026-07-16',
    taxonomyVersion: '1.0.0',
    generatedAt: '2026-07-16T00:00:00+09:00',
    generator: 'manual-sample',
    contentProvider: alwaysBadProvider,
  });
  assert.equal(result.unpublished, true);
  assert.equal(result.reason, 'policy_gate_failed');
  assert.ok(result.violations.length > 0);
});
