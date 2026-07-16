# 리뷰 보고서 — pykrx 실데이터 가용성 검증 & 백로그 병렬 소진 (S16)

- **리뷰 일자**: 2026-07-14
- **리뷰 대상**: `ETF_PYKRX_BENCHMARK_BACKLOG_PROMPT.md` 지시 작업 — pykrx 구성자산 가용성 벤치마크, 영업일 보정, validator 가드, 리포트/백로그
- **리뷰어**: 총괄(Opus) / 구현: 병렬 서브에이전트 3(A·B·C) + 총괄(계약 pin·D 집계·통합)
- **방법**: 산출 코드/리포트 정독(pykrx_benchmark.py·collect_etf_holdings.py 리졸버·schemaValidator 가드·reports·backlog) + 전체 회귀 1회 + 파이썬 날짜테스트 + 교차 일관성 검사
- **대상 파일**: `scripts/pykrx_benchmark.py`, `scripts/collect_etf_holdings.py`, `scripts/test_date_resolution.py`, `server/holdings/schemaValidator.js`, `schemas/etf-holdings.schema.json`, `server/holdings/constants.js`, `docs/ETF_DATA_CONTRACT.md`, `docs/ETF_DATA_BACKLOG.md`, `reports/**`

---

## 1. 총평

**합격(승인 권장).** 스펙 §9 완료 조건을 모두 충족한다. 이번 작업의 최대 가치는 **정직한 경험적 결론**이다 — pykrx 의 ETF 구성자산 경로가 이 환경에서 **구조적으로 비어 있음**을 결정적 진단(OHLCV 정상 vs PDF EMPTY)으로 확증하고, 그에 따라 전수 dry-run 을 규칙대로 미수행하며, 후속 우선순위(KRX_DIRECT 최우선, UI 연결 차단)를 근거 숫자로 재조정했다. 독립 백로그(영업일 보정·validator 가드·문서·리포트)는 기록이 아니라 **실제 구현/산출까지 완료**되었다. **정확성 결함(블로커) 0건**, 경미 관찰 몇 건.

| 항목 | 결과 |
|---|---|
| 전체 회귀(최종 1회) | **98 / 98 통과** |
| 파이썬 날짜 리졸버 테스트 | **8 / 8** |
| DATE_RESOLUTION_STATUS 일관성 | constants ↔ schema ↔ python **3자 일치** |
| 리포트 파싱 | summary.json·raw.json·results.csv·failures.csv 모두 파싱 가능 |
| 데이터 위조 | **없음**(대표 13종 전부 실제 EMPTY) |
| 기존 UI/fixture | **무변경** |
| 발견 결함 | 블로커 0 · 경미/관찰 5 |

---

## 2. 스펙 완료 조건(§9) 대비 점검

| 영역 | 조건 | 상태 |
|---|---|---|
| 실데이터 | 유형별 대표 표본 선정 | ✅ 13종(9유형) |
| 실데이터 | 실제 pykrx 호출 수행 | ✅ raw/CSV 산출 |
| 실데이터 | 요청일 ↔ 유효 기준일 보정 구분 | ✅ requested/resolved/lookback 기록 |
| 실데이터 | 유형별 성공·실패 집계 | ✅ summary.byProductType |
| 실데이터 | 전수 dry-run 수행 여부 기준 결정 | ✅ 미수행(0%<80%) 기록 |
| 실데이터 | 성공률·실패 사유 파일 | ✅ summary/failures |
| 코드/계약 | 유효 영업일 자동 탐색 구현 | ✅ `resolve_base_date` |
| 코드/계약 | 날짜 메타데이터 반영 | ✅ `dateResolution`(수집기 출력+스키마 optional) |
| 코드/계약 | 미지원 키워드 가드 | ✅ `checkSchemaSupport`(warn/strict) |
| 코드/계약 | 계약 문서 경미 보강 | ✅ CONTRACT §8 |
| 코드/계약 | 기존 파이프라인 원칙 불변 | ✅ 하위호환·핵심 계층 무손상 |
| 백로그 | 독립 항목 실제 처리 | ✅ BL-01~05 DONE |
| 백로그 | 완료 DONE 반영 / 잔여 진입·완료조건 | ✅ BL-06~12 |
| 검증 | 변경영역 + 전체 1회 통과 / UI 불변 / Playwright 미실행 / 위조 없음 | ✅ |

