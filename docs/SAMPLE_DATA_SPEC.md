# SAMPLE DATA SPEC

## 1. 목적

이번 PoC의 데이터는 실제 투자 판단용 데이터가 아니라 화면 구조와 인터랙션 검증용 로컬 샘플 데이터다.

실제 ETF명과 종목명을 사용할 수 있으나 수치가 실데이터로 오인되지 않도록 화면에 `PoC용 샘플 데이터` 고지를 표시한다.

## 2. 최소 데이터 규모

| 엔터티 | 최소 개수 |
|---|---:|
| ETF | 20 |
| 테마 | 10 |
| 종목 | 10 |
| ETF-종목 편입 관계 | 60 |
| 뉴스 | 8 |
| 공시 | 3 |
| 리서치 | 3 |
| 시장 요약 스냅샷 | 3개 기간 |
| 비교 세트 | 2개 테마 이상 |

## 3. ETF 필드

필수:

```text
id
code
name
issuer
themeId
category
currentPrice
changeRate1d
return1w
return1m
tradingValue
tradingValueChangeRate
netAssets
totalFee
volatilityScore
riskTags[]
summary
topHoldings[]
```

선택:

```text
benchmark
listingDate
distributionYield
leverageType
region
assetClass
```

## 4. 테마 필드

```text
id
name
return1d
return1w
return1m
tradingValue
tradingValueChangeRate
representativeEtfIds[]
representativeStockIds[]
issueSummary
```

테마 카드 크기는 `tradingValue`의 상대값으로 계산할 수 있다.

## 5. 종목 필드

```text
id
code
name
sector
changeRate1d
relatedEtfIds[]
```

## 6. ETF-종목 편입 관계

```text
etfId
stockId
weight
rank
```

정합성 규칙:

- 동일 ETF와 종목 조합은 중복되지 않는다.
- `weight`는 0보다 크고 100 이하의 백분율이다.
- 한 ETF의 전체 샘플 편입비중 합계가 100일 필요는 없다. 상위 종목 일부만 제공할 수 있기 때문이다.
- 상위 종목 목록의 `rank`는 중복되지 않는다.
- 종목→ETF 검색 결과는 동일 관계 데이터를 역으로 사용한다.

## 7. 콘텐츠 필드

공통:

```text
id
type
title
summary
publishedAt
relatedEtfIds[]
relatedStockIds[]
relatedThemeIds[]
```

`type`:

```text
news
disclosure
research
```

추가 선택 필드:

```text
source
reportType
importance
```

## 8. 시장 요약 필드

```text
asOf
advancers
decliners
unchanged
totalTradingValue
tradingValueChangeRate
strongestThemeId
weakestThemeId
summary
```

## 9. 기간별 데이터

히트맵은 최소 다음 기간을 지원한다.

```text
1d
1w
1m
```

기간 변경 시 최소한 다음 값이 변경돼야 한다.

- 테마 수익률
- 테마 정렬
- ETF 카드 수익률 표시
- 강한 테마 및 약한 테마

## 10. 순위 로직

### 상승

`changeRate1d` 내림차순

### 하락

`changeRate1d` 오름차순

### 거래 급증

`tradingValueChangeRate` 내림차순

### 변동성 확대

`volatilityScore` 내림차순

동률일 경우:

1. 거래대금 내림차순
2. ETF명 오름차순

## 11. 검색 로직

검색 대상:

- ETF명
- ETF 코드
- 종목명
- 종목 코드
- 테마명

기본 규칙:

- 앞뒤 공백 제거
- 대소문자 무시
- 한글 부분 일치
- 중복 결과 제거
- 빈 문자열은 추천 검색어 또는 기본 상태 표시

## 12. 비교 데이터 규칙

비교 ETF는 동일 또는 유사 테마에 속해야 한다.

비교 설명은 데이터에서 도출 가능한 내용만 사용한다.

예시:

- 상위 2개 종목 비중 합계가 더 높음
- 장비주 비중이 상대적으로 높음
- 순자산과 거래대금 규모가 큼
- 총보수가 낮음

단, 이러한 차이를 `더 좋은 ETF`로 해석하지 않는다.

## 13. 샘플 데이터 정합성

- 상승 ETF 수 + 하락 ETF 수 + 보합 ETF 수는 전체 ETF 수와 논리적으로 일치해야 한다.
- 강한 테마의 수익률은 약한 테마보다 높아야 한다.
- ETF 카드의 주요 구성종목은 편입 관계에 존재해야 한다.
- 종목→ETF 결과의 편입비중은 해당 ETF의 구성종목 데이터와 일치해야 한다.
- 비교 카드의 수치는 ETF 기본 데이터와 일치해야 한다.
- 뉴스·공시·리서치의 관련 ETF 및 종목 ID는 실제 샘플 엔터티를 참조해야 한다.
- 누락값은 `null`로 표현하고 UI에서 fallback 처리한다.
- 금액 단위는 프로젝트 전체에서 일관되게 사용한다.

## 14. 데이터 고지

화면 상단 또는 헤더 인접 위치에 다음 문구를 항상 노출한다.

> 화면 내 정보는 PoC용 샘플 데이터입니다.

프리뷰 바텀시트 또는 하단 유의사항에는 다음 취지를 추가할 수 있다.

> 실제 시세와 상품정보가 아니며 화면 검증을 위해 구성한 예시입니다.
