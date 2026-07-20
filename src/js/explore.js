// ETF 탐색(별도 프로토타입 화면) — 데이터 파이프라인 연결 + 인터랙션.
// 데이터는 dataSource.loadData()(= /api/bundle, 실패 시 fixture)에서 받고, 상세 차트는
// /api/etf/:code/candles(Toss 실 시세)에서 받는다. 실데이터가 없는 항목은 더미로 두되
// 후속에 파이프라인을 연결할 수 있도록 어댑터 지점(getHoldings/getDividend)을 분리한다.
import { loadData } from './dataSource.js';

// UI 노출 구조와 ETF 소속은 taxonomy v2 산출물을 사용한다.
const EXPLORE_TAG_MAP_URL = '/config/etf-tagging/explore-tag-map.json';
const ETF_FILTER_MAP_URL = '/data/tagging/etf-filter-map.json';
let GROUPS = {};
let GROUP_LABELS = {};
let TAG_MAP = null;
let tagMembershipById = new Map();

const SORTS = [
  { key: 'marketCap', label: '시가총액순', dir: -1 },
  { key: 'changeRate1d', label: '수익률순', dir: -1 },
  { key: 'tradingValue', label: '거래대금순', dir: -1 },
  { key: 'currentPrice', label: '가격순', dir: -1 },
];
const SORT_MARKETCAP = 0;
const PAGE = 5; // 리스트 5개씩 노출

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------
const state = {
  group: 'sector',
  chip: 'sector.semiconductor', // taxonomy tagId. null이면 필터 없음(전체)
  chipsExpanded: false,
  sortIdx: 1, // 초기: 수익률순(칩 활성)
  visibleCount: PAGE,
  query: '',
  watchlist: new Set(),
  watchOnly: false,
  etf: null, // 상세 대상
  period: '1D',
  detailTab: 'summary',
};

let DATA = null;
let etfByCode = new Map();
let holdingsByEtfId = new Map();
let stockById = new Map();
let tagBriefs = [];

// ---------------------------------------------------------------------------
// 포매팅/파생 유틸
// ---------------------------------------------------------------------------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const won = (n) => (isNum(n) ? n.toLocaleString('ko-KR') + '원' : '—');
const eok = (n) => (isNum(n) ? (n >= 10000 ? (n / 10000).toFixed(2) + '조원' : n.toLocaleString('ko-KR') + '억원') : '—');
function pct(n) {
  if (!isNum(n)) return { text: '—', cls: 'flat' };
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const sign = n > 0 ? '+' : '';
  return { text: sign + n.toFixed(2) + '%', cls };
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function ciOf(name) {
  const t = String(name || '').trim().split(/\s+/)[0] || 'ETF';
  return t.slice(0, 6);
}
// 원형 CI칩 문구: 기본 'ETF', 레버리지=2X, 인버스=-1X, 곱버스=-2X.
function ciLabel(name) {
  const n = String(name || '');
  const two = /\b2X\b|2배|곱버스/i.test(n);
  if (/인버스/.test(n)) return two ? '-2X' : '-1X';
  if (/레버리지/.test(n)) return '2X';
  return 'ETF';
}
function ciClass(name) {
  if (/인버스/.test(name || '')) return 'inv';
  if (/레버리지/.test(name || '')) return 'lev';
  return '';
}
function regionOf(e) {
  return /미국|나스닥|S&P|글로벌|해외|차이나|중국|베트남|유로|일본|인도|선진국|신흥/.test(e.name || '') ? '해외' : '국내';
}
function issuerOf(e) {
  if (e.issuer) return e.issuer;
  const m = { KODEX: '삼성자산운용', TIGER: '미래에셋자산운용', KOSEF: '키움투자자산운용', KBSTAR: 'KB자산운용', RISE: 'KB자산운용', ARIRANG: '한화자산운용', HANARO: 'NH아문디자산운용', SOL: '신한자산운용', ACE: '한국투자신탁운용', PLUS: '한화자산운용', TIMEFOLIO: '타임폴리오자산운용' };
  return m[ciOf(e.name)] || null;
}

// ---------------------------------------------------------------------------
// 택소노미 필터 + 정렬
// ---------------------------------------------------------------------------
function chipMatches(e, tagId) {
  return tagMembershipById.get(tagId)?.has(String(e.code)) || false;
}
function sortVal(e, key) {
  if (key === 'marketCap') {
    const v = isNum(e.marketCap) ? e.marketCap : e.netAssets;
    return isNum(v) ? v : -Infinity;
  }
  return isNum(e[key]) ? e[key] : -Infinity;
}
function currentList() {
  let list = DATA.etfs.slice();
  if (state.watchOnly) {
    list = list.filter((e) => state.watchlist.has(e.code));
  } else if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    list = list.filter((e) => (e.name || '').toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
  } else if (state.chip) {
    list = list.filter((e) => chipMatches(e, state.chip));
  }
  const s = SORTS[state.sortIdx];
  list.sort((a, b) => (sortVal(a, s.key) - sortVal(b, s.key)) * s.dir);
  return list;
}

// ---------------------------------------------------------------------------
// 구성종목 데이터 어댑터. 공식 운용사 API를 먼저 조회하고, 제공되지 않는 종목은
// CSV → build:data → JSON 스냅샷으로 폴백한다.
// UI 는 오직 getEtfHoldings(코드[, 이름]) 만 사용하며 CSV 경로/컬럼을 알지 못한다.
// 향후 CSV 대신 API/DB 로 바뀌어도 이 어댑터만 교체하면 된다.
// ---------------------------------------------------------------------------
const HOLDINGS_URL = '/public/data/etf-holdings.json';
let HOLDINGS = null;          // { generatedAt, source, etfs: { code: {...} } }
let holdingsNameIndex = null; // 정규화된 ETF명 → code (보조키)

async function loadEtfHoldingsData() {
  if (HOLDINGS) return HOLDINGS;
  try {
    const res = await fetch(HOLDINGS_URL, { headers: { Accept: 'application/json' } });
    HOLDINGS = res.ok ? await res.json() : { etfs: {} };
  } catch {
    HOLDINGS = { etfs: {} }; // 로드 실패 → 빈 데이터(다른 ETF 대체 금지)
  }
  holdingsNameIndex = new Map();
  for (const [code, v] of Object.entries(HOLDINGS.etfs || {})) {
    const nk = normHoldName(v && v.name);
    if (nk && !holdingsNameIndex.has(nk)) holdingsNameIndex.set(nk, code);
  }
  return HOLDINGS;
}
function normalizeEtfId(value) {
  const s = String(value == null ? '' : value).trim();
  const d = s.replace(/\D/g, '');
  return d.length ? d.padStart(6, '0') : s.toUpperCase();
}
function normHoldName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
}
// 종목코드 우선, 없을 때만 ETF명 정확일치 보조키. 매칭 실패 시 null(다른 ETF 로 대체하지 않는다).
function getEtfHoldings(etfId, etfName) {
  if (!HOLDINGS || !HOLDINGS.etfs) return null;
  const byCode = HOLDINGS.etfs[normalizeEtfId(etfId)];
  if (byCode) return byCode;
  if (etfName && holdingsNameIndex) {
    const code = holdingsNameIndex.get(normHoldName(etfName));
    if (code) return HOLDINGS.etfs[code];
  }
  return null;
}

