import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUTS = {
  master: 'data/normalized/etf-master.json',
  metadata: 'data/normalized/etf-metadata.json',
  holdings: 'data/normalized/etf-holdings.json',
  indexNames: 'data/tagging/etf-universe-index-names.json',
  tagScores: 'data/tagging/etf-tag-scores.json',
};
const OUTPUTS = {
  json: 'data/reports/etf-taxonomy-data-readiness.json',
  csv: 'reports/tagging/etf-taxonomy-data-readiness.csv',
  html: 'reports/tagging/ETF_TAXONOMY_DATA_READINESS.html',
};

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const exists = (value) => value !== null && value !== undefined && value !== '';
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const nonEmpty = (value) => Array.isArray(value) && value.length > 0;
const round = (value, digits = 1) => Number(value.toFixed(digits));
const pct = (count, total) => total ? round((count / total) * 100) : 0;
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const csv = (value) => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function evidenceLevel(points) {
  if (points >= 3) return 'high';
  if (points === 2) return 'medium';
  if (points === 1) return 'low';
  return 'none';
}

function gradeFor(score) {
  if (score >= 75) return { id: 'A', label: '상세 리뷰 가능', meaning: '핵심 근거가 비교적 충분해 사람의 의미 검토를 우선 진행할 수 있음' };
  if (score >= 55) return { id: 'B', label: '조건부 리뷰', meaning: '일부 중요한 근거가 빠져 있어 주의 표시와 함께 검토 가능' };
  if (score >= 30) return { id: 'C', label: '근거 보강 우선', meaning: '상품명·일부 지수·구성종목에 편중되어 데이터 보강이 먼저 필요' };
  return { id: 'D', label: '얇은 데이터', meaning: '상품명·기초지수 위주의 최소 데이터로 의미 분류 확정에 부적합' };
}

