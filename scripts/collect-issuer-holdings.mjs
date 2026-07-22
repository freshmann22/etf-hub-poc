// 운용사 공식 구성종목 수집기 — KODEX(samsungfund) + TIGER(miraeasset).
// 사이트가 벌크 수집을 rate-limit 하므로 "사람이 하나씩 여는" 정도의 저속·순차로만 수집한다.
//   - 순차(동시성 1) + 호출 간 페이싱, rate-limit 시 긴 백오프.
//   - 재개 가능: 진행분을 data/reports/issuer-holdings-cache.json 에 계속 저장.
//   - 체크포인트마다 public/data/etf-holdings.json 을 "항상 유효한" 상태로 병합 기록(기존 네이버 보존).
//   - 시간 상한(--minutes) 도달하면 안전하게 멈추고 부분분을 남긴다.
// 사용: node scripts/collect-issuer-holdings.mjs [--minutes 90] [--pace 3500] [--merge-only]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { IssuerProvider } from '../server/providers/issuer/index.js';

const argv = process.argv.slice(2);
const flag = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MINUTES = parseInt(flag('--minutes', '90'), 10);
const PACE_MS = parseInt(flag('--pace', '3500'), 10);
const MERGE_ONLY = argv.includes('--merge-only');

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const CACHE_PATH = 'data/reports/issuer-holdings-cache.json';
const OUT_PATH = 'public/data/etf-holdings.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const idxNames = rd('data/tagging/etf-universe-index-names.json');
const existing = rd(OUT_PATH);
const existingEtfs = existing.etfs || {};
const nameByCode = new Map((idxNames.items || []).map((it) => [it.etfCode, it.name]));

let cache = existsSync(ROOT + CACHE_PATH) ? rd(CACHE_PATH) : { entries: {}, failed: [] };
cache.entries = cache.entries || {};

function normalizeRows(rows) {
  return (rows || []).filter((r) => r && r.rank != null)
    .sort((a, b) => (a.rank || 999) - (b.rank || 999)).slice(0, 10)
    .map((r) => ({
      rank: r.rank,
      ticker: typeof r.stockCode === 'string' ? r.stockCode : null,
      name: r.stockName || null,
      weight: typeof r.weight === 'number' ? r.weight : null,
      quantity: typeof r.shares === 'number' ? r.shares : null,
    }));
}

function mergeAndWrite() {
  const merged = { ...existingEtfs };
  for (const code of Object.keys(cache.entries)) merged[code] = cache.entries[code];
  const sorted = {};
  for (const code of Object.keys(merged).sort()) sorted[code] = merged[code];
  const out = {
    generatedAt: existing.generatedAt,
    source: 'naver_top10_holdings_full.csv + issuer(kodex/tiger)',
    issuerCollectedCount: Object.keys(cache.entries).length,
    etfCount: Object.keys(sorted).length,
    etfs: sorted,
  };
  writeFileSync(ROOT + OUT_PATH, JSON.stringify(out) + '\n');
  return out.etfCount;
}
const saveCache = () => writeFileSync(ROOT + CACHE_PATH, JSON.stringify(cache) + '\n');

if (MERGE_ONLY) {
  const n = mergeAndWrite();
  console.log(`merge-only: 커버리지 ${n}종 (issuer 수집 ${Object.keys(cache.entries).length}종). 저장 완료.`);
  process.exit(0);
}

const isKT = (name) => /^(KODEX|TIGER)\b/i.test(String(name || '').trim());
const targets = (idxNames.items || [])
  .filter((it) => it.etfCode && isKT(it.name) && !cache.entries[it.etfCode]); // 재개: 이미 받은 건 스킵
console.log(`수집 대상(미수집 KODEX/TIGER): ${targets.length}종 | 페이스 ${PACE_MS}ms | 상한 ${MINUTES}분`);

const provider = new IssuerProvider({ enabled: true, timeoutMs: 15000, retries: 0 });
const isRate = (m) => /rate|limit|too many|429/i.test(String(m || ''));
const isNet = (m) => /timeout|ETIMEDOUT|ECONN|socket|network|fetch failed/i.test(String(m || ''));

const deadline = performance.now() + MINUTES * 60 * 1000;
const stats = { ok: 0, empty: 0, fail: 0, backoffs: 0, breakers: 0, byIssuer: {} };
let sinceSave = 0;
let consecutiveRate = 0; // 연속 rate-limit → 사이트가 우리를 막고 있음 → 크게 쉰다.

for (const item of targets) {
  if (performance.now() > deadline) { console.log('시간 상한 도달 — 중단'); break; }
  const code = item.etfCode;
  let got = false; let hitRate = false;
  for (let attempt = 0; attempt < 3 && !got; attempt++) {
    try {
      const env = await provider.getEtfHoldings(code);
      const rows = env?.data || [];
      if (!rows.length) { stats.empty += 1; got = true; break; } // 합성 등 정직한 빈결과
      const holdings = normalizeRows(rows);
      if (!holdings.length) { stats.empty += 1; got = true; break; }
      const src = env?.meta?.source || 'issuer';
      cache.entries[code] = { ticker: code, name: item.name, asOfDate: env?.meta?.asOfDate || (rows[0] && rows[0].asOfDate) || null, source: src, holdings };
      stats.ok += 1; stats.byIssuer[src] = (stats.byIssuer[src] || 0) + 1; got = true; sinceSave += 1;
    } catch (e) {
      const m = e && e.message;
      if (isRate(m) || isNet(m)) {
        stats.backoffs += 1; if (isRate(m)) hitRate = true;
        const wait = isRate(m) ? [20000, 45000, 90000][attempt] : 5000 * (attempt + 1);
        await sleep(wait);
        continue;
      }
      stats.fail += 1; break; // 그 외 오류는 스킵
    }
  }
  // 회로 차단기: 연속으로 rate-limit(성공 0) 이면 사이트 차단 상태 → 5분 쉬고 리셋.
  if (got && !hitRate) consecutiveRate = 0;
  else if (hitRate && !got) {
    consecutiveRate += 1;
    // 밴은 보통 "무요청 정지 기간" 후 풀린다 → 연속 차단이면 그 호스트를 오래 쉬게 한다.
    if (consecutiveRate >= 2) { stats.breakers += 1; console.log(`  [회로차단] 연속 차단 — 20분 침묵 후 재개 (경과 ${Math.round((performance.now()-(deadline-MINUTES*60000))/60000)}분)`); await sleep(1200000); consecutiveRate = 0; }
  }
  // 체크포인트: 15건마다 캐시+병합 기록(항상 유효 상태 유지)
  if (sinceSave >= 15) { saveCache(); const n = mergeAndWrite(); sinceSave = 0; console.log(`  체크포인트: ok ${stats.ok} | 커버리지 ${n} | 백오프 ${stats.backoffs}`); }
  await sleep(PACE_MS);
}

saveCache();
const finalCov = mergeAndWrite();
console.log(`\n완료/중단: 신규 ok ${stats.ok}, 빈결과 ${stats.empty}, 실패 ${stats.fail}, 백오프 ${stats.backoffs}`);
console.log(`소스별: ${JSON.stringify(stats.byIssuer)}`);
console.log(`issuer 누적 수집: ${Object.keys(cache.entries).length}종 | 최종 커버리지: ${finalCov}종 (기존 ${Object.keys(existingEtfs).length})`);
console.log(`저장: ${OUT_PATH} (+ 캐시 ${CACHE_PATH})`);
