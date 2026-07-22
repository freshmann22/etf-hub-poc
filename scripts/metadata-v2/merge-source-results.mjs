import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFieldCandidate, makeProvenance } from './lib/provenance.js';
import { resolveCandidates } from './lib/conflict-resolver.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  identity: resolve(ROOT, 'data/normalized/etf-identity-map-v2.json'),
  canonical: resolve(ROOT, 'data/normalized/etf-metadata-v2.json'),
  resolution: resolve(ROOT, 'config/metadata-field-resolution.json'),
  quarantine: resolve(ROOT, 'data/reports/metadata-v2/source-merge-quarantine.json'),
});

export const SOURCE_RESULT_CONTRACT = Object.freeze({
  schemaVersion: 'metadata-source-result-v1',
  requiredDocumentFields: ['schemaVersion', 'source', 'records'],
  requiredSourceFields: ['sourceId', 'sourceType', 'retrievedAt', 'parserVersion'],
  recordIdentity: 'Exactly one of universeKey, shortCode, or isin must resolve to the identity map.',
  recordShape: {
    universeKey: 'optional string',
    shortCode: 'optional ^[0-9A-Z]{6}$',
    isin: 'optional ISO 6166 string',
    status: 'ok|partial|unavailable',
    asOfDate: 'optional ISO date/date-time',
    declaredRowCount: 'optional integer; checked for portfolio.holdings',
    fields: 'object keyed by canonical field paths',
    provenance: 'optional per-record overrides of document source provenance',
    evidence: 'optional object keyed by canonical field paths; section heading/snippet/source entry context',
  },
});

const WRITABLE_FIELDS = new Set([
  'identity.officialName', 'identity.issuerId', 'identity.issuerName', 'identity.listingDate', 'identity.listingStatus',
  'product.description', 'product.investmentObjective',
  'product.benchmark.name', 'product.benchmark.provider', 'product.benchmark.indexCode', 'product.benchmark.description',
  'product.assetClasses', 'product.targetRegions', 'product.active', 'product.replication',
  'product.derivative.direction', 'product.derivative.multiple', 'product.currencyHedged', 'product.fundOfFunds',
  'portfolio.asOfDate', 'portfolio.holdings', 'portfolio.sectorWeights', 'portfolio.countryWeights',
  'distribution.applicability', 'distribution.schedule', 'distribution.frequency', 'distribution.history',
]);
const SOURCE_RECORD_STATUSES = new Set(['ok', 'partial', 'unavailable']);

