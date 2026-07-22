import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { Hana1qProductAdapter } from './providers/hana-1q-product.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = { inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'), rawRoot: resolve(ROOT, 'data/raw/metadata-v2/hana-1q-product'), ledger: resolve(ROOT, 'data/raw/metadata-v2/hana-1q-product/ledger.jsonl'), selection: resolve(ROOT, 'data/reports/metadata-v2/issuer-selection-policy.json'), discovery: resolve(ROOT, 'data/reports/metadata-v2/hana-1q-discovery.json'), canary: resolve(ROOT, 'data/reports/metadata-v2/hana-1q-canary.json'), collection: resolve(ROOT, 'data/reports/metadata-v2/hana-1q-collection.json') };
const CANARIES = new Set(['0004G0', '0026S0', '451060', '491610']);
const FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];
const SUCCESS = new Set(['ok', 'partial']);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ledger = (path) => !existsSync(path) ? [] : readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const latest = (rows) => new Map(rows.map((row) => [row.shortCode, row]));
const norm = (value) => String(value || '').normalize('NFKC').replace(/[^0-9a-zA-Z가-힣&+]/g, '').toLowerCase();
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function append(path, value) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8'); }
function persist(paths, role, key, body, at) { const hash = createHash('sha256').update(body).digest('hex'); const dir = resolve(paths.rawRoot, role, at.slice(0, 10), key); mkdirSync(dir, { recursive: true }); const path = resolve(dir, `${at.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.html`); if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' }); return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body) }; }

export function reconcileHana1q(inventory, discovered) {
  const byName = new Map(discovered.map((row) => [norm(row.name), row]));
  const mappings = inventory.map((target) => { const source = byName.get(norm(target.name)); return { ...target, productId: source?.productId || null, sourceName: source?.name || null, productUrl: source?.productUrl || null, status: source ? 'mapped' : 'missing' }; });
  const mappedCount = mappings.filter((row) => row.status === 'mapped').length;
  return { mappings, metrics: { inventoryCount: inventory.length, discoveredCount: discovered.length, mappedCount, missingCount: inventory.length - mappedCount, coverageRatio: Number((mappedCount / inventory.length).toFixed(6)) } };
}

function validate(target, parsed, rawHash) {
  const failures = [];
  if (!parsed.identity.expectedNameMatches) failures.push('name_mismatch');
  if (!parsed.identity.expectedTickerMatches) failures.push('ticker_mismatch');
  const metadata = { productDescription: parsed.description, investmentObjective: parsed.investmentObjective, benchmarkName: parsed.benchmark.name, benchmarkDescription: parsed.benchmark.description, distributionPolicy: parsed.distributionPolicy, officialDocumentLinks: parsed.officialDocumentLinks.map((link) => link.href) };
  const coverage = Object.fromEntries([...FIELDS, 'officialDocumentLinks'].map((field) => [field, field === 'officialDocumentLinks' ? metadata[field].length > 0 : Boolean(metadata[field])]));
  const proof = (value, selector) => value ? { selector, snippet: value, rawHash } : null;
  const provenance = { productDescription: proof(metadata.productDescription, '.no-etfInfo__cnt.etfInfo'), investmentObjective: proof(metadata.investmentObjective, '.no-etfInfo__cnt.etfInfo'), benchmarkName: proof(metadata.benchmarkName, '.no-etfInfo__index-title'), benchmarkDescription: proof(metadata.benchmarkDescription, '.no-etfInfo__desc'), distributionPolicy: proof(metadata.distributionPolicy, '.no-etfInfo__item-data'), officialDocumentLinks: parsed.officialDocumentLinks.map((link) => ({ selector: 'a[href*="etf.file.download.php"]', snippet: link.label, href: link.href, rawHash })) };
  if (!FIELDS.some((field) => coverage[field])) failures.push('no_populated_metadata');
  return { pass: failures.length === 0, failures, missingFields: [...FIELDS, 'officialDocumentLinks'].filter((field) => !coverage[field]), fieldCoverage: coverage, metadata, provenance };
}

async function collectOne(adapter, paths, target) {
  const retrievedAt = new Date().toISOString();
  try { const result = await adapter.collect(target); const raw = { ...persist(paths, 'pages', target.shortCode, result.raw.body, retrievedAt), url: result.raw.url }; const v = validate(target, result.parsed, raw.hash); return { retrievedAt, sourceId: adapter.sourceId, ...target, status: !v.pass ? 'validation_failed' : v.missingFields.length ? 'partial' : 'ok', validation: { pass: v.pass, failures: v.failures, missingFields: v.missingFields, fieldCoverage: v.fieldCoverage }, metadata: v.metadata, provenance: v.provenance, raw }; }
  catch (error) { const stop = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError; return { retrievedAt, sourceId: adapter.sourceId, ...target, status: stop ? 'source_stopped' : 'failed', validation: { pass: false, failures: [String(error.message || error)], missingFields: FIELDS, fieldCoverage: {} }, metadata: null, provenance: null, raw: null }; }
}

export async function runHana1qCollection({ full = false, paths = PATHS, adapter = null, onProgress = null } = {}) {
  writeJson(paths.selection, { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), selected: 'hana-asset-management', candidates: [ { issuer: 'korea-investment-management', brand: 'ACE', inventoryCount: 109, productCalls: 0, decision: 'blocked_permission_unclear', evidence: 'robots allows public paths but terms body was not reliably observable in prior audit' }, { issuer: 'hana-asset-management', brand: '1Q', inventoryCount: 26, decision: 'allowed_low_volume_local_poc', evidence: 'public terms pages observable; no general automated product-access prohibition; automated email-address collection alone is prohibited' }, { issuer: 'samsung-active-asset-management', brand: 'KoAct', inventoryCount: 23, productCalls: 0, decision: 'not_needed_after_selection' }, { issuer: 'timefolio-asset-management', brand: 'TIME', inventoryCount: 19, productCalls: 0, decision: 'not_needed_after_selection' } ], guardrails: { intervalMs: 1200, sameOriginOnly: true, authentication: false, circuitBreaker: ['403', 'persistent_429'] } });
  const inv = json(paths.inventory).rows.filter((row) => row.issuer?.id === 'hana-asset-management').map((row) => ({ issuerId: row.issuer.id, shortCode: row.identifiers.krxShortCodeCandidate, isin: row.identifiers.isinCandidate || null, name: row.sourceRecord.name }));
  if (inv.length !== 26) throw new Error(`1Q inventory guard expected 26, found ${inv.length}`);
  const a = adapter || new Hana1qProductAdapter(new HostLimitedHttpClient({ intervalMs: 1200 }));
  const found = await a.discover(); const at = new Date().toISOString(); const raw = { ...persist(paths, 'discovery', 'list', found.raw.body, at), url: found.raw.url }; const rec = reconcileHana1q(inv, found.rows); const discovery = { schemaVersion: '1.0.0', generatedAt: at, raw, ...rec, scaleDecision: rec.metrics.coverageRatio >= 0.95 ? 'mapping_pass' : 'blocked_mapping' }; writeJson(paths.discovery, discovery);
  const targets = rec.mappings.filter((row) => row.status === 'mapped'); const canaries = targets.filter((row) => CANARIES.has(row.shortCode)); let seen = latest(ledger(paths.ledger));
  if (rec.metrics.coverageRatio >= 0.95 && canaries.length === 4) for (const target of canaries) { let e = seen.get(target.shortCode); if (!SUCCESS.has(e?.status)) { e = await collectOne(a, paths, target); append(paths.ledger, e); seen.set(target.shortCode, e); onProgress?.(e); } if (e.status === 'source_stopped') break; }
  const canaryRows = canaries.flatMap((row) => seen.has(row.shortCode) ? [seen.get(row.shortCode)] : []); const fieldCoverage = Object.fromEntries(FIELDS.map((field) => [field, canaryRows.filter((row) => row.validation?.fieldCoverage?.[field]).length])); const canaryPass = canaryRows.length === 4 && canaryRows.every((row) => SUCCESS.has(row.status)) && FIELDS.every((field) => fieldCoverage[field] === 4); writeJson(paths.canary, { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), pass: canaryPass, fieldCoverage, rows: canaryRows });
  if (full && canaryPass) for (const target of targets) { if (SUCCESS.has(seen.get(target.shortCode)?.status)) continue; const e = await collectOne(a, paths, target); append(paths.ledger, e); seen.set(target.shortCode, e); onProgress?.(e); if (e.status === 'source_stopped') break; }
  const rows = [...latest(ledger(paths.ledger)).values()].filter((row) => inv.some((x) => x.shortCode === row.shortCode)); const statuses = Object.fromEntries(['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'].map((s) => [s, rows.filter((row) => row.status === s).length])); const report = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), targetCount: 26, mappedCount: targets.length, canaryPass, fullRequested: full, completedCount: statuses.ok + statuses.partial, pendingCount: 26 - statuses.ok - statuses.partial, statusCounts: statuses, fieldCoverage: Object.fromEntries(FIELDS.map((field) => [field, rows.filter((row) => row.validation?.fieldCoverage?.[field]).length])), health: { missingFieldCounts: Object.fromEntries(FIELDS.map((field) => [field, rows.filter((row) => !row.validation?.fieldCoverage?.[field]).length])) }, rows }; writeJson(paths.collection, report); return { discovery, report };
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { const full = process.argv[2] === '--full'; runHana1qCollection({ full, onProgress: (e) => console.log(`[1q] ${e.shortCode} ${e.status}`) }).then(({ discovery, report }) => console.log(`[1q] mapping=${discovery.metrics.mappedCount}/26 completed=${report.completedCount}/26 canary=${report.canaryPass}`)).catch((error) => { console.error(`[1q] ${error.message}`); process.exitCode = 1; }); }
