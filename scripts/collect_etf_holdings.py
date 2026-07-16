#!/usr/bin/env python3
# ETF 구성자산 수집기 스켈레톤 (pykrx).
#
# 사용법:
#   python scripts/collect_etf_holdings.py <ETF_CODE> [YYYYMMDD]
#
# 출력(stdout, JSON 한 줄):
#   성공: { "ok": true,  "status": "OK",
#           "raw": { "etfCode", "etfName", "baseDate", "provider": "PYKRX",
#                    "rows": [ {원시행}, ... ], "dateResolution": {...} },
#           "dateResolution": {...}, "message": null }
#   실패: { "ok": false, "status": "REQUEST_FAILED"|"NOT_IMPLEMENTED"|"EMPTY"|...,
#           "raw": null, "dateResolution": {...}, "message": "<사유>" }
#
# 규칙:
#   - pykrx 미설치/호출 실패 시에도 절대 가짜 holdings 를 만들지 않는다. 실패 JSON 만 출력한다.
#   - JS 어댑터(server/holdings/providers/pykrx.js)가 이 stdout(JSON)을 파싱한다.
#   - 이 단계에서 pykrx 설치는 선택 사항이다(requirements.txt 참고).
#
# 영업일 보정(date resolution):
#   - 요청일(requestedDate)에 데이터가 없으면(주말/휴일/미확정) 최대 lookback 일까지 하루씩
#     뒤로 물러나며 비어 있지 않은 결과를 찾는다(달력일 기준, 주말/휴일 포함).
#   - resolve_base_date() 는 fetch_fn 을 주입받는 순수 함수로, pykrx/네트워크 없이 단위 테스트 가능하다.
#   - 상태 문자열은 server/holdings/constants.js 의 DATE_RESOLUTION_STATUS 와 정확히 일치해야 한다.

import json
import sys
from datetime import date, datetime, timedelta


# server/holdings/constants.js 의 DATE_RESOLUTION_STATUS 와 값이 정확히 일치해야 한다.
DATE_RESOLUTION_STATUS = {
    "EXACT": "EXACT",              # 요청일에 데이터 존재
    "RESOLVED_PRIOR": "RESOLVED_PRIOR",  # 직전 영업일로 후퇴하여 채택
    "UNRESOLVED": "UNRESOLVED",    # lookback 범위 내 유효 데이터 없음
    "NOT_ATTEMPTED": "NOT_ATTEMPTED",    # 보정 미시도
}

# 기본 lookback(달력일). 요청일 포함 이후 최대 이 일수만큼 뒤로 물러난다.
DEFAULT_LOOKBACK_DAYS = 7


def _not_attempted(requested_date):
    """보정을 시도하지 않은 경우의 dateResolution 기본값."""
    return {
        "requestedDate": requested_date,
        "resolvedBaseDate": None,
        "lookbackDays": None,
        "status": DATE_RESOLUTION_STATUS["NOT_ATTEMPTED"],
    }


def fail(status, message, date_resolution=None):
    """실패 JSON 을 stdout 에 출력하고 종료 코드 1 로 종료."""
    print(json.dumps({
        "ok": False,
        "status": status,
        "raw": None,
        "dateResolution": date_resolution if date_resolution is not None else _not_attempted(None),
        "message": message,
    }, ensure_ascii=False))
    sys.exit(1)


def _parse_yyyymmdd(s):
    """'YYYYMMDD' 문자열 → date."""
    return datetime.strptime(str(s), "%Y%m%d").date()


def _fmt_yyyymmdd(d):
    """date → 'YYYYMMDD' 문자열."""
    return d.strftime("%Y%m%d")


def _non_empty(result):
    """fetch_fn 결과가 '비어 있지 않은지' 판정한다(DataFrame/list/None 방어)."""
    if result is None:
        return False
    try:
        return len(result) > 0
    except TypeError:
        return bool(result)


def resolve_base_date(etf_code, requested_date, fetch_fn,
                      lookback_days=DEFAULT_LOOKBACK_DAYS, anchor_date=None):
    """가장 가까운 유효 기준일을 찾는 순수/주입식 리졸버.

    인자:
      etf_code:       ETF 단축코드(그대로 fetch_fn 에 전달).
      requested_date: 요청 기준일 'YYYYMMDD' 또는 None.
      fetch_fn:       fetch_fn(code, date_str) → 결과. 비어 있지 않으면 채택한다.
                      pykrx/네트워크 없이 주입 가능하므로 단위 테스트에서 목(mock)으로 대체한다.
      lookback_days:  뒤로 물러날 최대 달력일 수(주말/휴일 포함). 기본 7.
      anchor_date:    requested_date 가 없을 때 시작점으로 쓸 'YYYYMMDD'(예: 최근 영업일). 없으면 시스템 날짜.

    반환: (result, date_resolution)
      result:         채택된 fetch_fn 반환값(없으면 None). 절대 데이터를 지어내지 않는다.
      date_resolution: {requestedDate, resolvedBaseDate, lookbackDays, status}
        - status EXACT:          요청일(step 0)에서 데이터 존재. lookbackDays=0.
        - status RESOLVED_PRIOR: 직전 N일째에서 데이터 존재. lookbackDays=N(실제 물러난 일수).
        - status UNRESOLVED:     lookback 범위 내 데이터 없음. resolvedBaseDate=None, lookbackDays=lookback_days.
    """
    if requested_date:
        start = _parse_yyyymmdd(requested_date)
        requested_out = requested_date
    elif anchor_date:
        start = _parse_yyyymmdd(anchor_date)
        requested_out = None
    else:
        start = date.today()
        requested_out = None

    # step 0(요청일/앵커) 부터 lookback_days 까지 하루씩 뒤로.
    for step in range(0, lookback_days + 1):
        candidate = start - timedelta(days=step)
        candidate_str = _fmt_yyyymmdd(candidate)
        result = fetch_fn(etf_code, candidate_str)
        if _non_empty(result):
            status = (DATE_RESOLUTION_STATUS["EXACT"] if step == 0
                      else DATE_RESOLUTION_STATUS["RESOLVED_PRIOR"])
            return result, {
                "requestedDate": requested_out,
                "resolvedBaseDate": candidate_str,
                "lookbackDays": step,
                "status": status,
            }

    # lookback 소진 — 유효 데이터 없음. 데이터를 지어내지 않는다.
    return None, {
        "requestedDate": requested_out,
        "resolvedBaseDate": None,
        "lookbackDays": lookback_days,
        "status": DATE_RESOLUTION_STATUS["UNRESOLVED"],
    }


