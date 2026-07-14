# Claude Code 시작 프롬프트

아래 구분선 사이의 내용을 Claude Code에 그대로 입력한다.

---

ETF 허브 메인화면 PoC 개발을 시작한다.

현재 작업 디렉터리는 다음 프로젝트 폴더여야 한다.

`C:\Users\tleod\projects\etf-hub-main-poc`

이번 프로젝트는 기존에 검증한 멀티에이전트 템플릿과 `/multi-agent-start` Skill을 사용한다.

## 1. 먼저 확인할 파일

프로젝트 루트와 `docs/`에서 다음 파일을 읽고 상호 정합성을 확인하라.

- `PROJECT_BRIEF.md`
- `README_START_HERE.md`
- `docs/PRODUCT_VISION_AND_ROADMAP.md`
- `docs/POC_SCOPE_MATRIX.md`
- `docs/UX_SCREEN_SPEC.md`
- `docs/SAMPLE_DATA_SPEC.md`
- `docs/ACCEPTANCE_TEST_PLAN.md`
- `docs/MULTI_AGENT_PROJECT_RULES.md`
- `docs/SOURCE_CONTEXT.md`
- `docs/DECISION_LOG.md`
- `MULTI_AGENT_WORKFLOW.md`
- `.claude/skills/multi-agent-start/SKILL.md`
- `.mcp.json`

문서 간 충돌이 있다면 다음 우선순위를 적용하라.

1. `PROJECT_BRIEF.md`
2. `docs/POC_SCOPE_MATRIX.md`
3. `docs/UX_SCREEN_SPEC.md`
4. `docs/SAMPLE_DATA_SPEC.md`
5. `docs/ACCEPTANCE_TEST_PLAN.md`
6. `docs/MULTI_AGENT_PROJECT_RULES.md`
7. `MULTI_AGENT_WORKFLOW.md`

## 2. 환경 점검

다음 순서로 점검하라.

1. 현재 경로가 프로젝트 폴더인지 확인한다.
2. Git 저장소인지 확인한다.
3. Git 저장소가 아니면 `git init`을 수행한다.
4. 기존 파일과 예상하지 못한 코드가 있는지 확인한다.
5. `.mcp.json`을 확인한다.
6. Codex MCP 연결 가능 여부를 확인한다.
7. Playwright MCP 연결 가능 여부를 확인한다.
8. Node 및 npm 사용 가능 여부를 확인한다.
9. 외부 API, API Key, 로그인 또는 배포가 필요하지 않은지 확인한다.

예상하지 못한 기존 애플리케이션 코드가 있거나 파일 덮어쓰기가 필요하면 구현을 시작하지 말고 보고하라.

## 3. 프로젝트 해석 원칙

최종 목표는 당사 MTS의 ETF 전용 허브다.

그러나 이번 개발 대상은 최종 허브 전체가 아니라, `ETF 허브 메인화면의 정보 구조와 탐색 경험`을 검증하는 1차 축소 PoC다.

다음 후속 기능은 최종 비전에는 포함되지만 이번 구현에서는 제외한다.

- ETF 상세화면 전체
- 가격 차트
- 주요 변곡점
- 차트 이벤트 마커
- 상승·하락 기여도
- 이날 왜 움직였나요 상세 해석
- 실제 데이터 연동
- 개인화와 알림

이 기능들을 임의로 구현 범위에 추가하지 마라.

## 4. 멀티에이전트 역할

### Fable 5

- 총괄
- brief 해석
- 실행 계획
- 인터페이스 계약
- 파일 경계
- Claude와 Codex 작업 배정
- 테스트와 리뷰 판정
- 오탐 검증
- 실패 원인 분류
- 부분 재작업
- Playwright 검증
- 최종 완료 판정

### Claude Sonnet 5

- 구현
- 배정된 구현 파일만 수정
- 테스트 파일 수정 금지
- 계약에 따른 화면과 기능 구현
- 구현 결함으로 판정된 부분만 재작업

