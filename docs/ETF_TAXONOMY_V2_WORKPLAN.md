# ETF 택소노미 v2 — 실행 계획 & 충돌 방지 (별도 세션 핸드오프)

작성일: 2026-07-16 / 짝 문서: [`ETF_TAXONOMY_V2_FACET_DESIGN.md`](./ETF_TAXONOMY_V2_FACET_DESIGN.md)

> **완료 상태(2026-07-20 현행화)**: v2 컷오버와 1,141종 전체 규칙 태깅, Explore facet 연결까지 완료됐다.
> 정본은 `config/etf-tagging/etf-taxonomy.json` v2.0.0과 `data/tagging/etf-filter-map.json`이며,
> 아래 내용은 당시의 병행 개발·충돌 방지 계획을 기록으로 보존한다. 상세 실행 이력은
> `MULTI_AGENT_RUN_LOG.md` S18 및 후속 항목을 참조한다.

> **목적**: v2 facet 재설계를 **다른 세션(또는 다른 담당)** 이 이어받아도 현재 진행 중인 작업과
> 충돌하지 않도록, 파일 소유·버전 전략·실행 순서·금지 영역을 못 박는다.
> 이 문서를 먼저 읽고 시작할 것. 설계 세부는 짝 문서 참조.

---

## 정책 결정 상태

**설계안 §7 미결 6건 전부 확정(2026-07-16).** 요지: 채권/지역 세분화=권고안대로, benchmark=strategy 하위,
REVIEW 섹터(철강·건설·로봇·운송)=함께 승격, **버전=새 파일 병행**, UI연결=별도 승인. 세부는 설계안 §7 표 참조.
→ 이 워크플랜대로 바로 실행 가능(컷오버·UI연결만 각각 재승인).

## 0. 착수 당시 상태 스냅샷 (2026-07-16 기준, 현재 상태 아님)

- 브랜치: `feat/etf-metadata-pipeline`. 마지막 커밋 `ef23d52` (태깅 커버리지 105→243 확장).
- **워킹트리 clean** (playwright/PNG 만 gitignore).
- taxonomy: `config/etf-tagging/etf-taxonomy.json` = **v1.0.0**(3 대분류·25 태그) — **아직 아무것도 안 바꿈**.
- 산출물: `data/tagging/etf-filter-map.json`(243종·22필터), `etf-tag-scores.json`(470종), 배치 1~18 완료.
- 커버리지 대상: 메타데이터 470종 / 유니버스 1,141종.
- UI: `src/js/explore.js` 는 **filter-map 을 아직 안 씀**(이름-키워드 `chipMatches` 사용). → v2 작업이 UI를 깨지 않는다.

## 1. 버전 전략 — **v2는 새 파일로 병행 개발** (핵심 충돌 방지)

기존 `etf-taxonomy.json`(v1) 을 **in-place 로 덮지 말 것.** 대신:
- 신규: `config/etf-tagging/etf-taxonomy-v2.json` (v2.0.0)
- 신규: `data/tagging/v2/` 하위에 v2 산출물 격리(`etf-tag-scores.json`, `etf-filter-map.json`, 배치 등)
- 이유: v1 filter-map/tag-scores 는 이미 커밋됐고 후속 UI 연결의 폴백 근거가 된다. v2가 검증·승인될 때까지
  v1 을 살려두면, 병렬 세션/롤백이 안전하다. **컷오버(파일 교체)는 마지막 단계에서 사용자 승인 후 1커밋으로.**

## 2. 파일 소유권 (disjoint) — v2 세션이 **만지는 것 / 절대 안 만지는 것**

### ✅ v2 세션 소유 (자유롭게 생성·수정)
- `config/etf-tagging/etf-taxonomy-v2.json` (신규)
- `config/etf-tagging/etf-tagging-rules-v2.json` (신규, assetClass/region 규칙)
- `data/tagging/v2/**` (신규 산출물 전부)
- `docs/ETF_TAXONOMY_V2_*.md` (이 문서·설계안 갱신)
- `scripts/tagging/` 내 **v2 전용 신규 스크립트만 추가**(예: `build-facet-rules.mjs`). 기존 스크립트는 §3 규칙대로.
- `MULTI_AGENT_RUN_LOG.md` 에 **append 만**(S18 항목 추가, 기존 줄 수정 금지).

### 🚫 절대 만지지 말 것 (충돌·회귀 위험)
- `config/etf-tagging/etf-taxonomy.json` (v1) — 컷오버 단계 전까지 불변.
- `data/tagging/*.json` 루트의 v1 산출물(`etf-filter-map.json` 등) — v2는 `data/tagging/v2/` 로 분리.
- `src/**`, `index.html`, `etf-explore.html` — UI. (UI 연결은 별도 승인 단계, §6)
- `server/**`, `tests/**`, `INTERFACE_CONTRACT.md`, 메인허브 계약/콘텐츠 정책 관련 전부.
- `package.json` 의 기존 스크립트/테스트 목록 — 신규 script 추가는 append 만.

