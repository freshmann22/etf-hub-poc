import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const exploreMap = JSON.parse(readFileSync('config/etf-tagging/explore-tag-map.json', 'utf8'));
const taxonomy = JSON.parse(readFileSync('config/etf-tagging/etf-taxonomy.json', 'utf8'));
const filterMap = JSON.parse(readFileSync('data/tagging/etf-filter-map.json', 'utf8'));
const topicRegistry = JSON.parse(readFileSync('data/fixtures/topic-registry.json', 'utf8'));
const briefFixture = JSON.parse(readFileSync('data/fixtures/tag-briefs.json', 'utf8'));

const taxonomyById = new Map(taxonomy.tags.map((tag) => [tag.id, tag]));
const facetById = new Map(taxonomy.facets.map((facet) => [facet.id, facet]));
const uiFilters = exploreMap.facets.flatMap((facet) => facet.filters.map((filter) => ({ ...filter, facetId: facet.id })));
const uiByTagId = new Map(uiFilters.map((filter) => [filter.tagId, filter]));

test('Explore map, filter map, taxonomy, and briefs use one taxonomy version', () => {
  assert.equal(exploreMap.taxonomyVersion, taxonomy.version);
  assert.equal(filterMap.taxonomyVersion, taxonomy.version);
  assert.equal(briefFixture.taxonomyVersion, taxonomy.version);
});

test('every Explore facet and filter matches the canonical taxonomy', () => {
  const seen = new Set();
  for (const facet of exploreMap.facets) {
    const canonicalFacet = facetById.get(facet.id);
    assert.ok(canonicalFacet, `unknown facet: ${facet.id}`);
    assert.equal(facet.label, canonicalFacet.label);
    assert.equal(facet.cardinality, canonicalFacet.cardinality);

    for (const filter of facet.filters) {
      assert.ok(!seen.has(filter.tagId), `duplicate UI filter: ${filter.tagId}`);
      seen.add(filter.tagId);
      const canonicalTag = taxonomyById.get(filter.tagId);
      assert.ok(canonicalTag, `unknown taxonomy tag: ${filter.tagId}`);
      assert.equal(canonicalTag.enabled, true, `${filter.tagId} is disabled`);
      assert.equal(filter.label, canonicalTag.label, `${filter.tagId} label mismatch`);
      assert.equal(canonicalTag.facet, facet.id, `${filter.tagId} is under the wrong facet`);
      assert.equal(filter.parentTagId ?? null, canonicalTag.parent ?? null, `${filter.tagId} parent mismatch`);
      assert.ok((filterMap.filters[filter.tagId] || []).length > 0, `${filter.tagId} has no classified ETFs`);
    }
  }
});

test('default selection is a declared Explore filter', () => {
  const selected = uiByTagId.get(exploreMap.defaultSelection.tagId);
  assert.ok(selected);
  assert.equal(selected.facetId, exploreMap.defaultSelection.facetId);
});

test('brief channels target UI filters and use registered news topics', () => {
  const validTopics = new Set(Object.keys(topicRegistry.topics));
  const channelIds = new Set();
  for (const channel of exploreMap.briefChannels) {
    assert.ok(uiByTagId.has(channel.targetTagId), `brief target is not a UI filter: ${channel.targetTagId}`);
    assert.ok(!channelIds.has(channel.targetTagId), `duplicate brief channel: ${channel.targetTagId}`);
    channelIds.add(channel.targetTagId);
    assert.equal(channel.stockAnchorMode, 'top_holdings');
    assert.ok(Number.isInteger(channel.stockAnchorLimit) && channel.stockAnchorLimit > 0);
    for (const topicId of channel.newsTopicIds) {
      assert.ok(validTopics.has(topicId), `unregistered topic: ${topicId}`);
    }
  }

  assert.deepEqual(
    [...channelIds].sort(),
    briefFixture.briefs.map((brief) => brief.tagId).sort(),
    'published sample briefs and configured channels must stay aligned',
  );
});
