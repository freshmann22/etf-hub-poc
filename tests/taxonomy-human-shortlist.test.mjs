import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildShortlist, renderHtml } from '../scripts/tagging/build-taxonomy-human-shortlist.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('human shortlist is a valid 24-item subset with traceable snapshots', () => {
  const report = buildShortlist();
  const parent = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reports/etf-taxonomy-review-sample-v2.json'), 'utf8'));
  const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/etf-tagging/etf-taxonomy.json'), 'utf8'));
  const parentCodes = new Set(parent.items.map((item) => item.etfCode));
  const validTags = new Set(taxonomy.tags.map((tag) => tag.id));
  assert.equal(report.items.length, 24);
  assert.equal(new Set(report.items.map((item) => item.etfCode)).size, 24);
  assert.ok(report.items.every((item) => parentCodes.has(item.etfCode)));
  assert.ok(report.items.every((item) => item.parentSampleNumber > 0 && item.contextHash.length === 64));
  assert.ok(report.items.every((item) => item.reasons.length && item.aiRecommendation && item.evidence));
  assert.ok(report.items.flatMap((item) => item.currentClassifications).every((tag) => validTags.has(tag.tagId)));
  assert.equal(report.deferredEnrichment.length, 3);
  assert.equal(report.parentSample.contentHash.length, 64);
});

test('shortlist selection is deterministic apart from generatedAt', () => {
  const a = buildShortlist();
  const b = buildShortlist();
  assert.deepEqual(a.items, b.items);
  assert.deepEqual(a.summary, b.summary);
});

test('review HTML includes guarded persistence, round-trip, print and decision fields', () => {
  const html = renderHtml(buildShortlist());
  for (const marker of ['localStorage', 'importFile', 'exportBtn', 'window.print', 'reviewer', 'reviewedAgainstHash', 'missingEvidence', 'nextAction', 'parentSample.contentHash', 'confirm(']) {
    assert.ok(html.includes(marker), `missing HTML marker: ${marker}`);
  }
  assert.ok(html.includes('@media print'));
  assert.ok(!html.includes('/200'));
});
