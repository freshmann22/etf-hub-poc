import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { convertProductMetadataResults, latestSuccessfulProductRows, parseProductLedger } from '../scripts/metadata-v2/convert-product-metadata-results.mjs';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function store(root, relativePath, body) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return { path: relativePath.replaceAll('\\', '/'), hash: hash(body) };
}

function riseEntry(raw, overrides = {}) {
  const proof = (selector, snippet) => ({ rawHash: raw.hash, selector, snippet });
  return {
    retrievedAt: '2026-07-21T01:00:00.000Z', sourceId: 'issuer_rise_product', shortCode: '114100',
    isin: 'KR7114100001', name: 'RISE Bond', status: 'ok',
    metadata: {
      productDescription: 'Official product description',
      investmentObjective: 'Official investment objective',
      benchmarkName: 'Official Bond Index',
      benchmarkDescription: 'The index represents the target bond market.',
      distributionPolicy: 'Quarterly schedule',
    },
    provenance: {
      productDescription: proof('.key_info:first', 'Official product description'),
      investmentObjective: proof('.key_info .point_desc', 'Official investment objective'),
      benchmarkName: proof('.benchmark-name', 'Official Bond Index'),
      benchmarkDescription: proof('.benchmark-description', 'The index represents the target bond market.'),
      distributionPolicy: proof('.distribution', 'Quarterly schedule'),
    },
    raw: { retrievedAt: '2026-07-21T01:00:01.000Z', path: raw.path, hash: raw.hash, url: 'https://riseetf.co.kr/prod/finderDetail/1' },
    validation: { pass: true, failures: [] },
    ...overrides,
  };
}

function plusLedgerEntry(raw, overrides = {}) {
  const proof = (selector, snippet) => ({ rawHash: raw.hash, selector, snippet });
  return {
    retrievedAt: '2026-07-21T03:00:00.000Z', sourceId: 'plus_official_product_html',
    issuerId: 'hanwha-asset-management', shortCode: '152100', isin: 'KR7152100004',
    name: 'PLUS 200', productId: '006184', status: 'ok',
    metadata: {
      productDescription: 'Track Korea large caps',
      investmentObjective: 'Track the KOSPI 200 index',
      benchmarkName: 'KOSPI 200',
      benchmarkDescription: 'Represents 200 leading Korean equities',
      distributionPolicy: 'Quarterly on scheduled dates',
    },
    provenance: {
      productDescription: proof('.summary__investment-list', 'Track Korea large caps'),
      investmentObjective: proof('.summary__investment-list', 'Track the KOSPI 200 index'),
      benchmarkName: proof('.sub-pages__basic-index-title', 'KOSPI 200'),
      benchmarkDescription: proof('.sub-pages__basic-index-desc', 'Represents 200 leading Korean equities'),
      distributionPolicy: proof('.sub-pages__devidend-help', 'Quarterly on scheduled dates'),
    },
    validation: { pass: true, failures: [] },
    raw: { path: raw.path, hash: raw.hash, url: 'https://www.plusetf.co.kr/product/detail?n=006184' },
    ...overrides,
  };
}

function solLedgerEntry(raw, overrides = {}) {
  const proof = (selector, snippet) => ({ rawHash: raw.hash, selector, snippet });
  return {
    retrievedAt: '2026-07-21T04:00:00.000Z', sourceId: 'sol_official_product_html',
    issuerId: 'shinhan-asset-management', shortCode: '433330', isin: 'KR7433330004',
    name: 'SOL 미국S&P500', productId: '210930', status: 'ok',
    metadata: {
      productDescription: 'Invest in the S&P 500',
      investmentObjective: 'Track US large-cap equities',
      benchmarkName: 'S&P500 (PR) Index',
      benchmarkDescription: 'Represents 500 leading US equities',
      distributionPolicy: 'Monthly distribution',
    },
    provenance: {
      productDescription: proof('.fv-des', 'Invest in the S&P 500'),
      investmentObjective: proof('.fv-des', 'Track US large-cap equities'),
      benchmarkName: proof('.g-conts dt', 'S&P500 (PR) Index'),
      benchmarkDescription: proof('.g-conts dd', 'Represents 500 leading US equities'),
      distributionPolicy: proof('dl.def:has(dt)', 'Monthly distribution'),
    },
    validation: { pass: true, failures: [] },
    raw: { path: raw.path, hash: raw.hash, url: 'https://www.soletf.com/ko/fund/etf/210930' },
    ...overrides,
  };
}

function hana1qLedgerEntry(raw, overrides = {}) {
  return solLedgerEntry(raw, {
    sourceId: 'hana_1q_official_product_html', issuerId: 'hana-asset-management',
    shortCode: '0026S0', isin: 'KR70026S0002', name: '1Q 미국S&P500', productId: '14',
    raw: { path: raw.path, hash: raw.hash, url: 'https://www.1qetf.com/pages/ETFproducts/ETF_info.view.php?etf_no=14' },
    ...overrides,
  });
}