---

## 3. 강점

1. **결정적 진단으로 근본원인 규명**: 같은 종목·기간에 `get_market_ohlcv`=4행인데 `get_etf_portfolio_deposit_file`=0행. "네트워크 문제"라는 흔한 오진을 배제하고 **엔드포인트 레벨 EMPTY** 로 특정. (`scripts/pykrx_benchmark.py:176-188`)
2. **정직성**: 전 종목 실제 EMPTY 를 그대로 기록, mock/fixture 대체 없음. 실패를 성공으로 포장하지 않음. (§2.1/§8 준수)
3. **규칙 기반 게이팅**: 표본 0% < 80% → 전수 dry-run 미수행 + 사유 파일화. 자의적 확장 없음. (`summary.fullDryRun`)
4. **하위호환 날짜 보정**: `resolve_base_date` 가 `fetch_fn` 주입식 순수 함수라 네트워크 없이 결정적으로 테스트(EXACT/RESOLVED_PRIOR/UNRESOLVED). 기존 출력 키 불변, `dateResolution` 순수 추가. (`scripts/collect_etf_holdings.py:85-135`)
5. **검증 공백 방지 가드**: 미지원 JSON-Schema 키워드를 조용히 무시하지 않고 warn(또는 strict throw)로 표면화, 지원 목록 중앙화, 운영 경로 무손상. (`schemaValidator.js:19-83`)
6. **교차 일관성**: `DATE_RESOLUTION_STATUS` 가 constants·schema enum·python 3곳에서 동일(총괄 pin + 검사로 확인).
7. **효율**: A/B/C 병렬 + 각 영역 테스트만, 최종 전체 회귀 1회(§7 준수). 계약을 선(先) 고정해 병렬 충돌 0.

---

## 4. 발견 사항 (블로커 없음)

### 경미 / 관찰

- **[경] 벤치마크 CSV 1행이 표준 주석이 아님** — `results.csv` 첫 줄이 `csv.writer` 로 쓰인 4열 메타 행(`# pykrx...,anchorDate=...`)이라, `#` 주석을 자동 스킵하지 않는 파서는 이를 데이터 행으로 읽는다(열 수 불일치). 파싱은 가능하나 소비자가 1행을 건너뛰어야 함. → 메타를 별도 `.meta.json` 로 빼거나 진짜 주석/헤더-only 로 정리 권장. (`scripts/pykrx_benchmark.py:295-299`)
- **[경] 리졸버가 요청일을 중복 프로빙** — 벤치마크에서 requestedDate(20240105) 프로빙 후, `resolve_business_day_pdf` 가 anchor(=동일 20240105) step 0 을 다시 프로빙. ETF당 PDF 1회 중복(총 ~13회). 성능 영향 미미. (`pykrx_benchmark.py:201-203`)
- **[경] 가드는 상위 미지원 키워드만 열거** — `collectUnsupported` 는 지원 subschema 위치(properties/$defs/items/객체형 additionalProperties)만 재귀하므로, 미지원 합성 키워드(oneOf/allOf 등)를 상위에서 플래그하되 그 하위의 추가 미지원 키워드까지 파고들지 않는다. 경고 목적상 충분하나 "완전 열거"는 아님. (`schemaValidator.js:39-60`)
- **[관찰] 날짜 메타데이터의 JS 문서 미반영** — `dateResolution` 은 파이썬 수집기 출력 + 스키마(optional)까지 반영됐고, JS 공통 문서(normalizer/orchestrator)에는 아직 스레드되지 않음. pykrx JS provider 가 여전히 NOT_IMPLEMENTED(오프라인)라 현재는 무의미하며, 실연동 시점 과제로 적절. 계약상 하위호환 필드는 준비됨.
- **[관찰] 전체 holdings 라이브화의 병목은 pykrx 가 아니라 소스 부재** — pykrx PDF EMPTY 로 인해 구성종목 실데이터가 0%. 결함이 아니라 의존성이며, 실질 해제는 KRX_DIRECT AUTH_KEY(BL-06). 이미 연동된 공공데이터포털은 시세·순자산만 제공(구성종목 미제공)임을 백로그에 정확히 기록.

