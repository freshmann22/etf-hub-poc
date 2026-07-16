import { loadReverseSearchContext } from './adapters.js';
import { parseQuery } from './nlu.js';
import { rankByStockWeight, rankByTag, rankBySortField, rankComposite, rankFallbackDefault } from './ranker.js';

const els = {
  form: document.getElementById('searchForm'),
  input: document.getElementById('queryInput'),
  status: document.getElementById('statusBanner'),
  list: document.getElementById('resultList'),
  empty: document.getElementById('emptyState'),
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

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function runSearch(rawQuery) {
  if (!context) {
    renderStatus('데이터를 아직 불러오는 중이에요');
    return;
  }
  const parsed = parseQuery(rawQuery, context.stockNameIndex);
  let result;
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
    case 'EMPTY':
      els.list.innerHTML = '';
      els.empty.hidden = false;
      renderStatus('');
      return;
    default:
      result = { ...rankFallbackDefault(context, context.marketSnapshot), status: 'fallback' };
      result.note = '질문 의도를 정확히 파악하지 못해 지금 거래대금이 많은 ETF를 보여드려요';
  }
  renderResults(result);
}

async function init() {
  renderStatus('ETF 데이터를 불러오는 중이에요');
  context = await loadReverseSearchContext();
  renderStatus('');
  els.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    runSearch(els.input.value);
  });
}

init();
