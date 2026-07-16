# Integration Prompt — 태그 브리핑을 etf-explore.html로 재타겟 (렌더링만)

> 이 문서를 codex(또는 새 세션)에 붙여넣어 실행하세요. 작업 폴더: `C:\Users\tleod\projects\etf-hub-main-poc`.
> **핵심: 태그 브리핑 파이프라인/데이터는 이미 완성돼 있다. 이 작업은 "렌더링을 index.html →
> etf-explore.html 로 옮기는 것"뿐이다. 스코어링/택소노미/픽스처는 건드리지 않는다.**

---

## 0. 지금 상태 (이 프롬프트 작성 시점)

- 태그 브리핑 파이프라인이 이미 `feat/etf-metadata-pipeline` 브랜치에 통합돼 있고 **`index.html`(메인 허브)** 에서 렌더된다.
- taxonomy **v2.0.0** 로 맞춰져 있고, `npm test` **136/136 green**.
- 발행 브리핑 **6건**(`data/fixtures/tag-briefs.json`, `taxonomyVersion: 2.0.0`, 전부 `generator: "manual-sample"`):
  `sector.semiconductor`(ETF 45) · `sector.aerospace_defense`(10) · `sector.ev_battery`(20) ·
  `sector.shipbuilding`(8) · `strategy.benchmark.sp500`(57) · `asset.bond`(221).
- **문제의식**: 이 브리핑은 원래 `etf-explore.html`(탐색→상세, iM 디자인) 화면에 있어야 했는데, 넘겨받은
  이전 프롬프트가 "hub feed"라고 지정해서 `index.html` 에 붙었다. 이제 explore로 옮긴다.

## 1. 재사용 (절대 다시 만들지 말 것 · 읽기 전용)

이 파일들은 **화면과 무관**하다. 그대로 소비만 한다:
- `data/fixtures/tag-briefs.json` — 발행된 브리핑(제목/summary/keyPoints/sourceArticles/relatedEtfIds/mentionedStockIds/tagCategory/universeSnapshot 등). **손대지 말 것.**
- `src/js/tag-brief/**`(universeAdapter/assign/generate/policyGate) 과 `scripts/build-tag-briefs.js` — 파이프라인. **손대지 말 것.**
- `config/etf-tagging/**`, `data/tagging/**` — 택소노미/필터맵. **손대지 말 것.**
- 브리핑을 다시 굽고 싶으면 `npm run build:tag-briefs` (수기 콘텐츠 재조립일 뿐, LLM 호출 아님) — 이번 작업엔 불필요.

## 2. etf-explore.html / explore.js 구조 (렌더 붙일 곳)

- `etf-explore.html`: `#home`(탐색: `#categoryTabs` 탭 / `#chips` / `#search-input` / `#etfList`) 과
  `#detail`(상세: 차트 + `#detailTabs` 요약/구성종목/수익률/배당) 두 스크린, 하단 `#bottomNav`.
- `src/js/explore.js`: `loadData()`(= `dataSource.loadData`, `/api/bundle`→실패 시 fixture) 로 ETF 목록을 받는다.
  홀딩스/메타는 **어댑터 경계** `getEtfHoldings(code[,name])`, `getEtfMeta(code)` 로만 접근(UI는 CSV/경로 모름).
  렌더 함수: `renderHome()` = `renderCategory`+`renderChips`+`renderList`+`renderNav`. 상세는
  `renderDetailTabs`/`renderDetailBody`/`renderSummaryTab`/`renderHoldingsTab`/`renderReturns`/`renderDividendTab`.
- `src/styles/explore.css` — iM 디자인 토큰 + Spoqa Han Sans Neo. 새 스타일은 여기에.
- **http 로 서빙해야 함**(`npm run serve` → `http://localhost:4173/etf-explore.html`). `file://` 는 빈 화면.

## 3. 이번에 할 것

### (a) 어댑터 하나 추가 — `getTagBriefs()`
`explore.js` 안에 `getEtfHoldings`/`getEtfMeta` 와 같은 스타일로 추가:
- `fetch('/data/fixtures/tag-briefs.json')` → 실패/`file://` 시 `[]` 로 조용히 폴백(캐시 1회).
- 반환은 `payload.briefs` 배열. UI는 이 어댑터만 호출하고 픽스처 경로/스키마를 다른 곳에서 알지 못하게 한다.

### (b) explore 화면에 렌더 — **배치는 아래 [decision needed] 참고**
iM 디자인(explore.css 토큰)으로 브리핑 카드를 그린다. 카드 구성: 카테고리 배지(자산군/섹터/전략/배당) ·
제목 · summary · keyPoints(불릿) · 근거기사 `<details>` · 관련 ETF 칩.
- `index.html` 의 `renderTagBriefList`(src/js/render.js) 를 **참고만** 하고, explore 톤으로 새로 작성(그 함수를 import 하지 말 것 — render.js는 메인 허브 전용).

