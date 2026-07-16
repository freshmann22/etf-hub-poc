// 전체 실행 전 예상 작업량 출력(§13). 서브에이전트 호출 없음(순수 집계).
//   실행: npm run tagging:inspect
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { readJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const METADATA_FILE = resolve(ROOT, 'data/normalized/etf-metadata.json');
const RULE_SCORES_FILE = resolve(ROOT, 'data/tagging/etf-rule-scores.json');
const CACHE_FILE = resolve(ROOT, 'data/tagging/etf-scoring-cache.json');
const BATCH_SIZE_DEFAULT = 15;

function main() {
  if (!cacheExists(METADATA_FILE)) {
    console.log('ETF 통합 메타데이터가 없습니다. 먼저 npm run metadata:normalize 를 실행하세요.');
    return;
  }
  const metadata = readJsonCache(METADATA_FILE);
  const total = metadata.records.length;

  const covBuckets = { hi: 0, lo: 0, none: 0 };
  for (const r of metadata.records) {
    if (r.coverage?.score >= 0.75) covBuckets.hi++;
    else if (r.coverage?.score >= 0.45) covBuckets.lo++;
    else covBuckets.none++;
  }

  const ruleScores = cacheExists(RULE_SCORES_FILE) ? readJsonCache(RULE_SCORES_FILE) : null;
  const ruleOnlyCount = ruleScores ? ruleScores.taggedByRuleCount : null;

  const cache = cacheExists(CACHE_FILE) ? readJsonCache(CACHE_FILE) : { entries: {} };
  const alreadyScored = Object.keys(cache.entries).length;
  const remaining = total - alreadyScored;
  const estBatches = Math.ceil(remaining / BATCH_SIZE_DEFAULT);

  console.log('=== ETF 태깅 전체 실행 사전 점검 ===');
  console.log(`전체 통합 레코드: ${total}종`);
  console.log(`coverage 구간: >=0.75: ${covBuckets.hi} | 0.45~0.75: ${covBuckets.lo} | <0.45: ${covBuckets.none}`);
  console.log(`규칙만으로 태그 확보된 ETF: ${ruleOnlyCount ?? '(npm run tagging:rules 먼저 실행)'}`);
  console.log(`이미 Claude 서브에이전트로 스코어링됨(캐시): ${alreadyScored}종`);
  console.log(`Claude 서브에이전트 처리 필요(예상): ${remaining}종`);
  console.log(`배치 크기 ${BATCH_SIZE_DEFAULT}종 기준 예상 배치 수: ${estBatches}개 (= 예상 서브에이전트 호출 수)`);
  console.log('');
  console.log('주요 리스크:');
  console.log(`  - coverage<0.45 인 ${covBuckets.none}종은 holdings/benchmark 등 근거 부족 → confidence 낮게 나올 가능성 높음(보류 검토 권장)`);
  console.log('  - 서브에이전트 호출 자체가 토큰/사용한도를 소비함 — 배치 크기와 동시성을 보수적으로 유지할 것');
  console.log('  - 신규 상장/미해소 naver 내부코드(codeType=naver_internal_unresolved) ETF는 타 시스템과 조인 시 별도 코드 해소 필요');
}

main();
