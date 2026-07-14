# INTERFACE_CONTRACT — ETF 허브 메인화면 PoC

이 문서는 구현(Claude)과 테스트(Codex)가 공통으로 따르는 유일한 기준이다.
Codex는 구현 파일을 보지 않고 이 문서만으로 테스트를 작성한다.
이 문서와 다른 문서가 충돌하면 Fable이 이 문서를 수정한다(임의 해석 금지).

## 0. 모듈·실행 방식

- 언어: 순수 HTML/CSS/JavaScript (ES 모듈). 외부 패키지·CDN·외부 요청 전면 금지.
- `package.json`에 `"type": "module"` 이 설정되어 있다 (Fable 소유, 수정 금지).
- 순수 로직은 `src/js/logic.js` 에서 named export 한다. DOM·window 접근 금지
  (Node 환경에서 import 가능해야 한다).
- 샘플 데이터는 `src/js/data.js` 에서 named export 한다. DOM 접근 금지.
- 테스트는 Node 내장 러너로 실행한다: `node --test tests/`
- 테스트의 구현 import 허용 범위:
  - `tests/logic.test.mjs` → `../src/js/logic.js` 만 import. 픽스처는 테스트 파일 안에 자체 정의.
  - `tests/data-integrity.test.mjs` → `../src/js/data.js` (읽기 전용 검증 대상) 및 필요 시 `../src/js/logic.js`.
  - `tests/content-policy.test.mjs` → 모듈 import 없이 `node:fs` 로 파일 텍스트를 읽어 검사.
- `src/js/render.js`(DOM 렌더링)와 `src/js/app.js`(상태·이벤트 연결)는 브라우저 전용이며
  자동 테스트 대상이 아니다 (S9 Playwright에서 검증).

## 1. 데이터 스키마 — `src/js/data.js` 의 export

모든 수치 필드에서 값이 없는 경우는 `null` 로 표현한다 (0, undefined, 빈 문자열 금지).

### 1.1 `export const etfs` — ETF 배열, **22개 이상**

```js
{
  id: string,            // 'etf-001' 형식, 고유
  code: string,          // 6자리 문자열, 고유. 예: '069500'
  name: string,          // 고유
  issuer: string,
  themeId: string,       // themes 의 id 참조 (반드시 존재)
  category: string,      // 예: '주식형', '채권형'
  currentPrice: number|null,        // 원
  changeRate1d: number|null,        // %, 소수. 예: 1.23, -0.45
  return1w: number|null,            // %
  return1m: number|null,            // %
  tradingValue: number|null,        // 억원 단위 정수
  tradingValueChangeRate: number|null, // 전일 대비 %, 예: 35.2
  netAssets: number|null,           // 억원 단위 정수
  totalFee: number|null,            // %, 예: 0.09
  volatilityScore: number|null,     // 0~100
  riskTags: string[],               // 예: ['레버리지'], 없으면 []
  summary: string,                  // 상품 특성 1~2문장 (금지 문구 사용 불가)
  topHoldings: string[]             // stocks 의 id 배열, holdings 관계와 일치해야 함 (rank 순)
}
```

- fallback 검증용으로 **최소 2개 ETF**에 일부 수치 필드 `null` 을 의도적으로 포함한다.
- null 을 포함하는 ETF도 `id/code/name/themeId` 는 항상 유효해야 한다.

### 1.2 `export const themes` — 테마 배열, **12개 이상**

```js
{
  id: string,            // 'theme-semi' 형식, 고유
  name: string,          // 고유. 예: '반도체'
  return1d: number,      // %
  return1w: number,
  return1m: number,
  tradingValue: number,          // 억원, 히트맵 카드 크기 기준
  tradingValueChangeRate: number, // %
  representativeEtfIds: string[], // etfs 참조, 1개 이상
  representativeStockIds: string[],
  issueSummary: string   // 시장 이슈 한 줄 (추정형 표현, 금지 문구 사용 불가)
}
```

- 기간(1d/1w/1m)별로 **수익률 1위 테마와 최하위 테마가 서로 달라지도록** 데이터를 구성한다
  (기간 전환 검증 목적).

### 1.3 `export const stocks` — 종목 배열, **12개 이상**

```js
{
  id: string,        // 'stock-005930' 형식, 고유
  code: string,      // 6자리, 고유
  name: string,      // 고유
  sector: string,
  changeRate1d: number,
  relatedEtfIds: string[]  // holdings 에서 파생, 관계와 일치해야 함
}
```

- 다음 6개 종목은 반드시 포함한다(종목 칩): 삼성전자, SK하이닉스, NAVER,
  한화에어로스페이스, 두산에너빌리티, 현대차.

### 1.4 `export const holdings` — ETF-종목 편입 관계 배열, **60건 이상**

