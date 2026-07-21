# ETF 메타데이터 보강 작업 중단 보고서

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
