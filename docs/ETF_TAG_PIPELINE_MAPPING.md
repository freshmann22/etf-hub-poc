# ETF 탐색 태그·뉴스 브리핑 매핑

기준 버전: ETF taxonomy `2.0.0` / Explore map `1.0.0`

## 역할 분리

| 계층 | 식별자 | 원천 | 소비자 |
|---|---|---|---|
| ETF 속성 | `asset.*`, `region.*`, `sector.*`, `strategy.*`, `dividend.*` | ETF 이름·기초지수·구성종목을 스코어링한 `etf-filter-map.json` | ETF 탐색 필터 |
| 뉴스 주석 | 종목코드, `topic.*` | 기사 스크래핑 후 엔티티·토픽 분류 | 기사-브리핑 배정 |
| 브리핑 채널 | `targetTagId` | ETF 속성 태그와 뉴스 앵커를 연결하는 `explore-tag-map.json` | 태그별 AI 브리핑 생성 |

ETF 속성 태그와 뉴스 토픽은 서로 다른 네임스페이스다. 브리핑 채널만 두 체계를 연결한다.

## UI 위계

| Facet | Cardinality | UI 필터 원칙 |
|---|---|---|
| 섹터/테마 | multi | 해당 섹터에 유의미한 익스포저가 있는 ETF |
| 구조·전략 | multi | 배율·운용방식·팩터·벤치마크·테마전략 |
| 배당 | multi | 배당 성격과 분배 구조 |
| 자산군 | primary | 주 자산군 1개, 채권은 보조 세부태그 허용 |
| 지역 | primary | 주 투자지역 1개 |

UI 버튼 순서와 노출 범위는 `config/etf-tagging/explore-tag-map.json`의 `facets[].filters`가 유일한 기준이다.
ETF 소속은 버튼 라벨이나 상품명 키워드가 아니라 `data/tagging/etf-filter-map.json`의
`filters[tagId]`로 판정한다.

## 브리핑 채널

| 대상 ETF 태그 | ETF 앵커 | 뉴스 토픽 앵커 |
|---|---|---|
| `sector.semiconductor` | 상위 구성종목 | 없음 |
| `sector.aerospace_defense` | 상위 구성종목 | 없음 |
| `sector.ev_battery` | 상위 구성종목 | 없음 |
| `sector.shipbuilding` | 상위 구성종목 | 없음 |
| `strategy.benchmark.sp500` | 상위 구성종목 | `topic.us_index`, `topic.rates` |
| `asset.bond` | 상위 구성종목 | `topic.rates`, `topic.credit` |

채널이 없는 ETF 태그는 ETF 필터로는 사용할 수 있지만 AI 브리핑은 발행하지 않는다.
새 채널은 뉴스 토픽 어휘와 기사 공급 범위를 확정한 뒤 명시적으로 추가한다.

## 버전 규칙

- Explore map과 filter map의 `taxonomyVersion`이 다르면 UI 태그 필터를 적용하지 않는다.
- 브리핑 결과의 `taxonomyVersion`도 동일해야 한다.
- UI 라벨·facet·부모 태그는 taxonomy 원본과 일치해야 한다.
- 분류 결과가 0개인 태그는 UI 매핑에 넣지 않는다.