```js
{ etfId: string, stockId: string, weight: number, rank: number }
```

- (etfId, stockId) 조합 중복 금지. `0 < weight <= 100`.
- 동일 etfId 내 rank 중복 금지, rank 는 1부터 시작.
- 한 ETF의 weight 합계는 100 이하이면 되고 100일 필요 없다.

### 1.5 `export const contents` — 콘텐츠 배열 (뉴스 8건+, 공시 3건+, 리서치 3건+)

```js
{
  id: string,
  type: 'news' | 'disclosure' | 'research',
  title: string,
  summary: string,        // 1~2문장 (금지 문구 사용 불가, 인과 단정 금지)
  publishedAt: string,    // ISO 8601, 예: '2026-07-10T09:30:00+09:00'
  relatedEtfIds: string[],   // etfs 참조 (존재해야 함)
  relatedStockIds: string[], // stocks 참조
  relatedThemeIds: string[], // themes 참조
  source: string|null
}
```

### 1.6 `export const marketSummaryByPeriod` — 기간별 시장 요약 객체

```js
{
  '1d': { asOf: string, advancers: number, decliners: number, unchanged: number,
          totalTradingValue: number, tradingValueChangeRate: number,
          strongestThemeId: string, weakestThemeId: string, summary: string },
  '1w': { ...같은 구조 },
  '1m': { ...같은 구조 }
}
```

- `advancers + decliners + unchanged === etfs.length` 이어야 한다.
- `strongestThemeId` 테마의 해당 기간 수익률은 `weakestThemeId` 테마보다 커야 한다.
- summary 에 자금 유입 표현 금지. 거래대금 변화는 "거래가 늘었어요" 계열로만 서술.

### 1.7 `export const comparisonSets` — 비교 세트 배열, **2개 테마 이상**

```js
{ themeId: string, etfIds: string[] }   // etfIds 3개 이상, 전부 해당 themeId 의 ETF
```

- 첫 번째 세트의 테마는 '반도체' 여야 한다.

## 2. 순수 로직 — `src/js/logic.js` 의 named export

공통 원칙:
- 모든 함수는 **인자로 받은 배열·객체를 변경하지 않는다** (새 배열/객체 반환).
- 데이터는 인자로 주입받는다 (`data.js` 를 logic.js 가 import 하지 않는다).
- 에러는 `throw new Error(메시지)` 이며 메시지 문구는 아래에 확정된 문자열 그대로.

### 2.1 `getRankedEtfs(etfList, tab)`

- `tab`: `'gainers' | 'losers' | 'volume' | 'volatility'`
- 정렬 키:
  - `gainers`: `changeRate1d` 내림차순
  - `losers`: `changeRate1d` 오름차순
  - `volume`: `tradingValueChangeRate` 내림차순
  - `volatility`: `volatilityScore` 내림차순
- **정렬 키가 `null` 인 ETF는 결과에서 제외한다.**
- 동률 처리: ① `tradingValue` 내림차순(null 은 최하위) ② `name` 유니코드 코드포인트
  오름차순 (`a.name < b.name ? -1 : 1`, localeCompare 사용 금지).
- `id` 기준 중복 제거 (첫 항목 유지).
- 잘못된 tab → `throw new Error('알 수 없는 순위 탭: ' + tab)`
- 빈 배열 입력 → `[]` 반환.

### 2.2 `getThemeHeatmap(themeList, period)`

- `period`: `'1d' | '1w' | '1m'`
- 반환: `{ themeId, name, returnRate, tradingValue, representativeEtfIds }` 배열.
  - `returnRate` 는 period 에 따라 `return1d`/`return1w`/`return1m` 값.
- 정렬: `tradingValue` 내림차순, 동률 시 `name` 코드포인트 오름차순.
- 잘못된 period → `throw new Error('알 수 없는 기간: ' + period)`

### 2.3 `getStrongWeakThemes(themeList, period)`

- 반환: `{ strongest, weakest }` — 각각 테마 객체(원본 참조 가능).
- 기준: period 수익률 최대/최소. 동률 시 `tradingValue` 내림차순 ① → `name`
  코드포인트 오름차순 ② 에서 앞서는 테마.
- 잘못된 period → `throw new Error('알 수 없는 기간: ' + period)`
- 빈 배열 → `{ strongest: null, weakest: null }`

### 2.4 `getEtfsByTheme(etfList, themeId)`

- 해당 `themeId` 의 ETF만 반환, `id` 중복 제거.
- 존재하지 않는 themeId·빈 문자열 → `[]` (throw 하지 않음).

### 2.5 `getEtfsByStock(etfList, holdingList, stockId)`

