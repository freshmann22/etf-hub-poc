import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProvenance, makeFieldCandidate, sha256, stableStringify } from '../../scripts/metadata-v2/lib/provenance.js';

test('provenance requires parser/source metadata and produces deterministic candidate ids', () => {
  const provenance = makeProvenance({
    sourceId: 'publicdata',
    sourceType: 'primary',
    retrievedAt: '2026-07-21T00:00:00.000Z',
    asOfDate: '2026-07-20',
    parserVersion: '1.0.0',
    contentHash: sha256('raw'),
    confidence: 0.95,
  });
  const first = makeFieldCandidate({ field: 'identity.shortCode', value: '0000D0', provenance });
  const second = makeFieldCandidate({ field: 'identity.shortCode', value: '0000D0', provenance });
  assert.equal(first.candidateId, second.candidateId);
  assert.equal(first.provenance.sourceType, 'primary');
});

test('stable stringify is independent of object key insertion order', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
});

test('invalid provenance is rejected', () => {
  assert.throws(() => makeProvenance({ sourceId: 'x', sourceType: 'guessed', parserVersion: '1' }), /sourceType/);
  assert.throws(() => makeProvenance({ sourceId: 'x', sourceType: 'derived', parserVersion: '' }), /parserVersion/);
});
