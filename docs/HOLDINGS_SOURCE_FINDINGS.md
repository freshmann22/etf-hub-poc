# 구성종목(holdings) 소스 조사 결과 — 2026-07-23 야간

전수(1,141종) 구성종목 커버리지 확대를 위해 확보 가능한 소스를 실제로 찔러보고 정리한다.
결론부터: **단일 소스로 전수는 불가**(KRX 로그인 게이트), 발행사별 익명 PDF 공시를 하나씩 붙여야 한다.

## 소스별 실측 결과

| 소스 | 호스트 | 익명 접근 | 데이터 형식 | 커버 | 상태 |
|---|---|---|---|---|---|
| **KODEX** | m.samsungfund.com | ✅ | legacy .xls(문자열 정상) | 239종 | provider 구현됨·검증됨 |
| **TIGER** | investments.miraeasset.com | ✅ | HTML 조각(UTF-8) | 229종 | provider 구현됨·검증됨 |
| **RISE(KB)** | www.riseetf.co.kr | ✅ | **HTML 테이블**(.xls로 위장) | ~141종 | **엔드포인트 크랙 완료**, provider 미구현 |
| KRX MDC | data.krx.co.kr | ❌ 로그인+보안프로그램 | - | 전체 | **게이트 — 우회 안 함** |
| 네이버 | finance.naver.com | ⚠️ rate-limit | HTML(TOP10만) | 국내주식형 | 기존 CSV(427종) 소스 |
| ACE/SOL/KIWOOM/HANARO/PLUS 등 | 각 발행사 | 미확인 | 발행사마다 다름 | 나머지 | 자본시장법상 매일 PDF 공시 의무 → 유사 패턴 예상, 각각 확인 필요 |

## 확인된 엔드포인트 (익명, 로그인 불필요)

### KODEX (samsungfund) — `server/providers/issuer/index.js` 에 구현됨
- 상품검색으로 종목코드→`fId` 동적 해석 후 excel_pdf.do 조회. 전 구성종목(현금 포함).

### TIGER (miraeasset) — 구현됨
- `POST investments.miraeasset.com/.../pdf-status-list.ajax`, `ksdFund=<ISIN>`, `listCnt=200`. 전 구성종목.

### RISE (KB) — **이번에 크랙, 미구현**
- 홀딩스: `GET https://www.riseetf.co.kr/prod/document/pdf/listExcel?searchTargetId=<펀드ID>&searchDate=YYYY-MM-DD`
  - Content-Type 은 `application/vnd.ms-excel` 이지만 **실제 본문은 HTML `<table>`** → 엑셀 라이브러리 없이 파싱 가능.
- 펀드ID(예 `44K7`)는 RISE 내부 식별자. 종목코드 매핑은 목록 페이지(`/prod/document/pdf`, listJquery)의 펀드명 ↔ 유니버스 정식명 **정확 매칭**으로 얻어야 한다(퍼지 매칭 금지 — 오매칭 시 잘못된 ETF 구성종목이 섞임).
- 호스트가 KODEX/TIGER 와 달라 **rate-limit 독립**(병렬 가능).

## 이번 밤 진행 상황 / 한계

- **KODEX/TIGER 벌크 수집 중 rate-limit 차단**을 유발했다(초기 조사에서 짧은 시간 ~80콜). 이후 저속·순차·백오프·회로차단(연속 차단 시 20분 침묵) 수집기(`scripts/collect-issuer-holdings.mjs`)로 전환해 밤새 돌린다 — 밴이 풀리면 468종을 재개 수집하고 `public/data/etf-holdings.json` 에 체크포인트 병합한다(기존 네이버 427종 보존).
- **KRX 로그인·보안프로그램 게이트는 우회하지 않는다**(안전 원칙). getJsonData.cmd 익명 호출은 `LOGOUT` 반환 확인.
- **퍼지 매칭 데이터는 canonical 에 병합하지 않는다**(빈 데이터 > 잘못된 데이터).

## 다음 단계 (권장 우선순위)

1. KODEX/TIGER 수집 완주(진행 중) → 커버리지 427 → ~650+.
2. **RISE provider 구현**(정확 매칭 + HTML 파서 + 검증) → +~141. 다른 호스트라 안전.
3. ACE/SOL/KIWOOM/HANARO/PLUS 각 발행사 PDF 엔드포인트 확인 후 provider 추가(점진).
4. 지속 운영은 **on-demand**(상세 열 때 1콜, 캐시)로 — 사이트가 의도한 사용 패턴. 앱은 이미 `/api/etf/:code/holdings` 를 우선 호출하도록 배선돼 있어 issuer provider 를 켜면 동작.
5. 전수 즉시성이 필요하면 KRX/발행사 **데이터 라이선스**(사업성 검토) — 로드맵 원칙과 일치.
