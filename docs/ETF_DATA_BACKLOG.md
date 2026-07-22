# ETF 데이터 백로그

단일 백로그 파일. 각 항목은 `ID / 과제 / 배경 / 우선순위 / 진입 조건 / 완료 조건 / 의존성 / 상태 / 이번 작업 처리 결과` 를 갖는다.
근거 데이터: `reports/pykrx-benchmark-summary.json`, `reports/pykrx-benchmark-results.csv`, `reports/pykrx-failures.csv`.

## 이번 작업 판단 요약 (pykrx 벤치마크)

- 대표 13종 성공률 **0%** (전부 EMPTY). OHLCV 는 정상이나 `get_etf_portfolio_deposit_file`(구성자산 PDF)만 구조적 EMPTY.
- → **pykrx 를 1차 provider 로 쓰기 어려움**(재검토 상태). **전수 dry-run 미수행**(진입 기준 80% 미충족).
- → **KRX_DIRECT / 정식 구성종목 소스 = 최우선**. **repository↔UI 연결 = 차단**(구성종목 실소스 확보 전까지).
- 참고: 이미 연동된 공공데이터포털(증권상품시세정보)은 시세·순자산·기초지수만 제공하고 **구성종목은 미제공**.
- (2026-07-14 추가 판단) `openapi.krx.co.kr`(AUTH_KEY 기반) 전체 API 카탈로그를 확인한 결과 **ETF 구성종목 API 자체가 없음** — BL-06 중단. `data.krx.co.kr` 웹 화면 경로도 로그인 필수로 중단(BL-13). **남은 정식 경로는 BL-07(SEIBro/운용사/금투협) 뿐**이며, 이 조사가 새 최우선 과제다.

## 상태 요약

| ID | 과제 | 우선순위 | 상태 |
|---|---|---|---|
| BL-01 | 영업일 자동보정 + 날짜 메타데이터 | Med | **DONE** |
| BL-02 | JSON Schema validator 미지원 키워드 가드 | Med | **DONE** |
| BL-03 | 계약 문서 경미 6항목 보강 | Low | **DONE** |
| BL-04 | pykrx 대표 표본 실호출 벤치마크 | High | **DONE** |
| BL-05 | 실패 리포트/집계 산출물 | Med | **DONE** |
| BL-06 | KRX_DIRECT 구성종목 실수집기 | High | **중단** |
| BL-07 | 정식/대체 구성종목 소스 조사(SEIBro·운용사·금투협) | **High(승격)** | **DONE** |
| BL-08 | pykrx 재평가(버전/엔드포인트 복구 점검) | Low(재검토) | OPEN |
| BL-09 | repository ↔ ETF UI 연결 | High | **PARTIAL(TIGER)** |
| BL-10 | 국내 ETF 전수 dry-run | Blocked | OPEN |
| BL-11 | SEIBro 실연동 | Low(조건부) | OPEN |
| BL-12 | 운용사별 수집기 | High | **IN PROGRESS(KODEX/TIGER 완료)** |
| BL-13 | KRX Data Marketplace 웹 직접 수집(스파이크) | Low(재검토) | **중단** |

---

## 완료 항목 (이번 작업 처리)

### BL-01 · 영업일 자동보정 + 날짜 메타데이터
- 배경: 요청일이 주말/휴일/미확정이면 직전 영업일 데이터를 써야 한다.
- 완료 조건: requestedDate→직전 영업일 후퇴 로직 + `dateResolution{requestedDate,resolvedBaseDate,lookbackDays,status}` 출력 + 오프라인 테스트.
- 상태: **DONE**
- 처리 결과: `scripts/collect_etf_holdings.py` 에 순수 리졸버 `resolve_base_date(fetch_fn 주입)` 추가(EXACT/RESOLVED_PRIOR/UNRESOLVED/NOT_ATTEMPTED). `scripts/test_date_resolution.py` 8/8 통과. 스키마에 optional `dateResolution` 필드(하위호환) + `DATE_RESOLUTION_STATUS` enum 추가.

### BL-02 · validator 미지원 키워드 가드
- 배경: 자체 무의존 validator 가 미지원 키워드를 조용히 무시하면 검증 공백 발생.
- 완료 조건: 지원 키워드 중앙 정의 + 미지원 키워드 탐지/표면화 + 테스트.
- 상태: **DONE**
- 처리 결과: `schemaValidator.js` 에 `checkSchemaSupport()` + `SUPPORTED_KEYWORDS`, 로드 시 `console.warn`(strict 모드에서 throw). 번들 스키마 미지원 키워드 0 확인. 스키마 테스트 16/16.

### BL-03 · 계약 문서 경미 보강
- 완료 조건: isFallback(mock), WEIGHT_MISSING 정의·채택, validator 키워드 범위, 비중합계 허용오차, requestedDate↔resolvedBaseDate 6항목.
- 상태: **DONE** — `docs/ETF_DATA_CONTRACT.md` §8 추가.

