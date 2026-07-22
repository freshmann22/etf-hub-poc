import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { parsePlusProductHtml } from './providers/plus-product-html.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUS_COLLECTION_PATHS = Object.freeze({
  discovery: resolve(ROOT, 'data/reports/metadata-v2/plus-collection.discovery.json'),
  rawRoot: resolve(ROOT, 'data/raw/metadata-v2/plus-product/pages'),
  ledger: resolve(ROOT, 'data/raw/metadata-v2/plus-product/ledger.jsonl'),
  report: resolve(ROOT, 'data/reports/metadata-v2/plus-collection.json'),
  csv: resolve(ROOT, 'data/reports/metadata-v2/plus-collection.csv'),
});
const CANARY_CODES = new Set(['161510', '251600', '152100', '457990']);

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
function appendLedger(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
}
function latestByCode(entries) {
  const map = new Map();
  for (const entry of entries) map.set(entry.shortCode, entry);
  return map;
}

function persistRaw(paths, target, body, retrievedAt) {
  const hash = createHash('sha256').update(body).digest('hex');
  const folder = resolve(paths.rawRoot, retrievedAt.slice(0, 10), target.shortCode);
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `${retrievedAt.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.html`);
  if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' });
  return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body), url: target.productUrl };
}

function validate(target, parsed, rawHash) {
  const failures = [];
  if (!parsed.identity.tickerVisible) failures.push('ticker not visible');
  if (!parsed.identity.expectedNameMatches) failures.push(`name mismatch: ${parsed.identity.productName} != ${target.sourceName}`);
  const fieldCoverage = {
    productDescription: Boolean(parsed.description),
    investmentObjective: Boolean(parsed.investmentObjective),
    benchmarkName: Boolean(parsed.benchmark.name),
    benchmarkDescription: Boolean(parsed.benchmark.description),
    benchmarkProvider: Boolean(parsed.benchmark.provider),
    distributionPolicy: Boolean(parsed.distributionPolicy),
    officialDocumentLinks: parsed.prospectusLinks.length > 0,
  };
  const coreFields = ['productDescription', 'investmentObjective', 'benchmarkName', 'distributionPolicy'];
  const optionalFields = ['benchmarkDescription', 'benchmarkProvider', 'officialDocumentLinks'];
  for (const field of coreFields) if (!fieldCoverage[field]) failures.push(`missing core field ${field}`);
  const provenance = {
    productDescription: { selector: '.summary__investment-list', snippet: parsed.evidence.description.join('; '), rawHash },
    investmentObjective: { selector: '.summary__investment-list', snippet: parsed.evidence.description.join('; '), rawHash },
    benchmarkName: { selector: '.sub-pages__basic-index-title', snippet: parsed.benchmark.name, rawHash },
    benchmarkDescription: { selector: '.sub-pages__basic-index-desc', snippet: parsed.benchmark.description, rawHash },
    benchmarkProvider: { selector: '.sub-pages__basic-index-organization', snippet: parsed.benchmark.provider, rawHash },
    distributionPolicy: {
      selector: parsed.distributionPolicySource === 'investment-point-reinvestment' ? '.summary__investment-list' : '.sub-pages__devidend-help',
      snippet: parsed.distributionPolicy, rawHash,
    },
    officialDocumentLinks: parsed.prospectusLinks.map((link) => ({ selector: 'a[href$=".pdf"]', snippet: link.label, href: link.href, rawHash })),
  };
  for (const field of coreFields) {
    if (!provenance[field]?.rawHash || !provenance[field]?.selector || !provenance[field]?.snippet) failures.push(`missing provenance ${field}`);
  }
  return {
    pass: failures.length === 0, failures, fieldCoverage, provenance,
    missingFields: [...coreFields, ...optionalFields].filter((field) => !fieldCoverage[field]),
  };
}

