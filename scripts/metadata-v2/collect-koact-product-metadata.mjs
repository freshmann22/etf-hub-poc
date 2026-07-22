import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'https://www.samsungactive.co.kr';
const TARGET_FIELDS = ['productDescription', 'investmentObjective', 'benchmarkName', 'benchmarkDescription', 'distributionPolicy'];
const SUCCESS = new Set(['ok', 'partial']);
const INTERVAL_MS = 1200;
const PARSER_VERSION = 'koact-product-parser-1.1.0';
export const KOACT_PRODUCT_PATHS = Object.freeze({
  gate: resolve(ROOT, 'data/reports/metadata-v2/koact-product-canary.json'),
  rawRoot: resolve(ROOT, 'data/raw/metadata-v2/koact-product'),
  canaryRawRoot: resolve(ROOT, 'data/raw/metadata-v2/koact-product-canary'),
  inventory: resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json'),
  ledger: resolve(ROOT, 'data/raw/metadata-v2/koact-product/ledger.jsonl'),
  report: resolve(ROOT, 'data/reports/metadata-v2/koact-product-collection.json'),
  csv: resolve(ROOT, 'data/reports/metadata-v2/koact-product-collection.csv'),
});

const sha256 = (body) => createHash('sha256').update(body).digest('hex');
const decodeEntities = (value) => String(value || '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp|middot);/gi, (_, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', middot: '·' })[entity.toLowerCase()]);
const normalize = (value) => decodeEntities(value).replace(/\s+/g, ' ').trim();
const challengeDetected = (body) => /cf-chl|challenge-platform|attention required|captcha/i.test(body);
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

function appendLedger(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

function latestByCode(entries) {
  const result = new Map();
  for (const entry of entries) result.set(entry.shortCode, entry);
  return result;
}

export function parseKoactProductPayload(payload, target, rawHash) {
  const product = payload?.info?.product || {};
  const identity = {
    shortCode: normalize(product.stkTicker),
    productId: normalize(product.fId),
    productName: normalize(product.fNm),
  };
  const identityValid = identity.shortCode === target.shortCode
    && identity.productId === target.productId
    && identity.productName === target.name;
  const points = Array.isArray(payload?.point?.investPoints) ? payload.point.investPoints : [];
  const objective = points.map((point) => {
    const title = normalize(point.title);
    const content = normalize(point.cn || point.htmlContent);
    return [title, content].filter(Boolean).join(': ');
  }).filter(Boolean).join('; ') || null;
  const metadata = {
    productDescription: normalize(product.fSummary) || null,
    investmentObjective: objective,
    benchmarkName: normalize(product.bmIdx) || null,
    benchmarkDescription: normalize(product.kodexinfoidxProperty) || null,
    distributionPolicy: normalize(product.dividRemark) || null,
  };
  const selectors = {
    productDescription: '$.info.product.fSummary',
    investmentObjective: '$.point.investPoints[*].{title,cn,htmlContent}',
    benchmarkName: '$.info.product.bmIdx',
    benchmarkDescription: '$.info.product.kodexinfoidxProperty',
    distributionPolicy: '$.info.product.dividRemark',
  };
  const provenance = Object.fromEntries(TARGET_FIELDS.map((field) => [field, metadata[field] ? {
    selector: selectors[field], snippet: metadata[field].slice(0, 500), rawHash,
  } : null]));
  const fieldCoverage = Object.fromEntries(TARGET_FIELDS.map((field) => [field, Boolean(metadata[field])]));
  const missingFields = TARGET_FIELDS.filter((field) => !fieldCoverage[field]);
  return {
    identity, identityValid, metadata, provenance, fieldCoverage, missingFields,
    populatedFieldCount: TARGET_FIELDS.length - missingFields.length,
  };
}

function persistRaw(paths, target, body, retrievedAt) {
  const hash = sha256(body);
  const folder = resolve(paths.rawRoot, 'pages', retrievedAt.slice(0, 10), target.shortCode);
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `${retrievedAt.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.json`);
  if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' });
  return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body), retrievedAt };
}

function findCanaryRaw(paths, target) {
  if (!existsSync(paths.canaryRawRoot)) return null;
  const candidates = [];
  for (const date of readdirSync(paths.canaryRawRoot, { withFileTypes: true })) {
    if (!date.isDirectory()) continue;
    const folder = resolve(paths.canaryRawRoot, date.name);
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      if (file.isFile() && file.name.startsWith(`${target.shortCode}.`) && file.name.endsWith('.json')) candidates.push(resolve(folder, file.name));
    }
  }
  const path = candidates.sort().at(-1);
  if (!path) return null;
  const body = readFileSync(path, 'utf8');
  return {
    body,
    raw: {
      path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash: sha256(body), bytes: Buffer.byteLength(body),
      retrievedAt: null, reusedFromCanary: true,
    },
  };
}

