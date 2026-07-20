import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = {
  readiness: 'data/reports/etf-taxonomy-data-readiness.json',
  taxonomy: 'config/etf-tagging/etf-taxonomy.json',
  scores: 'data/tagging/etf-tag-scores.json',
  lowConfidence: 'data/tagging/etf-low-confidence.json',
  metadata: 'data/normalized/etf-metadata.json',
  holdings: 'data/normalized/etf-holdings.json',
};
const OUTPUTS = {
  json: 'data/reports/etf-taxonomy-review-sample.json',
  csv: 'reports/tagging/etf-taxonomy-review-sample.csv',
  html: 'reports/tagging/ETF_TAXONOMY_REVIEW_SAMPLE.html',
};
const TARGET = 200;

const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const write = (relativePath, content) => {
  const fullPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
};
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const csv = (value) => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function buildSample() {
  const readiness = read(FILES.readiness);
  const taxonomy = read(FILES.taxonomy);
  const scores = read(FILES.scores);
  const lowConfidence = read(FILES.lowConfidence);
  const metadata = read(FILES.metadata);
  const holdings = read(FILES.holdings);
  const rowByCode = new Map(readiness.etfs.map((row) => [row.etfCode, row]));
  const metaByCode = new Map(metadata.records.map((row) => [row.etfCode, row]));
  const tagById = new Map(taxonomy.tags.map((tag) => [tag.id, tag]));
  const lowByCode = new Map();
  for (const item of lowConfidence.items || []) {
    if (!lowByCode.has(item.etfCode)) lowByCode.set(item.etfCode, []);
    lowByCode.get(item.etfCode).push(item);
  }

  const tagPopulation = new Map(taxonomy.tags.map((tag) => [tag.id, 0]));
  for (const scored of Object.values(scores.etfs)) {
    for (const classification of scored.classifications || []) {
      tagPopulation.set(classification.tagId, (tagPopulation.get(classification.tagId) || 0) + 1);
    }
  }

  const selected = new Map();
  const add = (code, phase, reasons) => {
    if (selected.has(code)) {
      selected.get(code).selectionReasons.push(...reasons.filter((reason) => !selected.get(code).selectionReasons.includes(reason)));
      return false;
    }
    selected.set(code, { phase, selectionReasons: [...reasons] });
    return true;
  };
  const tagsFor = (code) => (scores.etfs[code]?.classifications || []).map((item) => item.tagId);
  const coveredTags = () => new Set([...selected.keys()].flatMap(tagsFor));

  // 1. 데이터 근거가 가장 준비된 A/B 109개는 모두 포함한다.
  for (const row of readiness.etfs.filter((item) => item.grade === 'A' || item.grade === 'B')) {
    add(row.etfCode, 'ready_core', [`준비도 ${row.grade}등급(${row.score}점)`]);
  }
  const readyCoreCount = selected.size;

  // 2. A/B에 없는 태그 중 C등급으로 보완 가능한 태그를 희소 태그부터 채운다.
  const cCandidates = readiness.etfs.filter((row) => row.grade === 'C');
  while (selected.size < TARGET) {
    const covered = coveredTags();
    const ranked = cCandidates.filter((row) => !selected.has(row.etfCode)).map((row) => {
      const newTags = tagsFor(row.etfCode).filter((tagId) => !covered.has(tagId));
      const gapScore = newTags.reduce((sum, tagId) => sum + 1000 / Math.max(1, tagPopulation.get(tagId) || 1), 0);
      return { row, newTags, gapScore };
    }).filter((item) => item.newTags.length).sort((a, b) => b.gapScore - a.gapScore
      || b.newTags.length - a.newTags.length || b.row.score - a.row.score || a.row.etfCode.localeCompare(b.row.etfCode));
    if (!ranked.length) break;
    const winner = ranked[0];
    add(winner.row.etfCode, 'tag_gap', [`태그 공백 보완: ${winner.newTags.map((id) => tagById.get(id)?.label || id).join(', ')}`]);
  }
  const tagGapCount = selected.size - readyCoreCount;

  // 3. 기준선에 못 미친 분류를 우선 넣어 false positive/threshold 문제를 점검한다.
  const lowRanked = cCandidates.filter((row) => !selected.has(row.etfCode) && lowByCode.has(row.etfCode))
    .sort((a, b) => lowByCode.get(b.etfCode).length - lowByCode.get(a.etfCode).length
      || b.score - a.score || a.etfCode.localeCompare(b.etfCode));
  for (const row of lowRanked) {
    if (selected.size >= TARGET) break;
    const items = lowByCode.get(row.etfCode);
    add(row.etfCode, 'low_confidence', [`저신뢰 분류 ${items.length}건: ${items.map((item) => tagById.get(item.tagId)?.label || item.tagId).join(', ')}`]);
  }
  const lowConfidenceAddedCount = selected.size - readyCoreCount - tagGapCount;

  // 4. 남는 자리는 현재 표본에서 적게 등장하는 태그와 다중 태그 경계 사례를 우선한다.
  while (selected.size < TARGET) {
    const currentCounts = new Map(taxonomy.tags.map((tag) => [tag.id, 0]));
    for (const code of selected.keys()) for (const tagId of tagsFor(code)) currentCounts.set(tagId, (currentCounts.get(tagId) || 0) + 1);
    const ranked = cCandidates.filter((row) => !selected.has(row.etfCode)).map((row) => {
      const tags = tagsFor(row.etfCode);
      const diversityScore = tags.reduce((sum, tagId) => sum + 1 / (1 + (currentCounts.get(tagId) || 0)), 0);
      const issueCount = scores.etfs[row.etfCode]?.reviewIssues?.length || 0;
      return { row, tags, priority: diversityScore * 100 + issueCount * 50 + tags.length * 2 + row.score / 100 };
    }).sort((a, b) => b.priority - a.priority || b.row.score - a.row.score || a.row.etfCode.localeCompare(b.row.etfCode));
    if (!ranked.length) break;
    const winner = ranked[0];
    add(winner.row.etfCode, 'diversity_boundary', [
      `희소·경계 사례: 현재 태그 ${winner.tags.length}개`,
      `B등급 경계와의 거리 ${55 - winner.row.score}점`,
    ]);
  }

  if (selected.size !== TARGET) throw new Error(`표본이 ${TARGET}개가 아닙니다: ${selected.size}`);

  const sampleItems = [...selected.entries()].map(([code, selection], index) => {
    const row = rowByCode.get(code);
    const scored = scores.etfs[code];
    const meta = metaByCode.get(code);
    const holdingDoc = holdings.etfs[code];
    const holdingItems = meta?.holdings?.length ? meta.holdings : holdingDoc?.holdings || [];
    const classifications = (scored?.classifications || []).map((item) => ({
      ...item,
      label: tagById.get(item.tagId)?.label || item.tagId,
      facet: tagById.get(item.tagId)?.facet || null,
    }));
    return {
      sampleNumber: index + 1,
      etfCode: code,
      name: row.name,
      readiness: { grade: row.grade, score: row.score, detailScope: row.detailScope, missing: row.missing },
      selectionPhase: selection.phase,
      selectionReasons: selection.selectionReasons,
      currentClassifications: classifications,
      lowConfidenceAssignments: lowByCode.get(code) || [],
      evidence: {
        issuer: row.issuer,
        benchmarkName: row.benchmarkName,
        rawTypeText: meta?.classificationFacts?.rawTypeText || null,
        nameHints: meta?.classificationFacts?.nameHints || [],
        holdings: holdingItems.slice(0, 10).map((item) => ({ name: item.name, code: item.code, weight: item.weight })),
        distributionSchedule: meta?.distribution?.scheduleText || meta?.distribution?.frequency || null,
        sourceCount: meta?.sources?.length || 0,
      },
      review: { decision: '', correctedTagIds: [], note: '', reviewer: '', reviewedAt: '' },
    };
  });

  const sampleCodes = new Set(sampleItems.map((item) => item.etfCode));
  const selectedTagCounts = new Map(taxonomy.tags.map((tag) => [tag.id, 0]));
  for (const item of sampleItems) for (const tag of item.currentClassifications) selectedTagCounts.set(tag.tagId, (selectedTagCounts.get(tag.tagId) || 0) + 1);
  const blockedTags = taxonomy.tags.filter((tag) => (selectedTagCounts.get(tag.id) || 0) === 0).map((tag) => {
    const allCodes = Object.entries(scores.etfs).filter(([, item]) => item.classifications?.some((c) => c.tagId === tag.id)).map(([code]) => code);
    const gradeCounts = Object.fromEntries(['A', 'B', 'C', 'D'].map((grade) => [grade, allCodes.filter((code) => rowByCode.get(code)?.grade === grade).length]));
    return { tagId: tag.id, label: tag.label, facet: tag.facet, classifiedEtfCount: allCodes.length, gradeCounts, reason: gradeCounts.D === allCodes.length ? 'D등급 데이터에만 존재' : '현재 200개 표본에 미포함' };
  });
  const phaseCounts = Object.fromEntries(['ready_core', 'tag_gap', 'low_confidence', 'diversity_boundary'].map((phase) => [phase, sampleItems.filter((item) => item.selectionPhase === phase).length]));
  const gradeCounts = Object.fromEntries(['A', 'B', 'C', 'D'].map((grade) => [grade, sampleItems.filter((item) => item.readiness.grade === grade).length]));

  return {
    generatedAt: new Date().toISOString(),
    selectionVersion: '1.0.0',
    targetCount: TARGET,
    purpose: '택소노미 정의와 자동 분류를 평가할 사람 검토용 골드셋 후보',
    policy: [
      'A·B등급 109개 전부 포함',
      'C등급에서 A·B 표본에 없는 태그를 희소 태그 우선으로 보완',
      'C등급 저신뢰 분류를 우선 포함',
      '남는 자리는 희소 태그·다중 태그·B등급 경계 사례로 채움',
      'D등급은 정답 표본에서 제외하고 데이터 수집 보류 태그로 기록',
    ],
    sourceReadinessGeneratedAt: readiness.generatedAt,
    summary: {
      sampleCount: sampleItems.length,
      gradeCounts,
      phaseCounts,
      taxonomyTagCount: taxonomy.tags.length,
      coveredTagCount: [...selectedTagCounts.values()].filter((count) => count > 0).length,
      blockedTagCount: blockedTags.length,
      lowConfidenceEtfCount: sampleItems.filter((item) => item.lowConfidenceAssignments.length > 0).length,
      uniqueCodes: sampleCodes.size,
    },
    blockedTags,
    tagCoverage: taxonomy.tags.map((tag) => ({ tagId: tag.id, label: tag.label, facet: tag.facet, sampleCount: selectedTagCounts.get(tag.id) || 0, universeCount: tagPopulation.get(tag.id) || 0 })),
    items: sampleItems,
  };
}

