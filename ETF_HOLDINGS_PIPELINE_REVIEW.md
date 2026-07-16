# 리뷰 보고서 — ETF 구성자산 파이프라인 & 공통 스키마 (S15)

- **리뷰 일자**: 2026-07-14
- **리뷰 대상**: `ETF_DATA_PIPELINE_SCHEMA_PROMPT.md` 지시로 구축된 ETF 구성자산(holdings) 데이터 파이프라인 계층 + 공통 스키마
- **리뷰어**: 총괄(Opus) / 구현: 병렬 서브에이전트 2(Workstream A·B) + 총괄 통합
- **방법**: 코드 정독(파이프라인 전 계층) + 전체 테스트 실행(`npm test`) + repository 통합 e2e 실행 + pykrx 대표 ETF smoke
- **대상 파일**: `server/holdings/**`, `schemas/etf-holdings.schema.json`, `scripts/collect_etf_holdings.py`, `docs/ETF_DATA_CONTRACT.md`, `tests/holdings-*.test.mjs`

---

## 1. 총평

**합격(승인 권장).** 지시서 §12 완료 조건을 모두 충족하며, 핵심 설계 원칙(공급자 비종속, 스키마/업무 검증 분리, 데이터 위조 금지, null/0 구분, 행 병합 금지)이 코드 레벨에서 일관되게 지켜졌다. **정확성 결함(블로커) 0건**, 통합 중 발견한 견고성 결함 1건은 수정 완료. 나머지는 경미한 관찰/개선 여지 수준이다.

| 항목 | 결과 |
|---|---|
| 전체 테스트 | **96 / 96 통과** (신규 44: 스키마 14 + 파이프라인 30) |
| 통합 e2e(Mock→…→Repository) | 실제 실행, 스키마 유효·원본필드 미노출 |
| 기존 UI/디자인/더미데이터 | **무변경** |
| 데이터 위조 | **없음**(미구현=NOT_IMPLEMENTED, 실패=상태 JSON) |
| 신규 외부 의존성 | 없음(무의존 유지) |
| 발견 결함 | 블로커 0 · 수정완료 1 · 경미 6 |

---

## 2. 지시서 완료 조건(§12) 대비 점검

| 완료 조건 | 상태 | 근거 |
|---|---|---|
| ETF 구성종목 JSON Schema 존재 | ✅ | `schemas/etf-holdings.schema.json` (draft 2020-12) |
| 현물·파생·현금·해외자산 표현 가능 | ✅ | `assetType` enum 13종, 해외코드 6자리 미강제, contractCount 분리 |
| provider 공통 인터페이스 | ✅ | `providers/base.js` (name·isImplemented·fetchRaw) |
| pykrx provider/adapter 골격 | ✅ | `providers/pykrx.js` + `scripts/collect_etf_holdings.py` |
| 미구현 provider가 명확히 NOT_IMPLEMENTED | ✅ | krxDirect/seibro/issuer 스텁, `notImplemented()` |
| normalizer가 원본→내부 스키마 변환 | ✅ | `normalizer.js` (별칭 매핑·헬퍼 재사용) |
| schema/business validator 분리 | ✅ | `schemaValidator.js`(형태) vs `businessValidator.js`(업무) |
| fallback orchestrator가 mock 으로 동작 | ✅ | `orchestrator.js` + e2e |
| repository가 UI↔provider 분리 | ✅ | `repository.js`, pykrx 미import |
| mock 기반 전체 파이프라인 테스트 통과 | ✅ | `tests/holdings-pipeline.test.mjs` 30/30 |
| 기존 테스트 모두 통과 | ✅ | 96/96 |
| 기존 UI/디자인 무변경 | ✅ | git 상 `src/**`·`index.html` 이번 작업 변경 0 |
| 실데이터 없을 때 임의 구성종목 미생성 | ✅ | 픽스처 없음/실패=REQUEST_FAILED, 스텁=NOT_IMPLEMENTED |

---

## 3. 통합 책임(§3) 교차검증 결과

