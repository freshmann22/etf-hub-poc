import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError, buildTargets, collectTargets, parseRetryAfter, readLedger,
} from '../scripts/metadata-v2/collect-official-holdings.mjs';

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', 30000, Date.parse('Wed, 21 Oct 2015 07:27:00 GMT')), 60000);
  assert.equal(parseRetryAfter('bad', 1234), 1234);
});

test('host limiter retries 429 and raises a persistent rate-limit error', async () => {
  let calls = 0;
  const client = new HostLimitedHttpClient({
    intervalMs: 1200, maxAttempts: 2, defaultCooldownMs: 0, sleepImpl: async () => {},
    fetchImpl: async () => { calls += 1; return { status: 429, ok: false, headers: { get: () => '0' }, text: async () => '' }; },
  });
  await assert.rejects(() => client.request('https://example.com/x'), PersistentRateLimitError);
  assert.equal(calls, 2);
});

test('host limiter identifies HTTP 403 as an access block', async () => {
  const client = new HostLimitedHttpClient({
    intervalMs: 1200, sleepImpl: async () => {},
    fetchImpl: async () => ({ status: 403, ok: false, headers: { get: () => null }, text: async () => '' }),
  });
  await assert.rejects(() => client.request('https://example.com/x'), AccessBlockedError);
});

test('target builder joins inventory to verified identity and limits issuers', () => {
  const inventory = { rows: [
    { brand: 'KODEX', issuer: { id: 'samsung-asset-management' }, identifiers: { krxShortCodeCandidate: '069500', isinCandidate: 'KR7069500007' }, sourceRecord: { name: 'KODEX 200' } },
    { brand: 'ACE', issuer: { id: 'korea-investment-management' }, identifiers: { krxShortCodeCandidate: '000000' }, sourceRecord: { name: 'ACE X' } },
  ] };
  const identity = { records: [{ status: 'resolved', identity: { shortCode: '069500', isin: 'KR7069500007', officialName: 'KODEX 200' } }] };
  const targets = buildTargets(inventory, identity);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].shortCode, '069500');
});

test('collector isolates item errors, writes append-only raw, and resumes successes', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'etf-holdings-'));
  const paths = { rawRoot: resolve(folder, 'raw'), ledger: resolve(folder, 'ledger.jsonl') };
  let calls = 0;
  const adapter = {
    sourceId: 'issuer_kodex',
    collect: async (target) => {
      calls += 1;
      if (target.shortCode === '000002') throw new Error('one item failed');
      return { rows: [{ stockName: 'x' }], declaredCount: 1, asOfDate: '20260721', rawArtifacts: [{ url: 'https://example.com', role: 'holdings', body: '{"x":1}', contentType: 'application/json' }] };
    },
  };
  const targets = ['000001', '000002'].map((shortCode) => ({ issuerId: 'samsung-asset-management', shortCode, isin: null, name: shortCode }));
  const adapters = new Map([['samsung-asset-management', adapter]]);
  const first = await collectTargets({ targets, adapters, paths });
  assert.deepEqual(first.runEntries.map((entry) => entry.status), ['ok', 'failed']);
  assert.equal(first.runEntries[0].rawArtifacts.length, 1);
  assert.equal(readFileSync(first.runEntries[0].rawArtifacts[0].path, 'utf8'), '{"x":1}');
  await collectTargets({ targets, adapters, paths });
  assert.equal(calls, 3, 'successful item is skipped; failed item is retried');
  assert.equal(readLedger(paths.ledger).length, 3);
});

test('persistent 429 stops only that source and preserves other issuers', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'etf-holdings-rate-'));
  const paths = { rawRoot: resolve(folder, 'raw'), ledger: resolve(folder, 'ledger.jsonl') };
  const stopped = { sourceId: 'issuer_kodex', collect: async () => { throw new PersistentRateLimitError('www.samsungfund.com', 30000); } };
  const healthy = { sourceId: 'issuer_sol', collect: async () => ({ rows: [{ stockName: 'x' }], declaredCount: 1, rawArtifacts: [] }) };
  const targets = [
    { issuerId: 'samsung-asset-management', shortCode: '000001' },
    { issuerId: 'samsung-asset-management', shortCode: '000002' },
    { issuerId: 'shinhan-asset-management', shortCode: '000003' },
  ];
  const result = await collectTargets({ targets, adapters: new Map([
    ['samsung-asset-management', stopped], ['shinhan-asset-management', healthy],
  ]), paths });
  assert.deepEqual(result.runEntries.map((entry) => entry.status), ['rate_limited_stopped', 'ok']);
  assert.deepEqual(result.stoppedSources, ['issuer_kodex']);
});

test('HTTP access block stops only that source after its first blocked item', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'etf-holdings-block-'));
  const paths = { rawRoot: resolve(folder, 'raw'), ledger: resolve(folder, 'ledger.jsonl') };
  let blockedCalls = 0;
  const blocked = { sourceId: 'issuer_sol', collect: async () => { blockedCalls += 1; throw new AccessBlockedError('www.soletf.com'); } };
  const healthy = { sourceId: 'issuer_tiger', collect: async () => ({ rows: [{ stockName: 'x' }], declaredCount: 1, rawArtifacts: [] }) };
  const targets = [
    { issuerId: 'shinhan-asset-management', shortCode: '000001' },
    { issuerId: 'shinhan-asset-management', shortCode: '000002' },
    { issuerId: 'mirae-asset-global-investments', shortCode: '000003' },
  ];
  const result = await collectTargets({ targets, adapters: new Map([
    ['shinhan-asset-management', blocked], ['mirae-asset-global-investments', healthy],
  ]), paths });
  assert.deepEqual(result.runEntries.map((entry) => entry.status), ['access_blocked_stopped', 'ok']);
  assert.equal(blockedCalls, 1);
  assert.deepEqual(result.stoppedSources, ['issuer_sol']);
});
