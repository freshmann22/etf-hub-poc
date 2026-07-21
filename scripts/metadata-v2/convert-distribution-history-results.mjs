import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDistributionHistoryHtml } from './providers/distribution-history-html.mjs';
import { parseSolDistributionHistoryJson } from './providers/sol-distribution-history.mjs';
import { parseKoactDistributionHistoryJson } from './providers/koact-distribution-history.mjs';
import { SOURCE_RESULT_CONTRACT } from './merge-source-results.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCES = Object.freeze([
  { key: 'plus', label: 'PLUS', ledger: 'data/raw/metadata-v2/plus-product/ledger.jsonl' },
  { key: 'rise', label: 'RISE', ledger: 'data/raw/metadata-v2/rise-product/ledger.jsonl' },
  { key: 'tiger', label: 'TIGER', ledger: 'data/raw/metadata-v2/tiger-product/ledger.jsonl' },
  { key: 'sol', label: 'SOL', ledger: 'data/raw/metadata-v2/sol-product/ledger.jsonl' },
  { key: 'solApi', label: 'SOL API', ledger: 'data/raw/metadata-v2/sol-distribution-history/ledger.jsonl', parser: 'sol_json' },
  { key: 'hana1q', label: '1Q', ledger: 'data/raw/metadata-v2/hana-1q-product/ledger.jsonl' },
  { key: 'won', label: 'WON', ledger: 'data/raw/metadata-v2/won-product/ledger.jsonl' },
  { key: 'koact', label: 'KoAct', ledger: 'data/raw/metadata-v2/koact-product/ledger.jsonl', parser: 'koact_json' },
  { key: 'thej', label: '\ub354\uc81c\uc774', ledger: 'data/raw/metadata-v2/thej-product/ledger.jsonl' },
]);
const SUCCESS = new Set(['ok', 'partial']);
const PARSER_VERSION = 'distribution-history-multi-source-1.2.0';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function absolute(rootDir, path) { return isAbsolute(path) ? path : resolve(rootDir, path); }
function time(value) { const parsed = Date.parse(value); return Number.isNaN(parsed) ? -Infinity : parsed; }

export function parseDistributionLedger(text, source) {
  const entries = [];
  const malformed = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { entries.push({ ...JSON.parse(line), _lineNumber: index + 1 }); }
    catch (error) { malformed.push({ source, lineNumber: index + 1, reason: 'malformed_ledger_json', detail: error.message }); }
  });
  return { entries, malformed };
}

export function latestSuccessfulDistributionRows(entries) {
  const latest = new Map();
  for (const entry of entries) {
    if (!SUCCESS.has(entry.status) || !entry.shortCode) continue;
    const previous = latest.get(entry.shortCode);
    if (!previous || time(entry.retrievedAt) >= time(previous.retrievedAt)) latest.set(entry.shortCode, entry);
  }
  return [...latest.values()].sort((a, b) => a.shortCode.localeCompare(b.shortCode));
}

function readVerifiedRaw(entry, rootDir) {
  if (!entry.raw?.path || !/^[a-f0-9]{64}$/.test(entry.raw.hash || '')) return { ok: false, reason: 'raw_reference_missing' };
  const path = absolute(rootDir, entry.raw.path);
  if (!existsSync(path)) return { ok: false, reason: 'raw_file_missing' };
  const body = readFileSync(path, 'utf8');
  if (sha256(body) !== entry.raw.hash) return { ok: false, reason: 'raw_hash_mismatch' };
  return { ok: true, body };
}

function readVerifiedReference(reference, rootDir) {
  if (!reference?.path || !/^[a-f0-9]{64}$/.test(reference.hash || '')) return { ok: false, reason: 'raw_reference_missing' };
  const path = absolute(rootDir, reference.path);
  if (!existsSync(path)) return { ok: false, reason: 'raw_file_missing' };
  const body = readFileSync(path, 'utf8');
  if (sha256(body) !== reference.hash) return { ok: false, reason: 'raw_hash_mismatch' };
  return { ok: true, body };
}

function reportReason(parsed) {
  if (parsed.diagnostic === 'external_popup_not_in_raw_html') return 'history_is_external_popup_not_present_in_saved_html';
  if (parsed.status === 'no_valid_history_rows') return 'history_table_has_no_explicit_actual_rows';
  return 'no_history_table_in_saved_html';
}