### (c) ⚠️ 칩 상한 (필수 · 지금 index에서 발생 중인 버그)
`relatedEtfIds` 를 **전부** 칩으로 그리면 채권 221개·S&P500 57개 등 총 361개가 쏟아진다(카드 하나가 화면을 삼킴).
**상위 6~8개만 칩으로 + "외 N개" 요약**으로 제한할 것. 칩 클릭 시 explore의 해당 ETF **상세 화면으로 이동**
(explore의 ETF는 `code` 로 매칭; `relatedEtfIds` 는 단축코드다 → 코드→ETF 매핑 후 상세 진입 플로우 재사용).

### (d) index.html 정리 — **[decision needed from user]**
사용자에게 물어서 하나 선택:
- **explore로 이전 + index에서 제거**: `index.html` 의 `<section class="tag-brief-section">`, `src/js/app.js` 의
  `loadTagBriefs`/`tagBriefs`/`renderTagBriefSection` 및 호출, `src/js/render.js` 의 `renderTagBriefList` +
  `TAG_CATEGORY_LABEL`, `src/styles/main.css` 의 `.tag-brief-*` 규칙을 되돌린다.
- **둘 다 유지**: index 건 그대로 두고 explore에만 추가.
- 기본 권장: 사용자 의도가 "explore에서 해야 했다" 이므로 **이전 + index 제거**를 권장하되, 반드시 확인받고 진행.

## 4. 배치 위치 — [decision needed from user]
explore는 탐색→상세 구조라 브리핑이 들어갈 자리 후보가 있다. 사용자와 정할 것:
- **A. 홈 피드 섹션**: `#home` 하단(리스트 아래)에 "태그 브리핑" 카드 리스트. index와 유사, 가장 단순.
- **B. 하단 네비 탭**: `#bottomNav` 에 "브리핑" 탭 추가 → 별도 스크린. 탐색과 분리.
- **C. 상세 연동**: ETF 상세 요약 탭에서 "이 ETF가 속한 브리핑"을 보여줌(브리핑의 `relatedEtfIds` 에 해당 코드 포함 시).
  explore의 상세 화면과 가장 잘 붙는 방식(권장 후보), 단 매핑 로직 필요.
- 하나로 시작(추천: A 또는 C). 확정 전 사용자에게 A/B/C 물어볼 것.

## 5. 제약 (그대로 적용)
- 콘텐츠 정책: 유인·행동유도 표현 금지(추천/지금 사야/매수·매도 타이밍/목표가/자금 유입/유망/기회/주목할 만/대비해야 계열).
  `tests/content-policy.test.mjs` 는 `index.html` + `src/js/*.js` 를 스캔 → **`explore.js` 도 스캔 대상**이니 금칙어 넣지 말 것.
- 등락 = 상승 **빨강 `+`** / 하락 **파랑 `-`**. 브랜드 민트 `#00C7A9` 는 UI 액센트 전용(등락색과 혼용 금지).
- 뷰포트 **390×844**, 가로 스크롤 **0** 유지.
- 매수/매도는 explore의 기존 방침대로 **비활성 플레이스홀더**(실주문 없음). 브리핑엔 주문 버튼 넣지 말 것.
- `generator` 값은 정직하게 유지(가짜 모델명 금지). 라이브 생성/API키/실뉴스는 별개 범위(`NEXT_STEPS_LIVE_GENERATION.md` 참조) — 이번 작업 아님.

## 6. 하지 말 것
- `data/fixtures/tag-briefs.json`, `src/js/tag-brief/**`, `config/etf-tagging/**`, `data/tagging/**` 수정 금지.
- 기존 유닛 테스트를 green 만들려고 뜯어고치지 말 것. 실패하면 보고. (파이프라인 테스트는 화면 무관이라 그대로 통과해야 정상.)
- `master` 로 머지/원격 push 는 사용자 명시 승인 없이 금지.

## 7. 검증 & 보고
1. `npm test` — **136/136 green 유지**(태그 브리핑 테스트는 화면 무관이라 영향 없어야 함).
2. Playwright(MCP)로 `http://localhost:4173/etf-explore.html` **390×844**: 브리핑 카드 렌더 · 가로 스크롤 0 ·
   칩 상한(6~8 + "외 N개") 동작 · 칩 클릭 시 해당 ETF 상세로 이동 · iM 디자인/폰트 적용 확인.
3. 보고: (a) 추가/수정 파일, (b) 선택한 배치(4의 A/B/C)와 index 처리(3d), (c) 칩 상한 동작,
   (d) 발행 브리핑 6건이 explore에서 보이는 스크린샷, (e) 테스트 결과.
