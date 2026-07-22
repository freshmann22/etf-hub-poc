import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  convertDartExtraction,
  runConverter,
  validateConvertedFullBatchOutput,
  validateFullBatchExtraction,
} from '../scripts/metadata-v2/convert-dart-extraction.mjs';
import { mergeSourceResults } from '../scripts/metadata-v2/merge-source-results.mjs';

function store(root, name, content = 'zip-content') {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { path: name.replaceAll('\\', '/'), hash: createHash('sha256').update(content).digest('hex') };
}

function evidence(value, label) {
  return value == null ? null : { value, sectionHeading: 'Cover', snippet: `${label}: ${value}` };
}

function pageEvidence(value, label, page) {
  return { ...evidence(value, label), sourceEntries: [`pdf:p${page}`] };
}

function semanticEvidence(value, label, page, rule) {
  return { ...pageEvidence(value, label, page), rule };
}

function row(raw, overrides = {}) {
  return {
    etfCode: '0000D0',
    receptionNo: '20260721000123',
    receptionDate: '20260721',
    source: {
      sourceId: 'opendart_document_xml',
      viewerUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260721000123',
      rawSha256: raw.hash,
      rawSnapshotPath: raw.path,
    },
    extraction: {
      parserStatus: 'parsed',
      sourceEntries: ['document.xml'],
      diagnostics: { coverOnly: true },
      fields: {
        officialName: evidence('Official legal fund name', 'name'),
        issuer: evidence('Official issuer', 'issuer'),
        productDescription: null,
        investmentObjective: null,
        benchmarkName: null,
        benchmarkDescription: null,
        flags: {
          derivative: evidence(true, 'derivative'),
          leveraged: evidence(true, 'leveraged'),
          inverse: null,
          synthetic: null,
          currencyHedged: null,
        },
        distributionPolicy: null,
      },
    },
    ...overrides,
  };
}

function report(rows) {
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-21T06:15:46.640Z',
    scaleDecision: { reason: 'Cover-only document bodies.' },
    rows,
  };
}

function fullBatchReport(rows) {
  return {
    ...report(rows.map((item) => ({
      ...item,
      universeKey: item.etfCode,
      source: { ...item.source, sourceId: 'opendart_pdf_batch', rawMediaType: 'application/pdf' },
    }))),
    extractionContract: {
      scope: 'dart_pdf_full_batch',
      sourceLedger: 'data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl',
      sourceIndex: 'data/reports/metadata-v2/dart-disclosure-index.json',
      expectedTargetCount: rows.length,
      latestLedgerRowCount: rows.length,
      successfulPdfCount: rows.length,
      inputRowCount: rows.length,
      complete: true,
    },
  };
}

test('converter emits populated identity and only explicit safe structural flags', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-convert-'));
  const raw = store(root, 'raw/document.zip');
  const output = convertDartExtraction(report([row(raw)]), { rootDir: root });
  assert.equal(output.records.length, 1);
  const converted = output.records[0];
  assert.equal(converted.fields['identity.officialName'], 'Official legal fund name');
  assert.equal(converted.fields['identity.issuerName'], 'Official issuer');
  assert.equal(converted.fields['product.derivative.direction'], 'long');
  assert.equal(Object.hasOwn(converted.fields, 'product.replication'), false);
  assert.equal(Object.hasOwn(converted.fields, 'product.currencyHedged'), false);
  assert.equal(output.health.nullOrAbsentValuesEmittedAsFalseCount, 0);
  assert.equal(converted.provenance.rawSnapshotPath, raw.path);
  assert.equal(converted.provenance.contentHash, raw.hash);
  assert.match(converted.provenance.url, /dart\.fss\.or\.kr/);
});

test('inverse wins over leveraged and true synthetic/hedged flags map safely', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-convert-'));
  const raw = store(root, 'raw/document.zip');
  const input = row(raw);
  input.extraction.fields.flags.inverse = evidence(true, 'inverse');
  input.extraction.fields.flags.synthetic = evidence(true, 'synthetic');
  input.extraction.fields.flags.currencyHedged = evidence(true, 'hedged');
  const converted = convertDartExtraction(report([input]), { rootDir: root }).records[0];
  assert.equal(converted.fields['product.derivative.direction'], 'inverse');
  assert.equal(converted.fields['product.replication'], 'synthetic');
  assert.equal(converted.fields['product.currencyHedged'], true);
  assert.equal(converted.evidence['product.derivative.direction'].extractionRule, 'explicit_inverse_true');
});

