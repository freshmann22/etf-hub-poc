import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOfficialHoldingsAdapters } from './providers/official-holdings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  identity: resolve(ROOT, 'data/normalized/etf-identity-map-v2.json'),
  rawRoot: resolve(ROOT, 'data/raw/metadata-v2/official-holdings'),
  ledger: resolve(ROOT, 'data/raw/metadata-v2/official-holdings/ledger.jsonl'),
  reportJson: resolve(ROOT, 'data/reports/metadata-v2/holdings-collection.json'),
  reportCsv: resolve(ROOT, 'data/reports/metadata-v2/holdings-collection.csv'),
  reportMd: resolve(ROOT, 'data/reports/metadata-v2/holdings-collection.md'),
});

export class PersistentRateLimitError extends Error {
  constructor(host, retryAfterMs) {
    super(`persistent 429 from ${host}`);
    this.name = 'PersistentRateLimitError';
    this.host = host;
    this.retryAfterMs = retryAfterMs;
  }
}

export class AccessBlockedError extends Error {
  constructor(host, status = 403) {
    super(`access blocked with ${status} from ${host}`);
    this.name = 'AccessBlockedError';
    this.host = host;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

export class HostLimitedHttpClient {
  constructor({ intervalMs = 1200, maxAttempts = 3, defaultCooldownMs = 30000, fetchImpl = fetch, sleepImpl = sleep } = {}) {
    if (intervalMs < 1200) throw new Error('official holdings host interval must be at least 1200ms');
    this.intervalMs = intervalMs;
    this.maxAttempts = maxAttempts;
    this.defaultCooldownMs = defaultCooldownMs;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.nextAllowedAt = new Map();
  }

  async request(url, options = {}) {
    const host = new URL(url).hostname;
    let lastRetryAfterMs = this.defaultCooldownMs;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const waitMs = Math.max(0, (this.nextAllowedAt.get(host) || 0) - Date.now());
      if (waitMs) await this.sleepImpl(waitMs);
      this.nextAllowedAt.set(host, Date.now() + this.intervalMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
      try {
        const response = await this.fetchImpl(url, {
          method: options.method || 'GET', body: options.body,
          headers: { 'user-agent': 'etf-hub-metadata-pipeline/0.2 (personal-poc; local-only)', ...(options.headers || {}) },
          signal: controller.signal,
        });
        const contentType = response.headers?.get?.('content-type') || null;
        let body;
        if (typeof response.arrayBuffer === 'function') {
          const bytes = await response.arrayBuffer();
          const declared = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() || 'utf-8';
          const encoding = /^(euc-kr|ks_c_5601-1987|cp949)$/i.test(declared) ? 'euc-kr' : 'utf-8';
          body = new TextDecoder(encoding).decode(bytes);
        } else {
          body = await response.text();
        }
        if (response.status === 429) {
          lastRetryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'), this.defaultCooldownMs);
          this.nextAllowedAt.set(host, Date.now() + lastRetryAfterMs);
          if (attempt === this.maxAttempts) throw new PersistentRateLimitError(host, lastRetryAfterMs);
          continue;
        }
        if (response.status === 403) throw new AccessBlockedError(host, response.status);
        if (!response.ok) throw new Error(`upstream ${response.status} from ${host}`);
        if (Buffer.byteLength(body) > 10 * 1024 * 1024) throw new Error(`response exceeds 10MB from ${host}`);
        return { body, contentType, status: response.status };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PersistentRateLimitError(host, lastRetryAfterMs);
  }
}

export function parseRetryAfter(value, fallbackMs = 30000, now = Date.now()) {
  if (value == null || value === '') return fallbackMs;
  if (/^\d+(?:\.\d+)?$/.test(String(value).trim())) return Math.max(0, Math.ceil(Number(value) * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : fallbackMs;
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export function buildTargets(inventory, identityMap, issuerIds = null) {
  const identityByCode = new Map(identityMap.records.map((record) => [record.identity?.shortCode, record]));
  const supported = issuerIds || new Set(['samsung-asset-management', 'mirae-asset-global-investments', 'shinhan-asset-management']);
  return inventory.rows.filter((row) => supported.has(row.issuer?.id)).map((row) => {
    const code = row.identifiers?.krxShortCodeCandidate;
    const identity = identityByCode.get(code);
    return {
      issuerId: row.issuer.id,
      brand: row.brand,
      shortCode: code,
      isin: identity?.identity?.isin || row.identifiers?.isinCandidate || null,
      name: identity?.identity?.officialName || row.sourceRecord?.name || null,
      identityStatus: identity?.status || 'missing',
      officialVerification: identity?.identity?.officialVerification || null,
    };
  }).filter((target) => target.shortCode && target.identityStatus === 'resolved');
}

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function latestSuccessfulKeys(entries) {
  return new Set(entries.filter((entry) => entry.status === 'ok' || entry.status === 'empty').map((entry) => `${entry.sourceId}:${entry.shortCode}`));
}

function persistRawArtifacts(paths, sourceId, shortCode, artifacts, retrievedAt) {
  const stored = [];
  for (const item of artifacts || []) {
    const content = String(item.body ?? '');
    const hash = createHash('sha256').update(content).digest('hex');
    const stamp = retrievedAt.replace(/[:.]/g, '-');
    const folder = resolve(paths.rawRoot, sourceId, retrievedAt.slice(0, 10), shortCode);
    mkdirSync(folder, { recursive: true });
    let sequence = 0;
    let file;
    do {
      file = resolve(folder, `${stamp}.${item.role || 'response'}.${hash.slice(0, 16)}${sequence ? `.${sequence}` : ''}.raw`);
      sequence += 1;
    } while (existsSync(file));
    writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
    const storedPath = file.startsWith(`${ROOT}\\`) ? file.slice(ROOT.length + 1).replaceAll('\\', '/') : file;
    stored.push({ path: storedPath, url: item.url, role: item.role, contentHash: hash, contentType: item.contentType });
  }
  return stored;
}

function appendLedger(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function collectTargets({ targets, adapters, paths = DEFAULT_PATHS, force = false, onProgress = null }) {
  const ledgerBefore = readLedger(paths.ledger);
  const completed = force ? new Set() : latestSuccessfulKeys(ledgerBefore);
  const stoppedSources = new Set();
  const runEntries = [];
  for (const target of targets) {
    const adapter = adapters.get(target.issuerId);
    if (!adapter) continue;
    const key = `${adapter.sourceId}:${target.shortCode}`;
    if (completed.has(key) || stoppedSources.has(adapter.sourceId)) continue;
    const retrievedAt = new Date().toISOString();
    let entry;
    try {
      const result = await adapter.collect(target);
      const rawArtifacts = persistRawArtifacts(paths, adapter.sourceId, target.shortCode, result.rawArtifacts, retrievedAt);
      const isPartial = result.declaredCount != null && result.rows.length < result.declaredCount;
      entry = {
        retrievedAt, sourceId: adapter.sourceId, issuerId: target.issuerId, shortCode: target.shortCode,
        isin: target.isin, name: target.name, status: result.rows.length ? (isPartial ? 'partial' : 'ok') : 'empty',
        rowCount: result.rows.length, declaredCount: result.declaredCount, asOfDate: result.asOfDate,
        rawArtifacts, error: null,
      };
    } catch (error) {
      entry = {
        retrievedAt, sourceId: adapter.sourceId, issuerId: target.issuerId, shortCode: target.shortCode,
        isin: target.isin, name: target.name,
        status: error instanceof PersistentRateLimitError ? 'rate_limited_stopped' : error instanceof AccessBlockedError ? 'access_blocked_stopped' : 'failed',
        rowCount: 0, declaredCount: null, asOfDate: null, rawArtifacts: [], error: String(error.message || error),
      };
      if (error instanceof PersistentRateLimitError || error instanceof AccessBlockedError) stoppedSources.add(adapter.sourceId);
    }
    appendLedger(paths.ledger, entry);
    runEntries.push(entry);
    onProgress?.(entry);
  }
  return { runEntries, stoppedSources: [...stoppedSources], ledger: readLedger(paths.ledger) };
}

function latestByKey(entries) {
  const map = new Map();
  for (const entry of entries) map.set(`${entry.sourceId}:${entry.shortCode}`, entry);
  return [...map.values()];
}

export function buildCollectionReport(targets, collection) {
  const latest = latestByKey(collection.ledger);
  const targetKeys = new Set(targets.map((target) => `${sourceIdForIssuer(target.issuerId)}:${target.shortCode}`));
  const rows = latest.filter((entry) => targetKeys.has(`${entry.sourceId}:${entry.shortCode}`));
  const statuses = ['ok', 'partial', 'empty', 'failed', 'rate_limited_stopped', 'access_blocked_stopped'];
  const statusCounts = Object.fromEntries(statuses.map((status) => [status, rows.filter((row) => row.status === status).length]));
  const sourceCounts = [...new Set(targets.map((target) => sourceIdForIssuer(target.issuerId)))].map((sourceId) => {
    const sourceTargets = targets.filter((target) => sourceIdForIssuer(target.issuerId) === sourceId);
    const sourceRows = rows.filter((row) => row.sourceId === sourceId);
    const completed = sourceRows.filter((row) => ['ok', 'empty'].includes(row.status)).length;
    return {
      sourceId, targets: sourceTargets.length, attemptedUnique: sourceRows.length, completed,
      pending: sourceTargets.length - completed,
      statuses: Object.fromEntries(statuses.map((status) => [status, sourceRows.filter((row) => row.status === status).length])),
      errors: [...new Set(sourceRows.filter((row) => row.error).map((row) => row.error))],
    };
  });
  return {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), targetCount: targets.length,
    attemptedUniqueCount: rows.length, pendingCount: Math.max(0, targets.length - rows.filter((row) => ['ok', 'empty'].includes(row.status)).length),
    statusCounts, sourceCounts, stoppedSources: collection.stoppedSources, rows,
  };
}

function sourceIdForIssuer(issuerId) {
  return ({
    'samsung-asset-management': 'issuer_kodex',
    'mirae-asset-global-investments': 'issuer_tiger',
    'shinhan-asset-management': 'issuer_sol',
  })[issuerId];
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeReports(paths, report) {
  mkdirSync(dirname(paths.reportJson), { recursive: true });
  writeFileSync(paths.reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const fields = ['sourceId', 'shortCode', 'isin', 'name', 'status', 'rowCount', 'declaredCount', 'asOfDate', 'retrievedAt', 'error'];
  writeFileSync(paths.reportCsv, `${fields.join(',')}\n${report.rows.map((row) => fields.map((field) => csvEscape(row[field])).join(',')).join('\n')}\n`, 'utf8');
  const md = [
    '# Official holdings collection', '',
    `- Generated: ${report.generatedAt}`, `- Targets: ${report.targetCount}`, `- Attempted unique: ${report.attemptedUniqueCount}`, `- Pending/resumable: ${report.pendingCount}`,
    `- Status: ${Object.entries(report.statusCounts).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    `- Rate-limited sources stopped: ${report.stoppedSources.join(', ') || 'none'}`, '',
    '| Source | Targets | Attempted | Completed | Pending | Latest statuses |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...report.sourceCounts.map((source) => `| ${source.sourceId} | ${source.targets} | ${source.attemptedUnique} | ${source.completed} | ${source.pending} | ${Object.entries(source.statuses).filter(([, count]) => count).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'} |`),
    '', '## Blocking observations', '',
    ...report.sourceCounts.flatMap((source) => source.errors.length
      ? source.errors.map((error) => `- ${source.sourceId}: ${error}`)
      : []),
    ...(report.sourceCounts.every((source) => !source.errors.length) ? ['- none'] : []), '',
    'Raw responses are append-only under `data/raw/metadata-v2/official-holdings/`; the JSONL ledger is the resume source of truth.', '',
  ].join('\n');
  writeFileSync(paths.reportMd, md, 'utf8');
}

function parseArgs(argv) {
  const args = { dryRun: false, full: false, reportOnly: false, force: false, issuers: null };
  for (const value of argv) {
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--full') args.full = true;
    else if (value === '--report-only') args.reportOnly = true;
    else if (value === '--force') args.force = true;
    else if (value.startsWith('--issuer=')) args.issuers = new Set(value.slice(9).split(',').filter(Boolean));
    else throw new Error(`unknown argument: ${value}`);
  }
  if (![args.dryRun, args.full, args.reportOnly].filter(Boolean).length) throw new Error('choose --dry-run (2 per issuer), --full, or --report-only');
  if ([args.dryRun, args.full, args.reportOnly].filter(Boolean).length > 1) throw new Error('choose only one run mode');
  return args;
}

function selectDryRun(targets) {
  const counts = new Map();
  return targets.filter((target) => {
    const count = counts.get(target.issuerId) || 0;
    if (count >= 2) return false;
    counts.set(target.issuerId, count + 1);
    return true;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inventory = readJson(DEFAULT_PATHS.inventory);
  const identity = readJson(DEFAULT_PATHS.identity);
  const allTargets = buildTargets(inventory, identity);
  let targets = buildTargets(inventory, identity, args.issuers);
  if (args.dryRun) targets = selectDryRun(targets);
  let collection;
  if (args.reportOnly) {
    const ledger = readLedger(DEFAULT_PATHS.ledger);
    const stoppedSources = [...new Set(ledger.filter((entry) => entry.status?.endsWith('_stopped')).map((entry) => entry.sourceId))];
    collection = { runEntries: [], stoppedSources, ledger };
  } else {
    const client = new HostLimitedHttpClient();
    const adapters = createOfficialHoldingsAdapters(client);
    collection = await collectTargets({
      targets, adapters, force: args.force,
      onProgress: (entry) => console.log(`[${entry.sourceId}] ${entry.shortCode} ${entry.status} rows=${entry.rowCount}${entry.error ? ` error=${entry.error}` : ''}`),
    });
  }
  const report = buildCollectionReport(allTargets, collection);
  writeReports(DEFAULT_PATHS, report);
  console.log(`[official-holdings] targets=${report.targetCount} attempted=${report.attemptedUniqueCount} pending=${report.pendingCount}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { console.error(`[official-holdings] ${error.message}`); process.exitCode = 1; });
}
