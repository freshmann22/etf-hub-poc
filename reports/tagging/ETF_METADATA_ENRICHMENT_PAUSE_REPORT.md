# ETF 메타데이터 보강 작업 중단 보고서

## 최신 완료 체크포인트 · 2026-07-22 15:49 KST

이 문서의 기존 중단 기록에서 재개한 OpenDART PDF 배치는 수집·전수 추출·보수적 변환·병합·후속 검증까지 완료됐다. 현재 실행 중인 collector/extractor는 없으며, raw PDF와 append-only 원장은 그대로 보존됐다.

| 항목 | 현재 상태 |
|---|---:|
| DART 매핑 대상 | 911 |
| 시도 / 성공 | 911 / 911 |
| unresolved / 미시도 | 0 / 0 |
| malformed ledger | 0 |
| 전수 추출 parsed / pending OCR | 911 / 0 |
| source-result records | 911 (ok 910, unavailable 1) |
| canonical에 추가한 DART 후보 | 공식명 910 |
| canonical 선택값 변경 | 0 |
| merge quarantine | 0 |
| metadata-v2 테스트 | 162 / 162 통과 |
| taxonomy v2 표본 | 200개 고유, A 91 / B 109 |

전수 PDF의 500자 근거 창은 별도 의미 감사를 거쳤다. `productDescription` 893건, `investmentObjective` 891건, `benchmarkDescription` 911건, `distributionPolicy` 114건은 각각 전략·위험·성과표·분배재원 문맥이 섞여 canonical 필드 계약과 일치하지 않았다. 총 2,809건은 extraction report에 evidence-only로 보존하고 source-result에서는 승격하지 않았다. 이 결정으로 기존 공식 상품 페이지의 선택값을 DART 창으로 덮어쓰는 일을 차단했다.

주요 완료 산출물:

- `data/reports/metadata-v2/dart-pdf-batch-extraction.json`: 911건 전수 추출, OCR 0, PDF 계보·해시 검증 완료
- `data/reports/metadata-v2/dart-pdf-batch-source-result.json`: 공식명 910건만 merge 후보, 1건 unavailable, evidence-only 제외 사유 포함
- `data/normalized/etf-metadata-v2.json`: DART 공식명 candidate 910건 추가, 기존 선택값·1,141 shape 불변
- `tmp/metadata-v2-pre-dart-20260722-153948/`: 병합 전 canonical/quarantine/coverage/report 백업과 SHA-256 manifest
- `data/reports/etf-taxonomy-review-sample-v2.json`: 현재 canonical 해시 기준 200개 표본

다음 후속 작업은 네트워크 수집 재개가 아니라 **clause-level semantic parser** 구현이다. 목적·전략·비교지수·분배 문장에서 완결된 절만 추출하고 음성 규칙·실물 PDF 회귀·표본 감사를 통과한 값만 별도 source-result로 승격해야 한다. 기존 2,809개 원문 창을 그대로 병합해서는 안 된다.

아래 11:26 및 2026-07-21 기록은 네트워크 중단 당시의 역사적 체크포인트로 보존한다.

## 최신 안전 중단 체크포인트 · 2026-07-22 11:26 KST

인터넷 연결 중단 가능성 때문에 단일 DART collector PID 15596만 종료했다. 종료 후 3초 간격으로 진행도 스냅샷을 두 번 생성했으며 두 결과가 동일해 writer가 완전히 멈춘 것을 확인했다. raw 파일과 append-only 원장은 수정하지 않았다.

| 항목 | 최신 상태 |
|---|---:|
| 전체 DART 대상 | 911 |
| 시도한 고유 키 | 888 |
| 성공 | 885 |
| 재시도 가능 오류 | 3 |
| 미시도 | 23 |
| 진행률 | 97.48% |
| 원장 유효 행 / malformed 행 | 889 / 0 |

재시도 대상은 모두 `TimeoutError`다.

- `123320` TIGER 레버리지
- `232080` TIGER 코스닥150
- `480460` WON 한국부동산TOP3플러스

