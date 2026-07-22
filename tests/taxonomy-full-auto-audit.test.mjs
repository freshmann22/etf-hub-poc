import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTaxonomyAutoAudit } from '../scripts/tagging/run-full-taxonomy-auto-audit.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const inputs = () => ({ canonical: read('data/normalized/etf-metadata-v2.json'), scores: read('data/tagging/etf-tag-scores.json'), taxonomy: read('config/etf-tagging/etf-taxonomy.json'), dartAudit: read('data/reports/metadata-v2/dart-lineage-audit.json'), now: '2026-07-22T00:00:00.000Z' });

test('full auto audit preserves the complete universe and valid unique tags', () => {
  const { output, report } = buildTaxonomyAutoAudit(inputs());
  const valid = new Set(inputs().taxonomy.tags.map((tag) => tag.id));
  assert.equal(Object.keys(output.etfs).length, 1141);
  assert.equal(report.summary.universeCount, 1141);
  for (const etf of Object.values(output.etfs)) {
    const ids = etf.classifications.map((item) => item.tagId);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => valid.has(id)));
  }
});

test('high-confidence commodity, mixed, region and monthly rules are applied', () => {
  const { output } = buildTaxonomyAutoAudit(inputs());
  const tags = (code) => output.etfs[code].classifications.map((item) => item.tagId);
  assert.ok(tags('139320').includes('asset.commodity'));
  assert.ok(!tags('139320').includes('asset.equity'));
  assert.ok(tags('0086C0').includes('asset.mixed'));
  assert.ok(tags('456250').includes('region.developed'));
  assert.ok(!tags('487950').includes('region.us'));
  assert.ok(output.automatedFullAudit.quarantinedAssignments.length > 0);
});

test('full auto audit is tag-idempotent', () => {
  const first = buildTaxonomyAutoAudit(inputs());
  const second = buildTaxonomyAutoAudit({ ...inputs(), scores: first.output });
  const tags = (output) => Object.fromEntries(Object.entries(output.etfs).map(([code, etf]) => [code, etf.classifications.map((item) => item.tagId)]));
  assert.deepEqual(tags(first.output), tags(second.output));
});