| 확인 항목 | 결과 | 비고 |
|---|---|---|
| 스키마 필드명 ↔ 모델 일치 | ✅ | e2e 에서 normalizer 출력이 `validateHoldingsDocument` 통과(불일치면 실패) |
| provider 원본을 UI에 그대로 노출 안 함 | ✅ | normalizer 가 공통형태로 변환, 스키마 `additionalProperties:false` 로 원본키 차단 |
| repository 가 pykrx 직접 import 안 함 | ✅ | `repository.js` import 목록에 pykrx 없음(주석으로도 명시) |
| schema/business 검증 분리 | ✅ | 별도 파일·별도 책임. 형태는 schema, 값 타당성은 business |
| mock 으로 전체 흐름 실행 | ✅ | `getEtfHoldings('069500')` → status OK, MOCK, holdings 9, 원본필드 0 |
| 병렬 작업 간 중복 타입/충돌 | ✅ | enum·스키마는 총괄이 선고정, A/B 파일영역 분리. enum 드리프트 교차검증 테스트 존재 |

---

## 4. 강점

1. **정직성 일관**: 모든 실패 경로가 데이터를 지어내지 않는다. 스텁=NOT_IMPLEMENTED, 픽스처 누락/파싱실패=REQUEST_FAILED, 전 공급자 실패=UNRESOLVED(스키마 유효 빈 껍데기). (`orchestrator.js:155-164`, `providers/mock.js:41-51`)
2. **계층 분리 명확**: provider(원본) → normalizer(공통형태) → schemaValidator(형태) → businessValidator(업무) → orchestrator(폴백) → repository(단일 접근면). 책임 경계가 파일과 일치.
3. **fallback 원칙 준수**: 우선순위 정렬 후 "스키마 유효 + 업무 error 0" 첫 데이터셋을 **통째로 채택**, 행 병합 없음. `attemptedProviders`·`isFallback`·`diagnostics.providerFailures`(공급자별 실패 사유+errors) 보존. (`orchestrator.js:70-153`)
4. **null vs 0 구분 종단 보존**: normalizer 가 `parseNumber` 로 공란→null, 실제 0→0 유지(`normalizer.js:113`), businessValidator 가 이를 구분해 WEIGHT_MISSING/PARTIAL 판정.
5. **"비중 합계 ≠ 100% = 경고 전용"** 규칙 정확 구현 — 현금·파생·합성·레버리지/인버스 정당성 반영, 절대 error 아님. (`businessValidator.js:105-111`)
6. **테스트 충실**: 신규 44개가 §9 요구(스키마/normalizer/validator/fallback/repository)를 폭넓게 커버. enum↔스키마 드리프트 교차검증까지 포함.
7. **무의존·관례 일치**: 외부 패키지 0, `server/lib/normalize.js` 재사용(중복 없음), 한글 주석 스타일 일관.

---

## 5. 발견 사항

### 5.1 수정 완료 (통합 중)

- **[중] pykrx 수집기 최상위 예외 누출** — 날짜 미지정 호출 시 pykrx/pandas 내부 `IndexError` 가 `main()` 에서 잡히지 않아 traceback 으로 노출됐다(파싱 불가). 수집기는 항상 상태 JSON 을 내야 하므로 최상위 `try/except` 로 감싸 `REQUEST_FAILED` JSON 을 내도록 수정. (`scripts/collect_etf_holdings.py` main) 데이터 위조는 없었음.

### 5.2 경미 / 관찰 (블로커 아님)

- **[경] `isFallback` 가 기본 repository 경로에서 항상 true** — 기본 공급자 세트가 `[KrxDirect, Seibro, Issuer, Mock]` 이고 상위 3종이 NOT_IMPLEMENTED 라, 실제 구동되는 Mock 은 늘 "첫 시도 공급자가 아님" → `isFallback=true`. 정직하지만("mock 은 1차 소스가 아님") 소비자가 오해할 수 있다. pykrx 실연동 시 자연 해소. → 계약 문서에 "mock 경로에서 isFallback=true 는 정상"임을 한 줄 명시 권장. (`orchestrator.js:144`, `repository.js:16-23`)
- **[경] businessValidator 의 NaN/Infinity 검사는 정규화 문서에선 사실상 도달 불가** — normalizer 의 `parseNumber` 가 이미 NaN/Infinity→null 로 정제하므로, 파이프라인 산출 문서에서는 이 분기가 실행되지 않는다(직접 구성한 문서에만 유효). 방어 코드로 무해하나, "왜 있는지" 주석 한 줄 있으면 좋음. (`businessValidator.js:67-70`)
- **[경] schema/business 의 etfCode·baseDate 형식 검증 중복** — 지시서 §Business Validator 가 두 항목을 업무검증에 포함하도록 명시해 의도적이나, 스키마가 먼저 pattern 을 강제하므로 파이프라인상 business 의 동일 검사는 사실상 중복. 독립 단위테스트 목적상 유지는 타당. (`businessValidator.js:33-42`)
- **[경] 무의존 스키마 검증기의 커버리지 한계** — `schemaValidator.js` 는 현재 스키마가 쓰는 키워드 부분집합(type/required/enum/pattern/minLength/additionalProperties/items/$ref)만 구현. 향후 스키마에 미지원 키워드(oneOf, format, minimum 등) 추가 시 **조용히 미검증**될 수 있다. → 스키마 확장 시 검증기 동반 확장 또는 미지원 키워드 감지 로직 권장.
- **[경] WEIGHT_MISSING 데이터셋은 스킵이 아니라 채택** — 전 비중 공란이면 status=WEIGHT_MISSING(에러 아님)로 **그대로 채택**된다(구성명/수량은 유효하므로 의도적). fallback 을 유발하지 않는다는 점을 계약에 명시하면 소비자 혼동 감소. (`businessValidator.js:93-96`)
- **[경] 비중 합계 허용오차 1.0% 상수** — 임의 상수(`WEIGHT_SUM_TOLERANCE`). 경고 전용이라 위험 낮음. 상수 근거 주석 정도면 충분.