async function fetchOfficialEtfHoldings(code) {
  try {
    const res = await fetch(`/api/etf/${encodeURIComponent(code)}/holdings`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const env = await res.json();
    // mock/fixture 응답은 아래 정적 스냅샷과 중복되므로 공식 운용사 응답만 채택한다.
    if (env?.meta?.source !== 'issuer_tiger' || !Array.isArray(env.data) || !env.data.length) return null;
    return {
      source: env.meta.source,
      asOfDate: env.meta.asOfDate || null,
      holdings: env.data.map((row, index) => ({
        rank: isNum(row.rank) ? row.rank : index + 1,
        ticker: row.stockCode || null,
        name: row.stockName || null,
        weight: row.weight,
        quantity: row.shares,
        marketValue: row.marketValue,
      })).filter((row) => row.name && isNum(row.weight)),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ETF 메타데이터 어댑터 (WiseReport 스크랩 → 정규화 → compact JSON).
// 상세 요약/배당 탭의 더미를 실측으로 대체. 커버리지 낮음(≈22종) → 없으면 샘플 폴백.
// ---------------------------------------------------------------------------
const META_URL = '/public/data/etf-metadata.json';
let META = null;
async function loadEtfMeta() {
  if (META) return META;
  try {
    const res = await fetch(META_URL, { headers: { Accept: 'application/json' } });
    META = res.ok ? await res.json() : { etfs: {} };
  } catch {
    META = { etfs: {} };
  }
  return META;
}
function getEtfMeta(code) {
  if (!META || !META.etfs) return null;
  return META.etfs[normalizeEtfId(code)] || null;
}

async function loadExploreTagMap() {
  try {
    const [configRes, filterRes] = await Promise.all([
      fetch(EXPLORE_TAG_MAP_URL, { headers: { Accept: 'application/json' } }),
      fetch(ETF_FILTER_MAP_URL, { headers: { Accept: 'application/json' } }),
    ]);
    if (!configRes.ok || !filterRes.ok) return false;
    const [config, filterMap] = await Promise.all([configRes.json(), filterRes.json()]);
    if (!config.taxonomyVersion || config.taxonomyVersion !== filterMap.taxonomyVersion) return false;

    const groups = {};
    const labels = {};
    const memberships = new Map();
    for (const facet of config.facets || []) {
      groups[facet.id] = (facet.filters || []).map((filter) => ({ ...filter }));
      labels[facet.id] = facet.label;
      for (const filter of facet.filters || []) {
        const entries = filterMap.filters?.[filter.tagId] || [];
        memberships.set(filter.tagId, new Set(entries.map((entry) => String(entry.etfCode))));
      }
    }
    if (!Object.keys(groups).length) return false;

    TAG_MAP = config;
    GROUPS = groups;
    GROUP_LABELS = labels;
    tagMembershipById = memberships;
    state.group = config.defaultSelection?.facetId || Object.keys(groups)[0];
    state.chip = config.defaultSelection?.tagId || groups[state.group]?.[0]?.tagId || null;
    return true;
  } catch {
    return false;
  }
}

// 태그 브리핑은 발행된 fixture만 소비한다. 실패해도 ETF 탐색은 그대로 동작한다.
let TAG_BRIEFS = null;
async function getTagBriefs() {
  if (TAG_BRIEFS) return TAG_BRIEFS;
  TAG_BRIEFS = fetch('/data/fixtures/tag-briefs.json', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => (Array.isArray(payload?.briefs) ? payload : { briefs: [], taxonomyVersion: null }))
    .catch(() => ({ briefs: [], taxonomyVersion: null }));
  return TAG_BRIEFS;
}

// 배당: 대부분 소스 없음 → 더미. (분배 지급기준은 메타데이터에 있으면 실값 사용)
function getDividend() {
  return {
    source: 'dummy',
    summary: [['지급 주기 (금년)', '4번 / 분기'], ['주당 배당금 (최근 1년)', '320원'], ['배당수익률 (연)', '2.60%']],
    bars: [52, 55, 51, 58, 60, 63, 61, 70, 74, 72, 80, 86],
    history: [['12월 12일', '96원'], ['09월 12일', '88원'], ['06월 12일', '74원'], ['03월 12일', '62원']],
  };
}

// ---------------------------------------------------------------------------
// 렌더 — 홈
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function sparkStroke(start, end) {
  if (!isNum(start) || !isNum(end)) return 'var(--color-neutral)';
  if (end > start) return 'var(--color-up)';
  if (end < start) return 'var(--color-down)';
  return 'var(--color-neutral)';
}

function sparkPath(seed) {
  // 결정적 pseudo 스파크라인(장식용). 실 시세가 오면 최근 2영업일 10분봉으로 교체된다.
  let x = Math.abs(hash(seed)) % 1000;
  const rand = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const pts = [];
  const values = [];
  let y = 14;
  for (let i = 0; i <= 9; i++) {
    y += (rand() - 0.5) * 6;
    y = Math.max(3, Math.min(23, y));
    values.push(-y); // SVG y축은 아래로 증가하므로 가격 방향 비교용으로 반전한다.
    pts.push(`${(i * 72) / 9},${y.toFixed(1)}`);
  }
  const firstStroke = sparkStroke(values[0], values[4]);
  const secondStroke = sparkStroke(values[5], values[9]);
  return `<svg viewBox="0 0 72 26" role="img" aria-label="최근 2영업일 가격 흐름">
    <line x1="36" y1="2" x2="36" y2="24" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="2 2"/>
    <polyline points="${pts.slice(0, 5).join(' ')}" fill="none" stroke="${firstStroke}" stroke-width="2"/>
    <polyline points="${pts.slice(5).join(' ')}" fill="none" stroke="${secondStroke}" stroke-width="2"/>
  </svg>`;
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// 실 스파크라인: 최근 2영업일 정규장 1분봉을 날짜별 10분봉으로 축약한다. 노출 행만 조회 후 캐시.
const sparkCache = new Map(); // code -> { days: [{ date, closes }] } | null
const r1mCache = new Map();   // code -> 1M 수익률(number) | null

const SEOUL_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const REGULAR_OPEN_MINUTE = 9 * 60;
const REGULAR_CLOSE_MINUTE = 15 * 60 + 30;
const SPARK_INTERVAL_MINUTE = 10;

function regularSessionTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(SEOUL_TIME.formatToParts(date).map((part) => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (minute < REGULAR_OPEN_MINUTE || minute > REGULAR_CLOSE_MINUTE) return null;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute };
}

function buildTwoDaySpark(points) {
  const rows = points
    .map((point) => ({ point, session: regularSessionTime(point.t) }))
    .filter(({ point, session }) => session && isNum(point.c));
  const allDates = [...new Set(rows.map(({ session }) => session.date))];
  const dates = allDates.slice(-2);
  const closeByDate = new Map();
  rows.forEach(({ point, session }) => closeByDate.set(session.date, point.c));
  const days = dates.map((date) => {
    const buckets = new Map();
    rows.filter(({ session }) => session.date === date).forEach(({ point, session }) => {
      const bucket = Math.floor((session.minute - REGULAR_OPEN_MINUTE) / SPARK_INTERVAL_MINUTE);
      buckets.set(bucket, point.c); // 각 10분 구간의 마지막 체결가
    });
    const dateIndex = allDates.indexOf(date);
    const previousDate = dateIndex > 0 ? allDates[dateIndex - 1] : null;
    return {
      date,
      previousClose: previousDate ? closeByDate.get(previousDate) : null,
      closes: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, close]) => close),
    };
  }).filter((day) => day.closes.length >= 2);
  return days.length ? { days } : null;
}
// 각 거래일은 전 거래일 종가와 해당 날짜의 마지막 10분봉을 비교해 독립적으로 색을 정한다.
function realSparkSvg(series) {
  const W = 72, H = 24, p = 2;
  const closes = series.days.flatMap((day) => day.closes);
  const min = Math.min(...closes), max = Math.max(...closes), span = (max - min) || 1;
  const x = (i) => p + (i * (W - 2 * p)) / (closes.length - 1);
  const y = (v) => p + (1 - (v - min) / span) * (H - 2 * p);
  let offset = 0;
  const paths = series.days.map((day) => {
    const pts = day.closes.map((v, i) => `${x(offset + i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const stroke = sparkStroke(day.previousClose, day.closes[day.closes.length - 1]);
    offset += day.closes.length;
    return `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2"/>`;
  }).join('');
  const firstDayCount = series.days[0].closes.length;
  const divider = series.days.length === 2
    ? (x(firstDayCount - 1) + x(firstDayCount)) / 2
    : null;
  const dividerLine = divider == null ? ''
    : `<line x1="${divider.toFixed(1)}" y1="${p}" x2="${divider.toFixed(1)}" y2="${H - p}" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="2 2"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 2영업일 10분봉 가격 흐름, 색상은 전 거래일 종가 대비">${dividerLine}${paths}</svg>`;
}
async function fillSparklines(list) {
  await Promise.all(list.map(async (e) => {
    // 토스는 1m/1d만 지원하므로 1분봉을 받아 서울 정규장 기준 10분봉으로 축약한다.
    if (!sparkCache.has(e.code)) {
      const pts = await fetchCandles(e.code, '1m', 800);
      sparkCache.set(e.code, buildTwoDaySpark(pts));
    }
    const series = sparkCache.get(e.code);
    if (series) {
      const cell = document.querySelector('.spark[data-spark="' + e.code + '"]');
      if (cell) cell.innerHTML = realSparkSvg(series);
    }
    // 1M 수익률: 일봉 22개(별도 조회, 캐시). 스파크라인(1D)과 기간이 다르므로 분리.
    if (!r1mCache.has(e.code)) {
      const dpts = await fetchCandles(e.code, '1d', 22);
      const cs = dpts.map((p) => p.c).filter(isNum);
      r1mCache.set(e.code, cs.length >= 2 && cs[0] ? Math.round(((cs[cs.length - 1] - cs[0]) / cs[0]) * 10000) / 100 : null);
    }
    const rm = r1mCache.get(e.code);
    if (rm != null) {
      const rc = pct(rm);
      const r1mCell = document.querySelector('.r1m[data-r1m="' + e.code + '"]');
      if (r1mCell) { r1mCell.textContent = rc.text; r1mCell.className = 'r1m ' + rc.cls; }
    }
  }));
}

function renderCategory() {
  $('categoryTabs').innerHTML = Object.keys(GROUPS)
    .map((k) => `<button class="tab ${k === state.group && !state.watchOnly ? 'active' : ''}" data-group="${k}" role="tab">${esc(GROUP_LABELS[k])}</button>`)
    .join('');
}
function renderChips() {
  const container = $('chips');
  const toggle = $('chipsToggle');
  if (state.watchOnly) {
    container.innerHTML = '';
    container.classList.remove('collapsed');
    toggle.classList.add('hidden');
    return;
  }
  container.innerHTML = (GROUPS[state.group] || [])
    .map((c, i) => `<button class="chip ${c.tagId === state.chip ? 'active' : ''}" data-idx="${i}" role="tab">${esc(c.label)}</button>`)
    .join('');
  container.classList.toggle('collapsed', !state.chipsExpanded);
  // 접힘 상태에서 넘칠 때만 '전체 필터' 토글 노출.
  if (state.chipsExpanded) {
    toggle.classList.remove('hidden');
    toggle.textContent = '접기 −';
  } else if (container.scrollHeight > container.clientHeight + 2) {
    toggle.classList.remove('hidden');
    toggle.textContent = '전체 필터 +';
  } else {
    toggle.classList.add('hidden');
  }
}
function renderList() {
  const list = currentList();
  const selected = selectedChipConfig();
  const title = state.watchOnly ? '관심 ETF'
    : state.query.trim() ? `"${esc(state.query.trim())}" 검색`
    : selected ? `${esc(selected.label)} 관련 ETF`
    : '전체 ETF';
  $('listTitle').innerHTML = `${title} <span class="sub">(총 ${list.length}개)</span>`;
  $('sortBtn').textContent = SORTS[state.sortIdx].label + ' ⌄';
  $('listEmpty').classList.toggle('hidden', list.length > 0);
  const shown = list.slice(0, state.visibleCount);
  $('etfList').innerHTML = shown
    .map((e) => {
      const p = pct(e.changeRate1d);
      const r1m = pct(e.return1m);
      const on = state.watchlist.has(e.code) ? 'on' : '';
      return `<div class="etfRow" data-code="${esc(e.code)}">
        <div class="ci ${ciClass(e.name)}">${esc(ciLabel(e.name))}</div>
        <div style="min-width:0">
          <div class="name">${esc(e.name)}</div>
          <div class="meta">${regionOf(e)} · 1M <span class="r1m ${r1m.cls}" data-r1m="${esc(e.code)}">${r1m.text}</span> · 거래대금 ${eok(e.tradingValue)}</div>
        </div>
        <div class="rowRight">
          <div class="spark" data-spark="${esc(e.code)}">${sparkPath(e.code)}</div>
          <div class="perf ${p.cls}">${p.text}</div>
          <div class="price">${won(e.currentPrice)}</div>
        </div>
        <button class="star ${on}" data-star="${esc(e.code)}" aria-label="관심">${on ? '★' : '☆'}</button>
      </div>`;
    })
    .join('');
  fillSparklines(shown); // 실 캔들로 스파크라인 교체(비동기, 노출 행만)
  const more = $('moreBtn');
  if (list.length > state.visibleCount) {
    more.classList.remove('hidden');
    more.textContent = `더보기 + (${list.length - state.visibleCount})`;
  } else {
    more.classList.add('hidden');
  }
}
function selectedChipConfig() {
  return (GROUPS[state.group] || []).find((chip) => chip.tagId === state.chip) || null;
}

function renderTagBriefs() {
  const section = $('briefSection');
  const container = $('tagBriefList');
  const selected = !state.watchOnly && !state.query.trim() ? selectedChipConfig() : null;
  const brief = selected
    ? tagBriefs.find((item) => item.tagId === selected.tagId && item.taxonomyVersion === TAG_MAP?.taxonomyVersion)
    : null;
  section.classList.toggle('hidden', !selected);
  if (!selected) {
    container.innerHTML = '';
    return;
  }
  $('brief-heading').textContent = 'AI 브리핑';
  if (!brief) {
    container.innerHTML = `<article class="briefCard briefCardEmpty">
      <h3>아직 발행된 브리핑이 없어요.</h3>
    </article>`;
    return;
  }

  container.innerHTML = [brief].map((brief) => {
    const points = (brief.keyPoints || []).map((point) => `<li>${esc(point)}</li>`).join('');
    return `<article class="briefCard">
      <h3>${esc(brief.summary)}</h3>
      <ul class="briefPoints">${points}</ul>
    </article>`;
  }).join('');
}

function renderHome() { renderCategory(); renderChips(); renderList(); renderTagBriefs(); renderNav(); }

function renderNav() {
  const items = [['home', '⌂', '홈'], ['watch', '◎', '관심'], ['compare', '⇄', '비교'], ['menu', '☰', '메뉴']];
  const active = state.watchOnly ? 'watch' : 'home';
  $('bottomNav').innerHTML = items
    .map(([k, ic, lb]) => `<button class="navItem ${k === active ? 'active' : ''}" data-nav="${k}"><span class="navIcon">${ic}</span>${lb}</button>`)
    .join('');
}

// ---------------------------------------------------------------------------
// 렌더 — 상세
// ---------------------------------------------------------------------------
const PERIODS = [['1D', '1m', 78], ['1W', '1d', 7], ['1M', '1d', 22], ['3M', '1d', 66], ['1Y', '1d', 250], ['3Y', '1d', 750]];

function openDetail(code) {
  const e = etfByCode.get(code);
  if (!e) return;
  state.etf = e;
  state.period = '1D';
  state.detailTab = 'summary';
  $('home').classList.add('hidden');
  $('detail').classList.remove('hidden');
  $('cta').classList.remove('hidden');
  $('detail').scrollTop = 0;

  $('detailName').textContent = e.name;
  $('detailMeta').textContent = `${regionOf(e)} · ${e.category || '테마형'} · ${e.indexName || '기초지수 정보 없음'}`;
  $('detailPrice').textContent = won(e.currentPrice);
  const p = pct(e.changeRate1d);
  const chgAmt = isNum(e.currentPrice) && isNum(e.changeRate1d) ? Math.round(e.currentPrice * (e.changeRate1d / 100)) : null;
  $('detailChange').className = 'change ' + p.cls;
  $('detailChange').textContent = `${isNum(chgAmt) ? (chgAmt > 0 ? '+' : '') + chgAmt.toLocaleString('ko-KR') + '원 ' : ''}(${p.text})`;
  $('detailAsOf').textContent = '실시간 시세(지연 가능) · 없는 항목은 샘플';
  updateStars();
  renderPeriods();
  renderChart();
  renderDetailTabs();
  renderDetailBody();
}
function showHome() {
  $('detail').classList.add('hidden');
  $('home').classList.remove('hidden');
  $('cta').classList.add('hidden');
}
function renderPeriods() {
  $('periods').innerHTML = PERIODS.map(([lb]) => `<button class="period ${lb === state.period ? 'active' : ''}" data-period="${lb}">${lb}</button>`).join('');
}
async function fetchCandles(code, interval, count) {
  try {
    const res = await fetch(`/api/etf/${encodeURIComponent(code)}/candles?interval=${interval}&count=${count}`, { headers: { Accept: 'application/json' } });
    const env = res.ok ? await res.json() : null;
    return env && env.data && Array.isArray(env.data.points) ? env.data.points.filter((q) => isNum(q.c)) : [];
  } catch {
    return [];
  }
}
async function renderChart() {
  const el = $('priceChart');
  el.innerHTML = '<div class="chart-empty">차트 불러오는 중…</div>';
  const spec = PERIODS.find((x) => x[0] === state.period);
  const code = state.etf.code;
  const pts = await fetchCandles(code, spec[1], spec[2]);
  if (!state.etf || state.etf.code !== code) return; // 종목 바뀌면 무시
  mountChart(el, pts);
}

// 인터랙티브 라인차트: 마우스/터치 오버 시 해당 시점 날짜·주가·시작대비 수익률 툴팁 + 크로스헤어.
function mountChart(el, points) {
  if (!points || points.length < 2) { el.innerHTML = '<div class="chart-empty">차트 데이터 없음</div>'; return; }
  const W = 360, H = 172, pad = 8;
  const closes = points.map((p) => p.c);
  const min = Math.min(...closes), max = Math.max(...closes), span = (max - min) || 1;
  const X = (i) => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const Y = (v) => pad + (1 - (v - min) / span) * (H - 2 * pad);
  const base = closes[0];
  const up = closes[closes.length - 1] >= base;
  const color = up ? 'var(--color-up)' : 'var(--color-down)';
  const line = closes.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="${pad}" y1="${(pad + g * (H - 2 * pad)).toFixed(1)}" x2="${W - pad}" y2="${(pad + g * (H - 2 * pad)).toFixed(1)}" stroke="var(--color-divider)"/>`).join('');
  el.innerHTML = `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <g>${grid}</g>
      <polygon points="${area}" fill="${up ? 'rgba(218,70,60,.10)' : 'rgba(56,128,224,.10)'}"/>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="cx-line"></div>
    <div class="cx-dot" style="background:${color}"></div>
    <div class="chart-tip"></div>
  </div>`;
  const wrap = el.querySelector('.chart-wrap');
  const cxLine = wrap.querySelector('.cx-line');
  const cxDot = wrap.querySelector('.cx-dot');
  const tip = wrap.querySelector('.chart-tip');
  function move(clientX) {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    let frac = (clientX - rect.left) / rect.width;
    if (!Number.isFinite(frac)) return;
    frac = Math.max(0, Math.min(1, frac));
    const i = Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1))));
    const p = points[i];
    if (!p) return;
    const pxX = (X(i) / W) * rect.width;
    const pxY = (Y(p.c) / H) * rect.height;
    cxLine.style.left = pxX + 'px'; cxLine.style.display = 'block';
    cxDot.style.left = pxX + 'px'; cxDot.style.top = pxY + 'px'; cxDot.style.display = 'block';
    const ret = base ? ((p.c - base) / base) * 100 : null;
    const d = p.t ? String(p.t).slice(0, 10) : '';
    tip.innerHTML = `<div class="tip-d">${d}</div><div class="tip-p">${p.c.toLocaleString('ko-KR')}원</div>` +
      (ret == null ? '' : `<div class="${ret >= 0 ? 'up' : 'down'}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</div>`);
    tip.style.left = Math.max(34, Math.min(rect.width - 34, pxX)) + 'px';
    tip.style.display = 'block';
  }
  function hide() { cxLine.style.display = 'none'; cxDot.style.display = 'none'; tip.style.display = 'none'; }
  wrap.addEventListener('mousemove', (e) => move(e.clientX));
  wrap.addEventListener('mouseleave', hide);
  wrap.addEventListener('touchstart', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
  wrap.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
  wrap.addEventListener('touchend', hide);
}
function renderDetailTabs() {
  const tabs = [['summary', '요약'], ['holdings', '구성종목'], ['returns', '수익률'], ['dividend', '배당']];
  $('detailTabs').innerHTML = tabs.map(([k, v]) => `<button class="detailTab ${state.detailTab === k ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('');
}
const sampleTag = '<span class="tag-sample">샘플</span>';
function kv(label, val, sample) { return `<div class="kv"><span>${label}${sample ? sampleTag : ''}</span><b>${val}</b></div>`; }

function renderDetailBody() {
  const e = state.etf;
  const b = $('detailBody');
  if (state.detailTab === 'summary') {
    renderSummaryTab(e);
  } else if (state.detailTab === 'holdings') {
    renderHoldingsTab(e);
  } else if (state.detailTab === 'returns') {
    renderReturns();
  } else if (state.detailTab === 'dividend') {
    renderDividendTab(e);
  }
}

// 요약 탭 — 메타데이터 실측(운용사·총보수·상장일·베타)으로 더미 대체, 없으면 샘플.
async function renderSummaryTab(e) {
  const b = $('detailBody');
  b.innerHTML = '<div class="card"><div class="cardTitle">기본정보</div><div class="empty-state">불러오는 중…</div></div>';
  await loadEtfMeta();
  if (state.detailTab !== 'summary' || !state.etf || state.etf.code !== e.code) return;
  const m = getEtfMeta(e.code) || {};
  const feePct = isNum(m.totalFeePct) ? m.totalFeePct : (isNum(e.totalFee) ? e.totalFee : null);
  const listing = m.listingDate ? m.listingDate.replace(/-/g, '.') : null;
  const issuer = m.issuer || issuerOf(e);
  const idx = e.indexName || m.benchmarkName || null;
  const rows = [
    kv('순자산총액', eok(e.netAssets), e.netAssets == null),
    kv('추적지수', esc(idx || '정보 없음'), idx == null),
    kv('운용사', esc(issuer || '정보 없음'), false),
    kv('총 보수', isNum(feePct) ? feePct.toFixed(2) + '%' : '0.39%', !isNum(feePct)),
    kv('상장일', listing || '2023.05.17', !listing),
  ];
  if (isNum(m.beta)) rows.push(kv('베타(1년)', m.beta.toFixed(2), false));
  b.innerHTML =
    `<div class="card"><div class="cardTitle">기본정보</div>${rows.join('')}</div>
      <div class="card"><div class="cardTitle">주요 지표</div>
        <div class="metrics">
          <div class="metric"><small>PER ${sampleTag}</small><b>24.8</b></div>
          <div class="metric"><small>PBR ${sampleTag}</small><b>4.32</b></div>
          <div class="metric"><small>배당수익률 ${sampleTag}</small><b>0.48%</b></div>
        </div>
      </div>`;
}

// 배당 탭 — 분배 지급기준은 메타데이터 실값(있으면), 금액/수익률은 소스 없어 샘플.
async function renderDividendTab(e) {
  const b = $('detailBody');
  await loadEtfMeta();
  if (state.detailTab !== 'dividend' || !state.etf || state.etf.code !== e.code) return;
  const m = getEtfMeta(e.code) || {};
  const d = getDividend();
  const sched = m.distributionSchedule
    ? `<div class="kv"><span>분배 지급 기준</span><b>${esc(m.distributionSchedule)}</b></div>`
    : `<div class="kv"><span>지급 주기 ${sampleTag}</span><b>분기(추정)</b></div>`;
  b.innerHTML =
    `<div class="card"><div class="cardTitle">배당요약</div><div class="divSummary">${sched}` +
    `<div class="kv"><span>주당 배당금(최근 1년) ${sampleTag}</span><b>320원</b></div>` +
    `<div class="kv"><span>배당수익률(연) ${sampleTag}</span><b>2.60%</b></div></div></div>` +
    `<div class="card"><div class="cardTitle">배당 지급 내역 ${sampleTag}</div>` +
    `<div class="divChart">${d.bars.map((hh) => `<div class="divBar" style="height:${hh}px"></div>`).join('')}</div>` +
    `${d.history.map((x) => `<div class="history"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>`;
}
// 구성종목 탭 — 운용사 공식 데이터 우선, CSV 스냅샷 폴백. 없으면 명확한 빈 상태.
async function renderHoldingsTab(e) {
  const b = $('detailBody');
  b.innerHTML = '<div class="card"><div class="cardTitle">구성종목</div><div class="empty-state">불러오는 중…</div></div>';
  const official = await fetchOfficialEtfHoldings(e.code);
  if (!official) await loadEtfHoldingsData();
  if (state.detailTab !== 'holdings' || !state.etf || state.etf.code !== e.code) return; // 탭/종목 바뀌면 무시
  const data = official || getEtfHoldings(e.code, e.name);
  if (!data || !Array.isArray(data.holdings) || !data.holdings.length) {
    b.innerHTML =
      `<div class="card"><div class="cardTitle">구성종목</div>` +
      `<div class="empty-state">구성종목 데이터가 없습니다.<br>기준일 또는 데이터 수집 상태를 확인해 주세요.</div></div>`;
    return;
  }
  const rows = data.holdings.slice().sort((a, x) => x.weight - a.weight).slice(0, 10);
  const sum = rows.reduce((s, h) => s + (isNum(h.weight) ? h.weight : 0), 0);
  const asOf = data.asOfDate || (!official && HOLDINGS && HOLDINGS.generatedAt ? HOLDINGS.generatedAt.slice(0, 10) : null);
  const sourceLabel = official ? '<span class="sub">운용사 공식</span>' : '';
  b.innerHTML =
    `<div class="card">
      <div class="holdings-head"><div class="cardTitle">구성종목 상위 10</div>${sourceLabel}${asOf ? `<span class="sub">기준 ${esc(asOf)}</span>` : ''}</div>
      ${rows
        .map((h) => {
          const w = isNum(h.weight) ? h.weight : 0;
          return `<div class="holding">
            <div class="holdingTop"><span>${esc(h.rank)}. ${esc(h.name)}</span><span>${w.toFixed(2)}%</span></div>
            ${h.ticker ? `<div class="holdingMeta">${esc(h.ticker)}</div>` : ''}
            <div class="bar"><span style="width:${Math.min(w, 100)}%"></span></div>
          </div>`;
        })
        .join('')}
      <div class="holdings-sum"><span>상위 10 합계</span><b>${sum.toFixed(2)}%</b></div>
    </div>`;
}

async function renderReturns() {
  const e = state.etf;
  const b = $('detailBody');
  b.innerHTML = `<div class="returnPanel"><div class="returnTop" id="returnTop">수익률 추이</div><div id="returnsChart" class="chart"><div class="chart-empty">불러오는 중…</div></div></div><div class="note">차트 위에 마우스를 올리면 해당 시점의 주가와 시작 대비 수익률이 표시됩니다. 표시 구간은 확보 가능한 최근 거래일 기준이에요(최대 200거래일).</div>`;
  const pts = await fetchCandles(e.code, '1d', 200);
  if (state.detailTab !== 'returns' || !state.etf || state.etf.code !== e.code) return;
  const el = document.getElementById('returnsChart');
  if (!el) return;
  if (pts.length < 2) { el.innerHTML = '<div class="chart-empty">수익률 데이터 없음</div>'; return; }
  const first = pts[0].c, last = pts[pts.length - 1].c;
  const ret = first ? ((last - first) / first) * 100 : null;
  const top = document.getElementById('returnTop');
  if (top && ret != null) {
    top.innerHTML = `시작 대비 <span class="${ret >= 0 ? 'up' : 'down'}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</span> ` +
      `<span class="sub">(${String(pts[0].t).slice(0, 10)} ~ ${String(pts[pts.length - 1].t).slice(0, 10)})</span>`;
  }
  mountChart(el, pts);
}

// ---------------------------------------------------------------------------
// 관심(watchlist)
// ---------------------------------------------------------------------------
function toggleWatch(code) {
  if (state.watchlist.has(code)) state.watchlist.delete(code);
  else state.watchlist.add(code);
  updateStars();
}
function updateStars() {
  if (state.etf) {
    const on = state.watchlist.has(state.etf.code);
    $('detailStar').textContent = on ? '★' : '☆';
    $('detailStar').classList.toggle('on', on);
    $('ctaWatch').textContent = on ? '관심해제' : '관심등록';
    $('ctaWatch').classList.toggle('on', on);
  }
}
function ctaNotice(msg) {
  let n = document.querySelector('.cta-notice');
  if (!n) { n = document.createElement('div'); n.className = 'cta-notice'; n.setAttribute('role', 'status'); $('detail').appendChild(n); }
  n.textContent = msg;
  clearTimeout(ctaNotice._t);
  ctaNotice._t = setTimeout(() => n.remove(), 2200);
}

// ---------------------------------------------------------------------------
// 정렬 드롭다운
// ---------------------------------------------------------------------------
function renderSortMenu() {
  $('sortMenu').innerHTML = SORTS
    .map((s, i) => `<button data-sort="${i}" class="${i === state.sortIdx ? 'active' : ''}" role="option">${s.label}</button>`)
    .join('');
}
function toggleSortMenu() {
  const m = $('sortMenu');
  if (m.classList.contains('hidden')) {
    renderSortMenu();
    m.classList.remove('hidden');
    $('sortBtn').setAttribute('aria-expanded', 'true');
  } else {
    closeSortMenu();
  }
}
function closeSortMenu() {
  $('sortMenu').classList.add('hidden');
  $('sortBtn').setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------------------
// 이벤트 배선(위임)
// ---------------------------------------------------------------------------
function wire() {
  $('categoryTabs').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-group]'); if (!t) return;
    state.group = t.dataset.group; state.watchOnly = false; state.query = ''; $('search-input').value = '';
    state.chip = GROUPS[state.group]?.[0]?.tagId || null; state.chipsExpanded = false; state.visibleCount = PAGE;
    renderHome();
  });
  $('chips').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-idx]'); if (!t) return;
    const clicked = GROUPS[state.group][Number(t.dataset.idx)];
    if (state.chip === clicked.tagId) {
      // 활성 칩 재클릭 → 필터 해제(전체) + 시가총액순 재정렬
      state.chip = null;
      state.sortIdx = SORT_MARKETCAP;
    } else {
      state.chip = clicked.tagId;
    }
    state.visibleCount = PAGE;
    renderChips(); renderTagBriefs(); renderList();
  });
  $('chipsToggle').addEventListener('click', () => { state.chipsExpanded = !state.chipsExpanded; renderChips(); });
  $('search-input').addEventListener('input', (ev) => {
    state.query = ev.target.value; state.watchOnly = false; state.visibleCount = PAGE; renderHome();
  });
  // 정렬: 클릭 시 드롭다운
  $('sortBtn').addEventListener('click', (ev) => { ev.stopPropagation(); toggleSortMenu(); });
  $('sortMenu').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-sort]'); if (!t) return;
    state.sortIdx = Number(t.dataset.sort); state.visibleCount = PAGE; closeSortMenu(); renderList();
  });
  document.addEventListener('click', closeSortMenu);
  $('moreBtn').addEventListener('click', () => { state.visibleCount += PAGE; renderList(); });
  $('etfList').addEventListener('click', (ev) => {
    const star = ev.target.closest('[data-star]');
    if (star) { ev.stopPropagation(); toggleWatch(star.dataset.star); renderList(); return; }
    const row = ev.target.closest('[data-code]');
    if (row) openDetail(row.dataset.code);
  });
  $('periods').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-period]'); if (!t) return;
    state.period = t.dataset.period; renderPeriods(); renderChart();
  });
  $('detailTabs').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab]'); if (!t) return;
    state.detailTab = t.dataset.tab; renderDetailTabs(); renderDetailBody();
  });
  $('detailStar').addEventListener('click', () => { if (state.etf) { toggleWatch(state.etf.code); } });
  $('ctaWatch').addEventListener('click', () => { if (state.etf) { toggleWatch(state.etf.code); } });
  $('ctaBuy').addEventListener('click', () => ctaNotice('실제 주문 기능은 후속 PoC 범위입니다.'));
  $('ctaSell').addEventListener('click', () => ctaNotice('실제 주문 기능은 후속 PoC 범위입니다.'));
  $('bottomNav').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-nav]'); if (!t) return;
    const k = t.dataset.nav;
    if (k === 'home') { state.watchOnly = false; state.query = ''; $('search-input').value = ''; state.visibleCount = PAGE; renderHome(); }
    else if (k === 'watch') { state.watchOnly = true; state.query = ''; $('search-input').value = ''; state.visibleCount = PAGE; renderHome(); }
    else { ctaNoticeHome('해당 메뉴는 후속 PoC 범위입니다.'); }
  });
}
function ctaNoticeHome(msg) {
  let n = document.querySelector('#home .cta-notice');
  if (!n) { n = document.createElement('div'); n.className = 'cta-notice'; n.style.bottom = '72px'; n.setAttribute('role', 'status'); $('home').appendChild(n); }
  n.textContent = msg; clearTimeout(ctaNoticeHome._t); ctaNoticeHome._t = setTimeout(() => n.remove(), 2200);
}

// ---------------------------------------------------------------------------
// 부트스트랩
// ---------------------------------------------------------------------------
window.__explore = { showHome };

async function main() {
  const [data, tagMapLoaded, briefPayload] = await Promise.all([loadData(), loadExploreTagMap(), getTagBriefs()]);
  DATA = data;
  tagBriefs = briefPayload.taxonomyVersion === TAG_MAP?.taxonomyVersion ? briefPayload.briefs : [];
  etfByCode = new Map(DATA.etfs.map((e) => [e.code, e]));
  stockById = new Map((DATA.stocks || []).map((s) => [s.id, s]));
  holdingsByEtfId = new Map();
  (DATA.holdings || []).forEach((h) => {
    if (!holdingsByEtfId.has(h.etfId)) holdingsByEtfId.set(h.etfId, []);
    holdingsByEtfId.get(h.etfId).push(h);
  });
  if (!tagMapLoaded) {
    state.group = null;
    state.chip = null;
  }
  wire();
  renderHome();
  loadEtfHoldingsData(); // 구성종목 JSON 미리 로드(캐시)
  loadEtfMeta(); // 메타데이터 JSON 미리 로드(캐시)
}
main();
