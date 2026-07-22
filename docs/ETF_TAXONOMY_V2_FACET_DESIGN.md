# ETF 택소노미 v2 — 다축(Facet) 재설계안

상태: **설계 초안(구현 전, 사용자 승인 대기)** / 작성일: 2026-07-16 / 대상: `config/etf-tagging/etf-taxonomy.json`
현재 버전 v1.0.0(3 대분류·25 태그) → 제안 v2.0.0(**5 facet·~60 태그**)

> 이 문서는 **정책 설계안**이다. taxonomy 파일·스코어링 코드·데이터는 이 문서 승인 전까지 변경하지 않는다.
> 실행 순서·파일 소유·충돌 방지는 별도 문서 [`ETF_TAXONOMY_V2_WORKPLAN.md`](./ETF_TAXONOMY_V2_WORKPLAN.md) 참조.

---

## 1. 왜 바꾸나 (문제 정의)

현재 v1.0.0 은 3개 대분류(`sector` / `strategy` / `dividend`)의 멀티라벨 구조다. 유니버스 1,141종을
실제로 분류해보니 **3축이 서로 독립적이지 않고, 아예 빠진 축이 있어** 대량 종목이 미분류로 빠진다.

| 못 담는 것 | 유니버스 내 규모(이름 기반 추정) | v1 처리 |
|---|---|---|
| **채권형**(국채·회사채·만기매칭·금리) | ~184종 (16%) | ❌ 담을 대분류 없음 |
| **해외/지역**(미국·중국·인도·글로벌) | ~397종 (35%) | ⚠️ 개별 태그에 지역이 숨음(sp500=미국) |
| 혼합/멀티에셋/TDF | ~68종 | ❌ 없음 |
| 리츠·부동산 | ~15종 | ⚠️ `strategy.reit`로 억지 흡수 |
| 원자재 | ~12종 | ⚠️ `sector.commodities`로 억지 흡수 |

구조적 진단:
1. **자산군(assetClass)·지역(region) 축이 없음** — ETF 분류의 1차 축인 자산군이 통째로 빠져 채권 184종이 갈 곳이 없다. 지역도 독립 축인데 개별 태그에 녹아 있어 "미국 반도체 vs 국내 반도체"를 구분 못 한다.
2. **`strategy` 대분류 과부하** — 배율(레버리지/인버스)·팩터(성장/가치)·지수추종(sp500/nasdaq100)·자산군(리츠)·테마전략(밸류업)이 한 바구니에 뒤섞여 "섹터·배당 아닌 나머지 다"가 되었다.

## 2. 설계 원칙

- **직교(orthogonal) facet**: 각 축은 독립 질문에 답한다. 한 ETF는 각 facet에서 **0~N개** 태그를 가진다.
  - 예) `TIGER 미국나스닥100` = assetClass:`equity` · region:`us` · strategy:`passive_index`(+benchmark:`nasdaq100`)
  - 예) `KODEX 27-12 회사채(AA-이상)액티브` = assetClass:`bond`(+`corporate`,`target_maturity`) · region:`domestic_kr` · strategy:`active`
- **assetClass·region 은 원칙적으로 단일 주값**(primary) + 보조 세부태그 허용. sector/strategy/dividend 는 멀티라벨.
- **하위 호환**: v1 태그 id 는 **폐기하지 않고 v2 태그로 매핑**(§5 매핑표). 소비자(filter-map/UI)가 깨지지 않도록 v1→v2 별칭(alias)을 taxonomy에 병기.
- **근거 우선(기존 워커 원칙 유지)**: 이름/기초지수/구성종목 근거 없으면 태그 미부여. 특히 assetClass·region 은 **이름·기초지수만으로 규칙 판정이 쉬운 축**이라 rule classifier 커버리지가 높다.
- **"추정 생성 금지" 유지**: 값 없으면 null, `sources` 근거 보존(메타데이터 파이프라인 원칙과 동일).

## 3. 제안 5 Facet 구조

