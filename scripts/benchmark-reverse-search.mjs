// 역검색 속도 벤치마크 (Phase 4).
//   기본: dry-run (외부 호출 0). 규칙 planner + ranking 지연 + 프롬프트 크기 비교.
//   --execute: 실제 OpenRouter 호출로 model-only planner 지연을 모델별로 실측(사용자 승인 필요).
// 보안: API 키·환경변수를 절대 출력하지 않는다(Authorization 헤더에만 사용).
// 사용: node scripts/benchmark-reverse-search.mjs [--execute] [--models a,b,c] [--repeats N] [--max-calls M] [--out path]
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseQuery } from '../modules/reverse-search/src/nlu.js';
import { buildRuleQueryPlan, createTaxonomyIndex, validateQueryPlan } from '../modules/reverse-search/src/query-plan.js';
import { rankByQueryPlan } from '../modules/reverse-search/src/ranker.js';
import { buildSearchIndexMap } from '../modules/reverse-search/src/adapters.js';
import { config } from '../server/config.js';

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagVal = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXECUTE = hasFlag('--execute');
const REPEATS = parseInt(flagVal('--repeats', '3'), 10);
const MAX_CALLS = parseInt(flagVal('--max-calls', '120'), 10);
const OUT = flagVal('--out', 'data/reports/reverse-search-benchmark.json');
const CANDIDATE_MODELS = flagVal('--models', [config.llm.openrouter.model, 'openai/gpt-4o-mini', 'google/gemini-2.5-flash'].join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const j = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const taxonomy = j('config/etf-tagging/etf-taxonomy.json');
const taxonomyIndex = createTaxonomyIndex(taxonomy);
const fm = j('data/tagging/etf-filter-map.json');
const idxNames = j('data/tagging/etf-universe-index-names.json');
const searchIndex = buildSearchIndexMap(j('public/data/reverse-search-index.json'));
const master = {};
for (const it of idxNames.items || []) master[it.etfCode] = { code: it.etfCode, name: it.name, indexName: it.indexName };
const context = { tagUniverse: { etfs: fm.etfs }, searchIndex, master, marketSnapshot: [] };

const QUERIES = [
  '대만 기업에 투자하는 ETF 찾아줘',
  '미국 반도체 ETF',
  '월배당 주는 고배당 ETF',
  '반도체 중에서 거래량 많은 ETF',
  '대만 월배당 ETF',
  '북미 전기차 ETF',
  '삼성전자 비중 높은 ETF',
  '아틀란티스 ETF',
];

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: +mean.toFixed(3), p50: +pct(50).toFixed(3), p90: +pct(90).toFixed(3), p95: +pct(95).toFixed(3), max: +s[s.length - 1].toFixed(3) };
}
const fmt = (m) => `n=${m.n} mean=${m.mean} p50=${m.p50} p90=${m.p90} p95=${m.p95} max=${m.max}`;

// ---- prompt builders (client full 프롬프트 vs 압축 프롬프트) ----
const enabledTags = (taxonomy.tags || []).filter((t) => t.enabled !== false);
function fullPromptTags() { return enabledTags.map((t) => ({ id: t.id, facet: t.facet, label: t.label, definition: t.definition })); }
function compactPromptTags() { return enabledTags.map((t) => ({ id: t.id, label: t.label })); }
function systemPrompt(tags) {
  return [
    'You are a Korean ETF query planner.',
    'Convert the user query into JSON only. Never recommend or invent an ETF.',
    'Use only tag IDs from the supplied taxonomy.',
    'Schema: {"intent":"...","tags":[{"tagId":"...","queryScore":0..1,"mode":"required|preferred|excluded"}],"textConstraints":[{"value":"...","aliases":["..."],"mode":"required|preferred|excluded","fields":["officialName","benchmarkName","investmentObjective"]}],"sort":null|{"field":"volume|tradingValue|return1m|volatilityScore|totalFee","direction":"asc|desc","label":"..."}}.',
    'textConstraints capture meanings the taxonomy cannot (a country/region/product word that appears in the ETF name or benchmark).',
    `Taxonomy: ${JSON.stringify(tags)}`,
  ].join('\n');
}
const PROMPTS = {
  full: systemPrompt(fullPromptTags()),
  compact: systemPrompt(compactPromptTags()),
};

