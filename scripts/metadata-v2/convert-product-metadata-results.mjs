import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsePlusProductHtml } from './providers/plus-product-html.mjs';
import { SOURCE_RESULT_CONTRACT } from './merge-source-results.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  riseLedger: resolve(ROOT, 'data/raw/metadata-v2/rise-product/ledger.jsonl'),
  tigerLedger: resolve(ROOT, 'data/raw/metadata-v2/tiger-product/ledger.jsonl'),
  plusLedger: resolve(ROOT, 'data/raw/metadata-v2/plus-product/ledger.jsonl'),
  solLedger: resolve(ROOT, 'data/raw/metadata-v2/sol-product/ledger.jsonl'),
  hana1qLedger: resolve(ROOT, 'data/raw/metadata-v2/hana-1q-product/ledger.jsonl'),
  wonLedger: resolve(ROOT, 'data/raw/metadata-v2/won-product/ledger.jsonl'),
  kcgiLedger: resolve(ROOT, 'data/raw/metadata-v2/kcgi-product/ledger.jsonl'),
  midasLedger: resolve(ROOT, 'data/raw/metadata-v2/midas-product/ledger.jsonl'),
  thejLedger: resolve(ROOT, 'data/raw/metadata-v2/thej-product/ledger.jsonl'),
  koactLedger: resolve(ROOT, 'data/raw/metadata-v2/koact-product/ledger.jsonl'),
  plusReport: resolve(ROOT, 'data/reports/metadata-v2/plus-product-canary.json'),
  output: resolve(ROOT, 'data/reports/metadata-v2/product-metadata-source-result.json'),
});

const SUCCESS = new Set(['ok', 'partial']);
const FIELD_MAP = Object.freeze({
  productDescription: 'product.description',
  investmentObjective: 'product.investmentObjective',
  benchmarkName: 'product.benchmark.name',
  benchmarkDescription: 'product.benchmark.description',
  distributionPolicy: 'distribution.schedule',
});
const PLUS_SELECTORS = Object.freeze({
  productDescription: '.summary__investment-list > li',
  investmentObjective: '.summary__investment-list > li',
  benchmarkName: '.sub-pages__basic-index-title',
  benchmarkDescription: '.sub-pages__basic-index-desc',
  distributionPolicy: '.sub-pages__devidend-help',
});

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function resolveRaw(rootDir, storedPath) {
  return isAbsolute(storedPath) ? storedPath : resolve(rootDir, storedPath);
}

function timestamp(entry) {
  const value = Date.parse(entry?.retrievedAt);
  return Number.isNaN(value) ? -Infinity : value;
}

export function parseProductLedger(text, { source = 'rise' } = {}) {
  const entries = [];
  const malformed = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { entries.push({ ...JSON.parse(line), _lineNumber: index + 1 }); }
    catch (error) { malformed.push({ source, lineNumber: index + 1, reason: 'malformed_ledger_json', detail: error.message }); }
  });
  return { entries, malformed };
}

export function latestSuccessfulProductRows(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!SUCCESS.has(entry.status) || !entry.shortCode) continue;
    const prior = map.get(entry.shortCode);
    if (!prior || timestamp(entry) >= timestamp(prior)) map.set(entry.shortCode, entry);
  }
  return [...map.values()].sort((a, b) => a.shortCode.localeCompare(b.shortCode));
}

function validateRaw(raw, rootDir) {
  if (!raw?.path || !/^[a-f0-9]{64}$/.test(raw.hash || '')) return { ok: false, reason: 'raw_reference_missing' };
  const path = resolveRaw(rootDir, raw.path);
  if (!existsSync(path)) return { ok: false, reason: 'raw_file_missing' };
  const body = readFileSync(path, 'utf8');
  if (sha256(body) !== raw.hash) return { ok: false, reason: 'raw_hash_mismatch' };
  return { ok: true, body };
}

function addField({ fields, evidence, fieldCounts, inputField, value, proof, selectorFallback = null }) {
  if (value == null || value === '') return;
  const canonical = FIELD_MAP[inputField];
  if (!canonical) return;
  fields[canonical] = value;
  evidence[canonical] = {
    sectionHeading: null,
    selector: proof?.selector ?? selectorFallback,
    snippet: proof?.snippet ?? String(value).slice(0, 320),
    sourceEntries: [],
    receptionNo: null,
    extractionRule: `issuer_product_${inputField}`,
  };
  fieldCounts[canonical] = (fieldCounts[canonical] || 0) + 1;
}