function wonLedgerEntry(raw, overrides = {}) {
  return solLedgerEntry(raw, {
    sourceId: 'won_official_product_html', issuerId: 'woori-asset-management',
    shortCode: '444490', isin: 'KR7444490003', name: 'WON 미국S&P500', productId: 'abc',
    raw: { path: raw.path, hash: raw.hash, url: 'https://www.wooriam.kr/investment/etf-view/abc' },
    ...overrides,
  });
}

function plusHtml() {
  return `<!doctype html><html><head><title>PLUS 200 | PLUS ETF</title></head><body>
    <span>152100</span>
    <ul class="summary__investment-list"><li>Track Korea large caps</li><li>Low cost exposure</li></ul>
    <div class="sub-pages__basic-index-title">KOSPI 200</div>
    <div class="sub-pages__basic-index-desc">Represents 200 leading Korean equities</div>
    <div class="sub-pages__basic-index-organization">산출기관 : KRX</div>
    <div class="sub-pages__devidend-help">Quarterly on scheduled dates</div>
  </body></html>`;
}

test('RISE ledger parsing keeps latest ok/partial and reports malformed JSON', () => {
  const raw = { path: 'x', hash: 'a'.repeat(64) };
  const old = riseEntry(raw, { retrievedAt: '2026-07-20T00:00:00.000Z' });
  const latest = riseEntry(raw, { retrievedAt: '2026-07-21T00:00:00.000Z', status: 'partial' });
  const failed = riseEntry(raw, { retrievedAt: '2026-07-22T00:00:00.000Z', status: 'failed' });
  const parsed = parseProductLedger(`${JSON.stringify(old)}\nbad\n${JSON.stringify(latest)}\n${JSON.stringify(failed)}`);
  assert.equal(parsed.malformed.length, 1);
  assert.equal(latestSuccessfulProductRows(parsed.entries)[0].status, 'partial');
});

test('RISE conversion emits only populated fields with per-field raw and selector evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/rise.html', '<html>RISE source</html>');
  const entry = riseEntry(raw);
  entry.metadata.benchmarkDescription = null;
  entry.provenance.benchmarkDescription = null;
  const output = convertProductMetadataResults({ riseLedgerText: JSON.stringify(entry), plusReport: null, rootDir: root });
  assert.equal(output.records.length, 1);
  const record = output.records[0];
  assert.equal(record.fields['product.description'], 'Official product description');
  assert.equal(record.fields['distribution.schedule'], 'Quarterly schedule');
  assert.equal(Object.hasOwn(record.fields, 'product.benchmark.description'), false);
  assert.equal(record.provenance.rawSnapshotPath, raw.path);
  assert.equal(record.provenance.contentHash, raw.hash);
  assert.equal(record.evidence['product.description'].selector, '.key_info:first');
  assert.equal(record.evidence['product.description'].snippet, 'Official product description');
});

test('PLUS raw HTML contract is reparsed and emitted with deterministic selectors', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/plus.html', plusHtml());
  const plusReport = {
    generatedAt: '2026-07-21T02:00:00.000Z',
    rows: [{
      ticker: '152100', name: 'PLUS 200', url: 'https://www.plusetf.co.kr/product/detail?n=1',
      access: { ok: true, httpStatus: 200 },
      raw: { ...raw, retrievedAt: '2026-07-21T02:00:00.000Z', url: 'https://www.plusetf.co.kr/product/detail?n=1' },
    }],
  };
  const output = convertProductMetadataResults({ riseLedgerText: '', plusReport, rootDir: root });
  assert.equal(output.records.length, 1);
  const record = output.records[0];
  assert.equal(record.fields['product.benchmark.name'], 'KOSPI 200');
  assert.equal(record.fields['distribution.schedule'], 'Quarterly on scheduled dates');
  assert.equal(record.evidence['product.benchmark.name'].selector, '.sub-pages__basic-index-title');
  assert.equal(record.provenance.sourceId, 'issuer_plus_product');
});

