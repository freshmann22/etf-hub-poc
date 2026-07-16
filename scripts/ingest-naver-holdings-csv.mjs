// 기존 spikes/krx-direct/reports/naver_top10_holdings_full.csv 를
// 이 메타데이터 파이프라인의 raw 소스 포맷(data/raw/naver-csv/holdings.json)으로 편입한다.
// 새로 스크래핑하지 않는다 — 이미 수집된 결과를 재사용(중복 구현 금지, CLAUDE.md 원칙).
// 실제 컬럼(확인됨, scripts/build-etf-holdings-data.mjs 와 동일): etfCode,etfName,rank,holdingCode,holdingName,quantity,weightPct,status
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonCache } from './metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'spikes/krx-direct/reports/naver_top10_holdings_full.csv');
const OUT = resolve(ROOT, 'data/raw/naver-csv/holdings.json');

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

function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s%]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// 주의: etfCode(및 holdingCode) 를 숫자만 남겨 0-패딩하면 naver 내부 영문코드(예: "0167A0")를 쓰는
// 종목이 서로 다른 ETF끼리 충돌한다(scripts/collect-etf-master.mjs 참조, 실측 확인됨). 코드를
// 가공하지 않고 원문 그대로 보존한다(단, 공백 제거 및 대문자화만).
function normCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s.length ? s : null;
}

function main() {
  if (!existsSync(SRC)) {
    throw new Error(`원본 CSV를 찾을 수 없습니다: ${SRC}`);
  }
  const raw = readFileSync(SRC, 'utf8').replace(/^﻿/, '');
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
  if (iEtfCode < 0 || iHName < 0 || iWeight < 0 || iStatus < 0) {
    throw new Error('필수 컬럼(etfCode/holdingName/weightPct/status)을 찾지 못했습니다. header=' + header.join(','));
  }

  const byEtf = new Map();
  let okRows = 0;
  let emptyRows = 0;
  let failedRows = 0;

  for (let li = 1; li < lines.length; li++) {
    const c = parseLine(lines[li]);
    const status = (c[iStatus] || '').trim();
    const etfCode = normCode(c[iEtfCode]);
    if (!etfCode) continue;

    if (!byEtf.has(etfCode)) {
      byEtf.set(etfCode, { etfCode, etfName: (c[iEtfName] || '').trim(), status, holdings: [] });
    }
    if (status === 'OK') {
      okRows++;
      const weight = num(c[iWeight]);
      const hName = (c[iHName] || '').trim();
      if (!hName || weight == null) continue;
      byEtf.get(etfCode).holdings.push({
        rank: iRank >= 0 ? num(c[iRank]) : null,
        code: iHCode >= 0 ? normCode(c[iHCode]) : null,
        name: hName,
        weight,
        quantity: iQty >= 0 ? num(c[iQty]) : null,
      });
    } else if (status === 'EMPTY_NO_TABLE') {
      emptyRows++;
    } else {
      failedRows++;
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'naver_csv',
    sourceFile: 'spikes/krx-direct/reports/naver_top10_holdings_full.csv',
    ingestedFrom: 'existing collection (naver_top10_crawler.py, 재수집하지 않음)',
    etfCount: byEtf.size,
    stats: { okRows, emptyRows, failedRows },
    etfs: Array.from(byEtf.values()),
  };

  writeJsonCache(OUT, out);
  console.log(`[ingest:naver-csv] ETF ${out.etfCount}종 (OK행 ${okRows}, EMPTY ${emptyRows}, FAILED ${failedRows}) → ${OUT}`);
}

main();