### Codex

- 독립 검증
- 계약 기준 테스트 작성
- 독립 코드 리뷰
- 구현 파일 수정 금지
- 테스트 결함으로 판정된 경우에만 테스트 파일 수정

## 5. 이번 단계에서 할 일

아직 애플리케이션 코드와 테스트 코드를 작성하지 마라.

`/multi-agent-start` 규칙에 따라 다음만 수행하라.

1. 모든 초기 문서 검토
2. 범위와 요구사항의 충돌 확인
3. 기술 구조 제안
4. 화면 구조 제안
5. 파일 소유권 경계 제안
6. Claude 구현 범위 정의
7. Codex 테스트·리뷰 범위 정의
8. 자동 테스트 목록 정의
9. Playwright 검증 목록 정의
10. 예상 생성 파일 목록 작성
11. 단계별 실행 계획 작성
12. 주요 리스크 및 대응 작성
13. 사용자의 실행 계획 승인 요청

실행 계획 승인 전에는 구현을 시작하지 마라.

## 6. 실행 계획에 반드시 포함할 내용

- 최종 서비스 목표와 이번 PoC 범위의 구분
- 순수 HTML/CSS/JavaScript 또는 다른 경량 구조를 선택한 이유
- 외부 API 없이 샘플 데이터를 구성하는 방식
- 히트맵의 모바일 구현 방식
- 첫 viewport 구성
- 핵심 인터랙션별 상태 및 데이터 변경
- 테스트 가능한 순수 로직 경계
- 접근성 기준
- 콘텐츠 금지 문구 검사
- 반응형 검증 방식
- Claude와 Codex의 파일 충돌 방지 방식
- 실패 원인 판정 및 부분 재작업 절차

## 7. 승인 이후 자동 진행

사용자가 실행 계획을 승인하면 S2~S9를 중간 승인 없이 진행하라.

자동 진행:

- `EXECUTION_PLAN.md` 확정
- `INTERFACE_CONTRACT.md` 작성
- Claude 구현 배정
- Codex 독립 테스트 배정
- 구현과 테스트 병렬 수행
- 테스트 실행
- Codex 독립 리뷰
- 리뷰 오탐 판정
- 실패 원인 분류
- 부분 재작업
- 테스트 재실행
- Playwright 모바일 화면 검증
- 콘솔 오류 확인
- `MULTI_AGENT_RUN_LOG.md` 작성
- 최종 결과 보고

## 8. 중단 조건

다음 상황에서만 자동 진행을 중단하고 사용자에게 보고하라.

- 추가 비용 또는 종량 과금 가능성
- API Key 필요
- 외부 계정 로그인·인증 필요
- 개인정보, 비밀번호, 결제정보 또는 사내 기밀 필요
- 외부 API 또는 외부 서비스 연결 필요
- 배포, 게시, PR 생성 등 외부 공개 필요
- 파일 삭제, Git 이력 변경 또는 대규모 덮어쓰기 필요
- 요구사항 모순으로 계약 확정 불가
- 동일 오류 재작업 3회 실패
- Codex MCP 연결 실패가 재시도 후에도 지속
- 필요한 모델 사용 불가
- 기존 프로젝트 파일 충돌

## 9. 지금 출력할 형식

환경 점검 결과를 먼저 간단히 보고한 뒤 다음 순서로 실행 계획을 제시하라.

1. 프로젝트 해석
2. 최종 목표와 1차 PoC의 관계
3. 제안 기술 구조
4. 제안 화면 구조
5. 데이터 구조
6. 파일 소유권
7. Claude 구현 범위
8. Codex 테스트·리뷰 범위
9. 자동 테스트
10. Playwright 검증
11. 예상 생성 파일
12. 단계별 실행 순서
13. 리스크와 대응
14. 사용자 승인 요청

---
