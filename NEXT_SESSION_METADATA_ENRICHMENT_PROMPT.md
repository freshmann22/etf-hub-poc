# 다음 세션 시작 프롬프트 — ETF 메타데이터 보강 재개

아래 작업을 이어서 수행해줘.

## 목적과 경계

- 1,141개 ETF의 메타데이터 근거를 보강한다.
- 현재는 메타데이터 파이프라인 작업이다. 택소노미 정의·태그·200개 리뷰 판정은 변경하지 않는다.
- `data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl`은 append-only다. 기존 행을 삭제·수정하지 않는다.
- 기존 raw와 성공 결과는 불변으로 취급한다. 차단 경로를 우회하거나 TLS/robots/policy를 완화하지 않는다.

먼저 `reports/tagging/ETF_METADATA_ENRICHMENT_PAUSE_REPORT.md`를 읽고 아래 기준선이 일치하는지 확인해줘.

- DART target 911
- attempted 174
- ok 173
- retryable error 1: `0074K0`, `TimeoutError`
- not attempted 737
- blocked/quarantine/pending OCR 0
- ledger valid 174, malformed 0
- 상품 메타데이터 596
- 실제 분배 이력 241종목 / 1,586 events
- grades A91/B450/C289/D311
- taxonomy 변경 없음

## 1. 재개 전 점검

네트워크 호출 전에 다음을 실행해 현재 로컬 상태를 확인해줘.

```powershell
npm run metadata:v2:progress:dart
```

다른 DART collector가 실행 중이지 않은지 확인하고, 동일 원장에는 writer 하나만 허용해. 기준선과 다르면 원장을 수정하지 말고 차이를 먼저 보고해.

## 2. DART 수집 재개

인터넷 연결이 정상일 때 아래 명령으로 재개해.

```powershell
node scripts/metadata-v2/collect-dart-prospectus-pdfs.mjs
```

collector의 latest-status resume 규칙으로 성공 173건은 skip하고, 현재 retryable timeout 1건과 미시도 737건만 처리해. 단일 worker와 1.2초 host interval을 유지해. 주기적으로 아래 명령으로 별도 진행도 JSON을 갱신해.

```powershell
npm run metadata:v2:progress:dart
```

blocked가 발생하면 해당 host 작업을 중단하고 원장/raw를 보존해. 오류를 비정상적으로 반복하거나 성공 건을 강제 재수집하지 마.

## 3. 수집 완료 후 반드시 이 순서로 진행

1. **Full-batch extractor/converter**
   - 911개 batch PDF용 extraction report를 생성해.
   - 현재 `scripts/metadata-v2/convert-dart-extraction.mjs` 기본 입력은 `dart-extraction-canary.json`이므로 그대로 전수 병합하지 마.
   - full-batch 입력/출력 계약, raw SHA-256, identity, section evidence, quarantine를 구현하고 테스트한 뒤 converter를 실행해.
2. **Merge**
   - 검증된 full-batch DART source result만 `merge-source-results.mjs`로 canonical에 병합해.
   - 1,141 shape와 candidate idempotency를 확인해.
3. **Readiness**
   - `npm run metadata:v2:readiness`
   - coverage, provenance, grades, facet eligibility를 재산출해.
4. **Tests**
   - `npm run metadata:v2:test`
   - 현재 기준 146 tests이며 신규 full-batch 테스트를 포함해 전부 통과해야 해.
5. **Reports**
   - `npm run metadata:v2:progress:dart`
   - `reports/tagging/ETF_METADATA_ENRICHMENT_EXECUTION_REPORT.html`과 실행 보고서를 최신 수치로 갱신해.
6. **200개 A/B 우선 재검토**
   - `npm run review:taxonomy-sample`
   - 최신 readiness에서 A/B를 우선 포함한 200개 표본을 재생성하고 기존 Claude 리뷰와 비교해.
   - 메타데이터 보강으로 근거 부족/검토 필요가 얼마나 줄었는지 보고해.
   - 택소노미 변경은 별도 제안서로 정리하고 사용자 승인 전에는 반영하지 마.

## 완료 보고에 포함할 것

- DART 911개의 최종 status 분포와 재시도 내역
- 성공 skip이 실제 유지됐는지
- extraction/converter/merge의 emitted·quarantine 수치
- canonical 1,141 shape와 provenance 검증 결과
- 변경 전후 coverage 및 A/B/C/D 변화
- 200개 재표본의 근거 부족·검토 필요 변화
- 여전히 차단된 출처와 우회하지 않은 이유
- 실행한 테스트와 결과
