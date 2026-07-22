import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_RESULT_CONTRACT } from './merge-source-results.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  input: resolve(ROOT, 'data/reports/metadata-v2/dart-pdf-batch-extraction.json'),
  output: resolve(ROOT, 'data/reports/metadata-v2/dart-pdf-batch-source-result.json'),
});

export const DART_FULL_BATCH_EXTRACTION_CONTRACT = Object.freeze({
  scope: 'dart_pdf_full_batch',
  expectedTargetCount: 911,
  sourceLedger: 'data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl',
  sourceIndex: 'data/reports/metadata-v2/dart-disclosure-index.json',
  rawPathPrefix: 'data/raw/metadata-v2/dart-pdf-batch/',
});

const DIRECT_FIELDS = Object.freeze({
  officialName: 'identity.officialName',
  issuer: 'identity.issuerName',
  productDescription: 'product.description',
  investmentObjective: 'product.investmentObjective',
  benchmarkName: 'product.benchmark.name',
  benchmarkDescription: 'product.benchmark.description',
  distributionPolicy: 'distribution.schedule',
});

const FULL_BATCH_DIRECT_FIELDS = Object.freeze({
  officialName: 'identity.officialName',
});

const FULL_BATCH_SEMANTIC_FIELDS = Object.freeze({
  investmentObjective: 'product.investmentObjective',
  benchmarkName: 'product.benchmark.name',
  benchmarkDescription: 'product.benchmark.description',
  distributionSchedule: 'distribution.schedule',
  distributionFrequency: 'distribution.frequency',
});

const FULL_BATCH_EVIDENCE_ONLY_FIELDS = Object.freeze([
  'issuer',
  'productDescription',
  'investmentObjective',
  'benchmarkName',
  'benchmarkDescription',
  'distributionPolicy',
]);

const FULL_BATCH_EVIDENCE_ONLY_REASONS = Object.freeze({
  issuer: 'full_batch_field_lacks_safe_pdf_extraction_contract',
  productDescription: 'full_batch_strategy_window_is_not_a_canonical_product_description',
  investmentObjective: 'full_batch_objective_window_requires_clause_level_semantic_review',
  benchmarkName: 'full_batch_field_lacks_safe_pdf_extraction_contract',
  benchmarkDescription: 'full_batch_benchmark_window_is_evidence_only_until_semantic_extractor_review',
  distributionPolicy: 'full_batch_distribution_window_is_not_a_canonical_schedule',
});

