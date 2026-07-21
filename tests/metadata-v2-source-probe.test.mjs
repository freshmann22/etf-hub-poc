import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProbeConfig, PROBE_STATUS } from '../scripts/metadata-v2/providers/contract.mjs';
import { ExistingIssuerHoldingsProbe } from '../scripts/metadata-v2/providers/existing-issuer-holdings.mjs';
import { reportToCsv, runProbe } from '../scripts/metadata-v2/probe-sources.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('../config/metadata-source-probe.json', import.meta.url), 'utf8'));

test('metadata-v2 probe config contains a valid 20-30 ETF stratified sample', () => {
  assert.equal(validateProbeConfig(CONFIG), CONFIG);
  assert.equal(CONFIG.canaries.length, 24);
  assert.ok(new Set(CONFIG.canaries.flatMap((canary) => canary.strata)).size >= 10);
});

test('offline probe never calls a network-backed provider and blocks pending sources', async () => {
  const report = await runProbe(CONFIG, { network: false });
  assert.equal(report.networkRequestCount, 0);
  assert.equal(report.results.filter((row) => row.status === PROBE_STATUS.NOT_RUN).length, 12);
  assert.equal(report.results.filter((row) => row.status === PROBE_STATUS.BLOCKED_PENDING_TERMS).length, 12);
});

test('existing issuer wrapper maps the holdings envelope into the common contract', async () => {
  const source = CONFIG.sources.find((item) => item.sourceId === 'issuer_kodex');
  const probe = new ExistingIssuerHoldingsProbe(source, {
    providerFactory: () => ({
      getEtfHoldings: async () => ({
        data: [{ stockCode: '005930', stockName: '삼성전자', weight: 25, asOfDate: '2026-07-20' }],
        meta: { source: 'issuer_kodex', status: 'ok', asOfDate: '2026-07-20T00:00:00+09:00' },
      }),
    }),
  });
  const result = await probe.probe(CONFIG.canaries[0]);
  assert.equal(result.status, PROBE_STATUS.OK);
  assert.equal(result.fields.holdings, true);
  assert.equal(result.rowCount, 1);
  assert.equal(result.fields.benchmark, false);
});

test('existing issuer wrapper rejects a cross-issuer fallback as a failed probe', async () => {
  const source = CONFIG.sources.find((item) => item.sourceId === 'issuer_tiger');
  const probe = new ExistingIssuerHoldingsProbe(source, {
    providerFactory: () => ({
      getEtfHoldings: async () => ({ data: [{ stockName: 'x' }], meta: { source: 'issuer_kodex', status: 'ok' } }),
    }),
  });
  const result = await probe.probe(CONFIG.canaries[4]);
  assert.equal(result.status, PROBE_STATUS.FAILED);
  assert.match(result.error, /issuer mismatch/);
});

test('CSV report exposes every common metadata field', async () => {
  const report = await runProbe(CONFIG, { network: false });
  const csv = reportToCsv(report);
  assert.match(csv.split('\n')[0], /benchmark,descriptions,holdings,sectorWeights,countryWeights/);
  assert.equal(csv.trim().split('\n').length, CONFIG.canaries.length + 1);
});
