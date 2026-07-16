// ETF 허브 메인화면 PoC — DOM 렌더링 함수 (브라우저 전용)
import {
  formatSignedPercent,
  formatKrw,
  formatPrice,
} from './logic.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value);
    }
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined) return;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  });
  return node;
}

function signedClass(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'neutral';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'neutral';
}

function changeSpan(value) {
  return el('span', { className: 'change ' + signedClass(value), text: formatSignedPercent(value) });
}

// ---------------------------------------------------------------------------
// 검색 결과
// ---------------------------------------------------------------------------
export function renderSearchResults(container, result, handlers) {
  container.innerHTML = '';

  if (result.isEmptyQuery) {
    // 검색어가 없으면 결과 영역을 비워 첫 화면 공간을 확보한다.
    return;
  }

  const hasAny = result.etfs.length || result.stocks.length || result.themes.length;
  if (!hasAny) {
    container.appendChild(el('p', { className: 'empty-state' }, '조건에 맞는 ETF를 찾지 못했어요.'));
    return;
  }

  if (result.etfs.length) {
    const group = el('div', { className: 'search-group' }, [el('h3', {}, 'ETF')]);
    const list = el('ul', { className: 'search-result-list' });
    result.etfs.forEach((etf) => {
      const item = el('li', {}, [
        el(
          'button',
          {
            type: 'button',
            className: 'search-result-btn',
            onClick: () => handlers.onSelectEtf(etf.id),
          },
          [
            el('span', { className: 'result-name' }, etf.name),
            el('span', { className: 'result-code' }, etf.code),
          ]
        ),
      ]);
      list.appendChild(item);
    });
    group.appendChild(list);
    container.appendChild(group);
  }

  if (result.stocks.length) {
    const group = el('div', { className: 'search-group' }, [el('h3', {}, '종목')]);
    const list = el('ul', { className: 'search-result-list' });
    result.stocks.forEach((stock) => {
      const item = el('li', {}, [
        el(
          'button',
          {
            type: 'button',
            className: 'search-result-btn',
            onClick: () => handlers.onSelectStock(stock.id),
          },
          [
            el('span', { className: 'result-name' }, stock.name),
            el('span', { className: 'result-code' }, stock.code),
          ]
        ),
      ]);
      list.appendChild(item);
    });
    group.appendChild(list);
    container.appendChild(group);
  }

  if (result.themes.length) {
    const group = el('div', { className: 'search-group' }, [el('h3', {}, '테마')]);
    const list = el('ul', { className: 'search-result-list' });
    result.themes.forEach((theme) => {
      const item = el('li', {}, [
        el(
          'button',
          {
            type: 'button',
            className: 'search-result-btn',
            onClick: () => handlers.onSelectTheme(theme.id),
          },
          [el('span', { className: 'result-name' }, theme.name)]
        ),
      ]);
      list.appendChild(item);
    });
    group.appendChild(list);
    container.appendChild(group);
  }
}

// ---------------------------------------------------------------------------
// 오늘의 ETF 시장
// ---------------------------------------------------------------------------
export function renderMarketSummary(container, summary, themeById) {
  container.innerHTML = '';

  const strongTheme = themeById.get(summary.strongestThemeId);
  const weakTheme = themeById.get(summary.weakestThemeId);

  // 해석 문장을 헤드라인으로 두고 수치는 보조 정보로 컴팩트하게 배치한다.
  const headline = el('p', { className: 'market-headline' }, summary.summary);

  const breadth = el('div', { className: 'market-breadth' }, [
    el('span', { className: 'breadth-item up' }, [
      el('span', { className: 'breadth-label' }, '상승 '),
      el('strong', {}, String(summary.advancers)),
    ]),
    el('span', { className: 'breadth-divider' }, '·'),
    el('span', { className: 'breadth-item down' }, [
      el('span', { className: 'breadth-label' }, '하락 '),
      el('strong', {}, String(summary.decliners)),
    ]),
    el('span', { className: 'breadth-divider' }, '·'),
    el('span', { className: 'breadth-item neutral' }, [
      el('span', { className: 'breadth-label' }, '보합 '),
      el('strong', {}, String(summary.unchanged)),
    ]),
  ]);

  const trading = el('div', { className: 'market-trading' }, [
    el('span', { className: 'market-trading-label' }, '거래대금'),
    el('span', { className: 'market-trading-value' }, formatKrw(summary.totalTradingValue)),
    changeSpan(summary.tradingValueChangeRate),
    el('span', { className: 'market-trading-note' }, '전일 대비'),
  ]);

  const themesRow = el('div', { className: 'market-themes' }, [
    el('span', { className: 'market-theme-pill strong' }, [
      el('span', { className: 'pill-label' }, '강한 테마'),
      el('strong', {}, strongTheme ? strongTheme.name : '정보 없음'),
    ]),
    el('span', { className: 'market-theme-pill weak' }, [
      el('span', { className: 'pill-label' }, '약한 테마'),
      el('strong', {}, weakTheme ? weakTheme.name : '정보 없음'),
    ]),
  ]);

  container.append(headline, breadth, trading, themesRow);
}

