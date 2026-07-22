import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = {
  sample: 'data/reports/etf-taxonomy-review-sample-v2.json',
  taxonomy: 'config/etf-tagging/etf-taxonomy.json',
  json: 'data/reports/etf-taxonomy-human-shortlist-v2.json',
  csv: 'reports/tagging/etf-taxonomy-human-shortlist-v2.csv',
  html: 'reports/tagging/ETF_TAXONOMY_HUMAN_SHORTLIST_V2.html',
};
const TARGET = 24;
const VERSION = '2.0.0';

const AUDIT_SEEDS = [
  ['0104P0', 'critical_rule_error', 100, '국내 배당 ETF에 미국 지역 태그가 붙은 규칙 오탐 가능성', 'region.us 제거 및 국내 노출 여부 확인'],
  ['0052D0', 'critical_rule_error', 99, '국내 배당 ETF에 미국 지역 태그가 붙은 규칙 오탐 가능성', 'region.us 제거 및 국내 노출 여부 확인'],
  ['489000', 'evidence_gap', 94, '일본 엔화·초단기 국채 분류를 검증할 보유종목 근거가 부족함', '현재 분류를 잠정 유지하되 근거 부족이면 insufficient'],
  ['375270', 'evidence_gap', 93, '글로벌 데이터센터 리츠의 국가·보유종목 근거가 부족함', '리츠·선진국 분류를 잠정 유지하되 insufficient 검토'],
  ['364960', 'multi_sector_boundary', 91, '배터리·바이오·게임을 동시에 허용할 기준을 대표하는 사례', '보유종목이 세 영역을 지지하므로 복수 태그 유지 검토'],
  ['0192T0', 'multi_sector_boundary', 90, '광범위 TOP10 지수에 세부 섹터 태그를 붙이는 임계값 사례', '바이오·배터리·반도체 태그의 편입비중 기준 확인'],
  ['0152E0', 'confidence_check', 87, '배당성향과 금융주 근거가 모두 있는 양성 대조 사례', '고배당·금융 태그 유지 및 신뢰도 상향 검토'],
  ['387280', 'rare_tag', 96, '표본 내 희소한 자율주행·미래 모빌리티 태그 검증 사례', '자율주행과 전기차·배터리 태그 병존 검토'],
  ['266550', 'rare_tag', 95, '저변동성 태그의 대표적인 명시형 상품', '저변동성 태그 유지 및 신뢰도 상향 검토'],
  ['234310', 'rare_tag', 89, '가치주 태그의 희소한 검증 사례', '지수 방법론 확인 후 가치주 태그 유지 검토'],
  ['376410', 'definition_boundary', 88, '탄소효율 ESG와 클린에너지를 구분해야 하는 사례', 'ESG는 유지하되 클린에너지는 추가하지 않음'],
  ['487130', 'definition_boundary', 86, 'AI 인프라 테마에서 운용목표와 실제 보유종목을 구분하는 사례', '반도체는 유지, AI 전력은 비중 기준 확인'],
  ['469070', 'rare_tag', 85, '로봇 태그의 명시적 양성 사례', '로봇 태그 유지 및 신뢰도 상향 검토'],
  ['157490', 'multi_sector_boundary', 84, '소프트웨어 ETF에 게임·미디어까지 허용할지 판단하는 사례', 'IT는 유지, 게임·미디어는 편입비중 기준 확인'],
  ['227550', 'definition_boundary', 83, '산업재와 방산·운송 태그의 경계를 확인하는 사례', '방산은 근거 확인, 운송은 대리 태그로 추가하지 않음'],
  ['490090', 'lineage_error', 98, '493810과 같은 PDF·해시·접수번호를 공유해 월분배 정보가 잘못 전이된 정황', 'monthly 근거를 보류하고 DART 첨부문서 연결 관계를 우선 수정'],
  ['458730', 'lineage_error', 97, '비커버드콜 상품에 커버드콜 상품 설명 PDF가 연결된 것으로 의심됨', 'monthly 근거를 보류하고 DART 첨부문서 연결 관계를 우선 수정'],
  ['493810', 'post_dart_boundary', 92, '월분배 공시가 정합하지만 490090에 동일 PDF가 공유된 계보 감사 기준점', 'monthly는 유지 검토하되 490090과 문서 계보를 분리'],
  ['458750', 'post_dart_boundary', 82, '월분배 구조화 문구와 상품 특성이 정합한 DART 양성 사례', 'monthly·커버드콜 근거 유지; 쌍둥이 상품 458760은 별도 중복 검토 생략'],
  ['474220', 'post_dart_boundary', 80, '월분배 구조화 문구가 상품명과 정합한 DART 양성 사례', 'monthly·커버드콜 근거 유지 검토'],
];

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const hashFile = (rel) => createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
const hashValue = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const write = (rel, value) => {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value, 'utf8');
};
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const csv = (value) => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function buildShortlist() {
  const sample = read(FILES.sample);
  const taxonomy = read(FILES.taxonomy);
  const byCode = new Map(sample.items.map((item) => [item.etfCode, item]));
  const tagIds = new Set(taxonomy.tags.map((tag) => tag.id));
  const selected = [];

  for (const [code, tier, priorityScore, reason, recommendation] of AUDIT_SEEDS) {
    const source = byCode.get(code);
    if (!source) throw new Error(`감사 시드가 부모 표본에 없습니다: ${code}`);
    selected.push({ source, tier, priorityScore, reasons: [reason], aiRecommendation: recommendation, selectionSignals: ['expert_rule_audit'] });
  }

  const fallback = sample.items
    .filter((item) => !selected.some((entry) => entry.source.etfCode === item.etfCode))
    .map((item) => ({
      source: item,
      severity: (item.lowConfidenceAssignments?.length || 0) * 20
        + (item.currentClassifications?.filter((tag) => Number(tag.confidence) < 0.7).length || 0) * 8
        + (item.readiness.grade === 'B' ? 3 : 0),
    }))
    .sort((a, b) => b.severity - a.severity || a.source.etfCode.localeCompare(b.source.etfCode));
  for (const entry of fallback) {
    if (selected.length >= TARGET) break;
    selected.push({
      source: entry.source,
      tier: 'low_confidence_fallback',
      priorityScore: 70 - selected.length,
      reasons: [`낮은 신뢰도 또는 경계 태그 ${entry.source.lowConfidenceAssignments?.length || 0}건을 추가 점검`],
      aiRecommendation: '현재 태그와 보유종목·기초지수 근거의 일치 여부 확인',
      selectionSignals: ['deterministic_low_confidence_rank'],
    });
  }
  if (selected.length !== TARGET) throw new Error(`shortlist ${TARGET}개를 만들지 못했습니다: ${selected.length}`);

  const items = selected.sort((a, b) => b.priorityScore - a.priorityScore || a.source.etfCode.localeCompare(b.source.etfCode)).map((entry, index) => {
    const item = entry.source;
    for (const tag of item.currentClassifications) if (!tagIds.has(tag.tagId)) throw new Error(`알 수 없는 태그: ${tag.tagId}`);
    const snapshot = {
      parentSampleNumber: item.sampleNumber,
      etfCode: item.etfCode,
      name: item.name,
      readiness: item.readiness,
      classifications: item.currentClassifications,
      evidence: item.evidence,
    };
    return {
      shortlistNumber: index + 1,
      parentSampleNumber: item.sampleNumber,
      etfCode: item.etfCode,
      name: item.name,
      priority: { score: entry.priorityScore, tier: entry.tier },
      reasons: entry.reasons,
      selectionSignals: entry.selectionSignals,
      aiRecommendation: entry.aiRecommendation,
      readiness: item.readiness,
      currentClassifications: item.currentClassifications,
      lowConfidenceAssignments: item.lowConfidenceAssignments,
      evidence: item.evidence,
      contextHash: hashValue(snapshot),
      review: { workflowStatus: 'pending', decision: '', finalTagIds: [], note: '', missingEvidence: '', nextAction: '', reviewer: '', reviewedAt: '', reviewedAgainstHash: '' },
    };
  });
  const tierCounts = Object.fromEntries([...new Set(items.map((item) => item.priority.tier))].map((tier) => [tier, items.filter((item) => item.priority.tier === tier).length]));

  return {
    schemaVersion: 'etf-taxonomy-human-shortlist-v2',
    artifactId: 'taxonomy-human-shortlist-v2',
    shortlistVersion: VERSION,
    generatedAt: new Date().toISOString(),
    targetCount: TARGET,
    purpose: 'AI가 위험·경계 사례를 선별해 사람의 최종 검토량을 200개에서 24개로 줄이는 검토 자료',
    parentSample: { path: FILES.sample, contentHash: hashFile(FILES.sample), generatedAt: sample.generatedAt, selectionVersion: sample.selectionVersion },
    taxonomySnapshot: { path: FILES.taxonomy, contentHash: hashFile(FILES.taxonomy), tagCount: taxonomy.tags.length },
    allowedTagIds: taxonomy.tags.map((tag) => tag.id),
    policy: [
      'AI 권고는 태그를 자동 변경하지 않으며 최종 판단은 사람이 기록한다.',
      '명백한 규칙 오탐, 희소 태그, 정의 경계, 근거 부족, DART 반영 경계를 우선한다.',
      '현재 200개 부모 표본에 없는 태그는 억지로 포함하지 않고 데이터 보강 대기열로 분리한다.',
    ],
    summary: { shortlistCount: items.length, parentCount: sample.items.length, reductionPercent: 88, tierCounts, deferredEnrichmentCount: sample.blockedTags.length },
    sampleDiversityAudit: {
      finding: 'DART frequency 반영으로 미국·커버드콜 표본이 늘고 저변동성·중국·채권·헬스케어 다양성이 감소함',
      enteredCurrentSample: ['458750', '458760', '474220', '493810', '458730', '490090'],
      displacedFromPreviousSample: ['143860', '157450', '157500', '174350', '203780', '204480'],
      recommendedRestorationCandidates: ['174350', '204480', '157450', '143860', '203780'],
      note: '이 항목들은 현재 부모 표본의 부분집합이 아니므로 shortlist에 섞지 않고 다음 표본 재구성 후보로 기록함',
    },
    deferredEnrichment: sample.blockedTags.map((tag) => ({ ...tag, nextAction: '분류 판단 전 공식 보유종목·국가·지수 방법론 근거 보강' })),
    items,
  };
}

