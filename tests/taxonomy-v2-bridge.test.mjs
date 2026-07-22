import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { adaptCanonicalV2ForTaxonomy, applyCoverageV2ToReadinessRows, selectReadyCoreRows } from '../scripts/tagging/lib/taxonomy-v2-bridge.mjs';
import { buildReport, renderHtml as renderReadinessHtml } from '../scripts/tagging/build-data-readiness-report.mjs';
import { buildSample, renderHtml as renderSampleHtml } from '../scripts/tagging/build-taxonomy-review-sample.mjs';

function canonicalRecord(code, overrides = {}) {
  return {
    universeKey: code,
    identity: { shortCode: code, officialName: `ETF ${code}`, issuerName: '운용사', listingDate: '2026-01-01' },
    product: { description: '설명', investmentObjective: '목적', benchmark: { name: '지수', provider: null, description: '지수 설명' }, assetClasses: ['equity'], targetRegions: ['KR'], active: false, currencyHedged: null },
    portfolio: { asOfDate: '2026-07-21', holdings: [{ shortCode: '005930', name: '삼성전자', weight: 50 }], sectorWeights: [], countryWeights: [] },
    distribution: {
      applicability: 'applicable', schedule: '분기', frequency: 'quarterly',
      history: [
        { payDate: '2026-06-01', recordDate: null, exDate: null, amount: 30 },
        { payDate: '2025-08-01', recordDate: null, exDate: null, amount: 20 },
        { payDate: '2025-06-01', recordDate: null, exDate: null, amount: 99 },
      ],
    },
    fieldCandidates: { 'product.description': [{ provenance: { sourceId: 'official', sourceType: 'primary', retrievedAt: '2026-07-21T00:00:00Z' } }] },
    conflicts: [],
    ...overrides,
  };
}

test('v2 bridge maps canonical evidence without inventing legacy classification hints', () => {
  const canonical = { schemaVersion: '2.0.0', generatedAt: '2026-07-21T00:00:00Z', universeCount: 1, records: [canonicalRecord('0000D0')] };
  const bridge = adaptCanonicalV2ForTaxonomy(canonical);
  const row = bridge.metadata.records[0];
  assert.equal(row.etfCode, '0000D0');
  assert.equal(row.benchmark.name, '지수');
  assert.equal(row.holdings[0].code, '005930');
  assert.equal(row.distribution.trailing12MonthAmount, 50);
  assert.equal(row.classificationFacts.rawTypeText, null);
  assert.deepEqual(row.classificationFacts.nameHints, []);
  assert.equal(row.sources[0].field, 'product.description');
});

test('v2 bridge computes trailing distribution amount from dated events in the preceding 12 months only', () => {
  const record = canonicalRecord('0000D0');
  record.distribution.history.push({ payDate: null, recordDate: null, exDate: null, amount: 500 });
  const canonical = { schemaVersion: '2.0.0', generatedAt: '2026-07-21T00:00:00Z', universeCount: 1, records: [record] };
  const [row] = adaptCanonicalV2ForTaxonomy(canonical).metadata.records;
  assert.equal(row.distribution.trailing12MonthAmount, 50);
});

test('v2 readiness scores and grades replace bridge compatibility scores only after shape validation', () => {
  const rows = [{ etfCode: '0000D0', score: 10, grade: 'D' }];
  const coverage = { shapePreserved: true, universeCount: 1, rows: [{ shortCode: '0000D0', score: 80, grade: 'A', provenanceSelected: 3, provenanceBacked: 3 }] };
  const [result] = applyCoverageV2ToReadinessRows(rows, coverage);
  assert.equal(result.score, 80);
  assert.equal(result.grade, 'A');
  assert.equal(result.v2Readiness.provenanceBacked, 3);
  assert.throws(() => applyCoverageV2ToReadinessRows(rows, { ...coverage, universeCount: 2 }), /shape-preserved coverage/);
});

test('ready-core selection caps more than 200 A/B rows deterministically and favors uncovered tags', () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ etfCode: String(index).padStart(6, '0'), score: 60 + index % 20, grade: 'B' }));
  const special = rows.at(-1).etfCode;
  const tagsFor = (code) => code === special ? ['common', 'rare'] : ['common'];
  const selected = selectReadyCoreRows(rows, { target: 200, tagsFor, tagPopulation: new Map([['common', 205], ['rare', 1]]), lowByCode: new Map() });
  assert.equal(selected.length, 200);
  assert.equal(new Set(selected.map((row) => row.etfCode)).size, 200);
  assert.ok(selected.some((row) => row.etfCode === special));
  assert.deepEqual(selected, selectReadyCoreRows(rows, { target: 200, tagsFor, tagPopulation: new Map([['common', 205], ['rare', 1]]), lowByCode: new Map() }));
});

test('v2 HTML uses isolated links, authoritative scoring copy, and a distinct browser-storage key', () => {
  const legacyReadiness = buildReport();
  const v2ReadinessHtml = renderReadinessHtml({ ...legacyReadiness, dataMode: 'metadata-v2', scoringVersion: 'metadata-v2-bridge-1.0.0' });
  assert.match(v2ReadinessHtml, /ETF_TAXONOMY_REVIEW_SAMPLE_V2\.html/);
  assert.match(v2ReadinessHtml, /etf-taxonomy-data-readiness-v2\.json/);
  assert.match(v2ReadinessHtml, /etf-taxonomy-data-readiness-v2\.csv/);
  assert.match(v2ReadinessHtml, /etf-metadata-v2\.json/);
  assert.match(v2ReadinessHtml, /식별 정보 20 · 상품 설명·목적 20/);
  assert.doesNotMatch(v2ReadinessHtml, /식별 정보 15 · 상품·지수 정보 30/);

  const legacySample = buildSample();
  const legacyHtml = renderSampleHtml(legacySample);
  const v2Html = renderSampleHtml({ ...legacySample, dataMode: 'metadata-v2' });
  assert.match(legacyHtml, /const key="etf-taxonomy-review-sample-v1"/);
  assert.match(v2Html, /const key="etf-taxonomy-review-sample-v2"/);
});

test('review sample records a content-addressed provenance manifest for every selection input', () => {
  const sample = buildSample();
  assert.deepEqual(Object.keys(sample.sourceSnapshots), ['readiness', 'taxonomy', 'scores', 'lowConfidence', 'metadata', 'holdings']);
  for (const snapshot of Object.values(sample.sourceSnapshots)) {
    assert.ok(snapshot.path);
    assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);
  }
});

test('v2 review command refreshes canonical readiness before selecting a sample', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['review:taxonomy-sample:v2'], /^npm run metadata:v2:readiness && /);
});