function writeCsv(report) {
  const headers = [
    'sampleNumber', 'etfCode', 'name', 'grade', 'readinessScore', 'selectionPhase', 'selectionReasons',
    'issuer', 'benchmarkName', 'rawTypeText', 'topHoldings', 'currentTagIds', 'currentTagLabels',
    'lowConfidenceTagIds', 'missingFields', 'decision', 'correctedTagIds', 'reviewNote', 'reviewer', 'reviewedAt',
  ];
  const lines = [headers.join(',')];
  for (const item of report.items) {
    lines.push([
      item.sampleNumber, item.etfCode, item.name, item.readiness.grade, item.readiness.score, item.selectionPhase,
      item.selectionReasons, item.evidence.issuer, item.evidence.benchmarkName, item.evidence.rawTypeText,
      item.evidence.holdings.map((holding) => `${holding.name}${holding.weight == null ? '' : ` ${holding.weight}%`}`),
      item.currentClassifications.map((tag) => tag.tagId), item.currentClassifications.map((tag) => tag.label),
      item.lowConfidenceAssignments.map((tag) => tag.tagId), item.readiness.missing,
      '', '', '', '', '',
    ].map(csv).join(','));
  }
  write(OUTPUTS.csv, '\ufeff' + lines.join('\n') + '\n');
}

