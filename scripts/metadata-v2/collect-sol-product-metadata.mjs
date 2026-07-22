import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { SolProductAdapter } from './providers/sol-product.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SOL_PRODUCT_PATHS = Object.freeze({
  inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  rawRoot: resolve(ROOT, 'data/raw/metadata-v2/sol-product'),
  ledger: resolve(ROOT, 'data/raw/metadata-v2/sol-product/ledger.jsonl'),
  discovery: resolve(ROOT, 'data/reports/metadata-v2/sol-product-discovery.json'),
  canary: resolve(ROOT, 'data/reports/metadata-v2/sol-product-canary.json'),
  collection: resolve(ROOT, 'data/reports/metadata-v2/sol-product-collection.json'),
  csv: resolve(ROOT, 'data/reports/metadata-v2/sol-product-collection.csv'),
});
const CANARY_CODES = new Set(['0005D0', '220130', '292500', '433330']);
const TARGET_FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];
const OPTIONAL_FIELDS = ['officialDocumentLinks'];

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function appendLedger(path, entry) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8'); }
function latestByCode(entries) { const map = new Map(); for (const entry of entries) map.set(entry.shortCode, entry); return map; }
function normalizeName(value) { return String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣&]/g, '').toLowerCase(); }

export function buildSolInventory(inventory) {
  return inventory.rows.filter((row) => row.issuer?.id === 'shinhan-asset-management').map((row) => ({
    issuerId: row.issuer.id, shortCode: row.identifiers?.krxShortCodeCandidate,
    isin: row.identifiers?.isinCandidate || null, name: row.sourceRecord?.name || null,
  })).filter((row) => row.shortCode && row.name);
}

export function reconcileSolProducts(inventory, discovered) {
  const byCode = new Map(discovered.map((row) => [row.shortCode, row]));
  const mappings = inventory.map((target) => {
    const source = byCode.get(target.shortCode);
    return { ...target, productId: source?.productId || null, sourceName: source?.name || null, productUrl: source?.productUrl || null, nameMatches: source ? normalizeName(source.name) === normalizeName(target.name) : null, status: source ? 'mapped' : 'missing' };
  });
  const mappedCount = mappings.filter((row) => row.status === 'mapped').length;
  return { mappings, metrics: { inventoryCount: inventory.length, discoveredCount: discovered.length, mappedCount, missingCount: inventory.length - mappedCount, coverageRatio: Number((mappedCount / inventory.length).toFixed(6)), exactNameMatchCount: mappings.filter((row) => row.nameMatches).length } };
}

function persistRaw(paths, role, key, body, retrievedAt, extension = 'html') {
  const hash = createHash('sha256').update(body).digest('hex');
  const folder = resolve(paths.rawRoot, role, retrievedAt.slice(0, 10), key);
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `${retrievedAt.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.${extension}`);
  if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' });
  return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body) };
}

function validate(target, parsed, rawHash) {
  const identityFailures = [];
  if (!parsed.identity.expectedNameMatches) identityFailures.push(`name mismatch: ${parsed.identity.productName} != ${target.sourceName}`);
  if (!parsed.identity.expectedTickerMatches) identityFailures.push(`ticker mismatch: ${parsed.identity.shortCode} != ${target.shortCode}`);
  const metadata = {
    productDescription: parsed.description, investmentObjective: parsed.investmentObjective,
    benchmarkName: parsed.benchmark.name, benchmarkDescription: parsed.benchmark.description,
    distributionPolicy: parsed.distributionPolicy,
    officialDocumentLinks: parsed.officialDocumentLinks.map((link) => link.href),
  };
  const fieldCoverage = Object.fromEntries([...TARGET_FIELDS, ...OPTIONAL_FIELDS].map((field) => [field, field === 'officialDocumentLinks' ? metadata[field].length > 0 : Boolean(metadata[field])]));
  const provenance = {
    productDescription: metadata.productDescription ? { selector: '.fv-des', snippet: metadata.productDescription, rawHash } : null,
    investmentObjective: metadata.investmentObjective ? { selector: '.fv-des', snippet: metadata.investmentObjective, rawHash } : null,
    benchmarkName: metadata.benchmarkName ? { selector: '.g-conts dt', snippet: metadata.benchmarkName, rawHash } : null,
    benchmarkDescription: metadata.benchmarkDescription ? { selector: '.g-conts dd', snippet: metadata.benchmarkDescription, rawHash } : null,
    distributionPolicy: metadata.distributionPolicy ? { selector: 'dl.def:has(dt)', snippet: metadata.distributionPolicy, rawHash } : null,
    officialDocumentLinks: parsed.officialDocumentLinks.map((link) => ({ selector: 'a[href*="/api/etf/pds/down/policyDescription/"]', snippet: link.label, href: link.href, rawHash })),
  };
  for (const field of [...TARGET_FIELDS, ...OPTIONAL_FIELDS]) {
    if (!fieldCoverage[field]) continue;
    const item = provenance[field];
    const valid = Array.isArray(item) ? item.every((row) => row.rawHash && row.selector && row.snippet) : item?.rawHash && item?.selector && item?.snippet;
    if (!valid) identityFailures.push(`missing provenance ${field}`);
  }
  const populatedCount = TARGET_FIELDS.filter((field) => fieldCoverage[field]).length;
  return {
    pass: identityFailures.length === 0 && populatedCount > 0,
    failures: identityFailures,
    missingFields: [...TARGET_FIELDS, ...OPTIONAL_FIELDS].filter((field) => !fieldCoverage[field]),
    fieldCoverage, metadata, provenance,
  };
}

