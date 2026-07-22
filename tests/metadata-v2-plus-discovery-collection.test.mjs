import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parsePlusDiscoveryPage, reconcilePlusDiscovery } from '../scripts/metadata-v2/discover-plus-products.mjs';
import { runPlusCollection } from '../scripts/metadata-v2/collect-plus-metadata.mjs';

test('parses public PLUS list response into ticker and internal product id mappings', () => {
  const parsed = parsePlusDiscoveryPage(JSON.stringify({
    content: [
      { id: '006273', nameCode: '161510', displayName: 'PLUS 고배당주', basicInfo: 'FnGuide 고배당주지수', fileInfo: { download: '/upload/fund/', flNm: 'factsheet.pdf' } },
      { id: '006999', nameCode: 'A0000J0', displayName: 'PLUS 한화그룹주', basicInfo: null, fileInfo: null },
    ], number: 0, totalPages: 9, totalElements: 84, last: false,
  }));
  assert.equal(parsed.totalPages, 9);
  assert.deepEqual(parsed.rows.map((row) => [row.shortCode, row.productId]), [['161510', '006273'], ['0000J0', '006999']]);
  assert.equal(parsed.rows[0].factsheetHref, 'https://www.plusetf.co.kr/upload/fund/factsheet.pdf');
});

test('reconciles ticker mapping independently of display-name spacing', () => {
  const result = reconcilePlusDiscovery(
    [{ issuerId: 'hanwha-asset-management', shortCode: '161510', isin: null, name: 'PLUS 고배당주' }],
    [{ shortCode: '161510', productId: '006273', name: 'PLUS고배당주', benchmarkHint: null, factsheetHref: null }],
  );
  assert.equal(result.metrics.coverageRatio, 1);
  assert.equal(result.metrics.exactNameMatchCount, 1);
  assert.equal(result.mappings[0].productUrl, 'https://www.plusetf.co.kr/product/detail?n=006273');
});

test('blocks every product request when discovery coverage is below 95 percent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plus-collection-'));
  const paths = {
    discovery: join(root, 'discovery.json'), rawRoot: join(root, 'raw'), ledger: join(root, 'ledger.jsonl'),
    report: join(root, 'report.json'), csv: join(root, 'report.csv'),
  };
  writeFileSync(paths.discovery, JSON.stringify({
    metrics: { inventoryCount: 84, coverageRatio: 0.94, missingCount: 6 },
    duplicateSourceTickers: [], mappings: [],
  }));
  const report = await runPlusCollection({ full: true, paths, client: { request: async () => { throw new Error('must not be called'); } } });
  assert.equal(report.scaleDecision, 'full_collection_blocked_mapping_coverage');
  assert.equal(report.attemptedUniqueCount, 0);
  assert.match(readFileSync(paths.report, 'utf8'), /full_collection_blocked_mapping_coverage/);
});
