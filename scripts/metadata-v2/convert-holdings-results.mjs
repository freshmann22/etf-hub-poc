import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseKodexHoldingsPayload, parseTigerHoldingsHtml } from '../../server/providers/issuer/index.js';
import { parseSolHoldingsPayload } from './providers/sol.mjs';
import { SOURCE_RESULT_CONTRACT } from './merge-source-results.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  ledger: resolve(ROOT, 'data/raw/metadata-v2/official-holdings/ledger.jsonl'),
  output: resolve(ROOT, 'data/reports/metadata-v2/holdings-source-result.json'),
});

const SUCCESS_STATUSES = new Set(['ok', 'partial']);
const FAILURE_STATUSES = new Set(['failed', 'rate_limited_stopped']);
const PARSER_VERSIONS = Object.freeze({
  issuer_kodex: 'official-holdings-kodex-converter-1.0.0',
  issuer_tiger: 'official-holdings-tiger-converter-1.0.0',
  issuer_sol: 'official-holdings-sol-converter-1.0.0',
});

export function readHoldingsLedgerText(text) {
  const entries = [];
  const malformed = [];
  String(text || '').split(/\r?\n/).forEach((line, lineIndex) => {
    if (!line.trim()) return;
    try {
      entries.push({ ...JSON.parse(line), _lineNumber: lineIndex + 1 });
    } catch (error) {
      malformed.push({ lineNumber: lineIndex + 1, reason: 'malformed_ledger_json', detail: error.message });
    }
  });
  return { entries, malformed };
}

function timestamp(entry) {
  const value = Date.parse(entry.retrievedAt);
  return Number.isNaN(value) ? -Infinity : value;
}

export function latestSuccessPerShortCode(entries) {
  const selected = new Map();
  for (const entry of entries) {
    if (!SUCCESS_STATUSES.has(entry.status) || !entry.shortCode) continue;
    const prior = selected.get(entry.shortCode);
    if (!prior || timestamp(entry) >= timestamp(prior)) selected.set(entry.shortCode, entry);
  }
  return [...selected.values()].sort((a, b) => a.shortCode.localeCompare(b.shortCode));
}