function convertRiseEntry(entry, rootDir, fieldCounts, quarantine) {
  const rawCheck = validateRaw(entry.raw, rootDir);
  if (!rawCheck.ok) {
    quarantine.push({ source: 'rise', lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: rawCheck.reason, rawSnapshotPath: entry.raw?.path ?? null });
    return null;
  }
  const fields = {};
  const evidence = {};
  for (const inputField of Object.keys(FIELD_MAP)) {
    const value = entry.metadata?.[inputField];
    const proof = entry.provenance?.[inputField];
    if (value == null || value === '') continue;
    if (!proof?.selector || !proof?.snippet || proof.rawHash !== entry.raw.hash) {
      quarantine.push({ source: 'rise', lineNumber: entry._lineNumber, shortCode: entry.shortCode, field: FIELD_MAP[inputField], reason: 'field_provenance_invalid' });
      continue;
    }
    addField({ fields, evidence, fieldCounts, inputField, value, proof });
  }
  if (!Object.keys(fields).length) {
    quarantine.push({ source: 'rise', lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: 'no_valid_populated_fields' });
    return null;
  }
  return {
    shortCode: entry.shortCode,
    isin: entry.isin ?? null,
    status: entry.status,
    asOfDate: null,
    fields,
    evidence,
    provenance: {
      sourceId: entry.sourceId || 'issuer_rise_product',
      sourceType: 'primary',
      url: entry.raw.url,
      documentType: 'official_issuer_product_page',
      retrievedAt: entry.raw.retrievedAt || entry.retrievedAt,
      asOfDate: null,
      rawSnapshotPath: entry.raw.path,
      contentHash: entry.raw.hash,
      parserVersion: 'rise-product-converter-1.0.0',
      status: entry.status,
      confidence: entry.status === 'partial' ? 0.85 : 0.95,
    },
  };
}

function convertPlusLedgerEntry(entry, rootDir, fieldCounts, quarantine) {
  const rawCheck = validateRaw(entry.raw, rootDir);
  if (!rawCheck.ok) {
    quarantine.push({ source: 'plus', lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: rawCheck.reason, rawSnapshotPath: entry.raw?.path ?? null });
    return null;
  }
  const fields = {};
  const evidence = {};
  const provenance = entry.provenance || entry.validation?.provenance || {};
  for (const inputField of Object.keys(FIELD_MAP)) {
    const value = entry.metadata?.[inputField];
    const proof = provenance[inputField];
    if (value == null || value === '') continue;
    if (!proof?.selector || !proof?.snippet || proof.rawHash !== entry.raw.hash) {
      quarantine.push({ source: 'plus', lineNumber: entry._lineNumber, shortCode: entry.shortCode, field: FIELD_MAP[inputField], reason: 'field_provenance_invalid' });
      continue;
    }
    addField({ fields, evidence, fieldCounts, inputField, value, proof });
  }
  if (!Object.keys(fields).length) {
    quarantine.push({ source: 'plus', lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: 'no_valid_populated_fields' });
    return null;
  }
  return {
    shortCode: entry.shortCode,
    isin: entry.isin ?? null,
    status: entry.status,
    asOfDate: null,
    fields,
    evidence,
    provenance: {
      sourceId: entry.sourceId || 'plus_official_product_html',
      sourceType: 'primary',
      url: entry.raw.url,
      documentType: 'official_issuer_product_page',
      retrievedAt: entry.sourceRetrievedAt || entry.raw.retrievedAt || entry.retrievedAt,
      asOfDate: null,
      rawSnapshotPath: entry.raw.path,
      contentHash: entry.raw.hash,
      parserVersion: 'plus-product-ledger-converter-1.0.0',
      status: entry.status,
      confidence: entry.status === 'partial' ? 0.85 : 0.95,
    },
  };
}

function convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source, defaultSourceId, parserVersion }) {
  const rawCheck = validateRaw(entry.raw, rootDir);
  if (!rawCheck.ok) {
    quarantine.push({ source, lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: rawCheck.reason, rawSnapshotPath: entry.raw?.path ?? null });
    return null;
  }
  const fields = {};
  const evidence = {};
  for (const inputField of Object.keys(FIELD_MAP)) {
    const value = entry.metadata?.[inputField];
    const proof = entry.provenance?.[inputField];
    if (value == null || value === '') continue;
    if (!proof?.selector || !proof?.snippet || proof.rawHash !== entry.raw.hash) {
      quarantine.push({ source, lineNumber: entry._lineNumber, shortCode: entry.shortCode, field: FIELD_MAP[inputField], reason: 'field_provenance_invalid' });
      continue;
    }
    addField({ fields, evidence, fieldCounts, inputField, value, proof });
  }
  if (!Object.keys(fields).length) {
    quarantine.push({ source, lineNumber: entry._lineNumber, shortCode: entry.shortCode, reason: 'no_valid_populated_fields' });
    return null;
  }
  return {
    shortCode: entry.shortCode,
    isin: entry.isin ?? null,
    status: entry.status,
    asOfDate: null,
    fields,
    evidence,
    provenance: {
      sourceId: entry.sourceId || defaultSourceId,
      sourceType: 'primary',
      url: entry.raw.url,
      documentType: 'official_issuer_product_page',
      retrievedAt: entry.raw.retrievedAt || entry.retrievedAt,
      asOfDate: null,
      rawSnapshotPath: entry.raw.path,
      contentHash: entry.raw.hash,
      parserVersion,
      status: entry.status,
      confidence: entry.status === 'partial' ? 0.85 : 0.95,
    },
  };
}

function convertPlusRow(row, report, rootDir, fieldCounts, quarantine, index) {
  if (!row.access?.ok) {
    quarantine.push({ source: 'plus', rowIndex: index, shortCode: row.ticker ?? null, reason: 'source_access_failed', httpStatus: row.access?.httpStatus ?? null });
    return null;
  }
  const rawCheck = validateRaw(row.raw, rootDir);
  if (!rawCheck.ok) {
    quarantine.push({
      source: 'plus', rowIndex: index, shortCode: row.ticker ?? null,
      reason: rawCheck.reason === 'raw_reference_missing' ? 'raw_artifact_unavailable_in_probe' : rawCheck.reason,
      rawSnapshotPath: row.raw?.path ?? null,
    });
    return null;
  }
  let parsed;
  try {
    parsed = parsePlusProductHtml(rawCheck.body, { expectedName: row.name, expectedTicker: row.ticker, sourceUrl: row.url });
  } catch (error) {
    quarantine.push({ source: 'plus', rowIndex: index, shortCode: row.ticker, reason: 'raw_parse_failed', detail: error.message });
    return null;
  }
  if (parsed.identity.tickerVisible === false || parsed.identity.expectedNameMatches === false) {
    quarantine.push({ source: 'plus', rowIndex: index, shortCode: row.ticker, reason: 'product_identity_mismatch' });
    return null;
  }
  const values = {
    productDescription: parsed.description,
    investmentObjective: parsed.investmentObjective,
    benchmarkName: parsed.benchmark.name,
    benchmarkDescription: parsed.benchmark.description,
    distributionPolicy: parsed.distributionPolicy,
  };
  const fields = {};
  const evidence = {};
  for (const [inputField, value] of Object.entries(values)) {
    addField({ fields, evidence, fieldCounts, inputField, value, proof: null, selectorFallback: PLUS_SELECTORS[inputField] });
  }
  if (!Object.keys(fields).length) {
    quarantine.push({ source: 'plus', rowIndex: index, shortCode: row.ticker, reason: 'no_valid_populated_fields' });
    return null;
  }
  return {
    shortCode: row.ticker,
    status: parsed.complete ? 'ok' : 'partial',
    asOfDate: null,
    fields,
    evidence,
    provenance: {
      sourceId: 'issuer_plus_product', sourceType: 'primary', url: row.raw.url || row.url,
      documentType: 'official_issuer_product_page', retrievedAt: row.raw.retrievedAt || report.generatedAt,
      asOfDate: null, rawSnapshotPath: row.raw.path, contentHash: row.raw.hash,
      parserVersion: 'plus-product-converter-1.0.0', status: parsed.complete ? 'ok' : 'partial', confidence: parsed.complete ? 0.95 : 0.85,
    },
  };
}

