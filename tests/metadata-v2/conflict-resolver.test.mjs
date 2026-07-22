import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFieldCandidate, makeProvenance } from '../../scripts/metadata-v2/lib/provenance.js';
import { resolveCandidates } from '../../scripts/metadata-v2/lib/conflict-resolver.js';

function candidate(field, value, sourceId, sourceType, asOfDate, confidence = 0.9) {
  return makeFieldCandidate({
    field,
    value,
    provenance: makeProvenance({
      sourceId,
      sourceType,
      asOfDate,
      retrievedAt: '2026-07-21T00:00:00.000Z',
      parserVersion: '1',
      confidence,
    }),
  });
}

test('dynamic fields select newer observation before authority and preserve conflict', () => {
  const oldPrimary = candidate('portfolio.holdings', ['A'], 'issuer', 'primary', '2026-07-01');
  const newSecondary = candidate('portfolio.holdings', ['B'], 'wisereport', 'secondary', '2026-07-20');
  const result = resolveCandidates('portfolio.holdings', [oldPrimary, newSecondary], {
    fields: { 'portfolio.holdings': { strategy: 'recency_then_authority', sourceIds: ['issuer', 'wisereport'] } },
  });
  assert.equal(result.selected.candidateId, newSecondary.candidateId);
  assert.equal(result.conflict.severity, 'warning');
  assert.equal(result.candidates.length, 2);
});

test('hard identity disagreements yield no selected value', () => {
  const krx = candidate('identity.isin', 'KR70000D0001', 'krx', 'primary', null);
  const publicdata = candidate('identity.isin', 'KR70000D0019', 'publicdata', 'primary', null);
  const result = resolveCandidates('identity.isin', [krx, publicdata], {
    fields: { 'identity.isin': { strategy: 'authority_then_confidence', sourceIds: ['krx', 'publicdata'], hardConflict: true } },
  });
  assert.equal(result.selected, null);
  assert.equal(result.conflict.severity, 'hard');
  assert.equal(result.conflict.selectedCandidateId, null);
});

test('numeric differences inside configured tolerance are not conflicts', () => {
  const a = candidate('portfolio.weight', 10, 'issuer', 'primary', '2026-07-20');
  const b = candidate('portfolio.weight', 10.05, 'wisereport', 'secondary', '2026-07-20');
  const result = resolveCandidates('portfolio.weight', [a, b], {
    fields: { 'portfolio.weight': { numericTolerance: 0.1 } },
  });
  assert.equal(result.conflict, null);
});