function newSourceHealth(source, parsedLedger, latest) {
  return {
    source: source.label,
    ledgerPath: source.ledger,
    ledgerEntryCount: parsedLedger.entries.length,
    latestSuccessfulRawCount: latest.length,
    rawValidatedCount: 0,
    matchingTableCount: 0,
    emittedRecordCount: 0,
    emittedEventCount: 0,
    explicitPerShareRecordCount: 0,
    perShareBasisUnknownRecordCount: 0,
    unavailableCount: 0,
    unavailableReasons: {},
    rejectedRowCount: 0,
  };
}

function increment(object, key) { object[key] = (object[key] || 0) + 1; }

export function convertDistributionHistoryResults({ ledgerTexts = {}, rootDir = ROOT }) {
  const records = [];
  const quarantine = [];
  const sourceHealth = {};
  const retrievedTimes = [];

  for (const source of SOURCES) {
    const parsedLedger = parseDistributionLedger(ledgerTexts[source.key] || '', source.key);
    const latest = latestSuccessfulDistributionRows(parsedLedger.entries);
    const health = newSourceHealth(source, parsedLedger, latest);
    sourceHealth[source.key] = health;
    quarantine.push(...parsedLedger.malformed);
    for (const entry of latest) {
      retrievedTimes.push(entry.retrievedAt);
      const raw = readVerifiedRaw(entry, rootDir);
      if (!raw.ok) {
        quarantine.push({ source: source.key, lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: raw.reason, rawSnapshotPath: entry.raw?.path ?? null });
        increment(health.unavailableReasons, raw.reason);
        health.unavailableCount += 1;
        continue;
      }
      health.rawValidatedCount += 1;
      if (source.parser === 'sol_json') {
        const contractRaw = readVerifiedReference(entry.raw?.contract, rootDir);
        if (!contractRaw.ok) {
          quarantine.push({ source: source.key, lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: `contract_${contractRaw.reason}`, rawSnapshotPath: entry.raw?.contract?.path ?? null });
          increment(health.unavailableReasons, `contract_${contractRaw.reason}`); health.unavailableCount += 1; continue;
        }
        const parsed = parseSolDistributionHistoryJson(raw.body, { expectedProductId: entry.productId, retrievedAt: entry.retrievedAt });
        health.rejectedRowCount += parsed.rejectedRows.length;
        if (!parsed.events.length) { increment(health.unavailableReasons, 'no_valid_history_rows'); health.unavailableCount += 1; continue; }
        health.matchingTableCount += 1; health.emittedRecordCount += 1; health.emittedEventCount += parsed.events.length; health.perShareBasisUnknownRecordCount += 1;
        const asOfDate = parsed.events.reduce((date, event) => event.recordDate > date ? event.recordDate : date, '0000-00-00');
        records.push({
          shortCode: entry.shortCode, isin: entry.isin ?? null, status: 'partial', asOfDate,
          fields: { 'distribution.history': parsed.events },
          evidence: { 'distribution.history': { sectionHeading: '분배금 현황', selector: 'GET /api/etf/pds/dividend/{fundCode}', snippet: parsed.evidence.rows.slice(0, 8).join(' | ').slice(0, 1000), sourceEntries: parsed.evidence.rows, receptionNo: null, extractionRule: 'SOL_WORK_DT_record_date_DIVIDEND_DT_actual_pay_date_DIVIDEND_PRI_positive_KRW; perUnit_null_when_not_explicit; schedule_text_excluded' } },
          provenance: { sourceId: entry.sourceId, sourceType: 'primary', url: entry.raw.url, documentType: 'official_issuer_distribution_history_api', retrievedAt: entry.retrievedAt, asOfDate, rawSnapshotPath: entry.raw.path, contentHash: entry.raw.hash, parserVersion: 'sol-distribution-history-json-1.0.0', status: 'partial', confidence: 0.94, contractSnapshotPath: entry.raw.contract.path, contractContentHash: entry.raw.contract.hash },
        });
        continue;
      }
      if (source.parser === 'koact_json') {
        const parsed = parseKoactDistributionHistoryJson(raw.body, { retrievedAt: entry.retrievedAt });
        health.rejectedRowCount += parsed.rejectedRows.length;
        if (!parsed.events.length) {
          increment(health.unavailableReasons, 'koact_product_api_has_no_explicit_actual_distribution_rows');
          health.unavailableCount += 1;
          continue;
        }
        health.matchingTableCount += 1;
        health.emittedRecordCount += 1;
        health.emittedEventCount += parsed.events.length;
        health.perShareBasisUnknownRecordCount += 1;
        const asOfDate = parsed.events.reduce((date, event) => event.recordDate > date ? event.recordDate : date, '0000-00-00');
        records.push({
          shortCode: entry.shortCode, isin: entry.isin ?? null, status: 'partial', asOfDate,
          fields: { 'distribution.history': parsed.events },
          evidence: { 'distribution.history': { sectionHeading: '\ubd84\ubc30\uae08 \uc9c0\uae09\ud604\ud669', selector: parsed.evidence.selector, snippet: parsed.evidence.rows.slice(0, 8).join(' | ').slice(0, 1000), sourceEntries: parsed.evidence.rows, receptionNo: null, extractionRule: 'KOACT_info.divideList_BASIC_D_record_date_PAY_D_actual_pay_date_DIVID_A_positive_amount; currency_null; perUnit_null; schedule_text_excluded' } },
          provenance: { sourceId: entry.sourceId, sourceType: 'primary', url: entry.raw.url, documentType: 'official_issuer_product_api_distribution_history', retrievedAt: entry.retrievedAt, asOfDate, rawSnapshotPath: entry.raw.path, contentHash: entry.raw.hash, parserVersion: 'koact-distribution-history-json-1.0.0', status: 'partial', confidence: 0.93 },
        });
        continue;
      }
      const parsed = parseDistributionHistoryHtml(raw.body, { retrievedAt: entry.retrievedAt });
      health.rejectedRowCount += parsed.rejectedRows.length;
      if (parsed.evidence) health.matchingTableCount += 1;
      if (!parsed.events.length) {
        const reason = reportReason(parsed);
        increment(health.unavailableReasons, reason);
        health.unavailableCount += 1;
        continue;
      }
      health.emittedRecordCount += 1;
      health.emittedEventCount += parsed.events.length;
      if (parsed.evidence.perUnitBasis === 'explicit_table_caption_or_header') health.explicitPerShareRecordCount += 1;
      else health.perShareBasisUnknownRecordCount += 1;
      const asOfDate = parsed.events.reduce((latestDate, event) => event.recordDate > latestDate ? event.recordDate : latestDate, '0000-00-00');
      const snippet = parsed.evidence.rows.slice(0, 8).join(' | ').slice(0, 1000);
      records.push({
        shortCode: entry.shortCode,
        isin: entry.isin ?? null,
        status: 'ok',
        asOfDate,
        fields: { 'distribution.history': parsed.events },
        evidence: {
          'distribution.history': {
            sectionHeading: parsed.evidence.sectionHeading,
            selector: parsed.evidence.selector,
            snippet,
            sourceEntries: parsed.evidence.rows,
            receptionNo: null,
            extractionRule: 'explicit_distribution_table_record_date_pay_date_positive_amount; schedule_text_excluded',
          },
        },
        provenance: {
          sourceId: entry.sourceId,
          sourceType: 'primary',
          url: entry.raw.url,
          documentType: 'official_issuer_product_distribution_history_table',
          retrievedAt: entry.sourceRetrievedAt || entry.raw.retrievedAt || entry.retrievedAt,
          asOfDate,
          rawSnapshotPath: entry.raw.path,
          contentHash: entry.raw.hash,
          parserVersion: PARSER_VERSION,
          status: 'ok',
          confidence: parsed.evidence.perUnitBasis === 'explicit_table_caption_or_header' ? 0.99 : 0.94,
        },
      });
    }
  }

  records.sort((a, b) => a.shortCode.localeCompare(b.shortCode) || a.provenance.sourceId.localeCompare(b.provenance.sourceId));
  const generatedAt = retrievedTimes.filter(Boolean).sort().at(-1) || '1970-01-01T00:00:00.000Z';
  const totals = Object.values(sourceHealth).reduce((result, source) => ({
    latestSuccessfulRawCount: result.latestSuccessfulRawCount + source.latestSuccessfulRawCount,
    emittedRecordCount: result.emittedRecordCount + source.emittedRecordCount,
    emittedEventCount: result.emittedEventCount + source.emittedEventCount,
    explicitPerShareRecordCount: result.explicitPerShareRecordCount + source.explicitPerShareRecordCount,
    perShareBasisUnknownRecordCount: result.perShareBasisUnknownRecordCount + source.perShareBasisUnknownRecordCount,
  }), { latestSuccessfulRawCount: 0, emittedRecordCount: 0, emittedEventCount: 0, explicitPerShareRecordCount: 0, perShareBasisUnknownRecordCount: 0 });

  const sourceResult = {
    schemaVersion: SOURCE_RESULT_CONTRACT.schemaVersion,
    source: {
      sourceId: 'official_issuer_distribution_history_tables',
      sourceType: 'primary',
      retrievedAt: generatedAt,
      parserVersion: PARSER_VERSION,
      documentType: 'multi_issuer_official_distribution_history_source_result',
      confidence: 0.97,
    },
    records,
    health: { ...totals, sources: sourceHealth },
    quarantine: { count: quarantine.length, items: quarantine },
  };
  const report = {
    schemaVersion: '1.0.0',
    generatedAt,
    scope: {
      networkRequests: 0,
      inputPolicy: 'latest ok/partial raw HTML per sourceId+shortCode; content hash must match ledger',
      actualHistoryRule: 'emit only rows with explicit valid record date, explicit valid pay date, and positive numeric amount; currency and perUnit remain null unless explicitly stated by the source',
      scheduleExclusion: 'distribution schedule/policy prose is never interpreted as payment history',
      futurePaymentExclusion: 'pay dates after raw retrieval are rejected as not-yet-actual',
    },
    totals: {
      ...totals,
      recordCoveragePct: totals.latestSuccessfulRawCount ? Math.round(totals.emittedRecordCount / totals.latestSuccessfulRawCount * 10000) / 100 : 0,
      quarantineCount: quarantine.length,
    },
    sources: sourceHealth,
    interpretation: {
      rise: 'Direct table includes record date, actual pay date, KRW amount, and explicit per-share basis in caption/header.',
      plus: 'Direct table includes record date, actual pay date, and KRW amount. Per-share basis is not explicit in saved HTML, so perUnit remains null.',
      tiger: 'All saved product HTML contains an empty JavaScript popup container; no actual payment-history rows are present in raw HTML.',
      sol: 'Saved product HTML links to a JavaScript distribution-status popup; the actual history rows are not present in the saved raw HTML.',
      solApi: 'Official popup JSON supplies record date, actual pay date, and KRW amount. Per-share basis is not explicit, so perUnit remains null and records are partial.',
      hana1q: 'Saved product HTML contains distribution policy/schedule only; no actual payment-history table is present.',
      won: 'Saved product HTML directly includes a three-year payment table with record date, actual pay date, explicit per-share KRW amount, or an empty table when no actual rows exist.',
      koact: 'KoAct product API embeds explicit record date, actual pay date, and positive amount rows at $.info.divideList[*]. Currency and per-unit basis are not explicit, so both remain null.',
      thej: 'Saved product HTML contains distribution schedule prose and a status button, but no explicit actual payment-history rows.',
    },
  };
  return { sourceResult, report };
}

export function runDistributionHistoryConverter({
  rootDir = ROOT,
  sourceResultPath = resolve(ROOT, 'data/reports/metadata-v2/distribution-history-source-result.json'),
  reportPath = resolve(ROOT, 'data/reports/metadata-v2/distribution-history-extraction.json'),
} = {}) {
  const ledgerTexts = Object.fromEntries(SOURCES.map((source) => {
    const path = absolute(rootDir, source.ledger);
    return [source.key, existsSync(path) ? readFileSync(path, 'utf8') : ''];
  }));
  const output = convertDistributionHistoryResults({ ledgerTexts, rootDir });
  for (const [path, value] of [[sourceResultPath, output.sourceResult], [reportPath, output.report]]) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
  }
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { sourceResult, report } = runDistributionHistoryConverter();
  console.log(`[metadata-v2:distribution-history] records=${sourceResult.records.length} events=${report.totals.emittedEventCount} raw=${report.totals.latestSuccessfulRawCount} quarantine=${sourceResult.quarantine.count}`);
}
