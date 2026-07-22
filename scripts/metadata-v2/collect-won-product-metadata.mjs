import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { WonProductAdapter } from './providers/won-product.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = { inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'), rawRoot: resolve(ROOT, 'data/raw/metadata-v2/won-product'), ledger: resolve(ROOT, 'data/raw/metadata-v2/won-product/ledger.jsonl'), selection: resolve(ROOT, 'data/reports/metadata-v2/time-won-selection-policy.json'), discovery: resolve(ROOT, 'data/reports/metadata-v2/won-discovery.json'), canary: resolve(ROOT, 'data/reports/metadata-v2/won-canary.json'), collection: resolve(ROOT, 'data/reports/metadata-v2/won-collection.json') };
const CANARIES = new Set(['444490', '474590', '458030', '413930']);
const FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];
const SUCCESS = new Set(['ok', 'partial']);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readLedger = (path) => !existsSync(path) ? [] : readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const latest = (rows) => new Map(rows.map((row) => [row.shortCode, row]));
const norm = (value) => String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣+]/g, '').toLowerCase();
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function append(path, value) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8'); }
function persist(paths, role, key, body, at) { const hash = createHash('sha256').update(body).digest('hex'); const dir = resolve(paths.rawRoot, role, at.slice(0, 10), key); mkdirSync(dir, { recursive: true }); const path = resolve(dir, `${at.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.html`); if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' }); return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body) }; }

export function reconcileWon(inventory, discovered) {
  const byTicker = new Map(discovered.map((row) => [row.shortCode, row]));
  const mappings = inventory.map((target) => { const source = byTicker.get(target.shortCode); const nameMatches = source ? norm(source.name) === norm(target.name) : false; return { ...target, productId: source?.productId || null, sourceName: source?.name || null, listDescription: source?.listDescription || null, productUrl: source?.productUrl || null, status: source && nameMatches ? 'mapped' : source ? 'name_mismatch' : 'missing' }; });
  const mappedCount = mappings.filter((row) => row.status === 'mapped').length;
  return { mappings, metrics: { inventoryCount: inventory.length, discoveredCount: discovered.length, mappedCount, missingCount: inventory.length - mappedCount, coverageRatio: Number((mappedCount / inventory.length).toFixed(6)) } };
}

function validate(parsed, rawHash) {
  const failures = [];
  if (!parsed.identity.expectedNameMatches) failures.push('name_mismatch');
  if (!parsed.identity.expectedTickerMatches) failures.push('ticker_mismatch');
  const metadata = { productDescription: parsed.description, investmentObjective: parsed.investmentObjective, benchmarkName: parsed.benchmark.name, benchmarkDescription: parsed.benchmark.description, distributionPolicy: parsed.distributionPolicy, officialDocumentLinks: parsed.officialDocumentLinks.map((link) => link.href) };
  const coverage = Object.fromEntries([...FIELDS, 'officialDocumentLinks'].map((field) => [field, field === 'officialDocumentLinks' ? metadata[field].length > 0 : Boolean(metadata[field])]));
  const proof = (value, selector) => value ? { selector, snippet: value, rawHash } : null;
  const provenance = { productDescription: proof(metadata.productDescription, '.fund-view__sub-title'), investmentObjective: proof(metadata.investmentObjective, '.investment__info'), benchmarkName: proof(metadata.benchmarkName, '.notion__item .notion__right'), benchmarkDescription: proof(metadata.benchmarkDescription, '.investment__info'), distributionPolicy: proof(metadata.distributionPolicy, '.fund-view__grid dt + dd'), officialDocumentLinks: parsed.officialDocumentLinks.map((link) => ({ selector: 'button[onclick*="/file-download?uid="]', snippet: link.label, href: link.href, rawHash })) };
  if (!FIELDS.some((field) => coverage[field])) failures.push('no_populated_metadata');
  return { pass: failures.length === 0, failures, missingFields: [...FIELDS, 'officialDocumentLinks'].filter((field) => !coverage[field]), fieldCoverage: coverage, metadata, provenance };
}

async function collectOne(adapter, paths, target) {
  const retrievedAt = new Date().toISOString();
  try { const result = await adapter.collect(target); const raw = { ...persist(paths, 'pages', target.shortCode, result.raw.body, retrievedAt), url: result.raw.url }; const v = validate(result.parsed, raw.hash); return { retrievedAt, sourceId: adapter.sourceId, ...target, status: !v.pass ? 'validation_failed' : v.missingFields.length ? 'partial' : 'ok', validation: { pass: v.pass, failures: v.failures, missingFields: v.missingFields, fieldCoverage: v.fieldCoverage }, metadata: v.metadata, provenance: v.provenance, raw }; }
  catch (error) { const stop = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError; return { retrievedAt, sourceId: adapter.sourceId, ...target, status: stop ? 'source_stopped' : 'failed', validation: { pass: false, failures: [String(error.message || error)], missingFields: FIELDS, fieldCoverage: {} }, metadata: null, provenance: null, raw: null }; }
}

export async function runWonCollection({ full = false, paths = PATHS, adapter = null, onProgress = null } = {}) {
  writeJson(paths.selection, { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), selected: 'woori-asset-management', candidates: [{ issuer: 'timefolio-asset-management', brand: 'TIME', inventoryCount: 19, productCalls: 0, decision: 'blocked_permission_unclear', evidence: ['robots.txt allows crawling', 'no observable site-wide terms governing automated reuse', 'official report pages carry reproduction and redistribution restrictions'] }, { issuer: 'woori-asset-management', brand: 'WON', inventoryCount: 16, decision: 'allowed_low_volume_local_poc', evidence: ['robots.txt explicitly Allow:/', 'public ETF list and product pages require no authentication', 'footer policies concern privacy, customer information, and credit information; no general automation prohibition observed'] }], guardrails: { intervalMs: 1200, sameOriginOnly: true, authentication: false, circuitBreaker: ['403', 'persistent_429'] } });
  const inv = json(paths.inventory).rows.filter((row) => row.issuer?.id === 'woori-asset-management').map((row) => ({ issuerId: row.issuer.id, shortCode: row.identifiers.krxShortCodeCandidate, isin: row.identifiers.isinCandidate || null, name: row.sourceRecord.name }));
  if (inv.length !== 16) throw new Error(`WON inventory guard expected 16, found ${inv.length}`);
  const a = adapter || new WonProductAdapter(new HostLimitedHttpClient({ intervalMs: 1200 }));
  const found = await a.discover(); const at = new Date().toISOString(); const raw = { ...persist(paths, 'discovery', 'list', found.raw.body, at), url: found.raw.url }; const rec = reconcileWon(inv, found.rows); const discovery = { schemaVersion: '1.0.0', generatedAt: at, raw, ...rec, scaleDecision: rec.metrics.coverageRatio >= 0.95 ? 'mapping_pass' : 'blocked_mapping' }; writeJson(paths.discovery, discovery);
  const targets = rec.mappings.filter((row) => row.status === 'mapped'); const canaries = targets.filter((row) => CANARIES.has(row.shortCode)); let seen = latest(readLedger(paths.ledger));
  if (rec.metrics.coverageRatio >= 0.95 && canaries.length === 4) for (const target of canaries) { let entry = seen.get(target.shortCode); if (!SUCCESS.has(entry?.status)) { entry = await collectOne(a, paths, target); append(paths.ledger, entry); seen.set(target.shortCode, entry); onProgress?.(entry); } if (entry.status === 'source_stopped') break; }
  const canaryRows = canaries.flatMap((row) => seen.has(row.shortCode) ? [seen.get(row.shortCode)] : []); const fieldCoverage = Object.fromEntries(FIELDS.map((field) => [field, canaryRows.filter((row) => row.validation?.fieldCoverage?.[field]).length])); const canaryPass = canaryRows.length === 4 && canaryRows.every((row) => SUCCESS.has(row.status)) && FIELDS.every((field) => fieldCoverage[field] === 4); writeJson(paths.canary, { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), pass: canaryPass, fieldCoverage, rows: canaryRows });
  if (full && canaryPass) for (const target of targets) { if (SUCCESS.has(seen.get(target.shortCode)?.status)) continue; const entry = await collectOne(a, paths, target); append(paths.ledger, entry); seen.set(target.shortCode, entry); onProgress?.(entry); if (entry.status === 'source_stopped') break; }
  const rows = [...latest(readLedger(paths.ledger)).values()].filter((row) => inv.some((x) => x.shortCode === row.shortCode)); const statuses = Object.fromEntries(['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'].map((s) => [s, rows.filter((row) => row.status === s).length])); const report = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), targetCount: 16, mappedCount: targets.length, canaryPass, fullRequested: full, completedCount: statuses.ok + statuses.partial, pendingCount: 16 - statuses.ok - statuses.partial, statusCounts: statuses, fieldCoverage: Object.fromEntries(FIELDS.map((field) => [field, rows.filter((row) => row.validation?.fieldCoverage?.[field]).length])), health: { missingFieldCounts: Object.fromEntries(FIELDS.map((field) => [field, rows.filter((row) => !row.validation?.fieldCoverage?.[field]).length])) }, rows }; writeJson(paths.collection, report); return { discovery, report };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { const full = process.argv[2] === '--full'; runWonCollection({ full, onProgress: (entry) => console.log(`[won] ${entry.shortCode} ${entry.status}`) }).then(({ discovery, report }) => console.log(`[won] mapping=${discovery.metrics.mappedCount}/16 completed=${report.completedCount}/16 canary=${report.canaryPass}`)).catch((error) => { console.error(`[won] ${error.message}`); process.exitCode = 1; }); }