function buildEntry(target, body, raw, retrievedAt) {
  let payload;
  try { payload = JSON.parse(body); } catch { payload = null; }
  const parsed = parseKoactProductPayload(payload, target, raw.hash);
  const failures = [];
  if (!parsed.identityValid) failures.push('product_identity_mismatch');
  if (parsed.populatedFieldCount === 0) failures.push('no_target_metadata_fields');
  const pass = failures.length === 0;
  const status = !pass ? 'validation_failed' : parsed.missingFields.length ? 'partial' : 'ok';
  return {
    retrievedAt, sourceId: 'koact_official_product_api', issuerId: 'samsung-active-asset-management',
    parserVersion: PARSER_VERSION,
    shortCode: target.shortCode, isin: target.isin, name: target.name, productId: target.productId,
    status,
    validation: { pass, failures, missingFields: parsed.missingFields, fieldCoverage: parsed.fieldCoverage, identity: parsed.identity },
    metadata: parsed.metadata, provenance: parsed.provenance,
    raw: { ...raw, url: `${ORIGIN}/api/v1/product/etf/${encodeURIComponent(target.productId)}.do` },
  };
}

async function fetchProduct(target) {
  const url = `${ORIGIN}/api/v1/product/etf/${encodeURIComponent(target.productId)}.do`;
  const response = await fetch(url, { redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'etf-metadata-v2-collector/1.0' } });
  const body = await response.text();
  return { url, status: response.status, ok: response.ok, body, challenge: challengeDetected(body) };
}

function buildTargets(gate) {
  const mappings = gate.officialList?.reconciliation?.mappings || [];
  return mappings.filter((item) => item.matched).map((item) => ({
    shortCode: item.ticker, isin: null, name: item.officialName, productId: item.officialFId,
  }));
}

function buildReport(gate, entries, fullRequested, networkRequests, circuit) {
  const targets = buildTargets(gate);
  const targetCodes = new Set(targets.map((target) => target.shortCode));
  const rows = [...latestByCode(entries).values()].filter((entry) => targetCodes.has(entry.shortCode)).sort((a, b) => a.shortCode.localeCompare(b.shortCode));
  const statusCounts = Object.fromEntries(['ok', 'partial', 'validation_failed', 'failed', 'source_stopped'].map((status) => [status, rows.filter((row) => row.status === status).length]));
  return {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(),
    issuer: { id: 'samsung-active-asset-management', brand: 'KoAct' },
    contract: {
      targetCount: 23, excludedOfficialOnlyTickers: gate.officialList.reconciliation.officialOnly.map((item) => item.ticker),
      intervalMs: INTERVAL_MS, authenticationUsed: false, bypassUsed: false, rawAppendOnly: true,
      resumableLedger: true, circuitBreaker: ['403', '429', 'cloudflare_challenge'], fullRequested,
    },
    gate: { status: gate.decision.status, mapping: `${gate.officialList.reconciliation.matchedCount}/23`, canaryRequests: gate.probeContract.canaryRequests },
    networkRequestsThisRun: networkRequests,
    networkOriginatedArtifactCount: rows.filter((row) => row.raw?.path?.includes('/koact-product/pages/')).length,
    canaryCacheArtifactCount: rows.filter((row) => row.raw?.path?.includes('/koact-product-canary/')).length,
    attemptedUniqueCount: rows.length,
    completedCount: statusCounts.ok + statusCounts.partial,
    pendingCount: 23 - statusCounts.ok - statusCounts.partial,
    statusCounts,
    fieldCoverage: Object.fromEntries(TARGET_FIELDS.map((field) => [field, rows.filter((row) => row.validation?.fieldCoverage?.[field]).length])),
    circuit,
    decision: circuit.open ? 'collection_stopped_by_circuit_breaker' : rows.length === 23 ? 'local_23_collection_completed' : 'collection_incomplete',
    rows,
  };
}

