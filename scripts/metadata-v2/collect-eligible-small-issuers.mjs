import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HostLimitedHttpClient } from './collect-official-holdings.mjs';
import { KcgiAdapter, ThejAdapter } from './providers/eligible-small-issuers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT = resolve(ROOT, 'data/reports/metadata-v2/eligible-small-issuer-collection.json');
const INVENTORY = resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json');
const FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];
const TERMINAL = new Set(['ok', 'source_stopped']);
const SOURCES = [
  { issuerId: 'kcgi-asset-management', brand: 'KCGI', expectedCount: 1, adapter: (client) => new KcgiAdapter(client), rawRoot: 'kcgi-product' },
  { issuerId: 'midas-asset-management', brand: 'MIDAS', expectedCount: 4, mappingBlocked: 'public ETF filter depends on wp-admin/admin-ajax.php; exact official product URLs and ticker identity were not exposed by the static list within the four-request low-volume discovery budget', rawRoot: 'midas-product' },
  { issuerId: 'thej-asset-management', brand: '\ub354\uc81c\uc774', expectedCount: 1, adapter: (client) => new ThejAdapter(client), rawRoot: 'thej-product' },
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readLedger = (path) => !existsSync(path) ? [] : readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const latest = (rows) => new Map(rows.map((row) => [row.shortCode, row]));
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function append(path, value) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8'); }
function persist(rawRoot, role, key, body, retrievedAt) { const hash = createHash('sha256').update(body).digest('hex'); const dir = resolve(ROOT, 'data/raw/metadata-v2', rawRoot, role, retrievedAt.slice(0, 10), key); mkdirSync(dir, { recursive: true }); const path = resolve(dir, `${retrievedAt.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.html`); if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' }); return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body), retrievedAt }; }

export function reconcileSmallIssuer(inventory, discovered) {
  return inventory.map((target) => {
    const exact = discovered.find((row) => row.shortCode && row.shortCode === target.shortCode);
    const singleton = inventory.length === 1 && discovered.length === 1 && namesCompatible(discovered[0].name, target.name) ? discovered[0] : null;
    const source = exact || singleton;
    return { ...target, productId: source?.productId || null, sourceName: source?.name || null, productUrl: source?.productUrl || null, status: source ? 'mapped' : 'missing' };
  });
}

export function validateStrictMetadata(parsed, rawHash, sourceId) {
  const metadata = { productDescription: parsed.description, investmentObjective: parsed.investmentObjective, benchmarkName: parsed.benchmark.name, benchmarkDescription: parsed.benchmark.description, distributionPolicy: parsed.distributionPolicy };
  const selectors = sourceId.startsWith('thej') ? { productDescription: '.subt-area', investmentObjective: '.b-article', benchmarkName: '.b-article, .subt-area', benchmarkDescription: '.b-article, .subt-area', distributionPolicy: '.b-article__tit + .b-article__des-wrap' } : { productDescription: '#sec1 .doc-txt', investmentObjective: '#sec1 .doc-txt', benchmarkName: 'th + td', benchmarkDescription: '#sec1 .doc-txt', distributionPolicy: 'th + td' };
  const missingFields = FIELDS.filter((field) => !metadata[field]);
  const failures = [];
  if (!parsed.identity.expectedNameMatches) failures.push('name_mismatch');
  if (!parsed.identity.expectedTickerMatches) failures.push('ticker_mismatch');
  if (missingFields.length) failures.push(...missingFields.map((field) => `missing_${field}`));
  const provenance = Object.fromEntries(FIELDS.flatMap((field) => metadata[field] ? [[field, { selector: selectors[field], snippet: String(metadata[field]).slice(0, 500), rawHash }]] : []));
  return { pass: failures.length === 0, failures, missingFields, fieldCoverage: Object.fromEntries(FIELDS.map((field) => [field, Boolean(metadata[field])])), metadata, provenance };
}

async function runSource(config, inventoryRows, client, onProgress) {
  const inventory = inventoryRows.filter((row) => row.issuer?.id === config.issuerId).map((row) => ({ issuerId: config.issuerId, shortCode: row.identifiers.krxShortCodeCandidate, isin: row.identifiers.isinCandidate || null, name: row.sourceRecord.name }));
  if (inventory.length !== config.expectedCount) throw new Error(`${config.brand} inventory guard expected ${config.expectedCount}, found ${inventory.length}`);
  const ledger = resolve(ROOT, 'data/raw/metadata-v2', config.rawRoot, 'ledger.jsonl');
  if (config.mappingBlocked) return { issuerId: config.issuerId, brand: config.brand, targetCount: inventory.length, mappingStatus: 'blocked_mapping', reason: config.mappingBlocked, canaryPass: false, completedCount: 0, pendingCount: inventory.length, rows: [] };
  const adapter = config.adapter(client);
  const found = await adapter.discover();
  const discoveredAt = new Date().toISOString();
  const discoveryRaw = { ...persist(config.rawRoot, 'discovery', 'list', found.raw.body, discoveredAt), url: found.raw.url };
  const mappings = reconcileSmallIssuer(inventory, found.rows);
  const targets = mappings.filter((row) => row.status === 'mapped');
  if (targets.length !== inventory.length) return { issuerId: config.issuerId, brand: config.brand, targetCount: inventory.length, mappingStatus: 'blocked_mapping', discoveryRaw, mappings, canaryPass: false, completedCount: 0, pendingCount: inventory.length, rows: [] };
  const seen = latest(readLedger(ledger));
  for (const target of targets.slice(0, 4)) {
    let row = seen.get(target.shortCode);
    if (!TERMINAL.has(row?.status)) {
      const retrievedAt = new Date().toISOString();
      try {
        const result = await adapter.collect(target);
        const raw = { ...persist(config.rawRoot, 'pages', target.shortCode, result.raw.body, retrievedAt), url: result.raw.url };
        const validation = validateStrictMetadata(result.parsed, raw.hash, adapter.sourceId);
        row = { retrievedAt, sourceId: adapter.sourceId, ...target, status: validation.pass ? 'ok' : 'validation_failed', validation: { pass: validation.pass, failures: validation.failures, missingFields: validation.missingFields, fieldCoverage: validation.fieldCoverage }, metadata: validation.metadata, provenance: validation.provenance, raw };
      } catch (error) {
        row = { retrievedAt, sourceId: adapter.sourceId, ...target, status: 'source_stopped', validation: { pass: false, failures: [String(error.message || error)], missingFields: FIELDS, fieldCoverage: {} }, metadata: null, provenance: null, raw: null };
      }
      append(ledger, row); seen.set(target.shortCode, row); onProgress?.(row);
    }
    if (row.status !== 'ok') break;
  }
  const rows = targets.flatMap((target) => seen.has(target.shortCode) ? [seen.get(target.shortCode)] : []);
  const canaryPass = rows.length === targets.length && rows.every((row) => row.status === 'ok');
  return { issuerId: config.issuerId, brand: config.brand, targetCount: inventory.length, mappingStatus: 'mapped', discoveryRaw, mappings, canaryPass, fullCollectionTriggered: canaryPass, completedCount: rows.filter((row) => row.status === 'ok').length, pendingCount: inventory.length - rows.filter((row) => row.status === 'ok').length, rows };
}

export async function runEligibleSmallIssuerCollection({ onProgress = null } = {}) {
  const inventory = readJson(INVENTORY).rows;
  const client = new HostLimitedHttpClient({ intervalMs: 1200 });
  const issuers = [];
  for (const source of SOURCES) issuers.push(await runSource(source, inventory, client, onProgress));
  const report = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), executionOrder: SOURCES.map((row) => row.issuerId), strictRequiredFields: FIELDS, guardrails: { intervalMs: 1200, maxCanaryPerIssuer: 4, cacheAndResume: true, rawSha256: true, stopSourceOnAnyCanaryFailure: true, canonicalMergePerformed: false }, targetCount: 6, completedCount: issuers.reduce((n, row) => n + row.completedCount, 0), pendingCount: issuers.reduce((n, row) => n + row.pendingCount, 0), issuers };
  writeJson(REPORT, report);
  return report;
}

function namesCompatible(a, b) { const x = normalize(a); const y = normalize(b); return Boolean(x && y && (x.includes(y) || y.includes(x))); }
function normalize(value) { return String(value || '').normalize('NFKC').replace(/(?:\ucf00\uc774\uc528\uc9c0\uc544\uc774|KCGI|MIDAS|ETF|\uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218\ud22c\uc790\uc2e0\ud0c1|\uc99d\uad8c\uc0c1\uc7a5\uc9c0\uc218|\uc99d\uad8c|\uc8fc\uc2dd)/gi, '').replace(/[^0-9a-zA-Z\uac00-\ud7a3]/g, '').toLowerCase(); }

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runEligibleSmallIssuerCollection({ onProgress: (row) => console.log(`[eligible-small] ${row.issuerId} ${row.shortCode} ${row.status}`) }).then((report) => console.log(`[eligible-small] completed=${report.completedCount}/6 pending=${report.pendingCount}`)).catch((error) => { console.error(`[eligible-small] ${error.message}`); process.exitCode = 1; });