// ---------------------------------------------------------------------------
// 히트맵
// ---------------------------------------------------------------------------
function returnIntensityClass(returnRate) {
  if (typeof returnRate !== 'number' || !Number.isFinite(returnRate) || returnRate === 0) {
    return 'flat';
  }
  const direction = returnRate > 0 ? 'up' : 'down';
  const abs = Math.abs(returnRate);
  let level = 1;
  if (abs >= 3) level = 3;
  else if (abs >= 1.5) level = 2;
  return direction + '-' + level;
}

export function renderHeatmap(container, heatmapItems, opts) {
  container.innerHTML = '';

  if (!heatmapItems.length) {
    container.appendChild(el('p', { className: 'empty-state' }, '표시할 테마가 없어요.'));
    return;
  }

  const maxTradingValue = Math.max(...heatmapItems.map((t) => t.tradingValue || 0));

  heatmapItems.forEach((item, index) => {
    // 거래대금 상대 규모로 카드 크기 3단계 차등 (정렬 기준이 tradingValue 내림차순).
    let sizeClass = 'heatmap-card--sm';
    if (index < 2) sizeClass = 'heatmap-card--lg';
    else if (index < 6) sizeClass = 'heatmap-card--md';

    const isSelected = opts.selectedThemeId === item.themeId;

    const card = el(
      'button',
      {
        type: 'button',
        className:
          'heatmap-card ' +
          sizeClass +
          ' tone-' +
          returnIntensityClass(item.returnRate) +
          (isSelected ? ' selected' : ''),
        'data-testid': 'heatmap-card',
        'aria-pressed': String(isSelected),
        onClick: () => opts.onSelectTheme(item.themeId),
      },
      [
        el('span', { className: 'heatmap-theme-name' }, item.name),
        changeSpan(item.returnRate),
        el(
          'span',
          { className: 'heatmap-trading-value' },
          '거래대금 ' + formatKrw(item.tradingValue)
        ),
      ]
    );
    const relativeSize = maxTradingValue > 0 ? (item.tradingValue || 0) / maxTradingValue : 0;
    card.style.setProperty('--relative-size', relativeSize.toFixed(2));
    container.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// 지금 많이 움직인 ETF
// ---------------------------------------------------------------------------
export function renderRankingList(container, etfList, ctx) {
  container.innerHTML = '';

  if (!etfList.length) {
    container.appendChild(el('p', { className: 'empty-state' }, '표시할 ETF가 없어요.'));
    return;
  }

  etfList.slice(0, 8).forEach((etf) => {
    container.appendChild(renderEtfCard(etf, ctx));
  });
}

function renderEtfCard(etf, ctx) {
  const theme = ctx.themeById.get(etf.themeId);
  const topStocks = etf.topHoldings
    .slice(0, 3)
    .map((stockId) => ctx.stockById.get(stockId))
    .filter(Boolean);

  const issue = ctx.issueByEtfId ? ctx.issueByEtfId.get(etf.id) : null;

  // ETF명·등락률이 주 정보, 나머지는 보조 정보로 위계를 나눈 피드형 카드.
  return el(
    'button',
    {
      type: 'button',
      className: 'etf-card',
      'data-testid': 'etf-card',
      onClick: () => ctx.onSelectEtf(etf.id),
    },
    [
      el('div', { className: 'etf-card-main' }, [
        el('div', { className: 'etf-card-title' }, [
          el('span', { className: 'etf-name' }, etf.name),
          el('span', { className: 'etf-sub' }, [
            el('span', { className: 'etf-price' }, formatPrice(etf.currentPrice)),
            el('span', { className: 'etf-code' }, etf.code),
          ]),
        ]),
        changeSpan(etf.changeRate1d),
      ]),
      el('div', { className: 'etf-card-meta' }, [
        theme ? el('span', { className: 'theme-tag' }, theme.name) : null,
        el(
          'span',
          { className: 'etf-trading' },
          '거래대금 ' +
            formatKrw(etf.tradingValue) +
            (ctx.tab === 'volume' &&
            typeof etf.tradingValueChangeRate === 'number' &&
            Number.isFinite(etf.tradingValueChangeRate)
              ? ' (' + formatSignedPercent(etf.tradingValueChangeRate) + ' 전일 대비)'
              : '')
        ),
      ]),
      topStocks.length
        ? el(
            'div',
            { className: 'etf-card-holdings' },
            '주요 구성종목 ' + topStocks.map((s) => s.name).join(', ')
          )
        : null,
      issue ? el('p', { className: 'etf-card-issue' }, issue) : null,
    ]
  );
}

// ---------------------------------------------------------------------------
// 관심 종목으로 ETF 찾기
// ---------------------------------------------------------------------------
export function renderStockChips(container, stocks, selectedStockId, onSelect) {
  container.innerHTML = '';
  stocks.forEach((stock) => {
    const isActive = stock.id === selectedStockId;
    container.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'stock-chip' + (isActive ? ' active' : ''),
          'data-testid': 'stock-chip',
          'aria-pressed': String(isActive),
          onClick: () => onSelect(stock.id),
        },
        stock.name
      )
    );
  });
}

