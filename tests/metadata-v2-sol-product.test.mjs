import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSolFundListHtml, parseSolProductHtml } from '../scripts/metadata-v2/providers/sol-product.mjs';

test('discovers numeric and alphanumeric SOL tickers with internal product ids', () => {
  const html = `
    <tr id="tr_210367"><td><a href="/ko/fund/etf/210367"><span class="fd-name">SOL 구형상품 <br>(220130)</span></a></td></tr>
    <tr id="tr_211079"><td><a href="/ko/fund/etf/211079"><span class="fd-name">SOL 신규상품 <br>(0005D0)</span></a></td></tr>`;
  assert.deepEqual(parseSolFundListHtml(html).map((row) => [row.productId, row.shortCode, row.name]), [
    ['210367', '220130', 'SOL 구형상품'], ['211079', '0005D0', 'SOL 신규상품'],
  ]);
});

test('extracts SOL description, objective, benchmark, distribution and documents', () => {
  const html = `
    <h1 class="fv-name">SOL 샘플&amp;ETF (0005D0)</h1>
    <p class="fv-des"><span>첫 번째 투자 설명</span></p><p class="fv-des"><span>두 번째 투자 목표</span></p>
    <h3 class="g-title">기초지수정보</h3><div><dl class="g-conts fc-5"><dt>샘플 지수(PR)</dt><dd>샘플 기업으로 구성된 지수</dd><dd><a>지수정보 더보기</a></dd></dl></div>
    <dl class="def"><dt>분배금지급 <a>분배금 현황</a></dt><dd>월 1회 지급</dd><dd><ul><li>- 지급 기준일 : 매월 말일</li></ul></dd></dl>
    <a href="/api/etf/pds/down/policyDescription/211079?type=description">투자설명서</a>`;
  const parsed = parseSolProductHtml(html, { expectedName: 'SOL 샘플&ETF', expectedTicker: '0005D0', productId: '211079' });
  assert.equal(parsed.identity.expectedNameMatches, true);
  assert.equal(parsed.identity.expectedTickerMatches, true);
  assert.equal(parsed.description, '첫 번째 투자 설명; 두 번째 투자 목표');
  assert.deepEqual(parsed.benchmark, { name: '샘플 지수(PR)', description: '샘플 기업으로 구성된 지수' });
  assert.equal(parsed.distributionPolicy, '월 1회 지급; - 지급 기준일 : 매월 말일');
  assert.equal(parsed.officialDocumentLinks[0].href, 'https://www.soletf.com/api/etf/pds/down/policyDescription/211079?type=description');
});

test('preserves a valid SOL record when optional fields are null', () => {
  const parsed = parseSolProductHtml('<h1 class="fv-name">SOL 빈상품 (220130)</h1><p class="fv-des">설명</p>', { expectedName: 'SOL 빈상품', expectedTicker: '220130' });
  assert.equal(parsed.identity.expectedNameMatches, true);
  assert.equal(parsed.description, '설명');
  assert.equal(parsed.benchmark.name, null);
  assert.equal(parsed.distributionPolicy, null);
});
