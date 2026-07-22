import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleV2 } from '../scripts/metadata-v2/assemble-v2.mjs';

function identityRecord(code, overrides = {}) {
  return {
    universeKey: code,
    sourceRecord: { etfCode: code, name: `ETF ${code}`, status: 'listed' },
    identity: { shortCode: code, isin: `KR7${code}00X`, officialName: `ETF ${code}` },
    benchmarkName: null,
    fieldCandidates: [],
    status: 'resolved',
    ...overrides,
  };
}

test('assembler preserves the complete identity-map shape and makes v1 promotion explicit', () => {
  const identityMap = { universeCount: 3, records: [identityRecord('0000D0'), identityRecord('069500'), identityRecord('123450')] };
  const issuerInventory = {
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-21T00:00:00.000Z',
    rows: [{
      sourceRecord: { etfCode: '0000D0' },
      issuer: { id: 'issuer-a', displayNameKo: 'Issuer A', needsOfficialVerification: true },
    }],
  };
  const legacyMetadata = {
    records: [{
      etfCode: '0000D0',
      name: 'Legacy name',
      issuer: 'Legacy issuer',
      listingDate: '2024-12-17',
      benchmark: { name: 'Legacy index', provider: null, description: null },
      classificationFacts: { assetClass: 'equity', regions: ['US'], active: false, currencyHedged: null },
      descriptions: { productDescription: 'Legacy description', investmentObjective: null },
      holdings: [{ code: 'NVDA', name: 'NVIDIA', weight: 10 }],
      holdingsAsOfDate: '2026-07-20',
      sectorWeights: [],
      countryWeights: [],
      distribution: { scheduleText: 'quarterly', frequency: 'quarterly' },
      updatedAt: '2026-07-14T00:00:00.000Z',
    }],
  };
  const output = assembleV2({ identityMap, issuerInventory, legacyMetadata, now: '2026-07-21T00:00:00.000Z' });
  assert.equal(output.records.length, 3);
  assert.equal(new Set(output.records.map((record) => record.universeKey)).size, 3);
  const enriched = output.records[0];
  assert.equal(enriched.identity.issuerName, 'Issuer A');
  assert.equal(enriched.product.description, 'Legacy description');
  assert.equal(enriched.portfolio.holdings.length, 1);
  assert.equal(enriched.fieldCandidates['product.description'][0].provenance.sourceId, 'legacy_v1');
  assert.equal(enriched.fieldCandidates['product.description'][0].provenance.sourceType, 'secondary');
  assert.equal(enriched.fieldCandidates['identity.issuerName'].length, 2);
  assert.equal(output.records[2].portfolio.holdings.length, 0);
});

test('assembler rejects duplicate keys even when the row count matches', () => {
  const identityMap = { universeCount: 2, records: [identityRecord('069500'), identityRecord('069500')] };
  assert.throws(() => assembleV2({ identityMap, issuerInventory: { rows: [] }, legacyMetadata: { records: [] } }), /duplicate universeKey/);
});

test('official KIND delisting evidence overrides the 424460 snapshot quarantine', () => {
  const record = identityRecord('424460', { status: 'quarantined', quarantineReason: 'not_in_publicdata_snapshot' });
  const output = assembleV2({
    identityMap: { universeCount: 1, records: [record] },
    issuerInventory: { rows: [] },
    legacyMetadata: { records: [] },
    now: '2026-07-21T00:00:00.000Z',
  });
  assert.equal(output.records[0].identity.listingStatus, 'delisted');
  assert.equal(output.records[0].status, 'partial');
  const candidate = output.records[0].fieldCandidates['identity.listingStatus'][0];
  assert.equal(candidate.value, 'delisted');
  assert.equal(candidate.provenance.sourceId, 'kind');
  assert.match(candidate.provenance.url, /kind\.krx\.co\.kr/);
});
