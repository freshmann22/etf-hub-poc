# ETF 태깅 요약

생성 시각: 2026-07-20T05:19:48.061Z
taxonomy version: 2.0.1

## 규모
- 규칙 분류기 처리 ETF: 470종 (규칙으로 태그 부여됨: 470종)
- Claude 서브에이전트 스코어링 완료 ETF: 470종
- 병합 최종 레코드: 1141종 (병합 충돌 6건)

## UI 필터 매핑
- 활성 필터 수(minimumScore/minimumConfidence 통과): 54
- 태그가 하나 이상 부여된 ETF: 1141종

| tagId | 매칭 ETF 수 |
|---|---|
| strategy.benchmark.kospi200 | 96 |
| region.domestic_kr | 696 |
| asset.equity | 856 |
| strategy.passive_index | 831 |
| region.japan | 14 |
| sector.financials | 15 |
| asset.bond.government | 84 |
| asset.bond | 221 |
| strategy.inverse | 41 |
| region.china | 58 |
| strategy.leverage | 72 |
| asset.commodity | 24 |
| strategy.large_conglomerate_group | 6 |
| strategy.benchmark.nasdaq100 | 25 |
| region.us | 284 |
| asset.bond.corporate | 48 |
| asset.currency | 11 |
| sector.consumer_discretionary | 7 |
| sector.construction | 1 |
| sector.shipbuilding | 8 |
| sector.steel_metals | 1 |
| sector.energy_chemicals | 2 |
| sector.semiconductor | 45 |
| sector.transportation_logistics | 1 |
| strategy.benchmark.sp500 | 57 |
| sector.healthcare_bio_pharma | 18 |
| sector.it | 6 |
| dividend.korea_high_dividend | 24 |
| dividend.covered_call | 60 |
| strategy.low_volatility | 2 |
| asset.reit | 14 |
| region.developed | 73 |
| region.emerging | 2 |
| region.india | 13 |
| dividend.dividend_growth | 2 |
| sector.consumer_staples_food | 4 |
| strategy.value | 3 |
| sector.beauty_cosmetics | 3 |
| sector.game_entertainment_media | 12 |
| region.vietnam | 1 |
| strategy.active | 310 |
| strategy.esg_screening | 5 |
| sector.ev_battery | 20 |
| asset.mixed | 15 |
| strategy.growth | 2 |
| asset.bond.money_market | 28 |
| sector.clean_energy | 4 |
| sector.aerospace_defense | 10 |
| sector.nuclear_power | 5 |
| asset.bond.target_maturity | 18 |
| sector.ai_power_infrastructure | 4 |
| strategy.value_up | 10 |
| dividend.monthly | 2 |
| sector.robotics | 3 |

## 저신뢰/미분류
- low-confidence 분류: 94건
- unclassified ETF: 0종

