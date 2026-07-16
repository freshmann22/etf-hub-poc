#!/usr/bin/env python3
# resolve_base_date() 오프라인 단위 테스트.
#
# 실행:
#   python scripts/test_date_resolution.py
#
# 원칙:
#   - fetch_fn 을 목(mock)으로 주입하여 결정적으로 검증한다. 네트워크/ pykrx 미사용.
#   - EXACT / RESOLVED_PRIOR / UNRESOLVED / NOT_ATTEMPTED 및 "데이터를 지어내지 않음"을 커버한다.
#   - 상태 문자열은 server/holdings/constants.js 의 DATE_RESOLUTION_STATUS 와 일치해야 한다.

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collect_etf_holdings import (  # noqa: E402
    DATE_RESOLUTION_STATUS,
    DEFAULT_LOOKBACK_DAYS,
    resolve_base_date,
    _not_attempted,
)


def make_fetch(data_by_date):
    """지정한 날짜들에서만 비어 있지 않은 결과를 돌려주는 목 fetch_fn.

    data_by_date: {'YYYYMMDD': [row, ...]} — 그 외 날짜는 빈 리스트(데이터 없음).
    호출 로그를 함께 반환하여 호출 순서/횟수를 검증할 수 있게 한다.
    """
    calls = []

    def fetch_fn(code, date_str):
        calls.append((code, date_str))
        return data_by_date.get(date_str, [])

    return fetch_fn, calls


class ResolveBaseDateTest(unittest.TestCase):

    def test_exact_when_requested_date_has_data(self):
        # 요청일에 데이터가 있으면 EXACT, 한 번만 호출, lookbackDays=0.
        fetch_fn, calls = make_fetch({"20260710": [{"종목코드": "005930"}]})
        result, dr = resolve_base_date("069500", "20260710", fetch_fn)

        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["EXACT"])
        self.assertEqual(dr["requestedDate"], "20260710")
        self.assertEqual(dr["resolvedBaseDate"], "20260710")
        self.assertEqual(dr["lookbackDays"], 0)
        self.assertEqual(result, [{"종목코드": "005930"}])
        self.assertEqual(calls, [("069500", "20260710")])

    def test_resolved_prior_steps_back_to_correct_date(self):
        # 요청일(토)은 비어 있고, 3일 전(수)에 데이터 → RESOLVED_PRIOR, 정확한 날짜/일수.
        # 20260711=토, 20260710=금(빈), 20260709=목(빈), 20260708=수(데이터)
        fetch_fn, calls = make_fetch({"20260708": [{"종목코드": "000660"}]})
        result, dr = resolve_base_date("069500", "20260711", fetch_fn)

        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["RESOLVED_PRIOR"])
        self.assertEqual(dr["requestedDate"], "20260711")
        self.assertEqual(dr["resolvedBaseDate"], "20260708")
        self.assertEqual(dr["lookbackDays"], 3)  # 실제 물러난 달력일 수
        self.assertEqual(result, [{"종목코드": "000660"}])
        # 요청일부터 하루씩 뒤로, 채택 시점에서 멈춤(4회 호출: 11,10,09,08).
        self.assertEqual(calls, [
            ("069500", "20260711"),
            ("069500", "20260710"),
            ("069500", "20260709"),
            ("069500", "20260708"),
        ])

    def test_unresolved_when_all_empty_in_lookback(self):
        # lookback 내 어떤 날짜에도 데이터 없음 → UNRESOLVED, 데이터 미생성.
        fetch_fn, calls = make_fetch({})  # 전부 빈 결과
        result, dr = resolve_base_date("069500", "20260711", fetch_fn, lookback_days=7)

        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["UNRESOLVED"])
        self.assertEqual(dr["requestedDate"], "20260711")
        self.assertIsNone(dr["resolvedBaseDate"])
        self.assertEqual(dr["lookbackDays"], 7)
        # 절대 holdings 를 지어내지 않는다.
        self.assertIsNone(result)
        # 요청일 포함 lookback+1 회 시도(8회).
        self.assertEqual(len(calls), 8)

    def test_data_just_outside_lookback_stays_unresolved(self):
        # lookback=2 인데 데이터는 3일 전 → 범위 밖이므로 UNRESOLVED(데이터 미채택).
        fetch_fn, _ = make_fetch({"20260708": [{"종목코드": "000660"}]})
        result, dr = resolve_base_date("069500", "20260711", fetch_fn, lookback_days=2)

        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["UNRESOLVED"])
        self.assertIsNone(dr["resolvedBaseDate"])
        self.assertEqual(dr["lookbackDays"], 2)
        self.assertIsNone(result)

    def test_no_requested_date_uses_anchor(self):
        # 요청일 없음 + anchor 제공 → anchor 부터 탐색, requestedDate 는 None.
        fetch_fn, calls = make_fetch({"20260710": [{"종목코드": "035420"}]})
        result, dr = resolve_base_date("069500", None, fetch_fn, anchor_date="20260710")

        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["EXACT"])
        self.assertIsNone(dr["requestedDate"])
        self.assertEqual(dr["resolvedBaseDate"], "20260710")
        self.assertEqual(dr["lookbackDays"], 0)
        self.assertEqual(result, [{"종목코드": "035420"}])
        self.assertEqual(calls[0], ("069500", "20260710"))

    def test_dataframe_like_length_is_respected(self):
        # DataFrame 유사 객체(len 지원)도 비어 있으면 건너뛴다.
        class FakeDF:
            def __init__(self, n):
                self._n = n

            def __len__(self):
                return self._n

        empty = FakeDF(0)
        filled = FakeDF(5)
        fetch_fn, _ = make_fetch({})  # 기본 빈 리스트

        def fetch_df(code, date_str):
            # 20260710 에만 비어 있지 않은 DF, 그 외엔 빈 DF.
            return filled if date_str == "20260710" else empty

        result, dr = resolve_base_date("069500", "20260711", fetch_df)
        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["RESOLVED_PRIOR"])
        self.assertEqual(dr["resolvedBaseDate"], "20260710")
        self.assertEqual(dr["lookbackDays"], 1)
        self.assertIs(result, filled)

    def test_not_attempted_default_shape(self):
        # 보정 미시도 기본값의 형태/상태 검증.
        dr = _not_attempted("20260711")
        self.assertEqual(dr["status"], DATE_RESOLUTION_STATUS["NOT_ATTEMPTED"])
        self.assertEqual(dr["requestedDate"], "20260711")
        self.assertIsNone(dr["resolvedBaseDate"])
        self.assertIsNone(dr["lookbackDays"])

    def test_status_strings_match_contract(self):
        # 계약 문자열 오탈자 방지(하드코딩 값과 비교).
        self.assertEqual(DATE_RESOLUTION_STATUS["EXACT"], "EXACT")
        self.assertEqual(DATE_RESOLUTION_STATUS["RESOLVED_PRIOR"], "RESOLVED_PRIOR")
        self.assertEqual(DATE_RESOLUTION_STATUS["UNRESOLVED"], "UNRESOLVED")
        self.assertEqual(DATE_RESOLUTION_STATUS["NOT_ATTEMPTED"], "NOT_ATTEMPTED")
        self.assertEqual(DEFAULT_LOOKBACK_DAYS, 7)


if __name__ == "__main__":
    unittest.main(verbosity=2)