test('PLUS ledger emits latest ok/partial entry with verified raw and field provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/plus-ledger.html', plusHtml());
  const old = plusLedgerEntry(raw, { retrievedAt: '2026-07-20T03:00:00.000Z' });
  const latest = plusLedgerEntry(raw, {
    retrievedAt: '2026-07-21T03:00:00.000Z', status: 'partial',
    metadata: { ...plusLedgerEntry(raw).metadata, distributionPolicy: null },
    provenance: { ...plusLedgerEntry(raw).provenance, distributionPolicy: null },
  });
  const failed = plusLedgerEntry(raw, { retrievedAt: '2026-07-22T03:00:00.000Z', status: 'validation_failed', validation: { pass: false, failures: ['identity'] } });
  const plusReport = { generatedAt: '2026-07-23T00:00:00.000Z', rows: [{ ticker: '999999', access: { ok: false } }] };
  const output = convertProductMetadataResults({
    plusLedgerText: [old, latest, failed].map(JSON.stringify).join('\n'), plusReport, rootDir: root,
  });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].status, 'partial');
  assert.equal(output.records[0].provenance.sourceId, 'plus_official_product_html');
  assert.equal(output.records[0].provenance.rawSnapshotPath, raw.path);
  assert.equal(output.records[0].provenance.contentHash, raw.hash);
  assert.equal(output.records[0].evidence['product.benchmark.name'].selector, '.sub-pages__basic-index-title');
  assert.equal(Object.hasOwn(output.records[0].fields, 'distribution.schedule'), false);
  assert.equal(output.health.plusLedgerEntryCount, 3);
  assert.equal(output.health.plusLatestSuccessCount, 1);
  assert.equal(output.health.plusInputRowCount, 0);
  assert.equal(output.health.plusCanaryFallbackUsed, false);
  assert.equal(output.health.failureEvents[0].status, 'validation_failed');
});

test('PLUS ledger raw hash and per-field provenance failures are quarantined', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/plus-ledger.html', plusHtml());
  const invalidHash = plusLedgerEntry({ ...raw, hash: '0'.repeat(64) });
  const hashOutput = convertProductMetadataResults({ plusLedgerText: JSON.stringify(invalidHash), rootDir: root });
  assert.equal(hashOutput.records.length, 0);
  assert.equal(hashOutput.quarantine.items[0].reason, 'raw_hash_mismatch');

  const invalidField = plusLedgerEntry(raw);
  invalidField.provenance.benchmarkName = { ...invalidField.provenance.benchmarkName, rawHash: '0'.repeat(64) };
  const fieldOutput = convertProductMetadataResults({ plusLedgerText: JSON.stringify(invalidField), rootDir: root });
  assert.equal(Object.hasOwn(fieldOutput.records[0].fields, 'product.benchmark.name'), false);
  assert.equal(fieldOutput.quarantine.items[0].reason, 'field_provenance_invalid');
});

test('SOL ledger emits latest ok/partial entries with verified raw and source health', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/sol.html', '<html>SOL official product source</html>');
  const old = solLedgerEntry(raw, { retrievedAt: '2026-07-20T04:00:00.000Z' });
  const latest = solLedgerEntry(raw, {
    retrievedAt: '2026-07-21T04:00:00.000Z', status: 'partial',
    metadata: { ...solLedgerEntry(raw).metadata, benchmarkDescription: null },
    provenance: { ...solLedgerEntry(raw).provenance, benchmarkDescription: null },
  });
  const output = convertProductMetadataResults({ solLedgerText: [old, latest].map(JSON.stringify).join('\n'), rootDir: root });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].status, 'partial');
  assert.equal(output.records[0].provenance.sourceId, 'sol_official_product_html');
  assert.equal(output.records[0].provenance.contentHash, raw.hash);
  assert.equal(output.records[0].evidence['product.benchmark.name'].selector, '.g-conts dt');
  assert.equal(Object.hasOwn(output.records[0].fields, 'product.benchmark.description'), false);
  assert.equal(output.health.solLedgerEntryCount, 2);
  assert.equal(output.health.solLatestSuccessCount, 1);
  assert.deepEqual(output.health.sourceHealth.sol, {
    ledgerEntryCount: 2, latestSuccessCount: 1, emittedRecordCount: 1, quarantineCount: 0, failureEventCount: 0,
  });
});

test('SOL raw hash and field provenance failures are quarantined independently', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/sol.html', '<html>SOL official product source</html>');
  const invalidHash = solLedgerEntry({ ...raw, hash: '0'.repeat(64) });
  const hashOutput = convertProductMetadataResults({ solLedgerText: JSON.stringify(invalidHash), rootDir: root });
  assert.equal(hashOutput.records.length, 0);
  assert.equal(hashOutput.quarantine.items[0].source, 'sol');
  assert.equal(hashOutput.quarantine.items[0].reason, 'raw_hash_mismatch');

  const invalidField = solLedgerEntry(raw);
  invalidField.provenance.distributionPolicy = { ...invalidField.provenance.distributionPolicy, rawHash: '0'.repeat(64) };
  const fieldOutput = convertProductMetadataResults({ solLedgerText: JSON.stringify(invalidField), rootDir: root });
  assert.equal(Object.hasOwn(fieldOutput.records[0].fields, 'distribution.schedule'), false);
  assert.equal(fieldOutput.quarantine.items[0].source, 'sol');
  assert.equal(fieldOutput.quarantine.items[0].reason, 'field_provenance_invalid');
});