test('section heading, snippet, source entry and reception number survive generic merge', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-convert-'));
  const raw = store(root, 'raw/document.zip');
  const sourceResult = convertDartExtraction(report([row(raw)]), { rootDir: root });
  const canonicalRecord = {
    universeKey: '0000D0',
    identity: { shortCode: '0000D0', isin: 'KR70000D0009', officialName: 'Market short name', aliases: [], issuerId: null, issuerName: null, listingDate: null, listingStatus: 'listed' },
    product: { description: null, investmentObjective: null, benchmark: { name: null, provider: null, indexCode: null, description: null }, assetClasses: [], targetRegions: [], active: null, replication: null, derivative: { direction: null, multiple: null }, currencyHedged: null, fundOfFunds: null },
    portfolio: { asOfDate: null, holdings: [], sectorWeights: [], countryWeights: [] },
    distribution: { applicability: 'unknown', schedule: null, frequency: null, history: [] },
    fieldCandidates: {}, conflicts: [], status: 'partial',
  };
  const merged = mergeSourceResults({
    identityMap: { universeCount: 1, records: [{ universeKey: '0000D0', identity: canonicalRecord.identity }] },
    canonical: { schemaVersion: '2.0.0', universeCount: 1, records: [canonicalRecord] },
    sourceDocuments: [sourceResult],
    resolutionConfig: { default: { strategy: 'authority_then_confidence' }, fields: {} },
    now: new Date('2026-07-21T07:00:00.000Z'),
  });
  const candidate = merged.output.records[0].fieldCandidates['identity.officialName'][0];
  assert.equal(candidate.evidence.sectionHeading, 'Cover');
  assert.match(candidate.evidence.snippet, /Official legal fund name/);
  assert.deepEqual(candidate.evidence.sourceEntries, ['document.xml']);
  assert.equal(candidate.evidence.receptionNo, '20260721000123');
});

test('unparsed extraction and bad raw hash are quarantined', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-convert-'));
  const raw = store(root, 'raw/document.zip');
  const unparsed = row(raw);
  unparsed.extraction.parserStatus = 'no_xml_entry';
  const badHash = row({ ...raw, hash: '0'.repeat(64) }, { etfCode: '0000H0' });
  const output = convertDartExtraction(report([unparsed, badHash]), { rootDir: root });
  assert.equal(output.records.length, 0);
  assert.deepEqual(output.quarantine.items.map((item) => item.reason), ['dart_extraction_not_parsed', 'dart_raw_hash_mismatch']);
});

test('explicit derivative without direction is reported but not coerced', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-convert-'));
  const raw = store(root, 'raw/document.zip');
  const input = row(raw);
  input.extraction.fields.flags.leveraged = null;
  const output = convertDartExtraction(report([input]), { rootDir: root });
  assert.equal(Object.hasOwn(output.records[0].fields, 'product.derivative.direction'), false);
  assert.equal(output.health.skippedExplicitFlags[0].reason, 'canonical_derivative_requires_direction_or_multiple');
});

test('full-batch validation rejects canary, incomplete, and duplicate-code envelopes', () => {
  assert.throws(
    () => validateFullBatchExtraction(report([]), { expectedTargetCount: 0 }),
    /full-batch extraction scope is required/,
  );

  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const complete = fullBatchReport([row(raw)]);
  complete.extractionContract.complete = false;
  assert.throws(
    () => validateFullBatchExtraction(complete, { expectedTargetCount: 1 }),
    /complete=true/,
  );

  const duplicate = fullBatchReport([row(raw), row(raw)]);
  assert.throws(
    () => validateFullBatchExtraction(duplicate, { expectedTargetCount: 2 }),
    /duplicate ETF code/,
  );
});

test('full-batch validation rejects a lexically prefixed path that resolves outside the batch', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-path-'));
  const escaped = store(root, 'outside.pdf', '%PDF-1.4 outside');
  const input = fullBatchReport([row({
    ...escaped,
    path: 'data/raw/metadata-v2/dart-pdf-batch/../../../../outside.pdf',
  })]);
  assert.throws(
    () => validateFullBatchExtraction(input, { expectedTargetCount: 1, rootDir: root }),
    /outside the batch root/,
  );
});

test('full-batch validation rejects noncanonical lineage and name-derived PDF flags are omitted', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-lineage-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const wrongIndex = fullBatchReport([row(raw)]);
  wrongIndex.extractionContract.sourceIndex = 'tmp/alternate-index.json';
  assert.throws(
    () => validateFullBatchExtraction(wrongIndex, { expectedTargetCount: 1, rootDir: root }),
    /unexpected DART full-batch source index/,
  );

  const input = fullBatchReport([row(raw)]);
  const output = convertDartExtraction(input, { rootDir: root });
  assert.equal(Object.hasOwn(output.records[0].fields, 'product.derivative.direction'), false);
});

