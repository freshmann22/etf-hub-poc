import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_FILE = path.join(ROOT, 'data/reports/etf-taxonomy-review-sample.json');
const TAXONOMY_FILE = path.join(ROOT, 'config/etf-tagging/etf-taxonomy.json');
const SCORE_FILE = path.join(ROOT, 'data/tagging/etf-tag-scores.json');
const OUT_DIR = path.join(ROOT, 'data/reports/claude-taxonomy-review');
const BATCH_DIR = path.join(OUT_DIR, 'batches');
const COMBINED_FILE = path.join(OUT_DIR, 'claude-taxonomy-blind-review.json');
const CSV_FILE = path.join(ROOT, 'reports/tagging/claude-taxonomy-review-comparison.csv');
const HTML_FILE = path.join(ROOT, 'reports/tagging/CLAUDE_TAXONOMY_REVIEW.html');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const item = args.find((arg) => arg.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : fallback;
};
const limit = Math.max(1, Number.parseInt(getArg('limit', '200'), 10));
const offset = Math.max(0, Number.parseInt(getArg('offset', '0'), 10));
const batchSize = Math.min(20, Math.max(1, Number.parseInt(getArg('batch-size', '10'), 10)));
const model = getArg('model', 'sonnet');
const force = args.includes('--force');
const skipReport = args.includes('--skip-report');
const timeoutMs = Math.max(60000, Number.parseInt(getArg('timeout-ms', '300000'), 10));

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
};
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const csv = (value) => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function claudeExecutable() {
  const appData = process.env.APPDATA;
  if (appData) {
    const exe = path.join(appData, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return 'claude';
}

function outputSchema() {
  return {
    type: 'object',
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            etfCode: { type: 'string' },
            selectedClassifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tagId: { type: 'string' },
                  score: { type: 'number', minimum: 0, maximum: 1 },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  evidence: { type: 'array', items: { type: 'string' } },
                },
                required: ['tagId', 'score', 'confidence', 'evidence'],
                additionalProperties: false,
              },
            },
            candidateTagIds: { type: 'array', items: { type: 'string' } },
            insufficientFacets: {
              type: 'array',
              items: { type: 'string', enum: ['assetClass', 'region', 'sector', 'strategy', 'dividend'] },
            },
            notes: { type: 'array', items: { type: 'string' } },
          },
          required: ['etfCode', 'selectedClassifications', 'candidateTagIds', 'insufficientFacets', 'notes'],
          additionalProperties: false,
        },
      },
    },
    required: ['reviews'],
    additionalProperties: false,
  };
}

function compactTaxonomy(taxonomy) {
  return {
    version: taxonomy.version,
    facets: taxonomy.facets,
    tags: taxonomy.tags.filter((tag) => tag.enabled).map((tag) => ({
      id: tag.id,
      facet: tag.facet,
      parent: tag.parent,
      label: tag.label,
      definition: tag.definition,
      positiveSignals: tag.positiveSignals,
      negativeSignals: tag.negativeSignals,
      minimumScore: tag.minimumScore,
      minimumConfidence: tag.minimumConfidence,
      impliesTags: tag.impliesTags || [],
    })),
  };
}

function blindItem(item) {
  return {
    etfCode: item.etfCode,
    name: item.name,
    evidence: item.evidence,
    knownMissingFields: item.readiness.missing,
  };
}

function promptFor(taxonomy, items) {
  return `당신은 ETF 택소노미 독립 심사자입니다. 아래 ETF들을 블라인드로 재분류하세요.

중요 원칙:
1. 현재 시스템이 부여한 태그는 제공되지 않았습니다. 독립적으로 판단하세요.
2. 입력 evidence에 없는 사실을 외부 지식이나 상품명 추측만으로 만들어내지 마세요.
3. taxonomy에 존재하는 tagId만 사용하세요.
4. 각 태그의 positiveSignals, negativeSignals, minimumScore, minimumConfidence를 지키세요.
5. selectedClassifications에는 score와 confidence가 해당 태그 최소 기준을 모두 넘는 것만 넣으세요.
6. 기준에 조금 못 미치지만 검토 가치가 있으면 candidateTagIds에 넣으세요.
7. 자산군과 지역의 최상위 태그는 각각 하나가 원칙입니다. 채권의 부모·세부 태그 동시 부여는 허용합니다.
8. 섹터, 전략, 배당은 복수 선택할 수 있습니다.
9. 어떤 facet을 판단할 직접 근거가 부족하면 insufficientFacets에 기록하세요. 단, 상품과 무관해 보이는 facet을 기계적으로 전부 부족 처리하지 마세요.
10. evidence에는 입력에서 실제로 확인한 짧은 근거만 적으세요.
11. 입력된 ETF ${items.length}개를 빠짐없이, 같은 etfCode로 한 번씩만 반환하세요.

TAXONOMY:
${JSON.stringify(taxonomy)}

ETF INPUTS:
${JSON.stringify(items)}
`;
}

