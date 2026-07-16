// ETF 허브 메인화면 PoC — 상태 관리 및 이벤트 연결 (브라우저 전용)
// 데이터는 서버 API(/api/bundle)에서 로드하고, 서버 부재 시 로컬 fixture 로 폴백한다(dataSource.js).
import { loadData } from './dataSource.js';
import {
  getRankedEtfs,
  getThemeHeatmap,
  getEtfsByTheme,
  getEtfsByStock,
  searchAll,
  getComparison,
  filterContents,
  getMarketSummary,
} from './logic.js';
import {
  renderSearchResults,
  renderMarketSummary,
  renderHeatmap,
  renderRankingList,
  renderStockChips,
  renderStockEtfResults,
  renderThemeCards,
  renderComparisonTable,
  renderCompareChips,
  renderContentList,
  renderTagBriefList,
  renderBottomSheet,
} from './render.js';

// 비동기 부트스트랩: 데이터를 먼저 로드한 뒤 상태·DOM 배선·초기 렌더를 수행한다.
// 데이터 로딩만 async 로 감쌌을 뿐, 이하 로직/이벤트/렌더는 기존과 동일하다.
async function main() {
  const {
    etfs,
    themes,
    stocks,
    holdings,
    contents,
    marketSummaryByPeriod,
    comparisonSets,
  } = await loadData();

const REQUIRED_STOCK_NAMES = [
  '삼성전자',
  'SK하이닉스',
  'NAVER',
  '한화에어로스페이스',
  '두산에너빌리티',
  '현대차',
];

const themeById = new Map(themes.map((t) => [t.id, t]));
const stockById = new Map(stocks.map((s) => [s.id, s]));
const etfById = new Map(etfs.map((e) => [e.id, e]));
const etfByCode = new Map(etfs.map((e) => [e.code, e]));

// 태그 브리핑(tag_brief)은 별도 파이프라인(scripts/build-tag-briefs.js)의 산출물이라
// 서버 부재 시(예: file://) 조용히 빈 배열로 폴백한다.
async function loadTagBriefs() {
  try {
    const response = await fetch('/data/fixtures/tag-briefs.json');
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.briefs) ? payload.briefs : [];
  } catch {
    return [];
  }
}
const tagBriefs = await loadTagBriefs();

const chipStocks = REQUIRED_STOCK_NAMES.map((name) => stocks.find((s) => s.name === name)).filter(
  Boolean
);

function buildIssueByEtfId() {
  const map = new Map();
  contents
    .filter((c) => c.type === 'news')
    .forEach((c) => {
      c.relatedEtfIds.forEach((etfId) => {
        if (!map.has(etfId)) map.set(etfId, c.summary);
      });
    });
  return map;
}
const issueByEtfId = buildIssueByEtfId();

