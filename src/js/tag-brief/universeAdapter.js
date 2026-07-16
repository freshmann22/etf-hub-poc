// TagUniverse adapter — THE ONLY file in this session's code that reads
// config/etf-tagging/etf-taxonomy.json, data/tagging/etf-filter-map.json,
// data/tagging/etf-filter-candidates.json, or data/normalized/etf-holdings.json.
// Everything downstream (assign.js, generate.js, policyGate.js, build script,
// rendering) consumes only the TagUniverse objects this module returns and
// must treat tagId as an opaque key — never branch on what a tag "means".
//
// When the taxonomy redesign lands, only TAG_TOPIC_MAP below and the two
// PROVISIONAL_* constants need updating; buildTagUniverses()'s signature and
// return shape stay the same.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const FILTER_MAP_PATH = path.join(REPO_ROOT, 'data', 'tagging', 'etf-filter-map.json');
const FILTER_CANDIDATES_PATH = path.join(REPO_ROOT, 'data', 'tagging', 'etf-filter-candidates.json');
const HOLDINGS_PATH = path.join(REPO_ROOT, 'data', 'normalized', 'etf-holdings.json');

const CONFIDENCE_THRESHOLD = 0.5;
const MAX_ANCHOR_STOCKS = 8;

// This session's in-scope tags. tagCategory/provisional are declared here
// (not derived from taxonomy) so the adapter stays a single, explicit
// touchpoint. Real tagIds must exist in etf-taxonomy v1.0.0's filters;
// provisional ids are candidateIds from etf-filter-candidates.json.
const TAG_DEFINITIONS = [
  { tagId: 'sector.semiconductor', tagCategory: 'sector', label: '반도체', provisional: false },
  { tagId: 'sector.aerospace_defense', tagCategory: 'sector', label: '방산/항공우주', provisional: false },
  { tagId: 'sector.ev_battery', tagCategory: 'sector', label: '2차전지', provisional: false },
  { tagId: 'sector.shipbuilding', tagCategory: 'sector', label: '조선/조선기자재', provisional: true },
  { tagId: 'strategy.sp500', tagCategory: 'strategy', label: 'S&P500', provisional: false },
  { tagId: 'provisional.bond_krw', tagCategory: 'provisional', label: '국내 채권', provisional: true },
];

// tag -> topic anchor mapping (adapter-internal configuration; the only
// place this session encodes what a tag "is about" for news-matching
// purposes). Sector tags matched primarily via stock anchors still get a
// broad topic as a secondary anchor for macro-flavored coverage.
const TAG_TOPIC_MAP = {
  'sector.semiconductor': [],
  'sector.aerospace_defense': [],
  'sector.ev_battery': [],
  'sector.shipbuilding': [],
  'strategy.sp500': ['topic.us_index', 'topic.rates'],
  'provisional.bond_krw': ['topic.rates', 'topic.credit'],
};

// Provisional-tag candidateId -> candidate source file's candidateId key,
// since this session may label a tag differently from the audit report
// (e.g. bond candidate is filed under 'strategy.bond_credit_domestic').
const PROVISIONAL_CANDIDATE_ID = {
  'sector.shipbuilding': 'sector.shipbuilding',
  'provisional.bond_krw': 'strategy.bond_credit_domestic',
};

let cachedSources = null;

function loadSources() {
  if (cachedSources) return cachedSources;
  const filterMap = JSON.parse(readFileSync(FILTER_MAP_PATH, 'utf8'));
  const filterCandidates = JSON.parse(readFileSync(FILTER_CANDIDATES_PATH, 'utf8'));
  const holdings = JSON.parse(readFileSync(HOLDINGS_PATH, 'utf8'));
  cachedSources = { filterMap, filterCandidates, holdings };
  return cachedSources;
}

function etfCodesForRealTag(filterMap, tagId) {
  const entries = filterMap.filters[tagId] || [];
  return entries.filter((entry) => entry.confidence >= CONFIDENCE_THRESHOLD).map((entry) => entry.etfCode);
}

function etfCodesForProvisionalTag(filterCandidates, tagId) {
  const candidateId = PROVISIONAL_CANDIDATE_ID[tagId];
  const candidate = filterCandidates.candidates.find((entry) => entry.candidateId === candidateId);
  return {
    etfCodes: candidate ? candidate.sampleEtfs.slice() : [],
    matchedEtfCount: candidate ? candidate.matchedEtfCount : 0,
  };
}

// Top constituent stocks across a tag's ETF set, ranked by summed holding
// weight, used as the tag's stock anchors for news matching. Foreign-index
// / bond ETFs are absent from the domestic holdings pipeline, so this
// naturally yields an empty list for those tags (matches spec: stockIds MAY
// be empty for index/asset tags).
function anchorStockIds(holdings, etfCodes) {
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
    .slice(0, MAX_ANCHOR_STOCKS)
    .map(([code]) => code);
}

// Build all TagUniverse objects for this session's in-scope tags.
// Returns a Map<tagId, TagUniverse>.
export function buildTagUniverses() {
  const { filterMap, filterCandidates, holdings } = loadSources();
  const universes = new Map();

  for (const def of TAG_DEFINITIONS) {
    let etfCodes;
    let etfCountBasis;
    if (def.provisional) {
      const result = etfCodesForProvisionalTag(filterCandidates, def.tagId);
      etfCodes = result.etfCodes;
      etfCountBasis = result.matchedEtfCount;
    } else {
      etfCodes = etfCodesForRealTag(filterMap, def.tagId);
      etfCountBasis = etfCodes.length;
    }

    universes.set(def.tagId, {
      tagId: def.tagId,
      tagCategory: def.tagCategory,
      label: def.label,
      stockIds: anchorStockIds(holdings, etfCodes),
      topicIds: TAG_TOPIC_MAP[def.tagId] || [],
      etfIds: etfCodes,
      provisional: def.provisional,
      matchedEtfCount: etfCountBasis,
    });
  }

  return universes;
}

export function getTaxonomyVersion() {
  const { filterMap } = loadSources();
  return filterMap.taxonomyVersion;
}

export function resetCacheForTest() {
  cachedSources = null;
}
