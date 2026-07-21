import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  input: resolve(ROOT, 'data/normalized/etf-metadata-v2.json'),
  json: resolve(ROOT, 'data/reports/metadata-v2/coverage.json'),
  csv: resolve(ROOT, 'data/reports/metadata-v2/coverage.csv'),
});

function present(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function pctPrecise(count, total) {
  return total ? Math.round((count / total) * 10000) / 100 : 0;
}

function assetText(record) {
  return (record.product.assetClasses || []).join('|').normalize('NFKC').toLowerCase();
}

function hasAny(text, tokens) {
  return tokens.some((token) => text.includes(token));
}

export function facetEligibility(record, facet) {
  const assets = assetText(record);
  const isEquity = hasAny(assets, ['equity', 'stock', '주식']);
  const isNonSector = hasAny(assets, ['bond', 'fixed income', '채권', 'commodity', '원자재', 'currency', '통화']);
  const isMixed = hasAny(assets, ['mixed', 'multi asset', '혼합']);

  if (facet === 'region') {
    if (hasAny(assets, ['commodity', '원자재', 'currency', '통화']) && !isMixed) return 'not_applicable';
    if (isEquity || hasAny(assets, ['bond', 'fixed income', '채권', 'real estate', 'reit', '부동산']) || present(record.product.targetRegions)) return 'eligible';
    return 'unknown';
  }
  if (facet === 'sector') {
    if (isNonSector && !isEquity && !isMixed) return 'not_applicable';
    if (isEquity) return 'eligible';
    return 'unknown';
  }
  if (facet === 'dividend') {
    return record.distribution.applicability === 'applicable' ? 'eligible' : record.distribution.applicability;
  }
  throw new Error(`unknown facet: ${facet}`);
}

export function facetEvidenceReady(record, facet) {
  if (facet === 'region') return present(record.product.targetRegions) || present(record.portfolio.countryWeights);
  if (facet === 'sector') return present(record.portfolio.sectorWeights);
  if (facet === 'dividend') {
    return record.distribution.applicability === 'not_applicable'
      || (present(record.distribution.schedule) && present(record.distribution.history));
  }
  return false;
}

function recordScore(record) {
  let score = 0;
  score += present(record.identity.shortCode) ? 5 : 0;
  score += present(record.identity.isin) ? 5 : 0;
  score += present(record.identity.officialName) ? 5 : 0;
  score += present(record.identity.issuerName) ? 5 : 0;
  score += present(record.product.description) ? 10 : 0;
  score += present(record.product.investmentObjective) ? 10 : 0;
  score += present(record.product.benchmark.name) ? 5 : 0;
  score += present(record.product.assetClasses) ? 5 : 0;
  score += present(record.portfolio.holdings) ? 15 : 0;
  score += present(record.portfolio.sectorWeights) ? 7.5 : 0;
  score += present(record.portfolio.countryWeights) ? 7.5 : 0;
  score += present(record.distribution.schedule) ? 8 : 0;
  score += present(record.distribution.frequency) ? 4 : 0;
  score += present(record.distribution.history) ? 8 : 0;
  return score;
}

function grade(score) {
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  if (score >= 30) return 'C';
  return 'D';
}

const FIELD_CHECKS = Object.freeze({
  shortCode: (r) => r.identity.shortCode,
  isin: (r) => r.identity.isin,
  officialName: (r) => r.identity.officialName,
  issuer: (r) => r.identity.issuerName,
  description: (r) => r.product.description,
  investmentObjective: (r) => r.product.investmentObjective,
  benchmark: (r) => r.product.benchmark.name,
  assetClass: (r) => r.product.assetClasses,
  targetRegions: (r) => r.product.targetRegions,
  holdings: (r) => r.portfolio.holdings,
  sectorWeights: (r) => r.portfolio.sectorWeights,
  countryWeights: (r) => r.portfolio.countryWeights,
  distributionSchedule: (r) => r.distribution.schedule,
  distributionHistory: (r) => r.distribution.history,
});

const PROVENANCE_PATHS = Object.freeze({
  'identity.shortCode': (r) => r.identity.shortCode,
  'identity.isin': (r) => r.identity.isin,
  'identity.officialName': (r) => r.identity.officialName,
  'identity.issuerName': (r) => r.identity.issuerName,
  'identity.listingDate': (r) => r.identity.listingDate,
  'identity.listingStatus': (r) => r.identity.listingStatus === 'unknown' ? null : r.identity.listingStatus,
  'product.description': (r) => r.product.description,
  'product.investmentObjective': (r) => r.product.investmentObjective,
  'product.benchmark.name': (r) => r.product.benchmark.name,
  'product.benchmark.provider': (r) => r.product.benchmark.provider,
  'product.benchmark.description': (r) => r.product.benchmark.description,
  'product.assetClasses': (r) => r.product.assetClasses,
  'product.targetRegions': (r) => r.product.targetRegions,
  'product.active': (r) => r.product.active,
  'product.currencyHedged': (r) => r.product.currencyHedged,
  'portfolio.holdings': (r) => r.portfolio.holdings,
  'portfolio.sectorWeights': (r) => r.portfolio.sectorWeights,
  'portfolio.countryWeights': (r) => r.portfolio.countryWeights,
  'distribution.schedule': (r) => r.distribution.schedule,
  'distribution.frequency': (r) => r.distribution.frequency,
});

function provenanceCounts(record) {
  let selected = 0;
  let backed = 0;
  for (const [path, getValue] of Object.entries(PROVENANCE_PATHS)) {
    if (!present(getValue(record))) continue;
    selected += 1;
    if (present(record.fieldCandidates[path])) backed += 1;
  }
  return { selected, backed };
}

export function buildReadiness(metadata, { now = new Date().toISOString() } = {}) {
  const records = metadata?.records || [];
  if (records.length !== metadata?.universeCount) throw new Error('metadata universe shape mismatch');
  const coverage = Object.fromEntries(Object.keys(FIELD_CHECKS).map((field) => [field, { count: 0, pct: 0 }]));
  const grades = { A: 0, B: 0, C: 0, D: 0 };
  const facets = Object.fromEntries(['region', 'sector', 'dividend'].map((facet) => [facet, {
    eligibility: { eligible: 0, not_applicable: 0, unknown: 0 },
    eligibleEvidence: { ready: 0, insufficient: 0, readyPct: 0 },
  }]));
  let provenanceSelected = 0;
  let provenanceBacked = 0;

  const rows = records.map((record) => {
    for (const [field, getValue] of Object.entries(FIELD_CHECKS)) if (present(getValue(record))) coverage[field].count += 1;
    const score = recordScore(record);
    const readinessGrade = grade(score);
    grades[readinessGrade] += 1;
    const facetStates = {};
    for (const facet of Object.keys(facets)) {
      const eligibility = facetEligibility(record, facet);
      const ready = facetEvidenceReady(record, facet);
      facets[facet].eligibility[eligibility] += 1;
      if (eligibility === 'eligible') facets[facet].eligibleEvidence[ready ? 'ready' : 'insufficient'] += 1;
      facetStates[facet] = { eligibility, evidence: eligibility === 'eligible' ? (ready ? 'ready' : 'insufficient') : 'n/a' };
    }
    const provenance = provenanceCounts(record);
    provenanceSelected += provenance.selected;
    provenanceBacked += provenance.backed;
    return {
      universeKey: record.universeKey,
      shortCode: record.identity.shortCode,
      name: record.identity.officialName,
      status: record.status,
      score,
      grade: readinessGrade,
      provenanceSelected: provenance.selected,
      provenanceBacked: provenance.backed,
      regionEligibility: facetStates.region.eligibility,
      regionEvidence: facetStates.region.evidence,
      sectorEligibility: facetStates.sector.eligibility,
      sectorEvidence: facetStates.sector.evidence,
      dividendEligibility: facetStates.dividend.eligibility,
      dividendEvidence: facetStates.dividend.evidence,
    };
  });

  for (const item of Object.values(coverage)) item.pct = pct(item.count, records.length);
  for (const facet of Object.values(facets)) {
    facet.eligibleEvidence.readyPct = pct(facet.eligibleEvidence.ready, facet.eligibility.eligible);
  }
  return {
    generatedAt: now,
    schemaVersion: metadata.schemaVersion,
    universeCount: records.length,
    shapePreserved: records.length === metadata.universeCount && new Set(records.map((r) => r.universeKey)).size === records.length,
    status: records.reduce((acc, record) => ({ ...acc, [record.status]: (acc[record.status] || 0) + 1 }), {}),
    grades,
    fieldCoverage: coverage,
    provenance: {
      selectedValueCount: provenanceSelected,
      backedSelectedValueCount: provenanceBacked,
      unbackedSelectedValueCount: provenanceSelected - provenanceBacked,
      backedPct: pctPrecise(provenanceBacked, provenanceSelected),
      note: 'Legacy v1 values count as backed only when represented by an explicit legacy_v1 secondary candidate.',
    },
    facets,
    rows,
  };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function readinessCsv(rows) {
  const headers = Object.keys(rows[0] || { universeKey: '' });
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n') + '\n';
}

export function runReadiness(paths = DEFAULT_PATHS) {
  const metadata = JSON.parse(readFileSync(paths.input, 'utf8'));
  const report = buildReadiness(metadata);
  mkdirSync(dirname(paths.json), { recursive: true });
  writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(paths.csv, readinessCsv(report.rows), 'utf8');
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = runReadiness();
  console.log(`[metadata-v2:readiness] ${report.universeCount} records -> ${DEFAULT_PATHS.json}`);
}