### BL-04 · pykrx 대표 표본 벤치마크
- 완료 조건: 유형별 대표 표본 실호출 + 성공/실패 집계 + 파일 산출.
- 상태: **DONE** — `scripts/pykrx_benchmark.py`, `reports/pykrx-benchmark-results.csv`, `reports/pykrx-benchmark-raw.json`. 13종 전부 EMPTY.

### BL-05 · 실패 리포트/집계
- 완료 조건: summary/failures 산출 + 유형·운용사·상태별 집계 + dry-run 판단.
- 상태: **DONE** — `reports/pykrx-benchmark-summary.json`, `reports/pykrx-failures.csv`.

---

## 잔여 항목 (진입/완료 조건 명시)

### BL-06 · KRX_DIRECT 구성종목 실수집기 — **중단(하위 경로 소진)**
- 배경: pykrx 구성자산 경로가 구조적으로 막혀(0%), 구성종목 확보에 정식 경로 필요. KRX 정보데이터시스템(openapi.krx.co.kr)은 로그인 후 AUTH_KEY 로 서비스별 조회.
- 진입 조건: (1) KRX Open API 회원가입·AUTH_KEY 발급, (2) ETF 구성종목(PDF/포트폴리오) 제공 서비스 존재 확인.
- 완료 조건: `providers/... KRX_DIRECT` 가 실 구성종목을 반환하고 공통 스키마 검증 통과, 대표 표본 성공률 측정(≥80% 시 UI 연결 승격).
- 의존성: AUTH_KEY(사용자 발급). 이번 작업에서 구현하지 않음(§5).
- 참고(2026-07-14, `feat/krx-direct-scraper-spike`): `data.krx.co.kr` KRX Data Marketplace(웹 화면) 경로는 별도로 스파이크 검증함 → BL-13 참조, **중단**.
- **처리 결과(2026-07-14, AUTH_KEY 경로 사전 검토)**: 로그인 없이도 공개된 `openapi.krx.co.kr` "서비스 소개 → 서비스 목록"(전체 API 카탈로그, 7개 구분·전 API 명세 확인 가능)을 확인한 결과, **ETF 구성종목/PDF(Portfolio Deposit File) API 는 존재하지 않는다.** 증권상품 카테고리는 `etf_bydd_trd`(ETF 일별매매정보) 1건뿐이며 출력 필드가 종가·NAV·거래량·기초지수 등 시세 항목뿐(비중/계약수/구성종목 없음) — 이미 연동된 공공데이터포털과 사실상 중복. 지수/주식/채권/파생/일반상품/ESG 를 포함한 **전체 카탈로그 어디에도 구성종목·portfolio 관련 API 가 없다.** 추가로 KRX Open API 공지(2026-06-01, "미제공 데이터에 대한 안내")는 **pykrx 등 비공식 사설 라이브러리 이용을 명시적으로 금지**하고, 카탈로그에 없는 데이터는 KRX Data Marketplace 화면 이용 또는 유료 데이터 구매로 안내한다(화면은 BL-13 에서 로그인 필수로 확인됨; 유료 구매 페이지도 로그인 필수).
- → **AUTH_KEY 발급을 진행해도 ETF 구성종목은 얻을 수 없다.** 이 경로는 완전히 소진되었다고 판단, **중단**.
- 남은 선택지: (1) BL-07 대체 소스(SEIBro/운용사 공시/금투협), (2) KRX Data Marketplace 유료 데이터 구매(사람이 로그인·결제 필요, 라이선스 검토 필요), (3) 사용자가 로그인 세션을 제공하면 BL-13 재개.

### BL-07 · 정식/대체 구성종목 소스 조사 — Med
- 배경: KRX_DIRECT 불충분 대비 대체 소스(SEIBro 구성내역, 운용사 PDP/정기공시, 금융투자협회).
- 진입 조건: BL-06 결과 불충분 또는 커버리지 부족 확인 시.
- 완료 조건: 소스별 제공범위·라이선스·호출조건 조사표 + 우선순위 결정.
- 의존성: BL-06 결과.
- **처리 결과(2026-07-20)**: `spikes/krx-direct/AMC_FEASIBILITY.md`의 실측을 재검증했다.
  KODEX와 TIGER 운용사 공식 공개자료가 로그인/API 키 없이 전체 구성종목을 제공한다. 구현 우선순위는
  표준 ISIN을 계산해 바로 호출 가능한 TIGER → 별도 `fId` 매핑이 필요한 KODEX → 나머지 운용사 순으로 확정했다.
  TIGER 숫자 단축코드 대표 10종을 재호출해 10/10 성공(2~204행)했으며 BL-12 구현으로 이어졌다.
- 상태: **DONE**(소스별 제공범위·호출조건·우선순위 결정 완료).