function renderHtml(report) {
  const phaseLabels = { ready_core: 'A·B 전수', tag_gap: '태그 공백', low_confidence: '저신뢰', diversity_boundary: '희소·경계' };
  const generated = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(report.generatedAt));
  const blocked = report.blockedTags.map((tag) => `<li><b>${escapeHtml(tag.label)}</b> <code>${escapeHtml(tag.tagId)}</code> — ${escapeHtml(tag.reason)} (${tag.classifiedEtfCount}개)</li>`).join('');
  const rows = report.items.map((item) => {
    const tags = item.currentClassifications.map((tag) => `<span class="tag" title="${escapeHtml(`${tag.tagId} · score ${tag.score} · confidence ${tag.confidence}`)}">${escapeHtml(tag.label)}</span>`).join('');
    const holdings = item.evidence.holdings.slice(0, 5).map((holding) => `${holding.name}${holding.weight == null ? '' : ` ${holding.weight}%`}`).join(', ');
    return `<article class="review-card" data-code="${escapeHtml(item.etfCode)}" data-grade="${item.readiness.grade}" data-phase="${item.selectionPhase}" data-search="${escapeHtml(`${item.etfCode} ${item.name} ${item.evidence.issuer || ''} ${item.evidence.benchmarkName || ''} ${item.currentClassifications.map((tag) => tag.label).join(' ')}`.toLowerCase())}">
      <header><span class="number">${item.sampleNumber}</span><div><h3>${escapeHtml(item.name)}</h3><small>${escapeHtml(item.etfCode)} · ${escapeHtml(item.evidence.issuer || '운용사 정보 없음')}</small></div><span class="grade grade-${item.readiness.grade.toLowerCase()}">${item.readiness.grade} · ${item.readiness.score}</span></header>
      <div class="reason"><b>선정 이유</b> ${escapeHtml(item.selectionReasons.join(' / '))}</div>
      <dl><div><dt>기초지수</dt><dd>${escapeHtml(item.evidence.benchmarkName || '정보 없음')}</dd></div><div><dt>원문 유형</dt><dd>${escapeHtml(item.evidence.rawTypeText || '정보 없음')}</dd></div><div><dt>상위 구성종목</dt><dd>${escapeHtml(holdings || '정보 없음')}</dd></div><div><dt>주요 누락</dt><dd>${escapeHtml(item.readiness.missing.join(', ') || '없음')}</dd></div></dl>
      <div class="current"><b>현재 태그</b><div>${tags || '<span class="muted">없음</span>'}</div></div>
      <div class="inputs"><label>판정<select class="decision"><option value="">미검토</option><option value="correct">전체적으로 맞음</option><option value="incorrect">수정 필요</option><option value="insufficient">근거 부족</option></select></label><label>수정 후 태그 ID<textarea class="corrected" rows="2" placeholder="쉼표로 구분. 현재 태그가 모두 맞으면 비워도 됨"></textarea></label><label>검토 메모<textarea class="note" rows="2" placeholder="포함·제외 근거 또는 필요한 데이터"></textarea></label></div>
    </article>`;
  }).join('');
  const embedded = JSON.stringify(report.items.map((item) => ({ sampleNumber: item.sampleNumber, etfCode: item.etfCode, name: item.name, currentTagIds: item.currentClassifications.map((tag) => tag.tagId) }))).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ETF 택소노미 표본 200개 검토표</title><style>