test('full-batch converter emits dedicated source identity and PDF provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-'));
  const firstRaw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/first.pdf', '%PDF-1.4 first');
  const secondRaw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000H0/second.pdf', '%PDF-1.4 second');
  const input = fullBatchReport([
    row(firstRaw),
    row(secondRaw, { etfCode: '0000H0', receptionNo: '20260721000456' }),
  ]);

  validateFullBatchExtraction(input, { expectedTargetCount: 2 });
  const output = convertDartExtraction(input, { rootDir: root });
  validateConvertedFullBatchOutput(output, 2);

  assert.equal(output.source.sourceId, 'opendart_pdf_batch');
  assert.equal(output.health.fullBatchValidation.complete, true);
  assert.equal(output.records.length, 2);
  assert.ok(output.records.every((record) => record.provenance.documentType === 'investment_prospectus_pdf'));
  assert.deepEqual(
    output.records.map((record) => record.provenance.rawSnapshotPath),
    [firstRaw.path, secondRaw.path],
  );
  assert.equal(output.quarantine.count, 0);
});

test('full-batch converter keeps semantic windows evidence-only and preserves official-name PDF evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-fields-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const inputRow = row(raw);
  inputRow.extraction.fields.officialName = pageEvidence('Official legal fund name', 'name', 1);
  inputRow.extraction.fields.investmentObjective = pageEvidence('Track the target index', 'objective', 7);
  inputRow.extraction.fields.benchmarkDescription = pageEvidence('Performance-table benchmark window', 'benchmark', 2);
  inputRow.extraction.fields.distributionPolicy = pageEvidence('Quarterly distribution', 'distribution', 12);
  const output = convertDartExtraction(fullBatchReport([inputRow]), { rootDir: root });

  assert.equal(Object.hasOwn(output.records[0].fields, 'product.investmentObjective'), false);
  assert.equal(Object.hasOwn(output.records[0].fields, 'product.benchmark.description'), false);
  assert.equal(Object.hasOwn(output.records[0].fields, 'distribution.schedule'), false);
  assert.equal(output.health.fieldCounts['product.investmentObjective'], undefined);
  assert.equal(output.health.fieldCounts['product.benchmark.description'], undefined);
  assert.equal(output.health.fieldCounts['distribution.schedule'], undefined);
  assert.deepEqual(output.health.skippedEvidenceOnlyFields, [
    {
      shortCode: '0000D0',
      inputField: 'issuer',
      reason: 'full_batch_field_lacks_safe_pdf_extraction_contract',
    },
    {
      shortCode: '0000D0',
      inputField: 'investmentObjective',
      reason: 'full_batch_objective_window_requires_clause_level_semantic_review',
    },
    {
      shortCode: '0000D0',
      inputField: 'benchmarkDescription',
      reason: 'full_batch_benchmark_window_is_evidence_only_until_semantic_extractor_review',
    },
    {
      shortCode: '0000D0',
      inputField: 'distributionPolicy',
      reason: 'full_batch_distribution_window_is_not_a_canonical_schedule',
    },
  ]);
  assert.deepEqual(output.records[0].evidence['identity.officialName'].sourceEntries, ['pdf:p1']);
  assert.deepEqual(Object.keys(output.records[0].evidence), ['identity.officialName']);
});

test('full-batch converter emits only allowlisted semantic fields and preserves their extraction rules', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-semantic-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const inputRow = row(raw);
  inputRow.extraction.fields.investmentObjective = pageEvidence('Unsafe objective window', 'objective-window', 7);
  inputRow.extraction.fields.benchmarkDescription = pageEvidence('Unsafe benchmark window', 'benchmark-window', 2);
  inputRow.extraction.fields.distributionPolicy = pageEvidence('Unsafe distribution window', 'distribution-window', 12);
  inputRow.extraction.semanticFields = {
    investmentObjective: semanticEvidence('Track the target index before fees.', 'objective-clause', 7, 'explicit_objective_clause'),
    benchmarkName: semanticEvidence('KOSPI 200', 'benchmark-name', 2, 'explicit_benchmark_name_clause'),
    benchmarkDescription: semanticEvidence('The index represents 200 leading Korean equities.', 'benchmark-description', 2, 'dedicated_benchmark_methodology_clause'),
    distributionSchedule: semanticEvidence('매월 마지막 영업일', 'distribution-schedule', 12, 'structured_distribution_schedule'),
    distributionFrequency: semanticEvidence('monthly', 'distribution-frequency', 12, 'explicit_monthly_frequency'),
  };

  const output = convertDartExtraction(fullBatchReport([inputRow]), { rootDir: root });
  validateConvertedFullBatchOutput(output, 1);

  assert.deepEqual(output.records[0].fields, {
    'identity.officialName': 'Official legal fund name',
    'product.investmentObjective': 'Track the target index before fees.',
    'product.benchmark.name': 'KOSPI 200',
    'product.benchmark.description': 'The index represents 200 leading Korean equities.',
    'distribution.schedule': '매월 마지막 영업일',
    'distribution.frequency': 'monthly',
  });
  assert.equal(output.records[0].evidence['product.investmentObjective'].extractionRule, 'explicit_objective_clause');
  assert.equal(output.records[0].evidence['product.benchmark.name'].extractionRule, 'explicit_benchmark_name_clause');
  assert.equal(output.records[0].evidence['product.benchmark.description'].extractionRule, 'dedicated_benchmark_methodology_clause');
  assert.equal(output.records[0].evidence['distribution.schedule'].extractionRule, 'structured_distribution_schedule');
  assert.equal(output.records[0].evidence['distribution.frequency'].extractionRule, 'explicit_monthly_frequency');
  assert.deepEqual(output.records[0].evidence['distribution.frequency'].sourceEntries, ['pdf:p12']);
  assert.notEqual(output.records[0].fields['product.investmentObjective'], 'Unsafe objective window');
  assert.notEqual(output.records[0].fields['product.benchmark.description'], 'Unsafe benchmark window');
  assert.notEqual(output.records[0].fields['distribution.schedule'], 'Unsafe distribution window');
});

