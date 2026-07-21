import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HostLimitedHttpClient } from './collect-official-holdings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUS_PATHS = Object.freeze({
  inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  rawDiscoveryRoot: resolve(ROOT, 'data/raw/metadata-v2/plus-product/discovery'),
  discoveryReport: resolve(ROOT, 'data/reports/metadata-v2/plus-collection.discovery.json'),
});
const LIST_URL = 'https://www.plusetf.co.kr/api/v1/product/find/list';

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export function buildPlusInventory(inventory) {
  return inventory.rows.filter((row) => row.issuer?.id === 'hanwha-asset-management').map((row) => ({
    issuerId: row.issuer.id,
    shortCode: normalizeTicker(row.identifiers?.krxShortCodeCandidate),
    isin: row.identifiers?.isinCandidate || null,
    name: row.sourceRecord?.name || null,
  })).filter((row) => row.shortCode && row.name);
}

export function parsePlusDiscoveryPage(body) {
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed.content)) throw new Error('PLUS discovery response has no content array');
  const rows = parsed.content.map((item) => ({
    productId: String(item.id || '').trim(),
    shortCode: normalizeTicker(item.nameCode),
    name: String(item.displayName || '').trim(),
    benchmarkHint: String(item.basicInfo || '').trim() || null,
    factsheetHref: item.fileInfo?.download && item.fileInfo?.flNm ? new URL(`${item.fileInfo.download}${item.fileInfo.flNm}`, LIST_URL).href : null,
  })).filter((row) => /^\d{6}$/.test(row.productId) && row.shortCode && row.name);
  return {
    rows,
    page: Number(parsed.number ?? parsed.pageable?.pageNumber ?? 0),
    totalPages: Number(parsed.totalPages ?? 1),
    totalElements: Number(parsed.totalElements ?? rows.length),
    last: Boolean(parsed.last ?? true),
  };
}

function normalizeTicker(value) {
  const ticker = String(value || '').trim().toUpperCase();
  return /^A[0-9A-Z]{6}$/.test(ticker) ? ticker.slice(1) : ticker;
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣&]/g, '').toLowerCase();
}

function persistRawPage(root, page, body, retrievedAt) {
  const hash = createHash('sha256').update(body).digest('hex');
  const folder = resolve(root, retrievedAt.slice(0, 10));
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `page-${page}.${hash.slice(0, 16)}.json`);
  if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' });
  return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body) };
}

export function reconcilePlusDiscovery(inventoryRows, discoveredRows) {
  const byTicker = new Map();
  const duplicates = [];
  for (const row of discoveredRows) {
    if (byTicker.has(row.shortCode)) duplicates.push(row.shortCode);
    else byTicker.set(row.shortCode, row);
  }
  const mappings = inventoryRows.map((target) => {
    const source = byTicker.get(target.shortCode) || null;
    return {
      ...target,
      productId: source?.productId || null,
      sourceName: source?.name || null,
      nameMatches: source ? normalizeName(source.name) === normalizeName(target.name) : null,
      benchmarkHint: source?.benchmarkHint || null,
      factsheetHref: source?.factsheetHref || null,
      productUrl: source ? `https://www.plusetf.co.kr/product/detail?n=${source.productId}` : null,
      status: source ? 'mapped' : 'missing',
    };
  });
  const inventoryCodes = new Set(inventoryRows.map((row) => row.shortCode));
  const mappedCount = mappings.filter((row) => row.status === 'mapped').length;
  return {
    mappings,
    duplicateSourceTickers: [...new Set(duplicates)].sort(),
    sourceOnly: discoveredRows.filter((row) => !inventoryCodes.has(row.shortCode)),
    metrics: {
      inventoryCount: inventoryRows.length,
      discoveredCount: discoveredRows.length,
      mappedCount,
      missingCount: inventoryRows.length - mappedCount,
      coverageRatio: Number((mappedCount / inventoryRows.length).toFixed(6)),
      exactNameMatchCount: mappings.filter((row) => row.nameMatches).length,
    },
  };
}

export async function discoverPlusProducts({ paths = PLUS_PATHS, client = new HostLimitedHttpClient({ intervalMs: 1200 }), persist = true } = {}) {
  const inventory = buildPlusInventory(readJson(paths.inventory));
  if (inventory.length !== 84) throw new Error(`PLUS inventory guard expected 84, found ${inventory.length}`);
  const allRows = [];
  const rawPages = [];
  let page = 0;
  let totalPages = 1;
  do {
    const response = await client.request(LIST_URL, {
      method: 'POST', timeoutMs: 30000,
      headers: { 'content-type': 'application/json', accept: 'application/json', origin: 'https://www.plusetf.co.kr', referer: 'https://www.plusetf.co.kr/product/find' },
      body: JSON.stringify({ searchSortTy: null, searchSort: 'DESC', page, searchAnnuityOptionTy: null, searchWord: '' }),
    });
    const retrievedAt = new Date().toISOString();
    const parsed = parsePlusDiscoveryPage(response.body);
    if (parsed.totalPages < 1 || parsed.totalPages > 50) throw new Error(`unsafe PLUS discovery page count ${parsed.totalPages}`);
    totalPages = parsed.totalPages;
    allRows.push(...parsed.rows);
    if (persist) rawPages.push({ page, ...persistRawPage(paths.rawDiscoveryRoot, page, response.body, retrievedAt), retrievedAt });
    page += 1;
  } while (page < totalPages);

  const uniqueRows = [...new Map(allRows.map((row) => [`${row.shortCode}:${row.productId}`, row])).values()];
  const reconciliation = reconcilePlusDiscovery(inventory, uniqueRows);
  const report = {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(),
    contract: {
      source: LIST_URL, method: 'POST', sameOriginPublicEndpoint: true, intervalMs: 1200,
      authenticationUsed: false, bypassUsed: false, pagesRequested: page,
      requestBody: { searchSortTy: null, searchSort: 'DESC', page: '{0..totalPages-1}', searchAnnuityOptionTy: null, searchWord: '' },
    },
    rawPages,
    ...reconciliation,
    scaleDecision: reconciliation.metrics.coverageRatio >= 0.95 && reconciliation.duplicateSourceTickers.length === 0
      ? 'mapping_threshold_passed' : 'full_collection_blocked_mapping_coverage',
  };
  if (persist) {
    mkdirSync(dirname(paths.discoveryReport), { recursive: true });
    writeFileSync(paths.discoveryReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  discoverPlusProducts().then((report) => console.log(JSON.stringify({ report: PLUS_PATHS.discoveryReport, metrics: report.metrics, scaleDecision: report.scaleDecision }, null, 2)))
    .catch((error) => { console.error(`[plus-discovery] ${error.message}`); process.exitCode = 1; });
}
