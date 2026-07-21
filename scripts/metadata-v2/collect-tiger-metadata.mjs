import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { TigerProductAdapter } from './providers/tiger-product.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = {
  inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  identity: resolve(ROOT, 'data/normalized/etf-identity-map-v2.json'),
  rawRoot: resolve(ROOT, 'data/raw/metadata-v2/tiger-product'),
  ledger: resolve(ROOT, 'data/raw/metadata-v2/tiger-product/ledger.jsonl'),
  policy: resolve(ROOT, 'data/reports/metadata-v2/tiger-access-policy.json'),
  canary: resolve(ROOT, 'data/reports/metadata-v2/tiger-canary.json'),
  collection: resolve(ROOT, 'data/reports/metadata-v2/tiger-collection.json'),
};
const CANARY_CODES = new Set(['102110', '114820', '182480', '217770']);
const FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function appendLedger(path, entry) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8'); }
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function latestByCode(entries) { const map = new Map(); for (const entry of entries) map.set(entry.shortCode, entry); return map; }

export class CachedTigerHttpClient {
  constructor(options = {}) {
    this.client = options.client || new HostLimitedHttpClient({ intervalMs: 1200, maxAttempts: 2, defaultCooldownMs: 30000, ...options });
    this.cache = new Map();
  }
  async request(url) {
    if (!this.cache.has(url)) this.cache.set(url, this.requestWithTransientRetry(url));
    try { return await this.cache.get(url); } catch (error) { this.cache.delete(url); throw error; }
  }
  async requestWithTransientRetry(url) {
    try { return await this.client.request(url, { timeoutMs: 30000 }); }
    catch (error) {
      if (!['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
      return this.client.request(url, { timeoutMs: 30000 });
    }
  }
}

export function buildTigerTargets(inventory, identityMap) {
  const byCode = new Map(identityMap.records.map((record) => [record.identity?.shortCode, record]));
  return inventory.rows.filter((row) => row.issuer?.id === 'mirae-asset-global-investments').map((row) => {
    const shortCode = row.identifiers?.krxShortCodeCandidate;
    const identity = byCode.get(shortCode);
    return {
      issuerId: row.issuer.id, shortCode,
      isin: identity?.identity?.isin || row.identifiers?.isinCandidate || null,
      name: identity?.identity?.officialName || row.sourceRecord?.name,
      identityStatus: identity?.status || 'missing',
    };
  }).filter((target) => target.shortCode && target.name && target.identityStatus === 'resolved' && /^KR[0-9A-Z]{9}\d$/.test(target.isin || ''));
}

function persistRaw(paths, target, result) {
  const retrievedAt = new Date().toISOString();
  const body = result.raw.body;
  const hash = createHash('sha256').update(body).digest('hex');
  const folder = resolve(paths.rawRoot, retrievedAt.slice(0, 10), target.shortCode);
  mkdirSync(folder, { recursive: true });
  const stamp = retrievedAt.replace(/[:.]/g, '-');
  let suffix = 0;
  let path;
  do { path = resolve(folder, `${stamp}.${hash.slice(0, 16)}${suffix ? `.${suffix}` : ''}.html`); suffix += 1; } while (existsSync(path));
  writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' });
  return { retrievedAt, path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body), url: result.raw.url };
}

function persistPolicyRaw(paths, role, response) {
  const retrievedAt = new Date().toISOString();
  const hash = createHash('sha256').update(response.body).digest('hex');
  const folder = resolve(paths.rawRoot, 'policy', retrievedAt.slice(0, 10));
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `${retrievedAt.replace(/[:.]/g, '-')}.${role}.${hash.slice(0, 16)}.raw`);
  writeFileSync(path, response.body, { encoding: 'utf8', flag: 'wx' });
  return { retrievedAt, path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, url: response.url };
}