function assessEtf(master, metadata, holdingDoc, indexItem, tagScore) {
  const benchmarkName = metadata?.benchmark?.name || indexItem?.indexName || null;
  const holdings = metadata?.holdings?.length ? metadata.holdings : holdingDoc?.holdings || [];
  const descriptions = metadata?.descriptions || {};
  const descriptionValues = [
    descriptions.productDescription,
    descriptions.investmentObjective,
    descriptions.strategyDescription,
    descriptions.benchmarkDescription,
  ].filter(hasText);
  const sources = metadata?.sources || [];
  const conflicts = metadata?.conflicts || [];
  const distribution = metadata?.distribution || {};
  const nameHints = metadata?.classificationFacts?.nameHints || [];
  const rawTypeText = metadata?.classificationFacts?.rawTypeText || null;
  const sectorCountryWeights = [
    ...(metadata?.sectorWeights || []),
    ...(metadata?.countryWeights || []),
  ];
  const weightsKnown = holdings.length > 0 && holdings.some((item) => Number.isFinite(item.weight));
  const sourceFieldCount = new Set(sources.map((source) => source.field).filter(Boolean)).size;
  const standardCode = master.codeType === 'krx_numeric';

  const components = {
    identity: (hasText(master.name) ? 3 : 0) + (standardCode ? 5 : 0)
      + (hasText(metadata?.issuer || master.issuer) ? 4 : 0) + (exists(metadata?.listingDate || master.listingDate) ? 3 : 0),
    productFacts: (hasText(benchmarkName) ? 10 : 0) + (hasText(rawTypeText) ? 6 : 0)
      + (descriptionValues.length ? 10 : 0) + (nameHints.length ? 4 : 0),
    portfolio: (holdings.length ? 20 : 0) + (weightsKnown ? 5 : 0) + (sectorCountryWeights.length ? 5 : 0),
    distribution: (hasText(distribution.scheduleText) || hasText(distribution.frequency) ? 5 : 0)
      + (exists(distribution.trailing12MonthAmount) ? 5 : 0),
    provenance: (sources.length ? 5 : 0) + (sourceFieldCount >= 3 ? 5 : 0) + (conflicts.length === 0 ? 5 : 0),
  };
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  const grade = gradeFor(score);

  const facetEvidence = {
    assetClass: evidenceLevel((hasText(rawTypeText) ? 1 : 0) + (hasText(benchmarkName) ? 1 : 0) + (descriptionValues.length ? 1 : 0)),
    region: evidenceLevel((metadata?.countryWeights?.length ? 2 : 0) + (hasText(benchmarkName) || hasText(rawTypeText) ? 1 : 0)),
    sector: evidenceLevel((metadata?.sectorWeights?.length ? 2 : 0) + (holdings.length ? 1 : 0) + (hasText(benchmarkName) || descriptionValues.length ? 1 : 0)),
    strategy: evidenceLevel((descriptionValues.length ? 1 : 0) + (hasText(benchmarkName) ? 1 : 0) + (nameHints.length || hasText(rawTypeText) ? 1 : 0)),
    dividend: evidenceLevel((exists(distribution.trailing12MonthAmount) ? 2 : 0) + (hasText(distribution.scheduleText) || hasText(distribution.frequency) ? 1 : 0)),
  };

  const missing = [];
  if (!standardCode) missing.push('표준 KRX 코드');
  if (!metadata) missing.push('상세 메타데이터');
  if (!hasText(metadata?.issuer || master.issuer)) missing.push('운용사');
  if (!hasText(benchmarkName)) missing.push('기초지수');
  if (!descriptionValues.length) missing.push('상품 설명·투자 목적');
  if (!holdings.length) missing.push('구성종목');
  if (!sectorCountryWeights.length) missing.push('산업·국가 비중');
  if (!hasText(distribution.scheduleText) && !hasText(distribution.frequency)) missing.push('분배 일정');
  if (!exists(distribution.trailing12MonthAmount)) missing.push('실제 분배금 이력');
  if (!sources.length) missing.push('필드별 출처');

  return {
    etfCode: master.etfCode,
    codeType: master.codeType,
    name: master.name,
    issuer: metadata?.issuer || master.issuer || null,
    benchmarkName,
    detailScope: metadata ? 'enriched' : 'thin',
    score,
    grade: grade.id,
    gradeLabel: grade.label,
    components,
    facetEvidence,
    evidence: {
      metadata: Boolean(metadata),
      holdingsCount: holdings.length,
      holdingsWeightsKnown: weightsKnown,
      descriptionCount: descriptionValues.length,
      sourceCount: sources.length,
      sourceFieldCount,
      conflictCount: conflicts.length,
      hasRawType: hasText(rawTypeText),
      hasNameHints: nameHints.length > 0,
      hasDistributionSchedule: hasText(distribution.scheduleText) || hasText(distribution.frequency),
      hasDistributionHistory: exists(distribution.trailing12MonthAmount),
      hasSectorCountryWeights: sectorCountryWeights.length > 0,
    },
    classification: {
      tagCount: tagScore?.classifications?.length || 0,
      hasRuleContribution: Boolean(tagScore?.hasRuleContribution),
      hasLlmContribution: Boolean(tagScore?.hasLlmContribution),
      reviewIssueCount: tagScore?.reviewIssues?.length || 0,
    },
    missing,
  };
}