- 반환: `{ etf, weight, rank }` 배열 — `holdingList` 에서 `stockId` 가 일치하는
  관계만, `etf` 는 etfList 에서 찾은 객체.
- etfList 에 없는 etfId 관계는 **조용히 제외** (throw 금지).
- 정렬: `weight` 내림차순, 동률 시 etf `tradingValue` 내림차순 → etf `name` 코드포인트 오름차순.
- 동일 ETF 중복 제거. 존재하지 않는 stockId → `[]`.

### 2.6 `searchAll(dataset, query)`

- `dataset`: `{ etfs, stocks, themes }`
- 전처리: `query` 를 `String()` 변환 후 trim. 대소문자 무시(영문), 한글 부분 일치.
- trim 결과가 빈 문자열 → `{ etfs: [], stocks: [], themes: [], isEmptyQuery: true }`
- 매칭 대상: ETF `name`+`code`, 종목 `name`+`code`, 테마 `name`. 부분 일치(includes).
- 반환: `{ etfs: [...], stocks: [...], themes: [...], isEmptyQuery: false }`
  각 배열은 `id` 중복 제거, 원본 데이터 순서 유지.

### 2.7 `getComparison(etfList, holdingList, stockList, etfIds)`

- `etfIds` 중복은 첫 등장만 유지(throw 금지). etfList 에 없는 id 는 제외.
- etfList 에 같은 id 가 중복 존재하면 **첫 등장 항목을 기준으로 조회**한다
  (계약 공통 관례: 중복 id 는 항상 첫 항목 유지 — §2.1 과 동일).
- 반환: etfIds 순서대로 다음 객체 배열:

```js
{
  etfId, name,
  topHoldingNames: string[],       // rank 오름차순 상위 최대 3개 종목 name
  top2Concentration: number|null,  // rank 1·2 종목 weight 합. 관계가 2개 미만이면 null
  netAssets, tradingValue, totalFee, return1m   // ETF 필드 그대로 (null 허용)
}
```

### 2.8 `filterContents(contentList, type)`

- `type`: `'news' | 'disclosure' | 'research'`
- 해당 type 만, `publishedAt` 내림차순(최신 우선), 동률 시 `id` 코드포인트 오름차순.
- 잘못된 type → `throw new Error('알 수 없는 콘텐츠 유형: ' + type)`

### 2.9 `getMarketSummary(marketSummaryByPeriod, period)`

- 해당 period 의 요약 객체 반환.
- 잘못된 period → `throw new Error('알 수 없는 기간: ' + period)`

### 2.10 포맷·fallback 함수

- `formatSignedPercent(value)`
  - 유한한 수 → 소수 둘째 자리 고정, 양수는 `+` 접두. 예: `+1.23%`, `-0.45%`, `0.00%`
    (0은 부호 없음).
  - `null`/`undefined`/`NaN`/비유한 → `'정보 없음'`
- `formatKrw(value)` — 입력 단위: 억원 정수.
  - `value >= 10000` → `'N조 M억원'` (M은 천단위 콤마, M이 0이면 `'N조원'`). 예: `12345` → `'1조 2,345억원'`
  - `0 <= value < 10000` → `'M억원'` 천단위 콤마. 예: `3420` → `'3,420억원'`
  - `null`/`undefined`/`NaN`/비유한/음수 → `'정보 없음'`
- `formatPrice(value)` — 원 단위. 유한한 수 → 천단위 콤마 + `'원'`. 예: `10250` → `'10,250원'`.
  그 외 → `'정보 없음'`
- 어떤 fallback 도 `'0'` 이나 `0` 을 반환하지 않는다.

## 3. 화면 계약 (S9 Playwright 및 content-policy 기준)

### 3.1 필수 텍스트 (index.html 렌더 결과에 존재)

- 헤더 제목: `ETF`
- 샘플 고지(문자 그대로, 정적 HTML에 포함): `화면 내 정보는 PoC용 샘플 데이터입니다.`
- 검색 placeholder: `ETF, 종목, 테마를 검색해보세요`
- 검색 결과 없음 문구: `조건에 맞는 ETF를 찾지 못했어요.`
- 종목 역검색 결과 없음 문구: `이 종목을 담은 ETF를 찾지 못했어요.`
- 콘텐츠 없음 문구: `해당 유형의 콘텐츠가 없어요.`

### 3.2 금지 문구 — content-policy 검사 대상

검사 범위: `index.html`, `src/js/*.js` (문자열 리터럴 포함 전체 텍스트).
다음 부분 문자열이 **하나도 존재하지 않아야** 한다:

```
추천 ETF
ETF 추천
추천 테마
추천드
지금 사야
매수 타이밍
매도 타이밍
상승 가능성이 높
목표가격
목표수익률
자금 유입
자금이 유입
자금이 몰
돈이 몰
자금이 빠져
```

