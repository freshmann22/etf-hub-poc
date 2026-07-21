import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AccessBlockedError, HostLimitedHttpClient, PersistentRateLimitError } from './collect-official-holdings.mjs';
import { parseSolDistributionHistoryJson, validateSolDividendJsContract } from './providers/sol-distribution-history.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = { productLedger: resolve(ROOT, 'data/raw/metadata-v2/sol-product/ledger.jsonl'), rawRoot: resolve(ROOT, 'data/raw/metadata-v2/sol-distribution-history'), ledger: resolve(ROOT, 'data/raw/metadata-v2/sol-distribution-history/ledger.jsonl'), policy: resolve(ROOT, 'data/reports/metadata-v2/sol-distribution-history-policy.json'), canary: resolve(ROOT, 'data/reports/metadata-v2/sol-distribution-history-canary.json'), collection: resolve(ROOT, 'data/reports/metadata-v2/sol-distribution-history-collection.json') };
const ORIGIN = 'https://www.soletf.com';
const CANARIES = new Set(['0005D0', '220130', '292500', '433330']);
const TERMINAL = new Set(['ok', 'partial', 'no_history']);
const readLedger = (path) => !existsSync(path) ? [] : readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const latest = (rows) => new Map(rows.map((row) => [row.shortCode, row]));
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function append(path, value) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8'); }
function persist(paths, role, key, body, at, extension) { const hash = createHash('sha256').update(body).digest('hex'); const dir = resolve(paths.rawRoot, role, at.slice(0, 10), key); mkdirSync(dir, { recursive: true }); const path = resolve(dir, `${at.replace(/[:.]/g, '-')}.${hash.slice(0, 16)}.${extension}`); if (!existsSync(path)) writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' }); return { path: path.slice(ROOT.length + 1).replaceAll('\\', '/'), hash, bytes: Buffer.byteLength(body) }; }

export function buildSolDistributionTargets(productLedgerRows) {
  const rows = [...latest(productLedgerRows.filter((row) => ['ok', 'partial'].includes(row.status))).values()].map((row) => ({ issuerId: row.issuerId, shortCode: row.shortCode, isin: row.isin || null, name: row.name, productId: row.productId, productUrl: row.productUrl }));
  return rows.sort((a, b) => a.shortCode.localeCompare(b.shortCode));
}

async function collectOne(client, paths, target, contractRaw) {
  const retrievedAt = new Date().toISOString(); const url = `${ORIGIN}/api/etf/pds/dividend/${target.productId}`;
  try {
    const response = await client.request(url, { timeoutMs: 30000, headers: { accept: 'application/json', referer: target.productUrl } });
    const raw = { ...persist(paths, 'responses', target.shortCode, response.body, retrievedAt, 'json'), url };
    const parsed = parseSolDistributionHistoryJson(response.body, { expectedProductId: target.productId, retrievedAt });
    const nameMatches = typeof parsed.fundName === 'string' && parsed.fundName.normalize('NFKC').replace(/\s+/g, '') === target.name.normalize('NFKC').replace(/\s+/g, '');
    const failures = []; if (parsed.status === 'invalid_json') failures.push('invalid_json'); if (parsed.events.length && !nameMatches) failures.push('fund_name_mismatch');
    const status = failures.length ? 'validation_failed' : parsed.events.length ? 'partial' : parsed.rejectedRows.length ? 'validation_failed' : 'no_history';
    return { retrievedAt, sourceId: 'sol_official_distribution_history_api', ...target, status, validation: { pass: failures.length === 0, failures, eventCount: parsed.events.length, rejectedRowCount: parsed.rejectedRows.length, currency: parsed.events.every((event) => event.currency === 'KRW') ? 'KRW' : null, perUnitBasis: null, nameMatches }, history: parsed.events, evidence: parsed.evidence, rejectedRows: parsed.rejectedRows, raw: { ...raw, contract: contractRaw } };
  } catch (error) {
    const stopped = error instanceof PersistentRateLimitError || error instanceof AccessBlockedError;
    return { retrievedAt, sourceId: 'sol_official_distribution_history_api', ...target, status: stopped ? 'source_stopped' : 'failed', validation: { pass: false, failures: [String(error.message || error)], eventCount: 0, rejectedRowCount: 0, currency: null, perUnitBasis: null, nameMatches: null }, history: [], evidence: null, rejectedRows: [], raw: null };
  }
}

export async function runSolDistributionHistoryCollection({ full = false, paths = PATHS, client = null, onProgress = null } = {}) {
  const http = client || new HostLimitedHttpClient({ intervalMs: 1200 });
  const policyAt = new Date().toISOString();
  const robotsResponse = await http.request(`${ORIGIN}/robots.txt`, { timeoutMs: 30000, headers: { accept: 'text/plain' } });
  const robotsRaw = { ...persist(paths, 'policy', 'robots', robotsResponse.body, policyAt, 'txt'), url: `${ORIGIN}/robots.txt` };
  const jsResponse = await http.request(`${ORIGIN}/static/pc/js/ko/etf_pds.js`, { timeoutMs: 30000, headers: { accept: 'text/javascript' } });
  const jsAt = new Date().toISOString(); const contractRaw = { ...persist(paths, 'contract', 'etf_pds', jsResponse.body, jsAt, 'js'), url: `${ORIGIN}/static/pc/js/ko/etf_pds.js` }; const contract = validateSolDividendJsContract(jsResponse.body);
  const policyAllowed = /Allow:\s*\//i.test(robotsResponse.body) && Object.values(contract).slice(0, 5).every(Boolean);
  writeJson(paths.policy, { schemaVersion: '1.0.0', generatedAt: jsAt, decision: policyAllowed ? 'allowed_low_rate_official_api' : 'blocked_policy_or_contract', apiCallsBeforeDecision: 0, robots: { observed: robotsResponse.body.trim(), raw: robotsRaw }, officialUiContract: { ...contract, raw: contractRaw }, interpretation: { dateFields: 'WORK_DT is 지급기준일; DIVIDEND_DT is 실제지급일', amountCurrency: 'DIVIDEND_PRI under popup header 분배금액(원), therefore KRW', perUnit: 'not explicit; stored null and record status partial', scheduleExcluded: true }, guardrails: { intervalMs: 1200, sameOriginOnly: true, authentication: false, circuitBreaker: ['403', 'persistent_429'] } });
  if (!policyAllowed) throw new Error('SOL dividend policy/contract guard failed');
  const targets = buildSolDistributionTargets(readLedger(paths.productLedger));
  if (targets.length !== 77) throw new Error(`SOL distribution target guard expected 77, found ${targets.length}`);
  let seen = latest(readLedger(paths.ledger)); const canaries = targets.filter((row) => CANARIES.has(row.shortCode));
  for (const target of canaries) { let entry = seen.get(target.shortCode); if (!TERMINAL.has(entry?.status)) { entry = await collectOne(http, paths, target, contractRaw); append(paths.ledger, entry); seen.set(target.shortCode, entry); onProgress?.(entry); } if (entry.status === 'source_stopped') break; }
  const canaryRows = canaries.flatMap((row) => seen.has(row.shortCode) ? [seen.get(row.shortCode)] : []); const historyRows = canaryRows.filter((row) => row.history?.length); const canaryPass = canaryRows.length === 4 && canaryRows.every((row) => TERMINAL.has(row.status)) && historyRows.length > 0 && historyRows.every((row) => row.validation.pass && row.history.every((event) => event.recordDate && event.payDate && event.amount > 0 && event.currency === 'KRW' && event.perUnit === null));
  writeJson(paths.canary, { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), pass: canaryPass, expectedCount: 4, attemptedCount: canaryRows.length, historyBearingCount: historyRows.length, fieldValidation: { recordDate: true, actualPayDate: true, positiveAmount: true, currency: 'KRW', perUnit: null, perUnitReason: 'not explicit in official UI contract' }, rows: canaryRows });
  if (full && canaryPass) for (const target of targets) { if (TERMINAL.has(seen.get(target.shortCode)?.status)) continue; const entry = await collectOne(http, paths, target, contractRaw); append(paths.ledger, entry); seen.set(target.shortCode, entry); onProgress?.(entry); if (entry.status === 'source_stopped') break; }
  const rows = [...latest(readLedger(paths.ledger)).values()].filter((row) => targets.some((target) => target.shortCode === row.shortCode)); const statusCounts = Object.fromEntries(['ok', 'partial', 'no_history', 'validation_failed', 'failed', 'source_stopped'].map((status) => [status, rows.filter((row) => row.status === status).length])); const report = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), targetCount: 77, attemptedCount: rows.length, completedCount: statusCounts.ok + statusCounts.partial + statusCounts.no_history, pendingCount: 77 - statusCounts.ok - statusCounts.partial - statusCounts.no_history, canaryPass, fullRequested: full, statusCounts, historyBearingCount: rows.filter((row) => row.history?.length).length, eventCount: rows.reduce((n, row) => n + (row.history?.length || 0), 0), explicitCurrencyCount: rows.filter((row) => row.history?.some((event) => event.currency === 'KRW')).length, explicitPerUnitCount: rows.filter((row) => row.history?.some((event) => event.perUnit != null)).length, perUnitUnknownCount: rows.filter((row) => row.history?.length && row.history.every((event) => event.perUnit == null)).length, contract: { intervalMs: 1200, rawAppendOnly: true, resumableLedger: true, scheduleExcluded: true }, rows }; writeJson(paths.collection, report); return { canaryPass, report };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { const full = process.argv[2] === '--full'; runSolDistributionHistoryCollection({ full, onProgress: (entry) => console.log(`[sol-distribution] ${entry.shortCode} ${entry.status} events=${entry.history.length}`) }).then(({ canaryPass, report }) => console.log(`[sol-distribution] canary=${canaryPass} completed=${report.completedCount}/77 history=${report.historyBearingCount} events=${report.eventCount}`)).catch((error) => { console.error(`[sol-distribution] ${error.message}`); process.exitCode = 1; }); }
