import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildIssuerInventory,
  isinCandidateForShortCode,
  normalizeIssuerName,
} from '../scripts/metadata-v2/build-issuer-inventory.mjs';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('derives official-format ISIN candidates for numeric and alphanumeric short codes', () => {
  assert.equal(isinCandidateForShortCode('069500'), 'KR7069500007');
  assert.equal(isinCandidateForShortCode('0190M0'), 'KR70190M0008');
  assert.equal(isinCandidateForShortCode('bad'), null);
});

test('normalizes common Korean legal company suffixes', () => {
  assert.equal(normalizeIssuerName('삼성자산운용(주)'), normalizeIssuerName('삼성자산운용 주식회사'));
});

test('preserves all 1,141 master rows while resolving brands and reconciling the official probe', async () => {
  const [master, metadata, registry, officialProbe] = await Promise.all([
    readJson('../data/normalized/etf-master.json'),
    readJson('../data/normalized/etf-metadata.json'),
    readJson('../config/issuer-registry.json'),
    readJson('../data/reports/metadata-v2/publicdata-live-probe-summary.json'),
  ]);
  const inventory = buildIssuerInventory({ master, metadata, registry, officialProbe, generatedAt: '2026-07-21T00:00:00.000Z' });

  assert.equal(inventory.scope.inputEtfCount, 1141);
  assert.equal(inventory.scope.outputEtfCount, 1141);
  assert.equal(inventory.scope.rowOrderPreserved, true);
  assert.equal(inventory.coverage.issuerResolved.count, 1141);
  assert.equal(inventory.coverage.unresolvedIssuer.count, 0);
  assert.equal(inventory.coverage.shortCodeFormat.numeric6, 867);
  assert.equal(inventory.coverage.shortCodeFormat.alphanumeric6, 274);
  assert.equal(inventory.coverage.isinCandidateDerived.count, 1141);
  assert.equal(inventory.scope.officialCurrentUniverseCount, 1146);
  assert.equal(inventory.universeReconciliation.exactCodeOverlapCount, 1140);
  assert.deepEqual(inventory.universeReconciliation.localOnlyCodes, ['424460']);
  assert.equal(inventory.universeReconciliation.officialOnlyCount, 6);
  assert.deepEqual(inventory.rows.map((row) => row.sourceRecord), master.etfs);
});