test('full-batch validation rejects unsupported or rule-less semantic fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-semantic-invalid-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const unsupported = fullBatchReport([row(raw)]);
  unsupported.rows[0].extraction.semanticFields = {
    productDescription: semanticEvidence('Not allowlisted', 'description', 3, 'semantic_description'),
  };
  assert.throws(
    () => validateFullBatchExtraction(unsupported, { expectedTargetCount: 1, rootDir: root }),
    /unsupported semantic field: productDescription/,
  );

  const missingRule = fullBatchReport([row(raw)]);
  missingRule.rows[0].extraction.semanticFields = {
    distributionFrequency: pageEvidence('monthly', 'distribution-frequency', 12),
  };
  assert.throws(
    () => validateFullBatchExtraction(missingRule, { expectedTargetCount: 1, rootDir: root }),
    /invalid semantic field evidence: distributionFrequency/,
  );
});

test('full-batch converter accounts for a parsed evidence-only row as unavailable without blocking the batch', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-evidence-only-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const inputRow = row(raw);
  inputRow.extraction.fields.officialName = null;
  const output = convertDartExtraction(fullBatchReport([inputRow]), { rootDir: root });

  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].status, 'unavailable');
  assert.deepEqual(output.records[0].fields, {});
  assert.equal(output.health.evidenceOnlyRecordCount, 1);
  assert.equal(output.health.warnings.length, 0);
  assert.equal(output.health.readyForMerge, true);
});

test('runConverter writes only a validated full-batch source result to the requested output', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-run-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const inputPath = join(root, 'reports', 'full-batch-extraction.json');
  const outputPath = join(root, 'data', 'reports', 'metadata-v2', 'full-batch-source-result.json');
  mkdirSync(dirname(inputPath), { recursive: true });
  writeFileSync(inputPath, `${JSON.stringify(fullBatchReport([row(raw)]), null, 2)}\n`);

  const output = runConverter(
    { input: inputPath, output: outputPath },
    { rootDir: root, expectedTargetCount: 1 },
  );

  assert.equal(output.source.sourceId, 'opendart_pdf_batch');
  assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).records.length, 1);
  assert.equal(existsSync(`${outputPath}.${process.pid}.tmp`), false);
});

test('runConverter fails without writing when any full-batch row remains blocked', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-blocked-'));
  const raw = store(root, 'data/raw/metadata-v2/dart-pdf-batch/0000D0/document.pdf', '%PDF-1.4 fixture');
  const blocked = row(raw);
  blocked.extraction.parserStatus = 'pending_ocr';
  const inputPath = join(root, 'reports', 'full-batch-extraction.json');
  const outputPath = join(root, 'data', 'reports', 'metadata-v2', 'full-batch-source-result.json');
  mkdirSync(dirname(inputPath), { recursive: true });
  writeFileSync(inputPath, `${JSON.stringify(fullBatchReport([blocked]), null, 2)}\n`);

  assert.throws(
    () => runConverter(
      { input: inputPath, output: outputPath },
      { rootDir: root, expectedTargetCount: 1 },
    ),
    /not merge-ready/,
  );
  assert.equal(existsSync(outputPath), false);
});

test('runConverter rejects outputs outside the metadata-v2 report directory before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-dart-full-batch-output-'));
  const unsafeOutputs = [
    join(root, 'data', 'raw', 'metadata-v2', 'dart-pdf-batch', 'ledger.jsonl'),
    join(root, 'reports', 'arbitrary.json'),
  ];
  for (const outside of unsafeOutputs) {
    assert.throws(
      () => runConverter({ input: join(root, 'missing.json'), output: outside }, { rootDir: root, expectedTargetCount: 1 }),
      /output must be a JSON file inside data\/reports\/metadata-v2/,
    );
    assert.equal(existsSync(outside), false);
  }
});
