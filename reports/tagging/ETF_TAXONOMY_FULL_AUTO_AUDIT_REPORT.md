# ETF taxonomy 전수 자동감사 결과

생성 기준: 2026-07-22 21:48 KST  
대상: canonical ETF 1,141종 / DART PDF 추출 911건 / taxonomy 56개 태그

## 결론

사람의 중간 승인 없이 실행되는 전수 자동감사 경로를 구성하고 실제 데이터에 적용했다.

- DART 계보 정상: 865건
- DART 오배정 자동 격리: 46건
- canonical에서 제거한 오염 후보: 120개
- taxonomy 자동 교정: 86종목, 93개 변경
- 근거 임계값이 없는 태그 자동 필터 격리: 5개
- 최종 ETF universe: 1,141종 유지
- 미분류 ETF: 0종

## DART 자동격리

같은 운용사에서 공시 제목에 포함되는 ETF명들을 비교하고, 유일하게 가장 긴 상품명이 실제 문서 대상인 경우에만 짧은 이름으로 잘못 연결된 행을 격리했다.

- 중복 문서 군: 45개
- 잘못 연결된 행: 46개
- 애매한 행: 0개
- 실제 canonical 오염이 확인된 필드: 투자목적, 분배주기, 분배일정 등

원본 PDF와 추출 결과는 삭제하지 않았다. 잘못 연결된 DART 후보만 canonical 선택 대상에서 제거했으며 실행 전 canonical은 `tmp/full-auto-audit-*`에 백업했다.

## Taxonomy 자동교정

다음 조건만 고신뢰 자동반영 대상으로 사용했다.

- 상품명과 기초지수가 동시에 금·은·탄소배출권 등 원자재 노출을 명시
- 상품명·기초지수가 50:50 또는 채권혼합 구조를 명시하거나 보유비중상 서로 다른 자산이 각각 20% 이상
- canonical frequency가 monthly이고 분배 일정에도 구체적인 매월 지급일이 존재
- 상품명과 기초지수가 모두 유럽 노출을 명시
- 지수 제공사 명칭만으로 미국 지역을 부여한 명백한 오탐

세부 결과는 다음 파일에 보존한다.

- `data/reports/metadata-v2/dart-lineage-audit.json`
- `data/reports/metadata-v2/dart-pdf-batch-source-result-audited.json`
- `data/reports/etf-taxonomy-full-auto-audit-v2.json`

## 자동 안전장치

- canonical universe가 1,141종이 아니면 실행 중단
- 태그 ID 중복·미등록 태그 발생 시 실행 중단
- DART 원본은 보존하고 후보만 격리
- 출력은 임시 파일 작성 후 원자적으로 교체
- 두 번째 실행에서는 이미 적용된 데이터 변경을 다시 쓰지 않음
- 구형 470종목 입력으로 `tagging:merge`가 canonical 결과를 덮어쓰려 하면 쓰기 전에 중단

## 재실행

```powershell
npm run audit:full:auto
```

이 명령은 DART 계보 감사, canonical 정리, readiness 재계산, taxonomy 전수 감사, 서비스 필터 재생성을 순서대로 수행한다.
