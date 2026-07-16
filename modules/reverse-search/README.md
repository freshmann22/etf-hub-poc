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

### Query Plan 계약

자연어 해석기는 ETF를 직접 선택하지 않고 다음 구조의 검색 계획만 반환한다.

```json
{
  "version": "1.0",
  "intent": "TAG_MATCH",
  "tags": [
    {
      "tagId": "sector.semiconductor",
      "facet": "sector",
      "label": "반도체",
      "queryScore": 0.95,
      "mode": "required",
      "reason": "반도체 산업 노출을 직접 요청"
    }
  ],
  "sort": null
}
```

- `queryScore`: 질의와 태그의 연관도, `0..1`.
- `required`: 같은 facet 안에서는 OR, 서로 다른 facet 사이에서는 AND로 필터링.
- `preferred`: 필터링하지 않고 관련도 점수에 가산.
- `excluded`: 해당 태그가 부여된 ETF를 제외.
- 최종 관련도는 `queryScore × ETF tag score × ETF tag confidence`의 가중합이다.
- 모든 LLM 출력은 `config/etf-tagging/etf-taxonomy.json`으로 검증하며 미등록 태그는 폐기한다.
- `/api/reverse-search/plan`은 API 키가 없을 때 규칙 기반 계획을 같은 계약으로 반환한다.

### OpenRouter 설정

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
```

키는 서버의 `.env`에서만 읽으며 브라우저 응답과 설정 API에는 노출하지 않는다. OpenRouter 호출 또는 JSON 검증이 실패하면 동일 요청을 규칙 planner로 처리한다.

**intent 분류**(`nlu.js` `parseQuery(raw, stockNameIndex)` 반환):
- `STOCK_WEIGHT` — 종목명 인식 시. `public/data/etf-holdings.json`(427개 ETF, top10 구성종목+비중) 범위에서만 응답.
- `TAG_MATCH` — 섹터/전략/배당 키워드 인식 시. `data/tagging/etf-filter-map.json`(1,141개 ETF 전체) 태그 `score×confidence` 기준.
- `MARKET_SORT` — 거래량/수익률/변동성/보수 등 정렬 키워드 인식 시. `/api/bundle` 시황 필드를 사용하며, 지표별 결측값은 제외하고 커버리지를 안내한다.
- `COMPOSITE` — 태그+정렬 키워드 동시 인식 시(태그로 거른 뒤 정렬).
- `UNKNOWN`/`EMPTY` — 인식 실패 시 거래대금 상위 기본 목록 + "의도를 파악하지 못했다" 안내.

## 데이터 소스

| 경로 | 용도 | 커버리지 |
|---|---|---|
| `/data/tagging/etf-filter-map.json` | 태그 매칭 | ETF 1,141개 전체 |
| `/data/tagging/etf-universe-index-names.json` | 표시용 코드→이름 마스터 | ETF 1,147개 |
| `/public/data/etf-holdings.json` | 종목 비중 매칭 + 종목명 사전 추출 | ETF 427개(top10 구성종목) |
| `/api/bundle` | 시황 정렬(거래량/거래대금/수익률/변동성/보수) | 거래량은 공공데이터 최신 완료 거래일 기준 전체 유니버스. 다른 지표는 필드별 커버리지 상이 |

서버(`server/**`)는 저장소 루트를 정적 서빙하고 `/api/bundle`을 제공한다. 거래량 정렬은 bundle의 `volume` 공통 필드에 의존한다.

## 실행 방법

```bash
npm run review:reverse-search
# http://localhost:4174/modules/reverse-search/index.html  (390px 뷰포트로 확인)
```

단위 테스트(순수 함수만, 루트 `npm test`에는 포함하지 않음 — 통합 여부는 별도 논의):
```bash
npm run test:reverse-search
```

## 거래량 데이터 계약

- `거래량`은 `/api/bundle`의 `volume` 필드(주 단위)를 사용한다.
- `거래대금`은 `tradingValue` 필드(억원 단위)를 사용하며 거래량과 별도로 정렬한다.
- `volume`은 `number | null`이며, 전체 ETF를 같은 기간으로 비교하기 위해 공공데이터의 최신 완료 거래일 값을 사용한다.
- Toss 일봉의 장중 거래량은 개별 ETF 가격 API에서만 제공하며 전체 유니버스 정렬에는 섞지 않는다.
- 값이 없는 ETF는 정렬에서 제외하고 결과 상단에 실제 집계 커버리지를 표시한다.

## 수용 기준 / 검증 결과

- [x] `npm test` 136/136 green 유지(기존 파이프라인 테스트 영향 없음).
- [x] 모듈 자체 단위테스트 9/9 pass(`nlu.js` intent 분류, `ranker.js` 랭킹/근거/폴백).
- [x] 파트너 초기 버전 Playwright 390×844 실측 완료.
- [ ] 거래량 계약 변경 후 390×844 브라우저 재검증. 현재 자동 브라우저 연결 불가로 보류.
- [x] 가로 스크롤 0 (`document.documentElement.scrollWidth === 390` = 뷰포트 너비와 정확히 일치).
- [x] 콘텐츠 정책: 유인·행동유도 표현 없음(수동 점검 — `tests/content-policy.test.mjs`는 현재 `src/js/*.js`만 스캔해 이 모듈은 대상 밖이지만 프로젝트 공통 원칙을 그대로 준수).
- [ ] Explore 화면 통합 — 범위 밖. 승인 후 별도 `feat/integrate-reverse-search` PR에서 진행.

## 알려진 한계 / 후속 과제

- **질의 해석은 규칙+사전 기반**(PoC 단계 하드코딩). 실제 서비스에 옮길 때는 서버사이드에서 실시간 LLM 해석(Anthropic API 등)으로 교체하는 것을 권장하되, `.env` API 키 등록·요청당 비용/지연이 발생하므로 별도 설계가 필요하다. `nlu.js`의 반환 계약(`{intent, ...payload}`)만 유지하면 `ranker.js`/`app.js`는 손대지 않고 교체 가능.
- **종목 비중 질의는 427개 ETF로 제한**(전체 1,141개 중 나머지 714개는 구성종목 데이터 없음 — 결과 상단 배너에 커버리지 항상 명시).
- 거래량은 전체 유니버스를 지원하지만 수익률·변동성·보수는 필드별 커버리지가 다르므로 결과 배너의 집계 수를 함께 확인해야 한다.
- 종목명 별칭 사전(`dictionary.js`의 `STOCK_ALIASES`)은 자주 쓰이는 10여 개만 수동 등록한 상태. 확장 필요.