또한 `index.html` 에는 `매수`, `매도`, `주문` 텍스트를 가진 버튼이 없어야 한다.

### 3.3 DOM 구조 계약 (data-testid)

| testid | 요소 |
|---|---|
| `sample-notice` | 샘플 데이터 고지 |
| `search-input` | 통합 검색 input (label 또는 aria-label 필수) |
| `search-results` | 검색 결과 컨테이너 |
| `market-summary` | 오늘의 ETF 시장 섹션 |
| `heatmap` | 히트맵 섹션 |
| `heatmap-period-1d` / `-1w` / `-1m` | 기간 탭 버튼 (`aria-pressed` 또는 `aria-selected`) |
| `heatmap-card` | 히트맵 테마 카드 (복수) |
| `ranking-tab-gainers` / `-losers` / `-volume` / `-volatility` | 순위 탭 버튼 |
| `ranking-list` | 순위 ETF 카드 목록 |
| `etf-card` | ETF 카드 (복수, 클릭 시 바텀시트) |
| `stock-chip` | 종목 칩 (복수) |
| `stock-etf-results` | 종목→ETF 결과 컨테이너 |
| `theme-cards` | 주목할 테마 섹션 |
| `compare-section` | 비교 섹션 |
| `compare-etf-select` | 비교 대상 변경 컨트롤 (2026-07-10 개정: native select 강제 아님 — 칩 그룹 등 모바일 친화 컨트롤의 컨테이너에 부여) |
| `content-filter-news` / `-disclosure` / `-research` | 콘텐츠 필터 버튼 |
| `content-list` | 콘텐츠 카드 목록 |
| `bottom-sheet` | 프리뷰 바텀시트 (`role="dialog"`, `aria-label` 또는 `aria-labelledby`) |
| `bottom-sheet-close` | 닫기 버튼 |

### 3.4 접근성·반응형 계약

- `index.html` 에 `<meta name="viewport" content="width=device-width, initial-scale=1">` 포함.
- `src/styles/main.css` 에 `html` 또는 `body` 대상 `overflow-x: hidden` 규칙 포함.
- 모든 탭·필터 버튼은 활성 상태를 `aria-selected` 또는 `aria-pressed` 로 표현하고,
  활성 항목은 그룹 내 정확히 1개.
- 등락 표기는 색상 외에 `+`/`-` 부호를 항상 병기한다.
- 바텀시트: 닫기 버튼 + ESC + 배경 클릭으로 닫힘, 열릴 때 시트 내부로 포커스 이동.

## 4. 파일 소유권 (서로소 — 위반 시 산출물 거부)

- **Claude(구현) 전용**: `index.html`, `src/styles/main.css`, `src/js/data.js`,
  `src/js/logic.js`, `src/js/render.js`, `src/js/app.js`
- **Codex(검증) 전용**: `tests/logic.test.mjs`, `tests/data-integrity.test.mjs`,
  `tests/content-policy.test.mjs`
- **Fable 전용**: `EXECUTION_PLAN.md`, `INTERFACE_CONTRACT.md`, `MULTI_AGENT_RUN_LOG.md`,
  `package.json`, `scripts/dev-server.js`

## 5. 최소 기능 ↔ 계약 요소 1:1 대응표

| 브리프 최소 기능 | 계약 요소 |
|---|---|
| 통합 검색 UI | §2.6 `searchAll`, §3.1 placeholder·빈 상태, §3.3 `search-*` |
| 오늘의 ETF 시장 요약 | §1.6, §2.9 `getMarketSummary`, §3.3 `market-summary` |
| ETF 시장 히트맵 (기간 전환) | §1.2, §2.2 `getThemeHeatmap`, §2.3, §3.3 `heatmap-*` |
| 상승·하락·거래 급증·변동성 확대 | §2.1 `getRankedEtfs`, §3.3 `ranking-*` |
| 오늘 주목할 테마 | §1.2 `issueSummary`, §3.3 `theme-cards` |
| 종목→ETF 역검색 | §1.4, §2.5 `getEtfsByStock`, §3.3 `stock-*` |
| 같은 테마 ETF 비교 | §1.7, §2.7 `getComparison`, §3.3 `compare-*` |
| 뉴스·공시·리서치 카드 | §1.5, §2.8 `filterContents`, §3.3 `content-*` |
| ETF 프리뷰 바텀시트 | §3.3 `bottom-sheet*`, §3.4 접근성 |
| 모바일 반응형 | §3.4, S9 Playwright 3개 viewport |
| 누락 데이터 fallback | §1.1 null 규칙, §2.10 포맷 함수 |
| 샘플 데이터 고지 | §3.1 고지 문구 |
| 투자 유도 문구 금지 | §3.2 금지 목록 |
