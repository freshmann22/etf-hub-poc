import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSourceResults, SOURCE_RESULT_CONTRACT, validateHoldings } from '../scripts/metadata-v2/merge-source-results.mjs';
import { makeFieldCandidate, makeProvenance } from '../scripts/metadata-v2/lib/provenance.js';

const NOW = new Date('2026-07-21T00:00:00.000Z');

function baseRecord(code, isin) {
  return {
    universeKey: code,
    identity: {
      shortCode: code,
      isin,
      officialName: `ETF ${code}`,
      aliases: [],
      issuerId: null,
      issuerName: null,
      listingDate: null,
      listingStatus: 'listed',
    },
    product: {
      description: null,
      investmentObjective: null,
      benchmark: { name: null, provider: null, indexCode: null, description: null },
      assetClasses: [],
      targetRegions: [],
      active: null,
      replication: null,
      derivative: { direction: null, multiple: null },
      currencyHedged: null,
      fundOfFunds: null,
    },
    portfolio: { asOfDate: null, holdings: [], sectorWeights: [], countryWeights: [] },
    distribution: { applicability: 'unknown', schedule: null, frequency: null, history: [] },
    fieldCandidates: {},
    conflicts: [],
    status: 'partial',
  };
}

function fixtures() {
  const records = [baseRecord('0000D0', 'KR70000D0009'), baseRecord('069500', 'KR7069500007')];
  return {
    identityMap: {
      universeCount: 2,
      records: records.map((record) => ({ universeKey: record.universeKey, identity: record.identity })),
    },
    canonical: { schemaVersion: '2.0.0', generatedAt: NOW.toISOString(), universeCount: 2, records },
    resolutionConfig: {
      default: { strategy: 'authority_then_confidence', sourcePriority: ['primary', 'secondary', 'derived'] },
      fields: { 'portfolio.holdings': { strategy: 'recency_then_authority', sourceIds: ['issuer_kodex', 'legacy_v1'] } },
    },
  };
}

function source(sourceId, sourceType, records) {
  return {
    schemaVersion: SOURCE_RESULT_CONTRACT.schemaVersion,
    source: {
      sourceId,
      sourceType,
      retrievedAt: '2026-07-21T00:00:00.000Z',
      parserVersion: `${sourceId}-1.0.0`,
      documentType: 'test_fixture',
      confidence: 0.95,
    },
    records,
  };
}

test('generic merge adds holdings and DART fields as candidates while preserving universe shape', () => {
  const input = fixtures();
  const holdings = source('issuer_kodex', 'primary', [{
    shortCode: '0000D0',
    status: 'ok',
    asOfDate: '2026-07-20',
    declaredRowCount: 2,
    fields: {
      'portfolio.holdings': [
        { stockCode: 'NVDA', stockName: 'NVIDIA', weight: 60 },
        { stockCode: 'CASH', stockName: 'Cash', weight: 40 },
      ],
    },
  }]);
  const dart = source('dart', 'primary', [{
    isin: 'KR70000D0009',
    status: 'ok',
    fields: {
      'product.description': 'Official product description',
      'product.investmentObjective': 'Track the target index before fees.',
    },
  }]);
  const result = mergeSourceResults({ ...input, sourceDocuments: [holdings, dart], now: NOW });
  assert.equal(result.output.records.length, 2);
  assert.equal(new Set(result.output.records.map((record) => record.universeKey)).size, 2);
  const merged = result.output.records[0];
  assert.equal(merged.portfolio.holdings.length, 2);
  assert.equal(merged.portfolio.asOfDate, '2026-07-20');
  assert.equal(merged.product.description, 'Official product description');
  assert.equal(merged.fieldCandidates['portfolio.holdings'][0].provenance.sourceId, 'issuer_kodex');
  assert.equal(merged.fieldCandidates['product.description'][0].provenance.sourceId, 'dart');
  assert.equal(result.quarantineReport.quarantinedCount, 0);
});

