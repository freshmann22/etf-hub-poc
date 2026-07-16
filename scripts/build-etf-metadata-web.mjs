// 정규화 메타데이터(data/normalized/etf-metadata.json) → 화면용 compact JSON.
//   출력: public/data/etf-metadata.json  (etf-explore 상세 요약/배당 탭 더미 대체용)
// 실행: npm run metadata:web  (또는 node scripts/build-etf-metadata-web.mjs)
//
// 실측이 있는 필드만 담는다. 커버리지가 낮으므로(WiseReport 상세 스크랩 종목 위주),
// 없는 ETF/필드는 화면에서 기존 샘플로 폴백한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'data/normalized/etf-metadata.json');
const OUT = resolve(ROOT, 'public/data/etf-metadata.json');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function main() {
  const j = JSON.parse(readFileSync(SRC, 'utf8'));
  const records = Array.isArray(j.records) ? j.records : [];
  const etfs = {};
  let count = 0;
  const fieldCounts = { issuer: 0, listingDate: 0, totalFeePct: 0, beta: 0, distribution: 0, return12m: 0 };

  for (const r of records) {
    const code = str(r.etfCode) || str(r.code);
    if (!code) continue;
    const fees = r.fees || {};
    const perf = r.performance || {};
    const bench = r.benchmark || {};
    const cls = r.classificationFacts || {};
    const dist = r.distribution || {};

    const m = {
      issuer: str(r.issuer),
      listingDate: str(r.listingDate), // YYYY-MM-DD
      totalFeePct: num(fees.totalFeePct),
      netAssetsEok: num(fees.netAssetsMillionKrw), // WiseReport 값은 억원 스케일(공공데이터와 일치)
      benchmarkName: str(bench.name),
      typeText: str(cls.rawTypeText),
      beta: num(perf.beta),
      return1m: num(perf.return1m),
      return3m: num(perf.return3m),
      return6m: num(perf.return6m),
      return12m: num(perf.return12m),
      distributionSchedule: str(dist.scheduleText) || str(r.distributionScheduleText),
    };
    // 유용한 실측이 하나도 없으면 제외(코드/이름만 있는 레코드는 스킵).
    const hasReal = m.issuer || m.listingDate || m.totalFeePct != null || m.beta != null || m.distributionSchedule || m.return12m != null;
    if (!hasReal) continue;

    // null 필드는 제거해 파일을 가볍게.
    const clean = {};
    for (const [k, v] of Object.entries(m)) if (v !== null && v !== undefined) clean[k] = v;
    etfs[code] = clean;
    count += 1;
    if (m.issuer) fieldCounts.issuer += 1;
    if (m.listingDate) fieldCounts.listingDate += 1;
    if (m.totalFeePct != null) fieldCounts.totalFeePct += 1;
    if (m.beta != null) fieldCounts.beta += 1;
    if (m.distributionSchedule) fieldCounts.distribution += 1;
    if (m.return12m != null) fieldCounts.return12m += 1;
  }

  const out = { generatedAt: j.generatedAt || null, source: 'data/normalized/etf-metadata.json', etfCount: count, etfs };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log('[metadata:web] etfs with real fields:', count);
  console.log('[metadata:web] field counts:', JSON.stringify(fieldCounts));
  console.log('[metadata:web] wrote', OUT);
}

main();
