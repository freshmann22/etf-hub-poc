# 완료 기준과 테스트 매트릭스

## 필수 기능

| 질의 | 기대 결과 |
|---|---|
| 대만 기업들에 투자하는 ETF | 487950 포함, 이름/기초지수의 대만·Taiwan 근거 표시 |
| 대만 월배당 ETF | 487950 포함, text constraint와 `dividend.monthly` 모두 충족 |
| 미국 반도체 ETF | 기존 `region.us` + `sector.semiconductor` taxonomy 경로 유지 |
| 대만 ETF 중 거래량 많은 것 | 대만 후보를 먼저 제한한 뒤 값이 존재하는 후보만 거래량 정렬 |
| 대만 아닌 ETF | 지원한다면 대만 근거가 있는 ETF를 제외; 미지원이면 명시적 경고 |
| 아틀란티스 ETF | 빈 결과 또는 비지원 안내, 무관한 거래대금 결과 금지 |
| 추천해줘 | 결과는 탐색/비교 후보로 표현하고 투자 권유 문구 금지 |

## 계약 검증

- 알 수 없는 tag ID는 계속 거부한다.
- text constraint는 허용 필드만 사용한다.
- constraint 최대 개수와 문자열 길이가 제한된다.
- 제어문자·빈 문자열·과도한 alias가 거부되거나 정규화된다.
- LLM 응답 parse 실패 시 결정론적 fallback을 사용한다.
- 필수 조건이 사라진 빈 plan을 정상 검색으로 표시하지 않는다.

## ranking 검증

- taxonomy required는 같은 facet 내부 OR, facet 간 AND 규칙을 유지한다.
- text required와 taxonomy required가 함께 적용된다.
- preferred 텍스트는 가산만 하고 필터링하지 않는다.
- excluded 텍스트가 지원되면 해당 근거 ETF를 제외한다.
- 동점은 ETF 코드 등 명시된 규칙으로 안정적으로 정렬한다.
- 동일 입력을 두 번 실행하면 결과 코드와 순서가 같다.

## 데이터 검증

- 검색 인덱스 ETF 수가 canonical universe와 일치한다.
- 487950의 공식명과 benchmark가 인덱스에 존재한다.
- 빈 필드는 문자열 `null`로 색인되지 않는다.
- API 키, Authorization, 원본 환경변수는 산출물에 없다.
- 생성 인덱스는 같은 입력에서 byte-stable하거나 정렬·timestamp 정책이 명시돼 있다.

## 회귀 명령

```powershell
npm run test:reverse-search
npm test
```

새 테스트는 기본적으로 네트워크를 호출하지 않는다. 외부 모델 fixture는 로컬 정적 fixture로 검증한다.

## 브라우저 검증

- 390×844에서 가로 스크롤 없음
- query plan과 결과 근거가 읽기 쉬움
- 빈 결과, 완화 결과, LLM fallback이 서로 다른 문구로 보임
- 로딩 상태가 멈추지 않음
- 서버 로그와 브라우저 네트워크 응답에 API 키가 없음

## 인계 완료 보고 형식

Claude Code는 완료 시 다음을 제공한다.

1. 변경 요약
2. 설계 결정과 대안
3. 수정 파일 목록
4. 테스트 결과
5. 대만 질의 실제 출력 예시
6. 외부 API 호출 수와 비용(호출하지 않았다면 0)
7. 남은 한계
8. 커밋 해시와 작업 트리 상태

