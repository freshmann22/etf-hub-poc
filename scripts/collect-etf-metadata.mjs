// ETF 메타데이터 수집기(WiseReport 소스).
//   실행:
//     npm run metadata:sample -- --limit=10
//     npm run metadata:collect                 (마스터 전체, 이미 캐시된 종목은 건너뜀)
//     npm run metadata:collect -- --source=wisereport --etf=069500,102110
//     node scripts/collect-etf-metadata.mjs --force
//
// 소스: navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd={code}
//   근거: spikes/krx-direct/DETAIL_SCREEN_SOURCES.md — 서버 렌더링 HTML 안에 인라인 JS 객체로
//   summary_data / status_data / product_summary_data / CU_data 가 그대로 박혀 있음. 로그인 불필요.
//
// 요구사항 반영: 실패해도 전체 중단 안 함(ETF별 catch), 재시도/backoff 는 lib/http.js,
// 요청 간격은 아래 REQUEST_INTERVAL_MS, 캐시는 --force 없으면 재요청 안 함(증분), 표본/소스/ETF별 실행 지원.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetchText, sleep } from './metadata/lib/http.js';
import { cacheExists, writeCache, readCache, writeJsonCache, readJsonCache } from './metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_FILE = resolve(ROOT, 'data/normalized/etf-master.json');
const RAW_DIR = resolve(ROOT, 'data/raw/wisereport');
const RESULTS_FILE = resolve(ROOT, 'data/raw/wisereport/_collection-results.json');

const REQUEST_INTERVAL_MS = 500; // 요청 간격(초당 최대 2건, 사이트 부하 최소화)

// 검증용 표본(§17): ETF명 키워드로 마스터에서 대표 1종씩 선정. 코드 하드코딩 금지(마스터 실데이터 기준).
const NOISE = /커버드콜|레버리지|인버스|합성|타겟|액티브/;
const SAMPLE_CATEGORIES = [
  { key: '국내 대표지수', pattern: /^(KODEX|TIGER)\s*200$/i },
  { key: '미국 대표지수', pattern: /S&P\s*500/i, exclude: NOISE },
  { key: '반도체', pattern: /반도체/, exclude: NOISE },
  { key: '바이오', pattern: /바이오/, exclude: NOISE },
  { key: '방산', pattern: /방산/, exclude: NOISE },
  { key: '레버리지', pattern: /레버리지/ },
  { key: '인버스', pattern: /인버스/ },
  { key: '월배당', pattern: /월배당|먼슬리|monthly/i },
  { key: '커버드콜', pattern: /커버드콜|covered\s*call/i },
  { key: '채권', pattern: /채권/, exclude: /액티브|커버드콜/ },
  { key: '만기매칭 채권', pattern: /만기매칭|목표전환/ },
  { key: '액티브', pattern: /액티브/ },
];

function parseArgs(argv) {
  const args = { source: 'wisereport', etf: null, limit: null, sample: false, force: false };
  for (const raw of argv) {
    if (raw === '--force') args.force = true;
    else if (raw === '--sample') args.sample = true;
    else if (raw.startsWith('--source=')) args.source = raw.slice('--source='.length);
    else if (raw.startsWith('--etf=')) args.etf = raw.slice('--etf='.length).split(',').map((s) => s.trim());
    else if (raw.startsWith('--limit=')) args.limit = Number(raw.slice('--limit='.length));
  }
  return args;
}

