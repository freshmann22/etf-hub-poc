// ETF 통합 메타데이터 품질 리포트 생성.
//   입력: data/normalized/etf-metadata.json, data/raw/wisereport/_collection-results.json, config/field-source-priority.json
//   출력: data/reports/metadata-coverage.json, metadata-conflicts.csv, metadata-missing.csv, source-success-rates.csv
//   실행: npm run metadata:report
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeJsonCache, writeCache, cacheExists } from './metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const METADATA_FILE = resolve(ROOT, 'data/normalized/etf-metadata.json');
const RESULTS_FILE = resolve(ROOT, 'data/raw/wisereport/_collection-results.json');
const PRIORITY_FILE = resolve(ROOT, 'config/field-source-priority.json');
const OUT_COVERAGE = resolve(ROOT, 'data/reports/metadata-coverage.json');
const OUT_CONFLICTS = resolve(ROOT, 'data/reports/metadata-conflicts.csv');
const OUT_MISSING = resolve(ROOT, 'data/reports/metadata-missing.csv');
const OUT_SUCCESS = resolve(ROOT, 'data/reports/source-success-rates.csv');

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, header) {
  return [header.join(','), ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(','))].join('\n') + '\n';
}

function fieldGroupPresence(r) {
  return {
    etfCode: !!r.etfCode,
    name: !!r.name,
    issuer: !!r.issuer,
    benchmarkName: !!r.benchmark?.name,
    descriptions: !!(r.descriptions?.productDescription || r.descriptions?.investmentObjective || r.descriptions?.strategyDescription),
    holdings: r.holdings?.length > 0,
    strategyFacts: !!(r.classificationFacts?.rawTypeText || r.classificationFacts?.nameHints?.length),
    distribution: !!r.distribution?.scheduleText,
    sectorCountryWeights: r.sectorWeights?.length > 0 || r.countryWeights?.length > 0,
    feesAndAssets: r.fees?.totalFeePct != null || r.fees?.netAssetsMillionKrw != null,
  };
}

function computeCoverage(r, weights) {
  const presence = fieldGroupPresence(r);
  let score = 0;
  const available = [];
  const missing = [];
  for (const [group, weight] of Object.entries(weights)) {
    if (group.startsWith('_')) continue;
    if (presence[group]) {
      score += weight;
      available.push(group);
    } else {
      missing.push(group);
    }
  }
  return { score: Math.round(score * 1000) / 1000, availableFields: available, missingFields: missing };
}

function main() {
  if (!cacheExists(METADATA_FILE)) throw new Error('먼저 npm run metadata:normalize 를 실행하세요.');
  const metadata = readJsonCache(METADATA_FILE);
  const priorityConfig = readJsonCache(PRIORITY_FILE);
  const thresholds = priorityConfig.coverageThresholds;
  const weights = priorityConfig.fieldWeights;

  let highConfidence = 0, lowConfidence = 0, needsMoreData = 0;
  const conflictRows = [];
  const missingRows = [];
  const fieldCoverageCounts = Object.fromEntries(Object.keys(weights).filter((k) => !k.startsWith('_')).map((k) => [k, 0]));

  for (const r of metadata.records) {
    const cov = computeCoverage(r, weights);
    r.coverage = cov;
    if (cov.score >= thresholds.highConfidence) highConfidence++;
    else if (cov.score >= thresholds.lowConfidence) lowConfidence++;
    else needsMoreData++;

    for (const f of cov.availableFields) fieldCoverageCounts[f]++;

    for (const m of cov.missingFields) {
      missingRows.push({ etfCode: r.etfCode, name: r.name, missingField: m, coverageScore: cov.score });
    }
    for (const c of r.conflicts || []) {
      conflictRows.push({
        etfCode: r.etfCode,
        field: c.field,
        selectedValue: c.selectedValue,
        selectedSource: c.selectedSource,
        otherValue: c.otherValue,
        otherSource: c.otherSource,
        asOfDateDiff: c.asOfDateDiff,
        reason: c.reason,
      });
    }
  }

  // 재저장(coverage 반영본으로 갱신)
  writeJsonCache(METADATA_FILE, metadata);

  const totalRecords = metadata.records.length;
  const fieldCoveragePct = Object.fromEntries(
    Object.entries(fieldCoverageCounts).map(([k, v]) => [k, totalRecords ? Math.round((v / totalRecords) * 1000) / 10 : 0])
  );

  const collectionRuns = cacheExists(RESULTS_FILE) ? readJsonCache(RESULTS_FILE).runs : [];
  const successRows = collectionRuns.map((run, i) => ({
    runIndex: i + 1,
    source: run.source,
    generatedAt: run.generatedAt,
    requested: run.requested,
    fromCache: run.fromCache,
    success: run.success,
    empty: run.empty,
    failed: run.failed,
    successRatePct: run.successRate,
  }));

  const coverageReport = {
    generatedAt: new Date().toISOString(),
    masterEtfCount: metadata.masterEtfCount,
    integratedRecordCount: totalRecords,
    coverageBuckets: {
      highConfidence: { threshold: `>= ${thresholds.highConfidence}`, count: highConfidence },
      lowConfidence: { threshold: `${thresholds.lowConfidence} ~ ${thresholds.highConfidence}`, count: lowConfidence },
      needsMoreData: { threshold: `< ${thresholds.lowConfidence}`, count: needsMoreData },
    },
    fieldCoveragePct,
    conflictCount: conflictRows.length,
    missingFieldEntryCount: missingRows.length,
  };

  writeJsonCache(OUT_COVERAGE, coverageReport);
  writeCache(OUT_CONFLICTS, toCsv(conflictRows, ['etfCode', 'field', 'selectedValue', 'selectedSource', 'otherValue', 'otherSource', 'asOfDateDiff', 'reason']));
  writeCache(OUT_MISSING, toCsv(missingRows, ['etfCode', 'name', 'missingField', 'coverageScore']));
  writeCache(OUT_SUCCESS, toCsv(successRows, ['runIndex', 'source', 'generatedAt', 'requested', 'fromCache', 'success', 'empty', 'failed', 'successRatePct']));

  console.log(`[metadata:report] 통합 레코드 ${totalRecords}종 | coverage>=0.75: ${highConfidence} | 0.45~0.75: ${lowConfidence} | <0.45: ${needsMoreData}`);
  console.log(`[metadata:report] 충돌 ${conflictRows.length}건, 누락항목 ${missingRows.length}건 → ${OUT_COVERAGE}`);
}

main();
