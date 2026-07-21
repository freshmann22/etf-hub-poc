import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DartClient } from './providers/dart-client.mjs';
import { matchLatestProspectus, normalizeDartText } from './providers/dart-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_API_CALLS = 64;
const CANARY_BRANDS = ['KODEX', 'TIGER', 'RISE', 'ACE', 'PLUS', 'SOL', 'KIWOOM', 'HANARO'];
const BEGIN_DATE = '20260501';
const END_DATE = '20260721';
const OUTPUT = resolve(ROOT, 'data/reports/metadata-v2/dart-probe.json');

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

async function loadEnvKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY;
  const text = await readFile(resolve(ROOT, '.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*DART_API_KEY\s*=\s*(.*)\s*$/);
    if (match) return match[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return null;
}

function selectCanaries(master) {
  return CANARY_BRANDS.flatMap((brand) => master.etfs
    .filter((row) => row.name.startsWith(`${brand} `) && /^[0-9A-Z]{6}$/.test(row.etfCode) && /[A-Z]/.test(row.etfCode))
    .sort((a, b) => b.etfCode.localeCompare(a.etfCode))
    .slice(0, 3)
    .map((row) => ({ etfCode: row.etfCode, name: row.name, brand })));
}

function findCorp(issuer, corpCodes) {
  const names = [issuer.legalNameKo, issuer.displayNameKo, ...(issuer.aliases || [])].map(normalizeDartText);
  for (const name of names) {
    const match = corpCodes.find((row) => normalizeDartText(row.corpName) === name);
    if (match) return match;
  }
  return null;
}

async function main() {
  const apiKey = await loadEnvKey();
  if (!apiKey) throw new Error('DART_API_KEY is missing');
  const [master, registry] = await Promise.all([
    readJson(resolve(ROOT, 'data/normalized/etf-master.json')),
    readJson(resolve(ROOT, 'config/issuer-registry.json')),
  ]);
  const canaries = selectCanaries(master);
  if (canaries.length !== 24) throw new Error(`expected 24 DART canaries, got ${canaries.length}`);
  const issuerByBrand = new Map(registry.issuers.flatMap((issuer) => issuer.brands.map((brand) => [brand, issuer])));
  const client = new DartClient({ apiKey, maxCalls: MAX_API_CALLS });
  const corpCodes = await client.getCorpCodes();
  const disclosureByBrand = new Map();
  const issuerProbes = [];

  for (const brand of CANARY_BRANDS) {
    const issuer = issuerByBrand.get(brand);
    const corp = findCorp(issuer, corpCodes);
    if (!corp) {
      disclosureByBrand.set(brand, []);
      issuerProbes.push({ brand, issuerId: issuer.id, corpCodeResolved: false, disclosureCountFetched: 0 });
      continue;
    }
    const result = await client.listFundDisclosures({ corpCode: corp.corpCode, beginDate: BEGIN_DATE, endDate: END_DATE, maxPages: 8 });
    disclosureByBrand.set(brand, result.rows);
    issuerProbes.push({
      brand,
      issuerId: issuer.id,
      corpName: corp.corpName,
      corpCode: corp.corpCode,
      corpCodeResolved: true,
      disclosureCountFetched: result.rows.length,
      totalCount: result.totalCount,
      pagesFetched: result.pagesFetched,
      truncated: Boolean(result.truncated),
    });
  }

  const matches = canaries.map((canary) => {
    const result = matchLatestProspectus(canary, disclosureByBrand.get(canary.brand) || []);
    return {
      ...canary,
      matched: result.matched,
      matchMethod: result.method,
      candidateCount: result.candidateCount,
      report: result.match ? {
        reportName: result.match.report_nm,
        receptionNo: result.match.rcept_no,
        receptionDate: result.match.rcept_dt,
        viewerUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${result.match.rcept_no}`,
      } : null,
      documentProbe: null,
    };
  });

  for (const row of matches.filter((item) => item.matched)) {
    try {
      row.documentProbe = await client.probeDocument(row.report.receptionNo);
    } catch (error) {
      row.documentProbe = {
        accessible: false,
        errorClass: error.name || 'Error',
        errorCode: error.dartStatus ? `dart_status_${error.dartStatus}` : 'archive_or_transport_error',
      };
    }
  }

  const matchedCount = matches.filter((row) => row.matched).length;
  const documentAccessibleCount = matches.filter((row) => row.documentProbe?.accessible).length;
  const report = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    probeContract: {
      source: 'OpenDART official API',
      sourceUrl: 'https://opendart.fss.or.kr/guide/main.do?apiGrpCd=DS001',
      scope: '24 ETF canaries; issuer corp_code search; no full-universe collection',
      beginDate: BEGIN_DATE,
      endDate: END_DATE,
      canaryCount: canaries.length,
      issuerCount: CANARY_BRANDS.length,
      maxApiCalls: MAX_API_CALLS,
      actualApiCalls: client.callCount,
      rawResponsesStored: false,
      credentialsStoredOrLogged: false,
    },
    metrics: {
      corpCodeResolvedIssuerCount: issuerProbes.filter((row) => row.corpCodeResolved).length,
      formalNameMatchedCount: matchedCount,
      formalNameMatchRatio: Number((matchedCount / canaries.length).toFixed(6)),
      originalDocumentAccessibleCount: documentAccessibleCount,
      originalDocumentAccessRatioOfAllCanaries: Number((documentAccessibleCount / canaries.length).toFixed(6)),
      originalDocumentAccessRatioOfMatched: matchedCount ? Number((documentAccessibleCount / matchedCount).toFixed(6)) : 0,
    },
    limitations: [
      'The probe reads at most eight 100-row pages per issuer in the bounded date window; truncation is reported per issuer.',
      'Matching requires normalized containment of the local ETF name in a full investment prospectus report name.',
      'Original ZIP files are opened only to verify the download contract; document bodies are not persisted or parsed.',
      'No API key, request URL containing a key, or raw API response is written to this report.'
    ],
    issuerProbes,
    canaries: matches,
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: OUTPUT, metrics: report.metrics, actualApiCalls: client.callCount, maxApiCalls: MAX_API_CALLS }, null, 2));
}

main().catch((error) => {
  console.error(`[metadata-v2:dart-probe] ${error.message}`);
  process.exitCode = 1;
});