### 5.3 실호출(smoke) 결과 — 정직 기록

- 대표 ETF `069500` pykrx 호출: **유효 구성자산 미확보**. 날짜 지정 시 `status:EMPTY`, 날짜 미지정 시(수정 후) `status:REQUEST_FAILED`. 원인은 실행 환경 날짜(2026)와 pykrx 실데이터 범위 불일치로 추정. **임의 데이터로 성공 처리하지 않음**(§0/§8 준수). 실연동 단계에서 유효 영업일·데이터 가용성 확인 필요.

---

## 6. 데이터 계약 요약(리뷰 확인분)

- **문서**: `{ schemaVersion, etfCode, etfName, baseDate, generatedAt, source{provider,sourceType,isFallback}, collection{status,attemptedProviders,message}, holdings[], diagnostics? }`
- **holding**: `assetCode, assetName, assetType, market, currency, quantity, contractCount, marketValue, weightPct(null=공란/0=실제0%), rank, rawAssetCode`
- **enum 중앙정의**: `server/holdings/constants.js`(ASSET_TYPE·PROVIDER·SOURCE_TYPE·COLLECTION_STATUS·PROVIDER_PRIORITY) — 스키마와 값 일치(테스트로 강제).
- **repository 인터페이스(UI 유일 창구)**: `getEtfHoldings(code, baseDate?)`, `getEtfHoldingSummary(code, baseDate?, {topN})`, `getCollectionStatus(code, baseDate?)`.

---

## 7. 위험 및 한계

- **T+0 실데이터 미연동**: 이번 범위는 기반 구조(mock 구동)까지. 실제 구성종목은 pykrx/KRX/SEIBro/운용사 실연동 후에야 채워진다.
- **UI 미연결**: repository ↔ 바텀시트/구성종목 UI 연결은 후속 단계로 남음(의도적, §10). 현재 화면의 holdings 는 여전히 기존 fixture(24종) 기준.
- **pykrx 안정성/데이터 가용성**: smoke 에서 EMPTY/실패 확인 — 실연동 시 영업일·종목별 가용성·호출 제한 검증 필요.

---

## 8. 권고 (후속, 이번 리뷰 범위 외)

1. **계약 문서 보강**(경미 3건): mock 경로 `isFallback=true` 정상, WEIGHT_MISSING 채택 정책, 무의존 검증기의 키워드 커버리지 한계를 한 줄씩 명시.
2. **pykrx 실연동 전 검증 스크립트**: 유효 영업일 자동 판별 + 대표 N종 실호출 성공률 리포트(실패 사유 집계). KRX_DIRECT fallback 필요성 판단 근거로.
3. **repository → UI 연결(별도 승인 후)**: 전종목/ thin ETF 의 구성종목 공백을 이 파이프라인으로 대체. 연결 지점은 `renderBottomSheet` 의 topHoldings.
4. **스키마 검증기 확장 가드**: 스키마에 미지원 JSON-Schema 키워드가 추가되면 경고를 내도록 방어.

---

## 9. 결론

지시서의 목적(공급자 비종속 파이프라인 + 구성자산 공통 스키마 기반 구조)을 **정확하고 정직하게** 달성했다. 병렬 서브에이전트 결과의 통합 충돌 0, 전체 회귀 96/96, UI 무변경. 경미 사항은 대부분 문서 보강으로 해소 가능하며 **후속 단계(실연동·UI 연결) 진행에 적합한 상태**로 판단한다.