function rawPath(rootDir, storedPath) {
  return isAbsolute(storedPath) ? storedPath : resolve(rootDir, storedPath);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function holdingsArtifact(entry) {
  const artifacts = Array.isArray(entry.rawArtifacts) ? entry.rawArtifacts : [];
  return [...artifacts].reverse().find((artifact) => artifact.role === 'holdings') || null;
}

function parseArtifact(sourceId, body, shortCode) {
  if (sourceId === 'issuer_kodex') {
    const parsed = parseKodexHoldingsPayload(JSON.parse(body));
    return { rows: parsed.rows, asOfDate: parsed.baseDate || null, declaredCount: parsed.declaredCount };
  }
  if (sourceId === 'issuer_tiger') {
    const parsed = parseTigerHoldingsHtml(body);
    return { rows: parsed.rows, asOfDate: null, declaredCount: parsed.declaredCount };
  }
  if (sourceId === 'issuer_sol') {
    const parsed = parseSolHoldingsPayload(JSON.parse(body), shortCode);
    return { rows: parsed.rows, asOfDate: parsed.asOfDate, declaredCount: parsed.rows.length };
  }
  throw new Error(`unsupported holdings source: ${sourceId}`);
}

function dateOnly(value) {
  if (value == null) return null;
  const text = String(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function normalizeRows(rows) {
  return (rows || []).map((row) => ({
    shortCode: row.shortCode ?? row.stockCode ?? row.code ?? null,
    isin: row.isin ?? null,
    ticker: row.ticker ?? null,
    name: row.name ?? row.stockName ?? null,
    instrumentType: row.instrumentType ?? null,
    weight: row.weight,
  }));
}

function healthStatusCounts(entries) {
  const statuses = ['ok', 'partial', 'empty', 'failed', 'rate_limited_stopped'];
  return Object.fromEntries(statuses.map((status) => [status, entries.filter((entry) => entry.status === status).length]));
}

export function convertHoldingsLedger({ ledgerText, rootDir = ROOT, generatedAt = null }) {
  const parsedLedger = readHoldingsLedgerText(ledgerText);
  const selected = latestSuccessPerShortCode(parsedLedger.entries);
  const quarantine = [...parsedLedger.malformed];
  const warnings = [];
  const records = [];

  for (const entry of selected) {
    const artifact = holdingsArtifact(entry);
    if (!artifact?.path || !artifact?.contentHash) {
      quarantine.push({ lineNumber: entry._lineNumber, sourceId: entry.sourceId, shortCode: entry.shortCode, reason: 'holdings_raw_artifact_missing' });
      continue;
    }
    const path = rawPath(rootDir, artifact.path);
    if (!existsSync(path)) {
      quarantine.push({ lineNumber: entry._lineNumber, sourceId: entry.sourceId, shortCode: entry.shortCode, reason: 'holdings_raw_file_missing', rawSnapshotPath: artifact.path });
      continue;
    }
    const body = readFileSync(path, 'utf8');
    const actualHash = sha256(body);
    if (actualHash !== artifact.contentHash) {
      quarantine.push({ lineNumber: entry._lineNumber, sourceId: entry.sourceId, shortCode: entry.shortCode, reason: 'holdings_raw_hash_mismatch', rawSnapshotPath: artifact.path });
      continue;
    }
    let parsed;
    try {
      parsed = parseArtifact(entry.sourceId, body, entry.shortCode);
    } catch (error) {
      quarantine.push({ lineNumber: entry._lineNumber, sourceId: entry.sourceId, shortCode: entry.shortCode, reason: 'holdings_raw_parse_failed', detail: error.message, rawSnapshotPath: artifact.path });
      continue;
    }
    if (!parsed.rows.length || parsed.rows.length !== entry.rowCount) {
      quarantine.push({
        lineNumber: entry._lineNumber, sourceId: entry.sourceId, shortCode: entry.shortCode,
        reason: 'holdings_parsed_row_count_mismatch', ledgerRowCount: entry.rowCount, parsedRowCount: parsed.rows.length,
      });
      continue;
    }
    const sourceAsOfDate = dateOnly(parsed.asOfDate ?? entry.asOfDate);
    const asOfDate = sourceAsOfDate ?? dateOnly(entry.retrievedAt);
    const usesRetrievalProxy = !sourceAsOfDate;
    if (usesRetrievalProxy) {
      warnings.push({ sourceId: entry.sourceId, shortCode: entry.shortCode, reason: 'as_of_date_uses_retrieval_date_proxy', asOfDate });
    }
    const normalized = normalizeRows(parsed.rows);
    records.push({
      shortCode: entry.shortCode,
      isin: entry.isin ?? null,
      status: entry.status === 'partial' || usesRetrievalProxy ? 'partial' : 'ok',
      asOfDate,
      declaredRowCount: normalized.length,
      fields: { 'portfolio.holdings': normalized },
      provenance: {
        sourceId: entry.sourceId,
        sourceType: 'primary',
        url: artifact.url ?? null,
        documentType: 'official_issuer_holdings',
        retrievedAt: entry.retrievedAt,
        asOfDate,
        rawSnapshotPath: artifact.path,
        contentHash: artifact.contentHash,
        parserVersion: PARSER_VERSIONS[entry.sourceId] || 'official-holdings-converter-1.0.0',
        status: entry.status === 'partial' || usesRetrievalProxy ? 'partial' : 'ok',
        confidence: usesRetrievalProxy ? 0.85 : 0.95,
      },
    });
  }

  const failureEvents = parsedLedger.entries.filter((entry) => FAILURE_STATUSES.has(entry.status)).map((entry) => ({
    lineNumber: entry._lineNumber,
    retrievedAt: entry.retrievedAt ?? null,
    sourceId: entry.sourceId ?? null,
    shortCode: entry.shortCode ?? null,
    status: entry.status,
    error: entry.error ?? null,
  }));
  const emptyEvents = parsedLedger.entries.filter((entry) => entry.status === 'empty').map((entry) => ({
    lineNumber: entry._lineNumber, retrievedAt: entry.retrievedAt ?? null, sourceId: entry.sourceId ?? null,
    shortCode: entry.shortCode ?? null, status: entry.status,
  }));
  const deterministicGeneratedAt = generatedAt
    || parsedLedger.entries.reduce((latest, entry) => timestamp(entry) > timestamp({ retrievedAt: latest }) ? entry.retrievedAt : latest, '1970-01-01T00:00:00.000Z');

  return {
    schemaVersion: SOURCE_RESULT_CONTRACT.schemaVersion,
    source: {
      sourceId: 'official_holdings_collection',
      sourceType: 'primary',
      retrievedAt: deterministicGeneratedAt,
      parserVersion: 'official-holdings-ledger-converter-1.0.0',
      documentType: 'multi_issuer_holdings_source_result',
      confidence: 0.9,
    },
    records,
    health: {
      ledgerEntryCount: parsedLedger.entries.length,
      selectedLatestSuccessCount: selected.length,
      emittedRecordCount: records.length,
      statusCounts: healthStatusCounts(parsedLedger.entries),
      failureEvents,
      emptyEvents,
      warnings,
    },
    quarantine: {
      count: quarantine.length,
      items: quarantine,
    },
  };
}

export function runConverter(paths = DEFAULT_PATHS) {
  const ledgerText = existsSync(paths.ledger) ? readFileSync(paths.ledger, 'utf8') : '';
  const output = convertHoldingsLedger({ ledgerText });
  mkdirSync(dirname(paths.output), { recursive: true });
  const temporary = `${paths.output}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  renameSync(temporary, paths.output);
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const output = runConverter();
  console.log(`[metadata-v2:convert-holdings] records=${output.records.length} failures=${output.health.failureEvents.length} quarantine=${output.quarantine.count}`);
}
