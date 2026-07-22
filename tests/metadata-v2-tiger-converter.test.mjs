import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { convertProductMetadataResults } from '../scripts/metadata-v2/convert-product-metadata-results.mjs';

test('TIGER product ledger converts verified fields into the shared source-result contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'tiger-converter-'));
  const relative = 'raw/tiger.html';
  const path = join(root, relative);
  const body = '<html>TIGER official source</html>';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  const hash = createHash('sha256').update(body).digest('hex');
  const proof = (selector, snippet) => ({ rawHash: hash, selector, snippet });
  const entry = {
    retrievedAt: '2026-07-21T00:00:00.000Z', sourceId: 'issuer_tiger_product', shortCode: '102110', isin: 'KR7102110004', status: 'ok',
    metadata: {
      productDescription: '대표 200종목 투자', investmentObjective: '지수 추종', benchmarkName: '코스피 200',
      benchmarkDescription: '한국 대표 주가지수', distributionPolicy: '분기 마지막 영업일',
    },
    provenance: {
      productDescription: proof('#section1 .title', '대표 200종목 투자'), investmentObjective: proof('.objective', '지수 추종'),
      benchmarkName: proof('.benchmark-name', '코스피 200'), benchmarkDescription: proof('.benchmark-description', '한국 대표 주가지수'),
      distributionPolicy: proof('.distribution', '분기 마지막 영업일'),
    },
    raw: { path: relative, hash, url: 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7102110004' },
  };
  const output = convertProductMetadataResults({ tigerLedgerText: JSON.stringify(entry), rootDir: root });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].provenance.sourceId, 'issuer_tiger_product');
  assert.equal(output.records[0].fields['product.benchmark.name'], '코스피 200');
  assert.equal(output.records[0].fields['distribution.schedule'], '분기 마지막 영업일');
  assert.equal(output.health.tigerLatestSuccessCount, 1);
  assert.equal(output.health.sourceHealth.tiger.quarantineCount, 0);
});