async function collectOne(adapter, paths, target) {
  const retrievedAt = new Date().toISOString();
  try {
    const result = await adapter.collect(target);
    const raw = { ...persistRaw(paths, 'pages', target.shortCode, result.raw.body, retrievedAt), url: result.raw.url };
    const validation = validate(target, result.parsed, raw.hash);
    const status = !validation.pass ? 'validation_failed' : validation.missingFields.length ? 'partial' : 'ok';
    return { retrievedAt, sourceId: adapter.sourceId, ...target, status, validation: { pass: validation.pass, failures: validation.failures, missingFields: validation.missingFields, fieldCoverage: validation.fieldCoverage }, metadata: validation.metadata, provenance: validation.provenance, raw };
  } catch (error) {
    const stopped = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError;
    return { retrievedAt, sourceId: adapter.sourceId, ...target, status: stopped ? 'source_stopped' : 'failed', validation: { pass: false, failures: [String(error.message || error)], missingFields: [...TARGET_FIELDS, ...OPTIONAL_FIELDS], fieldCoverage: {} }, metadata: null, provenance: null, raw: null };
  }
}

function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

function buildCollectionReport(discovery, ledger, canaryPass, fullRequested) {
  const targetCodes = new Set(discovery.mappings.filter((row) => row.status === 'mapped').map((row) => row.shortCode));
  const rows = [...latestByCode(ledger).values()].filter((entry) => targetCodes.has(entry.shortCode));
  const statusCounts = Object.fromEntries(['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'].map((status) => [status, rows.filter((row) => row.status === status).length]));
  const fields = [...TARGET_FIELDS, ...OPTIONAL_FIELDS];
  return {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(),
    contract: { intervalMs: 1200, authenticationUsed: false, bypassUsed: false, rawAppendOnly: true, resumableLedger: true },
    targetCount: discovery.metrics.inventoryCount, mappedCount: discovery.metrics.mappedCount, mappingCoverageRatio: discovery.metrics.coverageRatio,
    canaryPass, fullRequested, attemptedUniqueCount: rows.length,
    completedCount: statusCounts.ok + statusCounts.partial,
    pendingCount: discovery.metrics.inventoryCount - statusCounts.ok - statusCounts.partial,
    statusCounts,
    fieldCoverage: Object.fromEntries(fields.map((field) => [field, rows.filter((row) => row.validation?.fieldCoverage?.[field]).length])),
    health: { missingFieldCounts: Object.fromEntries(fields.map((field) => [field, rows.filter((row) => !row.validation?.fieldCoverage?.[field]).length])), partialCount: statusCounts.partial },
    rows,
  };
}