### ⚠️ 조율 필요(공유 파일 — 수정 시 append/추가만, 재작성 금지)
- 기존 `scripts/tagging/merge-scores.mjs`, `build-filter-map.mjs`: v2 스키마를 읽어야 하면 **`--taxonomy=`/`--out-dir=` 인자를 추가**해 v1 경로를 기본값으로 유지(기존 동작 불변)하고 v2는 인자로 분기. 하드코딩 경로 치환 금지.
- 서브에이전트 `.claude/agents/etf-scoring-worker.md` 등: taxonomy 경로를 프롬프트에서 **인자로 주입**(에이전트 정의 파일 자체 수정 최소화). 정의를 바꿔야 하면 v1 동작을 해치지 않는 범위에서.

## 3. 기존 스크립트 재사용 규칙

- 파이프라인(prepare→rules→batches→worker→validate→merge→filter-map→auditor→report)은 그대로 재사용.
- **경로 파라미터화**로 v1/v2 분리: 스크립트에 taxonomy/출력경로 인자가 없으면 **인자 추가(하위호환)** 후 사용.
- rule classifier(`run-rule-classifier.mjs`)는 assetClass/region 규칙이 v1엔 없으므로, v2 규칙파일을 읽는 분기만 추가.
- 배치 입력(`etf-tagging-input.jsonl`)은 **재생성 불필요** — 동일 470종 입력을 v2 태그로 다시 스코어링만 하면 됨.
  (assetClass/region 은 rule 우선이라 서브에이전트 재호출을 신규 sector/strategy 태그가 걸린 배치로 한정 가능.)

## 4. 실행 순서 (승인 후)

1. **taxonomy-v2 초안 작성** — 설계안 §3~5 대로 `etf-taxonomy-v2.json` 작성(v1 25태그 매핑 + 신규 facet).
2. **rule 규칙 확장** — assetClass/region 이름·기초지수 규칙 → `etf-tagging-rules-v2.json`. `tagging:rules` v2 실행.
3. **배치 재스코어링** — 신규 sector/strategy 태그가 필요한 배치만 `etf-scoring-worker` 재호출(assetClass/region은 rule로 충분). 출력 → `data/tagging/v2/batches/`.
4. **merge + filter-map (v2)** — `--taxonomy=...v2.json --out-dir=data/tagging/v2` 로 재생성.
5. **auditor 재감사** — 남은 candidateTags 재검토(원전·조선 등 이미 승격분 반영).
6. **리포트·검증** — 커버리지(미분류 감소 확인), facet별 종수, 위조 0, v1 산출물 불변 확인.
7. **컷오버(사용자 승인)** — v2 검증 통과 시 v2를 정본으로 승격(파일 교체) + 1커밋.
8. **(분리 승인) UI 연결** — `explore.js` 카테고리를 facet 기반 filter-map으로 전환(§6).

## 5. 검증 체크리스트 (v2 세션 완료 조건)

- [x] 병행 개발 단계에서 v1 산출물 변경 0을 확인.
- [x] v2 filter-map에서 채권/해외 종목의 assetClass/region 분류를 표본 검증.
- [x] 미분류 227→0종을 기록.
- [x] assetClass/region primary cardinality 위반 0을 확인.
- [x] 근거 없는 태그 0, 모든 신규 태그 evidence 보유를 확인.
- [x] 전체 회귀 테스트 유지.
- [x] RUN_LOG S18 및 컷오버·유니버스 확장 이력 기록.

## 6. UI 연결은 별도 승인 단계

`explore.js` 는 현재 이름-키워드 `chipMatches` 로 카테고리를 나눈다. v2 컷오버 후:
- 어댑터 경계(`getEtfHoldings`/`getEtfMeta` 처럼) 유지 — UI는 facet filter-map만 읽고 CSV/경로 모름.
- 카테고리 칩을 facet(자산군→지역→섹터→전략) 드릴다운으로 재구성.
- **이 단계는 taxonomy 작업과 파일영역이 겹치므로(같은 explore.js) 같은 세션에서 순차 진행하거나 명시적 락**.

## 7. 병렬 세션 조율 요약(한 줄)

> v2 세션 = `*-v2.*` 파일 + `data/tagging/v2/**` 만 생성/수정. v1 파일·`src/**`·`server/**`·`tests/**` 불변.
> 공유 스크립트는 인자 추가(하위호환)만. 컷오버·UI연결은 각각 별도 사용자 승인.
