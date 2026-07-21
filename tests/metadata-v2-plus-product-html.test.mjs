import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlusProductHtml } from '../scripts/metadata-v2/providers/plus-product-html.mjs';

const HTML = `
  <title>PLUS 샘플&amp;ETF | PLUS ETF</title>
  <link rel="canonical" href="https://www.plusetf.co.kr/product/detail?n=000001">
  <div>123456</div>
  <ul class="summary__investment-list">
    <li>첫 번째 투자 포인트</li><li>&#39;두 번째&#39; 목표</li>
  </ul>
  <div class="sub-pages__devidend-help"><p>매월 마지막 영업일</p></div>
  <div class="sub-pages__basic-index-title">샘플 지수</div>
  <div class="sub-pages__basic-index-desc">샘플 기업에 투자</div>
  <div class="sub-pages__basic-index-organization">산출기관 : 샘플기관</div>
  <a href="/upload/sample.pdf">투자설명서 다운로드</a>
`;

test('extracts PLUS objective, benchmark, distribution and official document provenance', () => {
  const parsed = parsePlusProductHtml(HTML, {
    expectedName: 'PLUS 샘플&ETF', expectedTicker: '123456',
    sourceUrl: 'https://www.plusetf.co.kr/product/detail?n=000001',
  });
  assert.equal(parsed.complete, true);
  assert.equal(parsed.identity.productName, 'PLUS 샘플&ETF');
  assert.equal(parsed.investmentObjective, "첫 번째 투자 포인트; '두 번째' 목표");
  assert.deepEqual(parsed.benchmark, { name: '샘플 지수', description: '샘플 기업에 투자', provider: '샘플기관' });
  assert.equal(parsed.distributionPolicy, '매월 마지막 영업일');
  assert.equal(parsed.prospectusLinks[0].href, 'https://www.plusetf.co.kr/upload/sample.pdf');
});

test('marks a mismatched or incomplete page as not complete', () => {
  const parsed = parsePlusProductHtml(HTML.replace('sub-pages__basic-index-desc', 'other-class'), {
    expectedName: 'PLUS 다른상품', expectedTicker: '999999',
  });
  assert.equal(parsed.complete, false);
  assert.equal(parsed.identity.expectedNameMatches, false);
  assert.equal(parsed.identity.tickerVisible, false);
  assert.equal(parsed.benchmark.description, null);
});

test('uses an explicit distribution reinvestment point when a TR fund has no payout section', () => {
  const html = HTML
    .replace('<div class="sub-pages__devidend-help"><p>매월 마지막 영업일</p></div>', '')
    .replace('첫 번째 투자 포인트', '분배금 재투자로 총수익 추구');
  const parsed = parsePlusProductHtml(html, {
    expectedName: 'PLUS 샘플&ETF', expectedTicker: '123456',
  });
  assert.equal(parsed.complete, true);
  assert.equal(parsed.distributionPolicy, '분배금 재투자로 총수익 추구');
  assert.equal(parsed.distributionPolicySource, 'investment-point-reinvestment');
});