test('rerunning the same source result is candidate-idempotent', () => {
  const input = fixtures();
  const dart = source('dart', 'primary', [{ universeKey: '069500', status: 'ok', fields: { 'product.description': 'Official text' } }]);
  const first = mergeSourceResults({ ...input, sourceDocuments: [dart], now: NOW });
  const second = mergeSourceResults({ ...input, canonical: first.output, sourceDocuments: [dart], now: NOW });
  assert.equal(second.output.records[1].fieldCandidates['product.description'].length, 1);
  assert.deepEqual(second.output.records[1].fieldCandidates['product.description'], first.output.records[1].fieldCandidates['product.description']);
});

test('primary source overrides explicit legacy secondary candidate without deleting it', () => {
  const input = fixtures();
  const legacy = makeFieldCandidate({
    field: 'product.description',
    value: 'Legacy text',
    provenance: makeProvenance({
      sourceId: 'legacy_v1', sourceType: 'secondary', retrievedAt: '2026-07-14T00:00:00.000Z', parserVersion: '1', confidence: 0.6,
    }),
  });
  input.canonical.records[0].product.description = 'Legacy text';
  input.canonical.records[0].fieldCandidates['product.description'] = [legacy];
  const dart = source('dart', 'primary', [{ universeKey: '0000D0', status: 'ok', fields: { 'product.description': 'Official text' } }]);
  const result = mergeSourceResults({ ...input, sourceDocuments: [dart], now: NOW });
  const merged = result.output.records[0];
  assert.equal(merged.product.description, 'Official text');
  assert.equal(merged.fieldCandidates['product.description'].length, 2);
  assert.equal(merged.conflicts[0].field, 'product.description');
});

test('holdings gate accepts derivative exposure and quarantines corrupt rows, dates, and row counts', () => {
  assert.equal(validateHoldings([{ name: 'SHORT', weight: -70 }, { name: 'LONG', weight: 170 }], { asOfDate: '2026-07-20', now: NOW }).ok, true);
  assert.equal(validateHoldings([{ name: 'A', weight: 1001 }], { asOfDate: '2026-07-20', now: NOW }).reason, 'holdings_invalid_row');
  assert.equal(validateHoldings([{ name: 'A', weight: 100 }], { asOfDate: 'not-a-date', now: NOW }).reason, 'holdings_invalid_as_of_date');
  assert.equal(validateHoldings([{ name: 'A', weight: 50 }], { asOfDate: '2026-07-20', declaredRowCount: 2, now: NOW }).reason, 'holdings_declared_row_count_mismatch');

  const input = fixtures();
  const bad = source('issuer_kodex', 'primary', [{
    universeKey: '0000D0', status: 'ok', asOfDate: '2026-07-20',
    fields: { 'portfolio.holdings': [{ name: 'A', weight: 0 }, { name: 'B', weight: 0 }] },
  }]);
  const result = mergeSourceResults({ ...input, sourceDocuments: [bad], now: NOW });
  assert.equal(result.output.records[0].portfolio.holdings.length, 0);
  assert.equal(result.quarantineReport.items[0].reason, 'holdings_gross_weight_out_of_range');
});

test('malformed documents, conflicting identifiers, and unsupported fields are isolated', () => {
  const input = fixtures();
  const malformed = { source: { sourceId: 'bad' }, records: [] };
  const mixed = source('dart', 'primary', [{
    universeKey: '0000D0', shortCode: '069500', status: 'ok', fields: { 'fees.total': 0.1 },
  }]);
  const result = mergeSourceResults({ ...input, sourceDocuments: [malformed, mixed], now: NOW });
  assert.equal(result.quarantineReport.quarantinedCount, 2);
  assert.deepEqual(result.quarantineReport.items.map((item) => item.reason), ['malformed_source_document', 'conflicting_source_identifiers']);
  assert.equal(result.output.records.length, 2);
});