export function renderStockEtfResults(container, results, ctx = {}) {
  container.innerHTML = '';

  if (!results.length) {
    container.appendChild(
      el('p', { className: 'empty-state' }, '이 종목을 담은 ETF를 찾지 못했어요.')
    );
    return;
  }

  // 편입비중 막대 스케일 기준 (최대 비중 대비 상대 길이)
  const maxWeight = Math.max(...results.map((r) => r.weight || 0), 1);

  results.forEach(({ etf, weight, rank }) => {
    const theme = ctx.themeById ? ctx.themeById.get(etf.themeId) : null;
    const barWidth = Math.max(4, Math.round((weight / maxWeight) * 100));

    const bar = el('div', { className: 'weight-bar', 'aria-hidden': 'true' }, [
      el('div', { className: 'weight-bar-fill' }),
    ]);
    bar.firstChild.style.width = barWidth + '%';

    container.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'stock-result-card',
          onClick: () => (ctx.onSelectEtf ? ctx.onSelectEtf(etf.id) : null),
        },
        [
          el('div', { className: 'stock-result-header' }, [
            el('span', { className: 'etf-name' }, etf.name),
            el('span', { className: 'weight-value' }, '편입비중 ' + weight + '%'),
          ]),
          bar,
          el('div', { className: 'stock-result-meta' }, [
            el('span', {}, '비중 순위 ' + rank + '위'),
            theme ? el('span', { className: 'theme-tag' }, theme.name) : null,
          ]),
          el('div', { className: 'stock-result-meta' }, [
            el('span', {}, '순자산 ' + formatKrw(etf.netAssets)),
            el('span', {}, '거래대금 ' + formatKrw(etf.tradingValue)),
          ]),
        ]
      )
    );
  });
}

// ---------------------------------------------------------------------------
// 오늘 주목할 테마
// ---------------------------------------------------------------------------
export function renderThemeCards(container, themes, ctx) {
  container.innerHTML = '';

  themes.forEach((theme) => {
    const repEtfs = theme.representativeEtfIds
      .map((id) => ctx.etfById.get(id))
      .filter(Boolean);
    const repStocks = theme.representativeStockIds
      .map((id) => ctx.stockById.get(id))
      .filter(Boolean);

    container.appendChild(
      el('div', { className: 'theme-card' }, [
        el('div', { className: 'theme-card-header' }, [
          el('span', { className: 'theme-name' }, theme.name),
          changeSpan(theme.return1d),
        ]),
        repEtfs.length
          ? el('p', { className: 'theme-rep-etf' }, '대표 ETF ' + repEtfs.map((e) => e.name).join(', '))
          : null,
        repStocks.length
          ? el('p', { className: 'theme-rep-stock' }, '주요 종목 ' + repStocks.map((s) => s.name).join(', '))
          : null,
        el('p', { className: 'theme-issue' }, theme.issueSummary),
        el(
          'p',
          { className: 'theme-trading-change' },
          '거래대금 변화 ' + formatSignedPercent(theme.tradingValueChangeRate)
        ),
      ])
    );
  });
}