### BL-08 · pykrx 재평가 — Low(재검토 상태)
- 배경: 현재 `get_etf_portfolio_deposit_file` 구조적 EMPTY(pykrx 1.0.51). KRX PDF 경로 변경 가능성.
- 진입 조건: pykrx 신버전 릴리스 또는 KRX PDF 응답 복구 징후.
- 완료 조건: 동일 표본 재벤치마크로 성공률 재측정.
- 의존성: 외부(pykrx/KRX) 변화.

### BL-09 · repository ↔ ETF UI 연결 — Blocked
- 배경: 바텀시트 구성종목을 fixture 대신 repository 로 대체(연결 지점 `renderBottomSheet` topHoldings).
- 진입 조건: 구성종목 실데이터 소스 1개 이상이 대표 표본 성공률 ≥80% 달성(BL-06/07).
- 완료 조건: UI 가 repository 인터페이스만으로 구성종목 표시, 실패 시 정직한 빈/오류 상태.
- 의존성: BL-06 또는 BL-07. **현재 차단**(실소스 0%).
- **진행 결과(2026-07-20)**: Explore 구성종목 탭이 `/api/etf/:code/holdings`의
  `issuer_tiger` 응답을 우선 사용하고, 미지원 종목은 기존 CSV 스냅샷으로 폴백하도록 연결했다.
  TIGER 숫자 단축코드 범위에서는 차단 해제. 전체 운용사 연결은 BL-12 후속 구현 대기.

### BL-10 · 국내 ETF 전수 dry-run — Blocked
- 진입 조건: 표본 성공률 ≥80% + 구조적 전면 실패 없음 + 차단 징후 경미(§2.3).
- 완료 조건: 성공/실패 종목 구분 저장 + 중단 사유 기록.
- 상태: 이번 작업 표본 0% → **미수행**. 의존성: BL-06/07/08.

### BL-11 · SEIBro 실연동 — Low(조건부)
- 진입 조건: BL-07 조사에서 SEIBro 가 필요·가능으로 판정.
- 완료 조건: SEIBro provider 실 구성종목 반환 + 약관/robots 확인.
- 의존성: BL-07.

### BL-12 · 운용사별 수집기 — Low(조건부)
- 진입 조건: KRX/SEIBro 로 커버되지 않는 운용사/상품 존재 확인.
- 완료 조건: 운용사별 파서 + 공통 스키마 정규화.
- 의존성: BL-06/07 결과.
- **진행 결과(2026-07-20)**: 미래에셋 공식 TIGER PDF 조회 provider 구현 완료.
  한국 ETF ISIN check digit 계산, HTML 표 파싱, 500행 상한, timeout/재시도/호스트 allowlist,
  명시적 `ISSUER_ENABLED` opt-in을 적용했다. 숫자 단축코드 대표 10종 100% 성공.
  신규 영문 혼합 단축코드는 단축코드만으로 ISIN을 계산할 수 없어 공공데이터 ISIN 매핑이 필요하다.
  삼성자산운용 KODEX도 공식 상품검색 API(`srchVal=단축코드`)로 `fId`를 동적 해석한 뒤
  공식 JSON PDF API를 조회하도록 구현했다. 숫자·영문 혼합 대표 10종 10/10 성공했으며,
  500행 초과 ETF 3종도 상한 조정 후 505~510행 전체 반환을 확인했다.
  남은 범위는 KBSTAR/RISE·ACE·SOL·HANARO·KOSEF 등 다른 운용사다.

### BL-13 · KRX Data Marketplace 웹 직접 수집(스파이크) — Low(재검토), **중단**
- 배경: `data.krx.co.kr` ETF PDF 메뉴(웹 화면) 요청을 직접 재현할 수 있는지 별도 브랜치
  (`feat/krx-direct-scraper-spike`)에서 검증. 결과: `spikes/krx-direct/README.md`.
- 처리 결과: 익명 요청이 서버에서 419바이트 alert+redirect 스텁만 받고 로그인 페이지로
  넘어감(ETF PDF 메뉴뿐 아니라 일반 ETF 조회 메뉴도 동일 — 사이트 전반이 로그인 요구로
  정책 변경된 것으로 추정). 로그인 페이지 자체가 별도 보안프로그램 설치를 요구.
  안전 원칙에 따라 로그인·설치 우회를 시도하지 않고 §16 "중단" 기준에서 정지.
- 재진입 조건: 사용자가 KRX Data Marketplace 로그인 세션의 Copy-as-cURL 을 직접 제공하는
  경우에만 재개. 세션 쿠키는 `spikes/krx-direct/config.json`(gitignore)에만 보관.
- 완료 조건: 재개 시 §7~§11(단일 ETF 재현 → 표본 → 동시성) 순서로 진행, 표본 성공률
  ≥80% 확인.
- 차단 사유: 로그인 필수(자동 수집 대상 아님). AUTH_KEY 기반 정식 API(`openapi.krx.co.kr`,
  BL-06)가 이 문제를 우회 없이 해결하는 유일한 공식 경로.
- 의존성: 없음(사용자 입력 대기).
