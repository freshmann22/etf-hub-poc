// ETF 마스터 + 소스별 raw 수집 결과를 etfCode 기준으로 조인해 통합 레코드를 생성한다.
//   입력: data/normalized/etf-master.json, data/raw/wisereport/<code>.json, data/raw/naver-csv/holdings.json
//   출력: data/normalized/etf-metadata.json (ETF별 통합 레코드), data/normalized/etf-holdings.json
//   실행: npm run metadata:normalize
//
// 원칙(ETF_METADATA_PIPELINE_PROMPT.md §9): 모든 값에 출처/기준일 연결, 충돌값 폐기 금지,
// 출처 없는 추정값 생성 금지. §13: coverage score. §14: 충돌 리포트(별도로 build-etf-metadata-report.mjs 가 생성).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { readJsonCache, writeJsonCache, cacheExists } from './metadata/lib/cache.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_FILE = resolve(ROOT, 'data/normalized/etf-master.json');
const WISEREPORT_DIR = resolve(ROOT, 'data/raw/wisereport');
const NAVER_CSV_FILE = resolve(ROOT, 'data/raw/naver-csv/holdings.json');
const OUT_METADATA = resolve(ROOT, 'data/normalized/etf-metadata.json');
const OUT_HOLDINGS = resolve(ROOT, 'data/normalized/etf-holdings.json');
const PRIORITY_CONFIG = resolve(ROOT, 'config/field-source-priority.json');

