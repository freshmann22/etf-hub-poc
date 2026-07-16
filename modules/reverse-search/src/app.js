import { loadReverseSearchContext } from './adapters.js';
import { parseQuery } from './nlu.js';
import { rankByStockWeight, rankByTag, rankBySortField, rankComposite, rankFallbackDefault, rankByQueryPlan } from './ranker.js';

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

function renderQueryPlan(plan, source) {
  els.planTags.innerHTML = '';
  const tags = plan?.tags || [];
  els.plan.hidden = tags.length === 0;
  if (!tags.length) return;
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
      if (planned.plan.tags.length || planned.plan.sort) {
        result = rankByQueryPlan(context, planned.plan);
        renderResults(result);
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
    case 'MARKET_SORT':
      result = rankBySortField(context, context.marketSnapshot, parsed.sortField, parsed.sortDir, parsed.sortLabel);
      break;
    case 'COMPOSITE':
      result = rankComposite(context, context.marketSnapshot, parsed.tagGroups, parsed.sortField, parsed.sortDir, parsed.sortLabel);
      break;
    default:
      result = { ...rankFallbackDefault(context, context.marketSnapshot), status: 'fallback' };
      result.note = '질문 의도를 정확히 파악하지 못해 지금 거래대금이 많은 ETF를 보여드려요';
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