// ---------------------------------------------------------------------------
// 같은 테마 ETF 비교
// ---------------------------------------------------------------------------
export function renderComparisonTable(container, comparisonRows) {
  container.innerHTML = '';

  if (!comparisonRows.length) {
    container.appendChild(el('p', { className: 'empty-state' }, '비교할 ETF 데이터가 없어요.'));
    return;
  }

  const rowsMeta = [
    { label: '주요 구성종목', get: (r) => (r.topHoldingNames.length ? r.topHoldingNames.join(', ') : '정보 없음') },
    { label: '상위 2종목 집중도', get: (r) => (r.top2Concentration === null ? '정보 없음' : r.top2Concentration.toFixed(1) + '%') },
    { label: '순자산', get: (r) => formatKrw(r.netAssets) },
    { label: '거래대금', get: (r) => formatKrw(r.tradingValue) },
    { label: '총보수', get: (r) => (typeof r.totalFee === 'number' ? r.totalFee.toFixed(2) + '%' : '정보 없음') },
    { label: '1개월 수익률', get: (r) => formatSignedPercent(r.return1m) },
  ];

  // 가로 스크롤 표 대신 ETF별 세로 비교 카드로 모바일 가독성을 확보한다.
  comparisonRows.forEach((row) => {
    container.appendChild(
      el('article', { className: 'compare-card' }, [
        el('h3', { className: 'compare-card-name' }, row.name),
        el(
          'dl',
          { className: 'compare-card-rows' },
          rowsMeta.flatMap((meta) => [
            el('dt', {}, meta.label),
            el('dd', {}, meta.get(row)),
          ])
        ),
      ])
    );
  });

  container.appendChild(
    el(
      'p',
      { className: 'compare-note' },
      '상품 간 차이는 구조적 차이일 뿐 우열을 의미하지 않아요.'
    )
  );
}

export function renderCompareChips(container, availableEtfs, selectedIds, onToggle) {
  container.innerHTML = '';
  availableEtfs.forEach((etf) => {
    const isSelected = selectedIds.includes(etf.id);
    container.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'compare-chip' + (isSelected ? ' active' : ''),
          'aria-pressed': String(isSelected),
          onClick: () => onToggle(etf.id),
        },
        etf.name
      )
    );
  });
}

// ---------------------------------------------------------------------------
// 뉴스·공시·리서치
// ---------------------------------------------------------------------------
const TYPE_LABEL = { news: '뉴스', disclosure: '공시', research: '리서치' };

export function renderContentList(container, contentList) {
  container.innerHTML = '';

  if (!contentList.length) {
    container.appendChild(el('p', { className: 'empty-state' }, '해당 유형의 콘텐츠가 없어요.'));
    return;
  }

  contentList.forEach((content) => {
    const date = new Date(content.publishedAt);
    const dateText = Number.isNaN(date.getTime()) ? '정보 없음' : date.toLocaleDateString('ko-KR');

    // 카드 테두리 없이 구분선으로 나뉘는 가벼운 리스트 아이템.
    container.appendChild(
      el('article', { className: 'content-item' }, [
        el('div', { className: 'content-item-meta' }, [
          el('span', { className: 'content-type-badge' }, TYPE_LABEL[content.type] || content.type),
          el('span', { className: 'content-date' }, dateText),
        ]),
        el('h3', { className: 'content-title' }, content.title),
        el('p', { className: 'content-summary' }, content.summary),
      ])
    );
  });
}

// ---------------------------------------------------------------------------
// 태그 브리핑 (tag_brief)
// ---------------------------------------------------------------------------
const TAG_CATEGORY_LABEL = { sector: '섹터', strategy: '전략', dividend: '배당', provisional: '임시' };

