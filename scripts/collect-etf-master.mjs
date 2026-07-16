// ETF 마스터 수집기.
//   소스: finance.naver.com/api/sise/etfItemList.nhn (config/etf-data-sources.json 의 naver_master)
//   실행: npm run metadata:master [-- --force]
//   출력: data/raw/naver-master/etf-list.json (원본 그대로)
//         data/normalized/etf-master.json (etfCode primary key 마스터)
//
// 원칙(ETF_METADATA_PIPELINE_PROMPT.md §3): 종목코드 primary key, 앞자리 0 보존, 이름만으로 병합 금지.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetchText } from './metadata/lib/http.js';
import { cacheExists, writeCache, writeJsonCache, readJsonCache } from './metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = resolve(ROOT, 'data/raw/naver-master');
const RAW_FILE = resolve(RAW_DIR, 'etf-list.json');
const OUT_FILE = resolve(ROOT, 'data/normalized/etf-master.json');
const ENDPOINT = 'https://finance.naver.com/api/sise/etfItemList.nhn';

// 주의(실측, 2026-07-14): naver etfItemList의 itemcode 는 항상 KRX 6자리 숫자 코드가 아니다.
// 1141종 중 274종은 영문+숫자 내부코드(예: "0167A0")를 쓴다(최근 상장/특수구조 상품에서 관찰됨).
// 숫자만 남기고 0-패딩하면 서로 다른 ETF가 같은 코드로 충돌한다(실측: "0104N0"→"010400" 등).
// 원칙(ETF_METADATA_PIPELINE_PROMPT.md §3 "코드 없이 병합 금지")에 따라 코드를 임의 가공하지 않고
// 그대로 보존하며, 표준 KRX 6자리 숫자 코드인지 여부를 codeType 으로 명시한다.
function normCode(code) {
  return String(code).trim().toUpperCase();
}
function codeType(code) {
  return /^\d{6}$/.test(code) ? 'krx_numeric' : 'naver_internal_unresolved';
}

async function main() {
  const force = process.argv.includes('--force');

  let raw;
  if (!force && cacheExists(RAW_FILE)) {
    console.log(`[metadata:master] 캐시 재사용: ${RAW_FILE} (재요청하려면 --force)`);
    raw = readJsonCache(RAW_FILE);
  } else {
    console.log(`[metadata:master] 예상 요청 수: 1건 (전종목 일괄 엔드포인트) → ${ENDPOINT}`);
    const text = await safeFetchText(ENDPOINT, { encoding: 'euc-kr' });
    const parsed = JSON.parse(text);
    writeCache(RAW_FILE, JSON.stringify(parsed, null, 2));
    raw = parsed;
  }

  const items = raw?.result?.etfItemList;
  if (!Array.isArray(items)) {
    throw new Error('naver etfItemList 응답 구조가 예상과 다릅니다 (result.etfItemList 없음)');
  }

  const seen = new Map();
  let duplicates = 0;
  for (const item of items) {
    const etfCode = normCode(item.itemcode);
    if (seen.has(etfCode)) {
      duplicates++;
      continue;
    }
    seen.set(etfCode, {
      etfCode,
      codeType: codeType(etfCode),
      name: item.itemname,
      shortName: null,
      issuer: null,
      listingDate: null,
      market: 'KRX',
      status: 'listed',
      // 참고용(마스터 조인 근거 아님) — 실 순자산/시세는 wisereport/publicdata 를 신뢰.
      referenceNetAssetsMillionKrw: typeof item.marketSum === 'number' ? item.marketSum : null,
      referenceNav: typeof item.nav === 'number' ? item.nav : null,
    });
  }

  const etfs = Array.from(seen.values()).sort((a, b) => a.etfCode.localeCompare(b.etfCode));
  const unresolvedCount = etfs.filter((e) => e.codeType !== 'krx_numeric').length;

  const master = {
    generatedAt: new Date().toISOString(),
    source: 'naver_master',
    sourceUrl: ENDPOINT,
    etfCount: etfs.length,
    krxNumericCount: etfs.length - unresolvedCount,
    naverInternalUnresolvedCount: unresolvedCount,
    duplicatesDropped: duplicates,
    etfs,
  };

  writeJsonCache(OUT_FILE, master);
  console.log(
    `[metadata:master] ETF ${master.etfCount}종 확보 (KRX 표준코드 ${master.krxNumericCount}종, naver 내부코드 미해소 ${master.naverInternalUnresolvedCount}종, 중복 ${duplicates}건 제외) → ${OUT_FILE}`
  );
}

main().catch((err) => {
  console.error('[metadata:master] 실패:', err.message);
  process.exit(1);
});