const state = {
  heatmapPeriod: '1d',
  rankingTab: 'gainers',
  selectedThemeId: null,
  selectedStockId: chipStocks.length ? chipStocks[0].id : null,
  compareThemeId: comparisonSets[0].themeId,
  compareEtfIds: comparisonSets[0].etfIds.slice(0, 3),
  contentFilter: 'news',
  query: '',
  bottomSheetEtfId: null,
  lastFocusedElement: null,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
const marketSummaryBodyEl = document.getElementById('market-summary-body');
const heatmapGridEl = document.getElementById('heatmap-grid');
const rankingListEl = document.getElementById('ranking-list');
const stockChipsEl = document.getElementById('stock-chips');
const stockEtfResultsEl = document.getElementById('stock-etf-results');
const themeCardsBodyEl = document.getElementById('theme-cards-body');
const compareThemeSelectEl = document.getElementById('compare-theme-select');
const compareEtfSelectEl = document.getElementById('compare-etf-select');
const compareTableEl = document.getElementById('compare-table');
const contentListEl = document.getElementById('content-list');
const tagBriefListEl = document.getElementById('tag-brief-list');
const bottomSheetEl = document.getElementById('bottom-sheet');
const bottomSheetBackdropEl = document.getElementById('bottom-sheet-backdrop');

const periodTabButtons = Array.from(document.querySelectorAll('.period-tab'));
const rankingTabButtons = Array.from(document.querySelectorAll('.ranking-tab'));
const contentFilterButtons = Array.from(document.querySelectorAll('.content-filter'));
const rankingThemeFilterEl = document.getElementById('ranking-theme-filter');
const rankingThemeLabelEl = document.getElementById('ranking-theme-label');
const rankingThemeClearBtn = document.getElementById('ranking-theme-clear');

// ---------------------------------------------------------------------------
// Render functions per section
// ---------------------------------------------------------------------------
function renderMarket() {
  const summary = getMarketSummary(marketSummaryByPeriod, '1d');
  renderMarketSummary(marketSummaryBodyEl, summary, themeById);
}

function renderHeatmapSection() {
  const items = getThemeHeatmap(themes, state.heatmapPeriod);
  renderHeatmap(heatmapGridEl, items, {
    selectedThemeId: state.selectedThemeId,
    onSelectTheme: (themeId) => {
      state.selectedThemeId = state.selectedThemeId === themeId ? null : themeId;
      renderHeatmapSection();
      renderRankingSection();
    },
  });

  periodTabButtons.forEach((btn) => {
    const isActive = btn.dataset.value === state.heatmapPeriod;
    btn.setAttribute('aria-selected', String(isActive));
    btn.classList.toggle('active', isActive);
  });
}

function renderRankingSection() {
  const base = state.selectedThemeId ? getEtfsByTheme(etfs, state.selectedThemeId) : etfs;
  const ranked = getRankedEtfs(base, state.rankingTab);
  renderRankingList(rankingListEl, ranked, {
    themeById,
    stockById,
    issueByEtfId,
    tab: state.rankingTab,
    onSelectEtf: openBottomSheet,
  });

  // 선택 테마 필터 표시줄
  const selectedTheme = state.selectedThemeId ? themeById.get(state.selectedThemeId) : null;
  if (selectedTheme) {
    rankingThemeLabelEl.textContent = '선택 테마: ' + selectedTheme.name;
    rankingThemeFilterEl.hidden = false;
  } else {
    rankingThemeLabelEl.textContent = '';
    rankingThemeFilterEl.hidden = true;
  }

  rankingTabButtons.forEach((btn) => {
    const isActive = btn.dataset.value === state.rankingTab;
    btn.setAttribute('aria-selected', String(isActive));
    btn.classList.toggle('active', isActive);
  });
}

function renderStockSection() {
  renderStockChips(stockChipsEl, chipStocks, state.selectedStockId, (stockId) => {
    state.selectedStockId = stockId;
    renderStockSection();
  });

  const results = state.selectedStockId
    ? getEtfsByStock(etfs, holdings, state.selectedStockId)
    : [];
  renderStockEtfResults(stockEtfResultsEl, results, { themeById, onSelectEtf: openBottomSheet });
}

function renderThemeSection() {
  const topThemes = themes
    .slice()
    .sort((a, b) => b.tradingValue - a.tradingValue)
    .slice(0, 6);
  renderThemeCards(themeCardsBodyEl, topThemes, { etfById, stockById });
}

function renderCompareThemeOptions() {
  compareThemeSelectEl.innerHTML = '';
  comparisonSets.forEach((set) => {
    const theme = themeById.get(set.themeId);
    const option = document.createElement('option');
    option.value = set.themeId;
    option.textContent = theme ? theme.name : set.themeId;
    if (set.themeId === state.compareThemeId) option.selected = true;
    compareThemeSelectEl.appendChild(option);
  });
}

function renderCompareSection() {
  const themeEtfs = getEtfsByTheme(etfs, state.compareThemeId);
  renderCompareChips(compareEtfSelectEl, themeEtfs, state.compareEtfIds, toggleCompareEtf);

  const rows = getComparison(etfs, holdings, stocks, state.compareEtfIds);
  renderComparisonTable(compareTableEl, rows);
}

function toggleCompareEtf(etfId) {
  const selected = state.compareEtfIds;
  if (selected.includes(etfId)) {
    // 비교는 최소 2개를 유지한다.
    if (selected.length <= 2) return;
    state.compareEtfIds = selected.filter((id) => id !== etfId);
  } else {
    // 최대 3개까지 선택 가능 — 초과 시 가장 먼저 선택된 항목을 교체한다.
    state.compareEtfIds =
      selected.length >= 3 ? selected.slice(1).concat(etfId) : selected.concat(etfId);
  }
  renderCompareSection();
}

function renderContentSection() {
  const list = filterContents(contents, state.contentFilter);
  renderContentList(contentListEl, list);

  contentFilterButtons.forEach((btn) => {
    const isActive = btn.dataset.value === state.contentFilter;
    btn.setAttribute('aria-selected', String(isActive));
    btn.classList.toggle('active', isActive);
  });
}

function renderTagBriefSection() {
  renderTagBriefList(tagBriefListEl, tagBriefs, { etfByCode, onSelectEtf: openBottomSheet });
}

function renderSearchSection() {
  const result = searchAll({ etfs, stocks, themes }, state.query);
  renderSearchResults(searchResultsEl, result, {
    onSelectEtf: (etfId) => openBottomSheet(etfId),
    onSelectStock: (stockId) => {
      state.selectedStockId = stockId;
      renderStockSection();
      document.querySelector('.stock-explore-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onSelectTheme: (themeId) => {
      state.selectedThemeId = themeId;
      renderHeatmapSection();
      renderRankingSection();
      document.querySelector('.ranking-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------
function openBottomSheet(etfId) {
  const etf = etfById.get(etfId);
  if (!etf) return;

  state.bottomSheetEtfId = etfId;
  state.lastFocusedElement = document.activeElement;

  renderBottomSheet(bottomSheetEl, etf, {
    themeById,
    stockById,
    onClose: closeBottomSheet,
  });

  bottomSheetEl.hidden = false;
  bottomSheetBackdropEl.hidden = false;

  const closeBtn = bottomSheetEl.querySelector('[data-testid="bottom-sheet-close"]');
  if (closeBtn) closeBtn.focus();

  document.addEventListener('keydown', onKeydownForSheet);
}

function closeBottomSheet() {
  state.bottomSheetEtfId = null;
  bottomSheetEl.hidden = true;
  bottomSheetBackdropEl.hidden = true;
  bottomSheetEl.innerHTML = '';
  document.removeEventListener('keydown', onKeydownForSheet);

  if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
    state.lastFocusedElement.focus();
  }
}

function onKeydownForSheet(event) {
  if (event.key === 'Escape') {
    closeBottomSheet();
    return;
  }
  // 포커스 트랩: Tab 이동을 바텀시트 내부에서 순환시킨다.
  if (event.key === 'Tab') {
    const focusables = bottomSheetEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!bottomSheetEl.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }
}

bottomSheetBackdropEl.addEventListener('click', closeBottomSheet);

// ---------------------------------------------------------------------------
// Event bindings
// ---------------------------------------------------------------------------
searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderSearchSection();
});

periodTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.heatmapPeriod = btn.dataset.value;
    renderHeatmapSection();
  });
});

rankingTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.rankingTab = btn.dataset.value;
    renderRankingSection();
  });
});

contentFilterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.contentFilter = btn.dataset.value;
    renderContentSection();
  });
});

compareThemeSelectEl.addEventListener('change', (event) => {
  const themeId = event.target.value;
  state.compareThemeId = themeId;
  const matchingSet = comparisonSets.find((s) => s.themeId === themeId);
  state.compareEtfIds = matchingSet
    ? matchingSet.etfIds.slice(0, 3)
    : getEtfsByTheme(etfs, themeId)
        .slice(0, 3)
        .map((e) => e.id);
  renderCompareSection();
});

rankingThemeClearBtn.addEventListener('click', () => {
  state.selectedThemeId = null;
  renderHeatmapSection();
  renderRankingSection();
});

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------
renderSearchSection();
renderMarket();
renderHeatmapSection();
renderRankingSection();
renderStockSection();
renderThemeSection();
renderCompareThemeOptions();
renderCompareSection();
renderContentSection();
renderTagBriefSection();
}

main();
