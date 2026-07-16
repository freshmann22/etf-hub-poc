// 공공데이터포털(data.go.kr)에서 ETF 전종목의 기초지수명(indexName)을 확보해 파일로 저장한다.
// 서버의 PublicDataProvider(getEtfList)를 그대로 재사용 — 이 provider는 런타임 캐시만 유지하고
// 디스크에 저장하지 않아, 태깅 파이프라인(오프라인 배치)에서 쓰려면 별도로 스냅샷이 필요하다.
//   실행: node scripts/tagging/fetch-universe-index-names.mjs
//   출력: data/tagging/etf-universe-index-names.json ({etfCode,name,indexName}[], 1,141종)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonCache } from '../metadata/lib/cache.js';
import { config } from '../../server/config.js';
import { PublicDataProvider } from '../../server/providers/publicdata/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_FILE = resolve(ROOT, 'data/tagging/etf-universe-index-names.json');

async function main() {
  const provider = new PublicDataProvider(config.providers.publicdata);
  if (!provider.isAvailable()) {
    throw new Error('publicdata 미가용(.env PUBLICDATA_SERVICE_KEY/PUBLICDATA_ENABLED 확인)');
  }
  const { data, meta } = await provider.getEtfList();
  const items = data.map((r) => ({ etfCode: r.code, name: r.name, indexName: r.indexName || null }));
  const out = { generatedAt: new Date().toISOString(), basDt: meta.asOfDate, source: 'publicdata', count: items.length, items };
  writeJsonCache(OUT_FILE, out);
  const withIndex = items.filter((i) => i.indexName).length;
  console.log(`[universe-index] ${items.length}종 수집(기초지수명 있음 ${withIndex}종) → ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('[universe-index] 실패:', err.message);
  process.exit(1);
});
