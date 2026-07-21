import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShortCode, resolveIdentities } from '../../scripts/metadata-v2/lib/identity-resolver.js';

test('short code normalization preserves valid six-character alphanumeric KRX codes', () => {
  assert.equal(normalizeShortCode('0000d0'), '0000D0');
  assert.equal(normalizeShortCode('69500'), '069500');
  assert.equal(normalizeShortCode('not-a-code'), null);
});

test('identity resolver joins official alphanumeric code and ISIN without numeric coercion', () => {
  const universe = [
    { etfCode: '0000D0', name: 'Alpha ETF' },
    { etfCode: '069500', name: 'KODEX 200' },
  ];
  const official = [
    { srtnCd: '0000D0', isinCd: 'KR70000D0001', itmsNm: 'Alpha ETF', issuer: 'Issuer A' },
    { srtnCd: '069500', isinCd: 'KR7069500007', itmsNm: 'KODEX 200', issuer: 'Issuer B' },
  ];
  const result = resolveIdentities(universe, official);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].shortCode, '0000D0');
  assert.equal(result.records[0].matchMethod, 'short_code_exact');
  assert.deepEqual(result.quarantined, []);
});

test('name-only matching is forbidden and ambiguous identifiers are quarantined', () => {
  const official = [{ code: '0000D0', isin: 'KR70000D0001', name: 'Same Name', issuer: 'Issuer' }];
  const nameOnly = resolveIdentities([{ universeKey: 'local-1', name: 'Same Name' }], official);
  assert.equal(nameOnly.records.length, 0);
  assert.equal(nameOnly.quarantined[0].reason, 'unmatched');

  const duplicated = resolveIdentities([{ etfCode: '0000D0' }], [...official, { ...official[0], isin: 'KR70000D0019' }]);
  assert.equal(duplicated.records.length, 0);
  assert.equal(duplicated.quarantined[0].reason, 'conflicting_exact_identifiers');
});
