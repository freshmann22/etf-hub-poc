# ETF 데이터 소스 매트릭스

이 문서는 ETF 허브가 실데이터로 전환될 때 사용하는 공급자(provider)와 각자가 담당하는
데이터 범위(capability)를 정리한다. 구현은 `server/providers/**`, 설정은 `.env`(예시 `.env.example`),
오케스트레이션은 `server/services/etf-service.js` 를 따른다.

`docs/SOURCE_CONTEXT.md §7`(데이터 원칙)에서 정의한 우선 소스를 provider 로 구체화한 것이다.

## 1. provider ↔ capability 매핑

| provider | 종류 | 자격 | 검증 | list | summary/price | holdings | performance | distributions | disclosures |
|---|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **mock** | 로컬 fixture | 불필요 | ✅ | ✅ | ✅ | ✅ | ✅ | (빈) | ✅ |
| **toss** | 토스증권 Open API | client_id·secret(OAuth2) | ✅ 실호출 확인 | – | ✅ | – | ✅(1w/1m) | – | – |
| **publicdata** | 공공데이터포털 증권상품시세정보 | data.go.kr serviceKey | ✅ 실호출 확인 | ✅(전종목) | ✅(T+1) | – | – | – | – |
| **dart** | 전자공시 OpenAPI | API 키 | ✅ 실호출 확인 | – | – | – | – | – | ✅ |
| **krx** | 거래소 공개 데이터 | 불필요(베스트에포트) | ⚠ 400 발생 | ✅ | ✅ | – | – | – | – |
| **broker** | 범용 증권사 오픈API | 키·시크릿 | – | – | ✅ | – | – | – | – |
| **issuer** | 운용사 공식 공개자료 | 명시적 활성화 | ✅ TIGER 10종 실호출 | – | – | ✅ TIGER | – | – | – |
| **kind** | KRX 기업공시(스크래핑) | 활성화 플래그 | – | – | – | – | – | – | ✅※ |
| **seibro** | 예탁결제원(스크래핑) | 활성화 플래그 | – | – | – | ✅※ | – | ✅※ | – |

※ = 파서/약관 확인 전까지 "설정되면 시도, 미구현이면 NOT_SUPPORTED 로 정직 표기".

**운용사 공식 구성종목(issuer)**: `ISSUER_ENABLED=true`일 때 미래에셋 TIGER 공개 PDF 조회를 사용한다.
숫자형 ETF 단축코드에서 표준 ISIN을 계산하고 공식 HTML 표를 공통 holdings envelope로 정규화한다.
대표 10종 10/10 성공을 확인했으며, 미지원 운용사·영문 혼합 단축코드는 빈 응답으로 정직하게 폴백한다.
Explore 구성종목 탭은 이 공식 응답을 우선 사용한다.

**토스증권(toss)**: `POST /oauth2/token`(client_credentials) → Bearer 토큰(캐시), `GET /api/v1/prices`(현재가 배치),
`GET /api/v1/candles?interval=1d`(전일종가)로 등락률 계산. 실제 자격으로 토큰·시세 응답 200 확인.
`server/providers/toss/index.js`.

### ETF 유니버스 확장 (publicdata + toss)

Toss 는 전종목 열거 API 가 없으므로, ETF 유니버스는 **공공데이터포털(getETFPriceInfo)** 로 확보한다.

- **유니버스**: 공공데이터 ETF 전종목(약 1,141종, 최신 basDt) 을 fixture 큐레이션(24종)에 병합.
  - 큐레이션 24종: 테마·구성종목·비교셋 관계 보존 + 공공데이터로 순자산/NAV/기초지수/시총 보강.
  - 나머지(약 1,117종): **thin ETF**(테마·구성종목 없음)로 추가. 순위·검색에 참여.
- **시세 결합**: 큐레이션은 toss 캔들 포함 풀 지표, thin 은 toss 현재가(`getPricesOnly`) + 공공데이터
  전일종가로 당일 등락률 계산. toss 미매칭 코드는 공공데이터 T+1 값 사용.
- **화면 매핑**: 순위(많이 움직인 ETF)·검색 = 전종목, 히트맵·테마카드·역검색·비교 = 큐레이션(관계 데이터).
- **제약**: 공공데이터는 T+1 지연(목록·순자산엔 충분). thin ETF 는 테마/구성종목/총보수/변동성 없음.

## 2. capability 별 우선순위(live/hybrid)

`server/services/etf-service.js` 의 `PREFERENCE` 를 따른다. 위에서부터 `available && supports` 인
첫 provider 를 시도하고, 실패 시 다음으로 넘어간다.

- `getEtfList`: publicdata → krx
- `getEtfSummary` / `getEtfPrice`: **toss** → broker → krx
- `getEtfHoldings`: issuer → seibro
- `getEtfPerformance`: (실 provider 없음 — hybrid 는 mock, live 는 unavailable)
- `getEtfDistributions`: issuer → seibro
- `getEtfDisclosures`: dart → kind

### 화면 초기 번들 오버레이(`ETF_BUNDLE_OVERLAY=true`, toss 기준)

toss 가용 시 번들은 다음을 live 로 채운다(없으면 krx 리스트 → fixture 폴백):

- **ETF(직접)**: `currentPrice`, `changeRate1d`, `return1w`(5영업일), `return1m`(20영업일),
  `tradingValue`(일봉 종가×거래량/1e8, 억원 근사), `tradingValueChangeRate`(전일 대비).
- **종목(직접)**: `changeRate1d`(역검색 카드).
- **테마(파생)**: 멤버 ETF 집계 — `return1d/1w/1m`(평균), `tradingValue`(합).
- **시장요약 1d(파생)**: 상승/하락/보합 종목수, 총거래대금, 최강/최약 테마, 중립 요약문구.

여전히 fixture 또는 부분 커버리지: `volatilityScore`, `netAssets`, `totalFee`, `riskTags`, 구성종목·비중(TIGER 외),
NAV·괴리율·추적오차, 콘텐츠(뉴스/공시/리서치), 시장요약의 `tradingValueChangeRate`. 커버리지는
`/api/bundle` 응답 `meta.overlay`(fields/derived/stillMock)로 확인한다.

## 3. 모드 동작

- **mock**: 전부 로컬 fixture. 자격 없이 화면 완전 동작.
- **live**: 실 provider 만. 전부 실패/미지원이면 데이터를 지어내지 않고 `status: unavailable`.
- **hybrid**: 실 provider 우선, 실패 시 mock 폴백(`meta.fallback: true`, `meta.source: 'mock'`).

## 4. 응답 형태(envelope)

모든 데이터는 `{ data, meta }` 로 감싼다. `meta` 는 `source`, `updatedAt`, `asOfDate`,
`isDelayed`, `delayMinutes`, `status(ok|stale|partial|unavailable)`, `errorCode`, `quality` 를 포함한다.
숫자는 원시값(number|null)만 담고 표시용 포매팅은 프런트가 담당한다.

## 5. 화면 초기 번들(`/api/bundle`)

메인화면 구조(테마·종목·구성종목 관계·비교셋·시장요약·콘텐츠)는 내부 마스터/뉴스 연동 전까지
fixture 스캐폴드를 사용한다(지어내지 않기 위함). `ETF_BUNDLE_OVERLAY=true` 이고 모드가 mock 이
아니면, 단위 호환 필드(종가 KRW·등락률 %)에 한해 실 시세를 덧입히며 커버리지를 `meta.overlay` 에
정직하게 표기한다. 자세한 제약은 `docs/ETF_DATA_LIMITATIONS.md`.