function dateOnly(value) {
  if (value == null) return null;
  const text = String(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function populated(evidence) {
  return evidence != null && evidence.value != null && evidence.value !== '';
}

function evidenceFor(extracted, row, extractionRule) {
  return {
    sectionHeading: extracted.sectionHeading ?? null,
    snippet: extracted.snippet ?? null,
    sourceEntries: extracted.sourceEntries || row.extraction?.sourceEntries || [],
    receptionNo: row.receptionNo ?? null,
    extractionRule,
  };
}

function absoluteRawPath(rootDir, storedPath) {
  return isAbsolute(storedPath) ? storedPath : resolve(rootDir, storedPath);
}

function confinedBatchRawPath(rootDir, storedPath) {
  const localPath = absoluteRawPath(rootDir, storedPath);
  const batchRoot = resolve(rootDir, DART_FULL_BATCH_EXTRACTION_CONTRACT.rawPathPrefix);
  const relation = relative(batchRoot, localPath);
  const contained = relation && relation !== '..' && !relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(relation);
  if (!contained) return null;
  if (existsSync(localPath) && existsSync(batchRoot)) {
    const realRelation = relative(realpathSync(batchRoot), realpathSync(localPath));
    if (!realRelation || realRelation === '..' || realRelation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(realRelation)) return null;
  }
  return localPath;
}

function confinedReportOutput(rootDir, outputPath) {
  const localPath = isAbsolute(outputPath) ? outputPath : resolve(rootDir, outputPath);
  const reportRoot = resolve(rootDir, 'data/reports/metadata-v2');
  const relation = relative(reportRoot, localPath);
  const separator = process.platform === 'win32' ? '\\' : '/';
  const contained = relation && relation !== '..' && !relation.startsWith(`..${separator}`) && !isAbsolute(relation);
  if (!contained || !localPath.toLowerCase().endsWith('.json')) {
    throw new Error('DART converter output must be a JSON file inside data/reports/metadata-v2');
  }
  return localPath;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function explicitFlag(fields, flag) {
  return fields?.flags?.[flag]?.value === true ? fields.flags[flag] : null;
}

function addField(outputFields, evidence, path, extracted, rule) {
  if (!populated(extracted)) return false;
  outputFields[path] = extracted.value;
  evidence[path] = rule ? evidenceFor(extracted, rule.row, rule.name) : null;
  return true;
}

function semanticFieldValid(extracted) {
  return populated(extracted)
    && typeof extracted.value === 'string'
    && extracted.value.trim().length > 0
    && typeof extracted.rule === 'string'
    && extracted.rule.trim().length > 0;
}

export function convertDartExtraction(report, { rootDir = ROOT } = {}) {
  if (!Array.isArray(report?.rows)) throw new Error('DART extraction rows are required');
  const fullBatch = report.extractionContract?.scope === DART_FULL_BATCH_EXTRACTION_CONTRACT.scope;
  const records = [];
  const quarantine = [];
  const warnings = [];
  const fieldCounts = {};
  const skippedExplicitFlags = [];
  const skippedEvidenceOnlyFields = [];

  for (let index = 0; index < report.rows.length; index += 1) {
    const row = report.rows[index];
    if (row.extraction?.parserStatus !== 'parsed') {
      quarantine.push({ rowIndex: index, shortCode: row.etfCode ?? null, reason: 'dart_extraction_not_parsed', parserStatus: row.extraction?.parserStatus ?? null });
      continue;
    }
    if (!/^[0-9A-Z]{6}$/.test(row.etfCode || '')) {
      quarantine.push({ rowIndex: index, shortCode: row.etfCode ?? null, reason: 'dart_invalid_short_code' });
      continue;
    }
    const rawPath = row.source?.rawSnapshotPath;
    const rawHash = row.source?.rawSha256;
    if (!rawPath || !/^[a-f0-9]{64}$/.test(rawHash || '')) {
      quarantine.push({ rowIndex: index, shortCode: row.etfCode, reason: 'dart_raw_reference_missing' });
      continue;
    }
    const localPath = fullBatch ? confinedBatchRawPath(rootDir, rawPath) : absoluteRawPath(rootDir, rawPath);
    if (!localPath) {
      quarantine.push({ rowIndex: index, shortCode: row.etfCode, reason: 'dart_raw_path_outside_batch', rawSnapshotPath: rawPath });
      continue;
    }
    if (!existsSync(localPath)) {
      quarantine.push({ rowIndex: index, shortCode: row.etfCode, reason: 'dart_raw_file_missing', rawSnapshotPath: rawPath });
      continue;
    }
    if (sha256(readFileSync(localPath)) !== rawHash) {
      quarantine.push({ rowIndex: index, shortCode: row.etfCode, reason: 'dart_raw_hash_mismatch', rawSnapshotPath: rawPath });
      continue;
    }

    const extractedFields = row.extraction.fields || {};
    const fields = {};
    const evidence = {};
    const directFields = fullBatch ? FULL_BATCH_DIRECT_FIELDS : DIRECT_FIELDS;
    for (const [inputField, canonicalField] of Object.entries(directFields)) {
      const extracted = extractedFields[inputField];
      if (addField(fields, evidence, canonicalField, extracted, { row, name: `dart_${inputField}` })) {
        fieldCounts[canonicalField] = (fieldCounts[canonicalField] || 0) + 1;
      }
    }
    if (fullBatch) {
      const semanticFields = row.extraction.semanticFields || {};
      for (const [inputField, canonicalField] of Object.entries(FULL_BATCH_SEMANTIC_FIELDS)) {
        const extracted = semanticFields[inputField];
        if (!semanticFieldValid(extracted)) continue;
        if (addField(fields, evidence, canonicalField, extracted, { row, name: extracted.rule })) {
          fieldCounts[canonicalField] = (fieldCounts[canonicalField] || 0) + 1;
        }
      }
      for (const inputField of FULL_BATCH_EVIDENCE_ONLY_FIELDS) {
        if (!extractedFields[inputField]) continue;
        skippedEvidenceOnlyFields.push({
          shortCode: row.etfCode,
          inputField,
          reason: FULL_BATCH_EVIDENCE_ONLY_REASONS[inputField],
        });
      }
    }

    // Full-batch flags previously came from the ledger/index display name, not
    // from PDF evidence. Retain canary compatibility, but never attribute those
    // name-derived facts to a full-batch PDF.
    const inverse = fullBatch ? null : explicitFlag(extractedFields, 'inverse');
    const leveraged = fullBatch ? null : explicitFlag(extractedFields, 'leveraged');
    const synthetic = fullBatch ? null : explicitFlag(extractedFields, 'synthetic');
    const currencyHedged = fullBatch ? null : explicitFlag(extractedFields, 'currencyHedged');
    const derivative = fullBatch ? null : explicitFlag(extractedFields, 'derivative');
    if (inverse) {
      fields['product.derivative.direction'] = 'inverse';
      evidence['product.derivative.direction'] = evidenceFor(inverse, row, 'explicit_inverse_true');
    } else if (leveraged) {
      fields['product.derivative.direction'] = 'long';
      evidence['product.derivative.direction'] = evidenceFor(leveraged, row, 'explicit_leveraged_true_without_inverse');
    }
    if (synthetic) {
      fields['product.replication'] = 'synthetic';
      evidence['product.replication'] = evidenceFor(synthetic, row, 'explicit_synthetic_true');
    }
    if (currencyHedged) {
      fields['product.currencyHedged'] = true;
      evidence['product.currencyHedged'] = evidenceFor(currencyHedged, row, 'explicit_currency_hedged_true');
    }
    if (derivative && !inverse && !leveraged) {
      skippedExplicitFlags.push({ shortCode: row.etfCode, flag: 'derivative', reason: 'canonical_derivative_requires_direction_or_multiple' });
    }
    for (const path of ['product.derivative.direction', 'product.replication', 'product.currencyHedged']) {
      if (Object.hasOwn(fields, path)) fieldCounts[path] = (fieldCounts[path] || 0) + 1;
    }
    if (!Object.keys(fields).length && !fullBatch) {
      warnings.push({ rowIndex: index, shortCode: row.etfCode, reason: 'dart_no_safe_populated_fields' });
      continue;
    }

    const recordStatus = Object.keys(fields).length
      ? (row.extraction.diagnostics?.coverOnly ? 'partial' : 'ok')
      : 'unavailable';

    records.push({
      shortCode: row.etfCode,
      status: recordStatus,
      asOfDate: dateOnly(row.receptionDate),
      fields,
      evidence,
      provenance: {
        sourceId: row.source.sourceId || 'opendart_document_xml',
        sourceType: 'primary',
        url: row.source.viewerUrl ?? null,
        documentType: fullBatch ? 'investment_prospectus_pdf' : 'investment_prospectus_xml',
        retrievedAt: report.generatedAt,
        asOfDate: dateOnly(row.receptionDate),
        rawSnapshotPath: rawPath,
        contentHash: rawHash,
        parserVersion: `dart-extraction-${report.schemaVersion || '1.0.0'}`,
        status: recordStatus,
        confidence: recordStatus === 'unavailable' ? 0 : (row.extraction.diagnostics?.coverOnly ? 0.85 : 0.95),
      },
    });
  }

  return {
    schemaVersion: SOURCE_RESULT_CONTRACT.schemaVersion,
    source: {
      sourceId: fullBatch ? 'opendart_pdf_batch' : 'opendart_extraction_canary',
      sourceType: 'primary',
      retrievedAt: report.generatedAt,
      parserVersion: `dart-extraction-converter-${report.schemaVersion || '1.0.0'}`,
      documentType: 'multi_document_dart_source_result',
      confidence: 0.85,
    },
    records,
    health: {
      inputRowCount: report.rows.length,
      emittedRecordCount: records.length,
      fieldCounts,
      nullOrAbsentValuesEmittedAsFalseCount: 0,
      skippedExplicitFlags,
      skippedEvidenceOnlyFields,
      evidenceOnlyRecordCount: records.filter((record) => record.status === 'unavailable').length,
      warnings,
      limitation: report.scaleDecision?.reason ?? null,
      readyForMerge: fullBatch ? quarantine.length === 0 && warnings.length === 0 && records.length === report.rows.length : null,
      blockingIssueCount: fullBatch ? quarantine.length + warnings.length : null,
      fullBatchValidation: fullBatch ? {
        scope: report.extractionContract.scope,
        expectedTargetCount: report.extractionContract.expectedTargetCount,
        inputRowCount: report.rows.length,
        complete: report.extractionContract.complete,
      } : null,
    },
    quarantine: { count: quarantine.length, items: quarantine },
  };
}

export function validateFullBatchExtraction(report, {
  expectedTargetCount = DART_FULL_BATCH_EXTRACTION_CONTRACT.expectedTargetCount,
  rootDir = ROOT,
} = {}) {
  const contract = report?.extractionContract;
  if (contract?.scope !== DART_FULL_BATCH_EXTRACTION_CONTRACT.scope) {
    throw new Error(`DART full-batch extraction scope is required; got ${contract?.scope || 'missing'}`);
  }
  if (contract.sourceLedger !== DART_FULL_BATCH_EXTRACTION_CONTRACT.sourceLedger) {
    throw new Error(`unexpected DART full-batch source ledger: ${contract.sourceLedger || 'missing'}`);
  }
  if (contract.sourceIndex !== DART_FULL_BATCH_EXTRACTION_CONTRACT.sourceIndex) {
    throw new Error(`unexpected DART full-batch source index: ${contract.sourceIndex || 'missing'}`);
  }
  if (!Number.isInteger(contract.expectedTargetCount) || contract.expectedTargetCount !== expectedTargetCount) {
    throw new Error(`DART full-batch target count must be ${expectedTargetCount}; got ${contract.expectedTargetCount}`);
  }
  for (const field of ['latestLedgerRowCount', 'successfulPdfCount', 'inputRowCount']) {
    if (contract[field] !== expectedTargetCount) throw new Error(`DART full-batch ${field} must be ${expectedTargetCount}; got ${contract[field]}`);
  }
  if (contract.complete !== true) throw new Error('DART full-batch extraction must declare complete=true');
  if (!Array.isArray(report.rows) || report.rows.length !== expectedTargetCount) {
    throw new Error(`DART full-batch rows must contain ${expectedTargetCount} entries; got ${report?.rows?.length ?? 'missing'}`);
  }
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) throw new Error('DART full-batch generatedAt must be an ISO date-time');
  const codes = new Set();
  for (const [index, row] of report.rows.entries()) {
    if (!/^[0-9A-Z]{6}$/.test(row?.etfCode || '')) throw new Error(`DART full-batch row ${index} has an invalid ETF code`);
    if (codes.has(row.etfCode)) throw new Error(`DART full-batch contains duplicate ETF code: ${row.etfCode}`);
    codes.add(row.etfCode);
    const rawPath = row.source?.rawSnapshotPath;
    if (typeof rawPath !== 'string' || !rawPath.startsWith(DART_FULL_BATCH_EXTRACTION_CONTRACT.rawPathPrefix) || !rawPath.toLowerCase().endsWith('.pdf')) {
      throw new Error(`DART full-batch row ${row.etfCode} must reference a batch PDF`);
    }
    if (!confinedBatchRawPath(rootDir, rawPath)) {
      throw new Error(`DART full-batch row ${row.etfCode} references a PDF outside the batch root`);
    }
    if (row.universeKey !== row.etfCode) throw new Error(`DART full-batch row ${row.etfCode} has mismatched identity lineage`);
    if (row.source?.sourceId !== 'opendart_pdf_batch') throw new Error(`DART full-batch row ${row.etfCode} has invalid sourceId`);
    if (!/^\d{14}$/.test(row.receptionNo || '') || !/^\d{8}$/.test(row.receptionDate || '') || !row.receptionNo.startsWith(row.receptionDate)) {
      throw new Error(`DART full-batch row ${row.etfCode} has invalid reception lineage`);
    }
    const semanticFields = row.extraction?.semanticFields;
    if (semanticFields != null && (typeof semanticFields !== 'object' || Array.isArray(semanticFields))) {
      throw new Error(`DART full-batch row ${row.etfCode} has invalid semanticFields`);
    }
    for (const [field, extracted] of Object.entries(semanticFields || {})) {
      if (!Object.hasOwn(FULL_BATCH_SEMANTIC_FIELDS, field)) {
        throw new Error(`DART full-batch row ${row.etfCode} has unsupported semantic field: ${field}`);
      }
      if (!semanticFieldValid(extracted)) {
        throw new Error(`DART full-batch row ${row.etfCode} has invalid semantic field evidence: ${field}`);
      }
    }
  }
  return report;
}

export function validateConvertedFullBatchOutput(output, expectedInputCount) {
  if (output?.source?.sourceId !== 'opendart_pdf_batch') throw new Error('converted DART full-batch sourceId is invalid');
  if (output.source.documentType !== 'multi_document_dart_source_result') throw new Error('converted DART full-batch documentType is invalid');
  if (output.health?.fullBatchValidation?.complete !== true || output.health.inputRowCount !== expectedInputCount) {
    throw new Error('converted DART full-batch validation metadata is incomplete');
  }
  const accounted = output.records.length + output.quarantine.count + output.health.warnings.length;
  if (accounted !== expectedInputCount) throw new Error(`converted DART full-batch row accounting mismatch: ${accounted}/${expectedInputCount}`);
  if (output.health.readyForMerge !== true || output.health.blockingIssueCount !== 0 || output.records.length !== expectedInputCount) {
    throw new Error(`converted DART full-batch output is not merge-ready: blocking=${output.health.blockingIssueCount ?? 'unknown'}`);
  }
  const allowedFields = new Set([
    ...Object.values(FULL_BATCH_DIRECT_FIELDS),
    ...Object.values(FULL_BATCH_SEMANTIC_FIELDS),
  ]);
  for (const record of output.records) {
    for (const field of Object.keys(record.fields || {})) {
      if (!allowedFields.has(field)) throw new Error(`converted DART full-batch emitted an evidence-only field: ${field}`);
      if (field !== 'identity.officialName' && !record.evidence?.[field]?.extractionRule) {
        throw new Error(`converted DART full-batch semantic field is missing its extraction rule: ${field}`);
      }
    }
  }
  return output;
}

export function runConverter(paths = DEFAULT_PATHS, options = {}) {
  const validatedOutputPath = confinedReportOutput(options.rootDir || ROOT, paths.output);
  const report = JSON.parse(readFileSync(paths.input, 'utf8'));
  validateFullBatchExtraction(report, options);
  const output = convertDartExtraction(report, { rootDir: options.rootDir || ROOT });
  validateConvertedFullBatchOutput(output, report.rows.length);
  mkdirSync(dirname(validatedOutputPath), { recursive: true });
  const temporary = `${validatedOutputPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  renameSync(temporary, validatedOutputPath);
  return output;
}

function parseArgs(argv) {
  const paths = { ...DEFAULT_PATHS };
  for (const arg of argv) {
    if (arg.startsWith('--input=')) paths.input = resolve(ROOT, arg.slice('--input='.length));
    else if (arg.startsWith('--output=')) paths.output = resolve(ROOT, arg.slice('--output='.length));
    else throw new Error('usage: node scripts/metadata-v2/convert-dart-extraction.mjs [--input=<full-batch-extraction.json>] [--output=<full-batch-source-result.json>]');
  }
  return paths;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const output = runConverter(parseArgs(process.argv.slice(2)));
    console.log(`[metadata-v2:convert-dart] scope=${output.health.fullBatchValidation.scope} records=${output.records.length} fields=${JSON.stringify(output.health.fieldCounts)} quarantine=${output.quarantine.count}`);
  } catch (error) {
    console.error(`[metadata-v2:convert-dart] ${error.message}`);
    process.exitCode = 1;
  }
}
