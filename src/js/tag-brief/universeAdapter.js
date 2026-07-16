// TagUniverse adapter — ETF 속성 태그와 뉴스 앵커를 브리핑 채널로 연결한다.
// UI와 이 어댑터는 같은 explore-tag-map.json을 소비한다.
// Everything downstream (assign.js, generate.js, policyGate.js, build script,
// rendering) consumes only the TagUniverse objects this module returns and
// must treat tagId as an opaque key — never branch on what a tag "means".
//
// Taxonomy v2 (2026-07-16 cutover, 5 facets / 56 tags) is in force.
// explore-tag-map.json alone defines which taxonomy tags become briefing
// channels and which controlled news topics anchor each channel.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const FILTER_MAP_PATH = path.join(REPO_ROOT, 'data', 'tagging', 'etf-filter-map.json');
const HOLDINGS_PATH = path.join(REPO_ROOT, 'data', 'normalized', 'etf-holdings.json');
const EXPLORE_TAG_MAP_PATH = path.join(REPO_ROOT, 'config', 'etf-tagging', 'explore-tag-map.json');

const CONFIDENCE_THRESHOLD = 0.5;

let cachedSources = null;

function loadSources() {
  if (cachedSources) return cachedSources;
  const filterMap = JSON.parse(readFileSync(FILTER_MAP_PATH, 'utf8'));
  const holdings = JSON.parse(readFileSync(HOLDINGS_PATH, 'utf8'));
  const exploreTagMap = JSON.parse(readFileSync(EXPLORE_TAG_MAP_PATH, 'utf8'));
  if (filterMap.taxonomyVersion !== exploreTagMap.taxonomyVersion) {
    throw new Error(`taxonomy version mismatch: filter-map=${filterMap.taxonomyVersion}, explore-map=${exploreTagMap.taxonomyVersion}`);
  }
  cachedSources = { filterMap, holdings, exploreTagMap };
  return cachedSources;
}

function etfCodesForRealTag(filterMap, tagId) {
  const entries = filterMap.filters[tagId] || [];
  return entries.filter((entry) => entry.confidence >= CONFIDENCE_THRESHOLD).map((entry) => entry.etfCode);
}

// Top constituent stocks across a tag's ETF set, ranked by summed holding
// weight, used as the tag's stock anchors for news matching. Foreign-index
// / bond ETFs are absent from the domestic holdings pipeline, so this
// naturally yields an empty list for those tags (matches spec: stockIds MAY
// be empty for index/asset tags).
function anchorStockIds(holdings, etfCodes, limit) {
  const weightByStock = new Map();
  for (const etfCode of etfCodes) {
    const etfHoldings = holdings.etfs[etfCode];
    if (!etfHoldings) continue;
    for (const holding of etfHoldings.holdings) {
      if (!holding.code) continue;
      weightByStock.set(holding.code, (weightByStock.get(holding.code) || 0) + holding.weight);
    }
  }
  return [...weightByStock.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code]) => code);
}

function filterDefinitionByTag(exploreTagMap) {
  const definitions = new Map();
  for (const facet of exploreTagMap.facets) {
    for (const filter of facet.filters) {
      definitions.set(filter.tagId, { ...filter, facetId: facet.id });
    }
  }
  return definitions;
}

// Build all TagUniverse objects for this session's in-scope tags.
// Returns a Map<tagId, TagUniverse>.
export function buildTagUniverses() {
  const { filterMap, holdings, exploreTagMap } = loadSources();
  const definitions = filterDefinitionByTag(exploreTagMap);
  const universes = new Map();

  for (const channel of exploreTagMap.briefChannels) {
    const def = definitions.get(channel.targetTagId);
    if (!def) throw new Error(`brief channel target is not an Explore filter: ${channel.targetTagId}`);
    const etfCodes = etfCodesForRealTag(filterMap, channel.targetTagId);
    const stockIds = channel.stockAnchorMode === 'top_holdings'
      ? anchorStockIds(holdings, etfCodes, channel.stockAnchorLimit)
      : [];

    universes.set(channel.targetTagId, {
      tagId: channel.targetTagId,
      tagCategory: def.facetId,
      label: def.label,
      stockIds,
      topicIds: channel.newsTopicIds.slice(),
      etfIds: etfCodes,
      provisional: false,
      matchedEtfCount: etfCodes.length,
    });
  }

  return universes;
}

export function getTaxonomyVersion() {
  const { exploreTagMap } = loadSources();
  return exploreTagMap.taxonomyVersion;
}

export function resetCacheForTest() {
  cachedSources = null;
}