export function convertProductMetadataResults({ riseLedgerText = '', tigerLedgerText = '', plusLedgerText = '', solLedgerText = '', hana1qLedgerText = '', wonLedgerText = '', koactLedgerText = '', kcgiLedgerText = '', midasLedgerText = '', thejLedgerText = '', plusReport = null, rootDir = ROOT }) {
  const rise = parseProductLedger(riseLedgerText);
  const tiger = parseProductLedger(tigerLedgerText, { source: 'tiger' });
  const plus = parseProductLedger(plusLedgerText, { source: 'plus' });
  const sol = parseProductLedger(solLedgerText, { source: 'sol' });
  const hana1q = parseProductLedger(hana1qLedgerText, { source: 'hana1q' });
  const won = parseProductLedger(wonLedgerText, { source: 'won' });
  const eligibleSmall = [
    { source: 'kcgi', parsed: parseProductLedger(kcgiLedgerText, { source: 'kcgi' }), defaultSourceId: 'kcgi_official_product_html' },
    { source: 'midas', parsed: parseProductLedger(midasLedgerText, { source: 'midas' }), defaultSourceId: 'midas_official_product_html' },
    { source: 'thej', parsed: parseProductLedger(thejLedgerText, { source: 'thej' }), defaultSourceId: 'thej_official_product_html' },
  ];
  const koact = parseProductLedger(koactLedgerText, { source: 'koact' });
  const latestRise = latestSuccessfulProductRows(rise.entries);
  const latestTiger = latestSuccessfulProductRows(tiger.entries);
  const latestPlus = latestSuccessfulProductRows(plus.entries);
  const latestSol = latestSuccessfulProductRows(sol.entries);
  const latestHana1q = latestSuccessfulProductRows(hana1q.entries);
  const latestWon = latestSuccessfulProductRows(won.entries);
  const latestKoact = latestSuccessfulProductRows(koact.entries);
  const quarantine = [...rise.malformed, ...tiger.malformed, ...plus.malformed, ...sol.malformed, ...hana1q.malformed, ...won.malformed, ...koact.malformed, ...eligibleSmall.flatMap((item) => item.parsed.malformed)];
  const fieldCounts = {};
  const records = latestRise.map((entry) => convertRiseEntry(entry, rootDir, fieldCounts, quarantine)).filter(Boolean);
  latestTiger.forEach((entry) => {
    const converted = convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source: 'tiger', defaultSourceId: 'issuer_tiger_product', parserVersion: 'tiger-product-ledger-converter-1.0.0' });
    if (converted) records.push(converted);
  });
  latestPlus.forEach((entry) => {
    const converted = convertPlusLedgerEntry(entry, rootDir, fieldCounts, quarantine);
    if (converted) records.push(converted);
  });
  latestSol.forEach((entry) => {
    const converted = convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source: 'sol', defaultSourceId: 'sol_official_product_html', parserVersion: 'sol-product-ledger-converter-1.0.0' });
    if (converted) records.push(converted);
  });
  latestHana1q.forEach((entry) => {
    const converted = convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source: 'hana1q', defaultSourceId: 'hana_1q_official_product_html', parserVersion: 'hana-1q-product-ledger-converter-1.0.0' });
    if (converted) records.push(converted);
  });
  latestWon.forEach((entry) => {
    const converted = convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source: 'won', defaultSourceId: 'won_official_product_html', parserVersion: 'won-product-ledger-converter-1.0.0' });
    if (converted) records.push(converted);
  });
  latestKoact.forEach((entry) => {
    const converted = convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source: 'koact', defaultSourceId: 'koact_official_product_api', parserVersion: 'koact-product-ledger-converter-1.0.0' });
    if (converted) records.push(converted);
  });
  eligibleSmall.forEach((item) => latestSuccessfulProductRows(item.parsed.entries).forEach((entry) => {
    const converted = convertIssuerLedgerEntry(entry, rootDir, fieldCounts, quarantine, { source: item.source, defaultSourceId: item.defaultSourceId, parserVersion: `${item.source}-product-ledger-converter-1.0.0` });
    if (converted) records.push(converted);
  }));
  const usePlusCanaryFallback = plus.entries.length === 0;
  const plusRows = usePlusCanaryFallback && Array.isArray(plusReport?.rows) ? plusReport.rows : [];
  plusRows.forEach((row, index) => {
    const converted = convertPlusRow(row, plusReport, rootDir, fieldCounts, quarantine, index);
    if (converted) records.push(converted);
  });
  records.sort((a, b) => a.shortCode.localeCompare(b.shortCode) || a.provenance.sourceId.localeCompare(b.provenance.sourceId));

  const failureEvents = [
    ...rise.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({
      source: 'rise', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null,
      status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null,
      errors: entry.validation?.failures || [],
    })),
    ...tiger.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({
      source: 'tiger', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null,
      status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null,
      errors: entry.validation?.failures || [],
    })),
    ...plus.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({
      source: 'plus', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null,
      status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null,
      errors: entry.validation?.failures || [],
    })),
    ...sol.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({
      source: 'sol', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null,
      status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null,
      errors: entry.validation?.failures || [],
    })),
    ...hana1q.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({ source: 'hana1q', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null, status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null, errors: entry.validation?.failures || [] })),
    ...won.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({ source: 'won', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null, status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null, errors: entry.validation?.failures || [] })),
    ...koact.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({ source: 'koact', lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null, status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null, errors: entry.validation?.failures || [] })),
    ...eligibleSmall.flatMap((item) => item.parsed.entries.filter((entry) => !SUCCESS.has(entry.status)).map((entry) => ({ source: item.source, lineNumber: entry._lineNumber, shortCode: entry.shortCode ?? null, status: entry.status ?? null, retrievedAt: entry.retrievedAt ?? null, errors: entry.validation?.failures || [] }))),
  ];
  const latestTime = [
    ...rise.entries.map((entry) => entry.retrievedAt),
    ...tiger.entries.map((entry) => entry.retrievedAt),
    ...plus.entries.map((entry) => entry.sourceRetrievedAt || entry.retrievedAt),
    ...sol.entries.map((entry) => entry.retrievedAt),
    ...hana1q.entries.map((entry) => entry.retrievedAt),
    ...won.entries.map((entry) => entry.retrievedAt),
    ...koact.entries.map((entry) => entry.retrievedAt),
    ...eligibleSmall.flatMap((item) => item.parsed.entries.map((entry) => entry.retrievedAt)),
    usePlusCanaryFallback ? plusReport?.generatedAt : null,
  ]
    .filter(Boolean).sort().at(-1) || '1970-01-01T00:00:00.000Z';
  return {
    schemaVersion: SOURCE_RESULT_CONTRACT.schemaVersion,
    source: {
      sourceId: 'official_product_metadata_collection', sourceType: 'primary', retrievedAt: latestTime,
      parserVersion: 'product-metadata-results-converter-1.5.0', documentType: 'multi_issuer_product_source_result', confidence: 0.9,
    },
    records,
    health: {
      riseLedgerEntryCount: rise.entries.length,
      riseLatestSuccessCount: latestRise.length,
      tigerLedgerEntryCount: tiger.entries.length,
      tigerLatestSuccessCount: latestTiger.length,
      plusLedgerEntryCount: plus.entries.length,
      plusLatestSuccessCount: latestPlus.length,
      solLedgerEntryCount: sol.entries.length,
      solLatestSuccessCount: latestSol.length,
      hana1qLedgerEntryCount: hana1q.entries.length,
      hana1qLatestSuccessCount: latestHana1q.length,
      wonLedgerEntryCount: won.entries.length,
      wonLatestSuccessCount: latestWon.length,
      koactLedgerEntryCount: koact.entries.length,
      koactLatestSuccessCount: latestKoact.length,
      eligibleSmallLedgerEntryCount: eligibleSmall.reduce((count, item) => count + item.parsed.entries.length, 0),
      eligibleSmallLatestSuccessCount: eligibleSmall.reduce((count, item) => count + latestSuccessfulProductRows(item.parsed.entries).length, 0),
      plusInputRowCount: plusRows.length,
      plusCanaryFallbackUsed: usePlusCanaryFallback && plusRows.length > 0,
      emittedRecordCount: records.length,
      emittedBySource: records.reduce((counts, record) => ({ ...counts, [record.provenance.sourceId]: (counts[record.provenance.sourceId] || 0) + 1 }), {}),
      fieldCounts,
      failureEvents,
      sourceHealth: {
        rise: {
          ledgerEntryCount: rise.entries.length, latestSuccessCount: latestRise.length,
          emittedRecordCount: records.filter((record) => /rise/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'rise').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'rise').length,
        },
        tiger: {
          ledgerEntryCount: tiger.entries.length, latestSuccessCount: latestTiger.length,
          emittedRecordCount: records.filter((record) => /tiger/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'tiger').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'tiger').length,
        },
        plus: {
          ledgerEntryCount: plus.entries.length, latestSuccessCount: latestPlus.length,
          emittedRecordCount: records.filter((record) => /plus/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'plus').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'plus').length,
        },
        sol: {
          ledgerEntryCount: sol.entries.length, latestSuccessCount: latestSol.length,
          emittedRecordCount: records.filter((record) => /sol/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'sol').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'sol').length,
        },
        hana1q: {
          ledgerEntryCount: hana1q.entries.length, latestSuccessCount: latestHana1q.length,
          emittedRecordCount: records.filter((record) => /hana_1q/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'hana1q').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'hana1q').length,
        },
        won: {
          ledgerEntryCount: won.entries.length, latestSuccessCount: latestWon.length,
          emittedRecordCount: records.filter((record) => /won_/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'won').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'won').length,
        },
        koact: {
          ledgerEntryCount: koact.entries.length, latestSuccessCount: latestKoact.length,
          emittedRecordCount: records.filter((record) => /koact_/i.test(record.provenance.sourceId)).length,
          quarantineCount: quarantine.filter((item) => item.source === 'koact').length,
          failureEventCount: failureEvents.filter((item) => item.source === 'koact').length,
        },
        ...Object.fromEntries(eligibleSmall.map((item) => [item.source, {
          ledgerEntryCount: item.parsed.entries.length,
          latestSuccessCount: latestSuccessfulProductRows(item.parsed.entries).length,
          emittedRecordCount: records.filter((record) => record.provenance.sourceId === item.defaultSourceId).length,
          quarantineCount: quarantine.filter((row) => row.source === item.source).length,
          failureEventCount: failureEvents.filter((row) => row.source === item.source).length,
        }])),
      },
      plusRawUnavailableCount: quarantine.filter((item) => item.source === 'plus' && item.reason === 'raw_artifact_unavailable_in_probe').length,
    },
    quarantine: { count: quarantine.length, items: quarantine },
  };
}