function buildReport() {
  const master = readJson(INPUTS.master);
  const metadata = readJson(INPUTS.metadata);
  const holdings = readJson(INPUTS.holdings);
  const indexNames = readJson(INPUTS.indexNames);
  const tagScores = readJson(INPUTS.tagScores);

  const metadataByCode = new Map(metadata.records.map((item) => [item.etfCode, item]));
  const holdingsByCode = new Map(Object.entries(holdings.etfs));
  const indexByCode = new Map(indexNames.items.map((item) => [item.etfCode, item]));
  const rows = master.etfs.map((item) => assessEtf(
    item,
    metadataByCode.get(item.etfCode),
    holdingsByCode.get(item.etfCode),
    indexByCode.get(item.etfCode),
    tagScores.etfs[item.etfCode],
  ));

  if (rows.length !== 1141) throw new Error(`ETF 마스터 건수가 1,141이 아닙니다: ${rows.length}`);
  if (new Set(rows.map((row) => row.etfCode)).size !== rows.length) throw new Error('ETF 코드가 중복되었습니다.');

  const grades = Object.fromEntries(['A', 'B', 'C', 'D'].map((grade) => {
    const count = rows.filter((row) => row.grade === grade).length;
    return [grade, { count, pct: pct(count, rows.length), ...gradeFor({ A: 75, B: 55, C: 30, D: 0 }[grade]) }];
  }));
  const facetEvidence = {};
  for (const facet of ['assetClass', 'region', 'sector', 'strategy', 'dividend']) {
    facetEvidence[facet] = Object.fromEntries(['high', 'medium', 'low', 'none'].map((level) => {
      const count = rows.filter((row) => row.facetEvidence[facet] === level).length;
      return [level, { count, pct: pct(count, rows.length) }];
    }));
  }
  const missingFields = {};
  for (const row of rows) for (const field of row.missing) missingFields[field] = (missingFields[field] || 0) + 1;

  const summary = {
    totalEtfs: rows.length,
    enrichedEtfs: rows.filter((row) => row.detailScope === 'enriched').length,
    thinEtfs: rows.filter((row) => row.detailScope === 'thin').length,
    krxNumericEtfs: rows.filter((row) => row.codeType === 'krx_numeric').length,
    unresolvedCodeEtfs: rows.filter((row) => row.codeType !== 'krx_numeric').length,
    grades,
    facetEvidence,
    missingFields: Object.entries(missingFields)
      .map(([field, count]) => ({ field, count, pct: pct(count, rows.length) }))
      .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field, 'ko')),
    averageScore: round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length),
    humanReviewPriorityCount: rows.filter((row) => row.grade === 'A' || row.grade === 'B').length,
    dataCollectionPriorityCount: rows.filter((row) => row.grade === 'C' || row.grade === 'D').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    purpose: 'ETF taxonomy review input-data readiness audit',
    scoringVersion: '1.0.0',
    scopeNote: '점수는 분류 결과의 정확도가 아니라, 사람이 택소노미 분류를 검토할 때 사용할 근거 데이터의 준비도를 뜻한다.',
    sourceSnapshots: Object.fromEntries(Object.entries({ master, metadata, holdings, indexNames, tagScores })
      .map(([key, value]) => [key, { path: INPUTS[key], generatedAt: value.generatedAt || null }])),
    scoring: {
      maxScore: 100,
      components: {
        identity: { max: 15, fields: '이름 3, 표준 KRX 코드 5, 운용사 4, 상장일 3' },
        productFacts: { max: 30, fields: '기초지수 10, 원문 유형 6, 상품 설명 10, 이름 구조 힌트 4' },
        portfolio: { max: 30, fields: '구성종목 20, 비중 5, 산업·국가 비중 5' },
        distribution: { max: 10, fields: '분배 일정 5, 실제 분배금 이력 5' },
        provenance: { max: 15, fields: '출처 존재 5, 출처 필드 3개 이상 5, 충돌 없음 5' },
      },
      grades: {
        A: '75~100: 상세 리뷰 가능', B: '55~74: 조건부 리뷰',
        C: '30~54: 근거 보강 우선', D: '0~29: 얇은 데이터',
      },
    },
    summary,
    etfs: rows,
  };
}

function writeJson(relativePath, value) {
  const fullPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeCsv(report) {
  const headers = [
    'etfCode', 'name', 'codeType', 'issuer', 'benchmarkName', 'detailScope', 'readinessScore', 'grade',
    'assetClassEvidence', 'regionEvidence', 'sectorEvidence', 'strategyEvidence', 'dividendEvidence',
    'holdingsCount', 'tagCount', 'hasLlmContribution', 'missingFields',
  ];
  const lines = [headers.join(',')];
  for (const row of report.etfs) {
    lines.push([
      row.etfCode, row.name, row.codeType, row.issuer, row.benchmarkName, row.detailScope, row.score, row.grade,
      row.facetEvidence.assetClass, row.facetEvidence.region, row.facetEvidence.sector,
      row.facetEvidence.strategy, row.facetEvidence.dividend, row.evidence.holdingsCount,
      row.classification.tagCount, row.classification.hasLlmContribution, row.missing,
    ].map(csv).join(','));
  }
  const fullPath = path.join(ROOT, OUTPUTS.csv);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, '\ufeff' + lines.join('\n') + '\n', 'utf8');
}

