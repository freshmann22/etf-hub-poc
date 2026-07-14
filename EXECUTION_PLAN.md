# EXECUTION_PLAN — ETF 허브 메인화면 PoC

승인일: 2026-07-10 (사용자 승인 완료)

## 1. 목표

ETF 허브 메인화면의 정보 구조·시각적 방향·핵심 탐색 인터랙션을 검증하는 1차 축소 PoC.
최종 허브 전체가 아니며, 상세화면·차트·변곡점·기여도·실데이터·개인화·알림은 제외한다.

## 2. 기술 구조

- 순수 HTML/CSS/JavaScript(ES 모듈), 외부 패키지 0개, 빌드 없음
- 테스트 러너: Node 내장 `node --test`
- 로컬 서빙: `scripts/dev-server.js` (Node 내장 http, Fable 소유)
- `package.json`은 `{"type":"module"}` 지정 전용
- 화면 검증: Playwright MCP (Fable 직접 수행)

## 3. 파일 소유권 (서로소)

| 소유자 | 파일 |
|---|---|
| Claude Sonnet (구현) | `index.html`, `src/styles/main.css`, `src/js/data.js`, `src/js/logic.js`, `src/js/render.js`, `src/js/app.js` |
| Codex (검증) | `tests/logic.test.mjs`, `tests/data-integrity.test.mjs`, `tests/content-policy.test.mjs` |
| Fable (총괄) | `EXECUTION_PLAN.md`, `INTERFACE_CONTRACT.md`, `MULTI_AGENT_RUN_LOG.md`, `package.json`, `scripts/dev-server.js` |

## 4. 단계

| 단계 | 내용 | 담당 | 완료 조건 |
|---|---|---|---|
| S2 | 인터페이스 계약 작성 | Fable | 최소 기능 1:1 대응, 파일 경계 서로소 |
| S3 ‖ S4 | 구현 ‖ 테스트 작성 (병렬) | Claude ‖ Codex | 배정 파일 존재, 경계·시그니처 준수 |
| S5 | 독립 리뷰 (read-only) | Codex | 3분류 보고, Fable 오탐 판정 |
| S6 | 테스트 실행 `node --test tests/` | Fable | 전체 통과 시 S9 |
| S7 | 실패 원인 판정 (구현/테스트/계약) | Fable | 실패 건별 귀속 |
| S8 | 원 담당자 부분 재작업 | 판정 결과 | 지정 범위 내 수정, S6 재실행 |
| S9 | Playwright 화면 검증 (시나리오 A~I) | Fable | 최소 기능 전부 통과, 콘솔 오류 없음 |
| S10 | 최종 보고 → 사용자 최종 승인 대기 | Fable | 사용자 승인 |

## 5. 검증 명령

- 자동 테스트: `node --test tests/`
- 로컬 서버: `node scripts/dev-server.js` → `http://localhost:4173`
- 화면 검증: Playwright MCP, viewport 390×844 (보조 360×800, 430×932)

## 6. 중단 조건

PROJECT_BRIEF §20 및 MULTI_AGENT_WORKFLOW §4를 따른다
(추가 비용, 인증, 외부 연결, 외부 공개, 파괴적 변경, 계약 확정 불가,
동일 오류 3회 실패, Codex MCP 지속 실패, 모델 사용 불가).
