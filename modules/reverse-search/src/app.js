import { loadReverseSearchContext } from './adapters.js';
import { parseQuery } from './nlu.js';
import { summarizeDroppedConditions } from './query-plan.js';
import { rankByStockWeight, rankByTag, rankBySortField, rankComposite, rankByQueryPlan } from './ranker.js';

const els = {
  form: document.getElementById('searchForm'),
  input: document.getElementById('queryInput'),
  status: document.getElementById('statusBanner'),
  list: document.getElementById('resultList'),
  empty: document.getElementById('emptyState'),
  plan: document.getElementById('queryPlan'),
  planTags: document.getElementById('queryPlanTags'),
  planSource: document.getElementById('queryPlanSource'),
};

let context = null;

function renderStatus(message) {
  els.status.textContent = message || '';
  els.status.hidden = !message;
}

function renderResults(result) {
  els.list.innerHTML = '';
  els.empty.hidden = true;
  renderStatus(result.note);

  if (!result.items || result.items.length === 0) {
    els.empty.hidden = false;
    return;
  }
  for (const item of result.items) {
    const li = document.createElement('li');
    li.className = 'result-item';
    li.innerHTML = `
      <div class="result-name">${escapeHtml(item.name)}</div>
      <div class="result-code">${escapeHtml(item.code)}</div>
      <div class="result-evidence">${escapeHtml(item.evidence)}</div>
    `;
    els.list.appendChild(li);
  }
}

const TEXT_MODE_LABELS = { required: '필수', preferred: '선호', excluded: '제외' };

function renderQueryPlan(plan, source) {
  els.planTags.innerHTML = '';
  const tags = plan?.tags || [];
  const textConstraints = plan?.textConstraints || [];
  els.plan.hidden = tags.length === 0 && textConstraints.length === 0;
  if (els.plan.hidden) return;
  els.planSource.textContent = source === 'llm' ? 'LLM 해석' : '규칙 해석';
  for (const tag of tags) {
    const item = document.createElement('span');
    item.className = 'query-tag';
    const label = document.createElement('span');
    label.textContent = tag.label;
    const score = document.createElement('span');
    score.className = 'query-tag-score';
    score.textContent = `${Math.round(tag.queryScore * 100)}점`;
    item.append(label, score);
    els.planTags.appendChild(item);
  }
  // 텍스트 조건은 태그와 구분되는 칩으로 표시(확정 태그 vs 텍스트 근거 구분).
  for (const constraint of textConstraints) {
    const item = document.createElement('span');
    item.className = 'query-tag query-tag-text';
    const label = document.createElement('span');
    label.textContent = `"${constraint.value}"`;
    const meta = document.createElement('span');
    meta.className = 'query-tag-score';
    meta.textContent = `텍스트·${TEXT_MODE_LABELS[constraint.mode] || constraint.mode}`;
    item.append(label, meta);
    els.planTags.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function runSearch(rawQuery) {
  if (!context) {
    renderStatus('데이터를 아직 불러오는 중이에요');
    return;
  }
  const parsed = parseQuery(rawQuery, context.stockNameIndex);
  if (parsed.intent === 'EMPTY') {
    els.list.innerHTML = '';
    els.empty.hidden = false;
    els.plan.hidden = true;
    renderStatus('');
    return;
  }

  let result;
  if (parsed.intent !== 'STOCK_WEIGHT') {
    try {
      renderStatus('질문의 맥락을 해석하고 있어요');
      const planned = await requestQueryPlan(rawQuery);
      renderQueryPlan(planned.plan, planned.source);
      const dropped = summarizeDroppedConditions(planned.warnings);
      if (planned.plan.tags.length || planned.plan.textConstraints?.length || planned.plan.sort) {
        result = rankByQueryPlan(context, planned.plan);
        // 이해했지만 지원하지 못해 버린 조건이 있으면 조용히 넘기지 않고 덧붙인다.
        if (dropped) result = { ...result, note: `${result.note} · 제외한 조건: ${dropped}` };
        renderResults(result);
        return;
      }
      // plan 이 비었는데 버려진 조건이 있으면(예: LLM 이 낸 미등록 태그) 그 사실을 명시한다.
      if (dropped) {
        renderResults({ status: 'empty', items: [], note: `요청하신 조건 중 지원하지 않는 항목이 있어 결과를 만들지 못했어요: ${dropped}` });
        return;
      }
    } catch {
      renderQueryPlan(null, null);
    }
  }

  switch (parsed.intent) {
    case 'STOCK_WEIGHT':
      result = rankByStockWeight(context, parsed.stockCode, parsed.stockName);
      break;
    case 'TAG_MATCH':
      result = rankByTag(context, parsed.tagGroups);
      break;
    case 'TEXT_MATCH':
      // 서버 plan 을 못 받은 오프라인 복원 경로 — 로컬 파싱 결과로 질의 plan 을 구성해 텍스트 검색.
      result = rankByQueryPlan(context, {
        tags: [],
        textConstraints: parsed.textConstraints || [],
        sort: parsed.sortField ? { field: parsed.sortField, direction: parsed.sortDir, label: parsed.sortLabel } : null,
      });
      break;
    case 'MARKET_SORT':
      result = rankBySortField(context, context.marketSnapshot, parsed.sortField, parsed.sortDir, parsed.sortLabel);
      break;
    case 'COMPOSITE':
      result = rankComposite(context, context.marketSnapshot, parsed.tagGroups, parsed.sortField, parsed.sortDir, parsed.sortLabel);
      break;
    default:
      // 이해하지 못한 질의 — 거래대금 목록을 검색 결과처럼 위장하지 않고 정직하게 빈 상태로 안내한다.
      result = { status: 'empty', items: [], note: '질문을 이해하지 못했어요. ETF 이름·기초지수에 들어가는 단어나 태그(예: 반도체, 미국, 월배당, 대만)로 다시 검색해 주세요' };
  }
  renderResults(result);
}

async function requestQueryPlan(query) {
  const response = await fetch('/api/reverse-search/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`query plan ${response.status}`);
  return response.json();
}

async function init() {
  renderStatus('ETF 데이터를 불러오는 중이에요');
  context = await loadReverseSearchContext();
  renderStatus('');
  els.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await runSearch(els.input.value);
  });
}

init();
