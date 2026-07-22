import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { parseRiseProductHtml, RiseProductAdapter } from './providers/rise-product.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = {
  inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  rawRoot: resolve(ROOT, 'data/raw/metadata-v2/rise-product'),
  ledger: resolve(ROOT, 'data/raw/metadata-v2/rise-product/ledger.jsonl'),
  canary: resolve(ROOT, 'data/reports/metadata-v2/rise-canary.json'),
  collection: resolve(ROOT, 'data/reports/metadata-v2/rise-collection.json'),
};
const CANARY_CODES = new Set(['114100', '219390', '253290', '275750']);
const CORE_FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'distributionPolicy'];
const OPTIONAL_FIELDS = ['benchmarkDescription'];

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

export class CachedRiseHttpClient {
  constructor(options = {}) {
    this.client = options.client || new HostLimitedHttpClient(options);
    this.cache = new Map();
  }
  async request(url) {
    if (!this.cache.has(url)) this.cache.set(url, this.requestWithTransientRetry(url));
    try { return await this.cache.get(url); }
    catch (error) { this.cache.delete(url); throw error; }
  }
  async requestWithTransientRetry(url) {
    try { return await this.client.request(url, { timeoutMs: 30000 }); }
    catch (error) {
      if (!['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
      return this.client.request(url, { timeoutMs: 30000 });
    }
  }
}

export function buildRiseTargets(inventory) {
  return inventory.rows.filter((row) => row.issuer?.id === 'kb-asset-management').map((row) => ({
    issuerId: row.issuer.id,
    shortCode: row.identifiers?.krxShortCodeCandidate,
    isin: row.identifiers?.isinCandidate || null,
    name: row.sourceRecord?.name,
  })).filter((target) => target.shortCode && target.name);
}

function persistRaw(result, target) {
  const retrievedAt = new Date().toISOString();
  const body = result.raw.body;
  const hash = createHash('sha256').update(body).digest('hex');
  const folder = resolve(PATHS.rawRoot, retrievedAt.slice(0, 10), target.shortCode);
  mkdirSync(folder, { recursive: true });
  const stamp = retrievedAt.replace(/[:.]/g, '-');
  let suffix = 0;
  let path;
  do {
    path = resolve(folder, `${stamp}.${hash.slice(0, 16)}${suffix ? `.${suffix}` : ''}.html`);
    suffix += 1;
  } while (existsSync(path));
  writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' });
  return { retrievedAt, path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body), url: result.raw.url };
}

export function validateRiseRecord(target, result) {
  const failures = [];
  const missingFields = [];
  if (result.shortCode !== target.shortCode) failures.push(`shortCode mismatch: ${result.shortCode} != ${target.shortCode}`);
  const expected = target.name.replace(/\s+/g, '').toLowerCase();
  const actual = result.productName.replace(/\s+/g, '').toLowerCase();
  if (expected !== actual) failures.push(`name mismatch: ${result.productName} != ${target.name}`);
  for (const field of [...CORE_FIELDS, ...OPTIONAL_FIELDS]) {
    if (!result.metadata[field]) missingFields.push(field);
    if (result.metadata[field] && (!result.provenance[field]?.rawHash || !result.provenance[field]?.snippet || !result.provenance[field]?.selector)) failures.push(`missing provenance ${field}`);
  }
  for (const field of CORE_FIELDS) if (missingFields.includes(field)) failures.push(`missing core field ${field}`);
  if (!result.metadata.officialDocumentLinks.length) failures.push('missing core field officialDocumentLinks');
  if (result.provenance.officialDocumentLinks.length !== result.metadata.officialDocumentLinks.length) failures.push('document provenance mismatch');
  if (result.rawHash !== result.provenance.productDescription?.rawHash) failures.push('raw hash mismatch');
  const koreanText = JSON.stringify({ productName: result.productName, metadata: result.metadata, provenance: result.provenance });
  if (!/[가-힣]/.test(koreanText)) failures.push('Korean sanity: extracted record has no Hangul');
  if (/\uFFFD|誘멸뎅|李⑥씠|\?붾/.test(koreanText)) failures.push('Korean sanity: mojibake marker detected');
  return {
    pass: failures.length === 0, failures, missingFields,
    fieldCoverage: Object.fromEntries([...CORE_FIELDS, ...OPTIONAL_FIELDS, 'officialDocumentLinks'].map((field) => [field, field === 'officialDocumentLinks' ? result.metadata[field].length > 0 : Boolean(result.metadata[field])])),
  };
}

export function reparseRiseRaw({ paths = PATHS } = {}) {
  const targets = buildRiseTargets(readJson(paths.inventory));
  const latest = latestByCode(readLedger(paths.ledger));
  let appended = 0;
  for (const target of targets) {
    const prior = latest.get(target.shortCode);
    if (!prior?.raw?.path) throw new Error(`RISE raw reparse missing artifact for ${target.shortCode}`);
    const absoluteRawPath = resolve(ROOT, prior.raw.path);
    const body = readFileSync(absoluteRawPath, 'utf8');
    const parsed = { ...parseRiseProductHtml(body, prior.raw.url), productId: prior.productId };
    const validation = validateRiseRecord(target, parsed);
    const entry = {
      ...prior, retrievedAt: new Date().toISOString(), name: target.name,
      status: validation.pass ? (validation.missingFields.length ? 'partial' : 'ok') : 'validation_failed',
      validation, metadata: parsed.metadata, provenance: parsed.provenance,
      raw: { ...prior.raw, hash: parsed.rawHash }, reparsedFromRaw: true,
    };
    appendLedger(paths.ledger, entry);
    appended += 1;
  }
  return { appended };
}

async function collectOne(adapter, target) {
  const retrievedAt = new Date().toISOString();
  try {
    const result = await adapter.collect(target);
    const validation = validateRiseRecord(target, result);
    const raw = persistRaw(result, target);
    return {
      retrievedAt, sourceId: adapter.sourceId, shortCode: target.shortCode, isin: target.isin, name: target.name,
      productId: result.productId, status: validation.pass ? (validation.missingFields.length ? 'partial' : 'ok') : 'validation_failed', validation,
      metadata: result.metadata, provenance: result.provenance, raw,
    };
  } catch (error) {
    const stopped = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError;
    return {
      retrievedAt, sourceId: adapter.sourceId, shortCode: target.shortCode, isin: target.isin, name: target.name,
      productId: null, status: stopped ? 'source_stopped' : 'failed', validation: { pass: false, failures: [String(error.message || error)] },
      metadata: null, provenance: null, raw: null,
    };
  }
}

function latestByCode(entries) {
  const map = new Map();
  for (const entry of entries) map.set(entry.shortCode, entry);
  return map;
}

function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function runRiseCollection({ full = false, paths = PATHS, adapter = null, onProgress = null } = {}) {
  const targets = buildRiseTargets(readJson(paths.inventory));
  const canaries = targets.filter((target) => CANARY_CODES.has(target.shortCode));
  if (targets.length !== 140) throw new Error(`RISE inventory guard expected 140, found ${targets.length}`);
  if (canaries.length !== 4) throw new Error(`RISE canary guard expected 4, found ${canaries.length}`);
  const productAdapter = adapter || new RiseProductAdapter(new CachedRiseHttpClient());
  const before = readLedger(paths.ledger);
  const latest = latestByCode(before);
  const canaryRows = [];
  for (const target of canaries) {
    let entry = latest.get(target.shortCode);
    if (!entry || entry.status !== 'ok') {
      entry = await collectOne(productAdapter, target);
      appendLedger(paths.ledger, entry);
      onProgress?.(entry);
    }
    canaryRows.push(entry);
    if (entry.status === 'source_stopped') break;
  }
  const canaryPass = canaryRows.length === 4 && canaryRows.every((row) => ['ok', 'partial'].includes(row.status) && row.validation.pass);
  const canaryFieldCoverage = Object.fromEntries([...CORE_FIELDS, ...OPTIONAL_FIELDS, 'officialDocumentLinks'].map((field) => [
    field, canaryRows.filter((row) => row.validation?.fieldCoverage?.[field]).length,
  ]));
  const canaryReport = {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), expectedCount: 4, attemptedCount: canaryRows.length,
    pass: canaryPass, fieldCoverage: canaryFieldCoverage,
    scaleDecision: canaryPass ? (full ? 'approved_and_started' : 'approved_for_full') : 'stopped_canary_failed', rows: canaryRows,
  };
  writeReport(paths.canary, canaryReport);