async function collectOne(client, paths, target) {
  const retrievedAt = new Date().toISOString();
  try {
    const response = await client.request(target.productUrl, { timeoutMs: 30000, headers: { accept: 'text/html', referer: 'https://www.plusetf.co.kr/product/find' } });
    const raw = persistRaw(paths, target, response.body, retrievedAt);
    const parsed = parsePlusProductHtml(response.body, { expectedName: target.sourceName, expectedTicker: target.shortCode, sourceUrl: target.productUrl });
    const validation = validate(target, parsed, raw.hash);
    return {
      retrievedAt, sourceId: 'plus_official_product_html', issuerId: target.issuerId,
      shortCode: target.shortCode, isin: target.isin, name: target.name, sourceName: target.sourceName,
      productId: target.productId, status: validation.pass ? (validation.missingFields.length ? 'partial' : 'ok') : 'validation_failed', validation,
      metadata: {
        productDescription: parsed.description,
        investmentObjective: parsed.investmentObjective,
        benchmarkName: parsed.benchmark.name,
        benchmarkDescription: parsed.benchmark.description,
        benchmarkProvider: parsed.benchmark.provider,
        distributionPolicy: parsed.distributionPolicy,
        officialDocumentLinks: parsed.prospectusLinks.map((link) => link.href),
      },
      provenance: validation.provenance,
      raw,
    };
  } catch (error) {
    const stopped = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError;
    return {
      retrievedAt, sourceId: 'plus_official_product_html', issuerId: target.issuerId,
      shortCode: target.shortCode, isin: target.isin, name: target.name, sourceName: target.sourceName,
      productId: target.productId, status: stopped ? 'source_stopped' : 'failed',
      validation: { pass: false, failures: [String(error.message || error)], fieldCoverage: {} },
      metadata: null, provenance: null, raw: null,
    };
  }
}

function metadataFromParsed(parsed) {
  return {
    productDescription: parsed.description,
    investmentObjective: parsed.investmentObjective,
    benchmarkName: parsed.benchmark.name,
    benchmarkDescription: parsed.benchmark.description,
    benchmarkProvider: parsed.benchmark.provider,
    distributionPolicy: parsed.distributionPolicy,
    officialDocumentLinks: parsed.prospectusLinks.map((link) => link.href),
  };
}

function reparseExistingRaw(paths, discovery) {
  const targets = new Map(discovery.mappings.filter((row) => row.status === 'mapped').map((row) => [row.shortCode, row]));
  const latest = latestByCode(readLedger(paths.ledger));
  let repairedCount = 0;
  for (const entry of latest.values()) {
    if (entry.status !== 'validation_failed' || !entry.raw?.path) continue;
    const target = targets.get(entry.shortCode);
    const absolutePath = resolve(ROOT, entry.raw.path);
    if (!target || !existsSync(absolutePath)) continue;
    const body = readFileSync(absolutePath, 'utf8');
    const rawHash = createHash('sha256').update(body).digest('hex');
    if (rawHash !== entry.raw.hash) throw new Error(`PLUS raw hash mismatch for ${entry.shortCode}`);
    const parsed = parsePlusProductHtml(body, { expectedName: target.sourceName, expectedTicker: target.shortCode, sourceUrl: target.productUrl });
    const validation = validate(target, parsed, rawHash);
    const repaired = {
      ...entry,
      retrievedAt: new Date().toISOString(),
      sourceRetrievedAt: entry.sourceRetrievedAt || entry.retrievedAt,
      reparsedFromRaw: true,
      status: validation.pass ? (validation.missingFields.length ? 'partial' : 'ok') : 'validation_failed',
      validation,
      metadata: metadataFromParsed(parsed),
      provenance: validation.provenance,
    };
    appendLedger(paths.ledger, repaired);
    repairedCount += 1;
  }
  return repairedCount;
}

function buildReport(discovery, ledger, fullRequested, canaryPass) {
  const targets = discovery.mappings.filter((row) => row.status === 'mapped');
  const latest = latestByCode(ledger);
  const rows = targets.flatMap((target) => latest.has(target.shortCode) ? [latest.get(target.shortCode)] : []);
  const statuses = ['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'];
  const statusCounts = Object.fromEntries(statuses.map((status) => [status, rows.filter((row) => row.status === status).length]));
  const fields = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'benchmarkProvider', 'distributionPolicy', 'officialDocumentLinks'];
  return {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(),
    contract: { intervalMs: 1200, sameOriginPublicPagesOnly: true, authenticationUsed: false, bypassUsed: false, rawAppendOnly: true, resumableLedger: true },
    inventoryCount: discovery.metrics.inventoryCount,
    mappedTargetCount: targets.length,
    discoveryCoverageRatio: discovery.metrics.coverageRatio,
    canaryPass, fullRequested,
    attemptedUniqueCount: rows.length,
    completedCount: statusCounts.ok + statusCounts.partial,
    pendingMappedCount: targets.length - statusCounts.ok - statusCounts.partial,
    unmappedCount: discovery.metrics.missingCount,
    statusCounts,
    fieldCoverage: Object.fromEntries(fields.map((field) => [field, rows.filter((row) => row.validation?.fieldCoverage?.[field]).length])),
    health: {
      missingFieldCounts: Object.fromEntries(fields.map((field) => [field, rows.filter((row) => !row.validation?.fieldCoverage?.[field]).length])),
      partialCount: statusCounts.partial,
    },
    rows,
  };
}

