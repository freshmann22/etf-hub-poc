// §12 대표 ETF 샘플(20~30종) 자동 선정. 실제 통합 레코드 기준, 코드 하드코딩 금지.
//   실행: node scripts/tagging/select-sample.mjs
//   출력: data/tagging/sample-selection.json (선정 코드+사유)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonCache, writeJsonCache, cacheExists } from '../metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const METADATA_FILE = resolve(ROOT, 'data/normalized/etf-metadata.json');
const OUT_FILE = resolve(ROOT, 'data/tagging/sample-selection.json');

const NOISE = /커버드콜|레버리지|인버스|합성|타겟|액티브/;
const CATEGORIES = [
  { key: '국내 대표지수', pattern: /^(KODEX|TIGER)\s*200$/i },
  { key: '미국 대표지수', pattern: /S&P\s*500/i, exclude: NOISE },
  { key: '반도체', pattern: /반도체/, exclude: NOISE },
  { key: 'AI', pattern: /\bAI\b/, exclude: /반도체/ },
  { key: '바이오', pattern: /바이오/, exclude: NOISE },
  { key: '게임·엔터·미디어', pattern: /게임|엔터|미디어|콘텐츠/ },
  { key: '전기차·2차전지', pattern: /2차전지|전기차|배터리/ },
  { key: '클린에너지', pattern: /클린에너지|태양광|풍력|수소/ },
  { key: '원자재', pattern: /골드|금현물|은현물|원유|구리|원자재/ },
  { key: '금융', pattern: /금융|증권|은행/, exclude: /배당/ },
  { key: '방산·우주항공', pattern: /방산|우주/ },
  { key: 'AI 전력·인프라', pattern: /전력.*AI|AI.*전력|데이터센터/ },
  { key: '레버리지', pattern: /레버리지/ },
  { key: '인버스', pattern: /인버스/ },
  { key: '성장', pattern: /성장/, exclude: /배당/ },
  { key: '가치', pattern: /가치/ },
  { key: '리츠', pattern: /리츠|REIT/i },
  { key: '밸류업', pattern: /밸류업/ },
  { key: '고배당', pattern: /고배당/, exclude: /커버드콜|미국/ },
  { key: '배당성장', pattern: /배당성장|배당다우존스/ },
  { key: '월배당', pattern: /월배당|먼슬리/i },
  { key: '커버드콜', pattern: /커버드콜/ },
  { key: '채권', pattern: /채권/, exclude: /액티브|커버드콜/ },
  { key: '만기매칭 채권', pattern: /만기매칭|목표전환/ },
  { key: '액티브', pattern: /액티브/ },
];

function main() {
  if (!cacheExists(METADATA_FILE)) throw new Error('먼저 npm run metadata:normalize 를 실행하세요.');
  const metadata = readJsonCache(METADATA_FILE);
  // holdings 가 없어도 benchmark/etfTypeText 등 다른 실데이터가 있으면 샘플 후보로 인정한다
  // (해외 지수 ETF는 WiseReport CU_data 자체가 비어있는 경우가 많음 — §17 검증에 필요).
  const withHoldings = metadata.records.filter((r) => r.holdings?.length || r.benchmark?.name || r.classificationFacts?.rawTypeText);

  const picked = [];
  const used = new Set();
  for (const cat of CATEGORIES) {
    const hit = withHoldings.find(
      (r) => cat.pattern.test(r.name) && !used.has(r.etfCode) && !(cat.exclude && cat.exclude.test(r.name))
    );
    if (hit) {
      used.add(hit.etfCode);
      picked.push({ category: cat.key, etfCode: hit.etfCode, name: hit.name, reason: `명칭 패턴 매칭(${cat.pattern})` });
    } else {
      picked.push({ category: cat.key, etfCode: null, name: null, reason: '현재 수집된 469종 내 매칭 종목 없음' });
    }
  }

  // 마지막 카테고리: "이름만으로 분류하기 어려운 복합 ETF" — 여러 nameHints 가 동시에 있거나
  // rawTypeText 는 있는데 단순 키워드로 안 잡히는 종목을 하나 고른다(실데이터 기준, 추정 아님).
  const complex = withHoldings.find(
    (r) => !used.has(r.etfCode) && (r.classificationFacts?.nameHints?.length >= 2)
  );
  if (complex) {
    used.add(complex.etfCode);
    picked.push({ category: '복합(이름만으로 분류 어려움)', etfCode: complex.etfCode, name: complex.name, reason: `nameHints 2개 이상 동시 존재: ${JSON.stringify(complex.classificationFacts.nameHints)}` });
  } else {
    picked.push({ category: '복합(이름만으로 분류 어려움)', etfCode: null, name: null, reason: '조건에 맞는 종목 없음' });
  }

  const found = picked.filter((p) => p.etfCode);
  const notFound = picked.filter((p) => !p.etfCode);

  const out = {
    generatedAt: new Date().toISOString(),
    requestedCategories: CATEGORIES.length + 1,
    foundCount: found.length,
    notFoundCount: notFound.length,
    picks: picked,
  };
  writeJsonCache(OUT_FILE, out);
  console.log(`[tagging:select-sample] ${found.length}/${picked.length} 카테고리 매칭 → ${OUT_FILE}`);
  for (const p of picked) console.log(`  ${p.category}: ${p.etfCode ?? '(미매칭)'} ${p.name ?? ''}`);
}

main();
