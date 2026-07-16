# -*- coding: utf-8 -*-
"""
WiseReport(navercomp.wisereport.co.kr) ETF 카드에서 메타데이터를 크롤링하는 개인용 샘플 스크립트.

- ETF 전종목 코드: finance.naver.com/api/sise/etfItemList.nhn (로그인/API키 불필요, JSON)
- 종목별 메타데이터: navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd=XXXXXX 안에
  인라인 JS 변수(product_summary_data, status_data)로 실값이 그대로 박혀 있음
  (로그인/API키 불필요, 별도 AJAX 없이 GET 한 번으로 파싱 가능).

수집 필드: 총보수, 상장일, 최초설정일, 운용사, 기초지수, 펀드형태, 유동성공급자,
          1/3/6/12개월 수익률.
개인 사용 목적 샘플 수집 — 순차 + 딜레이로 수행한다.
"""
import csv
import json
import os
import re
import sys
import time

import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
SLEEP_SEC = 0.5
SAMPLE_SIZE = 100

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(
    REPO_DIR, "reports",
    "wisereport_metadata_sample.csv" if SAMPLE_SIZE else "wisereport_metadata_full.csv",
)

VAR_RE = re.compile(r'var\s+(product_summary_data|status_data)\s*=\s*(\{.*?\});', re.DOTALL)


def fetch_etf_universe():
    r = requests.get(
        "https://finance.naver.com/api/sise/etfItemList.nhn",
        params={"etfType": "0"}, headers=HEADERS, timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    items = data["result"]["etfItemList"]
    return [{"code": it["itemcode"], "name": it["itemname"]} for it in items]


def fetch_metadata(code):
    """WiseReport ETF 카드에서 인라인 JS 객체 2개를 파싱한다. 실패/미제공 시 빈 dict."""
    r = requests.get(
        "https://navercomp.wisereport.co.kr/v2/ETF/index.aspx",
        params={"cmp_cd": code}, headers=HEADERS, timeout=15,
    )
    r.encoding = "utf-8"
    html = r.text

    out = {}
    for name, blob in VAR_RE.findall(html):
        try:
            out[name] = json.loads(blob)
        except json.JSONDecodeError:
            pass
    return out


def main():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    universe = fetch_etf_universe()
    print("전종목 수:", len(universe))

    sample = universe[:SAMPLE_SIZE]
    fieldnames = [
        "etfCode", "etfName", "issuer", "listDate", "firstSettleDate",
        "benchmarkIndex", "fundType", "totalFeePct", "liquidityProviders",
        "ern1m", "ern3m", "ern6m", "ern12m", "officialUrl", "status",
    ]
    counts = {"OK": 0, "PARTIAL": 0, "EMPTY": 0, "REQUEST_FAILED": 0}

    with open(OUT_PATH, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for i, etf in enumerate(sample, 1):
            code, name = etf["code"], etf["name"]
            row = {"etfCode": code, "etfName": name}
            try:
                meta = fetch_metadata(code)
            except requests.RequestException as e:
                row["status"] = "REQUEST_FAILED:" + type(e).__name__
                counts["REQUEST_FAILED"] += 1
                w.writerow(row)
                print("[{}/{}] {} {} -> REQUEST_FAILED".format(i, len(sample), code, name))
                time.sleep(SLEEP_SEC)
                continue

            psd = meta.get("product_summary_data", {})
            sd = meta.get("status_data", {})
            row.update({
                "issuer": psd.get("ISSUE_NM_KOR"),
                "listDate": psd.get("LIST_DT"),
                "firstSettleDate": psd.get("FIRST_SETTLE_DT"),
                "benchmarkIndex": psd.get("BASE_IDX_NM_KOR"),
                "fundType": psd.get("FUND_TYP"),
                "totalFeePct": psd.get("TOT_PAY"),
                "liquidityProviders": psd.get("LP_NM_KOR"),
                "ern1m": sd.get("ERN1"),
                "ern3m": sd.get("ERN3"),
                "ern6m": sd.get("ERN6"),
                "ern12m": sd.get("ERN12"),
                "officialUrl": psd.get("URL"),
            })

            if not meta:
                row["status"] = "EMPTY"
                counts["EMPTY"] += 1
            elif psd and sd:
                row["status"] = "OK"
                counts["OK"] += 1
            else:
                row["status"] = "PARTIAL"
                counts["PARTIAL"] += 1

            w.writerow(row)
            print("[{}/{}] {} {} -> {}".format(i, len(sample), code, name, row["status"]))
            time.sleep(SLEEP_SEC)

    print("\n=== SUMMARY ===")
    print(counts)
    print("out:", OUT_PATH)


if __name__ == "__main__":
    sys.exit(main())