function parseClaudeEnvelope(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  let envelope;
  for (let index = lines.length - 1; index >= 0; index--) {
    try { envelope = JSON.parse(lines[index]); break; } catch { /* continue */ }
  }
  if (!envelope) throw new Error('Claude JSON envelope를 파싱할 수 없습니다.');
  if (envelope.is_error || envelope.api_error_status) {
    throw new Error(`Claude API error ${envelope.api_error_status || ''}: ${envelope.result || envelope.terminal_reason || 'unknown'}`);
  }
  const result = envelope.structured_output || (typeof envelope.result === 'string' ? JSON.parse(envelope.result) : envelope.result);
  if (!result || !Array.isArray(result.reviews)) throw new Error('Claude structured_output.reviews가 없습니다.');
  return { envelope, result };
}

function validateBatch(result, expectedItems, validTagIds) {
  const expected = new Set(expectedItems.map((item) => item.etfCode));
  const returned = new Set(result.reviews.map((item) => item.etfCode));
  if (returned.size !== expected.size || [...expected].some((code) => !returned.has(code))) {
    throw new Error(`Claude 반환 ETF 코드 불일치: expected=${[...expected].join(',')} returned=${[...returned].join(',')}`);
  }
  for (const review of result.reviews) {
    const ids = [
      ...review.selectedClassifications.map((item) => item.tagId),
      ...review.candidateTagIds,
    ];
    const invalid = ids.filter((id) => !validTagIds.has(id));
    if (invalid.length) throw new Error(`${review.etfCode}: taxonomy에 없는 태그 ${invalid.join(', ')}`);
    if (new Set(review.selectedClassifications.map((item) => item.tagId)).size !== review.selectedClassifications.length) {
      throw new Error(`${review.etfCode}: selectedClassifications 태그 중복`);
    }
  }
}

function runBatch(batchNumber, taxonomy, items, validTagIds) {
  const batchFile = path.join(BATCH_DIR, `batch-${String(batchNumber).padStart(4, '0')}.json`);
  const blindItems = items.map(blindItem);
  const prompt = promptFor(taxonomy, blindItems);
  const promptHash = hash(prompt);
  if (!force && fs.existsSync(batchFile)) {
    const cached = read(batchFile);
    if (cached.promptHash === promptHash && cached.status === 'success') {
      validateBatch({ reviews: cached.reviews }, items, validTagIds);
      console.log(`[claude-review] batch ${batchNumber} cache hit (${items.length})`);
      return cached;
    }
  }

  const commandArgs = [
    '-p', '--tools', '', '--permission-mode', 'dontAsk', '--no-session-persistence',
    '--model', model, '--effort', 'high', '--output-format', 'json',
    '--json-schema', JSON.stringify(outputSchema()), prompt,
  ];
  console.log(`[claude-review] batch ${batchNumber} calling Claude (${items.length})...`);
  const startedAt = new Date().toISOString();
  const run = spawnSync(claudeExecutable(), commandArgs, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, shell: false, maxBuffer: 20 * 1024 * 1024 });
  if (run.error) throw new Error(`Claude 실행 실패: ${run.error.message}`);
  if (run.status !== 0) {
    let detail = run.stderr || run.stdout || `exit ${run.status}`;
    try { detail = JSON.parse(run.stdout).result || detail; } catch { /* keep raw */ }
    throw new Error(`Claude batch ${batchNumber} 실패: ${detail}`);
  }
  const { envelope, result } = parseClaudeEnvelope(run.stdout);
  validateBatch(result, items, validTagIds);
  const record = {
    batchNumber,
    status: 'success',
    startedAt,
    completedAt: new Date().toISOString(),
    modelRequested: model,
    modelUsage: envelope.modelUsage || {},
    durationMs: envelope.duration_ms || null,
    promptHash,
    inputEtfCodes: items.map((item) => item.etfCode),
    blindInput: blindItems,
    reviews: result.reviews,
  };
  writeJson(batchFile, record);
  console.log(`[claude-review] batch ${batchNumber} success`);
  return record;
}

