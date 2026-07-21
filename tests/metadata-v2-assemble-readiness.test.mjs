import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadiness, facetEligibility, facetEvidenceReady, readinessCsv } from '../scripts/metadata-v2/build-readiness-v2.mjs';

function record(key, assetClasses, applicability = 'unknown') {
  return {
    universeKey: key,
    identity: { shortCode: key, isin: null, officialName: key, issuerName: null },
    product: {
      description: null,
      investmentObjective: null,
      benchmark: { name: null },
      assetClasses,
      targetRegions: [],
    },
    portfolio: { holdings: [], sectorWeights: [], countryWeights: [] },
    distribution: { applicability, schedule: null, frequency: null, history: [] },
    fieldCandidates: {},
    status: 'partial',
  };
}

test('facet readiness separates eligible, not-applicable, and unknown denominators', () => {
  const equity = record('000001', ['equity'], 'applicable');
  equity.product.targetRegions = ['US'];
  equity.portfolio.sectorWeights = [{ key: 'IT', label: 'IT', weight: 100 }];
  equity.distribution.schedule = 'monthly';
  equity.distribution.history = [{ payDate: '2026-07-01', amount: 10 }];
  const commodity = record('000002', ['commodity'], 'not_applicable');
  const unknown = record('000003', [], 'unknown');

  assert.equal(facetEligibility(equity, 'sector'), 'eligible');
  assert.equal(facetEvidenceReady(equity, 'sector'), true);
  assert.equal(facetEligibility(commodity, 'region'), 'not_applicable');
  assert.equal(facetEligibility(unknown, 'region'), 'unknown');

  const report = buildReadiness({ schemaVersion: '2.0.0', universeCount: 3, records: [equity, commodity, unknown] });
  assert.deepEqual(report.facets.region.eligibility, { eligible: 1, not_applicable: 1, unknown: 1 });
  assert.equal(report.facets.region.eligibleEvidence.readyPct, 100);
  assert.equal(report.facets.dividend.eligibility.not_applicable, 1);
  assert.equal(report.facets.dividend.eligibleEvidence.ready, 1);
  assert.equal(report.shapePreserved, true);
  assert.match(readinessCsv(report.rows), /regionEligibility/);
});

test('readiness rejects a truncated universe', () => {
  assert.throws(() => buildReadiness({ universeCount: 2, records: [record('000001', [])] }), /shape mismatch/);
});