:root{--ink:#15231f;--muted:#65736f;--line:#dbe6e2;--paper:#f5f9f7;--mint:#00b89c;--blue:#3478db;--amber:#a66b00;--red:#b43f51}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font-family:Pretendard,"Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.55;word-break:keep-all}.wrap{width:min(1100px,calc(100% - 32px));margin:auto}.hero{padding:62px 0 38px;color:#fff;background:linear-gradient(135deg,#102b25,#176052)}h1{margin:0 0 15px;font-size:clamp(36px,6vw,62px);letter-spacing:-.05em;line-height:1.12}.hero p{max-width:760px;color:#c9ddd8}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:24px}.metric{padding:16px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.08)}.metric b{display:block;font-size:28px}.section{padding:36px 0}.notice{padding:20px;border:1px solid var(--line);border-radius:15px;background:#fff}.notice li{margin:7px 0}.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:9px;padding:13px 0;background:rgba(245,249,247,.96)}input,select,textarea,button{font:inherit}input,select,button{min-height:42px;padding:0 12px;border:1px solid #c9d6d1;border-radius:10px;background:#fff}input[type=search]{flex:1;min-width:220px}button{cursor:pointer;font-weight:750}button.primary{border-color:#073d34;background:#103f36;color:#fff}.review-card{margin:0 0 15px;padding:22px;border:1px solid var(--line);border-radius:18px;background:#fff}.review-card>header{display:grid;grid-template-columns:40px 1fr auto;gap:12px;align-items:start}.number{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#e5f6f2;color:#076b5d;font-weight:900}h3{margin:0;font-size:20px;letter-spacing:-.03em}.grade{padding:5px 8px;border-radius:8px;color:#fff;font-size:12px;font-weight:900}.grade-a{background:var(--mint)}.grade-b{background:var(--blue)}.grade-c{background:var(--amber)}.reason{margin:16px 0;padding:10px 12px;border-radius:10px;background:#f0f5f3;font-size:13px}dl{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:0}dl div{padding:11px;border:1px solid #edf1ef;border-radius:10px}dt{color:var(--muted);font-size:11px;font-weight:800}dd{margin:3px 0 0;font-size:13px}.current{margin:14px 0}.tag{display:inline-block;margin:4px 4px 0 0;padding:4px 8px;border-radius:999px;background:#e5f6f2;color:#075e52;font-size:12px}.inputs{display:grid;grid-template-columns:.65fr 1fr 1fr;gap:10px;padding-top:14px;border-top:1px solid var(--line)}label{font-size:12px;font-weight:800}label select,label textarea{display:block;width:100%;margin-top:5px;border:1px solid #c9d6d1;border-radius:9px;padding:8px;background:#fff}.muted,small{color:var(--muted)}.empty{padding:40px;text-align:center}.progress{font-weight:900}@media(max-width:720px){.metrics{grid-template-columns:1fr 1fr}.inputs,dl{grid-template-columns:1fr}.review-card>header{grid-template-columns:40px 1fr}.grade{grid-column:2;justify-self:start}}</style></head><body>
<section class="hero"><div class="wrap"><small>택소노미 리뷰 · 2단계</small><h1>사람 검토 표본<br>200개</h1><p>A·B등급 109개를 모두 포함하고, C등급에서 태그 공백·저신뢰·희소 경계 사례 91개를 골랐습니다. 각 ETF의 현재 태그를 확인하고 판정과 수정안을 기록하세요.</p><div class="metrics"><div class="metric"><span>전체 표본</span><b>${report.summary.sampleCount}</b></div><div class="metric"><span>포함 태그</span><b>${report.summary.coveredTagCount}/${report.summary.taxonomyTagCount}</b></div><div class="metric"><span>저신뢰 사례</span><b>${report.summary.lowConfidenceEtfCount}</b></div><div class="metric"><span>검토 보류 태그</span><b>${report.summary.blockedTagCount}</b></div></div><small>생성 ${escapeHtml(generated)} · 선정 기준 v${report.selectionVersion}</small></div></section>
<section class="section"><div class="wrap"><div class="notice"><b>표본에 넣지 않은 태그</b><p class="muted">아래 태그는 현재 D등급 데이터에만 있어 정답을 만들 근거가 부족합니다. 먼저 데이터 수집이 필요합니다.</p><ul>${blocked || '<li>없음</li>'}</ul></div></div></section>
<main class="wrap"><div class="toolbar"><input id="search" type="search" placeholder="ETF·코드·태그 검색"><select id="grade"><option value="">모든 등급</option><option>A</option><option>B</option><option>C</option></select><select id="phase"><option value="">모든 선정 이유</option>${Object.entries(phaseLabels).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select><select id="decisionFilter"><option value="">모든 검토 상태</option><option value="pending">미검토</option><option value="correct">맞음</option><option value="incorrect">수정 필요</option><option value="insufficient">근거 부족</option></select><span class="progress" id="progress">0/200 검토</span><button id="exportJson" class="primary">결과 JSON 저장</button><button id="exportCsv">결과 CSV 저장</button></div><div id="cards">${rows}</div><div id="empty" class="empty" hidden>조건에 맞는 ETF가 없습니다.</div></main>
<footer class="section"><div class="wrap muted">판정은 이 브라우저에 자동 저장됩니다. 다른 환경으로 옮기기 전 반드시 JSON 또는 CSV로 내보내세요.</div></footer>
<script>const seed=${embedded};const key='etf-taxonomy-review-sample-v1';const cards=[...document.querySelectorAll('.review-card')];let saved=JSON.parse(localStorage.getItem(key)||'{}');function state(card){const code=card.dataset.code;return saved[code]||{decision:'',correctedTagIds:'',note:''}}function persist(card){saved[card.dataset.code]={decision:card.querySelector('.decision').value,correctedTagIds:card.querySelector('.corrected').value,note:card.querySelector('.note').value};localStorage.setItem(key,JSON.stringify(saved));update()}for(const card of cards){const s=state(card);card.querySelector('.decision').value=s.decision;card.querySelector('.corrected').value=s.correctedTagIds;card.querySelector('.note').value=s.note;for(const el of card.querySelectorAll('select,textarea'))el.addEventListener('input',()=>persist(card))}const search=document.querySelector('#search'),grade=document.querySelector('#grade'),phase=document.querySelector('#phase'),decisionFilter=document.querySelector('#decisionFilter');function update(){const q=search.value.trim().toLowerCase();let visible=0,reviewed=0;for(const card of cards){const decision=card.querySelector('.decision').value;if(decision)reviewed++;const matches=(!q||card.dataset.search.includes(q))&&(!grade.value||card.dataset.grade===grade.value)&&(!phase.value||card.dataset.phase===phase.value)&&(!decisionFilter.value||(decisionFilter.value==='pending'?!decision:decision===decisionFilter.value));card.hidden=!matches;if(matches)visible++}document.querySelector('#progress').textContent=reviewed+'/200 검토';document.querySelector('#empty').hidden=visible>0}for(const el of [search,grade,phase,decisionFilter])el.addEventListener('input',update);function results(){return seed.map(item=>({...item,...(saved[item.etfCode]||{decision:'',correctedTagIds:'',note:''}),reviewedAt:new Date().toISOString()}))}function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}document.querySelector('#exportJson').onclick=()=>download('etf-taxonomy-review-results.json',JSON.stringify({exportedAt:new Date().toISOString(),items:results()},null,2),'application/json');document.querySelector('#exportCsv').onclick=()=>{const esc=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[['sampleNumber','etfCode','name','currentTagIds','decision','correctedTagIds','note'].join(',')];for(const r of results())lines.push([r.sampleNumber,r.etfCode,r.name,r.currentTagIds.join('|'),r.decision,r.correctedTagIds,r.note].map(esc).join(','));download('etf-taxonomy-review-results.csv','\ufeff'+lines.join('\\n'),'text/csv')};update();</script></body></html>`;
}

function main() {
  const report = buildSample();
  write(OUTPUTS.json, JSON.stringify(report, null, 2) + '\n');
  writeCsv(report);
  write(OUTPUTS.html, renderHtml(report));
  console.log(`[taxonomy-review-sample] ${report.summary.sampleCount} ETFs, grades ${JSON.stringify(report.summary.gradeCounts)}`);
  console.log(`[taxonomy-review-sample] tag coverage ${report.summary.coveredTagCount}/${report.summary.taxonomyTagCount}, blocked ${report.summary.blockedTagCount}`);
  console.log(`[taxonomy-review-sample] phases ${JSON.stringify(report.summary.phaseCounts)}`);
  console.log(`[taxonomy-review-sample] → ${OUTPUTS.json}`);
  console.log(`[taxonomy-review-sample] → ${OUTPUTS.csv}`);
  console.log(`[taxonomy-review-sample] → ${OUTPUTS.html}`);
}

main();