## 신규 필터 후보
- `sector.shipbuilding`(조선/조선기자재, sector) — 매칭 9종, 평균 score 0.88, 평균 confidence 0.59 → **add**
- `sector.nuclear_power`(원전/원자력, sector) — 매칭 5종, 평균 score 0.93, 평균 confidence 0.75 → **add**
- `sector.beauty_cosmetics`(화장품/뷰티, sector) — 매칭 4종, 평균 score 0.8, 평균 confidence 0.58 → **add**
- `strategy.kospi200_domestic_benchmark`(코스피200/국내 대표지수 추종, strategy) — 매칭 8종, 평균 score 0.61, 평균 confidence 0.41 → **add**
- `strategy.large_conglomerate_group`(그룹주(계열사 집중), strategy) — 매칭 7종, 평균 score 0.73, 평균 confidence 0.56 → **add**
- `strategy.esg_screening`(ESG/탄소효율, strategy) — 매칭 9종, 평균 score 0.55, 평균 confidence 0.49 → **add**
- `strategy.low_volatility`(저변동성(로우볼), strategy) — 매칭 5종, 평균 score 0.61, 평균 confidence 0.46 → **add**
- `sector.consumer_staples_food`(필수소비재/식품(K-푸드), sector) — 매칭 4종, 평균 score 0.81, 평균 confidence 0.56 → **add**
- `sector.energy_chemicals`(에너지/화학(정유·화학 밸류체인), sector) — 매칭 3종, 평균 score 0.75, 평균 confidence 0.53 → **add**
- `dividend.korea_dividend_growth`(국내 배당성장, dividend) — 매칭 2종, 평균 score 0.65, 평균 confidence 0.5 → **merge**
- `strategy.consumer_beauty_food`(소비재(뷰티/식품 혼합, 약신호), strategy) — 매칭 1종, 평균 score 0.6, 평균 confidence 0.45 → **merge**
- `sector.robotics`(휴머노이드로봇/로보틱스, sector) — 매칭 6종, 평균 score 0.69, 평균 confidence 0.49 → **review**
- `sector.steel_metals`(철강/금속(비철 포함), sector) — 매칭 2종, 평균 score 0.83, 평균 confidence 0.53 → **review**
- `sector.construction`(건설, sector) — 매칭 2종, 평균 score 0.83, 평균 confidence 0.53 → **review**
- `sector.metaverse`(메타버스, sector) — 매칭 4종, 평균 score 0.55, 평균 confidence 0.4 → **review**
- `sector.sovereign_ai`(소버린AI(Sovereign AI), sector) — 매칭 2종, 평균 score 0.55, 평균 confidence 0.4 → **review**
- `sector.artificial_intelligence`(인공지능(AI, 범용), sector) — 매칭 2종, 평균 score 0.63, 평균 confidence 0.45 → **review**
- `strategy.momentum_factor`(모멘텀 팩터, strategy) — 매칭 2종, 평균 score 0.58, 평균 confidence 0.38 → **review**
- `strategy.equal_weight`(동일가중, strategy) — 매칭 2종, 평균 score 0.55, 평균 confidence 0.4 → **review**
- `strategy.long_short`(롱숏 전략, strategy) — 매칭 2종, 평균 score 0.7, 평균 confidence 0.6 → **review**
- `strategy.shareholder_value`(주주가치/셰어홀더밸류, strategy) — 매칭 2종, 평균 score 0.48, 평균 confidence 0.33 → **review**
- `strategy.bond_credit_domestic`(국내 크레딧/회사채(채권형), strategy) — 매칭 2종, 평균 score 0.6, 평균 confidence 0.5 → **review**
- `strategy.export_leaders`(수출주, strategy) — 매칭 2종, 평균 score 0.65, 평균 confidence 0.475 → **review**
- `sector.transportation_logistics`(운송/물류, sector) — 매칭 1종, 평균 score 0.85, 평균 confidence 0.6 → **review**
- `strategy.small_mid_cap`(중소형주 포커스, strategy) — 매칭 1종, 평균 score 0.7, 평균 confidence 0.5 → **reject**
- `strategy.defensive_stocks`(경기방어주, strategy) — 매칭 1종, 평균 score 0.65, 평균 confidence 0.5 → **reject**
- `strategy.quality_factor`(퀄리티 팩터, strategy) — 매칭 1종, 평균 score 0.6, 평균 confidence 0.4 → **reject**
- `strategy.preferred_stock`(우선주 전략, strategy) — 매칭 1종, 평균 score 0.75, 평균 confidence 0.5 → **reject**
- `sector.holding_company`(지주회사, sector) — 매칭 1종, 평균 score 0.85, 평균 confidence 0.6 → **reject**
- `sector.telecom_services`(통신서비스, sector) — 매칭 1종, 평균 score 0.75, 평균 confidence 0.55 → **reject**
- `sector.ecommerce_retail`(이커머스/유통, sector) — 매칭 1종, 평균 score 0.6, 평균 confidence 0.5 → **reject**
- `sector.domestic_demand`(내수주, sector) — 매칭 1종, 평균 score 0.55, 평균 confidence 0.45 → **reject**
- `sector.bbig`(BBIG(배터리·바이오·인터넷·게임), sector) — 매칭 1종, 평균 score 0.7, 평균 confidence 0.55 → **reject**
- `sector.internet_platform`(인터넷/플랫폼, sector) — 매칭 1종, 평균 score 0.75, 평균 confidence 0.5 → **reject**
- `sector.telecom_infra_5g`(5G/통신인프라, sector) — 매칭 1종, 평균 score 0.55, 평균 confidence 0.45 → **reject**
- `sector.entertainment_weak`(엔터테인먼트(약한 신호), sector) — 매칭 1종, 평균 score 0.45, 평균 confidence 0.4 → **reject**
- `strategy.multi_asset_allocation`(글로벌 자산배분/멀티에셋, strategy) — 매칭 1종, 평균 score 0.7, 평균 confidence 0.5 → **reject**
- `sector.auto_parts_supply_chain`(자동차 소부장(부품/소재/장비 공급망), sector) — 매칭 1종, 평균 score 0.75, 평균 confidence 0.55 → **reject**
- `sector.medical_ai_healthtech`(의료AI/헬스케어테크, sector) — 매칭 1종, 평균 score 0.5, 평균 confidence 0.35 → **reject**
- `sector.automobile`(자동차(완성차), sector) — 매칭 1종, 평균 score 0.8, 평균 confidence 0.5 → **reject**
