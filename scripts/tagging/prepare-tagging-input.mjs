// 통합 메타데이터(data/normalized/etf-metadata.json) → 태깅용 compact input(JSONL) 생성.
//   실행: npm run tagging:prepare [-- --etf=069500,102110] [-- --limit=N]
//   출력: data/tagging/etf-tagging-input.jsonl (1줄 1 ETF), data/tagging/etf-tagging-input.stats.json
//
// 원칙(프롬프트 §5): 원본 메타데이터는 수정하지 않는다(읽기 전용). 구성종목은 상위 10개로 축약,
// 출처 URL·수집로그·HTML 원문 제외, 입력 크기 추정치(문자수/토큰추정치) 포함.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const METADATA_FILE = resolve(ROOT, 'data/normalized/etf-metadata.json');
const INDEX_NAMES_FILE = resolve(ROOT, 'data/tagging/etf-universe-index-names.json');
const OUT_JSONL = resolve(ROOT, 'data/tagging/etf-tagging-input.jsonl');
const OUT_STATS = resolve(ROOT, 'data/tagging/etf-tagging-input.stats.json');
const MAX_HOLDINGS = 10;

function parseArgs(argv) {
  const args = { etf: null, limit: null };
  for (const raw of argv) {
    if (raw.startsWith('--etf=')) args.etf = raw.slice('--etf='.length).split(',').map((s) => s.trim());
    else if (raw.startsWith('--limit=')) args.limit = Number(raw.slice('--limit='.length));
  }
  return args;
}

// 대략적 토큰 추정치(한국어 혼합 텍스트, Claude 토크나이저 근사): 문자수 / 2.2.
// 정확한 토크나이저를 새로 도입하지 않고(§21 "불필요한 프레임워크 금지") 자릿수 규모 파악용 근사치임을 명시.
function estimateTokens(charCount) {
  return Math.ceil(charCount / 2.2);
}

function buildCompactRecord(r, indexNameByCode = new Map()) {
  const fallbackIndexName = indexNameByCode.get(r.etfCode) || null;
  const benchmarkName = r.benchmark?.name ?? fallbackIndexName;
  const usedIndexFallback = !r.benchmark?.name && Boolean(fallbackIndexName);
  const originalMissingFields = r.coverage?.missingFields ?? [];
  const missingFields = usedIndexFallback
    ? originalMissingFields.filter((field) => field !== 'benchmarkName')
    : originalMissingFields;
  const coverageScore = r.coverage?.score ?? null;
  const holdings = (r.holdings || [])
    .slice()
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, MAX_HOLDINGS)
    .map((h) => ({ code: h.code, name: h.name, weight: h.weight }));

  const compact = {
    etfCode: r.etfCode,
    name: r.name,
    issuer: r.issuer,
    listingDate: r.listingDate,
    benchmark: {
      name: benchmarkName,
      description: r.benchmark?.description ?? null,
      provider: r.benchmark?.provider ?? null,
      source: r.benchmark?.name ? 'normalized_metadata' : (fallbackIndexName ? 'publicdata_universe_snapshot' : null),
    },
    descriptions: {
      product: r.descriptions?.productDescription ?? null,
      investmentObjective: r.descriptions?.investmentObjective ?? null,
      strategy: r.descriptions?.strategyDescription ?? null,
      // 이번 세션 소스(wisereport)의 원문 분류 텍스트 — 자유서술 설명이 없을 때 최선의 텍스트 신호.
      rawTypeText: r.classificationFacts?.rawTypeText ?? null,
    },
    facts: {
      assetClass: r.classificationFacts?.assetClass ?? null,
      regions: r.classificationFacts?.regions ?? null,
      active: r.classificationFacts?.active ?? null,
      currencyHedged: r.classificationFacts?.currencyHedged ?? null,
      nameHints: r.classificationFacts?.nameHints ?? [],
    },
    holdings,
    distribution: {
      frequency: r.distribution?.frequency ?? null,
      scheduleText: r.distribution?.scheduleText ?? null,
      coveredCall: r.distribution?.coveredCall ?? false,
      trailing12MonthAmount: r.distribution?.trailing12MonthAmount ?? null,
    },
    coverage: {
      score: usedIndexFallback && coverageScore !== null ? Math.min(1, Number((coverageScore + 0.15).toFixed(2))) : coverageScore,
      missingFields,
    },
  };
  return compact;
}

function main() {
  if (!cacheExists(METADATA_FILE)) throw new Error('먼저 npm run metadata:normalize 를 실행하세요.');
  const args = parseArgs(process.argv.slice(2));
  const metadata = readJsonCache(METADATA_FILE);
  const indexNames = cacheExists(INDEX_NAMES_FILE) ? readJsonCache(INDEX_NAMES_FILE) : { items: [] };
  const indexNameByCode = new Map((indexNames.items || []).filter((item) => item.indexName).map((item) => [item.etfCode, item.indexName]));

  let records = metadata.records;
  if (args.etf) {
    const wanted = new Set(args.etf);
    records = records.filter((r) => wanted.has(r.etfCode));
  }
  if (args.limit) records = records.slice(0, args.limit);

  const lines = [];
  const perRecordStats = [];
  for (const r of records) {
    const compact = buildCompactRecord(r, indexNameByCode);
    const line = JSON.stringify(compact);
    lines.push(line);
    perRecordStats.push({ etfCode: r.etfCode, charCount: line.length, estimatedTokens: estimateTokens(line.length) });
  }

  writeCache(OUT_JSONL, lines.join('\n') + (lines.length ? '\n' : ''));

  const totalChars = perRecordStats.reduce((s, x) => s + x.charCount, 0);
  const totalTokens = perRecordStats.reduce((s, x) => s + x.estimatedTokens, 0);
  const stats = {
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    totalCharCount: totalChars,
    totalEstimatedTokens: totalTokens,
    avgCharCountPerEtf: records.length ? Math.round(totalChars / records.length) : 0,
    avgEstimatedTokensPerEtf: records.length ? Math.round(totalTokens / records.length) : 0,
    maxHoldingsPerEtf: MAX_HOLDINGS,
    benchmarkFallbackCount: records.filter((record) => !record.benchmark?.name && indexNameByCode.has(record.etfCode)).length,
    perRecord: perRecordStats,
  };
  writeJsonCache(OUT_STATS, stats);

  console.log(
    `[tagging:prepare] ${records.length}종 → ${OUT_JSONL} (평균 ${stats.avgCharCountPerEtf}자/약 ${stats.avgEstimatedTokensPerEtf}토큰, 총 약 ${totalTokens}토큰)`
  );
}

main();
