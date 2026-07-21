import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWonListHtml, parseWonProductHtml } from '../scripts/metadata-v2/providers/won-product.mjs';

test('discovers WON product id, ticker, name, and list description', () => {
  const html = '<a href="etf-view/abc123" class="product-item etfItem"><h2 class="product-item__title">WON 미국S&amp;P500 (444490)</h2><p class="product-item__text">미국 대표 기업에 투자합니다.</p></a>';
  assert.deepEqual(parseWonListHtml(html), [{ productId: 'abc123', shortCode: '444490', name: 'WON 미국S&P500', listDescription: '미국 대표 기업에 투자합니다.', productUrl: 'https://www.wooriam.kr/investment/etf-view/abc123' }]);
});

test('extracts WON identity and metadata with official documents', () => {
  const html = `<h1 class="fund-view__title">WON 미국S&amp;P500 (444490)</h1><h2 class="fund-view__sub-title">대표지수를 추종합니다.</h2><p class="investment__info">S&amp;P 500에 투자하는 것을 목적으로 합니다.</p><li class="notion__item"><p class="notion__left">기초지수</p><p class="notion__right">S&amp;P 500 Index PR</p></li><dl><dt>분배금</dt><dd>분기 지급</dd></dl><button onclick="window.open('/file-download?uid=x', '_blank');">투자설명서</button>`;
  const parsed = parseWonProductHtml(html, { expectedName: 'WON 미국S&P500', expectedTicker: '444490', sourceUrl: 'https://www.wooriam.kr/investment/etf-view/x' });
  assert.equal(parsed.identity.expectedNameMatches, true);
  assert.equal(parsed.identity.expectedTickerMatches, true);
  assert.equal(parsed.description, '대표지수를 추종합니다.');
  assert.equal(parsed.benchmark.name, 'S&P 500 Index PR');
  assert.equal(parsed.distributionPolicy, '분기 지급');
  assert.equal(parsed.officialDocumentLinks[0].href, 'https://www.wooriam.kr/file-download?uid=x');
});
