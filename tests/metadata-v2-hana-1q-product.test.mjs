import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHana1qListHtml, parseHana1qProductHtml } from '../scripts/metadata-v2/providers/hana-1q-product.mjs';

test('discovers unique 1Q internal product ids and names', () => {
  const html = '<a href="/pages/ETFproducts/ETF_info.view.php?etf_no=14"><span class="etf-name">1Q 미국S&amp;P500</span></a>';
  assert.deepEqual(parseHana1qListHtml(html), [{ productId: '14', name: '1Q 미국S&P500', productUrl: 'https://www.1qetf.com/pages/ETFproducts/ETF_info.view.php?etf_no=14' }]);
});

test('extracts 1Q product metadata and official document links', () => {
  const html = `
    <h2 class="no-etf__name hana">1Q 미국S&amp;P500</h2><span class="no-etf__code">0026S0</span>
    <div class="no-etfInfo__cnt etfInfo"><p>미국 우량주 500개 기업 투자</p><p>분기분배 추구</p></div>
    <h3 class="no-etfInfo__index-title">S&amp;P500 Price Return Index</h3><p class="no-etfInfo__desc">미국 대형주 지수</p>
    <li><span class="no-etfInfo__item-label">분배금지급</span><span class="no-etfInfo__item-data">분기 지급</span></li>
    <a href="/inc/lib/etf.file.download.php?no=14&amp;fld=attach1">투자설명서</a>`;
  const parsed = parseHana1qProductHtml(html, { expectedName: '1Q 미국S&P500', expectedTicker: '0026S0', productId: '14' });
  assert.equal(parsed.identity.expectedNameMatches, true);
  assert.equal(parsed.identity.expectedTickerMatches, true);
  assert.equal(parsed.description, '미국 우량주 500개 기업 투자; 분기분배 추구');
  assert.deepEqual(parsed.benchmark, { name: 'S&P500 Price Return Index', description: '미국 대형주 지수' });
  assert.equal(parsed.distributionPolicy, '분기 지급');
  assert.equal(parsed.officialDocumentLinks[0].href, 'https://www.1qetf.com/inc/lib/etf.file.download.php?no=14&fld=attach1');
});

test('keeps identity and populated fields when optional metadata is absent', () => {
  const parsed = parseHana1qProductHtml('<h2 class="no-etf__name">1Q 채권액티브</h2><span class="no-etf__code">0017Y0</span><div class="no-etfInfo__cnt etfInfo">채권 투자</div>', { expectedName: '1Q 채권액티브', expectedTicker: '0017Y0' });
  assert.equal(parsed.identity.expectedTickerMatches, true);
  assert.equal(parsed.description, '채권 투자');
  assert.equal(parsed.benchmark.name, null);
});