export function runConverter(paths = DEFAULT_PATHS) {
  const riseLedgerText = existsSync(paths.riseLedger) ? readFileSync(paths.riseLedger, 'utf8') : '';
  const tigerLedgerText = existsSync(paths.tigerLedger) ? readFileSync(paths.tigerLedger, 'utf8') : '';
  const plusLedgerText = existsSync(paths.plusLedger) ? readFileSync(paths.plusLedger, 'utf8') : '';
  const solLedgerText = existsSync(paths.solLedger) ? readFileSync(paths.solLedger, 'utf8') : '';
  const hana1qLedgerText = existsSync(paths.hana1qLedger) ? readFileSync(paths.hana1qLedger, 'utf8') : '';
  const wonLedgerText = existsSync(paths.wonLedger) ? readFileSync(paths.wonLedger, 'utf8') : '';
  const koactLedgerText = existsSync(paths.koactLedger) ? readFileSync(paths.koactLedger, 'utf8') : '';
  const kcgiLedgerText = existsSync(paths.kcgiLedger) ? readFileSync(paths.kcgiLedger, 'utf8') : '';
  const midasLedgerText = existsSync(paths.midasLedger) ? readFileSync(paths.midasLedger, 'utf8') : '';
  const thejLedgerText = existsSync(paths.thejLedger) ? readFileSync(paths.thejLedger, 'utf8') : '';
  const plusReport = existsSync(paths.plusReport) ? JSON.parse(readFileSync(paths.plusReport, 'utf8')) : null;
  const output = convertProductMetadataResults({ riseLedgerText, tigerLedgerText, plusLedgerText, solLedgerText, hana1qLedgerText, wonLedgerText, koactLedgerText, kcgiLedgerText, midasLedgerText, thejLedgerText, plusReport });
  mkdirSync(dirname(paths.output), { recursive: true });
  const temporary = `${paths.output}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  renameSync(temporary, paths.output);
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const output = runConverter();
  console.log(`[metadata-v2:convert-product] records=${output.records.length} fields=${JSON.stringify(output.health.fieldCounts)} quarantine=${output.quarantine.count}`);
}
