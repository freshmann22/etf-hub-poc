# NEXT_STEPS — 태그 브리핑 라이브 생성 (Scenario B, 생성 경로 구현·실뉴스 보류)

작성일: 2026-07-16 / 관련 파이프라인: `scripts/build-tag-briefs.js`, `src/js/tag-brief/**`

> **2026-07-20 업데이트**: OpenRouter 기반 생성 경로와 manual/live/hybrid 모드, 정책 게이트,
> 정직한 폴백은 구현됐다. 기본값은 비용이 없는 `manual`이다. 실시간 뉴스 수집은 여전히 별도 과제로 남는다.

---

## 현재 상태 (Scenario A 완료 시점)

- 브리핑 본문은 **손으로 작성한 `manual-sample`** 콘텐츠다. `scripts/build-tag-briefs.js` 안의
  `MANUAL_CONTENT_BY_TAG` 상수가 그 텍스트를 담고 있고, 빌드 스크립트는 이를 `contentProvider` 로 주입한다.
- `TAG_BRIEF_MODE=manual`이 기본이라 현재 커밋된 브리핑은 `"generator": "manual-sample"` 로 정직하게 스탬프된다.
  `hybrid` 또는 `live`를 선택하면 서버의 OpenRouter 클라이언트가 동일한 정책 게이트를 거쳐 콘텐츠를 생성한다.
- **"브리핑 재생성"은 AI가 새 글을 쓰는 것이 아니다** — 빌드 스크립트를 다시 돌려 (수기 콘텐츠) + (태그 유니버스)
  + (뉴스 픽스처) 를 재조립하는 것뿐이다.
- 뉴스 소스도 실시간이 아니다. `data/fixtures/news-articles.json` 의 **21건은 수기 샘플 기사**다.
- 태그 유니버스는 **taxonomy v2.0.0** 필터맵(`data/tagging/etf-filter-map.json`)에서 온다.
  현재 6개 태그가 발행된다: `sector.semiconductor`, `sector.aerospace_defense`, `sector.ev_battery`,
  `sector.shipbuilding`, `strategy.benchmark.sp500`, `asset.bond`.

## 라이브 생성 전환 상태

### 1. contentProvider 실제 모델 호출 · **구현 완료**
- 현재 `scripts/build-tag-briefs.js` 의 `contentProvider: () => manualContent` (즉 `MANUAL_CONTENT_BY_TAG`) 를
  실제 모델 호출로 교체한다.
- provider 는 반드시 `{ title, summary, keyPoints, mentionedStockIds, mentionedTopicIds }` 형태를 반환해야 하고,
  `src/js/tag-brief/generate.js` 의 **`SYSTEM_PROMPT_RULES`** 를 시스템 프롬프트로 사용해야 한다
  (근거 기사에 없는 숫자/사실/종목/지수 금지, 유인·행동유도 표현 금지, summary 30자 이내 등).
- 반환값은 그대로 `policyGate.validateBrief()` 를 통과해야 하며, 실패 시 재시도(최대 2회) 후 미발행 처리된다.
  **모델을 붙여도 이 정직성 게이트는 유지할 것.**
- `generator` 값을 실제 모델명(예: `claude-...`)으로 바꾸되, **절대 가짜 모델명으로 위장하지 말 것.**

### 2. 생성 시점 · **빌드타임 방식 유지**
- **현행 모델**: 빌드 시 한 번 생성해 `data/fixtures/tag-briefs.json` 에 굽는 정적 방식.
- **대안**: 요청마다 라이브 생성. 이 경우 호출은 `server/` 계층의 capability 로 이동할 가능성이 크다
  (프런트는 픽스처 대신 `/api/...` 를 소비).
- 트레이드오프(비용·지연·캐시·정직성 재검증 위치)를 사용자와 정하고 시작할 것.

### 3. API 키 / 자격증명 · **구현 완료**
- 어떤 provider 를 쓸지(Anthropic API?) 결정.
- 저장소의 **기존 시크릿 패턴**을 따를 것: `.env.example` 에 값 없는 문서화된 변수만 추가하고,
  `server/config.js` 처럼 로드한다. `.env` 는 git-ignore 되어 있으며 사용자가 채운다.
- **실제 키를 커밋하지 말 것.** 저장소에 굴러다니는 키를 사용자 확인 없이 재사용하지 말 것.

### 4. manual / live / hybrid 폴백 · **구현 완료**
- `server/config.js` 의 `ETF_DATA_MODE` 를 그대로 본떠, 자격증명이 **0개**여도 앱이 동작하도록
  mock/live/hybrid 폴백을 둘 것. 키가 없으면 `manual-sample` 로 정직하게 폴백(현행 동작).

### 5. 실시간 뉴스 수집 · **미결(별도·더 큰 범위)**
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

## 실행

```bash
# 기본: 수기 샘플 재조립, 외부 호출 없음
npm run build:tag-briefs

# 모델 우선, 오류/정책 실패 시 manual-sample로 정직하게 폴백
TAG_BRIEF_MODE=hybrid npm run build:tag-briefs

# 모델만 사용, 키가 없으면 즉시 실패하고 생성 오류 태그는 미발행
TAG_BRIEF_MODE=live npm run build:tag-briefs
```

OpenRouter 키와 모델은 기존 `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`을 재사용하고,
브리핑만 다른 모델을 쓸 때 `TAG_BRIEF_MODEL`을 지정한다. 실제 키는 `.env`에만 둔다.