def collect(etf_code, base_date):
    """pykrx 로 실제 수집을 시도한다(영업일 보정 포함). 실패 시 예외를 올리거나 fail() 로 종료."""
    # pykrx 는 선택적 의존성 — import 자체를 방어한다.
    try:
        from pykrx import stock
    except Exception as exc:  # noqa: BLE001
        # 미설치 → 미구현으로 취급(가짜 데이터 금지).
        fail("NOT_IMPLEMENTED", "pykrx 가 설치되어 있지 않습니다: %s" % exc,
             _not_attempted(base_date))
        return  # 도달하지 않음(fail 이 종료)

    requested_date = base_date  # None 가능

    # 실제 fetch: ETF 포트폴리오 예탁(PDF) 구성내역.
    # 반환 DataFrame 컬럼 예: 비중, 계약수, 금액 (index = 종목코드).
    def fetch_fn(code, date_str):
        return stock.get_etf_portfolio_deposit_file(code, date_str)

    # 요청일 미지정 시 pykrx 최근 영업일을 앵커로 사용(주말/휴일이면 시작점을 앞당김).
    anchor = None
    if not requested_date:
        try:
            anchor = stock.get_nearest_business_day_in_a_week()
        except Exception:  # noqa: BLE001
            anchor = None

    try:
        df, date_resolution = resolve_base_date(
            etf_code, requested_date, fetch_fn, anchor_date=anchor)
    except Exception as exc:  # noqa: BLE001
        fail("REQUEST_FAILED", "pykrx 수집 실패: %s" % exc, _not_attempted(requested_date))
        return

    if not _non_empty(df):
        # lookback 내 유효 데이터 없음 — 실패이되 dateResolution(UNRESOLVED) 은 보존한다.
        fail("EMPTY", "구성자산이 비어 있습니다(기준일/코드 확인 필요).", date_resolution)
        return

    rows = []
    for code, r in df.iterrows():
        rows.append({
            "종목코드": str(code),
            # pykrx 는 종목명을 별도 조회해야 할 수 있음(여기선 있으면 사용).
            "종목명": _safe(r, "종목명"),
            "비중": _safe(r, "비중"),
            "계약수": _safe(r, "계약수"),
            "금액": _safe(r, "금액"),
        })

    return {
        "etfCode": etf_code,
        "etfName": None,  # 필요 시 stock.get_etf_ticker_name 등으로 보강.
        "baseDate": str(date_resolution["resolvedBaseDate"]),  # 최종 채택 기준일.
        "provider": "PYKRX",
        "rows": rows,
        "dateResolution": date_resolution,
    }


def _safe(row, key):
    """DataFrame row 에서 값을 안전하게 꺼낸다(없으면 None)."""
    try:
        val = row[key]
    except Exception:  # noqa: BLE001
        return None
    # NaN 방어.
    try:
        import math
        if isinstance(val, float) and math.isnan(val):
            return None
    except Exception:  # noqa: BLE001
        pass
    return val


def main(argv):
    if len(argv) < 2:
        fail("REQUEST_FAILED", "사용법: python scripts/collect_etf_holdings.py <ETF_CODE> [YYYYMMDD]")
        return

    etf_code = argv[1].strip()
    base_date = argv[2].strip() if len(argv) >= 3 else None

    # 어떤 예외(pykrx/pandas 내부 오류 포함)도 traceback 으로 새지 않게 최상위에서 방어한다.
    # 항상 파싱 가능한 상태 JSON 만 출력하며, 실패 시에도 가짜 holdings 를 만들지 않는다.
    try:
        raw = collect(etf_code, base_date)
    except SystemExit:
        raise  # fail() 의 정상 종료는 통과
    except Exception as exc:  # noqa: BLE001
        fail("REQUEST_FAILED", "수집 실패: %s: %s" % (type(exc).__name__, exc),
             _not_attempted(base_date))
        return
    print(json.dumps({
        "ok": True,
        "status": "OK",
        "raw": raw,
        "dateResolution": raw.get("dateResolution") if isinstance(raw, dict) else None,
        "message": None,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