function writeOutputs(paths, report) {
  mkdirSync(dirname(paths.report), { recursive: true });
  writeFileSync(paths.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const header = ['shortCode', 'name', 'productId', 'status', 'benchmarkName', 'distributionPolicy', 'rawHash'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [header.join(','), ...report.rows.map((row) => [row.shortCode, row.name, row.productId, row.status, row.metadata?.benchmarkName, row.metadata?.distributionPolicy, row.raw?.hash].map(quote).join(','))];
  writeFileSync(paths.csv, `${lines.join('\n')}\n`, 'utf8');
}

export async function runPlusCollection({ full = false, paths = PLUS_COLLECTION_PATHS, client = new HostLimitedHttpClient({ intervalMs: 1200 }), onProgress = null } = {}) {
  const discovery = readJson(paths.discovery);
  if (discovery.metrics.inventoryCount !== 84) throw new Error(`PLUS discovery inventory guard expected 84, found ${discovery.metrics.inventoryCount}`);
  const mappingPass = discovery.metrics.coverageRatio >= 0.95 && discovery.duplicateSourceTickers.length === 0;
  if (!mappingPass) {
    const report = buildReport(discovery, readLedger(paths.ledger), full, false);
    report.scaleDecision = 'full_collection_blocked_mapping_coverage';
    writeOutputs(paths, report);
    return report;
  }
  const targets = discovery.mappings.filter((row) => row.status === 'mapped');
  const canaries = targets.filter((target) => CANARY_CODES.has(target.shortCode));
  if (canaries.length !== 4) throw new Error(`PLUS canary guard expected 4, found ${canaries.length}`);
  const reparsedRawCount = reparseExistingRaw(paths, discovery);
  let latest = latestByCode(readLedger(paths.ledger));
  for (const target of canaries) {
    let entry = latest.get(target.shortCode);
    if (!entry || !['ok', 'partial'].includes(entry.status)) {
      entry = await collectOne(client, paths, target);
      appendLedger(paths.ledger, entry);
      latest.set(target.shortCode, entry);
      onProgress?.(entry);
    }
    if (entry.status === 'source_stopped') break;
  }
  const canaryPass = canaries.every((target) => ['ok', 'partial'].includes(latest.get(target.shortCode)?.status));
  if (full && canaryPass) {
    for (const target of targets) {
      if (['ok', 'partial'].includes(latest.get(target.shortCode)?.status)) continue;
      const entry = await collectOne(client, paths, target);
      appendLedger(paths.ledger, entry);
      latest.set(target.shortCode, entry);
      onProgress?.(entry);
      if (entry.status === 'source_stopped') break;
    }
  }
  const report = buildReport(discovery, readLedger(paths.ledger), full, canaryPass);
  report.reparsedRawCount = reparsedRawCount;
  report.scaleDecision = !canaryPass ? 'full_collection_blocked_canary_failure' : full ? 'full_collection_executed' : 'approved_for_full';
  writeOutputs(paths, report);
  return report;
}

function parseArgs(argv) {
  if (argv.length > 1 || (argv[0] && !['--canary', '--full'].includes(argv[0]))) throw new Error('usage: node collect-plus-metadata.mjs [--canary|--full]');
  return { full: argv[0] === '--full' };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runPlusCollection({ ...parseArgs(process.argv.slice(2)), onProgress: (entry) => console.log(`[plus] ${entry.shortCode} ${entry.status}`) })
    .then((report) => console.log(`[plus] completed=${report.completedCount}/${report.mappedTargetCount} pending=${report.pendingMappedCount} unmapped=${report.unmappedCount}`))
    .catch((error) => { console.error(`[plus] ${error.message}`); process.exitCode = 1; });
}
