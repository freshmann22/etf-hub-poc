import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acceptAiRecommendations } from '../scripts/tagging/accept-taxonomy-shortlist-ai-review.mjs';
import { applyReviewedOverrides } from '../scripts/tagging/apply-taxonomy-reviewed-overrides.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('all 24 shortlist items receive an explicit AI-backed decision', () => {
  const report = acceptAiRecommendations({ reviewedAt: '2026-07-22T00:00:00.000Z' });
  assert.equal(report.items.length, 24);
  assert.deepEqual(report.summary.decisionCounts, { correct: 15, incorrect: 2, insufficient: 7 });
  assert.ok(report.items.every((item) => item.review.workflowStatus === 'reviewed'));
  assert.ok(report.items.every((item) => item.review.reviewedAgainstHash === item.contextHash));
  assert.ok(report.items.every((item) => item.review.reviewer));
});

test('clear region false positives are corrected without mutating unrelated tags', () => {
  const report = acceptAiRecommendations({ reviewedAt: '2026-07-22T00:00:00.000Z' });
  for (const code of ['0104P0', '0052D0']) {
    const item = report.items.find((entry) => entry.etfCode === code);
    assert.equal(item.review.decision, 'incorrect');
    assert.ok(!item.review.finalTagIds.includes('region.us'));
    assert.ok(item.review.finalTagIds.includes('region.domestic_kr'));
  }
});

test('lineage and evidence gaps stay explicitly insufficient', () => {
  const report = acceptAiRecommendations({ reviewedAt: '2026-07-22T00:00:00.000Z' });
  for (const code of ['490090', '458730', '489000', '375270', '0192T0', '487130', '157490']) {
    const item = report.items.find((entry) => entry.etfCode === code);
    assert.equal(item.review.decision, 'insufficient');
    assert.ok(item.review.missingEvidence);
    assert.ok(item.review.nextAction);
  }
});

test('US region rule no longer treats the Dow Jones brand alone as US exposure', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/etf-tagging/etf-tagging-rules.json'), 'utf8'));
  const rule = rules.tagRules.find((entry) => entry.tagId === 'region.us');
  const matcher = new RegExp(rule.pattern, rule.flags || '');
  assert.equal(matcher.test('Dow Jones Korea Dividend 30 지수'), false);
  assert.equal(matcher.test('KRX 다우존스 코리아 배당 30'), false);
  assert.equal(matcher.test('TIGER 미국배당다우존스'), true);
  assert.equal(matcher.test('S&P 500'), true);
});

test('only accepted incorrect decisions become score overrides', () => {
  const { applied } = applyReviewedOverrides();
  assert.deepEqual(applied.map((item) => item.etfCode).sort(), ['0052D0', '0104P0']);
  for (const item of applied) {
    assert.ok(!item.after.includes('region.us'));
    assert.ok(item.after.includes('region.domestic_kr'));
  }
});