function writeCsv(path, report) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [
    ['shortCode', 'name', 'productId', 'status', ...TARGET_FIELDS, 'rawHash', 'rawPath'].join(','),
    ...report.rows.map((row) => [row.shortCode, row.name, row.productId, row.status, ...TARGET_FIELDS.map((field) => row.metadata?.[field]), row.raw?.hash, row.raw?.path].map(quote).join(',')),
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export async function runKoactProductCollection({ paths = KOACT_PRODUCT_PATHS, intervalMs = INTERVAL_MS, onProgress = null } = {}) {
  const gate = JSON.parse(readFileSync(paths.gate, 'utf8'));
  if (gate.decision?.status !== 'four_canary_passed_awaiting_full_run_approval') throw new Error(`KoAct full gate not passed: ${gate.decision?.status}`);
  const targets = buildTargets(gate);
  if (targets.length !== 23 || targets.some((target) => target.shortCode === '0219B0')) throw new Error(`KoAct target guard failed: ${targets.length}`);
  const latest = latestByCode(readLedger(paths.ledger));
  const inventory = JSON.parse(readFileSync(paths.inventory, 'utf8'));
  const isinByCode = new Map(inventory.rows.filter((row) => row.brand === 'KoAct').map((row) => [row.identifiers.krxShortCodeCandidate, row.identifiers.isinCandidate || null]));
  for (const target of targets) target.isin = isinByCode.get(target.shortCode) || null;
  let networkRequests = 0;
  const circuit = { open: false, reason: null, shortCode: null, httpStatus: null };
  let lastNetworkAt = 0;

  for (const target of targets) {
    const prior = latest.get(target.shortCode);
    if (SUCCESS.has(prior?.status) && prior.parserVersion === PARSER_VERSION) continue;
    if (prior?.raw?.path && existsSync(resolve(ROOT, prior.raw.path))) {
      const body = readFileSync(resolve(ROOT, prior.raw.path), 'utf8');
      const retrievedAt = new Date().toISOString();
      const raw = { ...prior.raw, hash: sha256(body), bytes: Buffer.byteLength(body), reusedFromCache: true };
      const entry = buildEntry(target, body, raw, retrievedAt);
      appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry, 'raw-cache');
      continue;
    }
    const cachedCanary = findCanaryRaw(paths, target);
    if (cachedCanary) {
      const retrievedAt = new Date().toISOString();
      const entry = buildEntry(target, cachedCanary.body, { ...cachedCanary.raw, retrievedAt }, retrievedAt);
      appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry, 'canary-cache');
      continue;
    }
    const waitMs = Math.max(0, intervalMs - (Date.now() - lastNetworkAt));
    if (waitMs) await sleep(waitMs);
    let response;
    try { response = await fetchProduct(target); } catch (error) {
      const retrievedAt = new Date().toISOString();
      const entry = { retrievedAt, sourceId: 'koact_official_product_api', ...target, status: 'failed', validation: { pass: false, failures: [error.message], missingFields: TARGET_FIELDS, fieldCoverage: {} }, metadata: null, provenance: null, raw: null };
      appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry, 'network');
      continue;
    }
    lastNetworkAt = Date.now(); networkRequests += 1;
    if ([403, 429].includes(response.status) || response.challenge) {
      circuit.open = true; circuit.reason = response.challenge ? 'cloudflare_challenge' : `http_${response.status}`;
      circuit.shortCode = target.shortCode; circuit.httpStatus = response.status;
      const entry = { retrievedAt: new Date().toISOString(), sourceId: 'koact_official_product_api', ...target, status: 'source_stopped', validation: { pass: false, failures: [circuit.reason], missingFields: TARGET_FIELDS, fieldCoverage: {} }, metadata: null, provenance: null, raw: null };
      appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry, 'network');
      break;
    }
    const retrievedAt = new Date().toISOString();
    const raw = persistRaw(paths, target, response.body, retrievedAt);
    const entry = response.ok ? buildEntry(target, response.body, raw, retrievedAt) : {
      retrievedAt, sourceId: 'koact_official_product_api', ...target, status: 'failed',
      validation: { pass: false, failures: [`http_${response.status}`], missingFields: TARGET_FIELDS, fieldCoverage: {} },
      metadata: null, provenance: null, raw: { ...raw, url: response.url },
    };
    appendLedger(paths.ledger, entry); latest.set(target.shortCode, entry); onProgress?.(entry, 'network');
  }

  const report = buildReport(gate, readLedger(paths.ledger), true, networkRequests, circuit);
  writeJsonAtomic(paths.report, report);
  writeCsv(paths.csv, report);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runKoactProductCollection({ onProgress: (entry, mode) => console.log(`[koact-product] ${entry.shortCode} ${entry.status} ${mode}`) })
    .then((report) => console.log(`[koact-product] completed=${report.completedCount}/23 networkThisRun=${report.networkRequestsThisRun} decision=${report.decision}`))
    .catch((error) => { console.error(`[koact-product] ${error.message}`); process.exitCode = 1; });
}
