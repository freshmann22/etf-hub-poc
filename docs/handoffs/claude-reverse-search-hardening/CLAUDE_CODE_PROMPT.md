# Claude Code 시작 프롬프트

아래 내용을 Claude Code 새 세션에 그대로 전달한다.

```text
이 저장소의 ETF 자연어 역검색을 고도화해줘. 먼저 다음 handoff 문서를 순서대로 전부 읽어라.

1. docs/handoffs/claude-reverse-search-hardening/README.md
2. docs/handoffs/claude-reverse-search-hardening/CURRENT_STATE.md
3. docs/handoffs/claude-reverse-search-hardening/WORK_ORDER.md
4. docs/handoffs/claude-reverse-search-hardening/ACCEPTANCE_TESTS.md

AGENTS.md 또는 CLAUDE.md가 있으면 함께 읽고 적용하라.

핵심 목표는 완성된 taxonomy와 1,141종 분류를 재작업하는 것이 아니다. taxonomy에 없는 의미도 ETF 공식명, 기초지수, 투자목적·설명 등 검증 가능한 canonical 근거를 사용해 찾을 수 있도록 역검색에 보조 의미 검색 계층을 추가하는 것이다.

대표 실패 사례는 `대만 기업들에 투자하는 ETF 좀 찾아줘`다. 현재 `region.taiwan`이 없고 487950은 region 태그가 없어 `KODEX 대만테크고배당다우존스`가 안정적으로 검색되지 않는다. taxonomy를 즉시 확장하는 대신 이름의 `대만`과 benchmark의 `Taiwan`을 근거로 후보를 찾고, 그 근거를 사용자에게 표시하는 방식을 우선 설계하라.

작업 순서:

1. git status와 최근 커밋을 확인하고 무관한 사용자 파일을 식별한다.
2. 현재 query plan, validation, adapters, ranker, UI, server planner 흐름을 읽는다.
3. npm run test:reverse-search와 npm test로 기준선을 확인한다.
4. 아직 파일을 수정하지 말고 실패 원인, 제안 계약, 예상 수정 파일, 테스트 계획을 먼저 간단히 보고한다.
5. 그 뒤 Phase 1~3을 작은 단위로 구현하고 매 단계 테스트한다.
6. 정확성 기준이 통과한 뒤에만 Phase 4 속도 벤치마크를 준비한다.

제약:

- config/etf-tagging/etf-taxonomy.json과 canonical tagging 결과는 기본적으로 수정하지 않는다.
- LLM이 ETF를 직접 선택하거나 존재하지 않는 ETF/tag를 발명하게 하지 않는다.
- 알 수 없는 tag ID 거부 규칙을 약화하지 않는다.
- 외부 API 호출, 유료 모델 실행, dependency 설치, .env 변경은 내 명시적 승인 전 금지한다.
- 기본 테스트는 네트워크 호출 0건이어야 한다.
- API 키, Authorization header, 전체 환경변수를 출력하지 않는다.
- 기존 미추적 파일을 삭제·포맷·커밋하지 않는다.
- 실제 구현 결과는 테스트와 브라우저 확인까지 수행하되, 외부 호출이 필요한 검증은 fixture로 대체한다.

우선 완료 조건:

- 대만 질의에서 487950이 공식명/기초지수 근거로 검색된다.
- `대만 월배당 ETF`에서 텍스트 조건과 dividend.monthly가 함께 적용된다.
- 미국/반도체 등 기존 taxonomy 질의가 회귀하지 않는다.
- 완전히 미지원인 질의는 무관한 거래대금 결과를 정상 검색처럼 보여주지 않는다.
- 결과마다 태그 근거와 텍스트 근거를 구분해 설명한다.
- npm run test:reverse-search와 npm test가 통과한다.

먼저 조사 결과와 구현 계획까지만 보고하고, 계획이 handoff 범위와 일치하면 안전한 로컬 구현을 계속 진행하라. 실제 외부 모델 호출은 멈추고 승인을 요청하라.
```

