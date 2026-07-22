import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { convertHoldingsLedger, latestSuccessPerShortCode, readHoldingsLedgerText } from '../scripts/metadata-v2/convert-holdings-results.mjs';
import { mergeSourceResults } from '../scripts/metadata-v2/merge-source-results.mjs';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function store(root, relativePath, body) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return { path: relativePath.replaceAll('\\', '/'), contentHash: hash(body), role: 'holdings', url: 'https://issuer.example/holdings' };
}

function ledgerLine(overrides) {
  return {
    retrievedAt: '2026-07-21T01:00:00.000Z',
    sourceId: 'issuer_kodex',
    issuerId: 'samsung-asset-management',
    shortCode: '069500',
    isin: 'KR7069500007',
    name: 'KODEX 200',
    status: 'ok',
    rowCount: 2,
    declaredCount: 2,
    asOfDate: '20260720',
    rawArtifacts: [],
    error: null,
    ...overrides,
  };
}

function kodexBody() {
  return JSON.stringify({
    data: { pdf: { gijunYMD: '20260720', totalCnt: 2, list: [
      { itmNo: '005930', secNm: 'Samsung Electronics', ratio: 60, applyQ: 1, evalA: 60 },
      { itmNo: '000660', secNm: 'SK hynix', ratio: 40, applyQ: 1, evalA: 40 },
    ] } },
  });
}

test('ledger parser reports malformed lines and latest selector ignores later failures', () => {
  const older = ledgerLine({ retrievedAt: '2026-07-20T00:00:00.000Z' });
  const newerSuccess = ledgerLine({ retrievedAt: '2026-07-21T00:00:00.000Z' });
  const laterFailure = ledgerLine({ retrievedAt: '2026-07-21T02:00:00.000Z', status: 'failed', rowCount: 0 });
  const parsed = readHoldingsLedgerText(`${JSON.stringify(older)}\nnot-json\n${JSON.stringify(newerSuccess)}\n${JSON.stringify(laterFailure)}\n`);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.malformed[0].lineNumber, 2);
  assert.equal(latestSuccessPerShortCode(parsed.entries)[0].retrievedAt, newerSuccess.retrievedAt);
});

test('converter emits latest successful raw result with hash, path, as-of and provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-holdings-convert-'));
  const body = kodexBody();
  const oldArtifact = store(root, 'raw/old.raw', body);
  const latestArtifact = store(root, 'raw/latest.raw', body);
  const entries = [
    ledgerLine({ retrievedAt: '2026-07-20T01:00:00.000Z', rawArtifacts: [oldArtifact] }),
    ledgerLine({ retrievedAt: '2026-07-21T01:00:00.000Z', rawArtifacts: [latestArtifact] }),
    ledgerLine({ retrievedAt: '2026-07-21T02:00:00.000Z', status: 'rate_limited_stopped', rowCount: 0, rawArtifacts: [], error: 'persistent 429' }),
  ];
  const output = convertHoldingsLedger({ ledgerText: entries.map(JSON.stringify).join('\n'), rootDir: root });
  assert.equal(output.records.length, 1);
  const record = output.records[0];
  assert.equal(record.shortCode, '069500');
  assert.equal(record.asOfDate, '2026-07-20');
  assert.equal(record.declaredRowCount, 2);
  assert.equal(record.fields['portfolio.holdings'].length, 2);
  assert.equal(record.provenance.rawSnapshotPath, latestArtifact.path);
  assert.equal(record.provenance.contentHash, latestArtifact.contentHash);
  assert.equal(record.provenance.sourceId, 'issuer_kodex');
  assert.equal(output.health.failureEvents[0].status, 'rate_limited_stopped');
  assert.equal(output.quarantine.count, 0);
});

test('missing source as-of uses an explicit retrieval-date proxy and partial provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-holdings-convert-'));
  const html = '<tr data-tot-cnt="1"><td>1</td><td>005930</td><td>Samsung Electronics</td><td>1</td><td>100</td><td>100</td></tr>';
  const artifact = store(root, 'raw/tiger.raw', html);
  const entry = ledgerLine({
    sourceId: 'issuer_tiger', shortCode: '102110', isin: 'KR7102110004', rowCount: 1, declaredCount: 1,
    asOfDate: null, rawArtifacts: [artifact], retrievedAt: '2026-07-21T03:04:05.000Z',
  });
  const output = convertHoldingsLedger({ ledgerText: JSON.stringify(entry), rootDir: root });
  assert.equal(output.records[0].asOfDate, '2026-07-21');
  assert.equal(output.records[0].status, 'partial');
  assert.equal(output.records[0].provenance.confidence, 0.85);
  assert.equal(output.health.warnings[0].reason, 'as_of_date_uses_retrieval_date_proxy');
});

test('hash mismatch and parse mismatch are quarantined rather than emitted', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-holdings-convert-'));
  const artifact = store(root, 'raw/bad.raw', kodexBody());
  const badHash = ledgerLine({ rawArtifacts: [{ ...artifact, contentHash: '0'.repeat(64) }] });
  const output = convertHoldingsLedger({ ledgerText: JSON.stringify(badHash), rootDir: root });
  assert.equal(output.records.length, 0);
  assert.equal(output.quarantine.items[0].reason, 'holdings_raw_hash_mismatch');
});

test('conversion is deterministic and its output can be consumed by generic merge', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-holdings-convert-'));
  const artifact = store(root, 'raw/kodex.raw', kodexBody());
  const text = JSON.stringify(ledgerLine({ rawArtifacts: [artifact] }));
  const first = convertHoldingsLedger({ ledgerText: text, rootDir: root });
  const second = convertHoldingsLedger({ ledgerText: text, rootDir: root });
  assert.deepEqual(first, second);

  const canonicalRecord = {
    universeKey: '069500',
    identity: { shortCode: '069500', isin: 'KR7069500007', officialName: 'KODEX 200', aliases: [], issuerId: null, issuerName: null, listingDate: null, listingStatus: 'listed' },
    product: { description: null, investmentObjective: null, benchmark: { name: null, provider: null, indexCode: null, description: null }, assetClasses: [], targetRegions: [], active: null, replication: null, derivative: { direction: null, multiple: null }, currencyHedged: null, fundOfFunds: null },
    portfolio: { asOfDate: null, holdings: [], sectorWeights: [], countryWeights: [] },
    distribution: { applicability: 'unknown', schedule: null, frequency: null, history: [] },
    fieldCandidates: {}, conflicts: [], status: 'partial',
  };
  const merged = mergeSourceResults({
    identityMap: { universeCount: 1, records: [{ universeKey: '069500', identity: canonicalRecord.identity }] },
    canonical: { schemaVersion: '2.0.0', universeCount: 1, records: [canonicalRecord] },
    sourceDocuments: [first],
    resolutionConfig: { default: { strategy: 'authority_then_confidence' }, fields: {} },
    now: new Date('2026-07-21T04:00:00.000Z'),
  });
  assert.equal(merged.quarantineReport.quarantinedCount, 0);
  assert.equal(merged.output.records[0].portfolio.holdings.length, 2);
});
