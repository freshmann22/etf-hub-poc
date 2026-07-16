# ETF 상세화면 더미값 → 실데이터 소스 점검

`reports/etf-explore-sample-data.csv`(더미/샘플 항목 감사표)를 기준으로, 각 항목을 실제로
크롤링할 수 있는지 점검한 결과. 069500(KODEX 200) 기준으로 라이브 검증함. 로그인/API키
필요 여부를 명확히 표기한다. **아직 파이프라인/파서는 구현하지 않았다.**

## 요약표

| CSV 항목 | 상태 | 검증된 소스 | 로그인/API키 | 비고 |
|---|---|---|:--:|---|
| 총 보수 | ✅ 해결 | WiseReport(`navercomp.wisereport.co.kr/v2/ETF/index.aspx`) `product_summary_data.TOT_PAY` | 불필요 | 실측값 `0.150`(%) — 페이지 내 인라인 JS 객체, 별도 AJAX 불필요 |
| 상장일 | ✅ 해결 | 위와 동일, `LIST_DT`("2002-10-14") / `FIRST_SETTLE_DT`(최초설정일) | 불필요 | 네이버 `item/main.naver`에도 동일 값 있음("2002년 10월 14일") — 이중 확인됨 |
| 운용사 | ✅ 해결 | 위와 동일, `ISSUE_NM_KOR`("삼성자산운용(주)") | 불필요 | 기존 "이름 접두사 추정"(KODEX→삼성) 방식 불필요, 실제 값 직접 확보 가능 |
| PER | ❌ 소스 없음 | — | — | 이번 점검 범위(네이버/WiseReport)에서 ETF에 PER 필드 자체가 없음. 개별 종목과 달리 지수 추종 ETF는 관례적으로 PER을 안 주는 것으로 보임(추정 아님 — 실제로 못 찾음) |
| PBR | ❌ 소스 없음 | — | — | PER과 동일 |
| 배당수익률 | ❌ 소스 없음 | — | — | ETF는 "배당"이 아니라 "분배금" 용어를 씀. 분배금수익률 필드는 이번 점검 소스들에 없음 |
| 배당(분배금) 지급 내역 | ⚠️ 부분 해결 | SEIBro(`seibro.or.kr`) "ETF종합정보" 화면에 "분배금 지급현황"(지급기준일/실지급일/분배금/과표기준가) 테이블 확인됨(직전 대화에서 화면 구조만 확인, 실제 검색 결과값은 이번 세션에서 브라우저 세션 문제로 재확인 못함) | 불필요(추정) | WiseReport는 분배금 "지급 스케줄 설명"(예: "매 1,4,7,10월 마지막 영업일...")만 있고 실제 지급 이력(날짜·금액)은 없음 — SEIBro 재확인 필요 |
| 5년 수익률 프레이밍 | ⚠️ 부분 해결 | WiseReport `status_data`(`ERN1/ERN3/ERN6/ERN12` = 1/3/6/12개월 수익률) | 불필요 | **5년치는 없음**, 최대 12개월. 기존 감사표에 "차트 값은 실데이터, 기간 라벨만 샘플"이라 적혀 있던 것과 일치 — 라벨을 "5년"이 아니라 실제 제공 기간(최대 1년)으로 정정하는 게 정직한 방향 |
| 1M 수익률 / 스파크라인 | (기존에도 Toss로 대부분 실데이터) | 그대로 Toss 유지 | — | 이번 점검 대상 아님(이미 실데이터화됨) |

## 상세 — WiseReport(navercomp.wisereport.co.kr) 페이지 구조

- 네이버 `finance.naver.com/item/coinfo.naver?code=069500` 안의 `<iframe>` 하나가
  `https://navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd=069500` 를 그대로 로드한다.
  즉 **네이버가 자체 데이터가 아니라 WiseReport(와이즈리포트/FnGuide 계열)의 ETF 카드를 iframe으로
  그대로 노출**하는 구조 — 크롤링은 iframe URL을 직접 GET하면 된다(네이버를 거칠 필요 없음).
- 이 페이지는 SPA가 아니라 **서버가 렌더링한 정적 HTML 안에 실제 값이 인라인 JS 객체로
  이미 박혀 있다**(예: `var product_summary_data = {...실제값...}; $("#...").tmpl(product_summary_data)...`).
  즉 추가 AJAX 호출 없이 `GET` 한 번 + 정규식/JSON 파싱만으로 끝난다 — 이번에 확인한 소스 중
  가장 파싱이 간단하다(TIGER AJAX 수준으로 쉬움, KODEX xls 파싱보다 쉬움).
- 확인된 인라인 데이터 블록: `summary_data`(요약), `status_data`(시세/수익률/베타/외국인비율),
  `product_summary_data`(총보수/상장일/운용사/기초지수/유동성공급자/회계기간),
  `CU_data`(구성종목 — 기존 네이버 크롤러 결과와 동일값, 교차검증됨),
  `stock_price_relative_chart_data`, `volume_chart_data`(가격/거래량 히스토리).
- 로그인/API키 전부 불필요. `Referer` 헤더 없이도 200 응답(느슨한 편).

## raw 증빙

`raw/2026-07-14/detail-screen-fields/`
- `wisereport_069500.html` — 위 인라인 데이터 전체 포함
- `naver_069500_full.html`, `naver_069500_coinfo.html` — 네이버 쪽 페이지 원본

## 남은 일 (구현 아직 안 함)

1. SEIBro "분배금 지급현황" 테이블을 실제 검색까지 실행해 실이력(날짜·금액) 확보 가능한지 재확인.
2. PER/PBR/배당수익률은 이번 점검 소스에 없다는 게 최종 결론인지, 아니면 다른 소스(ETF CHECK,
   KRX PER/PBR/배당수익률 메뉴 — 로그인 게이트로 이미 막힌 것으로 확인됨)에 있는지 추가 확인 필요.
3. "5년 수익률" 라벨을 실제 제공 기간(최대 12개월)에 맞게 정정할지, 아니면 5년 캔들을 계산해서
   자체 산출할지 결정 필요(WiseReport `stock_price_relative_chart_data`가 과거 시세 시계열을
   주므로 충분히 긴 기간이면 자체 계산 가능해 보이나 실측 범위 미확인).