function writeCsv(report) {
  const headers = ['shortlistNumber', 'parentSampleNumber', 'priority', 'tier', 'etfCode', 'name', 'grade', 'readinessScore', 'reason', 'aiRecommendation', 'currentTagIds', 'issuer', 'benchmarkName', 'topHoldings', 'decision', 'finalTagIds', 'note', 'missingEvidence', 'nextAction', 'reviewer', 'reviewedAt'];
  const rows = report.items.map((item) => [item.shortlistNumber, item.parentSampleNumber, item.priority.score, item.priority.tier, item.etfCode, item.name, item.readiness.grade, item.readiness.score, item.reasons, item.aiRecommendation, item.currentClassifications.map((tag) => tag.tagId), item.evidence.issuer, item.evidence.benchmarkName, item.evidence.holdings.slice(0, 5).map((holding) => `${holding.name}${holding.weight == null ? '' : ` ${holding.weight}%`}`), '', '', '', '', '', '', '']);
  write(FILES.csv, '\ufeff' + [headers, ...rows].map((row) => row.map(csv).join(',')).join('\n') + '\n');
}

export function renderHtml(report) {
  const embedded = JSON.stringify(report).replaceAll('<', '\\u003c');
  const cards = report.items.map((item) => `<article class="card" data-code="${esc(item.etfCode)}" data-tier="${esc(item.priority.tier)}" data-search="${esc(`${item.etfCode} ${item.name} ${item.evidence.issuer || ''} ${item.currentClassifications.map((tag) => tag.label).join(' ')}`.toLowerCase())}">
    <header><span class="num">${item.shortlistNumber}</span><div><h2>${esc(item.name)}</h2><small>${esc(item.etfCode)} · 부모 표본 #${item.parentSampleNumber} · ${esc(item.evidence.issuer || '운용사 미상')}</small></div><b class="score">${item.priority.score}</b></header>
    <div class="callout"><b>왜 봐야 하나</b> ${esc(item.reasons.join(' / '))}<br><b>AI 권고</b> ${esc(item.aiRecommendation)}</div>
    <div class="grid"><section><h3>현재 태그</h3>${item.currentClassifications.map((tag) => `<span class="tag" title="${esc(`${tag.tagId} / confidence ${tag.confidence}`)}">${esc(tag.label)}</span>`).join('') || '<span class="muted">없음</span>'}</section><section><h3>근거</h3><p>기초지수: ${esc(item.evidence.benchmarkName || '없음')}</p><p>상위 종목: ${esc(item.evidence.holdings.slice(0, 5).map((h) => h.name).join(', ') || '없음')}</p><p>준비도: ${item.readiness.grade} ${item.readiness.score}점</p></section></div>
    <div class="review"><label>판정<select class="decision"><option value="">미검토</option><option value="correct">맞음</option><option value="incorrect">수정 필요</option><option value="insufficient">근거 부족</option></select></label><label>최종 태그 ID<textarea class="finalTags" placeholder="쉼표로 구분"></textarea></label><label>판정 메모<textarea class="note"></textarea></label><label>부족한 근거<textarea class="missingEvidence"></textarea></label><label>다음 조치<textarea class="nextAction"></textarea></label></div>
  </article>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ETF Taxonomy 사람 검토 24선</title><style>
  :root{--ink:#17231f;--green:#0b6556;--mint:#e6f5f0;--line:#d6e2de;--paper:#f4f7f6}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Pretendard,"Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.55}.wrap{width:min(1080px,calc(100% - 30px));margin:auto}.hero{padding:48px 0 30px;background:#123f36;color:white}.hero h1{margin:6px 0;font-size:clamp(34px,5vw,58px)}.metrics{display:flex;gap:10px;flex-wrap:wrap}.metric{padding:10px 15px;border:1px solid #ffffff42;border-radius:12px}.metric b{font-size:22px}.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;flex-wrap:wrap;padding:12px 0;background:#f4f7f6f2}.toolbar input,.toolbar select,.toolbar button,.review select,.review textarea{border:1px solid #bbc9c4;border-radius:8px;background:white;font:inherit}.toolbar input,.toolbar select,.toolbar button{height:40px;padding:0 10px}.toolbar input[type=search]{flex:1;min-width:190px}.toolbar button{cursor:pointer;font-weight:700}.primary{background:#123f36!important;color:white}.card{margin:0 0 15px;padding:20px;background:white;border:1px solid var(--line);border-radius:16px}.card header{display:grid;grid-template-columns:36px 1fr auto;gap:12px}.num{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--mint);color:var(--green);font-weight:900}.score{font-size:22px;color:var(--green)}h2{margin:0;font-size:20px}small,.muted{color:#66736f}.callout{margin:14px 0;padding:11px 13px;background:#f0f6f4;border-radius:10px}.callout b{color:var(--green)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid section{padding:12px;border:1px solid #e8eeec;border-radius:10px}.grid h3{margin:0 0 7px;font-size:13px}.grid p{margin:4px 0;font-size:13px}.tag{display:inline-block;margin:3px;padding:4px 8px;background:var(--mint);color:#095a4d;border-radius:999px;font-size:12px}.review{display:grid;grid-template-columns:.7fr 1fr 1fr;gap:9px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}.review label{font-size:12px;font-weight:700}.review select,.review textarea{display:block;width:100%;margin-top:4px;padding:7px;min-height:38px}.review textarea{height:62px;resize:vertical}.status{font-weight:800}.danger{color:#a6273c}@media(max-width:720px){.grid,.review{grid-template-columns:1fr}}@media print{body{background:white}.hero{padding:18mm 12mm}.toolbar{display:none}.wrap{width:auto}.card{break-inside:avoid;box-shadow:none;margin:0 0 6mm}.review textarea{height:16mm}.card:nth-of-type(4n+1){break-before:page}}
  </style></head><body><section class="hero"><div class="wrap"><small>AI 사전 검토 결과 · 최종 판단은 사람</small><h1>200개 대신 24개만 확인하세요</h1><p>명백한 오탐, 기준이 애매한 사례, 희소 태그, DART 반영 경계를 우선순위로 압축했습니다.</p><div class="metrics"><span class="metric">검토량 <b>${report.summary.parentCount} → ${report.summary.shortlistCount}</b></span><span class="metric">감소 <b>${report.summary.reductionPercent}%</b></span><span class="metric">보강 대기 <b>${report.summary.deferredEnrichmentCount}</b></span></div></div></section>
  <main class="wrap"><div class="toolbar"><input id="reviewer" placeholder="검토자 이름"><input id="search" type="search" placeholder="ETF·코드·태그 검색"><select id="filter"><option value="">전체 상태</option><option value="pending">미검토</option><option value="correct">맞음</option><option value="incorrect">수정 필요</option><option value="insufficient">근거 부족</option></select><span id="progress" class="status">0/${report.items.length}</span><button id="importBtn">JSON 불러오기</button><input id="importFile" type="file" accept="application/json" hidden><button id="exportBtn" class="primary">JSON 저장</button><button id="csvBtn">CSV 저장</button><button id="printBtn">인쇄</button><button id="resetBtn" class="danger">초기화</button></div><div id="cards">${cards}</div></main>
  <script>const artifact=${embedded};const key='taxonomy-shortlist:'+artifact.shortlistVersion+':'+artifact.parentSample.contentHash;const cards=[...document.querySelectorAll('.card')];const reviewer=document.querySelector('#reviewer');let saved={reviewer:'',items:{}};try{const raw=localStorage.getItem(key);if(raw)saved=JSON.parse(raw)}catch(e){console.warn('저장 상태를 읽지 못했습니다',e)}reviewer.value=saved.reviewer||'';function blank(){return{workflowStatus:'pending',decision:'',finalTagIds:[],note:'',missingEvidence:'',nextAction:'',reviewer:'',reviewedAt:'',reviewedAgainstHash:''}}function readCard(card){const decision=card.querySelector('.decision').value;const source=artifact.items.find(x=>x.etfCode===card.dataset.code);let finalTagIds=card.querySelector('.finalTags').value.split(',').map(x=>x.trim()).filter(Boolean);if(decision==='correct')finalTagIds=source.currentClassifications.map(x=>x.tagId);return{workflowStatus:decision?'reviewed':'pending',decision,finalTagIds,note:card.querySelector('.note').value.trim(),missingEvidence:card.querySelector('.missingEvidence').value.trim(),nextAction:card.querySelector('.nextAction').value.trim(),reviewer:decision?reviewer.value.trim():'',reviewedAt:decision?(saved.items[card.dataset.code]?.reviewedAt||new Date().toISOString()):'',reviewedAgainstHash:decision?source.contextHash:''}}function save(){saved.reviewer=reviewer.value;saved.items={};for(const card of cards)saved.items[card.dataset.code]=readCard(card);try{localStorage.setItem(key,JSON.stringify(saved))}catch(e){alert('브라우저 저장에 실패했습니다. JSON으로 내보내세요.')}update()}function apply(){for(const card of cards){const s=saved.items?.[card.dataset.code]||blank();card.querySelector('.decision').value=s.decision||'';card.querySelector('.finalTags').value=(s.finalTagIds||[]).join(', ');card.querySelector('.note').value=s.note||'';card.querySelector('.missingEvidence').value=s.missingEvidence||'';card.querySelector('.nextAction').value=s.nextAction||''}}function validate(items){const valid=new Set(artifact.allowedTagIds);for(const item of items){if(item.decision==='incorrect'&&(!item.finalTagIds.length||!item.note))throw Error(item.etfCode+': 수정 필요는 최종 태그와 메모가 필요합니다.');if(item.decision==='insufficient'&&(!item.missingEvidence||!item.nextAction))throw Error(item.etfCode+': 근거 부족은 부족한 근거와 다음 조치가 필요합니다.');for(const id of item.finalTagIds)if(!valid.has(id))throw Error(item.etfCode+': 알 수 없는 태그 '+id)}}function results(){const items=artifact.items.map(x=>({...x,review:readCard(cards.find(c=>c.dataset.code===x.etfCode))}));validate(items.map(x=>({etfCode:x.etfCode,...x.review})));return{...artifact,exportedAt:new Date().toISOString(),reviewer:reviewer.value.trim(),items}}function update(){const q=document.querySelector('#search').value.trim().toLowerCase(),f=document.querySelector('#filter').value;let done=0;for(const card of cards){const d=card.querySelector('.decision').value;if(d)done++;card.hidden=!( (!q||card.dataset.search.includes(q)) && (!f||(f==='pending'?!d:d===f)) )}document.querySelector('#progress').textContent=done+'/'+cards.length}function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}for(const el of document.querySelectorAll('.review select,.review textarea'))el.addEventListener('change',save);reviewer.addEventListener('change',save);document.querySelector('#search').addEventListener('input',update);document.querySelector('#filter').addEventListener('change',update);document.querySelector('#exportBtn').onclick=()=>{try{download('etf-taxonomy-human-shortlist-results-v2.json',JSON.stringify(results(),null,2),'application/json')}catch(e){alert(e.message)}};document.querySelector('#csvBtn').onclick=()=>{try{const r=results();const E=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[['etfCode','name','decision','finalTagIds','note','missingEvidence','nextAction','reviewer','reviewedAt'].join(',')];for(const x of r.items)lines.push([x.etfCode,x.name,x.review.decision,x.review.finalTagIds.join('|'),x.review.note,x.review.missingEvidence,x.review.nextAction,x.review.reviewer,x.review.reviewedAt].map(E).join(','));download('etf-taxonomy-human-shortlist-results-v2.csv','\\ufeff'+lines.join('\\n'),'text/csv')}catch(e){alert(e.message)}};document.querySelector('#importBtn').onclick=()=>document.querySelector('#importFile').click();document.querySelector('#importFile').onchange=async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(data.parentSample?.contentHash!==artifact.parentSample.contentHash)throw Error('부모 표본 해시가 다른 파일입니다.');const allowed=new Set(artifact.items.map(x=>x.etfCode));if(!Array.isArray(data.items)||data.items.some(x=>!allowed.has(x.etfCode)))throw Error('항목 구성이 다른 파일입니다.');saved={reviewer:data.reviewer||'',items:Object.fromEntries(data.items.map(x=>[x.etfCode,x.review||blank()]))};reviewer.value=saved.reviewer;apply();save();alert('검토 결과를 불러왔습니다.')}catch(err){alert('불러오기 실패: '+err.message)}};document.querySelector('#resetBtn').onclick=()=>{if(confirm('이 브라우저에 저장된 검토 결과를 모두 지울까요?')){localStorage.removeItem(key);saved={reviewer:'',items:{}};reviewer.value='';apply();update()}};document.querySelector('#printBtn').onclick=()=>window.print();apply();update();</script></body></html>`;
}

export function main() {
  const report = buildShortlist();
  write(FILES.json, JSON.stringify(report, null, 2) + '\n');
  writeCsv(report);
  write(FILES.html, renderHtml(report));
  console.log(`[taxonomy-shortlist] ${report.summary.parentCount} -> ${report.summary.shortlistCount} (${report.summary.reductionPercent}% reduction)`);
  console.log(`[taxonomy-shortlist] outputs: ${FILES.json}, ${FILES.csv}, ${FILES.html}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