export async function verifyTigerAccessPolicy(client, paths = PATHS) {
  const robotsUrl = 'https://investments.miraeasset.com/robots.txt';
  const termsUrl = 'https://investments.miraeasset.com/use.do';
  const robots = { ...(await client.request(robotsUrl)), url: robotsUrl };
  const terms = { ...(await client.request(termsUrl)), url: termsUrl };
  const robotsAllowsProduct = /Allow:\s*\/tigeretf\//i.test(robots.body)
    && !/Disallow:\s*\/tigeretf\/ko\/product/i.test(robots.body);
  const uploadDisallowed = /Disallow:\s*\/tigeretf\/upload\//i.test(robots.body);
  const automatedCollectionRestrictionFound = /(?:크롤링|스크래핑|자동화된\s*(?:접근|수집)|로봇을\s*이용한\s*접근)/i.test(terms.body);
  const allowed = robotsAllowsProduct && uploadDisallowed && !automatedCollectionRestrictionFound;
  const report = {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), allowed,
    decision: allowed ? 'public_product_detail_allowed_conservative_link_only_documents' : 'blocked_policy_gate',
    robots: { url: robotsUrl, robotsAllowsProduct, uploadDisallowed, raw: persistPolicyRaw(paths, 'robots', robots) },
    terms: { url: termsUrl, automatedCollectionRestrictionFound, raw: persistPolicyRaw(paths, 'terms', terms) },
    constraints: { hostIntervalMs: 1200, productPathOnly: '/tigeretf/ko/product/search/detail/index.do', uploadDocumentsFetched: false, circuitBreaker: 'persistent_429_or_403' },
  };
  writeJson(paths.policy, report);
  return report;
}

export function validateTigerRecord(target, result) {
  const failures = [];
  const warnings = [];
  const missingFields = [];
  if (result.shortCode !== target.shortCode) failures.push(`shortCode mismatch: ${result.shortCode} != ${target.shortCode}`);
  if (result.productName.replace(/\s+/g, '').toLowerCase() !== target.name.replace(/\s+/g, '').toLowerCase()) {
    warnings.push(`official name alias/conflict: ${result.productName} != ${target.name}`);
  }
  for (const field of FIELDS) {
    if (!result.metadata[field]) missingFields.push(field);
    const proof = result.provenance[field];
    if (result.metadata[field] && (!proof?.rawHash || !proof.selector || !proof.snippet)) failures.push(`missing provenance ${field}`);
  }
  if (!result.metadata.officialDocumentLinks.length) missingFields.push('officialDocumentLinks');
  if (result.provenance.officialDocumentLinks.length !== result.metadata.officialDocumentLinks.length) failures.push('document provenance mismatch');
  if (result.rawHash !== result.provenance.productDescription?.rawHash) failures.push('raw hash mismatch');
  if (/\uFFFD|誘멸뎅|李⑥씠|\?붾/.test(JSON.stringify(result))) failures.push('Korean sanity: mojibake marker detected');
  return {
    pass: failures.length === 0, complete: failures.length === 0 && missingFields.length === 0 && warnings.length === 0,
    failures, warnings, missingFields,
    fieldCoverage: Object.fromEntries([...FIELDS, 'officialDocumentLinks'].map((field) => [field, field === 'officialDocumentLinks' ? result.metadata[field].length > 0 : Boolean(result.metadata[field])])),
  };
}

async function collectOne(paths, adapter, target) {
  const retrievedAt = new Date().toISOString();
  try {
    const result = await adapter.collect(target);
    const validation = validateTigerRecord(target, result);
    const raw = persistRaw(paths, target, result);
    return {
      retrievedAt, sourceId: adapter.sourceId, issuerId: target.issuerId, shortCode: target.shortCode, isin: target.isin, name: target.name,
      status: validation.pass ? (validation.complete ? 'ok' : 'partial') : 'validation_failed', validation,
      identity: { requestedName: target.name, issuerProductName: result.productName, match: validation.warnings.length ? 'short_code_and_isin_with_name_alias_conflict' : 'short_code_isin_and_name' },
      metadata: result.metadata, provenance: result.provenance, raw,
    };
  } catch (error) {
    const stopped = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError;
    return {
      retrievedAt, sourceId: adapter.sourceId, issuerId: target.issuerId, shortCode: target.shortCode, isin: target.isin, name: target.name,
      status: stopped ? 'source_stopped' : 'failed', validation: { pass: false, complete: false, failures: [String(error.message || error)], missingFields: FIELDS },
      metadata: null, provenance: null, raw: null,
    };
  }
}

