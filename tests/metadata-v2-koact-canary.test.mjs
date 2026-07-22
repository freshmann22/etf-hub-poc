import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateKoactPolicy, reconcileKoactInventory, selectKoactCanaries, validateKoactProduct } from '../scripts/metadata-v2/collect-koact-canary.mjs';

test('KoAct policy opens only on ordinary TLS-backed policy responses without access challenge', () => {
  const allowed = evaluateKoactPolicy({
    robots: { ok: true, status: 200, challenge: false, body: 'User-agent: Yeti\nAllow:/' },
    homepage: { ok: true, status: 200, challenge: false, body: '<a>개인정보처리방침</a>' },
  });
  assert.equal(allowed.allowed, true);
  const blocked = evaluateKoactPolicy({
    robots: { ok: false, status: 429, challenge: true, body: 'cf-chl' },
    homepage: { ok: true, status: 200, challenge: false, body: '' },
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.circuitOpen, true);
});

test('KoAct inventory reconciliation maps by ticker and reports official-only additions', () => {
  const rows = [
    { brand: 'KoAct', universeOrdinal: 2, sourceRecord: { name: 'KoAct 해외' }, identifiers: { krxShortCodeCandidate: '000002' } },
    { brand: 'KoAct', universeOrdinal: 1, sourceRecord: { name: 'KoAct 국내' }, identifiers: { krxShortCodeCandidate: '000001' } },
  ];
  const etfs = [
    { stkTicker: '000001', fId: 'F1', fNm: 'KoAct 국내', typeLnm: '국내주식', listD: '20260101' },
    { stkTicker: '000002', fId: 'F2', fNm: 'KoAct 해외', typeLnm: '해외주식', listD: '20250101' },
    { stkTicker: '000003', fId: 'F3', fNm: 'KoAct 신규', typeLnm: '국내주식', listD: '20260701' },
  ];
  const result = reconcileKoactInventory(rows, etfs);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.officialOnly.map((item) => item.ticker), ['000003']);
});

test('KoAct canary selection is capped at four and product identity rejects cross-product payloads', () => {
  const reconciliation = { mappings: [
    { matched: true, universeOrdinal: 1, ticker: 'A', officialFId: 'F1', officialName: 'A', officialType: '해외주식', officialListingDate: '20240101' },
    { matched: true, universeOrdinal: 2, ticker: 'B', officialFId: 'F2', officialName: 'B', officialType: '국내주식', officialListingDate: '20250101' },
    { matched: true, universeOrdinal: 3, ticker: 'C', officialFId: 'F3', officialName: 'C', officialType: '혼합자산', officialListingDate: '20230101' },
    { matched: true, universeOrdinal: 4, ticker: 'D', officialFId: 'F4', officialName: 'D', officialType: '국내주식', officialListingDate: '20260101' },
    { matched: true, universeOrdinal: 5, ticker: 'E', officialFId: 'F5', officialName: 'E', officialType: '국내주식', officialListingDate: '20220101' },
  ] };
  const selected = selectKoactCanaries(reconciliation);
  assert.equal(selected.length, 4);
  assert.equal(validateKoactProduct({ info: { product: { fId: 'F1', stkTicker: 'A', fNm: 'A' } } }, selected[0]).valid, true);
  assert.equal(validateKoactProduct({ info: { product: { fId: 'WRONG', stkTicker: 'Z', fNm: 'Z' } } }, selected[0]).valid, false);
});

test('generated KoAct report never authorizes a full run from canary execution alone', () => {
  const report = JSON.parse(readFileSync(new URL('../data/reports/metadata-v2/koact-product-canary.json', import.meta.url), 'utf8'));
  assert.equal(report.issuer.inventoryCount, 23);
  assert.equal(report.probeContract.challengeBypassAttempted, false);
  assert.equal(report.probeContract.fullCollectionRequests, 0);
  assert.equal(report.decision.fullCollectionAllowed, false);
  assert.ok(report.probeContract.productDetailRequests <= 4);
  assert.ok(report.canary.results.every((item) => item.validation.identity.ticker === item.ticker && item.validation.identity.name === item.name));
});
