import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseKoactProductPayload } from '../scripts/metadata-v2/collect-koact-product-metadata.mjs';
import { convertProductMetadataResults } from '../scripts/metadata-v2/convert-product-metadata-results.mjs';

const target = { shortCode: '0015B0', productId: '2ETFQ1', name: 'KoAct 미국나스닥성장기업액티브' };
function payload() {
  return {
    info: { product: {
      stkTicker: target.shortCode, fId: target.productId, fNm: target.name,
      fSummary: '혁신 성장기업에 투자', bmIdx: '나스닥 종합주가지수',
      kodexinfoidxProperty: '미국 나스닥 상장 종목으로 구성', dividRemark: '분기 말 지급 기준일',
    } },
    point: { investPoints: [{ title: '집중 투자', cn: '구조적 성장 기업을 선별' }] },
  };
}

test('KoAct parser extracts five official metadata fields with JSON selectors and hash evidence', () => {
  const parsed = parseKoactProductPayload(payload(), target, 'a'.repeat(64));
  assert.equal(parsed.identityValid, true);
  assert.equal(parsed.populatedFieldCount, 5);
  assert.equal(parsed.metadata.investmentObjective, '집중 투자: 구조적 성장 기업을 선별');
  assert.equal(parsed.provenance.benchmarkName.selector, '$.info.product.bmIdx');
  assert.equal(parsed.provenance.distributionPolicy.rawHash, 'a'.repeat(64));
});

test('KoAct parser marks missing fields partial and cross-product identity invalid', () => {
  const partialPayload = payload();
  partialPayload.info.product.bmIdx = '';
  partialPayload.info.product.kodexinfoidxProperty = null;
  const partial = parseKoactProductPayload(partialPayload, target, 'b'.repeat(64));
  assert.deepEqual(partial.missingFields, ['benchmarkName', 'benchmarkDescription']);
  const crossed = parseKoactProductPayload(payload(), { ...target, shortCode: 'WRONG' }, 'b'.repeat(64));
  assert.equal(crossed.identityValid, false);
});

test('KoAct ledger converter verifies raw hash and emits the shared five-field contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'koact-converter-'));
  const body = JSON.stringify(payload());
  const hash = createHash('sha256').update(body).digest('hex');
  const rawPath = 'raw/koact.json';
  const absolute = join(root, rawPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
  const parsed = parseKoactProductPayload(payload(), target, hash);
  const entry = {
    retrievedAt: '2026-07-21T08:00:00.000Z', sourceId: 'koact_official_product_api',
    shortCode: target.shortCode, name: target.name, productId: target.productId, status: 'ok',
    validation: { pass: true, failures: [], fieldCoverage: parsed.fieldCoverage },
    metadata: parsed.metadata, provenance: parsed.provenance,
    raw: { path: rawPath, hash, url: `https://www.samsungactive.co.kr/api/v1/product/etf/${target.productId}.do` },
  };
  const output = convertProductMetadataResults({ koactLedgerText: JSON.stringify(entry), rootDir: root });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].fields['product.description'], '혁신 성장기업에 투자');
  assert.equal(output.records[0].fields['product.benchmark.name'], '나스닥 종합주가지수');
  assert.equal(output.records[0].provenance.sourceId, 'koact_official_product_api');
  assert.equal(output.health.sourceHealth.koact.emittedRecordCount, 1);
});

test('generated KoAct collection is limited to the frozen local 23 and excludes the new official ticker', () => {
  const report = JSON.parse(readFileSync(new URL('../data/reports/metadata-v2/koact-product-collection.json', import.meta.url), 'utf8'));
  assert.equal(report.contract.targetCount, 23);
  assert.deepEqual(report.contract.excludedOfficialOnlyTickers, ['0219B0']);
  assert.equal(report.rows.some((row) => row.shortCode === '0219B0'), false);
  assert.equal(report.circuit.open, false);
  assert.equal(report.completedCount, 23);
  assert.equal(report.networkOriginatedArtifactCount, 19);
  assert.equal(report.canaryCacheArtifactCount, 4);
  assert.equal(report.rows.every((row) => {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', row.raw.path);
    if (!existsSync(path)) return false;
    return createHash('sha256').update(readFileSync(path)).digest('hex') === row.raw.hash;
  }), true);
});
