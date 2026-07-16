import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTagUniverses, getTaxonomyVersion } from '../../src/js/tag-brief/universeAdapter.js';

const EXPECTED_TAG_IDS = [
  'sector.semiconductor',
  'sector.aerospace_defense',
  'sector.ev_battery',
  'sector.shipbuilding',
  'strategy.sp500',
  'provisional.bond_krw',
];

test('buildTagUniverses returns exactly the 6 in-scope tags', () => {
  const universes = buildTagUniverses();
  assert.deepEqual([...universes.keys()].sort(), [...EXPECTED_TAG_IDS].sort());
});

test('provisional tags are flagged and non-provisional tags are not', () => {
  const universes = buildTagUniverses();
  assert.equal(universes.get('sector.shipbuilding').provisional, true);
  assert.equal(universes.get('provisional.bond_krw').provisional, true);
  assert.equal(universes.get('sector.semiconductor').provisional, false);
  assert.equal(universes.get('strategy.sp500').provisional, false);
});

test('index/asset tags may have empty stockIds while still having ETFs and topics', () => {
  const universes = buildTagUniverses();
  const sp500 = universes.get('strategy.sp500');
  assert.deepEqual(sp500.stockIds, []);
  assert.ok(sp500.etfIds.length > 0);
  assert.ok(sp500.topicIds.length > 0);

  const bond = universes.get('provisional.bond_krw');
  assert.deepEqual(bond.stockIds, []);
  assert.ok(bond.etfIds.length > 0);
});

test('sector tags carry non-empty stock anchors sourced from real holdings data', () => {
  const universes = buildTagUniverses();
  const semi = universes.get('sector.semiconductor');
  assert.ok(semi.stockIds.length > 0);
  assert.ok(semi.stockIds.every((id) => typeof id === 'string' && id.length > 0));
});

test('tagId is opaque: every universe carries tagId/tagCategory/label/etfIds/stockIds/topicIds/provisional', () => {
  const universes = buildTagUniverses();
  for (const universe of universes.values()) {
    assert.equal(typeof universe.tagId, 'string');
    assert.equal(typeof universe.tagCategory, 'string');
    assert.equal(typeof universe.label, 'string');
    assert.ok(Array.isArray(universe.etfIds));
    assert.ok(Array.isArray(universe.stockIds));
    assert.ok(Array.isArray(universe.topicIds));
    assert.equal(typeof universe.provisional, 'boolean');
  }
});

test('getTaxonomyVersion returns the version stamped in the filter-map', () => {
  assert.equal(typeof getTaxonomyVersion(), 'string');
});
