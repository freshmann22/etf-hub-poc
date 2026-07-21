import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DartClient } from './providers/dart-client.mjs';
import { matchLatestProspectus, normalizeDartText } from './providers/dart-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BEGIN_DATE = process.env.DART_INDEX_BEGIN_DATE || '20250101';
const END_DATE = process.env.DART_INDEX_END_DATE || new Date().toISOString().slice(0, 10).replaceAll('-', '');
const RAW_ROOT = resolve(ROOT, 'data/raw/metadata-v2/dart-disclosure-index');
const OUTPUT = resolve(ROOT, 'data/reports/metadata-v2/dart-disclosure-index.json');

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }

async function apiKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY;
  const env = await readFile(resolve(ROOT, '.env'), 'utf8');
  return env.match(/^\s*DART_API_KEY\s*=\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]?.trim() || null;
}

function findCorp(issuer, corpCodes) {
  const names = [issuer.legalNameKo, issuer.displayNameKo, ...(issuer.aliases || [])].map(normalizeDartText);
  for (const name of names) {
    const match = corpCodes.find((corp) => normalizeDartText(corp.corpName) === name);
    if (match) return match;
  }
  return null;
}

async function main() {
  const key = await apiKey();
  if (!key) throw new Error('DART_API_KEY is missing');
  const [identityMap, registry] = await Promise.all([
    json(resolve(ROOT, 'data/normalized/etf-identity-map-v2.json')),
    json(resolve(ROOT, 'config/issuer-registry.json')),
  ]);
  const client = new DartClient({ apiKey: key, maxCalls: 500, minIntervalMs: 1200 });
  const corpCodes = await client.getCorpCodes();
  await mkdir(RAW_ROOT, { recursive: true });
  const disclosureByIssuer = new Map();
  const issuers = [];

  for (const issuer of registry.issuers) {
    const targets = identityMap.records.filter((row) => row.identity?.issuerId === issuer.id);
    if (!targets.length) continue;
    const corp = findCorp(issuer, corpCodes);
    if (!corp) {
      issuers.push({ issuerId: issuer.id, targetCount: targets.length, status: 'corp_unresolved', disclosureCount: 0 });
      disclosureByIssuer.set(issuer.id, []);
      continue;
    }
    const cachePath = resolve(RAW_ROOT, `${issuer.id}-${corp.corpCode}-${BEGIN_DATE}-${END_DATE}.json`);
    const legacyCachePath = resolve(RAW_ROOT, `${issuer.id}-${BEGIN_DATE}-${END_DATE}.json`);
    let snapshot;
    if (existsSync(cachePath)) {
      snapshot = await json(cachePath);
    } else if (existsSync(legacyCachePath) && (await json(legacyCachePath)).corpCode === corp.corpCode) {
      snapshot = await json(legacyCachePath);
    } else {
      const result = await client.listFundDisclosures({ corpCode: corp.corpCode, beginDate: BEGIN_DATE, endDate: END_DATE, maxPages: 100 });
      snapshot = { schemaVersion: '1.0.0', issuerId: issuer.id, corpCode: corp.corpCode, corpName: corp.corpName, beginDate: BEGIN_DATE, endDate: END_DATE, ...result };
      await writeFile(cachePath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    disclosureByIssuer.set(issuer.id, snapshot.rows || []);
    issuers.push({ issuerId: issuer.id, targetCount: targets.length, status: snapshot.truncated ? 'truncated' : 'ok', disclosureCount: snapshot.rows?.length || 0, totalCount: snapshot.totalCount, pagesFetched: snapshot.pagesFetched, cachePath: cachePath.slice(ROOT.length + 1).replaceAll('\\', '/') });
  }

  const rows = identityMap.records.map((record) => {
    if (!record.identity?.issuerId || !record.identity?.officialName) return { universeKey: record.universeKey, status: 'quarantine', reason: 'official_identity_unresolved', match: null };
    const result = matchLatestProspectus({ name: record.identity.officialName }, disclosureByIssuer.get(record.identity.issuerId) || []);
    return {
      universeKey: record.universeKey, shortCode: record.identity.shortCode, officialName: record.identity.officialName,
      issuerId: record.identity.issuerId, status: result.matched ? 'mapped' : 'quarantine', reason: result.matched ? null : 'no_unambiguous_full_prospectus_in_window',
      candidateCount: result.candidateCount,
      match: result.match ? { receptionNo: result.match.rcept_no, receptionDate: result.match.rcept_dt, reportName: result.match.report_nm, viewerUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${result.match.rcept_no}` } : null,
    };
  });
  const mapped = rows.filter((row) => row.status === 'mapped').length;
  const report = {
    schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), scope: { universeCount: rows.length, beginDate: BEGIN_DATE, endDate: END_DATE, source: 'OpenDART list API', requestIntervalMs: 1200, apiKeyStored: false },
    metrics: { universeCount: rows.length, mappedCount: mapped, mappedRate: Number((mapped / rows.length).toFixed(6)), quarantineCount: rows.length - mapped, issuerCount: issuers.length, apiCallsThisRun: client.callCount },
    issuers, rows,
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT, metrics: report.metrics }, null, 2));
}

main().catch((error) => { console.error(`[dart-index] ${error.message}`); process.exitCode = 1; });