### Facet A — `assetClass` (자산군) · primary 단일값 + 세부
| tagId | label | 판정 신호(이름/기초지수) |
|---|---|---|
| `asset.equity` | 주식 | 기본값(대부분) |
| `asset.bond` | 채권 | 채권·국채·회사채·종합채권·금리·KOFR·통안·만기매칭·`NN-NN` |
| `asset.bond.government` | └ 국채 | 국채·통안·미국채 |
| `asset.bond.corporate` | └ 회사채 | 회사채·크레딧·AA-·A+이상 |
| `asset.bond.target_maturity` | └ 만기매칭 | `26-12`,`28-04` 등 연-월 표기 |
| `asset.bond.money_market` | └ 초단기/금리 | KOFR·CD금리·초단기·머니마켓 |
| `asset.commodity` | 원자재 | 금·은·원유·구리·귀금속·천연가스·농산물 |
| `asset.reit` | 리츠/부동산 | 리츠·REIT·부동산 |
| `asset.mixed` | 혼합/멀티에셋 | 혼합·밸런스·멀티에셋·자산배분·TDF·EMP·채권혼합 |
| `asset.currency` | 통화/환 | 달러·엔화·통화 (소수, 후보) |

### Facet B — `region` (지역) · primary 단일값
| tagId | label | 판정 신호 |
|---|---|---|
| `region.domestic_kr` | 국내 | 기본(해외 표기 없으면) · 코스피·코스닥·KRX |
| `region.us` | 미국 | 미국·S&P·나스닥·다우·러셀 |
| `region.china` | 중국 | 중국·차이나·항셍·CSI |
| `region.japan` | 일본 | 일본·닛케이·TOPIX |
| `region.india` | 인도 | 인도·Nifty |
| `region.vietnam` | 베트남 | 베트남 |
| `region.developed` | 선진국/글로벌 | 글로벌·선진국·MSCI World·G2 |
| `region.emerging` | 신흥국 | 신흥국·EM·이머징 |

### Facet C — `sector` (섹터/테마) · 멀티라벨 — **v1 sector 12개 유지 + 승격**
v1 유지: game_entertainment_media, it, healthcare_bio_pharma, semiconductor, ev_battery, clean_energy,
autonomous_mobility, tech_general, financials, aerospace_defense, ai_power_infrastructure
(단 `sector.commodities` → **Facet A `asset.commodity` 로 이동**)

auditor ADD 승격: `sector.shipbuilding`(조선), `sector.nuclear_power`(원전), `sector.beauty_cosmetics`(화장품),
`sector.consumer_staples_food`(필수소비재/식품), `sector.energy_chemicals`(정유·화학)
auditor REVIEW 승격 **확정**(2026-07-16 결정, 표본 2건이라도 포함): `sector.steel_metals`(철강),
`sector.construction`(건설), `sector.robotics`(로봇), `sector.transportation_logistics`(운송/물류)

### Facet D — `strategy` (구조·전략) · 멀티라벨 — **재편(과부하 해소)**
하위 그룹으로 정리(그룹은 UI 그룹핑용 메타, tagId는 평면):
- **구조/배율**: `strategy.leverage`, `strategy.inverse` (v1 유지)
- **운용방식**: `strategy.active`(액티브), `strategy.passive_index`(지수추종) — 신규
- **팩터**: `strategy.growth`, `strategy.value`(v1 유지), `strategy.low_volatility`, `strategy.momentum`, `strategy.quality`, `strategy.equal_weight` — 저변동성만 ADD, 나머지 REVIEW
- **벤치마크(대표지수)**: `strategy.benchmark.sp500`, `strategy.benchmark.nasdaq100`, `strategy.benchmark.kospi200` — v1 sp500/nasdaq100 이동 + 코스피200 ADD
- **테마전략**: `strategy.value_up`(v1), `strategy.esg_screening`(ADD), `strategy.large_conglomerate_group`(그룹주, ADD)
- **이동**: `strategy.reit` → Facet A `asset.reit` / `strategy.consumer_discretionary` → Facet C `sector.consumer_discretionary`(섹터가 맞음)

### Facet E — `dividend` (배당) · 멀티라벨 — **v1 4개 유지**
korea_high_dividend, covered_call, monthly 유지.
`dividend.us_dividend_growth` → auditor merge 권고대로 **지역 한정 해제** → `dividend.dividend_growth`(지역은 Facet B가 담당).

## 4. 데이터 모델 변경

