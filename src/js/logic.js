// ETF 허브 메인화면 PoC — 순수 로직
// DOM·window 접근 금지. 인자로 받은 배열/객체는 변경하지 않는다.

const RANKING_SORT_KEY = {
  gainers: 'changeRate1d',
  losers: 'changeRate1d',
  volume: 'tradingValueChangeRate',
  volatility: 'volatilityScore',
};

function tieBreak(a, b) {
  const av = a.tradingValue;
  const bv = b.tradingValue;
  if (av === null || av === undefined) {
    if (bv !== null && bv !== undefined) return 1;
  } else if (bv === null || bv === undefined) {
    return -1;
  } else if (av !== bv) {
    return bv - av;
  }
  return a.name < b.name ? -1 : 1;
}

function nameCodePointCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 2.1 getRankedEtfs(etfList, tab)
 */
export function getRankedEtfs(etfList, tab) {
  if (!Object.prototype.hasOwnProperty.call(RANKING_SORT_KEY, tab)) {
    throw new Error('알 수 없는 순위 탭: ' + tab);
  }
  if (!Array.isArray(etfList) || etfList.length === 0) return [];

  const key = RANKING_SORT_KEY[tab];
  const ascending = tab === 'losers';

  const seen = new Set();
  const deduped = [];
  for (const etf of etfList) {
    if (!seen.has(etf.id)) {
      seen.add(etf.id);
      deduped.push(etf);
    }
  }

  const filtered = deduped.filter((e) => e[key] !== null && e[key] !== undefined);

  filtered.sort((a, b) => {
    const diff = ascending ? a[key] - b[key] : b[key] - a[key];
    if (diff !== 0) return diff;
    return tieBreak(a, b);
  });

  return filtered;
}

/**
 * 2.2 getThemeHeatmap(themeList, period)
 */
export function getThemeHeatmap(themeList, period) {
  const field = periodToReturnField(period);
  if (!Array.isArray(themeList)) return [];

  const mapped = themeList.map((t) => ({
    themeId: t.id,
    name: t.name,
    returnRate: t[field],
    tradingValue: t.tradingValue,
    representativeEtfIds: t.representativeEtfIds ? t.representativeEtfIds.slice() : [],
  }));

  mapped.sort((a, b) => {
    const av = a.tradingValue;
    const bv = b.tradingValue;
    if (av !== bv) return bv - av;
    return nameCodePointCompare(a.name, b.name);
  });

  return mapped;
}

/**
 * 2.3 getStrongWeakThemes(themeList, period)
 */
export function getStrongWeakThemes(themeList, period) {
  const field = periodToReturnField(period);
  if (!Array.isArray(themeList) || themeList.length === 0) {
    return { strongest: null, weakest: null };
  }

  const better = (a, b, wantMax) => {
    // returns theme that should be picked among a,b for strongest(wantMax) or weakest(!wantMax)
    if (a[field] !== b[field]) {
      return wantMax ? (a[field] > b[field] ? a : b) : (a[field] < b[field] ? a : b);
    }
    if (a.tradingValue !== b.tradingValue) {
      return a.tradingValue > b.tradingValue ? a : b;
    }
    return nameCodePointCompare(a.name, b.name) <= 0 ? a : b;
  };

  let strongest = themeList[0];
  let weakest = themeList[0];
  for (let i = 1; i < themeList.length; i += 1) {
    strongest = better(strongest, themeList[i], true);
    weakest = better(weakest, themeList[i], false);
  }
  return { strongest, weakest };
}

function periodToReturnField(period) {
  if (period === '1d') return 'return1d';
  if (period === '1w') return 'return1w';
  if (period === '1m') return 'return1m';
  throw new Error('알 수 없는 기간: ' + period);
}

/**
 * 2.4 getEtfsByTheme(etfList, themeId)
 */
export function getEtfsByTheme(etfList, themeId) {
  if (!Array.isArray(etfList) || !themeId) return [];
  const seen = new Set();
  const result = [];
  for (const etf of etfList) {
    if (etf.themeId === themeId && !seen.has(etf.id)) {
      seen.add(etf.id);
      result.push(etf);
    }
  }
  return result;
}

/**
 * 2.5 getEtfsByStock(etfList, holdingList, stockId)
 */
