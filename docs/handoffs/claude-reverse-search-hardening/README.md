# Claude Code handoff — 역검색 고도화

이 폴더는 ETF Hub의 다음 작업을 Claude Code에 넘기기 위한 자기완결형 인계 번들이다.

## 한 줄 목표

완성된 taxonomy와 1,141종 ETF 분류 결과는 안정적인 정본으로 유지하면서, taxonomy에 아직 없는 의미도 ETF명·기초지수·투자목적 등의 근거로 찾을 수 있도록 역검색을 고도화한다.

## 읽는 순서

1. `CURRENT_STATE.md` — 현재 구현과 데이터 상태
2. `WORK_ORDER.md` — 작업 범위와 우선순위
3. `ACCEPTANCE_TESTS.md` — 완료 판정 기준
4. `CLAUDE_CODE_PROMPT.md` — Claude Code 첫 세션에 그대로 붙여 넣을 프롬프트

## 기준점

- 저장소: `C:\Users\tleod\projects\etf-hub-main-poc`
- 브랜치: `feat/etf-metadata-pipeline`
- handoff 작성 시 HEAD: `bf77449`
- taxonomy: 56개 태그, ETF 1,141종, 서비스 필터 미분류 0종
- 전체 회귀 테스트: 167개 통과

Claude Code는 먼저 `git status`, `git log -5 --oneline`, `npm run test:reverse-search`를 실행해 기준점이 유지되는지 확인한다. 외부 API 호출, 패키지 설치, taxonomy 변경은 사용자 승인 전 수행하지 않는다.

## 가장 중요한 재현 사례

질의:

> 대만 기업들에 투자하는 ETF 좀 찾아줘

현재 기대되지 않는 동작:

- `region.taiwan`이 taxonomy에 없어 질의 계획으로 표현할 수 없다.
- 규칙 사전에도 `대만`이 없다.
- `KODEX 대만테크고배당다우존스(487950)`는 `asset.equity`, `strategy.passive_index`, `dividend.monthly`만 가지고 있다.
- 따라서 현재는 해당 ETF를 의미에 따라 안정적으로 찾지 못하고 거래대금 기본 결과로 넘어갈 수 있다.

목표 동작:

- taxonomy에 국가 태그를 즉시 추가하지 않아도 ETF명과 기초지수의 `대만`/`Taiwan` 근거를 사용해 487950을 후보로 올린다.
- 결과에는 어떤 필드가 일치했는지 표시한다.
- taxonomy 기반 필터 결과와 보조 의미 검색 결과를 구분하고, 추측을 사실처럼 표시하지 않는다.

