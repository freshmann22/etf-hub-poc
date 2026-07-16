// 전체 실행 전 예상 요청 수를 출력한다(§15 요구사항). 네트워크 호출 없음(순수 조회/집계).
//   실행: npm run metadata:inspect
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { readJsonCache, cacheExists } from './metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_FILE = resolve(ROOT, 'data/normalized/etf-master.json');
const WISEREPORT_DIR = resolve(ROOT, 'data/raw/wisereport');
const SOURCES_FILE = resolve(ROOT, 'config/etf-data-sources.json');

function main() {
  const sources = readJsonCache(SOURCES_FILE);
  console.log('=== 등록된 소스 ===');
  for (const s of sources.sources) {
    console.log(`  ${s.sourceId} (${s.sourceType}, login=${s.requiresLogin}) — ${s.notes.slice(0, 60)}...`);
  }

  console.log('\n=== ETF 마스터 ===');
  if (!cacheExists(MASTER_FILE)) {
    console.log('  없음 — npm run metadata:master 실행 필요. 예상 요청 수: 1건(전종목 일괄).');
    return;
  }
  const master = readJsonCache(MASTER_FILE);
  console.log(`  전체 ${master.etfCount}종 (KRX 표준코드 ${master.krxNumericCount}, naver 내부코드 미해소 ${master.naverInternalUnresolvedCount})`);

  const cachedCodes = new Set(
    cacheExists(WISEREPORT_DIR) ? readdirSync(WISEREPORT_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.replace('.json', '')) : []
  );
  const remaining = master.etfCount - cachedCodes.size;

  console.log('\n=== wisereport 수집 전망 ===');
  console.log(`  이미 캐시됨: ${cachedCodes.size}종`);
  console.log(`  --force 없이 전체 실행 시 신규 요청 예정: ${remaining}건 (간격 500ms → 약 ${Math.round((remaining * 0.5) / 60)}분 소요 예상)`);
  console.log(`  --force 로 전체 재수집 시: ${master.etfCount}건 (약 ${Math.round((master.etfCount * 0.5) / 60)}분)`);
  console.log('  npm run metadata:sample -- --limit=N 으로 표본만 우선 확인 권장.');
}

main();
