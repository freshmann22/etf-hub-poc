import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconciliation } from '../scripts/metadata-v2/reconcile-publicdata.mjs';

test('publicdata reconciliation preserves universe and quarantines local-only rows', () => {
  const master = {
    generatedAt: '2026-07-14T00:00:00.000Z',
    etfs: [
      { etfCode: '0000D0', name: 'Alpha ETF' },
      { etfCode: '424460', name: 'Old ETF' },
    ],
  };
  const inventory = { rows: [
    { sourceRecord: { etfCode: '0000D0' }, issuer: { id: 'issuer-a', displayNameKo: '운용사A' }, identifiers: { krxShortCodeCandidate: '0000D0', isinCandidate: 'KR70000D0009' } },
    { sourceRecord: { etfCode: '424460' }, issuer: { id: 'issuer-b', displayNameKo: '운용사B' }, identifiers: { krxShortCodeCandidate: '424460', isinCandidate: 'KR7424460006' } },
  ] };
  const officialRows = [
    { code: '0000D0', isin: 'KR70000D0009', name: 'Alpha ETF', indexName: 'Alpha Index' },
    { code: '0219E0', isin: 'KR70219E0005', name: 'New ETF', indexName: 'New Index' },
  ];
  const rawEntry = { path: 'publicdata/2026-07-21/test.json', contentHash: 'a'.repeat(64) };
  const result = buildReconciliation({ master, inventory, officialRows, rawEntry, retrievedAt: '2026-07-21T00:00:00.000Z', asOfDate: '2026-07-20' });

  assert.equal(result.identityMap.records.length, 2);
  assert.equal(result.report.summary.resolved, 1);
  assert.equal(result.report.summary.quarantined, 1);
  assert.equal(result.report.summary.officialOnly, 1);
  assert.equal(result.report.summary.verifiedAlphanumeric, 1);
  assert.equal(result.report.summary.isinCandidateMismatches, 0);
  assert.equal(result.identityMap.records[0].identity.isin, 'KR70000D0009');
  assert.equal(result.identityMap.records[0].identity.issuerId, 'issuer-a');
  assert.equal(result.identityMap.records[0].fieldCandidates.length, 4);
});