function renderHtml(report) {
  const { summary } = report;
  const gradeCards = ['A', 'B', 'C', 'D'].map((grade) => {
    const item = summary.grades[grade];
    return `<article class="metric grade-${grade.toLowerCase()}"><span>${grade}등급</span><strong>${item.count.toLocaleString('ko-KR')}</strong><small>${item.pct}% · ${escapeHtml(item.label)}</small></article>`;
  }).join('');
  const missingRows = summary.missingFields.map((item) => `<tr><td>${escapeHtml(item.field)}</td><td>${item.count.toLocaleString('ko-KR')}</td><td>${item.pct}%</td><td><div class="bar"><i style="width:${item.pct}%"></i></div></td></tr>`).join('');
  const facetLabels = { assetClass: '자산군', region: '지역', sector: '섹터·테마', strategy: '구조·전략', dividend: '배당' };
  const facetRows = Object.entries(summary.facetEvidence).map(([facet, levels]) => `<tr><td><b>${facetLabels[facet]}</b></td><td>${levels.high.count} (${levels.high.pct}%)</td><td>${levels.medium.count} (${levels.medium.pct}%)</td><td>${levels.low.count} (${levels.low.pct}%)</td><td>${levels.none.count} (${levels.none.pct}%)</td></tr>`).join('');
  const tableRows = [...report.etfs].sort((a, b) => a.grade.localeCompare(b.grade) || b.score - a.score || a.etfCode.localeCompare(b.etfCode)).map((row) => {
    const chips = [
      row.evidence.holdingsCount ? `구성종목 ${row.evidence.holdingsCount}` : null,
      row.benchmarkName ? '기초지수' : null,
      row.evidence.descriptionCount ? '설명' : null,
      row.evidence.hasDistributionSchedule ? '분배일정' : null,
      row.classification.hasLlmContribution ? '상세분류' : '규칙분류',
    ].filter(Boolean).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');
    return `<tr data-grade="${row.grade}" data-scope="${row.detailScope}" data-search="${escapeHtml(`${row.etfCode} ${row.name} ${row.issuer || ''} ${row.benchmarkName || ''}`.toLowerCase())}">
      <td><b>${escapeHtml(row.etfCode)}</b><small>${escapeHtml(row.codeType)}</small></td>
      <td><b>${escapeHtml(row.name)}</b><small>${escapeHtml(row.issuer || '운용사 정보 없음')}</small></td>
      <td><span class="badge badge-${row.grade.toLowerCase()}">${row.grade}</span> <b>${row.score}</b></td>
      <td>${chips || '<span class="muted">근거 없음</span>'}</td>
      <td>${escapeHtml(row.missing.slice(0, 4).join(', '))}${row.missing.length > 4 ? ` 외 ${row.missing.length - 4}개` : ''}</td>
    </tr>`;
  }).join('');
  const generated = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(report.generatedAt));

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ETF 택소노미 데이터 준비도 감사</title>
<style>
:root{--ink:#15231f;--muted:#65736f;--line:#dce6e2;--paper:#f7faf9;--mint:#00b89c;--mint2:#e5f8f3;--blue:#3478db;--amber:#a66b00;--red:#b43f51}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font-family:Pretendard,"Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.6;word-break:keep-all}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}header{padding:72px 0 42px;background:linear-gradient(135deg,#0e2822,#164d43);color:#fff}header p{max-width:800px;color:#c8ddd7;font-size:18px}h1{margin:0 0 18px;font-size:clamp(36px,6vw,64px);line-height:1.15;letter-spacing:-.05em}h2{margin:0 0 10px;font-size:32px;letter-spacing:-.04em}section{padding:42px 0}.notice{padding:18px 20px;border-left:5px solid var(--mint);border-radius:12px;background:#fff}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:24px}.metric{padding:22px;border:1px solid var(--line);border-radius:18px;background:#fff}.metric span,.metric small{display:block;color:var(--muted)}.metric strong{display:block;margin:5px 0;font-size:36px}.grade-a{border-top:5px solid var(--mint)}.grade-b{border-top:5px solid var(--blue)}.grade-c{border-top:5px solid var(--amber)}.grade-d{border-top:5px solid var(--red)}.split{display:grid;grid-template-columns:1fr 1fr;gap:22px}.panel{padding:26px;border:1px solid var(--line);border-radius:20px;background:#fff}.big{font-size:32px;font-weight:900}.muted,small{display:block;color:var(--muted)}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{position:sticky;top:0;background:#edf4f1;font-size:13px}td small{font-size:11px}.bar{height:8px;min-width:90px;border-radius:8px;background:#e9efed;overflow:hidden}.bar i{display:block;height:100%;background:var(--amber)}.controls{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;gap:10px;padding:14px 0;background:rgba(247,250,249,.96)}input,select{min-height:44px;padding:0 13px;border:1px solid #cbd8d3;border-radius:10px;background:#fff;font:inherit}input{flex:1;min-width:240px}.table-wrap{overflow:auto;max-height:720px;border:1px solid var(--line);border-radius:16px}.badge{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;color:#fff;font-weight:900}.badge-a{background:var(--mint)}.badge-b{background:var(--blue)}.badge-c{background:var(--amber)}.badge-d{background:var(--red)}.chip{display:inline-block;margin:2px;padding:3px 7px;border-radius:999px;background:var(--mint2);font-size:11px}.links{display:flex;flex-wrap:wrap;gap:10px}.links a{padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:#075e52;text-decoration:none}footer{padding:30px 0 60px;color:var(--muted);font-size:13px}@media(max-width:760px){.metrics,.split{grid-template-columns:1fr 1fr}th:nth-child(4),td:nth-child(4){display:none}}@media(max-width:480px){.metrics,.split{grid-template-columns:1fr}header{padding-top:45px}th:nth-child(5),td:nth-child(5){display:none}}
</style></head><body>
<header><div class="wrap"><small>택소노미 리뷰 · 1단계</small><h1>ETF 1,141개<br>데이터 준비도 감사</h1><p>각 ETF에 분류 근거가 얼마나 준비되어 있는지 측정했습니다. 이 등급은 현재 태그의 정답률이 아니라, 사람이 분류를 검토할 때 사용할 수 있는 증거의 충분함을 뜻합니다.</p><small>생성: ${escapeHtml(generated)} · 산정 기준 v${escapeHtml(report.scoringVersion)}</small></div></header>
<main><section><div class="wrap"><div class="notice"><b>핵심 결론</b><br>상세 메타데이터가 있는 ETF는 ${summary.enrichedEtfs.toLocaleString('ko-KR')}개, 상품명·기초지수 중심의 얇은 데이터는 ${summary.thinEtfs.toLocaleString('ko-KR')}개입니다. 사람의 택소노미 리뷰를 먼저 진행할 수 있는 A·B등급은 <b>${summary.humanReviewPriorityCount.toLocaleString('ko-KR')}개</b>, 데이터 수집이 먼저인 C·D등급은 <b>${summary.dataCollectionPriorityCount.toLocaleString('ko-KR')}개</b>입니다.</div><div class="metrics">${gradeCards}</div></div></section>
<section><div class="wrap"><h2>전체 기반 상태</h2><div class="split"><article class="panel"><span class="big">${summary.enrichedEtfs} / ${summary.totalEtfs}</span><b>상세 메타데이터 연결</b><p class="muted">나머지 ${summary.thinEtfs}개는 전체 유니버스 확장 단계에서 상품명과 기초지수명 위주로 분류되었습니다.</p></article><article class="panel"><span class="big">${summary.krxNumericEtfs} / ${summary.totalEtfs}</span><b>표준 KRX 숫자 코드</b><p class="muted">${summary.unresolvedCodeEtfs}개는 네이버 내부 식별자 형태여서 다른 데이터와 결합할 때 코드 해소가 필요합니다.</p></article></div></div></section>
<section><div class="wrap"><h2>가장 많이 비어 있는 근거</h2><p class="muted">수치가 높을수록 우선 수집 대상입니다.</p><div class="table-wrap"><table><thead><tr><th>항목</th><th>누락 ETF</th><th>누락률</th><th>규모</th></tr></thead><tbody>${missingRows}</tbody></table></div></div></section>
<section><div class="wrap"><h2>분류 관점별 근거 수준</h2><p class="muted">‘높음’은 해당 관점을 확정할 만한 복수의 직접 근거가 있다는 뜻입니다. ‘낮음’은 주로 상품명 또는 기초지수명 하나에 의존합니다.</p><div class="table-wrap"><table><thead><tr><th>분류 관점</th><th>높음</th><th>보통</th><th>낮음</th><th>없음</th></tr></thead><tbody>${facetRows}</tbody></table></div></div></section>
<section><div class="wrap"><h2>ETF별 준비도 목록</h2><p class="muted">이름·코드·운용사·기초지수로 검색하거나 등급과 데이터 범위로 좁힐 수 있습니다.</p><div class="controls"><input id="search" type="search" placeholder="ETF 이름, 코드, 운용사, 기초지수 검색" aria-label="ETF 검색"><select id="grade" aria-label="등급"><option value="">모든 등급</option><option>A</option><option>B</option><option>C</option><option>D</option></select><select id="scope" aria-label="데이터 범위"><option value="">전체 데이터 범위</option><option value="enriched">상세 메타데이터 있음</option><option value="thin">얇은 데이터</option></select><b id="visible">${summary.totalEtfs.toLocaleString('ko-KR')}개</b></div><div class="table-wrap"><table id="etfs"><thead><tr><th>코드</th><th>ETF</th><th>등급·점수</th><th>확보 근거</th><th>주요 누락</th></tr></thead><tbody>${tableRows}</tbody></table></div></div></section>
<section><div class="wrap"><h2>점수 산정과 해석</h2><div class="split"><article class="panel"><b>데이터 항목별 최대 점수</b><p>식별 정보 15 · 상품·지수 정보 30 · 구성종목 30 · 분배 정보 10 · 출처 추적 15</p><b>A · 75점 이상</b><p>상세 의미 검토를 먼저 진행할 수 있습니다.</p><b>B · 55~74점</b><p>중요 근거가 일부 빠져 있어 조건부로 검토합니다.</p></article><article class="panel"><b>C · 30~54점</b><p>분류 확정보다 근거 데이터 보강이 먼저입니다.</p><b>D · 0~29점</b><p>상품명·기초지수 위주이므로 상세 분류를 확정하지 않습니다.</p><p class="muted">구성종목이 있다는 사실만으로 산업을 확정하지 않고, 기초지수·상품 설명 등 서로 다른 근거가 함께 있을 때 더 높은 수준으로 평가합니다.</p></article></div><p class="notice">점수는 정확도 점수가 아닙니다. A등급도 사람이 검토해야 하며, D등급도 현재 태그가 우연히 맞을 수 있습니다.</p></div></section>
<section><div class="wrap"><h2>다음 단계와 원본 파일</h2><div class="links"><a href="ETF_TAXONOMY_REVIEW_SAMPLE.html">표본 200개 검토 시작</a><a href="../../data/reports/etf-taxonomy-data-readiness.json">전체 JSON</a><a href="etf-taxonomy-data-readiness.csv">검토용 CSV</a><a href="../../data/normalized/etf-master.json">ETF 마스터</a><a href="../../data/normalized/etf-metadata.json">상세 메타데이터</a><a href="../../data/tagging/etf-tag-scores.json">현재 분류 결과</a></div></div></section></main>
<footer><div class="wrap">ETF Hub · Taxonomy data readiness audit · source snapshots are recorded in the JSON report.</div></footer>
<script>
const rows=[...document.querySelectorAll('#etfs tbody tr')],search=document.querySelector('#search'),grade=document.querySelector('#grade'),scope=document.querySelector('#scope'),visible=document.querySelector('#visible');function apply(){const q=search.value.trim().toLowerCase();let n=0;for(const row of rows){const show=(!q||row.dataset.search.includes(q))&&(!grade.value||row.dataset.grade===grade.value)&&(!scope.value||row.dataset.scope===scope.value);row.hidden=!show;if(show)n++}visible.textContent=n.toLocaleString('ko-KR')+'개'}search.addEventListener('input',apply);grade.addEventListener('change',apply);scope.addEventListener('change',apply);
</script></body></html>`;
}

function main() {
  const report = buildReport();
  writeJson(OUTPUTS.json, report);
  writeCsv(report);
  const htmlPath = path.join(ROOT, OUTPUTS.html);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, renderHtml(report), 'utf8');
  console.log(`[taxonomy-data-audit] ${report.summary.totalEtfs} ETFs`);
  console.log(`[taxonomy-data-audit] grades ${Object.entries(report.summary.grades).map(([key, value]) => `${key}=${value.count}`).join(', ')}`);
  console.log(`[taxonomy-data-audit] → ${OUTPUTS.json}`);
  console.log(`[taxonomy-data-audit] → ${OUTPUTS.csv}`);
  console.log(`[taxonomy-data-audit] → ${OUTPUTS.html}`);
}

main();
