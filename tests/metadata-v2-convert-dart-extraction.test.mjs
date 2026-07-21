import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { convertDartExtraction } from '../scripts/metadata-v2/convert-dart-extraction.mjs';
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