export async function runTigerCollection({ full = false, paths = PATHS, client = null, adapter = null, skipPolicy = false, onProgress = null } = {}) {
  const targets = buildTigerTargets(readJson(paths.inventory), readJson(paths.identity));
  const canaries = targets.filter((target) => CANARY_CODES.has(target.shortCode));
  if (targets.length !== 229) throw new Error(`TIGER inventory guard expected 229, found ${targets.length}`);
  if (canaries.length !== 4) throw new Error(`TIGER canary guard expected 4, found ${canaries.length}`);
  const http = client || new CachedTigerHttpClient();
  if (!skipPolicy) {
    const policy = await verifyTigerAccessPolicy(http, paths);
    if (!policy.allowed) throw new Error('TIGER policy gate blocked collection');
  }
  const productAdapter = adapter || new TigerProductAdapter(http);
  const latest = latestByCode(readLedger(paths.ledger));
  const canaryRows = [];
  for (const target of canaries) {
    let entry = latest.get(target.shortCode);
    if (!entry || !['ok', 'partial'].includes(entry.status)) {
      entry = await collectOne(paths, productAdapter, target);
      appendLedger(paths.ledger, entry);
      onProgress?.(entry);
    }
    canaryRows.push(entry);
    if (entry.status === 'source_stopped') break;
  }
  const canaryPass = canaryRows.length === 4 && canaryRows.every((row) => row.validation?.pass && ['ok', 'partial'].includes(row.status));
  const fieldCoverage = Object.fromEntries([...FIELDS, 'officialDocumentLinks'].map((field) => [field, canaryRows.filter((row) => row.validation?.fieldCoverage?.[field]).length]));
  writeJson(paths.canary, { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), pass: canaryPass, fieldCoverage, rows: canaryRows });
  if (full && canaryPass) {
    const completed = new Set(readLedger(paths.ledger).filter((entry) => ['ok', 'partial'].includes(entry.status)).map((entry) => entry.shortCode));
    for (const target of targets) {
      if (completed.has(target.shortCode)) continue;
      const entry = await collectOne(paths, productAdapter, target);
      appendLedger(paths.ledger, entry);
      onProgress?.(entry);
      if (entry.status === 'source_stopped') break;
    }
  }
  const rows = [...latestByCode(readLedger(paths.ledger)).values()].filter((entry) => targets.some((target) => target.shortCode === entry.shortCode));
  const statuses = ['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'];
  const statusCounts = Object.fromEntries(statuses.map((status) => [status, rows.filter((row) => row.status === status).length]));
  const completedCount = statusCounts.ok + statusCounts.partial;
  const allCoverage = Object.fromEntries([...FIELDS, 'officialDocumentLinks'].map((field) => [field, rows.filter((row) => row.validation?.fieldCoverage?.[field]).length]));
  const report = {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), targetCount: targets.length, attemptedUniqueCount: rows.length,
    completedCount, pendingCount: targets.length - completedCount, canaryPass, fullRequested: full, statusCounts, fieldCoverage: allCoverage, rows,
  };
  writeJson(paths.collection, report);
  return { report, canaryPass };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const mode = process.argv[2] || '--canary';
  if (!['--canary', '--full'].includes(mode)) throw new Error('usage: node collect-tiger-metadata.mjs [--canary|--full]');
  runTigerCollection({ full: mode === '--full', onProgress: (entry) => console.log(`[tiger] ${entry.shortCode} ${entry.status}${entry.validation.failures.length ? ` ${entry.validation.failures.join('; ')}` : ''}`) })
    .then(({ report, canaryPass }) => console.log(`[tiger] canary=${canaryPass ? 'pass' : 'fail'} completed=${report.completedCount}/${report.targetCount} pending=${report.pendingCount}`))
    .catch((error) => { console.error(`[tiger] ${error.message}`); process.exitCode = 1; });
}
