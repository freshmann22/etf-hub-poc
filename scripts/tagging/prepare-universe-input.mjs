// 메타데이터 미커버(470종 밖) ETF 를 위한 "이름/기초지수명만" 규칙태깅 입력 생성.
// etf-scoring-worker(LLM) 대상은 아니고, run-rule-classifier.mjs 의 assetClass/region/전략(regex) 규칙만
// 적용하기 위한 최소 입력이다(구성종목·설명 없음 — 그런 축은 별도 스크래핑 없이는 불가능, RUN_LOG 참조).
//   입력: data/normalized/etf-master.json(1,141종 전체 이름), data/normalized/etf-metadata.json(기존 커버 470종),
//         data/tagging/etf-universe-index-names.json(공공데이터 기초지수명, fetch-universe-index-names.mjs 로 생성)
//   출력: data/tagging/etf-universe-rule-input.jsonl (메타데이터 커버 470종 제외한 나머지)
//   실행: node scripts/tagging/prepare-universe-input.mjs
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MASTER_FILE = resolve(ROOT, 'data/normalized/etf-master.json');
const METADATA_FILE = resolve(ROOT, 'data/normalized/etf-metadata.json');
const INDEX_NAMES_FILE = resolve(ROOT, 'data/tagging/etf-universe-index-names.json');
const OUT_JSONL = resolve(ROOT, 'data/tagging/etf-universe-rule-input.jsonl');

function main() {
  if (!cacheExists(INDEX_NAMES_FILE)) throw new Error('먼저 node scripts/tagging/fetch-universe-index-names.mjs 실행');
  const master = readJsonCache(MASTER_FILE);
  const metadata = readJsonCache(METADATA_FILE);
  const indexNames = readJsonCache(INDEX_NAMES_FILE);

  const alreadyCovered = new Set(metadata.records.map((r) => r.etfCode));
  const indexNameByCode = new Map(indexNames.items.map((i) => [i.etfCode, i.indexName]));

  const lines = [];
  for (const e of master.etfs) {
    if (alreadyCovered.has(e.etfCode)) continue;
    lines.push(
      JSON.stringify({
        etfCode: e.etfCode,
        name: e.name,
        benchmark: { name: indexNameByCode.get(e.etfCode) || null },
        distribution: { scheduleText: null },
        facts: {},
      }),
    );
  }
  writeCache(OUT_JSONL, lines.join('\n') + '\n');
  console.log(`[universe-input] 메타데이터 미커버 ${lines.length}종(전체 ${master.etfs.length} - 기존 커버 ${alreadyCovered.size}) → ${OUT_JSONL}`);
}

main();