function compare(sample, scores, reviews) {
  const sampleByCode = new Map(sample.items.map((item) => [item.etfCode, item]));
  return reviews.map((review) => {
    const sampleItem = sampleByCode.get(review.etfCode);
    const current = (scores.etfs[review.etfCode]?.classifications || []).map((item) => item.tagId).sort();
    const claude = review.selectedClassifications.map((item) => item.tagId).sort();
    const currentSet = new Set(current);
    const claudeSet = new Set(claude);
    const additions = claude.filter((id) => !currentSet.has(id));
    const removals = current.filter((id) => !claudeSet.has(id));
    return {
      etfCode: review.etfCode,
      name: sampleItem.name,
      sampleNumber: sampleItem.sampleNumber,
      readinessGrade: sampleItem.readiness.grade,
      currentTagIds: current,
      claudeTagIds: claude,
      additions,
      removals,
      exactMatch: additions.length === 0 && removals.length === 0,
      candidateTagIds: review.candidateTagIds,
      insufficientFacets: review.insufficientFacets,
      selectedClassifications: review.selectedClassifications,
      notes: review.notes,
    };
  }).sort((a, b) => a.sampleNumber - b.sampleNumber);
}

function analyzeComparisons(comparisons) {
  const tally = (values) => Object.entries(values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]).map(([tagId, count]) => ({ tagId, count }));
  const byGrade = ['A', 'B', 'C'].map((grade) => {
    const items = comparisons.filter((item) => item.readinessGrade === grade);
    const exactMatchCount = items.filter((item) => item.exactMatch).length;
    return { grade, reviewedCount: items.length, exactMatchCount, exactMatchRate: items.length ? exactMatchCount / items.length : 0 };
  });
  return {
    exactMatchRate: comparisons.length ? comparisons.filter((item) => item.exactMatch).length / comparisons.length : 0,
    byGrade,
    additionsByTag: tally(comparisons.flatMap((item) => item.additions)),
    removalsByTag: tally(comparisons.flatMap((item) => item.removals)),
    insufficientByFacet: tally(comparisons.flatMap((item) => item.insufficientFacets)).map(({ tagId: facet, count }) => ({ facet, count })),
    passiveIndexOnlyDisagreementCount: comparisons.filter((item) => item.additions.length === 0 && item.removals.length === 1 && item.removals[0] === 'strategy.passive_index').length,
  };
}