function extractBlock(html, varName) {
  const re = new RegExp(varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(\\{.*?\\});', 's');
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s%]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseWiseReportHtml(html, etfCode) {
  const summary = extractBlock(html, 'summary_data');
  const status = extractBlock(html, 'status_data');
  const product = extractBlock(html, 'product_summary_data');
  const cu = extractBlock(html, 'CU_data');

  const holdings = Array.isArray(cu?.grid_data)
    ? cu.grid_data
        .map((row, i) => ({
          rank: i + 1,
          code: null, // WiseReport CU_data 는 종목코드를 주지 않음(종목명만) — naver_csv 와 교차조인 필요
          name: row.STK_NM_KOR ?? null,
          weight: toNum(row.ETF_WEIGHT),
          quantity: toNum(row.AGMT_STK_CNT),
          asOfDate: row.TRD_DT ?? null,
        }))
        .filter((h) => h.name && h.weight != null)
    : [];

  return {
    etfCode,
    name: summary?.CMP_KOR ?? null,
    issuer: product?.ISSUE_NM_KOR ?? summary?.ISSUE_NM_KOR ?? null,
    issuerUrl: product?.URL ?? summary?.URL ?? null,
    benchmarkName: product?.BASE_IDX_NM_KOR ?? summary?.BASE_IDX_NM_KOR ?? null,
    listingDate: product?.LIST_DT ?? null,
    firstSettleDate: product?.FIRST_SETTLE_DT ?? null,
    totalFeePct: toNum(product?.TOT_PAY ?? summary?.TOT_PAY),
    fiscalPeriodText: product?.FIN_PRD ?? null,
    distributionScheduleText: product?.DIV_BASE_DT ?? null,
    liquidityProviderText: product?.LP_NM_KOR ?? null,
    etfTypeText: summary?.ETF_TYP_SVC_NM ?? null,
    fundTypeText: product?.FUND_TYP ?? null,
    netAssetsMillionKrw: toNum(status?.MKT_VAL),
    beta: toNum(status?.YR_BETA),
    foreignOwnershipPct: toNum(status?.FRG_RT),
    return1m: toNum(status?.ERN1),
    return3m: toNum(status?.ERN3),
    return6m: toNum(status?.ERN6),
    return12m: toNum(status?.ERN12),
    holdings,
    asOfDate: holdings[0]?.asOfDate ?? null,
  };
}

async function collectOne(etfCode, force) {
  const htmlPath = resolve(RAW_DIR, `${etfCode}.html`);
  const jsonPath = resolve(RAW_DIR, `${etfCode}.json`);
  const url = `https://navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd=${etfCode}`;

  if (!force && cacheExists(jsonPath)) {
    return { ...readJsonCache(jsonPath), fromCache: true };
  }

  const retrievedAt = new Date().toISOString();
  try {
    const html = await safeFetchText(url, { encoding: 'utf-8' });
    writeCache(htmlPath, html);
    const data = parseWiseReportHtml(html, etfCode);
    const { etfCode: _omit, ...dataWithoutCode } = data;
    const hasAnyField = Object.values(dataWithoutCode).some(
      (v) => v != null && !(Array.isArray(v) && v.length === 0)
    );
    const result = {
      etfCode,
      sourceId: 'wisereport',
      sourceUrl: url,
      status: hasAnyField ? 'success' : 'empty',
      data,
      errors: [],
      retrievedAt,
    };
    writeJsonCache(jsonPath, result);
    return result;
  } catch (err) {
    const result = {
      etfCode,
      sourceId: 'wisereport',
      sourceUrl: url,
      status: 'failed',
      data: null,
      errors: [String(err.message || err)],
      retrievedAt,
    };
    writeJsonCache(jsonPath, result);
    return result;
  }
}

function selectSampleCodes(master) {
  const picked = [];
  const usedCodes = new Set();
  for (const cat of SAMPLE_CATEGORIES) {
    const hit = master.etfs.find(
      (e) => cat.pattern.test(e.name) && !usedCodes.has(e.etfCode) && !(cat.exclude && cat.exclude.test(e.name))
    );
    if (hit) {
      usedCodes.add(hit.etfCode);
      picked.push({ category: cat.key, etfCode: hit.etfCode, name: hit.name });
    } else {
      picked.push({ category: cat.key, etfCode: null, name: null, note: '마스터에서 매칭 종목 못 찾음' });
    }
  }
  // 최근 상장(heuristic): naver 목록에 상장일이 없어, 종목코드가 클수록 최근 발행 경향이 있다는 점만
  // 참고용으로 사용(추정 아님 — KRX 6자리 코드는 발행 순서와 대체로 상관되나 보증되진 않음, 리포트에 명시).
  const recentCandidate = [...master.etfs].sort((a, b) => Number(b.etfCode) - Number(a.etfCode))[0];
  if (recentCandidate && !usedCodes.has(recentCandidate.etfCode)) {
    picked.push({
      category: '최근 상장(휴리스틱: 코드값 최댓값)',
      etfCode: recentCandidate.etfCode,
      name: recentCandidate.name,
    });
  }
  return picked;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.source !== 'wisereport') {
    throw new Error(`미구현 소스: ${args.source} (현재 wisereport만 구현됨)`);
  }
  if (!cacheExists(MASTER_FILE)) {
    throw new Error('ETF 마스터가 없습니다. 먼저 `npm run metadata:master` 를 실행하세요.');
  }
  const master = readJsonCache(MASTER_FILE);

  let targets; // [{etfCode, name, category?}]
  if (args.sample) {
    const picks = selectSampleCodes(master).filter((p) => p.etfCode);
    targets = picks;
    console.log('[metadata:collect] 표본 선정 결과:');
    for (const p of picks) console.log(`  - ${p.category}: ${p.etfCode} ${p.name}`);
  } else if (args.etf) {
    targets = args.etf.map((code) => {
      const trimmed = code.trim().toUpperCase();
      return { etfCode: /^\d+$/.test(trimmed) ? trimmed.padStart(6, '0') : trimmed, name: null };
    });
  } else {
    targets = master.etfs.map((e) => ({ etfCode: e.etfCode, name: e.name }));
    if (args.limit) targets = targets.slice(0, args.limit);
  }

  const toFetch = args.force ? targets : targets.filter((t) => !cacheExists(resolve(RAW_DIR, `${t.etfCode}.json`)));
  console.log(
    `[metadata:collect] 대상 ${targets.length}종 | 캐시 재사용 ${targets.length - toFetch.length}종 | 실제 요청 예정 ${toFetch.length}건 (간격 ${REQUEST_INTERVAL_MS}ms)`
  );

  const results = [];
  let success = 0, empty = 0, failed = 0, fromCache = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const needsFetch = args.force || !cacheExists(resolve(RAW_DIR, `${t.etfCode}.json`));
    const r = await collectOne(t.etfCode, args.force);
    results.push(r);
    if (r.fromCache) fromCache++;
    else if (r.status === 'success') success++;
    else if (r.status === 'empty') empty++;
    else failed++;

    const tag = r.fromCache ? 'CACHE' : r.status.toUpperCase();
    console.log(`  [${i + 1}/${targets.length}] ${t.etfCode} ${t.name ?? ''} -> ${tag}`);
    if (needsFetch && i < targets.length - 1) await sleep(REQUEST_INTERVAL_MS);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    source: 'wisereport',
    requested: targets.length,
    fromCache,
    success,
    empty,
    failed,
    successRate: targets.length ? Math.round(((success + fromCache) / targets.length) * 1000) / 10 : null,
    failedCodes: results.filter((r) => r.status === 'failed').map((r) => r.etfCode),
  };
  const prior = readJsonCache(RESULTS_FILE) || { runs: [] };
  prior.runs = [...(prior.runs || []), summary];
  writeJsonCache(RESULTS_FILE, prior);

  console.log(
    `[metadata:collect] 완료 — 신규성공 ${success}, 캐시 ${fromCache}, 빈응답 ${empty}, 실패 ${failed} / 총 ${targets.length} (성공률 ${summary.successRate}%)`
  );
}

main().catch((err) => {
  console.error('[metadata:collect] 치명적 오류:', err.message);
  process.exit(1);
});
