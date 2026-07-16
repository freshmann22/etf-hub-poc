import test from 'node:test';
import assert from 'node:assert/strict';

import { validateBrief, MAX_SUMMARY_LENGTH } from '../../src/js/tag-brief/policyGate.js';

const inputArticles = [
  { id: 'n1', mentionedStockIds: ['000660'], mentionedTopicIds: [] },
  { id: 'n2', mentionedStockIds: [], mentionedTopicIds: ['topic.rates'] },
];

function validBrief(overrides = {}) {
  return {
    title: '반도체 브리핑',
    summary: 'HBM 공급 소식이 있었어요.',
    keyPoints: ['거래대금이 늘었어요.'],
    sourceArticles: [{ id: 'n1' }],
    mentionedStockIds: ['000660'],
    mentionedTopicIds: ['topic.rates'],
    ...overrides,
  };
}

test('a well-formed brief passes the gate with no violations', () => {
  const result = validateBrief(validBrief(), inputArticles);
  assert.deepEqual(result, { valid: true, violations: [] });
});

test('forbidden inducement phrase in the summary fails the gate', () => {
  const brief = validBrief({ summary: '지금 사야 할 시점이라는 분석이 나왔어요.' });
  const result = validateBrief(brief, inputArticles);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.startsWith('forbidden_phrase:')));
});

test('forbidden action-prompting phrase in a key point fails the gate', () => {
  const brief = validBrief({ keyPoints: ['금리 상승에 대비해야 한다는 의견이에요.'] });
  const result = validateBrief(brief, inputArticles);
  assert.equal(result.valid, false);
});

test('sourceArticles referencing an article outside the input set fails the gate', () => {
  const brief = validBrief({ sourceArticles: [{ id: 'n1' }, { id: 'not-in-input' }] });
  const result = validateBrief(brief, inputArticles);
  assert.equal(result.valid, false);
  assert.ok(result.violations.includes('unknown_source_article:not-in-input'));
});

test('mentionedStockIds not present in any input article fails the gate', () => {
  const brief = validBrief({ mentionedStockIds: ['005930'] });
  const result = validateBrief(brief, inputArticles);
  assert.equal(result.valid, false);
  assert.ok(result.violations.includes('unsupported_stock_id:005930'));
});

test('mentionedTopicIds not present in any input article fails the gate', () => {
  const brief = validBrief({ mentionedTopicIds: ['topic.fx'] });
  const result = validateBrief(brief, inputArticles);
  assert.equal(result.valid, false);
  assert.ok(result.violations.includes('unsupported_topic_id:topic.fx'));
});

test('a summary longer than MAX_SUMMARY_LENGTH fails the gate', () => {
  const longSummary = 'SK하이닉스 관련 소식이 전해지며 거래대금이 크게 증가한 것으로 집계됐어요.';
  assert.ok(longSummary.length > MAX_SUMMARY_LENGTH);
  const brief = validBrief({ summary: longSummary });
  const result = validateBrief(brief, inputArticles);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.startsWith('summary_too_long:')));
});

test('a summary at exactly MAX_SUMMARY_LENGTH passes the length check', () => {
  const summary = '가'.repeat(MAX_SUMMARY_LENGTH);
  const brief = validBrief({ summary });
  const result = validateBrief(brief, inputArticles);
  assert.ok(!result.violations.some((v) => v.startsWith('summary_too_long:')));
});