function writeCsv(path, report) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [['shortCode', 'name', 'productId', 'status', 'benchmarkName', 'distributionPolicy', 'rawHash'].join(','), ...report.rows.map((row) => [row.shortCode, row.name, row.productId, row.status, row.metadata?.benchmarkName, row.metadata?.distributionPolicy, row.raw?.hash].map(quote).join(','))];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export async function runSolProductCollection({ full = false, paths = SOL_PRODUCT_PATHS, adapter = null, onProgress = null } = {}) {
  const inventory = buildSolInventory(readJson(paths.inventory));
  if (inventory.length !== 77) throw new Error(`SOL inventory guard expected 77, found ${inventory.length}`);
  const productAdapter = adapter || new SolProductAdapter(new HostLimitedHttpClient({ intervalMs: 1200 }));
  const discoveryResult = await productAdapter.discover();
  const discoveryRaw = { ...persistRaw(paths, 'discovery', 'fund-list', discoveryResult.raw.body, new Date().toISOString()), url: discoveryResult.raw.url };
  const reconciliation = reconcileSolProducts(inventory, discoveryResult.rows);
  const discovery = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), source: discoveryResult.raw.url, raw: discoveryRaw, ...reconciliation, scaleDecision: reconciliation.metrics.coverageRatio >= 0.95 ? 'mapping_threshold_passed' : 'full_collection_blocked_mapping_coverage' };
  writeJson(paths.discovery, discovery);
  const mapped = discovery.mappings.filter((row) => row.status === 'mapped');
  const canaries = mapped.filter((row) => CANARY_CODES.has(row.shortCode));
  let latest = latestByCode(readLedger(paths.ledger));
  if (discovery.metrics.coverageRatio >= 0.95 && canaries.length === 4) {
    for (const target of canaries) {
      let entry = latest.get(target.shortCode);
      if (!entry || !['ok', 'partial'].includes(entry.status)) {
        entry = await collectOne(productAdapter, paths, target); appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry);
      }
      if (entry.status === 'source_stopped') break;
    }
  }
  const canaryRows = canaries.flatMap((target) => latest.has(target.shortCode) ? [latest.get(target.shortCode)] : []);
  const canaryFieldCoverage = Object.fromEntries(TARGET_FIELDS.map((field) => [field, canaryRows.filter((row) => row.validation?.fieldCoverage?.[field]).length]));
  const canaryPass = canaryRows.length === 4 && canaryRows.every((row) => ['ok', 'partial'].includes(row.status)) && TARGET_FIELDS.every((field) => canaryFieldCoverage[field] === 4);
  const canaryReport = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), expectedCount: 4, attemptedCount: canaryRows.length, pass: canaryPass, fieldCoverage: canaryFieldCoverage, legacyNumericMetadataAccess: ['220130', '292500'].map((code) => ({ shortCode: code, status: latest.get(code)?.status || 'not_attempted' })), rows: canaryRows };
  writeJson(paths.canary, canaryReport);
  if (full && canaryPass) {
    for (const target of mapped) {
      if (['ok', 'partial'].includes(latest.get(target.shortCode)?.status)) continue;
      const entry = await collectOne(productAdapter, paths, target); appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry);
      if (entry.status === 'source_stopped') break;
    }
  }
  const report = buildCollectionReport(discovery, readLedger(paths.ledger), canaryPass, full);
  report.scaleDecision = discovery.metrics.coverageRatio < 0.95 ? 'full_collection_blocked_mapping_coverage' : !canaryPass ? 'full_collection_blocked_canary_failure' : full ? 'full_collection_executed' : 'approved_for_full';
  writeJson(paths.collection, report); writeCsv(paths.csv, report);
  return { discovery, canaryReport, report };
}

function parseArgs(argv) { if (argv.length > 1 || (argv[0] && !['--canary', '--full'].includes(argv[0]))) throw new Error('usage: node collect-sol-product-metadata.mjs [--canary|--full]'); return { full: argv[0] === '--full' }; }
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runSolProductCollection({ ...parseArgs(process.argv.slice(2)), onProgress: (entry) => console.log(`[sol-product] ${entry.shortCode} ${entry.status}`) })
    .then(({ discovery, canaryReport, report }) => console.log(`[sol-product] mapping=${discovery.metrics.mappedCount}/${discovery.metrics.inventoryCount} canary=${canaryReport.pass ? 'pass' : 'fail'} completed=${report.completedCount}/${report.targetCount}`))
    .catch((error) => { console.error(`[sol-product] ${error.message}`); process.exitCode = 1; });
}