function renderHtml(report, tagById) {
  const label = (id) => tagById.get(id)?.label || id;
  const ranked = (items, key = 'tagId') => items.slice(0, 5).map((item) => `<li><span>${escapeHtml(label(item[key]))}</span><b>${item.count}건</b></li>`).join('');
  const dividendMissing = report.analysis.insufficientByFacet.find((item) => item.facet === 'dividend')?.count || 0;
  const rows = report.comparisons.map((item) => `<article class="card" data-status="${item.exactMatch ? 'match' : 'disagree'}" data-grade="${item.readinessGrade}" data-search="${escapeHtml(`${item.etfCode} ${item.name} ${item.currentTagIds.join(' ')} ${item.claudeTagIds.join(' ')}`.toLowerCase())}"><header><span>#${item.sampleNumber}</span><div><h3>${escapeHtml(item.name)}</h3><small>${escapeHtml(item.etfCode)} · 준비도 ${item.readinessGrade}</small></div><b class="${item.exactMatch ? 'ok' : 'warn'}">${item.exactMatch ? '완전 일치' : '검토 필요'}</b></header><div class="cols"><section><strong>현재 분류</strong><p>${item.currentTagIds.map((id) => `<i>${escapeHtml(label(id))}</i>`).join('') || '없음'}</p></section><section><strong>Claude 블라인드 분류</strong><p>${item.claudeTagIds.map((id) => `<i>${escapeHtml(label(id))}</i>`).join('') || '없음'}</p></section></div>${item.additions.length ? `<p class="delta add">추가 제안: ${item.additions.map(label).map(escapeHtml).join(', ')}</p>` : ''}${item.removals.length ? `<p class="delta remove">제외 제안: ${item.removals.map(label).map(escapeHtml).join(', ')}</p>` : ''}${item.insufficientFacets.length ? `<p class="delta insufficient">근거 부족: ${item.insufficientFacets.join(', ')}</p>` : ''}<details><summary>Claude 근거와 메모</summary>${item.selectedClassifications.map((tag) => `<p><b>${escapeHtml(label(tag.tagId))}</b> ${tag.score}/${tag.confidence} — ${escapeHtml(tag.evidence.join(' / '))}</p>`).join('')}${item.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}</details></article>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Claude ETF 택소노미 블라인드 리뷰</title><style>:root{--ink:#16231f;--muted:#66746f;--line:#dbe5e1;--paper:#f5f8f7;--mint:#00a98f;--red:#ba4155;--blue:#3478db}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font-family:Pretendard,"Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.55;word-break:keep-all}.wrap{width:min(1050px,calc(100% - 30px));margin:auto}.hero{padding:58px 0 35px;background:#142e28;color:#fff}h1{margin:0;font-size:clamp(34px,6vw,58px);letter-spacing:-.05em}.hero p{color:#c8dbd6}.metrics{display:flex;flex-wrap:wrap;gap:10px}.metric{padding:12px 16px;border-radius:12px;background:rgba(255,255,255,.1)}.metric b{font-size:24px}.insight-intro{margin:24px 0 12px;padding:18px 20px;border-left:5px solid var(--mint);border-radius:12px;background:#fff}.insight-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.insight-card{padding:18px;border:1px solid var(--line);border-radius:14px;background:#fff}.insight-card h2{margin:0 0 8px;font-size:18px}.insight-card p{color:var(--muted);font-size:14px}.insight-card ul{margin:0;padding:0;list-style:none}.insight-card li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #edf2f0;font-size:13px}.toolbar{position:sticky;top:0;z-index:3;display:flex;gap:8px;padding:12px 0;background:rgba(245,248,247,.96)}input,select{min-height:42px;padding:0 12px;border:1px solid #cad7d2;border-radius:9px;background:#fff;font:inherit}input{flex:1}.card{margin:14px 0;padding:20px;border:1px solid var(--line);border-radius:17px;background:#fff}.card header{display:grid;grid-template-columns:45px 1fr auto;gap:10px}.card h3{margin:0}.ok{color:var(--mint)}.warn{color:var(--red)}.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.cols section{padding:12px;border-radius:12px;background:#f1f5f3}.cols p{margin:6px 0}.cols i{display:inline-block;margin:2px;padding:3px 7px;border-radius:999px;background:#dff4ef;font-size:12px;font-style:normal}.delta{padding:9px 11px;border-radius:9px;font-size:13px}.add{background:#e8f2ff;color:#1759ac}.remove{background:#ffecef;color:#9a2e41}.insufficient{background:#fff3d9;color:#815300}details{font-size:13px}small{color:var(--muted)}@media(max-width:760px){.insight-grid{grid-template-columns:1fr}.cols{grid-template-columns:1fr}.card header{grid-template-columns:35px 1fr}.card header>b{grid-column:2}}</style></head><body><section class="hero"><div class="wrap"><small>독립 모델 1차 심사</small><h1>Claude 블라인드<br>택소노미 리뷰</h1><p>Claude에는 현재 태그를 숨기고 택소노미 정의와 ETF 근거만 제공했습니다.</p><div class="metrics"><div class="metric">검토 <b>${report.summary.reviewedCount}</b></div><div class="metric">완전 일치 <b>${report.summary.exactMatchCount}</b></div><div class="metric">검토 필요 <b>${report.summary.disagreementCount}</b></div><div class="metric">근거 부족 표시 <b>${report.summary.insufficientCount}</b></div></div></div></section><main class="wrap"><section class="insight-intro"><b>88개 이견은 오류 확정이 아니라 사람이 볼 우선순위 목록입니다.</b><br>반복 패턴을 먼저 정책과 데이터 문제로 정리한 다음, 남는 개별 사례만 사람이 확인하면 됩니다.</section><section class="insight-grid"><article class="insight-card"><h2>① 정책 기준부터 합의</h2><p><b>${report.analysis.passiveIndexOnlyDisagreementCount}개</b>는 passive_index 하나만 제외한 이견입니다. 레버리지·인버스 상품에도 패시브 태그를 붙일지 결정하면 한꺼번에 처리할 수 있습니다.</p><ul>${ranked(report.analysis.removalsByTag)}</ul></article><article class="insight-card"><h2>② 원천 데이터 보강</h2><p><b>${dividendMissing}개</b>에서 배당 facet의 직접 근거가 부족했습니다. 분배 주기·분배 이력 데이터를 붙이면 AI와 사람 모두 더 확실하게 판단할 수 있습니다.</p><ul>${ranked(report.analysis.insufficientByFacet, 'facet')}</ul></article><article class="insight-card"><h2>③ 추가 태그 후보</h2><p>Claude가 현재 분류에 없지만 근거가 있다고 본 태그입니다. 빈도가 높은 항목부터 규칙 누락 여부를 확인하세요.</p><ul>${ranked(report.analysis.additionsByTag)}</ul></article></section><div class="toolbar"><input id="q" type="search" placeholder="ETF·코드·태그 검색"><select id="status"><option value="">전체 결과</option><option value="match">완전 일치</option><option value="disagree">검토 필요</option></select><select id="grade"><option value="">모든 준비도</option><option>A</option><option>B</option><option>C</option></select></div><div id="cards">${rows}</div></main><script>const cards=[...document.querySelectorAll('.card')],q=document.querySelector('#q'),status=document.querySelector('#status'),grade=document.querySelector('#grade');function update(){const s=q.value.trim().toLowerCase();for(const c of cards)c.hidden=!!((s&&!c.dataset.search.includes(s))||(status.value&&c.dataset.status!==status.value)||(grade.value&&c.dataset.grade!==grade.value))}for(const el of[q,status,grade])el.addEventListener('input',update)</script></body></html>`;
}

function writeReports(sample, taxonomy, scores, batchRecords) {
  const reviews = batchRecords.flatMap((batch) => batch.reviews);
  const comparisons = compare(sample, scores, reviews);
  const analysis = analyzeComparisons(comparisons);
  const report = {
    generatedAt: new Date().toISOString(),
    reviewer: 'Claude Code',
    modelRequested: model,
    reviewMode: 'blind_evidence_only',
    taxonomyVersion: taxonomy.version,
    sampleGeneratedAt: sample.generatedAt,
    completedBatchCount: batchRecords.length,
    summary: {
      requestedLimit: Math.min(limit, sample.items.length),
      reviewedCount: comparisons.length,
      exactMatchCount: comparisons.filter((item) => item.exactMatch).length,
      disagreementCount: comparisons.filter((item) => !item.exactMatch).length,
      insufficientCount: comparisons.filter((item) => item.insufficientFacets.length > 0).length,
      additionCount: comparisons.reduce((sum, item) => sum + item.additions.length, 0),
      removalCount: comparisons.reduce((sum, item) => sum + item.removals.length, 0),
    },
    analysis,
    batches: batchRecords.map((batch) => ({ batchNumber: batch.batchNumber, completedAt: batch.completedAt, inputEtfCodes: batch.inputEtfCodes, modelUsage: batch.modelUsage })),
    comparisons,
  };
  writeJson(COMBINED_FILE, report);
  const headers = ['sampleNumber', 'etfCode', 'name', 'grade', 'exactMatch', 'currentTagIds', 'claudeTagIds', 'additions', 'removals', 'candidateTagIds', 'insufficientFacets', 'notes'];
  const lines = [headers.join(',')];
  for (const item of comparisons) lines.push([item.sampleNumber, item.etfCode, item.name, item.readinessGrade, item.exactMatch, item.currentTagIds, item.claudeTagIds, item.additions, item.removals, item.candidateTagIds, item.insufficientFacets, item.notes].map(csv).join(','));
  writeText(CSV_FILE, '\ufeff' + lines.join('\n') + '\n');
  const tagById = new Map(taxonomy.tags.map((tag) => [tag.id, tag]));
  writeText(HTML_FILE, renderHtml(report, tagById));
  return report;
}

function main() {
  if (!fs.existsSync(SAMPLE_FILE)) throw new Error('먼저 npm run review:taxonomy-sample 을 실행하세요.');
  const sample = read(SAMPLE_FILE);
  const taxonomy = read(TAXONOMY_FILE);
  const scores = read(SCORE_FILE);
  const compact = compactTaxonomy(taxonomy);
  const validTagIds = new Set(compact.tags.map((tag) => tag.id));
  const selected = sample.items.slice(offset, Math.min(offset + limit, sample.items.length));
  const batches = [];
  for (let localOffset = 0; localOffset < selected.length; localOffset += batchSize) {
    const items = selected.slice(localOffset, localOffset + batchSize);
    const batchNumber = Math.floor((offset + localOffset) / batchSize) + 1;
    batches.push(runBatch(batchNumber, compact, items, validTagIds));
    if (!skipReport) writeReports(sample, taxonomy, scores, batches);
  }
  if (skipReport) {
    console.log(`[claude-review] worker complete offset=${offset}, reviewed=${batches.flatMap((batch) => batch.reviews).length}`);
    return;
  }
  const report = writeReports(sample, taxonomy, scores, batches);
  console.log(`[claude-review] reviewed=${report.summary.reviewedCount}, exact=${report.summary.exactMatchCount}, disagree=${report.summary.disagreementCount}, insufficient=${report.summary.insufficientCount}`);
  console.log(`[claude-review] → ${path.relative(ROOT, COMBINED_FILE)}`);
  console.log(`[claude-review] → ${path.relative(ROOT, CSV_FILE)}`);
  console.log(`[claude-review] → ${path.relative(ROOT, HTML_FILE)}`);
}

try { main(); } catch (error) { console.error(`[claude-review] ${error.message}`); process.exitCode = 1; }
