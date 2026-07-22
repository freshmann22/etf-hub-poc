import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCandidates } from './lib/conflict-resolver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = Object.freeze({
  extraction: 'data/reports/metadata-v2/dart-pdf-batch-extraction.json',
  index: 'data/reports/metadata-v2/dart-disclosure-index.json',
  source: 'data/reports/metadata-v2/dart-pdf-batch-source-result.json',
  auditedSource: 'data/reports/metadata-v2/dart-pdf-batch-source-result-audited.json',
  canonical: 'data/normalized/etf-metadata-v2.json',
  resolution: 'config/metadata-field-resolution.json',
  report: 'data/reports/metadata-v2/dart-lineage-audit.json',
});
const absolute = (rel) => path.join(ROOT, rel);
const read = (rel) => JSON.parse(fs.readFileSync(absolute(rel), 'utf8'));
const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const codeOf = (record) => record.identity?.shortCode || record.universeKey;
const setPath = (target, field, value) => {
  const parts = field.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
};
const atomicWrite = (rel, value) => {
  const file = absolute(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, file);
};

export function auditDartLineage(extraction, { disclosureIndex, canonical } = {}) {
  if (!Array.isArray(extraction?.rows)) throw new Error('DART extraction rows are required');
  if (!Array.isArray(disclosureIndex?.rows) || !Array.isArray(canonical?.records)) throw new Error('DART disclosure index and canonical metadata are required');
  const indexByCode = new Map(disclosureIndex.rows.map((row) => [row.shortCode, row]));
  const issuerByCode = new Map(disclosureIndex.rows.map((row) => [row.shortCode, row.issuerId]));
  const namesByIssuer = new Map();
  for (const record of canonical.records) {
    const code = codeOf(record);
    const issuerId = issuerByCode.get(code) || record.identity?.issuerId;
    const normalizedName = normalize(record.identity?.officialName);
    if (!issuerId || !normalizedName) continue;
    if (!namesByIssuer.has(issuerId)) namesByIssuer.set(issuerId, []);
    namesByIssuer.get(issuerId).push({ code, officialName: record.identity.officialName, normalizedName });
  }
  const hashGroups = new Map();
  for (const row of extraction.rows) {
    const hash = row.source?.rawSha256 || 'missing';
    if (!hashGroups.has(hash)) hashGroups.set(hash, []);
    hashGroups.get(hash).push(row);
  }
  const duplicateHashes = new Set([...hashGroups].filter(([, rows]) => rows.length > 1).map(([hash]) => hash));
  const items = extraction.rows.map((row) => {
    const indexRow = indexByCode.get(row.etfCode);
    const reportName = indexRow?.match?.reportName || indexRow?.match?.report_nm || null;
    const normalizedReportName = normalize(reportName);
    const anchors = (namesByIssuer.get(indexRow?.issuerId) || []).filter((candidate) => normalizedReportName.includes(candidate.normalizedName));
    const maxLength = Math.max(0, ...anchors.map((candidate) => candidate.normalizedName.length));
    const longest = anchors.filter((candidate) => candidate.normalizedName.length === maxLength);
    const owner = longest.length === 1 ? longest[0] : null;
    const reasons = [];
    let severity = 'pass';
    if (!reportName || !owner) {
      severity = 'medium';
      reasons.push(!reportName ? 'missing_disclosure_report_name' : 'no_unique_longest_same_issuer_name_anchor');
    } else if (owner.code !== row.etfCode) {
      severity = 'high';
      reasons.push('disclosure_title_matches_more_specific_same_issuer_etf');
    }
    if (duplicateHashes.has(row.source?.rawSha256)) reasons.push('content_hash_reused_across_etfs');
    return {
      etfCode: row.etfCode,
      officialName: row.extraction?.fields?.officialName?.value || null,
      severity,
      reasons,
      reportName,
      matchedOwnerCode: owner?.code || null,
      matchedOwnerName: owner?.officialName || null,
      sameIssuerNameAnchorCount: anchors.length,
      contentHash: row.source?.rawSha256 || null,
      receptionNo: row.receptionNo || null,
      sourceUrl: row.source?.viewerUrl || null,
    };
  });
  const severityCounts = Object.fromEntries(['pass', 'medium', 'high'].map((severity) => [severity, items.filter((item) => item.severity === severity).length]));
  return {
    schemaVersion: 'dart-lineage-audit-v1',
    generatedAt: new Date().toISOString(),
    inputCount: extraction.rows.length,
    policy: {
      automaticQuarantine: 'official DART report title has a unique longest same-issuer ETF-name anchor that is not the matched ETF',
      mediumAction: 'retain outside canonical auto-merge until report-title lineage is resolvable',
      passAction: 'eligible for canonical merge',
    },
    summary: { severityCounts, duplicateHashGroupCount: [...hashGroups.values()].filter((rows) => rows.length > 1).length },
    items,
  };
}

