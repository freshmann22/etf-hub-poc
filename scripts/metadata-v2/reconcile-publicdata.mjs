import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicDataProvider } from '../../server/providers/publicdata/index.js';
import { config } from '../../server/config.js';
import {
  AppendOnlyRawStore,
  ResumableLedger,
  makeFieldCandidate,
  makeProvenance,
  resolveIdentities,
} from './lib/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MASTER_PATH = resolve(ROOT, 'data/normalized/etf-master.json');
const INVENTORY_PATH = resolve(ROOT, 'data/reports/metadata-v2/issuer-inventory.json');
const RAW_ROOT = resolve(ROOT, 'data/raw/metadata-v2');
const LEDGER_PATH = resolve(RAW_ROOT, 'ledger.json');
const IDENTITY_OUT = resolve(ROOT, 'data/normalized/etf-identity-map-v2.json');
const REPORT_OUT = resolve(ROOT, 'data/reports/metadata-v2/publicdata-reconciliation.json');
const SOURCE_URL = 'https://www.data.go.kr/data/15094806/openapi.do';
const PARSER_VERSION = 'publicdata-identity-v2.0.0';

export function buildReconciliation({ master, inventory, officialRows, rawEntry, retrievedAt, asOfDate }) {
  const inventoryByCode = new Map((inventory?.rows || []).map((row) => [
    row.identifiers?.krxShortCodeCandidate ?? row.sourceRecord?.etfCode ?? row.shortCode,
    row,
  ]));
  const official = officialRows.map((row) => ({
    shortCode: row.code,
    isin: row.isin,
    officialName: row.name,
    benchmarkName: row.indexName ?? null,
  }));
  const universe = master.etfs.map((row) => ({
    universeKey: row.etfCode,
    shortCode: row.etfCode,
    name: row.name,
    issuerId: inventoryByCode.get(row.etfCode)?.issuer?.id ?? inventoryByCode.get(row.etfCode)?.issuer?.issuerId ?? null,
    issuerName: inventoryByCode.get(row.etfCode)?.issuer?.displayNameKo ?? null,
  }));
  const resolved = resolveIdentities(universe, official);
  const resolvedByKey = new Map(resolved.records.map((row) => [row.universeKey, row]));
  const officialByCode = new Map(officialRows.map((row) => [row.code, row]));
  const masterCodes = new Set(master.etfs.map((row) => row.etfCode));

  const publicdataProvenance = makeProvenance({
    sourceId: 'publicdata',
    sourceType: 'primary',
    url: SOURCE_URL,
    documentType: 'official_etf_price_bulk',
    retrievedAt,
    asOfDate,
    rawSnapshotPath: rawEntry.path,
    contentHash: rawEntry.contentHash,
    parserVersion: PARSER_VERSION,
    status: 'ok',
    confidence: 0.98,
  });

  const rows = master.etfs.map((masterRow) => {
    const code = masterRow.etfCode;
    const match = resolvedByKey.get(code) ?? null;
    const officialRow = officialByCode.get(code) ?? null;
    const issuerRow = inventoryByCode.get(code) ?? null;
    const candidates = [];
    if (officialRow) {
      candidates.push(
        makeFieldCandidate({ field: 'identity.shortCode', value: officialRow.code, provenance: publicdataProvenance }),
        makeFieldCandidate({ field: 'identity.isin', value: officialRow.isin, provenance: publicdataProvenance }),
        makeFieldCandidate({ field: 'identity.officialName', value: officialRow.name, provenance: publicdataProvenance }),
        makeFieldCandidate({ field: 'product.benchmark.name', value: officialRow.indexName ?? null, provenance: publicdataProvenance }),
      );
    }
    return {
      universeKey: code,
      sourceRecord: masterRow,
      identity: {
        shortCode: match?.shortCode ?? code,
        isin: match?.isin ?? issuerRow?.identifiers?.isinCandidate ?? null,
        officialName: match?.officialName ?? masterRow.name,
        issuerId: issuerRow?.issuer?.id ?? issuerRow?.issuer?.issuerId ?? null,
        issuerName: issuerRow?.issuer?.displayNameKo ?? null,
        matchMethod: match?.matchMethod ?? null,
        officialVerification: match ? 'verified_publicdata' : 'pending',
      },
      benchmarkName: officialRow?.indexName ?? null,
      fieldCandidates: candidates,
      status: match ? 'resolved' : 'quarantined',
      quarantineReason: match ? null : 'not_in_publicdata_snapshot',
    };
  });

  const officialOnly = officialRows
    .filter((row) => !masterCodes.has(row.code))
    .map((row) => ({ shortCode: row.code, isin: row.isin, officialName: row.name }));
  const quarantined = rows.filter((row) => row.status === 'quarantined');
  const verifiedAlphanumeric = rows.filter((row) => row.status === 'resolved' && /[A-Z]/.test(row.identity.shortCode)).length;
  const isinCandidateMismatches = rows.filter((row) => {
    const candidate = inventoryByCode.get(row.universeKey)?.identifiers?.isinCandidate;
    return row.status === 'resolved' && candidate && candidate !== row.identity.isin;
  });

  return {
    identityMap: {
      schemaVersion: '2.0.0',
      generatedAt: retrievedAt,
      universeAsOfDate: master.generatedAt,
      officialAsOfDate: asOfDate,
      universeCount: rows.length,
      records: rows,
    },
    report: {
      schemaVersion: '2.0.0',
      generatedAt: retrievedAt,
      source: { sourceId: 'publicdata', asOfDate, rawSnapshotPath: rawEntry.path, contentHash: rawEntry.contentHash },
      summary: {
        projectUniverse: master.etfs.length,
        officialUniverse: officialRows.length,
        resolved: rows.length - quarantined.length,
        quarantined: quarantined.length,
        officialOnly: officialOnly.length,
        verifiedAlphanumeric,
        isinCandidateMismatches: isinCandidateMismatches.length,
      },
      officialOnly,
      quarantined: quarantined.map((row) => ({ universeKey: row.universeKey, name: row.sourceRecord.name, reason: row.quarantineReason })),
      isinCandidateMismatches: isinCandidateMismatches.map((row) => ({
        universeKey: row.universeKey,
        derived: inventoryByCode.get(row.universeKey)?.identifiers?.isinCandidate,
        official: row.identity.isin,
      })),
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

async function main() {
  if (!existsSync(MASTER_PATH) || !existsSync(INVENTORY_PATH)) {
    throw new Error('master 또는 issuer inventory가 없습니다. 먼저 metadata:v2:inventory를 실행하세요.');
  }
  if (!config.providers.publicdata.serviceKey) {
    throw new Error('PUBLICDATA_SERVICE_KEY가 필요합니다.');
  }

  const ledger = new ResumableLedger(LEDGER_PATH);
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const force = process.argv.includes('--force');
  if (!force && existsSync(IDENTITY_OUT) && existsSync(REPORT_OUT) && !ledger.shouldRun('publicdata', 'etf-price-bulk', { parserVersion: PARSER_VERSION, staleBefore })) {
    console.log(JSON.stringify({ cached: true, identityMap: IDENTITY_OUT, report: REPORT_OUT, summary: readJson(REPORT_OUT).summary }, null, 2));
    return;
  }
  ledger.claim('publicdata', 'etf-price-bulk', { parserVersion: PARSER_VERSION });
  try {
    const provider = new PublicDataProvider({ ...config.providers.publicdata, enabled: true });
    const response = await provider.getEtfList();
    const retrievedAt = new Date().toISOString();
    const asOfDate = response.data[0]?.basDt ?? response.meta.asOfDate?.slice(0, 10) ?? null;
    const rawStore = new AppendOnlyRawStore(RAW_ROOT);
    const rawEntry = rawStore.put({
      sourceId: 'publicdata',
      key: `etf-price-${String(asOfDate).replaceAll('-', '')}`,
      content: JSON.stringify(response.data),
      extension: 'json',
      metadata: { retrievedAt, status: response.meta.status, url: SOURCE_URL, parserVersion: PARSER_VERSION },
    });
    const result = buildReconciliation({
      master: readJson(MASTER_PATH),
      inventory: readJson(INVENTORY_PATH),
      officialRows: response.data,
      rawEntry,
      retrievedAt,
      asOfDate,
    });
    writeJsonAtomic(IDENTITY_OUT, result.identityMap);
    writeJsonAtomic(REPORT_OUT, result.report);
    ledger.complete('publicdata', 'etf-price-bulk', { status: 'success', rawHash: rawEntry.contentHash, parserVersion: PARSER_VERSION });
    console.log(JSON.stringify({ identityMap: IDENTITY_OUT, report: REPORT_OUT, summary: result.report.summary }, null, 2));
  } catch (error) {
    ledger.fail('publicdata', 'etf-price-bulk', error, { retryable: true, retryAfterMs: 60_000 });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[metadata:v2:reconcile] ${error.message}`);
    process.exitCode = 1;
  });
}
