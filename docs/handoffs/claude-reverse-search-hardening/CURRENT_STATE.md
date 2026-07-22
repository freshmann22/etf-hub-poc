# 현재 상태

## 완료된 기반 작업

- canonical ETF universe: 1,141종
- taxonomy 어휘: 56개 태그
- 서비스 필터 통과 태그가 하나 이상 있는 ETF: 1,141종
- 미분류 ETF: 0종
- DART 문서 계보 감사: 911건 중 정상 865건, 오배정 46건 자동 격리
- taxonomy 전수 자동감사: 86종목, 93개 변경
- 낮은 근거로 필터에서 제외된 태그 후보: 94건
- 명시적 자동 격리 태그: 5건
- readiness: A 91 / B 456 / C 340 / D 254

보고서:

- `reports/tagging/ETF_TAXONOMY_FULL_AUTO_AUDIT_REPORT.md`
- `reports/tagging/ETF_TAXONOMY_FULL_AUTO_AUDIT_REPORT.html`
- `data/reports/etf-taxonomy-full-auto-audit-v2.json`
- `data/reports/etf-taxonomy-data-readiness-v2.json`

## 역검색 처리 흐름

1. 브라우저가 `/api/reverse-search/plan`에 자연어 질의를 전송한다.
2. OpenRouter가 사용 가능하면 LLM이 query plan을 생성한다.
3. LLM 출력은 등록된 taxonomy ID만 남도록 검증한다.
4. LLM 실패 또는 빈 plan이면 규칙 사전이 동일한 계약의 plan을 만든다.
5. ranker가 `data/tagging/etf-filter-map.json`의 태그만으로 후보를 필터링하고 점수를 계산한다.
6. 이해하지 못한 질의는 거래대금 상위 목록으로 fallback한다.

핵심 파일:

- `modules/reverse-search/src/dictionary.js`
- `modules/reverse-search/src/nlu.js`
- `modules/reverse-search/src/query-plan.js`
- `modules/reverse-search/src/ranker.js`
- `modules/reverse-search/src/adapters.js`
- `modules/reverse-search/src/app.js`
- `server/services/reverse-search-query-planner.js`
- `server/llm/openrouter-query-planner.js`
- `config/etf-tagging/etf-taxonomy.json`
- `data/tagging/etf-filter-map.json`
- `data/normalized/etf-metadata-v2.json`

## 구조적 한계

현재 query plan은 `tags`와 `sort`만 표현한다. 따라서 taxonomy에 없는 국가·산업·상품 특성은 LLM이 이해하더라도 유효한 검색 조건으로 전달할 수 없다.

ETF명이나 기초지수에 정확한 단어가 있어도 ranker는 이를 검색 근거로 사용하지 않는다. 예를 들어 487950의 공식명은 `KODEX 대만테크고배당다우존스`, 기초지수는 `Dow Jones Taiwan Technology Dividend 30 Index(TWD)(PR)`이지만 대만 질의로 찾지 못한다.

## 보존해야 할 원칙

- taxonomy 태그는 정본이며 알 수 없는 태그를 임의 생성하지 않는다.
- ETF를 LLM이 직접 추천하거나 코드로 발명하지 않는다.
- canonical 데이터와 filter map은 읽기 전용 입력으로 취급한다.
- 검색 결과마다 근거 필드와 fallback 여부를 표시한다.
- 태그 기반 확정 일치와 텍스트 기반 보조 일치를 같은 신뢰도로 표현하지 않는다.
- API 키와 인증 헤더를 브라우저·로그·리포트에 노출하지 않는다.

## 작업 트리 주의

handoff 작성 시 다른 미추적 산출물이 존재했다. Claude Code는 자기 작업과 무관한 파일을 삭제·포맷·커밋하지 않는다. 항상 `git status --short`로 범위를 확인하고 경로를 명시해 stage한다.

