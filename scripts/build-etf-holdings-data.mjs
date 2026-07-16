// ETF 구성종목 CSV → 화면용 JSON 정규화 빌드.
//   입력: spikes/krx-direct/reports/naver_top10_holdings_full.csv
//   출력: public/data/etf-holdings.json
// 실행: npm run build:data  (또는 node scripts/build-etf-holdings-data.mjs)
//
// CSV 실제 컬럼(확인함): etfCode, etfName, rank, holdingCode, holdingName, quantity, weightPct, status
//   - primary key = etfCode(6자리). status='OK' 행만 채택(EMPTY_NO_TABLE 등은 제외).
//   - weightPct 는 0~100 스케일(%). 기준일 컬럼은 CSV 에 없음 → asOfDate=null, 수집시각은 generatedAt.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'spikes/krx-direct/reports/naver_top10_holdings_full.csv');
const OUT = resolve(ROOT, 'public/data/etf-holdings.json');
const MAX_HOLDINGS = 10;

// 한 줄 CSV 파싱(따옴표 안 콤마 처리).
function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// 숫자 문자열 → number|null (%, 콤마, 공백 제거).
function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s%]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normCode(v) {
  const s = String(v == null ? '' : v).trim();
  const d = s.replace(/\D/g, '');
  return d.length ? d.padStart(6, '0') : s;
}

function main() {
  const raw = readFileSync(SRC, 'utf8').replace(/^﻿/, ''); // BOM 제거
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iEtfCode = idx('etfCode');
  const iEtfName = idx('etfName');
  const iRank = idx('rank');
  const iHCode = idx('holdingCode');
  const iHName = idx('holdingName');
  const iQty = idx('quantity');
  const iWeight = idx('weightPct');
  const iStatus = idx('status');
  if (iEtfCode < 0 || iHName < 0 || iWeight < 0) {
    throw new Error('필수 컬럼(etfCode/holdingName/weightPct)을 찾지 못했습니다. header=' + header.join(','));
  }

  const etfs = {};
  let kept = 0;
  let skipped = 0;
  for (let li = 1; li < lines.length; li++) {
    const c = parseLine(lines[li]);
    const status = (c[iStatus] || '').trim();
    const etfCode = normCode(c[iEtfCode]);
    const hName = (c[iHName] || '').trim();
    const weight = num(c[iWeight]);
    // OK 행 + ETF코드/종목명/정상 비중이 있는 행만 채택.
    if (status !== 'OK' || !etfCode || !hName || weight == null) { skipped++; continue; }
    kept++;
    if (!etfs[etfCode]) {
      etfs[etfCode] = { ticker: etfCode, name: (c[iEtfName] || '').trim(), asOfDate: null, holdings: [] };
    }
    etfs[etfCode].holdings.push({
      rank: iRank >= 0 ? (num(c[iRank]) ?? etfs[etfCode].holdings.length + 1) : etfs[etfCode].holdings.length + 1,
      ticker: iHCode >= 0 ? normCode(c[iHCode]) || null : null,
      name: hName,
      weight: Math.round(weight * 100) / 100,
      quantity: iQty >= 0 ? num(c[iQty]) : null,
    });
  }

  // ETF별 비중 내림차순 정렬 + 상위 10개만.
  let etfCount = 0;
  let holdingCount = 0;
  for (const code of Object.keys(etfs)) {
    const list = etfs[code].holdings.sort((a, b) => b.weight - a.weight).slice(0, MAX_HOLDINGS);
    // 표시 순위 재부여(1..N, 비중 내림차순).
    list.forEach((h, i) => { h.rank = i + 1; });
    etfs[code].holdings = list;
    etfCount++;
    holdingCount += list.length;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'naver_top10_holdings_full.csv',
    etfCount,
    etfs,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log(`[build:data] rows kept=${kept} skipped=${skipped} | ETFs=${etfCount} | holdings=${holdingCount}`);
  console.log(`[build:data] wrote ${OUT}`);
}

main();
