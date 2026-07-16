# KRX ETF PDF 직접 수집 스파이크 — 결과

브랜치: `feat/krx-direct-scraper-spike`
실행일: 2026-07-14
프롬프트: `KRX_DIRECT_SCRAPER_SPIKE_PROMPT.md`

## 결론: **자동 수집 부적합 (1단계에서 중단)**

KRX Data Marketplace(`data.krx.co.kr`)의 ETF PDF(구성종목) 메뉴는 **로그인 없이는
서버 단에서부터 차단**된다. 익명 요청은 실제 콘텐츠 대신 다음 스텁을 반환하고 즉시
로그인 페이지로 리다이렉트한다(`raw/2026-07-14/etf_pdf_menu_anonymous.response.html`):

```html
<script type='text/javascript'>
alert('로그인 또는 회원가입이 필요합니다.');
location.href='/contents/MDC/COMS/client/MDCCOMS001.cmd?...';
</script>
```

동일 현상이 **PDF 메뉴뿐 아니라 일반 조회 메뉴(ETF 전종목 시세, MDC0201030101)에도** 동일하게
나타난다(`etf_list_menu_anonymous_control.response.html`) — 즉 ETF PDF 만의 제약이 아니라
**이 사이트의 기본통계 열람 자체가 현재 로그인을 요구하도록 정책이 바뀐 것**으로 판단된다.

추가로, 로그인 페이지 진입 시 "보안프로그램을 설치하셔야 이용이 가능한 서비스입니다"
설치 확인창이 뜬다. 안전 원칙(§14, §19: 로그인·차단 우회 금지, 임의 프로그램 설치 금지)에
따라 설치를 거부했고, 로그인도 시도하지 않았다.

→ §16 "중단" 기준의 "CAPTCHA 또는 로그인 우회 필요"에 해당한다. Workstream B(단일 ETF
수집)·C(표본/동시성)·D는 A의 실패로 착수 조건이 성립하지 않아 수행하지 않았다.

## 1. 단일 ETF 결과

수집 시도 자체가 로그인 게이트에서 막혀 진행 불가.

```json
{
  "etfCode": "069500",
  "requestedDate": null,
  "resolvedDate": null,
  "status": "BLOCKED",
  "httpStatus": 200,
  "contentType": "text/html",
  "rowCount": 0,
  "rawPath": "spikes/krx-direct/raw/2026-07-14/etf_pdf_menu_anonymous.response.html",
  "message": "서버가 로그인 리다이렉트 스텁(419 bytes)만 반환. 실제 PDF 조회 화면(bld 파라미터 포함) 자체가 로드되지 않아 다운로드/조회 엔드포인트 구조를 확보하지 못함."
}
```

## 2. 표본·동시성 결과

미수행(§16 중단 기준 도달, Workstream B 선행 조건 미충족).

## 3. 요청 구조(확인된 범위)

- **사이트 프레임워크**: KRX Data Marketplace 공통 데이터 엔드포인트는
  `POST /comm/bldAttendant/getJsonData.cmd`, body `bld=dbms/MDC/...&<params>` 패턴
  (예: 메인 페이지 위젯에서 실측 `bld=dbms/MDC/MAIN/MDCMAIN00102&ddTp=1D&indTpCd=5&idxIndCd=447`).
  이는 이 사이트 데이터 API의 일반 구조이나, **ETF PDF 전용 `bld` 블록 ID는 로그인 게이트로
  인해 확보하지 못했다.**
- **메뉴 ID**: ETF PDF = `MDC0201030108`, ETN PDF = `MDC0201030408`
  (증권상품 > ETF/ETN > PDF(Portfolio Deposit File)).
- **로그인 게이트**: `GET /contents/MDC/MDI/mdiLoader/index.cmd?menuId=...` →
  (로그인 세션 없음) → 419바이트 alert+redirect 스텁, `Location`(JS)
  `/contents/MDC/COMS/client/MDCCOMS001.cmd?locale=ko_KR&redirectURL=<base64>`.
  이는 HTTP 302가 아니라 **본문에 삽입된 JS 리다이렉트**(HTTP 200)다.
- **다운로드 엔드포인트, OTP/token 흐름, 필수 헤더**: 미확인(로그인 후에만 로드되는
  메뉴 전용 JS 번들 안에 있을 것으로 추정되나 접근 불가).

## 4. 기존 공통 스키마 매핑

미확인 — 실제 응답 필드를 한 번도 보지 못했으므로 매핑 시도 자체가 무의미(§9 "없는 값을
추정해서 채우지 않는다" 원칙에 따라 생략).

## 5. 생성·수정 파일

생성:
- `spikes/krx-direct/README.md`(본 파일)
- `spikes/krx-direct/inspect_request.py`
- `spikes/krx-direct/requirements.txt`
- `spikes/krx-direct/config.example.json`
- `spikes/krx-direct/raw/2026-07-14/*`

기존 운영 파일 변경: **없음** (`server/holdings/**`, `src/**`, `schemas/etf-holdings.schema.json`,
기존 UI/CSS 전부 무변경 — git status 로 확인 가능).

## 6. 테스트

- 필수 검증: 익명 HTTP 요청 재현(§7) 완료, raw response 보존 완료, BLOCKED 상태 구분 완료.
- 표본 13종/동시성 1·3·5: §16 중단 기준 도달로 생략(§15 "불필요한 반복" 방지 원칙에 부합).
- 기존 운영 테스트(`npm test`): 이번 스파이크가 `server/**`, `src/**`, `tests/**` 를 건드리지
  않았으므로 재실행하지 않았다. 필요 시 사용자가 별도로 확인 가능.

## 7. 다음 단계(실패 경로)

- **실패 원인**: KRX Data Marketplace 웹 조회 자체가 로그인 필수로 정책 변경됨(추정). 익명
  자동 요청으로는 데이터 화면 진입조차 불가.
- **Playwright fallback 검토 여부**: 미검토. Playwright 를 쓰더라도 결국 실제 회원 로그인이
  필요하므로(§13 은 "브라우저 세션·동적 token" 문제를 전제하지, 로그인 자체 우회를 허용하지
  않음), 로그인 자격 없이는 Playwright 방식도 동일하게 막힌다.
- **권장 경로**: 백로그 BL-06 이 이미 식별한 **`openapi.krx.co.kr` (KRX Open API, 로그인 후
  AUTH_KEY 발급)** 이 유일하게 검증 가능한 공식 경로다. 이 사이트도 로그인은 필요하지만,
  AUTH_KEY 발급 후에는 **문서화된 REST 엔드포인트**를 정식으로 호출하는 방식이라
  "웹 화면 스크래핑 재현"이 아니라 "공식 API 사용"이 된다 — 이번 스파이크의 범위(웹 스크래핑
  재현) 밖이다.
- 사용자가 KRX Data Marketplace 계정을 보유하고 있고 로그인 상태의 Copy-as-cURL 을 직접
  제공할 수 있다면, 이 스파이크를 재개해 실제 다운로드 요청 구조를 분석할 수 있다. 단, 그
  경우에도 세션 쿠키는 커밋하지 않고 `.env`/`config.json`(gitignore)에만 보관한다.