재개 시 먼저 `npm run metadata:v2:progress:dart`로 위 수치를 확인한 뒤 `node scripts/metadata-v2/collect-dart-prospectus-pdfs.mjs`를 단일 프로세스로 실행한다. collector는 성공 885건을 건너뛰고 오류 3건과 미시도 23건만 처리한다.

이 세션에서는 full-batch PDF extractor/converter와 엄격한 병합 게이트, Python runtime launcher, v2 기반 taxonomy 200개 표본 경로를 구현하고 관련 테스트를 통과시켰다. 그러나 batch가 아직 완결되지 않았으므로 **전수 추출, converter 실행, canonical merge, readiness 재계산, v2 200개 표본 생성은 실행하지 않았다.**

아래 2026-07-21 내용은 최초 중단 당시의 역사적 기준선으로 보존한다.

기준 시각: 2026-07-21 16:57 KST (`dart-pdf-batch-progress.json` 생성 시각 2026-07-21T07:57:10.632Z)

## 결론

인터넷 연결 중단 예정으로 OpenDART PDF 수집 배치를 의도적으로 중단했다. 수집 프로세스 PID 13528을 종료한 뒤 원장이 3초 동안 174행으로 유지되는 것을 확인했다. append-only 원장의 마지막 행은 완전한 JSON이며 malformed 행은 0개다. 성공 raw는 content-addressed 파일로 남아 있으므로 재개 시 다시 받을 필요가 없다.

이번 단계에서는 메타데이터 근거만 보강했다. **택소노미 정의, 태그 체계, 200개 리뷰 판정은 변경하지 않았다.**

## 중단 시점의 정확한 상태

| 항목 | 상태 |
|---|---:|
| 전체 ETF 유니버스 | 1,141 |
| DART 공시 매핑 대상 | 911 |
| DART 미매핑·격리 | 230 |
| DART 시도 | 174 / 911 (19.10%) |
| DART 성공 | 173 / 911 (18.99%) |
| 재시도 가능 오류 | 1 |
| 미시도 | 737 |
| blocked / quarantine / pending OCR | 0 / 0 / 0 |
| 원장 유효 행 / malformed 행 | 174 / 0 |

유일한 오류는 `0074K0`의 `TimeoutError` (`The operation was aborted due to timeout`, 2026-07-21T07:48:14.993Z)다. 현재 비성공 상태가 이것 하나뿐이므로 재개 실행은 성공 173건을 건너뛰고 이 timeout과 미시도 737건만 처리한다.

현재 병합 기준선은 다음과 같다.

- 공식 상품 메타데이터: 596종목, 정규화본 투자목적 커버리지 596 / 1,141 (52.2%)
- 출처별 상품 건수: TIGER 229, RISE 140, PLUS 84, SOL 77, 1Q 26, KoAct 23, WON 16, TheJ 1
- 실제 분배 이력: 241종목, 1,586 events (coverage 표시 21.1%)
- 준비도 등급: A 91, B 450, C 289, D 311
- source merge quarantine: 0
- 메타데이터 v2 테스트: 146 / 146 통과

## 완료 산출물

- `data/reports/metadata-v2/dart-disclosure-index.json`: 1,141종목 중 911종목 최신 공시 매핑
- `data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl`: 174행 append-only 수집 원장
- `data/raw/metadata-v2/dart-pdf-batch/<universeKey>/`: 성공 건의 main/attachment/body/PDF 원문과 SHA-256 기반 파일
- `data/reports/metadata-v2/dart-pdf-batch-progress.json`: 원장을 수정하지 않는 진행도 스냅샷
- `data/reports/metadata-v2/product-metadata-source-result.json`: 공식 상품 596종목 공통 계약
- `data/reports/metadata-v2/distribution-history-extraction.json`: 241종목·1,586건 실제 지급 이력
- `data/normalized/etf-metadata-v2.json`, `data/reports/metadata-v2/coverage.json`: 현재 canonical/readiness 기준선
- `reports/tagging/ETF_METADATA_ENRICHMENT_EXECUTION_REPORT.html`: 최신 수치와 DART 진행도 표시

