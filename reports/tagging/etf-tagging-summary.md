# ETF 태깅 요약

생성 시각: 2026-07-16T00:47:30.707Z
taxonomy version: 1.0.0

## 규모
- 규칙 분류기 처리 ETF: 470종 (규칙으로 태그 부여됨: 88종)
- Claude 서브에이전트 스코어링 완료 ETF: 470종
- 병합 최종 레코드: 470종 (병합 충돌 14건)

## UI 필터 매핑
- 활성 필터 수(minimumScore/minimumConfidence 통과): 22
- 태그가 하나 이상 부여된 ETF: 243종

| tagId | 매칭 ETF 수 |
|---|---|
| sector.financials | 15 |
| strategy.inverse | 13 |
| strategy.leverage | 50 |
| sector.commodities | 1 |
| strategy.nasdaq100 | 2 |
| strategy.consumer_discretionary | 7 |
| sector.semiconductor | 45 |
| sector.healthcare_bio_pharma | 18 |
| sector.it | 6 |
| dividend.korea_high_dividend | 24 |
| dividend.covered_call | 21 |
| strategy.value | 3 |
| sector.game_entertainment_media | 12 |
| sector.ev_battery | 20 |
| strategy.growth | 2 |
| strategy.reit | 9 |
| strategy.sp500 | 4 |
| sector.clean_energy | 4 |
| sector.aerospace_defense | 10 |
| sector.ai_power_infrastructure | 4 |
| strategy.value_up | 10 |
| dividend.monthly | 2 |

## 저신뢰/미분류
- low-confidence 분류: 77건
- unclassified ETF: 227종

## 신규 필터 후보
- `strategy.bond_credit_domestic`(국내 크레딧/회사채, strategy) — 매칭 2종, 평균 score 0.6, 평균 confidence 0.5 → **review**
- `sector.shipbuilding`(조선, sector) — 매칭 1종, 평균 score 0.95, 평균 confidence 0.85 → **add**
- `strategy.consumer_beauty_food`(소비재(뷰티/식품), strategy) — 매칭 1종, 평균 score 0.6, 평균 confidence 0.45 → **merge**
- `strategy.large_conglomerate_group`(그룹주(대기업집단), strategy) — 매칭 1종, 평균 score 0.85, 평균 confidence 0.6 → **review**
- `sector.beauty_cosmetics`(화장품/뷰티, sector) — 매칭 1종, 평균 score 0.9, 평균 confidence 0.65 → **add**
- `strategy.small_mid_cap`(중소형주 포커스, strategy) — 매칭 1종, 평균 score 0.7, 평균 confidence 0.5 → **review**
- `strategy.export_leaders`(수출주(수출 핵심기업), strategy) — 매칭 1종, 평균 score 0.75, 평균 confidence 0.55 → **review**
- `sector.nuclear_power`(원전/원자력, sector) — 매칭 3종, 평균 score 0.95, 평균 confidence 0.85 → **add**