function loadWisereportResults() {
  const map = new Map();
  if (!cacheExists(WISEREPORT_DIR)) return map;
  for (const f of readdirSync(WISEREPORT_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const r = readJsonCache(resolve(WISEREPORT_DIR, f));
    if (r) map.set(r.etfCode, r);
  }
  return map;
}

// 이름 텍스트에서 리터럴로 확인 가능한 구조적 사실만 추출한다(최종 전략 태그 확정 금지 — §4.4).
function extractNameHints(name) {
  const hints = [];
  const leverageMatch = name.match(/(\d(?:\.\d)?)\s*X/i);
  if (leverageMatch) hints.push(`leverage=${leverageMatch[1]}X(명칭 표기)`);
  if (/레버리지/.test(name)) hints.push('name_contains=레버리지');
  if (/인버스/.test(name)) hints.push('name_contains=인버스');
  if (/액티브/.test(name)) hints.push('name_contains=액티브');
  if (/커버드콜/.test(name)) hints.push('name_contains=커버드콜');
  if (/\(H\)/.test(name)) hints.push('name_contains=(H) 환헤지 표기');
  if (/합성/.test(name)) hints.push('name_contains=합성(스왑) 구조');
  if (/만기매칭|목표전환/.test(name)) hints.push('name_contains=만기매칭/목표전환');
  return hints;
}

function buildRecord(masterEtf, wisereport, naverCsvHoldings) {
  const etfCode = masterEtf.etfCode;
  const now = wisereport?.retrievedAt || new Date().toISOString();
  const wd = wisereport?.data || null;

  const sources = [];
  const addSource = (field, value, sourceId, sourceUrl, asOfDate, priority, confidence) => {
    if (value == null || (Array.isArray(value) && value.length === 0)) return;
    sources.push({ field, value, sourceId, sourceUrl, asOfDate: asOfDate ?? null, retrievedAt: now, priority, confidence });
  };

  addSource('name', masterEtf.name, 'naver_master', 'https://finance.naver.com/api/sise/etfItemList.nhn', null, 50, 0.75);
  if (wd?.name) addSource('name', wd.name, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.issuer) addSource('issuer', wd.issuer, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.listingDate) addSource('listingDate', wd.listingDate, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.benchmarkName) addSource('benchmark.name', wd.benchmarkName, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.totalFeePct != null) addSource('totalFeePct', wd.totalFeePct, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.netAssetsMillionKrw != null)
    addSource('netAssetsMillionKrw', wd.netAssetsMillionKrw, 'wisereport', wisereport.sourceUrl, wd.asOfDate, 100, 0.85);
  if (wd?.distributionScheduleText)
    addSource('distribution.scheduleText', wd.distributionScheduleText, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.liquidityProviderText)
    addSource('liquidityProviderText', wd.liquidityProviderText, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);
  if (wd?.etfTypeText) addSource('etfTypeText', wd.etfTypeText, 'wisereport', wisereport.sourceUrl, null, 100, 0.85);

  // holdings: wisereport(CU_data, priority 100) 우선, 비어있으면 naver_csv(priority 80) fallback.
  // 최신성이 중요한 필드이므로 기준일 비교도 함께 기록한다(config field-source-priority.json recencyOverride).
  let holdings = [];
  let holdingsSource = null;
  let holdingsAsOfDate = null;
  if (wd?.holdings?.length) {
    // WiseReport CU_data 는 종목코드를 주지 않음 — naver_csv(같은 raw소스 계열, 이미 교차검증됨)에서
    // 종목명이 일치하는 코드를 보강한다(코드 자체를 추정 생성하지 않고, 실제 다른 소스 값만 채움).
    const csvNameToCode = new Map((naverCsvHoldings?.holdings || []).map((h) => [h.name, h.code]));
    holdings = wd.holdings.map((h) => ({ ...h, code: h.code ?? csvNameToCode.get(h.name) ?? null }));
    holdingsSource = 'wisereport';
    holdingsAsOfDate = wd.asOfDate;
    addSource('holdings', `${holdings.length}개 종목`, 'wisereport', wisereport.sourceUrl, wd.asOfDate, 100, 0.85);
  } else if (naverCsvHoldings?.holdings?.length) {
    holdings = naverCsvHoldings.holdings;
    holdingsSource = 'naver_csv';
    addSource('holdings', `${holdings.length}개 종목`, 'naver_csv', 'spikes/krx-direct/reports/naver_top10_holdings_full.csv', null, 80, 0.7);
  }
  // 두 소스 모두 있고 값이 다르면(구성종목 수 등) 충돌 후보로 별도 기록(대표 필드만 비교).
  const conflicts = [];
  if (wd?.holdings?.length && naverCsvHoldings?.holdings?.length) {
    const wSet = wd.holdings.map((h) => h.name).join('|');
    const nSet = naverCsvHoldings.holdings.map((h) => h.name).join('|');
    if (wSet !== nSet) {
      conflicts.push({
        field: 'holdings',
        selectedValue: `wisereport(${wd.holdings.length}종)`,
        selectedSource: 'wisereport',
        otherValue: `naver_csv(${naverCsvHoldings.holdings.length}종)`,
        otherSource: 'naver_csv',
        asOfDateDiff: `wisereport=${wd.asOfDate ?? 'null'} / naver_csv=null`,
        reason: '우선순위(wisereport) 채택, 구성종목 리스트 상이 — 원본 모두 보존',
      });
    }
  }

  const nameHints = extractNameHints(masterEtf.name);

  const descriptions = {
    productDescription: null,
    investmentObjective: null,
    strategyDescription: null,
    benchmarkDescription: null,
    _note: '이번 세션 소스(wisereport)는 자유서술 텍스트를 제공하지 않음 — 운용사 PDF/투자설명서 확보 전까지 null(추정 생성 금지)',
  };

  const record = {
    etfCode,
    codeType: masterEtf.codeType,
    name: wd?.name || masterEtf.name,
    issuer: wd?.issuer ?? null,
    listingDate: wd?.listingDate ?? null,
    benchmark: {
      name: wd?.benchmarkName ?? null,
      provider: null,
      description: null,
      methodology: null,
      rebalanceFrequency: null,
    },
    classificationFacts: {
      assetClass: null,
      regions: null,
      active: /액티브/.test(masterEtf.name) || null,
      currencyHedged: /\(H\)/.test(masterEtf.name) || null,
      rawTypeText: wd?.etfTypeText ?? null,
      nameHints,
    },
    fees: {
      totalFeePct: wd?.totalFeePct ?? null,
      netAssetsMillionKrw: wd?.netAssetsMillionKrw ?? null,
    },
    performance: {
      return1m: wd?.return1m ?? null,
      return3m: wd?.return3m ?? null,
      return6m: wd?.return6m ?? null,
      return12m: wd?.return12m ?? null,
      beta: wd?.beta ?? null,
      _note: '최대 12개월까지만 제공(WiseReport 실측 한계, 5년치 없음)',
    },
    holdings,
    holdingsSource,
    holdingsAsOfDate,
    sectorWeights: [],
    countryWeights: [],
    distribution: {
      frequency: null,
      scheduleText: wd?.distributionScheduleText ?? null,
      monthly: wd?.distributionScheduleText ? /매월|매\s*1,\s*2,\s*3/.test(wd.distributionScheduleText) : null,
      coveredCall: /커버드콜/.test(masterEtf.name),
      trailing12MonthAmount: null,
      _note: '실지급 이력(날짜·금액)은 SEIBro 분배금 지급현황에서만 확인 가능 — 이번 세션 미구현(docs 참조 spikes/krx-direct/DETAIL_SCREEN_SOURCES.md)',
    },
    descriptions,
    conflicts,
    coverage: null, // build-etf-metadata-report.mjs 가 채움
    sources,
    collectionStatus: wisereport ? wisereport.status : 'not_collected',
    updatedAt: now,
  };

  return record;
}

function main() {
  if (!cacheExists(MASTER_FILE)) throw new Error('먼저 npm run metadata:master 를 실행하세요.');
  const master = readJsonCache(MASTER_FILE);
  const wisereportResults = loadWisereportResults();
  const naverCsv = cacheExists(NAVER_CSV_FILE) ? readJsonCache(NAVER_CSV_FILE) : { etfs: [] };
  const naverCsvByCode = new Map(naverCsv.etfs.map((e) => [e.etfCode, e]));

  if (wisereportResults.size === 0) {
    console.warn('[metadata:normalize] 경고: wisereport 수집 결과가 없습니다. 먼저 metadata:sample 또는 metadata:collect 를 실행하세요.');
  }

  const records = [];
  for (const etf of master.etfs) {
    const wr = wisereportResults.get(etf.etfCode);
    const csvHoldingsRaw = naverCsvByCode.get(etf.etfCode);
    const csvHoldings = csvHoldingsRaw?.holdings?.length ? csvHoldingsRaw : null;
    if (!wr && !csvHoldings) continue; // 어떤 소스에서도 실데이터가 없는 ETF는 통합 레코드를 만들지 않음(추정 생성 금지)
    records.push(buildRecord(etf, wr, csvHoldings));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    masterEtfCount: master.etfCount,
    integratedRecordCount: records.length,
    records,
  };
  writeJsonCache(OUT_METADATA, out);

  const holdingsOut = {
    generatedAt: new Date().toISOString(),
    etfs: Object.fromEntries(
      records.filter((r) => r.holdings.length).map((r) => [r.etfCode, { name: r.name, source: r.holdingsSource, asOfDate: r.holdingsAsOfDate, holdings: r.holdings }])
    ),
  };
  writeJsonCache(OUT_HOLDINGS, holdingsOut);

  console.log(`[metadata:normalize] 마스터 ${master.etfCount}종 중 통합 레코드 ${records.length}종 생성 → ${OUT_METADATA}`);
  console.log(`[metadata:normalize] 구성종목 보유 ETF ${Object.keys(holdingsOut.etfs).length}종 → ${OUT_HOLDINGS}`);
}

main();
