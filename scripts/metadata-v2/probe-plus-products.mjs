import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlusProductHtml } from './providers/plus-product-html.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = resolve(ROOT, 'data/reports/metadata-v2/plus-product-canary.json');
const BASE_URL = 'https://www.plusetf.co.kr/product/detail?n=';
const CANARIES = [
  { ticker: '161510', name: 'PLUS 고배당주', productId: '006273' },
  { ticker: '251600', name: 'PLUS 고배당주채권혼합', productId: '006298' },
  { ticker: '152100', name: 'PLUS 200', productId: '006184' },
  { ticker: '457990', name: 'PLUS 태양광&ESS', productId: '006279' },
];

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'metadata-local-poc/1.0', accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, bytes: Buffer.byteLength(html), html };
  } catch (error) {
    return { ok: false, status: null, bytes: 0, html: '', errorClass: error.name, errorCode: error.cause?.code || null };
  }
}

async function main() {
  const rows = [];
  for (const canary of CANARIES) {
    const url = `${BASE_URL}${canary.productId}`;
    const response = await fetchHtml(url);
    rows.push({
      ...canary,
      url,
      access: { ok: response.ok, httpStatus: response.status, responseBytes: response.bytes, errorClass: response.errorClass || null, errorCode: response.errorCode || null },
      extraction: response.ok ? parsePlusProductHtml(response.html, { expectedName: canary.name, expectedTicker: canary.ticker, sourceUrl: url }) : null,
    });
  }
  const successful = rows.filter((row) => row.extraction?.complete);
  const output = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    probeContract: {
      issuer: 'hanwha-asset-management',
      brand: 'PLUS',
      scope: 'four public product-detail canaries; local-only metadata PoC',
      actualProductRequests: rows.length,
      authenticationUsed: false,
      bypassUsed: false,
      rawResponsesStored: false,
    },
    policyAudit: {
      decision: 'allow_local_only_poc',
      checkedAt: new Date().toISOString(),
      robotsUrl: 'https://www.plusetf.co.kr/robots.txt',
      robotsObserved: 'User-agent: * / Allow: /',
      legalNoticeUrl: 'https://www.plusetf.co.kr/',
      legalNoticeObserved: 'site materials are owned by Hanwha Asset Management; no automated-access prohibition was displayed',
      guardrails: ['public product detail pages only', 'low fixed request count', 'no login or bypass', 'do not republish raw HTML or documents'],
      blockedAlternatives: [
        { issuer: 'korea-investment-management', brand: 'ACE', productRequests: 0, reason: 'terms body not observable in server response; permission unclear' },
        { issuer: 'nh-amundi-asset-management', brand: 'HANARO', productRequests: 0, reason: 'terms restrict reproduction/distribution/commercial use without prior consent' },
      ],
    },
    discoveryContract: {
      productUrlPattern: `${BASE_URL}{internalProductId}`,
      tickerIsNotProductId: true,
      scaleBlocker: 'a documented or page-derived ticker-to-internalProductId discovery mapping is required before universe expansion',
    },
    metrics: {
      canaryCount: rows.length,
      httpSuccessCount: rows.filter((row) => row.access.ok).length,
      completeExtractionCount: successful.length,
      completeExtractionRatio: Number((successful.length / rows.length).toFixed(6)),
    },
    rows,
    decision: successful.length === rows.length ? 'issuer_parser_ready_discovery_mapping_required' : 'parser_not_ready',
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT, metrics: output.metrics, decision: output.decision }, null, 2));
}

main().catch((error) => {
  console.error(`[metadata-v2:plus-product-probe] ${error.message}`);
  process.exitCode = 1;
});