export function sanitizeSourceResult(source, audit) {
  const high = new Map(audit.items.filter((item) => item.severity === 'high').map((item) => [item.etfCode, item]));
  const output = structuredClone(source);
  let quarantinedFieldCount = 0;
  for (const record of output.records || []) {
    const finding = high.get(record.shortCode);
    if (!finding) continue;
    quarantinedFieldCount += Object.keys(record.fields || {}).length;
    record.status = 'unavailable';
    record.fields = {};
    record.evidence = {};
    record.provenance = { ...record.provenance, status: 'unavailable', confidence: 0 };
    record.automatedAudit = { action: 'quarantined', reasons: finding.reasons, auditSchemaVersion: audit.schemaVersion };
  }
  output.source = { ...output.source, parserVersion: `${output.source.parserVersion}+lineage-audit-v1` };
  output.health = { ...output.health, lineageAudit: { highRiskRecordCount: high.size, quarantinedFieldCount } };
  return output;
}

export function sanitizeCanonical(canonical, audit, resolutionConfig) {
  const high = new Map(audit.items.filter((item) => item.severity === 'high').map((item) => [item.etfCode, item]));
  const output = structuredClone(canonical);
  const removedByField = {};
  let affectedRecordCount = 0;
  let removedCandidateCount = 0;
  for (const record of output.records) {
    const finding = high.get(codeOf(record));
    if (!finding) continue;
    let affected = false;
    for (const [field, candidates] of Object.entries(record.fieldCandidates || {})) {
      if (!Array.isArray(candidates)) continue;
      const retained = candidates.filter((candidate) => candidate.provenance?.sourceId !== 'opendart_pdf_batch');
      const removed = candidates.length - retained.length;
      if (!removed) continue;
      affected = true;
      removedCandidateCount += removed;
      removedByField[field] = (removedByField[field] || 0) + removed;
      record.fieldCandidates[field] = retained;
      const result = resolveCandidates(field, retained, resolutionConfig);
      setPath(record, field, result.selected ? result.selected.value : null);
      record.conflicts = (record.conflicts || []).filter((conflict) => conflict.field !== field);
      if (result.conflict) record.conflicts.push(result.conflict);
    }
    if (affected) affectedRecordCount += 1;
  }
  output.generatedAt = new Date().toISOString();
  output.automatedAudit = {
    schemaVersion: audit.schemaVersion,
    generatedAt: audit.generatedAt,
    highRiskRecordCount: high.size,
    affectedRecordCount,
    removedCandidateCount,
    removedByField,
  };
  return { output, metrics: output.automatedAudit };
}

export function run({ apply = false } = {}) {
  const extraction = read(PATHS.extraction);
  const disclosureIndex = read(PATHS.index);
  const source = read(PATHS.source);
  const canonical = read(PATHS.canonical);
  if (extraction.rows.length !== 911 || source.records.length !== 911 || canonical.records.length !== 1141) {
    throw new Error(`universe guard failed: extraction=${extraction.rows.length}, source=${source.records.length}, canonical=${canonical.records.length}`);
  }
  const audit = auditDartLineage(extraction, { disclosureIndex, canonical });
  const auditedSource = sanitizeSourceResult(source, audit);
  const sanitized = sanitizeCanonical(canonical, audit, read(PATHS.resolution));
  const report = { ...audit, application: { requested: apply, ...sanitized.metrics } };
  atomicWrite(PATHS.report, report);
  atomicWrite(PATHS.auditedSource, auditedSource);
  if (apply && sanitized.metrics.removedCandidateCount > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `tmp/full-auto-audit-${stamp}/etf-metadata-v2.json`;
    fs.mkdirSync(path.dirname(absolute(backup)), { recursive: true });
    fs.copyFileSync(absolute(PATHS.canonical), absolute(backup));
    atomicWrite(PATHS.canonical, sanitized.output);
    report.application.backupPath = backup;
    atomicWrite(PATHS.report, report);
  } else if (apply) {
    report.application.noop = true;
    atomicWrite(PATHS.report, report);
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const report = run({ apply: process.argv.includes('--apply') });
  console.log(`[dart-lineage-audit] input=${report.inputCount} severity=${JSON.stringify(report.summary.severityCounts)}`);
  console.log(`[dart-lineage-audit] affected=${report.application.affectedRecordCount} removedCandidates=${report.application.removedCandidateCount} apply=${report.application.requested}`);
}
