import test from 'node:test';
import assert from 'node:assert/strict';

import { CachedRiseHttpClient, buildRiseTargets, validateRiseRecord } from '../scripts/metadata-v2/collect-rise-metadata.mjs';
import { assertAllowedRiseUrl, parseRiseCatalog, parseRiseProductHtml } from '../scripts/metadata-v2/providers/rise-product.mjs';

const HTML = `
  <title>RISE 국고채3년 - RISE ETF</title>
  <h2>RISE 국고채3년 <span>(114100)</span></h2>
  <div class="key_info"><p class="point_title heading05">안정적인 국고채 투자</p><p class="point_desc">국고채권에 투자합니다.</p></div>
  <div class="key_info"><p class="point_title heading05">KTB 지수 추종</p><p class="point_desc">기초 지수 수익률을 추종합니다.</p></div>
  <table><caption>기본정보: ETF명(종목번호), 기초지수, 상장일</caption><tr><th>ETF명</th><th>기초지수</th></tr>
    <tr class="no_border"><td>KB RISE 국고채3년증권상장지수투자신탁 (114100)</td><td>KTB INDEX</td><td>2011.01.01</td></tr></table>
  <table><tr><th>총 보수(%)</th><th>분배금 지급 기준일</th></tr>
    <tr class="no_border"><td>연 0.1%</td><td>매 1월, 4월, 7월, 10월 마지막 영업일</td></tr></table>
  <div class="wrap_inner mt intro_index"><div class="body02 txt_desc"><p>KTB INDEX는 국고채 3종목으로 구성된 지수입니다.</p></div></div>
  <div class="btn_file_download"><a href="/pdf/viewer/1?file=/upload/a.pdf">투자설명서</a></div>
  <a href="/prod/finderDetail/4401">RISE 국고채3년</a>
`;

test('RISE URL guard permits only the robots-allowed product detail route', () => {
  assert.equal(assertAllowedRiseUrl('https://riseetf.co.kr/prod/finderDetail/4401'), 'https://riseetf.co.kr/prod/finderDetail/4401');
  assert.throws(() => assertAllowedRiseUrl('https://riseetf.co.kr/prod/document/divided/1'), /robots-disallowed/);
  assert.throws(() => assertAllowedRiseUrl('https://riseetf.co.kr/etf/kor/product/1'), /robots-disallowed/);
  assert.throws(() => assertAllowedRiseUrl('https://example.com/prod/finderDetail/4401'), /cross-origin/);
  assert.throws(() => assertAllowedRiseUrl('https://riseetf.co.kr/prod/finder'), /only fetches/);
});

test('RISE catalog and product parser retain field-level selector/hash/snippet evidence', () => {
  assert.deepEqual(parseRiseCatalog(HTML), [{ productId: '4401', name: 'RISE 국고채3년' }]);
  const result = parseRiseProductHtml(HTML, 'https://riseetf.co.kr/prod/finderDetail/4401');
  assert.equal(result.shortCode, '114100');
  assert.equal(result.productName, 'RISE 국고채3년');
  assert.equal(result.metadata.benchmarkName, 'KTB INDEX');
  assert.match(result.metadata.benchmarkDescription, /3종목/);
  assert.match(result.metadata.distributionPolicy, /마지막 영업일/);
  assert.equal(result.metadata.officialDocumentLinks.length, 1);
  for (const key of ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy']) {
    assert.equal(result.provenance[key].rawHash, result.rawHash);
    assert.ok(result.provenance[key].selector);
    assert.ok(result.provenance[key].snippet);
  }
  assert.equal(validateRiseRecord({ shortCode: '114100', name: 'RISE 국고채3년' }, result).pass, true);
});

test('RISE HTTP cache deduplicates same-origin page requests', async () => {
  let calls = 0;
  const cache = new CachedRiseHttpClient({ client: { request: async (url) => { calls += 1; return { body: url }; } } });
  const url = 'https://riseetf.co.kr/prod/finderDetail/4401';
  const [one, two] = await Promise.all([cache.request(url), cache.request(url)]);
  assert.deepEqual(one, two);
  assert.equal(calls, 1);
});

test('RISE target builder selects only KB issuer rows', () => {
  const targets = buildRiseTargets({ rows: [
    { issuer: { id: 'kb-asset-management' }, identifiers: { krxShortCodeCandidate: '114100' }, sourceRecord: { name: 'RISE 국고채3년' } },
    { issuer: { id: 'other' }, identifiers: { krxShortCodeCandidate: '000000' }, sourceRecord: { name: 'OTHER' } },
  ] });
  assert.deepEqual(targets.map((target) => target.shortCode), ['114100']);
});

test('RISE validation blocks Korean mojibake before canonical merge', () => {
  const result = parseRiseProductHtml(HTML, 'https://riseetf.co.kr/prod/finderDetail/4401');
  result.productName = 'RISE 誘멸뎅 ETF';
  const health = validateRiseRecord({ shortCode: '114100', name: 'RISE 誘멸뎅 ETF' }, result);
  assert.equal(health.pass, false);
  assert.match(health.failures.join(' '), /mojibake/);
});