// ---- OpenRouter caller (키는 헤더에만; 실패/latency/usage 캡처) ----
let callCount = 0;
async function callOpenRouter(model, systemText, query, timeoutMs = 30000) {
  if (callCount >= MAX_CALLS) return { ok: false, skipped: true, reason: 'max-calls' };
  callCount += 1;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`${config.llm.openrouter.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${config.llm.openrouter.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model, temperature: 0.1, max_tokens: 800, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemText }, { role: 'user', content: query }],
      }),
    });
    const ms = performance.now() - t0;
    const text = await res.text();
    if (!res.ok) return { ok: false, ms, status: res.status, reason: text.slice(0, 120) };
    let payload; try { payload = JSON.parse(text); } catch { return { ok: false, ms, reason: 'parse' }; }
    const content = payload?.choices?.[0]?.message?.content;
    const usage = payload?.usage || null;
    let planOk = false;
    try { const p = JSON.parse(String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()); planOk = !!(p && (p.tags || p.textConstraints || p.sort || p.intent)); } catch { planOk = false; }
    return { ok: true, ms, usage, planOk };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, reason: (e && e.name === 'AbortError') ? 'timeout' : String(e && e.message || e).slice(0, 80) };
  } finally { clearTimeout(timer); }
}

const report = { generatedAtNote: 'timestamp injected by caller', execute: EXECUTE, maxCalls: MAX_CALLS, repeats: REPEATS, dryRun: {}, live: null, callCount: 0 };

// ================= DRY-RUN =================
console.log('== DRY-RUN (외부 호출 0) ==');
// warmup
for (let i = 0; i < 200; i++) { const p = validateQueryPlan(buildRuleQueryPlan(parseQuery(QUERIES[i % QUERIES.length], new Map())), taxonomyIndex).plan; rankByQueryPlan(context, p); }

const ITER = 300;
const rulesPlanSamples = []; const rankSamples = []; const perQuery = {};
for (const q of QUERIES) {
  const planT = []; const rankT = [];
  const plan = validateQueryPlan(buildRuleQueryPlan(parseQuery(q, new Map())), taxonomyIndex).plan;
  for (let i = 0; i < ITER; i++) {
    let t = performance.now();
    const p = validateQueryPlan(buildRuleQueryPlan(parseQuery(q, new Map())), taxonomyIndex).plan;
    planT.push(performance.now() - t); rulesPlanSamples.push(performance.now() - t);
    t = performance.now();
    rankByQueryPlan(context, p);
    const rt = performance.now() - t; rankT.push(rt); rankSamples.push(rt);
  }
  perQuery[q] = { plan: stats(planT), rank: stats(rankT), planTags: plan.tags.map((x) => x.tagId), textConstraints: plan.textConstraints.map((x) => x.value) };
}
report.dryRun = {
  rulesPlanner_ms: stats(rulesPlanSamples),
  ranking_ms: stats(rankSamples),
  perQuery,
  promptSize: {
    full_chars: PROMPTS.full.length, compact_chars: PROMPTS.compact.length,
    full_estTokens: Math.round(PROMPTS.full.length / 3.5), compact_estTokens: Math.round(PROMPTS.compact.length / 3.5),
    reductionPct: +(100 * (1 - PROMPTS.compact.length / PROMPTS.full.length)).toFixed(1),
  },
  universeSize: Object.keys(fm.etfs).length,
};
console.log('규칙 planner  :', fmt(report.dryRun.rulesPlanner_ms), 'ms');
console.log('ranking(전체) :', fmt(report.dryRun.ranking_ms), 'ms  (universe', report.dryRun.universeSize + '종)');
console.log('프롬프트 크기 : full', report.dryRun.promptSize.full_chars, 'chars vs compact', report.dryRun.promptSize.compact_chars, `chars (−${report.dryRun.promptSize.reductionPct}%)`);

// ================= LIVE =================
if (EXECUTE) {
  console.log('\n== LIVE (OpenRouter, 승인됨) ==  candidate models:', CANDIDATE_MODELS.join(', '));
  const models = [];
  for (const m of CANDIDATE_MODELS) {
    const probe = await callOpenRouter(m, PROMPTS.full, '반도체 ETF', 30000);
    if (probe.ok) { models.push(m); console.log(`  probe ${m}: OK (${Math.round(probe.ms)}ms, planOk=${probe.planOk})`); }
    else console.log(`  probe ${m}: SKIP (${probe.reason || probe.status})`);
  }
  const live = { models: {}, promptVariant: {}, note: `${models.length} model(s) live` };
  // 모델별 latency 매트릭스 (full 프롬프트)
  for (const m of models) {
    const samples = []; const usages = []; let planOkCount = 0; let calls = 0;
    for (const q of QUERIES) {
      for (let r = 0; r < REPEATS; r++) {
        const res = await callOpenRouter(m, PROMPTS.full, q, 30000);
        if (res.skipped) break;
        calls += 1;
        if (res.ok) { samples.push(res.ms); if (res.planOk) planOkCount += 1; if (res.usage) usages.push(res.usage); }
      }
    }
    const promptTok = usages.reduce((a, u) => a + (u.prompt_tokens || 0), 0);
    const compTok = usages.reduce((a, u) => a + (u.completion_tokens || 0), 0);
    live.models[m] = { latency_ms: samples.length ? stats(samples) : null, calls, planOkRate: calls ? +(planOkCount / calls).toFixed(2) : 0, avgPromptTokens: usages.length ? Math.round(promptTok / usages.length) : null, avgCompletionTokens: usages.length ? Math.round(compTok / usages.length) : null };
    console.log(`  ${m}: ${live.models[m].latency_ms ? fmt(live.models[m].latency_ms) : 'no data'} ms | planOk ${(live.models[m].planOkRate * 100).toFixed(0)}% | tok ~${live.models[m].avgPromptTokens}p/${live.models[m].avgCompletionTokens}c`);
  }
  // 프롬프트 variant 비교 (첫 모델, full vs compact)
  if (models.length) {
    const m0 = models[0];
    for (const variant of ['full', 'compact']) {
      const samples = []; const ptok = [];
      for (const q of QUERIES) {
        const res = await callOpenRouter(m0, PROMPTS[variant], q, 30000);
        if (res.skipped) break;
        if (res.ok) { samples.push(res.ms); if (res.usage) ptok.push(res.usage.prompt_tokens || 0); }
      }
      live.promptVariant[variant] = { model: m0, latency_ms: samples.length ? stats(samples) : null, avgPromptTokens: ptok.length ? Math.round(ptok.reduce((a, b) => a + b, 0) / ptok.length) : null };
    }
    const f = live.promptVariant.full, c = live.promptVariant.compact;
    if (f?.latency_ms && c?.latency_ms) console.log(`  프롬프트 variant(${m0}): full p50 ${f.latency_ms.p50}ms/${f.avgPromptTokens}tok  vs  compact p50 ${c.latency_ms.p50}ms/${c.avgPromptTokens}tok`);
  }
  report.live = live;
}

report.callCount = callCount;
console.log(`\n총 외부 호출: ${callCount}건 (상한 ${MAX_CALLS})`);
writeFileSync(ROOT + OUT, JSON.stringify(report, null, 2) + '\n');
console.log('결과 저장:', OUT);