test('1Q ledger is converted with verified provenance and source health', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/1q.html', '<html>1Q official product source</html>');
  const output = convertProductMetadataResults({ hana1qLedgerText: JSON.stringify(hana1qLedgerEntry(raw)), rootDir: root });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].shortCode, '0026S0');
  assert.equal(output.records[0].provenance.sourceId, 'hana_1q_official_product_html');
  assert.equal(output.records[0].provenance.parserVersion, 'hana-1q-product-ledger-converter-1.0.0');
  assert.equal(output.health.hana1qLatestSuccessCount, 1);
  assert.equal(output.health.sourceHealth.hana1q.emittedRecordCount, 1);
  assert.equal(output.quarantine.count, 0);
});

test('WON ledger is converted with verified provenance and source health', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/won.html', '<html>WON official product source</html>');
  const output = convertProductMetadataResults({ wonLedgerText: JSON.stringify(wonLedgerEntry(raw)), rootDir: root });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].shortCode, '444490');
  assert.equal(output.records[0].provenance.sourceId, 'won_official_product_html');
  assert.equal(output.records[0].provenance.parserVersion, 'won-product-ledger-converter-1.0.0');
  assert.equal(output.health.wonLatestSuccessCount, 1);
  assert.equal(output.health.sourceHealth.won.emittedRecordCount, 1);
  assert.equal(output.quarantine.count, 0);
});

test('TheJ eligible-small ledger is converted while failed KCGI stays a failure event', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/thej.html', '<html>TheJ official product source</html>');
  const thej = plusLedgerEntry(raw, { sourceId: 'thej_official_product_html', issuerId: 'thej-asset-management', shortCode: '0053M0', isin: 'KR70053M0004' });
  const kcgi = { retrievedAt: '2026-07-21T07:00:00.000Z', sourceId: 'kcgi_official_product_html', shortCode: '483570', status: 'validation_failed', validation: { failures: ['ticker_mismatch', 'missing_distributionPolicy'] } };
  const output = convertProductMetadataResults({ thejLedgerText: JSON.stringify(thej), kcgiLedgerText: JSON.stringify(kcgi), rootDir: root });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].provenance.sourceId, 'thej_official_product_html');
  assert.equal(output.health.sourceHealth.thej.emittedRecordCount, 1);
  assert.equal(output.health.sourceHealth.kcgi.failureEventCount, 1);
  assert.equal(output.health.failureEvents[0].shortCode, '483570');
});

test('current PLUS probe without persisted raw is quarantined, not silently promoted', () => {
  const plusReport = {
    generatedAt: '2026-07-21T02:00:00.000Z',
    rows: [{ ticker: '152100', name: 'PLUS 200', url: 'https://www.plusetf.co.kr/product/detail?n=1', access: { ok: true }, extraction: { description: 'Report-only value' } }],
  };
  const output = convertProductMetadataResults({ plusReport, riseLedgerText: '' });
  assert.equal(output.records.length, 0);
  assert.equal(output.quarantine.items[0].reason, 'raw_artifact_unavailable_in_probe');
  assert.equal(output.health.plusRawUnavailableCount, 1);
});

test('raw hash and field-level provenance failures are quarantined independently', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/rise.html', '<html>RISE source</html>');
  const invalidHash = riseEntry({ ...raw, hash: '0'.repeat(64) });
  const hashOutput = convertProductMetadataResults({ riseLedgerText: JSON.stringify(invalidHash), rootDir: root });
  assert.equal(hashOutput.records.length, 0);
  assert.equal(hashOutput.quarantine.items[0].reason, 'raw_hash_mismatch');

  const invalidField = riseEntry(raw);
  invalidField.provenance.productDescription = { ...invalidField.provenance.productDescription, selector: null };
  const fieldOutput = convertProductMetadataResults({ riseLedgerText: JSON.stringify(invalidField), rootDir: root });
  assert.equal(Object.hasOwn(fieldOutput.records[0].fields, 'product.description'), false);
  assert.equal(fieldOutput.quarantine.items[0].reason, 'field_provenance_invalid');
});

test('conversion is deterministic for unchanged inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'etf-product-convert-'));
  const raw = store(root, 'raw/rise.html', '<html>RISE source</html>');
  const input = { riseLedgerText: JSON.stringify(riseEntry(raw)), plusReport: { generatedAt: '2026-07-21T00:00:00.000Z', rows: [] }, rootDir: root };
  assert.deepEqual(convertProductMetadataResults(input), convertProductMetadataResults(input));
});