`etf-taxonomy.json` (v2.0.0):
```jsonc
{
  "version": "2.0.0",
  "facets": [
    { "id": "assetClass", "label": "자산군", "cardinality": "primary" },
    { "id": "region",     "label": "지역",   "cardinality": "primary" },
    { "id": "sector",     "label": "섹터/테마", "cardinality": "multi" },
    { "id": "strategy",   "label": "구조·전략", "cardinality": "multi" },
    { "id": "dividend",   "label": "배당",   "cardinality": "multi" }
  ],
  "tags": [
    { "id": "asset.bond.corporate", "facet": "assetClass", "parent": "asset.bond",
      "label": "회사채", "definition": "...", "positiveSignals": [...], "negativeSignals": [...],
      "minimumScore": 0.6, "minimumConfidence": 0.5, "aliasOf_v1": null, "enabled": true, "version": "2.0.0" }
    // ...
  ]
}
```
변경점: `categories` → `facets`(cardinality 추가), 각 tag에 `facet`·`parent`(계층)·`aliasOf_v1` 필드 추가.
`etf-tag-scores.json`/`etf-filter-map.json` 출력 스키마: `filters` 키를 facet 프리픽스로 그대로 사용(하위호환).

## 5. v1 → v2 마이그레이션 매핑 (25 태그 전량)

| v1 tagId | v2 처리 | 비고 |
|---|---|---|
| sector.* (11개, commodities 제외) | **유지**(facet=sector) | id 불변 |
| sector.commodities | **이동** → `asset.commodity` | facet 변경 |
| strategy.leverage / inverse | 유지(facet=strategy, 구조) | id 불변 |
| strategy.growth / value | 유지(facet=strategy, 팩터) | id 불변 |
| strategy.consumer_discretionary | **이동** → `sector.consumer_discretionary` | 섹터가 정확 |
| strategy.reit | **이동** → `asset.reit` | 자산군 |
| strategy.sp500 | **이동** → `strategy.benchmark.sp500` + region.us 자동부여 | 별칭 유지 |
| strategy.nasdaq100 | **이동** → `strategy.benchmark.nasdaq100` + region.us | 별칭 유지 |
| strategy.value_up | 유지(facet=strategy, 테마) | id 불변 |
| dividend.korea_high_dividend / covered_call / monthly | 유지(facet=dividend) | id 불변 |
| dividend.us_dividend_growth | **개명** → `dividend.dividend_growth`(지역 해제) | aliasOf 병기 |

- **새로 계산이 필요한 축**: assetClass 전체, region 전체, strategy.active/passive_index, benchmark.kospi200, 팩터(low_vol 등), auditor ADD 섹터 5종. → 대부분 rule classifier(이름/기초지수)로 1차 커버 가능.
- **재스코어링 범위**: assetClass/region 은 rule 우선(고커버리지). sector/strategy 신규 태그는 서브에이전트 재스코어링(기존 배치 재사용).

## 6. 예상 효과

- 채권 ~184종, 해외 ~397종이 **제 축에 분류** → 미분류(현재 227) 대폭 감소 예상.
- 필터 UX가 자연스러운 드릴다운: **자산군 → 지역 → 섹터/테마 → 전략** (현재 이름-키워드 chipMatches 대체).
- `strategy` 과부하 해소로 태그 의미가 명확해짐(팩터 vs 구조 vs 벤치마크 분리).

## 7. 정책 결정 — **확정 (2026-07-16)**

| # | 항목 | 결정 |
|---|---|---|
| 1 | 채권 세분화 수준 | **권고안대로 나눔** — `asset.bond` + 국채/회사채/만기매칭/초단기 세부 |
| 2 | 지역 세분화 수준 | **권고안대로** — 주요 8개(국내/미국/중국/일본/인도/베트남/선진국·글로벌/신흥국) |
| 3 | benchmark facet 독립 여부 | **strategy 하위 유지**(`strategy.benchmark.*`) — 6번째 facet 신설 안 함 |
| 4 | REVIEW 섹터(철강·건설·로봇·운송) | **함께 승격** — 표본 2건이라도 포함(§3 Facet C 반영) |
| 5 | 버전 전략 | **새 파일 병행** — `etf-taxonomy-v2.json` + `data/tagging/v2/**`, 컷오버는 마지막 승인(WORKPLAN §1) |
| 6 | UI 연결 시점 | **분리** — v2 컷오버 후 별도 승인 단계에서 explore.js 연결(WORKPLAN §6) |

→ 미결 없음. 설계 확정. 실행은 WORKPLAN 순서대로 진행하되 컷오버·UI연결은 각각 별도 승인.

## 8. 승인 후 실행 개요(상세는 WORKPLAN)

1. taxonomy v2 초안 작성(`etf-taxonomy-v2.json`) → 2. rule classifier 규칙 확장(assetClass/region) →
3. 배치 재스코어링(신규 facet만, etf-scoring-worker) → 4. merge/filter-map 재생성(v2 스키마) →
5. auditor 재감사 → 6. 리포트·검증 → 7. (별도) explore.js UI 연결.
