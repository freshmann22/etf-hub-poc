// ETF 유니버스(마스터 1,141종)를 ETF당 1행으로 커버리지 점검 CSV로 내보낸다.
//   실행: node scripts/build-universe-coverage-csv.mjs
//   출력: data/reports/etf-universe-coverage.csv
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const master = readJson('data/normalized/etf-master.json');
const meta = readJson('data/normalized/etf-metadata.json');
const scores = readJson('data/tagging/etf-tag-scores.json');

const metaByCode = new Map((meta.records || []).map((r) => [r.etfCode, r]));
const scoreByCode = scores.etfs || {};

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const header = [
  'etfCode', 'name', 'codeType', 'hasMetadata', 'coverageScore',
  'holdingsCount', 'hasIssuer', 'hasFee', 'hasDistribution',
  'taggedTagCount', 'tags',
];

const rows = [header.join(',')];
for (const etf of master.etfs) {
  const m = metaByCode.get(etf.etfCode);
  const sc = scoreByCode[etf.etfCode];
  const tags = (sc?.classifications || []).map((c) => c.tagId);
  rows.push([
    etf.etfCode,
    esc(etf.name),
    etf.codeType || '',
    m ? 'Y' : 'N',
    m?.coverage?.score ?? '',
    m?.holdings?.length ?? 0,
    m?.issuer ? 'Y' : 'N',
    m?.fees?.totalFeePct != null ? 'Y' : 'N',
    m?.distribution?.scheduleText ? 'Y' : 'N',
    tags.length,
    esc(tags.join('|')),
  ].join(','));
}

const OUT = 'data/reports/etf-universe-coverage.csv';
writeFileSync(resolve(ROOT, OUT), rows.join('\n') + '\n', 'utf8');

const withMeta = master.etfs.filter((e) => metaByCode.has(e.etfCode)).length;
const withTags = master.etfs.filter((e) => (scoreByCode[e.etfCode]?.classifications || []).length).length;
console.log(`[universe-csv] ${master.etfs.length}종 → ${OUT}`);
console.log(`  메타데이터 있음: ${withMeta} / 없음: ${master.etfs.length - withMeta}`);
console.log(`  태그 1개 이상: ${withTags}`);
