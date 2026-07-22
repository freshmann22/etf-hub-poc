import test from 'node:test';
import assert from 'node:assert/strict';

import { CachedTigerHttpClient, buildTigerTargets, validateTigerRecord } from '../scripts/metadata-v2/collect-tiger-metadata.mjs';
import { HostLimitedHttpClient, PersistentRateLimitError } from '../scripts/metadata-v2/collect-official-holdings.mjs';
import { assertAllowedTigerUrl, parseTigerProductHtml } from '../scripts/metadata-v2/providers/tiger-product.mjs';

const HTML = `
  <h1>TIGER 200 (102110)</h1>
  <div id="section1"><div class="c-sheet"><h2>미리 보는 투자포인트!</h2><div class="title">대한민국 대표 우량기업 200종목에 투자합니다</div></div></div>
  <div id="section2"></div>
  <h2 class="title">상품 정보</h2><div class="label">기초지수</div><div class="value">코스피 200</div>
  <div class="c-card"><div class="c-card-header">운용목표</div><div class="c-card-content">코스피 200 변동률과 유사하도록 운용합니다.</div></div>
  <h3>기초지수</h3><div class="c-card"><div class="c-card-header">기초지수</div><div class="c-card-content"><div>한국거래소 대표 200종목 지수입니다.</div><div>유동시가총액 방식입니다.</div></div></div>
  <div class="c-card"><div class="c-card-header">분배금 지급 기준일</div><div class="c-card-content"><div class="flex"><div>1,4,7,10월 마지막 영업일 및 회계기간 종료일</div></div></div></div>
  <ul class="temp-resources"><li><a href="/tigeretf/upload/etf/a.pdf">투자설명서</a></li><li><a href="/tigeretf/upload/etf/b.pdf">간이투자설명서</a></li></ul>
`;

test('TIGER URL guard permits verified-ISIN detail pages and blocks robots-disallowed uploads', () => {
  assert.match(assertAllowedTigerUrl('https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7102110004'), /ksdFund=KR7102110004/);
  assert.throws(() => assertAllowedTigerUrl('https://investments.miraeasset.com/tigeretf/upload/etf/a.pdf'), /robots-disallowed/);
  assert.throws(() => assertAllowedTigerUrl('https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=bad'), /verified ISIN/);
  assert.throws(() => assertAllowedTigerUrl('https://example.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7102110004'), /cross-origin/);
});

test('TIGER parser extracts six field groups with raw hash, selector, and snippet provenance', () => {
  const result = parseTigerProductHtml(HTML, 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7102110004');
  assert.equal(result.productName, 'TIGER 200');
  assert.equal(result.shortCode, '102110');
  assert.equal(result.metadata.productDescription, '대한민국 대표 우량기업 200종목에 투자합니다');
  assert.equal(result.metadata.benchmarkName, '코스피 200');
  assert.match(result.metadata.benchmarkDescription, /대표 200종목/);
  assert.match(result.metadata.distributionPolicy, /마지막 영업일/);
  assert.equal(result.metadata.officialDocumentLinks.length, 2);
  assert.equal(result.metadata.officialDocumentLinks[0].fetchPolicy, 'link_only_robots_disallow_upload');
  for (const field of ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy']) {
    assert.equal(result.provenance[field].rawHash, result.rawHash);
    assert.ok(result.provenance[field].selector);
    assert.ok(result.provenance[field].snippet);
  }
  assert.equal(validateTigerRecord({ shortCode: '102110', name: 'TIGER 200' }, result).complete, true);
});

test('TIGER cache deduplicates requests and persistent 429 opens the caller circuit-breaker signal', async () => {
  let calls = 0;
  const hostClient = new HostLimitedHttpClient({
    intervalMs: 1200, maxAttempts: 2, defaultCooldownMs: 0, sleepImpl: async () => {},
    fetchImpl: async () => { calls += 1; return { status: 429, ok: false, headers: { get: () => '0' }, text: async () => '' }; },
  });
  const cached = new CachedTigerHttpClient({ client: hostClient });
  await assert.rejects(() => cached.request('https://investments.miraeasset.com/test'), PersistentRateLimitError);
  assert.equal(calls, 2);

  let healthyCalls = 0;
  const healthy = new CachedTigerHttpClient({ client: { request: async () => { healthyCalls += 1; return { body: 'ok' }; } } });
  const [one, two] = await Promise.all([healthy.request('https://investments.miraeasset.com/x'), healthy.request('https://investments.miraeasset.com/x')]);
  assert.deepEqual(one, two);
  assert.equal(healthyCalls, 1);
});

test('TIGER target builder uses resolved official identity and excludes other issuers', () => {
  const inventory = { rows: [
    { issuer: { id: 'mirae-asset-global-investments' }, identifiers: { krxShortCodeCandidate: '102110' }, sourceRecord: { name: 'TIGER 200' } },
    { issuer: { id: 'other' }, identifiers: { krxShortCodeCandidate: '000000' }, sourceRecord: { name: 'OTHER' } },
  ] };
  const identity = { records: [{ status: 'resolved', identity: { shortCode: '102110', isin: 'KR7102110004', officialName: 'TIGER 200' } }] };
  assert.deepEqual(buildTigerTargets(inventory, identity).map((target) => target.shortCode), ['102110']);
});

test('TIGER identity accepts an issuer-name alias only when target-bound short code and ISIN page agree', () => {
  const result = parseTigerProductHtml(HTML.replaceAll('TIGER 200', 'TIGER 코스피200'), 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7102110004');
  const validation = validateTigerRecord({ shortCode: '102110', isin: 'KR7102110004', name: 'TIGER 200' }, result);
  assert.equal(validation.pass, true);
  assert.equal(validation.complete, false);
  assert.match(validation.warnings[0], /alias\/conflict/);
  const wrongCode = validateTigerRecord({ shortCode: '999999', isin: 'KR7999990000', name: 'TIGER 코스피200' }, result);
  assert.equal(wrongCode.pass, false);
  assert.match(wrongCode.failures[0], /shortCode mismatch/);
});

test('TIGER identity tolerates the issuer page omitting the brand-name space', () => {
  const result = parseTigerProductHtml(HTML.replace('TIGER 200 (102110)', 'TIGER미국테크TOP10채권혼합(102110)'), 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7102110004');
  assert.equal(result.productName, 'TIGER 미국테크TOP10채권혼합');
  assert.equal(result.shortCode, '102110');
});
