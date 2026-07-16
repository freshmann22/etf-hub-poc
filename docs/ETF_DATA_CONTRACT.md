# ETF 구성자산(구성종목) 데이터 계약

ETF 구성자산 파이프라인의 단일 계약 문서. 스키마·상수의 원천은
`schemas/etf-holdings.schema.json` 과 `server/holdings/constants.js` 이며,
본 문서는 그 둘을 잇는 흐름·규칙·인터페이스를 규정한다. 값이 충돌하면 스키마/상수가 우선한다.

## 1. 파이프라인 레이어

```
Provider → Collector/Adapter → Normalizer → SchemaValidator → BusinessValidator
        → FallbackOrchestrator → Repository → UI
```

- **Provider**: 실제/모의 데이터 원천(PYKRX, KRX_DIRECT, SEIBRO, ISSUER, MOCK).
- **Collector/Adapter**: 공급자별 원본(raw) 응답을 수집한다. 원본 형태 보존.
- **Normalizer**: 공급자별 raw 를 공통 문서 형태로 정규화한다. 숫자 파싱, 코드/이름 정리,
  누락 수치는 `null` 로(0 으로 채우지 않음).
- **SchemaValidator**(본 워크스트림): 문서/holding 의 **형태(shape)** 만 검증한다.
  비즈니스 규칙은 다루지 않는다.
- **BusinessValidator**: 비중 합계 범위, 중복 자산, 순위 연속성 등 **의미 규칙**을 검증한다.
- **FallbackOrchestrator**: 우선순위에 따라 공급자를 시도하고 더 나은 데이터셋을 채택한다.
- **Repository**: 검증된 문서를 저장/조회하는 단일 접근점. UI 는 여기만 사용한다.
- **UI**: Repository 인터페이스로만 접근한다(공급자/수집 세부는 알지 못한다).

## 2. 스키마 핵심 필드

문서: `{ schemaVersion, etfCode, etfName, baseDate, generatedAt, source, collection, holdings[], diagnostics? }`

- `schemaVersion` — semver 문자열(현재 `1.0.0`).
- `etfCode` — ETF 단축코드(6자리 영숫자). 구성자산 코드가 아님.
- `baseDate` — 기준일 `YYYY-MM-DD` (Asia/Seoul).
- `generatedAt` — 수집/생성 시각 ISO8601.
- `source` — `{ provider, sourceType?, isFallback }`.
- `collection` — `{ status, attemptedProviders[], message? }`.
- `holdings[]` — 개별 구성자산(아래).
- `diagnostics?` — 원본/검증 실패 등 진단 보존(선택).

holding: `{ assetCode, assetName, assetType, market?, currency?, quantity?, contractCount?, marketValue?, weightPct, rank?, rawAssetCode? }`

- `assetCode` — 구성자산 코드. **해외자산은 국내 6자리 종목코드를 강제하지 않는다**(길이 ≥ 1).
- `assetType` — `constants.js`/스키마의 ASSET_TYPE enum 중 하나(현물/파생/현금/외화/다른 ETF 포괄).
- `contractCount` — 파생상품 계약수. `quantity` 와 별도 필드.
- `weightPct` — §4 참고(null vs 0 구분).
- `rank` — 정수 또는 null.

## 3. 공급자 우선순위

`PROVIDER_PRIORITY = [ PYKRX → KRX_DIRECT → SEIBRO → ISSUER ]` (`MOCK` 은 우선순위에서 제외, 테스트 전용).
FallbackOrchestrator 는 이 순서로 시도한다.

## 4. weightPct — null 과 0 구분

- `null` = **비중 공란**(원본에 값이 없음/미제공). 합계·정렬 시 "미상"으로 취급.
- `0` = **실제 0%**(원본이 명시한 0). 유효한 수치로 취급.
- 둘 다 스키마상 유효하며 **절대 혼동해선 안 된다**. Normalizer 는 공란을 0 으로 채우지 않는다.

## 5. Fallback 원칙

- **더 나은 데이터셋을 통째로 채택**한다. 공급자 간 **행(row) 병합 금지**
  (서로 다른 공급자의 holding 을 섞지 않는다).
- 다음을 보존한다:
  - `collection.attemptedProviders` — 시도한 공급자 순서.
  - `source.isFallback` — 1순위가 아닌 공급자를 채택했는지.
  - 공급자별 실패 사유(진단, `collection.message`/`diagnostics`).
  - `baseDate` 와 수집시각(`generatedAt`) — 채택된 데이터셋 기준으로 일관 유지.
- "더 나음" 기준: 수집 상태(OK > PARTIAL > …), 비중 존재 여부, holding 개수 등을
  BusinessValidator/Orchestrator 가 판정한다(본 문서 밖 세부).

## 6. Repository 인터페이스 (UI 접근점)

UI 는 아래 3개 메서드로만 접근한다. 공급자/수집 세부는 노출하지 않는다.

- `getEtfHoldings(etfCode, baseDate?)` — 구성자산 목록(검증된 holdings). `baseDate` 생략 시 최신 기준일.
- `getEtfHoldingSummary(etfCode, baseDate?)` — 요약(상위 보유, 자산유형 분포, 비중 합계 등).
- `getCollectionStatus(etfCode, baseDate?)` — 수집 상태(`collection` + `source` 요약; isFallback/attemptedProviders 포함).

## 7. 향후 TODO — pykrx 실수집

- `scripts/collect_etf_holdings.py` 로 pykrx 실데이터를 수집해 공통 문서로 저장.
- PYKRX → KRX_DIRECT → SEIBRO → ISSUER 실어댑터 구현 및 실패 시 fallback 연결.
- 기준일별 스냅샷 보존(baseDate 이력) 및 Repository 영속화(파일/DB).
- 해외 구성자산(ISIN 등) 코드 정규화 규칙 확정.
- 스키마 버전 상향 시 마이그레이션 정책 정의.

## 8. 운영 주의 / 정책 명확화

- MOCK provider 는 기본 우선순위상 후순위라, 정상 흐름에서도 `source.isFallback=true` 가 될 수 있다.
- `WEIGHT_MISSING` = 구성자산은 존재하나 비중(weightPct)이 전부 공란(null)인 상태.
- `WEIGHT_MISSING` 은 자동으로 다음 provider fallback 을 유발하지 않고, 현재 정책상 해당 데이터셋을 그대로 채택한다.
- 자체 JSON Schema validator 가 지원하는 키워드는 위 목록(`$schema`, `$id`, `title`, `description`, `type`, `required`, `enum`, `pattern`, `minLength`, `additionalProperties`, `properties`, `items`, `$ref`, `$defs`)으로 한정되며, 미지원 키워드는 경고(`console.warn`) 또는 strict 모드(`HOLDINGS_SCHEMA_STRICT`)에서 실패로 처리한다.
- 비중 합계 허용오차 초과는 error 가 아니라 warning 전용으로 처리한다.
- 요청일(`requestedDate`)과 실제 채택 기준일(`resolvedBaseDate`/`baseDate`)은 영업일 보정으로 달라질 수 있다(`dateResolution` 메타 참조).