function dateValue(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function validateSourceDocument(document) {
  if (document?.schemaVersion !== SOURCE_RESULT_CONTRACT.schemaVersion) {
    throw new Error(`unsupported source result schemaVersion: ${document?.schemaVersion || 'missing'}`);
  }
  if (!document.source || !Array.isArray(document.records)) throw new Error('source result requires source and records');
  for (const field of SOURCE_RESULT_CONTRACT.requiredSourceFields) {
    if (document.source[field] == null || document.source[field] === '') throw new Error(`source.${field} is required`);
  }
  return document;
}

function identityIndexes(identityMap) {
  const key = new Map();
  const code = new Map();
  const isin = new Map();
  for (const row of identityMap.records || []) {
    key.set(row.universeKey, row.universeKey);
    if (row.identity?.shortCode) code.set(row.identity.shortCode, row.universeKey);
    if (row.identity?.isin) isin.set(row.identity.isin, row.universeKey);
  }
  return { key, code, isin };
}

function resolveRecordKey(record, indexes) {
  const hits = new Set();
  if (record.universeKey && indexes.key.has(record.universeKey)) hits.add(indexes.key.get(record.universeKey));
  if (record.shortCode && indexes.code.has(record.shortCode)) hits.add(indexes.code.get(record.shortCode));
  if (record.isin && indexes.isin.has(record.isin)) hits.add(indexes.isin.get(record.isin));
  if (hits.size === 1) return { key: [...hits][0], error: null };
  return { key: null, error: hits.size > 1 ? 'conflicting_source_identifiers' : 'unresolved_source_identifier' };
}

function normalizedDate(value) {
  if (value == null) return null;
  const text = String(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

export function validateHoldings(value, { asOfDate, declaredRowCount = null, now = new Date() } = {}) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'holdings_empty_or_not_array' };
  if (value.length > 2000) return { ok: false, reason: 'holdings_row_count_exceeds_2000' };
  if (declaredRowCount != null && (!Number.isInteger(declaredRowCount) || declaredRowCount !== value.length)) {
    return { ok: false, reason: 'holdings_declared_row_count_mismatch' };
  }
  const date = normalizedDate(asOfDate ?? value.find((row) => row?.asOfDate)?.asOfDate);
  if (!date || dateValue(date) > now.getTime() + 24 * 60 * 60 * 1000) return { ok: false, reason: 'holdings_invalid_as_of_date' };
  const rows = [];
  for (const row of value) {
    const name = String(row?.name ?? row?.stockName ?? '').trim();
    const weight = Number(row?.weight);
    // Derivative, inverse, and leveraged ETFs can legitimately expose negative
    // weights or gross exposure above 100%. Reject only clearly corrupt rows.
    if (!name || !Number.isFinite(weight) || weight < -1000 || weight > 1000) return { ok: false, reason: 'holdings_invalid_row' };
    rows.push({
      shortCode: row.shortCode ?? row.code ?? row.stockCode ?? null,
      isin: row.isin ?? null,
      ticker: row.ticker ?? null,
      name,
      instrumentType: row.instrumentType ?? null,
      weight,
    });
  }
  const weightSum = rows.reduce((sum, row) => sum + row.weight, 0);
  const grossWeight = rows.reduce((sum, row) => sum + Math.abs(row.weight), 0);
  if (grossWeight <= 0 || grossWeight > 5000) return { ok: false, reason: 'holdings_gross_weight_out_of_range', weightSum, grossWeight };
  return {
    ok: true,
    rows,
    asOfDate: date,
    rowCount: rows.length,
    weightSum: Math.round(weightSum * 10000) / 10000,
    grossWeight: Math.round(grossWeight * 10000) / 10000,
  };
}

function fieldValueValid(field, value) {
  if (value == null) return false;
  if (['product.assetClasses', 'product.targetRegions', 'portfolio.sectorWeights', 'portfolio.countryWeights', 'distribution.history'].includes(field)) {
    return Array.isArray(value);
  }
  if (['product.active', 'product.currencyHedged', 'product.fundOfFunds'].includes(field)) return typeof value === 'boolean';
  if (field === 'product.derivative.multiple') return Number.isFinite(value);
  if (field === 'identity.listingStatus') return ['listed', 'delisted', 'pending', 'unknown'].includes(value);
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

function provenanceFor(document, record, asOfDate) {
  const source = { ...document.source, ...(record.provenance || {}) };
  return makeProvenance({
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    url: source.url ?? null,
    documentType: source.documentType ?? null,
    retrievedAt: source.retrievedAt,
    asOfDate: asOfDate ?? source.asOfDate ?? null,
    rawSnapshotPath: source.rawSnapshotPath ?? null,
    contentHash: source.contentHash ?? null,
    parserVersion: source.parserVersion,
    status: record.status === 'partial' ? 'partial' : source.status || 'ok',
    confidence: source.confidence ?? 0.8,
  });
}

function setPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function candidateMap(record, field) {
  return Array.isArray(record.fieldCandidates?.[field]) ? record.fieldCandidates[field] : [];
}

function upsertCandidates(existing, additions) {
  const byId = new Map(existing.map((candidate) => [candidate.candidateId, candidate]));
  for (const candidate of additions) byId.set(candidate.candidateId, candidate);
  return [...byId.values()];
}

export function mergeSourceResults({ identityMap, canonical, sourceDocuments, resolutionConfig, now = new Date() }) {
  if (canonical.records?.length !== identityMap.universeCount || canonical.universeCount !== identityMap.universeCount) {
    throw new Error('canonical and identity-map universe shapes differ');
  }
  const indexes = identityIndexes(identityMap);
  const output = structuredClone(canonical);
  const byKey = new Map(output.records.map((record) => [record.universeKey, record]));
  const quarantine = [];
  const touched = new Map();

  for (const rawDocument of sourceDocuments || []) {
    let document;
    try {
      document = validateSourceDocument(rawDocument);
      makeProvenance({ ...document.source, confidence: document.source.confidence ?? 0.8 });
    } catch (error) {
      quarantine.push({ sourceId: rawDocument?.source?.sourceId ?? null, recordIndex: null, field: null, reason: 'malformed_source_document', detail: error.message });
      continue;
    }
    for (let recordIndex = 0; recordIndex < document.records.length; recordIndex += 1) {
      const sourceRecord = document.records[recordIndex];
      if (!SOURCE_RECORD_STATUSES.has(sourceRecord?.status)) {
        quarantine.push({ sourceId: document.source.sourceId, recordIndex, field: null, reason: 'invalid_source_record_status' });
        continue;
      }
      if (sourceRecord.status === 'unavailable') continue;
      const resolved = resolveRecordKey(sourceRecord, indexes);
      if (!resolved.key) {
        quarantine.push({ sourceId: document.source.sourceId, recordIndex, field: null, reason: resolved.error });
        continue;
      }
      const target = byKey.get(resolved.key);
      for (const [field, rawValue] of Object.entries(sourceRecord.fields || {})) {
        if (!WRITABLE_FIELDS.has(field)) {
          quarantine.push({ sourceId: document.source.sourceId, recordIndex, universeKey: resolved.key, field, reason: 'unsupported_field' });
          continue;
        }
        let value = rawValue;
        let asOfDate = sourceRecord.asOfDate ?? null;
        if (field === 'portfolio.holdings') {
          const gate = validateHoldings(rawValue, { asOfDate, declaredRowCount: sourceRecord.declaredRowCount, now });
          if (!gate.ok) {
            quarantine.push({ sourceId: document.source.sourceId, recordIndex, universeKey: resolved.key, field, reason: gate.reason, weightSum: gate.weightSum ?? null });
            continue;
          }
          value = gate.rows;
          asOfDate = gate.asOfDate;
          const dateCandidate = makeFieldCandidate({ field: 'portfolio.asOfDate', value: asOfDate, provenance: provenanceFor(document, sourceRecord, asOfDate) });
          const currentDates = candidateMap(target, 'portfolio.asOfDate');
          target.fieldCandidates['portfolio.asOfDate'] = upsertCandidates(currentDates, [dateCandidate]);
          touched.set(`${resolved.key}|portfolio.asOfDate`, { target, field: 'portfolio.asOfDate' });
        } else if (!fieldValueValid(field, value)) {
          quarantine.push({ sourceId: document.source.sourceId, recordIndex, universeKey: resolved.key, field, reason: 'invalid_field_value' });
          continue;
        }
        const candidate = makeFieldCandidate({
          field,
          value,
          provenance: provenanceFor(document, sourceRecord, asOfDate),
          evidence: sourceRecord.evidence?.[field] ?? null,
        });
        target.fieldCandidates[field] = upsertCandidates(candidateMap(target, field), [candidate]);
        touched.set(`${resolved.key}|${field}`, { target, field });
      }
    }
  }

  for (const { target, field } of touched.values()) {
    const effectiveConfig = field === 'portfolio.asOfDate' && resolutionConfig.fields?.['portfolio.holdings']
      ? { ...resolutionConfig, fields: { ...resolutionConfig.fields, 'portfolio.asOfDate': resolutionConfig.fields['portfolio.holdings'] } }
      : resolutionConfig;
    const result = resolveCandidates(field, target.fieldCandidates[field], effectiveConfig);
    target.conflicts = (target.conflicts || []).filter((conflict) => conflict.field !== field);
    if (result.conflict) target.conflicts.push(result.conflict);
    if (result.selected) setPath(target, field, result.selected.value);
    if (result.conflict?.severity === 'hard') target.status = 'quarantined';
  }
  if (output.records.length !== identityMap.universeCount || new Set(output.records.map((record) => record.universeKey)).size !== output.records.length) {
    throw new Error('merge did not preserve universe shape');
  }
  output.generatedAt = now.toISOString();
  return {
    output,
    quarantineReport: {
      schemaVersion: '1.0.0',
      generatedAt: now.toISOString(),
      quarantinedCount: quarantine.length,
      items: quarantine,
    },
  };
}

function parseArgs(argv) {
  const args = { sources: [], output: DEFAULT_PATHS.canonical };
  for (const value of argv) {
    if (value.startsWith('--source=')) args.sources.push(resolve(value.slice('--source='.length)));
    else if (value.startsWith('--output=')) args.output = resolve(value.slice('--output='.length));
  }
  return args;
}

export function runMerge({ sourcePaths, outputPath = DEFAULT_PATHS.canonical } = {}) {
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const result = mergeSourceResults({
    identityMap: read(DEFAULT_PATHS.identity),
    canonical: read(DEFAULT_PATHS.canonical),
    sourceDocuments: (sourcePaths || []).map(read),
    resolutionConfig: read(DEFAULT_PATHS.resolution),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(DEFAULT_PATHS.quarantine), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result.output, null, 2)}\n`, 'utf8');
  writeFileSync(DEFAULT_PATHS.quarantine, `${JSON.stringify(result.quarantineReport, null, 2)}\n`, 'utf8');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sources.length) {
    console.error('Usage: node scripts/metadata-v2/merge-source-results.mjs --source=<collector-result.json> [--source=<dart-result.json>]');
    process.exitCode = 2;
  } else {
    const result = runMerge({ sourcePaths: args.sources, outputPath: args.output });
    console.log(`[metadata-v2:merge] ${result.output.records.length} records; quarantined ${result.quarantineReport.quarantinedCount}`);
  }
}
