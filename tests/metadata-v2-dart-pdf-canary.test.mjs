import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const report = JSON.parse(readFileSync(new URL('../data/reports/metadata-v2/dart-pdf-canary.json', import.meta.url), 'utf8'));

test('DART PDF canary remains limited to four existing official documents', () => {
  assert.equal(report.scope, 'four existing official DART PDFs only; no network and no universe collection');
  assert.equal(report.rows.length, 4);
  assert.equal(new Set(report.rows.map((row) => row.etfCode)).size, 4);
  assert.ok(report.rows.every((row) => row.raw.path.startsWith('data/raw/metadata-v2/dart-viewer-canary/')));
});

test('DART PDF canary passes extraction and evidence automation gates', () => {
  assert.equal(report.metrics.validPdfRate, 1);
  assert.equal(report.metrics.pdfplumberExtractionRate, 1);
  assert.equal(report.metrics.pypdfExtractionRate, 1);
  assert.ok(report.metrics.minimumExtractorAgreement >= report.passCriteria.minimumExtractorAgreement);
  assert.equal(report.metrics.objectiveEvidenceRate, 1);
  assert.equal(report.metrics.strategyEvidenceRate, 1);
  assert.equal(report.metrics.ocrRequiredCount, 0);
});

test('DART PDF evidence never coerces absent benchmark or distribution text to false', () => {
  for (const row of report.rows) {
    for (const field of ['benchmark', 'distribution']) {
      const evidence = row.evidence[field];
      assert.equal(evidence.found, evidence.selectedPage !== null);
      if (!evidence.found) assert.equal(evidence.snippet, null);
    }
  }
});
