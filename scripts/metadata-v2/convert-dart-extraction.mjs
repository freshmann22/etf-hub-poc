import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_RESULT_CONTRACT } from './merge-source-results.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PATHS = Object.freeze({
  input: resolve(ROOT, 'data/reports/metadata-v2/dart-extraction-canary.json'),
  output: resolve(ROOT, 'data/reports/metadata-v2/dart-source-result.json'),
});

const DIRECT_FIELDS = Object.freeze({
  officialName: 'identity.officialName',
  issuer: 'identity.issuerName',
  productDescription: 'product.description',
  investmentObjective: 'product.investmentObjective',
  benchmarkName: 'product.benchmark.name',
  benchmarkDescription: 'product.benchmark.description',
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
    sourceEntries: row.extraction?.sourceEntries || [],
    receptionNo: row.receptionNo ?? null,
    extractionRule,
  };
}

function absoluteRawPath(rootDir, storedPath) {
  return isAbsolute(storedPath) ? storedPath : resolve(rootDir, storedPath);
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

export function convertDartExtraction(report, { rootDir = ROOT } = {}) {
  if (!Array.isArray(report?.rows)) throw new Error('DART extraction rows are required');
  const records = [];
  const quarantine = [];
  const warnings = [];
  const fieldCounts = {};
  const skippedExplicitFlags = [];

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
    const localPath = absoluteRawPath(rootDir, rawPath);
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
    for (const [inputField, canonicalField] of Object.entries(DIRECT_FIELDS)) {
      const extracted = extractedFields[inputField];
      if (addField(fields, evidence, canonicalField, extracted, { row, name: `dart_${inputField}` })) {
        fieldCounts[canonicalField] = (fieldCounts[canonicalField] || 0) + 1;
      }
    }

    const inverse = explicitFlag(extractedFields, 'inverse');
    const leveraged = explicitFlag(extractedFields, 'leveraged');
    const synthetic = explicitFlag(extractedFields, 'synthetic');
    const currencyHedged = explicitFlag(extractedFields, 'currencyHedged');
    const derivative = explicitFlag(extractedFields, 'derivative');
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
    if (!Object.keys(fields).length) {
      warnings.push({ rowIndex: index, shortCode: row.etfCode, reason: 'dart_no_safe_populated_fields' });
      continue;
    }

    records.push({
      shortCode: row.etfCode,
      status: row.extraction.diagnostics?.coverOnly ? 'partial' : 'ok',
      asOfDate: dateOnly(row.receptionDate),
      fields,
      evidence,
      provenance: {
        sourceId: row.source.sourceId || 'opendart_document_xml',
        sourceType: 'primary',
        url: row.source.viewerUrl ?? null,
        documentType: 'investment_prospectus_xml',
        retrievedAt: report.generatedAt,
        asOfDate: dateOnly(row.receptionDate),
        rawSnapshotPath: rawPath,
        contentHash: rawHash,
        parserVersion: `dart-extraction-${report.schemaVersion || '1.0.0'}`,
        status: row.extraction.diagnostics?.coverOnly ? 'partial' : 'ok',
        confidence: row.extraction.diagnostics?.coverOnly ? 0.85 : 0.95,
      },
    });
  }

  return {
    schemaVersion: SOURCE_RESULT_CONTRACT.schemaVersion,
    source: {
      sourceId: 'opendart_extraction_canary',
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
      warnings,
      limitation: report.scaleDecision?.reason ?? null,
    },
    quarantine: { count: quarantine.length, items: quarantine },
  };
}

export function runConverter(paths = DEFAULT_PATHS) {
  const report = JSON.parse(readFileSync(paths.input, 'utf8'));
  const output = convertDartExtraction(report);
  mkdirSync(dirname(paths.output), { recursive: true });
  const temporary = `${paths.output}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  renameSync(temporary, paths.output);
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const output = runConverter();
  console.log(`[metadata-v2:convert-dart] records=${output.records.length} fields=${JSON.stringify(output.health.fieldCounts)} quarantine=${output.quarantine.count}`);
}