---

## 5. 판단 검증 (근거 숫자 재확인)

- 표본 13종, OK/PARTIAL **0**, EMPTY **13** → 성공률 **0.0%**.
- 유형 무관(현물·해외·채권·레버·인버스·합성·재간접·원자재 전부 0%), 운용사 무관(삼성6·미래에셋5·키움2 전부 실패) → **엔드포인트 레벨 문제** 결론 타당.
- 영업일 보정 후에도 0/13 resolved → 날짜 이슈 아님(OHLCV 정상이 뒷받침).
- **결론 "pykrx 를 1차 provider 로 쓰기 어려움" + "KRX_DIRECT 최우선" + "UI 연결 차단"은 데이터로 정당화됨.**

---

## 6. 위험 및 한계

- **구성종목 실소스 부재**: 현재 어떤 provider 도 실 구성종목을 반환하지 못함(pykrx 0%, KRX_DIRECT/SEIBro/운용사 미구현). BL-09(UI 연결)·BL-10(전수) 차단.
- **환경 시계(2026) 특수성**: pykrx 의 `get_nearest_business_day_in_a_week` 가 시스템 날짜 기준으로 실패. 과거 명시일(20240105)로도 PDF EMPTY 이므로 시계 문제만은 아니나, 실제 운영 환경(실시각)에서 재검증 필요(BL-08).
- **날짜 포맷 경계**: 수집기 `dateResolution` 은 `YYYYMMDD`(pykrx native), JS 스키마는 문자열 허용. JS 정규화(`YYYY-MM-DD`)는 어댑터 후속 과제.

---

## 7. 권고 (후속, 이번 리뷰 범위 외)

1. **BL-06 우선 착수 트리거**: KRX Open API AUTH_KEY 발급 → KRX_DIRECT 구성종목 서비스 존재 확인 → 동일 13종 재벤치마크. 이것이 UI 연결(BL-09)·전수(BL-10)의 유일한 해제 경로.
2. **벤치마크 CSV 메타 정리**(경미): 메타를 `raw.json` 로만 두고 CSV 는 헤더+데이터만 유지.
3. **가드 강화(선택)**: 미지원 합성 키워드 하위까지 열거하거나, 최소한 "재귀 미도달" 경고 문구 추가.
4. **실시각 환경 재검증(BL-08)**: 실제 최근 영업일로 pykrx PDF 재시도 후 성공률 재측정(현 판단은 이 sandbox 기준).

---

## 8. 결론

지시의 목적(실데이터 가용성 검증 + 독립 백로그 실제 소진)을 **정확·정직·효율적**으로 달성했다. 병렬 3워크스트림 통합 충돌 0, 전체 회귀 98/98, 위조 0, UI 무변경, 리포트/백로그 산출 완비. 경미 사항은 CSV 메타 정리·가드 강화 수준으로 낮은 위험이다. **다음 실질 진전은 pykrx 개선이 아니라 KRX_DIRECT(AUTH_KEY) 등 정식 구성종목 소스 확보**임이 데이터로 확정되었다 — 이 판단이 이번 작업의 핵심 산출이다.