export function renderTagBriefList(container, briefs, ctx) {
  container.innerHTML = '';

  if (!briefs.length) {
    container.appendChild(el('p', { className: 'empty-state' }, '표시할 태그 브리핑이 없어요.'));
    return;
  }

  briefs.forEach((brief) => {
    const sourcesList = el(
      'ul',
      { className: 'tag-brief-sources-list' },
      brief.sourceArticles.map((source) => el('li', {}, `${source.title} · ${source.source}`))
    );

    const etfChips = el(
      'div',
      { className: 'tag-brief-etf-chips' },
      brief.relatedEtfIds.map((etfCode) => {
        const etf = ctx.etfByCode.get(etfCode);
        if (!etf) return el('span', { className: 'tag-brief-etf-chip tag-brief-etf-chip--unresolved' }, etfCode);
        return el(
          'button',
          { type: 'button', className: 'tag-brief-etf-chip', onClick: () => ctx.onSelectEtf(etf.id) },
          etf.name
        );
      })
    );

    const isProvisional = brief.universeSnapshot.provisional;

    container.appendChild(
      el('article', { className: 'tag-brief-card' }, [
        el('div', { className: 'tag-brief-meta' }, [
          el('span', { className: `tag-brief-badge tag-brief-badge--${brief.tagCategory}` }, TAG_CATEGORY_LABEL[brief.tagCategory] || brief.tagCategory),
          isProvisional ? el('span', { className: 'tag-brief-provisional-marker' }, '[임시 분류]') : null,
        ]),
        el('h3', { className: 'tag-brief-title' }, brief.title),
        el('p', { className: 'tag-brief-summary' }, brief.summary),
        el(
          'ul',
          { className: 'tag-brief-key-points' },
          brief.keyPoints.map((point) => el('li', {}, point))
        ),
        el('details', { className: 'tag-brief-sources' }, [
          el('summary', {}, `근거 기사 ${brief.sourceArticles.length}건`),
          sourcesList,
        ]),
        etfChips,
      ])
    );
  });
}

// ---------------------------------------------------------------------------
// 바텀시트
// ---------------------------------------------------------------------------
export function renderBottomSheet(container, etf, ctx) {
  container.innerHTML = '';

  if (!etf) return;

  const theme = ctx.themeById.get(etf.themeId);
  const topStocks = etf.topHoldings
    .map((stockId) => ctx.stockById.get(stockId))
    .filter(Boolean);

  const sheetPanel = el('div', { className: 'bottom-sheet-panel' }, [
    el('div', { className: 'bottom-sheet-handle' }),
    el('div', { className: 'bottom-sheet-header' }, [
      el('h2', { id: 'bottom-sheet-title' }, etf.name + ' (' + etf.code + ')'),
      el(
        'button',
        {
          type: 'button',
          className: 'bottom-sheet-close',
          'data-testid': 'bottom-sheet-close',
          'aria-label': '바텀시트 닫기',
          onClick: ctx.onClose,
        },
        '닫기'
      ),
    ]),
    el('div', { className: 'bottom-sheet-price' }, [
      el('span', { className: 'etf-price' }, formatPrice(etf.currentPrice)),
      changeSpan(etf.changeRate1d),
    ]),
    el('div', { className: 'bottom-sheet-grid' }, [
      infoTile('순자산', formatKrw(etf.netAssets)),
      infoTile('거래대금', formatKrw(etf.tradingValue)),
      infoTile('총보수', typeof etf.totalFee === 'number' ? etf.totalFee.toFixed(2) + '%' : '정보 없음'),
      infoTile('테마', theme ? theme.name : '정보 없음'),
    ]),
    topStocks.length
      ? el('div', { className: 'bottom-sheet-holdings' }, [
          el('h3', {}, '주요 구성종목'),
          el(
            'p',
            {},
            topStocks.map((s) => s.name).join(', ')
          ),
        ])
      : null,
    el('div', { className: 'bottom-sheet-summary' }, [
      el('h3', {}, '상품 특성 요약'),
      el('p', {}, etf.summary),
    ]),
    el(
      'button',
      {
        type: 'button',
        className: 'bottom-sheet-detail-link',
        onClick: (event) => {
          // 상세 진입 암시 요소: 클릭 시 후속 PoC 범위 안내를 인라인 표시.
          const panel = event.currentTarget.closest('.bottom-sheet-panel');
          if (panel && !panel.querySelector('.bottom-sheet-detail-notice')) {
            const notice = el(
              'p',
              { className: 'bottom-sheet-detail-notice', role: 'status' },
              'ETF 상세화면은 후속 PoC 범위입니다'
            );
            event.currentTarget.insertAdjacentElement('afterend', notice);
          }
        },
      },
      '상세 정보 (샘플)'
    ),
  ]);

  container.appendChild(sheetPanel);
}

function infoTile(label, value) {
  return el('div', { className: 'info-tile' }, [
    el('span', { className: 'info-label' }, label),
    el('span', { className: 'info-value' }, value),
  ]);
}

export function setActiveButton(buttons, activeId, attr) {
  buttons.forEach((btn) => {
    const isActive = btn.dataset.value === activeId;
    btn.setAttribute(attr, String(isActive));
    btn.classList.toggle('active', isActive);
  });
}
