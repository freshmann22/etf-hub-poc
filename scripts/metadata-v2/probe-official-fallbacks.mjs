import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDartViewerContract, summarizeOfficialProductHtml } from './providers/official-product-html.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = resolve(ROOT, 'data/reports/metadata-v2/official-fallback-probe.json');
const MAX_REQUESTS = 8;
const CANARIES = [
  { etfCode: '0193W0', name: 'KODEX 삼성전자단일종목레버리지', issuer: 'samsung-asset-management', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFV5', discovery: 'official product-list search by ticker then fId' },
  { etfCode: '0193T0', name: 'KODEX SK하이닉스단일종목레버리지', issuer: 'samsung-asset-management', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFV6', discovery: 'official product-list search by ticker then fId' },
  { etfCode: '0192M0', name: 'RISE 삼성전자단일종목레버리지', issuer: 'kb-asset-management', url: 'https://riseetf.co.kr/prod/finderDetail/44K5', discovery: 'official site product finder result' },
  { etfCode: '0192L0', name: 'RISE SK하이닉스단일종목레버리지', issuer: 'kb-asset-management', url: 'https://riseetf.co.kr/prod/finderDetail/44K6', discovery: 'official site product finder result' },
  { etfCode: '0198A0', name: 'KIWOOM 코스닥150커버드콜액티브', issuer: 'kiwoom-asset-management', url: 'https://www.kiwoometf.com/service/etf/KO02010200M?gcode=0198A0', discovery: 'documented public product URL with gcode ticker' },
  { etfCode: '0207Z0', name: 'KIWOOM 미국우주데이터센터인프라', issuer: 'kiwoom-asset-management', url: 'https://www.kiwoometf.com/service/etf/KO02010200M?gcode=0207Z0', discovery: 'documented public product URL with gcode ticker' },
];

async function fetchProbe(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 metadata-source-probe/1.0', accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
    const html = await response.text();
    return { ok: response.ok, status: response.status, bytes: Buffer.byteLength(html), html };
  } catch (error) {
    return { ok: false, status: null, bytes: 0, html: '', errorClass: error.name || 'Error', errorCode: error.cause?.code || null };
  }
}

async function main() {
  let requests = 0;
  const rows = [];
  for (const canary of CANARIES) {
    requests += 1;
    const result = await fetchProbe(canary.url);
    const summary = result.ok ? summarizeOfficialProductHtml(result.html, canary.name) : null;
    rows.push({
      ...canary,
      access: { ok: result.ok, httpStatus: result.status, responseBytes: result.bytes, errorClass: result.errorClass || null, errorCode: result.errorCode || null },
      extractionSignals: summary,
      recommendation: result.ok && summary?.expectedProductVisible ? 'candidate_for_issuer_adapter' : result.status === 429 ? 'public_ui_only_rate_limited_do_not_scrape' : 'public_ui_visible_but_runtime_adapter_not_proven',
    });
  }
  requests += 1;
  const dartUrl = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260514000101';
  const dart = await fetchProbe(dartUrl);
  const dartContract = dart.ok ? parseDartViewerContract(dart.html) : null;
  requests += 1;
  const kofia = await fetchProbe('https://dis.kofia.or.kr/');
  if (requests > MAX_REQUESTS) throw new Error('official fallback request budget exceeded');

  const accessibleRows = rows.filter((row) => row.access.ok && row.extractionSignals?.expectedProductVisible);
  const output = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    probeContract: {
      scope: '6 issuer-product canaries plus one DART viewer and KOFIA landing page',
      maxRequests: MAX_REQUESTS,
      actualRequests: requests,
      authenticationUsed: false,
      securityBypassUsed: false,
      rawResponsesStored: false,
    },
    metrics: {
      canaryCount: rows.length,
      programmaticallyAccessibleProductCount: accessibleRows.length,
      programmaticallyAccessibleProductRatio: Number((accessibleRows.length / rows.length).toFixed(6)),
      allTargetFieldSignalsCount: accessibleRows.filter((row) => Object.values(row.extractionSignals.fieldSignals).every(Boolean)).length,
    },
    dartViewer: {
      url: dartUrl,
      access: { ok: dart.ok, httpStatus: dart.status, responseBytes: dart.bytes },
      contract: dartContract,
      decision: dartContract?.substantiveBodyAdvertised || dartContract?.publicAttachmentLinkCount ? 'investigate_public_viewer_contract' : 'no_substantive_body_or_public_attachment_contract',
    },
    kofia: {
      url: 'https://dis.kofia.or.kr/',
      access: { ok: kofia.ok, httpStatus: kofia.status, responseBytes: kofia.bytes },
      documentedBulkApiFound: false,
      decision: 'manual_public_document_discovery_only_until_KOFIA_documents_or_permission_contract_is_identified',
    },
    sourceMatrix: [
      { source: 'DART document.xml', identity: 'yes', objectiveBenchmarkDistribution: 'no_cover_only', automation: 'official_API', priority: 1 },
      { source: 'DART public viewer', identity: 'yes', objectiveBenchmarkDistribution: 'no_for_tested_filing', automation: 'no_attachment_contract_exposed', priority: 4 },
      { source: 'Issuer official product HTML', identity: 'yes', objectiveBenchmarkDistribution: 'varies_by_issuer_but_complete_for_RISE_canaries', automation: 'issuer_specific_adapter_and_rate_policy_required', priority: 2 },
      { source: 'Issuer official factsheet/prospectus PDF', identity: 'yes', objectiveBenchmarkDistribution: 'generally_yes', automation: 'prefer_public_download_links_discovered_from_product_page', priority: 1 },
      { source: 'KOFIA disclosure UI', identity: 'yes', objectiveBenchmarkDistribution: 'documents_expected', automation: 'no_documented_bulk_API_confirmed', priority: 3 }
    ],
    scaleDecision: {
      readyForSingleGenericAdapter: false,
      readyForIssuerAdapters: ['kb-asset-management'],
      nextPriority: [
        'Implement RISE official HTML/PDF adapter with conservative section provenance.',
        'Use KODEX documented/public product list only for discovery; respect 429 and do not scrape product HTML.',
        'Resolve KIWOOM runtime TLS/connectivity before adapter work; public URL contract itself is ticker-based.',
        'Use official factsheet/prospectus download links where exposed; do not automate KOFIA UI without a documented contract or permission.'
      ]
    },
    canaries: rows,
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT, metrics: output.metrics, dartViewer: output.dartViewer, scaleDecision: output.scaleDecision }, null, 2));
}

main().catch((error) => {
  console.error(`[metadata-v2:official-fallback-probe] ${error.message}`);
  process.exitCode = 1;
});
