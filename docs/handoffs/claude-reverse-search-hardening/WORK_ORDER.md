# 작업 지시서

## 범위

taxonomy 자체의 대규모 재설계가 아니라 역검색의 의미 커버리지, 결과 설명성, fallback 품질, 응답 속도를 고도화한다.

## Phase 0 — 조사와 기준선

코드를 수정하기 전에 다음을 보고한다.

- 현재 query plan 계약과 ranking 흐름
- 대만 질의가 실패하는 정확한 분기
- 운영 파일을 최소로 건드리는 설계안
- 새로 생성할 검색 인덱스의 입력 필드와 크기
- 외부 호출 없이 실행할 테스트 목록

`npm run test:reverse-search`와 `npm test`의 기준 결과를 기록한다.

## Phase 1 — taxonomy 밖 의미를 위한 보조 검색

권장 방향은 query plan에 검증 가능한 `textConstraints` 또는 이에 준하는 별도 구조를 추가하는 것이다. 이름은 기존 코드와 잘 맞게 조정할 수 있지만 다음 의미를 지켜야 한다.

```json
{
  "tags": [],
  "textConstraints": [
    {
      "value": "대만",
      "aliases": ["Taiwan"],
      "mode": "required",
      "fields": ["officialName", "benchmarkName", "investmentObjective"]
    }
  ],
  "sort": null
}
```

필수 조건:

- 입력 문자열 길이, 개수, 허용 필드를 서버에서 검증한다.
- 정규화된 exact/substring 증거를 우선하며 임의의 embedding 유사도를 사실로 표현하지 않는다.
- ETF 공식명, 기초지수명, 투자목적/설명처럼 출처가 있는 필드만 사용한다.
- 검색용 경량 인덱스가 필요하면 canonical metadata에서 결정론적으로 생성한다.
- 브라우저가 1,141종 전체의 거대한 metadata를 직접 내려받지 않게 한다.
- 태그 조건과 text constraint를 함께 사용할 수 있어야 한다.
- 필수 텍스트 조건이 0건이면 무관한 거래대금 결과를 조용히 보여주지 말고 `empty` 또는 명시적 완화 결과로 표시한다.

첫 수용 사례:

- `대만 기업들에 투자하는 ETF` → 487950 포함
- 근거 → 공식명 `대만`, 기초지수 `Taiwan`
- `대만 월배당 ETF` → 대만 텍스트 조건 + `dividend.monthly`
- `미국 ETF` → 기존 `region.us` taxonomy 경로를 우선 사용
- `아틀란티스 ETF` → 결과 없음 또는 명시적 비지원, ETF 발명 금지

## Phase 2 — 질의 계획과 fallback 정직성

- 지원하지 못한 핵심 조건을 warnings에 보존한다.
- unknown tag를 버린 뒤 빈 plan이 되면 그 사실을 UI에 전달한다.
- LLM plan과 규칙 plan이 모두 비었을 때 거래대금 목록을 검색 결과처럼 위장하지 않는다.
- 완화 검색을 했다면 어떤 필수 조건을 완화했는지 표시한다.
- `추천`이라는 표현이 들어와도 투자 권유 문구를 생성하지 않고 탐색 결과로 표현한다.

## Phase 3 — 설명 가능한 ranking

- 각 결과에 매칭된 taxonomy 태그와 텍스트 필드를 분리해 표시한다.
- query score, ETF tag score, confidence의 기존 계산을 보존한다.
- 텍스트 일치 점수는 단순하고 테스트 가능한 규칙으로 둔다.
- 결과 순서가 동일 입력에서 결정론적이어야 한다.
- 이름만 우연히 일치한 경우와 기초지수·투자목적까지 일치한 경우를 구분한다.

## Phase 4 — 속도 벤치마크

정확성 회귀 테스트를 먼저 통과한 뒤 진행한다.

- rules-only, model-only, rules-first, hybrid 비교
- planner와 ranking 시간을 분리 측정
- p50/p90/p95/max 기록
- 기본 dry-run, 실제 외부 호출은 `--execute`와 사용자 승인 필요
- 모델 ID, 반복 수, max-calls를 CLI 또는 설정으로 주입
- API 키와 전체 환경변수를 로그에 남기지 않음
- 전체 taxonomy 프롬프트와 압축 프롬프트를 비교
- 짧은 timeout 후 rules/text fallback 방식 비교

실제 OpenRouter 호출은 사용자가 모델 목록과 최대 호출 수를 승인하기 전 금지한다.

## 범위 밖

- taxonomy 56개 태그의 전면 재설계
- canonical metadata 재수집
- DART parser 변경
- Explore 화면 통합
- 투자 추천·매수/매도 기능
- 승인 없는 dependency 설치 및 외부 유료 호출

## 구현 방식

- 기존 순수 함수 경계를 유지한다.
- 작은 단계별 커밋을 권장한다.
- 생성 데이터는 스크립트로 재현 가능하게 한다.
- 운영 `.env`를 수정하지 않는다.
- 무관한 미추적 파일은 절대 stage하지 않는다.