## 차단 또는 미완료 출처

- KODEX: 정책 진입점과 상품 경로의 지속적 HTTP 429 때문에 product request 전 차단. 기존 대상은 238종목이다.
- AssetPlus: generic user-agent에 대한 `robots disallow all`로 product request 0건.
- KIWOOM: 정상 검증 가능한 TLS/policy/product contract가 없어 product request 전 차단.
- remaining issuer policy sweep: blocked 4개 운용사·18종목, unresolved 7개 운용사·30종목.
- KCGI: ledger 2회 validation failure, emitted 0.
- MIDAS: 아직 ledger 수집 0.
- DART PDF: 737종목 미시도, 1종목 timeout 재시도 필요.

차단을 우회하거나 보안 예외를 사용하지 않는다. 공개·허용된 공식 경로가 확인되기 전에는 해당 운용사를 자동 수집 대상으로 승격하지 않는다.

## 재개 전 체크

1. 인터넷 연결과 `https://dart.fss.or.kr`의 정상 응답을 확인한다.
2. 다른 DART collector 프로세스가 없는지 확인해 동일 원장에 복수 writer가 붙지 않게 한다.
3. 저장 공간과 `data/raw/metadata-v2/dart-pdf-batch` 쓰기 권한을 확인한다.
4. 먼저 `npm run metadata:v2:progress:dart`를 실행해 `target=911, attempted=174, ok=173, error=1, malformed=0`인지 확인한다.
5. 값이 다르면 원장을 수정하지 말고 최신 스냅샷과 마지막 행을 검토한다.
6. 성공 건은 절대 재수집하지 않는다. 현재 collector는 latest status가 `ok`인 키를 자동 skip한다. 현재 비성공 상태는 retryable timeout 1건뿐이므로 결과적으로 오류 1건과 미시도 건만 처리한다.

## 재개 및 완료 순서

```powershell
npm run metadata:v2:progress:dart
node scripts/metadata-v2/collect-dart-prospectus-pdfs.mjs
npm run metadata:v2:progress:dart
```

수집 도중에는 단일 DART worker와 기존 1.2초 host interval을 유지한다. 네트워크가 다시 불안정해지면 강제 파일 편집 없이 프로세스만 종료하고 진행도 스냅샷을 다시 만든다.

수집 완료 후 순서는 아래와 같다.

1. **Extractor/Converter:** 911개 batch PDF를 대상으로 extraction report를 만든다. 현재 `convert-dart-extraction.mjs`의 기본 입력은 canary 파일이므로, full-batch 입력 계약과 출력 경로를 먼저 구현·검증한 뒤 converter를 실행한다. canary 결과를 전수 결과처럼 병합하면 안 된다.
2. **Merge:** 생성된 DART source result를 `node scripts/metadata-v2/merge-source-results.mjs --source=<검증된 full-batch DART source result>`로 병합한다.
3. **Readiness:** `npm run metadata:v2:readiness`로 1,141 shape, provenance, coverage, grade를 재계산한다.
4. **Tests:** `npm run metadata:v2:test`를 실행하고 전체 통과를 확인한다.
5. **Report:** `npm run metadata:v2:progress:dart`와 HTML 실행 리포트의 정적 기준값을 갱신한다.
6. **200 A/B 재선정·리뷰:** `npm run review:taxonomy-sample`로 최신 준비도 기준의 200개 표본을 다시 만들고 A/B 우선 표본을 검토한다. 메타데이터 보강 효과를 기존 Claude 리뷰와 비교한 뒤에만 택소노미 변경안을 별도 승인 요청한다.

## 금지 사항

- 원장 행 삭제·덮어쓰기 또는 raw 파일 재작성
- 성공 173건의 강제 재수집
- full-batch extractor 없이 canary DART result를 전수 결과로 병합
- 메타데이터 보강과 택소노미 변경을 한 단계로 처리
- 차단 출처 우회, TLS 검증 완화, robots/policy 무시
