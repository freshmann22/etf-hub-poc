import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSolHoldingsPayload, SolPublicJsonProbe } from '../scripts/metadata-v2/providers/sol.mjs';

const domestic = JSON.parse(readFileSync(new URL('./fixtures/metadata-v2/sol-domestic-holdings.json', import.meta.url), 'utf8'));
const overseas = JSON.parse(readFileSync(new URL('./fixtures/metadata-v2/sol-overseas-holdings.json', import.meta.url), 'utf8'));

test('SOL parser normalizes domestic holdings and source date', () => {
  const parsed = parseSolHoldingsPayload(domestic, '455850');
  assert.equal(parsed.etfCode, '455850');
  assert.equal(parsed.asOfDate, '2026-07-21');
  assert.deepEqual(parsed.rows[0], {
    stockCode: '042700', stockName: '한미반도체', weight: 16.87, shares: 892,
    marketValue: 198024000, rank: 1, asOfDate: '2026-07-21',
  });
});

test('SOL parser preserves overseas ISIN-like asset codes', () => {
  const parsed = parseSolHoldingsPayload(overseas, '433330');
  assert.equal(parsed.rows[0].stockCode, 'US67066G1040');
  assert.equal(parsed.rows[1].weight, 7.65);
});

test('SOL parser rejects a cross-product payload', () => {
  assert.throws(() => parseSolHoldingsPayload(domestic, '433330'), /code mismatch/);
});

test('SOL probe uses only the approved endpoint and common result contract', async () => {
  const source = {
    sourceId: 'issuer_sol', issuer: 'SOL', officialUrl: 'https://www.soletf.com/',
    executionPolicy: 'network_opt_in', termsStatus: 'verified',
  };
  let requestedUrl = null;
  const probe = new SolPublicJsonProbe(source, {
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, text: async () => JSON.stringify(domestic) };
    },
  });
  const result = await probe.probe(
    { etfCode: '455850', providerKey: '210980', name: 'SOL AI반도체소부장', strata: ['domestic'] },
    { workDate: '20260721' },
  );
  assert.match(requestedUrl, /^https:\/\/www\.soletf\.com\/api\/fund\/pdfList\?/);
  assert.equal(result.status, 'ok');
  assert.equal(result.fields.identity, true);
  assert.equal(result.fields.holdings, true);
  assert.equal(result.rowCount, 2);
});