export function getEtfsByStock(etfList, holdingList, stockId) {
  if (!Array.isArray(etfList) || !Array.isArray(holdingList) || !stockId) return [];

  const etfById = new Map(etfList.map((e) => [e.id, e]));
  const seen = new Set();
  const result = [];

  for (const h of holdingList) {
    if (h.stockId !== stockId) continue;
    const etf = etfById.get(h.etfId);
    if (!etf) continue;
    if (seen.has(etf.id)) continue;
    seen.add(etf.id);
    result.push({ etf, weight: h.weight, rank: h.rank });
  }

  result.sort((a, b) => {
    if (a.weight !== b.weight) return b.weight - a.weight;
    const atv = a.etf.tradingValue;
    const btv = b.etf.tradingValue;
    if (atv !== btv) {
      if (atv === null || atv === undefined) return 1;
      if (btv === null || btv === undefined) return -1;
      return btv - atv;
    }
    return nameCodePointCompare(a.etf.name, b.etf.name);
  });

  return result;
}

/**
 * 2.6 searchAll(dataset, query)
 */
export function searchAll(dataset, query) {
  const { etfs = [], stocks = [], themes = [] } = dataset || {};
  const trimmed = String(query).trim();

  if (trimmed === '') {
    return { etfs: [], stocks: [], themes: [], isEmptyQuery: true };
  }

  const needle = trimmed.toLowerCase();

  const matchedEtfs = dedupeById(
    etfs.filter(
      (e) => e.name.toLowerCase().includes(needle) || e.code.toLowerCase().includes(needle)
    )
  );
  const matchedStocks = dedupeById(
    stocks.filter(
      (s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle)
    )
  );
  const matchedThemes = dedupeById(themes.filter((t) => t.name.toLowerCase().includes(needle)));

  return { etfs: matchedEtfs, stocks: matchedStocks, themes: matchedThemes, isEmptyQuery: false };
}

function dedupeById(list) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * 2.7 getComparison(etfList, holdingList, stockList, etfIds)
 */
export function getComparison(etfList, holdingList, stockList, etfIds) {
  if (!Array.isArray(etfIds)) return [];

  // etfList 에 같은 id 가 중복 존재하면 첫 등장 항목을 기준으로 조회한다 (§2.7).
  const etfById = new Map();
  for (const etf of etfList) {
    if (!etfById.has(etf.id)) etfById.set(etf.id, etf);
  }
  const stockById = new Map(stockList.map((s) => [s.id, s]));

  const seen = new Set();
  const uniqueIds = [];
  for (const id of etfIds) {
    if (!seen.has(id) && etfById.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  return uniqueIds.map((etfId) => {
    const etf = etfById.get(etfId);
    const relations = holdingList
      .filter((h) => h.etfId === etfId)
      .sort((a, b) => a.rank - b.rank);

    const topHoldingNames = relations
      .slice(0, 3)
      .map((h) => {
        const stock = stockById.get(h.stockId);
        return stock ? stock.name : null;
      })
      .filter((name) => name !== null);

    let top2Concentration = null;
    if (relations.length >= 2) {
      top2Concentration = relations[0].weight + relations[1].weight;
    }

    return {
      etfId,
      name: etf.name,
      topHoldingNames,
      top2Concentration,
      netAssets: etf.netAssets,
      tradingValue: etf.tradingValue,
      totalFee: etf.totalFee,
      return1m: etf.return1m,
    };
  });
}

/**
 * 2.8 filterContents(contentList, type)
 */
export function filterContents(contentList, type) {
  if (!['news', 'disclosure', 'research'].includes(type)) {
    throw new Error('알 수 없는 콘텐츠 유형: ' + type);
  }
  if (!Array.isArray(contentList)) return [];

  const filtered = contentList.filter((c) => c.type === type);
  filtered.sort((a, b) => {
    const at = new Date(a.publishedAt).getTime();
    const bt = new Date(b.publishedAt).getTime();
    if (at !== bt) return bt - at;
    return nameCodePointCompare(a.id, b.id);
  });
  return filtered;
}

/**
 * 2.9 getMarketSummary(marketSummaryByPeriod, period)
 */
export function getMarketSummary(marketSummaryByPeriod, period) {
  if (!marketSummaryByPeriod || !Object.prototype.hasOwnProperty.call(marketSummaryByPeriod, period)) {
    throw new Error('알 수 없는 기간: ' + period);
  }
  return marketSummaryByPeriod[period];
}

/**
 * 2.10 포맷·fallback 함수
 */
export function formatSignedPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '정보 없음';
  const fixed = Math.abs(value).toFixed(2);
  if (value > 0) return '+' + fixed + '%';
  if (value < 0) return '-' + fixed + '%';
  return '0.00%';
}

export function formatKrw(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '정보 없음';

  if (value >= 10000) {
    const jo = Math.floor(value / 10000);
    const eok = value % 10000;
    if (eok === 0) return jo + '조원';
    return jo + '조 ' + eok.toLocaleString('en-US') + '억원';
  }
  return value.toLocaleString('en-US') + '억원';
}

export function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '정보 없음';
  return value.toLocaleString('en-US') + '원';
}
