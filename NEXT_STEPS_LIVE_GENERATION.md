# NEXT_STEPS — 태그 브리핑 라이브 생성 (Scenario B, 전부 보류)

작성일: 2026-07-16 / 관련 파이프라인: `scripts/build-tag-briefs.js`, `src/js/tag-brief/**`

> 이 문서는 **Scenario A(화면 통합)** 을 끝낸 뒤 남은 **Scenario B(라이브 AI 생성·API 키·실뉴스)** 를
> 사용자가 놓치지 않도록 기록한 것이다. **이 항목들은 모두 아직 구현하지 않았고, 각각 사용자 결정이 필요하다.**
> Scenario A 세션에서는 라이브 생성/키/실뉴스에 **손대지 않았다.**

---

## 현재 상태 (Scenario A 완료 시점)

- 브리핑 본문은 **손으로 작성한 `manual-sample`** 콘텐츠다. `scripts/build-tag-briefs.js` 안의
  `MANUAL_CONTENT_BY_TAG` 상수가 그 텍스트를 담고 있고, 빌드 스크립트는 이를 `contentProvider` 로 주입한다.
- **라이브 LLM 호출은 파이프라인 어디에도 없다.** 모든 브리핑은 `"generator": "manual-sample"` 로 정직하게 스탬프된다
  (`policyGate.js` 가 이 정직성 라벨과 금칙어를 기계적으로 재검증한다).
- **"브리핑 재생성"은 AI가 새 글을 쓰는 것이 아니다** — 빌드 스크립트를 다시 돌려 (수기 콘텐츠) + (태그 유니버스)
  + (뉴스 픽스처) 를 재조립하는 것뿐이다.
- 뉴스 소스도 실시간이 아니다. `data/fixtures/news-articles.json` 의 **21건은 수기 샘플 기사**다.
- 태그 유니버스는 **taxonomy v2.0.0** 필터맵(`data/tagging/etf-filter-map.json`)에서 온다.
  현재 6개 태그가 발행된다: `sector.semiconductor`, `sector.aerospace_defense`, `sector.ev_battery`,
  `sector.shipbuilding`, `strategy.benchmark.sp500`, `asset.bond`.

## 라이브 생성으로 전환하려면 (전부 보류 — 각 항목 사용자 결정 필요)

### 1. contentProvider 를 실제 모델 호출로 교체  · **[decision needed from user]**
- 현재 `scripts/build-tag-briefs.js` 의 `contentProvider: () => manualContent` (즉 `MANUAL_CONTENT_BY_TAG`) 를
  실제 모델 호출로 교체한다.
- provider 는 반드시 `{ title, summary, keyPoints, mentionedStockIds, mentionedTopicIds }` 형태를 반환해야 하고,
  `src/js/tag-brief/generate.js` 의 **`SYSTEM_PROMPT_RULES`** 를 시스템 프롬프트로 사용해야 한다
  (근거 기사에 없는 숫자/사실/종목/지수 금지, 유인·행동유도 표현 금지, summary 30자 이내 등).
- 반환값은 그대로 `policyGate.validateBrief()` 를 통과해야 하며, 실패 시 재시도(최대 2회) 후 미발행 처리된다.
  **모델을 붙여도 이 정직성 게이트는 유지할 것.**
- `generator` 값을 실제 모델명(예: `claude-...`)으로 바꾸되, **절대 가짜 모델명으로 위장하지 말 것.**

### 2. 정적 빌드타임 픽스처 vs 라이브 요청시 생성  · **[decision needed from user]**
- **현행 모델**: 빌드 시 한 번 생성해 `data/fixtures/tag-briefs.json` 에 굽는 정적 방식.
- **대안**: 요청마다 라이브 생성. 이 경우 호출은 `server/` 계층의 capability 로 이동할 가능성이 크다
  (프런트는 픽스처 대신 `/api/...` 를 소비).
- 트레이드오프(비용·지연·캐시·정직성 재검증 위치)를 사용자와 정하고 시작할 것.

### 3. API 키 / 자격증명  · **[decision needed from user]**
- 어떤 provider 를 쓸지(Anthropic API?) 결정.
- 저장소의 **기존 시크릿 패턴**을 따를 것: `.env.example` 에 값 없는 문서화된 변수만 추가하고,
  `server/config.js` 처럼 로드한다. `.env` 는 git-ignore 되어 있으며 사용자가 채운다.
- **실제 키를 커밋하지 말 것.** 저장소에 굴러다니는 키를 사용자 확인 없이 재사용하지 말 것.

### 4. mock / live / hybrid 폴백 유지 (권장)  · **[decision needed from user]**
- `server/config.js` 의 `ETF_DATA_MODE` 를 그대로 본떠, 자격증명이 **0개**여도 앱이 동작하도록
  mock/live/hybrid 폴백을 둘 것. 키가 없으면 `manual-sample` 로 정직하게 폴백(현행 동작).

### 5. 실시간 뉴스 수집 (별도·더 큰 범위)  · **[decision needed from user]**
- 파이프라인이 만들어진 범위에서 **명시적으로 제외**된 별개 작업이다.
- 필요한 것: 뉴스 provider + 스케줄/트리거 기반 `assign.js` + `build-tag-briefs.js` 재실행.
- 현재 `data/fixtures/news-articles.json` 의 21건은 **수기 샘플**이며 실뉴스가 아니다.
- 토픽 어휘(`data/fixtures/topic-registry.json`)는 통제 어휘(현재 4개: `topic.us_index`, `topic.rates`,
  `topic.credit`, `topic.fx`)이므로, 실뉴스 도입 시 어휘 확장 정책도 함께 정해야 한다.

---

## 손대지 말 것 (Scenario B 착수 전까지)

- 브리핑의 `generator` 값을 정직하지 않은 값으로 바꾸지 말 것.
- 라이브 호출 없이 "AI 생성"인 것처럼 라벨하지 말 것.
- 콘텐츠 정책은 그대로 적용된다: 유인·행동유도 표현 금지, mint `#00C7A9` 는 UI 액센트 전용,
  등락은 상승=빨강 `+` / 하락=파랑 `-`.
