# 역검색 (Reverse Search) 모듈

## 사용자 결과

키워드 검색이 아니라 **의도 기반 질의**로 ETF를 찾는다. 예:
- "SK하이닉스 비중높은 ETF?" → 해당 종목 비중이 높은 순 상위 10개
- "고배당 ETF" → 태그 매칭 상위 10개
- "반도체 중에서 거래량 많은 ETF" → 태그로 거른 뒤 시황 지표로 정렬

각 결과에는 30자 내외의 정량적 근거(예: "SK하이닉스 비중 30.2%", "고배당 태그 매칭(신뢰도 65%)")가 붙는다. 결과가 없거나 조건을 모두 만족하는 ETF가 없으면 가장 가까운 결과를 보여주고 그 사실을 안내 문구로 명시한다(허구 데이터 생성 없음, 상단 상태 배너로 표시).

## 소유 파일

```
modules/reverse-search/
  index.html          # 독립 실행 진입점(390px, http로만 정상 동작)
  src/dictionary.js    # 태그 동의어(56개 태그 커버) · 종목 별칭 · 정렬지표 사전 — PoC 하드코딩
  src/text.js          # 텍스트 정규화 유틸
  src/nlu.js           # 질의 → intent 파서(순수 함수)
  src/adapters.js      # 기존 데이터 read-only fetch + 인덱스 구축
  src/ranker.js        # intent별 상위 10개 랭킹 + 근거 생성(순수 함수)
  src/app.js           # DOM 와이어링
  src/styles.css       # 모듈 전용 스타일(민트 액센트, explore.css 미의존)
  tests/*.test.mjs      # nlu.js/ranker.js 단위테스트(node --test)
```

`etf-explore.html`, `src/js/explore.js`, `src/js/explore.css`, `data/tagging/**`, `config/etf-tagging/**` 는 참조/fetch만 하며 수정하지 않는다.

## 입출력 계약

**입력**: 자연어 질의 문자열 1개(한글).

**출력**(`ranker.js`의 각 함수 반환 형태):
```js
{
  status: 'ok' | 'fallback' | 'empty',
  items: [{ code, name, evidence }],  // 최대 10개, evidence는 30자 내외
  note: '상단 상태 배너에 표시되는 안내 문구',
}
```

**intent 분류**(`nlu.js` `parseQuery(raw, stockNameIndex)` 반환):
- `STOCK_WEIGHT` — 종목명 인식 시. `public/data/etf-holdings.json`(427개 ETF, top10 구성종목+비중) 범위에서만 응답.
- `TAG_MATCH` — 섹터/전략/배당 키워드 인식 시. `data/tagging/etf-filter-map.json`(1,141개 ETF 전체) 태그 `score×confidence` 기준.
- `MARKET_SORT` — 거래량/수익률/변동성/보수 등 정렬 키워드 인식 시. `/api/bundle` 시황 필드(큐레이션 종목+Toss 실시간 연동 종목만 실값, 나머지는 결측 처리 후 커버리지 안내).
- `COMPOSITE` — 태그+정렬 키워드 동시 인식 시(태그로 거른 뒤 정렬).
- `UNKNOWN`/`EMPTY` — 인식 실패 시 거래대금 상위 기본 목록 + "의도를 파악하지 못했다" 안내.

## 데이터 소스 (모두 기존 파이프라인 산출물, 서버 변경 없이 그대로 fetch)

| 경로 | 용도 | 커버리지 |
|---|---|---|
| `/data/tagging/etf-filter-map.json` | 태그 매칭 | ETF 1,141개 전체 |
| `/data/tagging/etf-universe-index-names.json` | 표시용 코드→이름 마스터 | ETF 1,147개 |
| `/public/data/etf-holdings.json` | 종목 비중 매칭 + 종목명 사전 추출 | ETF 427개(top10 구성종목) |
| `/api/bundle` | 시황 정렬(거래대금/수익률/변동성/보수) | 큐레이션 24개 + Toss 실시간 연동 종목만 실값 |

서버(`server/**`)는 저장소 루트를 통째로 정적 서빙하므로 위 경로들은 `npm run serve` 상태에서 별도 API 추가 없이 그대로 동작한다.

## 실행 방법

```bash
npm run serve
# http://localhost:4173/modules/reverse-search/index.html  (390px 뷰포트로 확인)
```

단위 테스트(순수 함수만, 루트 `npm test`에는 포함하지 않음 — 통합 여부는 별도 논의):
```bash
node --test modules/reverse-search/tests/nlu-ranker.test.mjs
```

## 수용 기준 / 검증 결과

- [x] `npm test` 136/136 green 유지(기존 파이프라인 테스트 영향 없음).
- [x] 모듈 자체 단위테스트 9/9 pass(`nlu.js` intent 분류, `ranker.js` 랭킹/근거/폴백).
- [x] Playwright 390×844 실측: `SK하이닉스 비중높은 ETF?`(STOCK_WEIGHT), `고배당 ETF`(TAG_MATCH), `반도체 중에서 거래량 많은 ETF`(COMPOSITE), `아무말 대잔치`(UNKNOWN 폴백) 4가지 질의 모두 실데이터로 정상 렌더 확인.
- [x] 가로 스크롤 0 (`document.documentElement.scrollWidth === 390` = 뷰포트 너비와 정확히 일치).
- [x] 콘텐츠 정책: 유인·행동유도 표현 없음(수동 점검 — `tests/content-policy.test.mjs`는 현재 `src/js/*.js`만 스캔해 이 모듈은 대상 밖이지만 프로젝트 공통 원칙을 그대로 준수).
- [ ] Explore 화면 통합 — 범위 밖. 승인 후 별도 `feat/integrate-reverse-search` PR에서 진행.

## 알려진 한계 / 후속 과제

- **질의 해석은 규칙+사전 기반**(PoC 단계 하드코딩). 실제 서비스에 옮길 때는 서버사이드에서 실시간 LLM 해석(Anthropic API 등)으로 교체하는 것을 권장하되, `.env` API 키 등록·요청당 비용/지연이 발생하므로 별도 설계가 필요하다. `nlu.js`의 반환 계약(`{intent, ...payload}`)만 유지하면 `ranker.js`/`app.js`는 손대지 않고 교체 가능.
- **종목 비중 질의는 427개 ETF로 제한**(전체 1,141개 중 나머지 714개는 구성종목 데이터 없음 — 결과 상단 배너에 커버리지 항상 명시).
- **시황 정렬 질의는 커버리지가 좁음**(큐레이션 24개 + Toss 실시간 연동 종목). 전체 유니버스 기준 시황 정렬을 지원하려면 데이터 파이프라인 확장이 선행돼야 한다.
- 종목명 별칭 사전(`dictionary.js`의 `STOCK_ALIASES`)은 자주 쓰이는 10여 개만 수동 등록한 상태. 확장 필요.
