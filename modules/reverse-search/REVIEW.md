# Reverse Search Review

## Start

```bash
npm run test:reverse-search
npm run review:reverse-search
```

Open `http://localhost:4174/modules/reverse-search/index.html` at 390 x 844.

## Required Queries

| Query | Expected behavior |
| --- | --- |
| `SK하이닉스 비중높은 ETF?` | 구성종목 비중 내림차순과 비중 근거 표시 |
| `고배당 ETF` | 배당 태그 점수 기준 결과 표시 |
| `반도체 중에서 거래량 많은 ETF` | 반도체 필터 후 `volume` 내림차순, 근거 단위 `주` |
| `거래대금 많은 ETF` | `tradingValue` 내림차순, 거래량과 별도 처리 |
| `아무말 대잔치` | 거래대금 기본 결과와 의도 미인식 안내 |

질의 실행 후 `질의 해석` 영역에서 태그명과 질의 점수가 표시되는지 확인한다. 현재 `규칙 해석`으로 표시되며 LLM 연결 후에는 `LLM 해석`으로 변경된다.

## Approval Checklist

- 로딩, 빈 결과, 부분 커버리지 안내가 화면을 깨뜨리지 않는다.
- 결과 근거가 실제 입력 필드와 단위를 사용한다.
- 표시된 태그 점수와 결과의 적합도 순서가 일관된다.
- 390 x 844에서 가로 스크롤이 없다.
- Explore 메인 화면 파일을 모듈 통합 목적으로 수정하지 않았다.
- `npm test`와 `npm run test:reverse-search`가 모두 통과한다.
