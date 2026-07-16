# ETF 메타데이터 → LLM 태깅 입력 계약

이 문서는 후속 세션에서 `섹터` / `전략` / `배당` 태그를 LLM으로 스코어링할 때 사용할 입력 스키마를
정의한다. **이번 세션에서는 태그를 확정하거나 LLM 호출을 구현하지 않는다**(범위 제한, 프롬프트 §18).

## 입력 파일

`data/normalized/etf-metadata.json` — `records[]` 배열. 각 레코드가 ETF 1종의 통합 메타데이터.

## 레코드 스키마 (실제 생성 필드 기준)

```jsonc
{
  "etfCode": "069500",              // primary key. codeType 확인 필수(아래 참조)
  "codeType": "krx_numeric",        // "krx_numeric" | "naver_internal_unresolved"
  "name": "KODEX 200",
  "issuer": "삼성자산운용(주)",       // null 가능
  "listingDate": "2002-10-14",      // null 가능
  "benchmark": { "name": "코스피 200", "provider": null, "description": null, "methodology": null, "rebalanceFrequency": null },
  "classificationFacts": {
    "assetClass": null,             // 미분류(이번 세션 미확정)
    "regions": null,
    "active": null,                 // true|null — 명칭에 "액티브" 포함 시에만 true(추정 아님)
    "currencyHedged": null,         // true|null — 명칭에 "(H)" 포함 시에만 true
    "rawTypeText": "국내주식형, 대표지수",  // WiseReport 원문 분류 텍스트 — LLM 섹터/전략 스코어링 1차 입력
    "nameHints": []                 // 명칭에서 리터럴로 확인된 구조 힌트(예: "leverage=2X(명칭 표기)")
  },
  "fees": { "totalFeePct": 0.15, "netAssetsMillionKrw": 237935 },
  "performance": { "return1m": -15.82, "return3m": 24.38, "return6m": 59.82, "return12m": 155.96, "beta": 1.09 },
  "holdings": [ { "rank": 1, "code": "005930", "name": "삼성전자", "weight": 32.71, "quantity": 6978, "asOfDate": "2026-07-13" } ],
  "holdingsSource": "wisereport",   // "wisereport" | "naver_csv" | null
  "distribution": {
    "frequency": null,
    "scheduleText": "매 1, 4, 7, 10월의 마지막 영업일...",  // 분배 태그 스코어링 1차 입력(구조화 전 원문)
    "monthly": null,               // scheduleText 정규식 판정(신뢰도 낮음 — LLM 재검증 권장)
    "coveredCall": false,          // 명칭에 "커버드콜" 포함 여부(리터럴)
    "trailing12MonthAmount": null  // 미확보(§9 후속작업 참조)
  },
  "descriptions": {
    "productDescription": null, "investmentObjective": null,
    "strategyDescription": null, "benchmarkDescription": null
    // 이번 세션 소스는 자유서술 텍스트 미제공 — 전량 null. 태깅 정확도의 최대 병목.
  },
  "coverage": { "score": 0.85, "availableFields": ["etfCode","name", "..."], "missingFields": ["descriptions", "..."] },
  "sources": [ { "field": "issuer", "value": "삼성자산운용(주)", "sourceId": "wisereport", "sourceUrl": "...", "asOfDate": null, "retrievedAt": "...", "priority": 100, "confidence": 0.85 } ],
  "conflicts": []
}
```

## 태깅 관점별 1차 입력 매핑

| 태그 | 1차 입력 필드 | 상태 |
|---|---|---|
| 섹터 | `classificationFacts.rawTypeText`, `name`, `holdings[].name` | 사용 가능(원문 텍스트) |
| 전략(레버리지/인버스/액티브/커버드콜 등) | `classificationFacts.nameHints`, `name` | 리터럴 힌트만 존재 — 최종 판정은 LLM 몫 |
| 배당 | `distribution.scheduleText`, `distribution.coveredCall` | 지급 스케줄 텍스트만 있음, 실지급 이력 없음 |
| 상품 설명/투자목적 | `descriptions.*` | **전량 null** — 운용사 PDF/투자설명서 확보 전까지 스코어링 근거 부족 |

## coverage 기준 (config/field-source-priority.json)

- `coverage >= 0.75` → 정상 스코어링 가능
- `0.45 <= coverage < 0.75` → 저신뢰 스코어링 가능(결과에 신뢰도 낮음 표시 권장)
- `coverage < 0.45` → 추가 수집 필요, 스코어링 보류 권장

## 태깅 전 추가 확보가 필요한 필드 (우선순위 순)

1. **`descriptions.*`(상품 설명/투자 목적/운용 전략 원문)** — 가장 큰 병목. 운용사 상품 페이지/PDF
   파싱(§12) 또는 KIND 공시 확보 시 해결 가능(이번 세션 미구현).
2. **`classificationFacts.assetClass` / `regions`** — 현재 `rawTypeText` 원문 텍스트만 있고 구조화 안 됨.
3. **`distribution.trailing12MonthAmount` 등 실지급 이력** — SEIBro "분배금 지급현황" 재확인 필요
   (spikes/krx-direct/DETAIL_SCREEN_SOURCES.md 참조, 화면 구조만 확인됨).
4. **`sectorWeights` / `countryWeights`** — 이번 세션 소스에 없음.

## 사용 시 주의

- `codeType: "naver_internal_unresolved"`인 레코드는 KRX 표준 6자리 코드가 아니다(§「데이터 품질」
  참조). 다른 시스템과 조인 시 이름 매칭이 아닌 별도 코드 해소 절차가 필요하다.
- `sources[]`에 없는 값을 만들어내지 말 것 — null 은 "미확보"를 의미하며 추정치로 채우지 않는다.
- `conflicts[]`가 비어있지 않은 필드는 두 소스 값이 실제로 다르다는 뜻이다(하나만 조용히 채택하지 말고
  태깅 프롬프트에 두 값을 모두 노출하거나 최신 `asOfDate` 우선 규칙을 명시할 것).
