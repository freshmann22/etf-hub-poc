# ETF 허브 메인화면 PoC — 시작 안내

이 폴더는 `ETF 허브 메인화면 PoC`를 기존 멀티에이전트 템플릿으로 개발하기 위한 프로젝트 전용 초기 자료다.

## 1. 이 스타터팩에 포함된 자료

### 프로젝트 루트

- `PROJECT_BRIEF.md`  
  최종 ETF 허브의 목표와 이번 1차 PoC의 축소 범위를 함께 정의한 최상위 기준 문서다.

- `CLAUDE_BOOTSTRAP_PROMPT.md`  
  프로젝트 폴더와 멀티에이전트 환경을 점검하고 `/multi-agent-start` 실행 계획을 만들도록 Claude Code에 입력하는 시작 프롬프트다.

- `.gitignore`  
  Node, 테스트, Playwright 및 로컬 산출물을 Git에서 제외하기 위한 기본 설정이다.

### `docs/`

- `PRODUCT_VISION_AND_ROADMAP.md`  
  최종 서비스 목표와 단계별 확장 방향을 정의한다.

- `POC_SCOPE_MATRIX.md`  
  원래 기획한 콘텐츠 중 이번 PoC에서 구현할 항목과 후속으로 미룰 항목을 구분한다.

- `UX_SCREEN_SPEC.md`  
  메인화면의 정보 구조, 섹션별 요구사항, 핵심 인터랙션과 문구 원칙을 정의한다.

- `SAMPLE_DATA_SPEC.md`  
  PoC용 가상 데이터의 최소 개수, 필드, 관계 및 정합성 규칙을 정의한다.

- `ACCEPTANCE_TEST_PLAN.md`  
  자동 테스트와 Playwright 화면 검증 기준을 정의한다.

- `MULTI_AGENT_PROJECT_RULES.md`  
  Fable, Claude, Codex의 역할, 파일 소유권, 재작업 및 중단 조건을 정의한다.

- `SOURCE_CONTEXT.md`  
  기존 문제정의서와 콘텐츠 기획에서 이어받아야 할 배경을 정리한다.

- `DECISION_LOG.md`  
  현재 확정된 결정과 아직 미확정인 항목을 구분한다.

## 2. 권장 프로젝트 경로

```text
C:\Users\tleod\projects\etf-hub-main-poc
```

## 3. 초기 배치 순서

1. 위 경로에 신규 프로젝트 폴더를 만든다.
2. 이 스타터팩의 내용을 프로젝트 폴더 루트에 복사한다.
3. 범용 템플릿 경로에서 다음 항목을 프로젝트 폴더로 복사한다.

```text
C:\Users\tleod\projects\multi-agent-template
├─ MULTI_AGENT_WORKFLOW.md
├─ .mcp.json
├─ .claude\skills\multi-agent-start\SKILL.md
└─ README.md
```

4. 같은 이름의 파일이 있을 경우 다음 원칙을 적용한다.

- 스타터팩의 `PROJECT_BRIEF.md`는 유지한다.
- 범용 템플릿의 `MULTI_AGENT_WORKFLOW.md`, `.mcp.json`, `.claude/`는 복사한다.
- 범용 템플릿의 `README.md`는 `TEMPLATE_README.md`로 이름을 바꿔 보관해도 된다.
- 기존 파일이 있는 프로젝트 폴더라면 자동 덮어쓰지 않는다.

5. 프로젝트 폴더에서 Claude Code를 실행한다.
6. `CLAUDE_BOOTSTRAP_PROMPT.md`의 내용을 Claude Code에 입력한다.
7. Fable이 제시한 실행 계획을 검토한다.
8. 계획을 승인한 뒤 S2~S9 자동 구간을 실행한다.

## 4. 실행 전 예상 폴더 구조

```text
etf-hub-main-poc/
├─ .claude/
│  └─ skills/
│     └─ multi-agent-start/
│        └─ SKILL.md
├─ docs/
│  ├─ PRODUCT_VISION_AND_ROADMAP.md
│  ├─ POC_SCOPE_MATRIX.md
│  ├─ UX_SCREEN_SPEC.md
│  ├─ SAMPLE_DATA_SPEC.md
│  ├─ ACCEPTANCE_TEST_PLAN.md
│  ├─ MULTI_AGENT_PROJECT_RULES.md
│  ├─ SOURCE_CONTEXT.md
│  └─ DECISION_LOG.md
├─ .gitignore
├─ .mcp.json
├─ PROJECT_BRIEF.md
├─ CLAUDE_BOOTSTRAP_PROMPT.md
├─ MULTI_AGENT_WORKFLOW.md
├─ README_START_HERE.md
└─ TEMPLATE_README.md
```

`EXECUTION_PLAN.md`, `INTERFACE_CONTRACT.md`, 애플리케이션 코드, 테스트 코드는 실행 계획 승인 이후 멀티에이전트가 생성한다.

## 5. 문서 우선순위

문서 간 내용이 충돌하면 다음 순서로 판단한다.

1. `PROJECT_BRIEF.md`
2. `docs/POC_SCOPE_MATRIX.md`
3. `docs/UX_SCREEN_SPEC.md`
4. `docs/SAMPLE_DATA_SPEC.md`
5. `docs/ACCEPTANCE_TEST_PLAN.md`
6. `docs/MULTI_AGENT_PROJECT_RULES.md`
7. 범용 `MULTI_AGENT_WORKFLOW.md`

최종 서비스 비전과 이번 PoC 범위를 혼동하지 않는다. 이번 개발 대상은 최종 ETF 허브 전체가 아니라, 그중 `메인화면의 정보 구조와 탐색 경험`을 검증하는 축소 PoC다.