  if (full && canaryPass) {
    const completed = new Set(readLedger(paths.ledger).filter((entry) => ['ok', 'partial'].includes(entry.status)).map((entry) => entry.shortCode));
    for (const target of targets) {
      if (completed.has(target.shortCode)) continue;
      const entry = await collectOne(productAdapter, target);
      appendLedger(paths.ledger, entry);
      onProgress?.(entry);
      if (entry.status === 'source_stopped') break;
    }
  }

  const finalRows = [...latestByCode(readLedger(paths.ledger)).values()].filter((entry) => targets.some((target) => target.shortCode === entry.shortCode));
  const statusCounts = Object.fromEntries(['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'].map((status) => [status, finalRows.filter((row) => row.status === status).length]));
  const completedCount = statusCounts.ok + statusCounts.partial;
  const fieldCoverage = Object.fromEntries([...CORE_FIELDS, ...OPTIONAL_FIELDS, 'officialDocumentLinks'].map((field) => [
    field, finalRows.filter((row) => row.validation?.fieldCoverage?.[field]).length,
  ]));
  const report = {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), targetCount: targets.length,
    attemptedUniqueCount: finalRows.length, completedCount, pendingCount: targets.length - completedCount,
    canaryPass, fullRequested: full, statusCounts, fieldCoverage, rows: finalRows,
  };
  writeReport(paths.collection, report);
  return { canaryReport, report };
}

function parseArgs(argv) {
  if (argv.length > 1 || (argv[0] && !['--canary', '--full', '--reparse-raw'].includes(argv[0]))) throw new Error('usage: node collect-rise-metadata.mjs [--canary|--full|--reparse-raw]');
  return { full: argv[0] === '--full', reparseRaw: argv[0] === '--reparse-raw' };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.reparseRaw) console.log(`[rise] reparsed raw artifacts=${reparseRiseRaw().appended}`);
  runRiseCollection({ full: args.full, onProgress: (entry) => console.log(`[rise] ${entry.shortCode} ${entry.status}${entry.validation.failures.length ? ` ${entry.validation.failures.join('; ')}` : ''}`) })
    .then(({ canaryReport, report }) => console.log(`[rise] canary=${canaryReport.pass ? 'pass' : 'fail'} completed=${report.completedCount}/${report.targetCount} pending=${report.pendingCount}`))
    .catch((error) => { console.error(`[rise] ${error.message}`); process.exitCode = 1; });
}
