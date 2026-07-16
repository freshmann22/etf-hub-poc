# -*- coding: utf-8 -*-
"""
네이버페이 증권에서 ETF TOP10 구성종목을 크롤링하는 개인용 샘플 스크립트.

- ETF 전종목 코드: finance.naver.com/api/sise/etfItemList.nhn (로그인/API키 불필요, JSON)
- 종목별 TOP10 구성종목: finance.naver.com/item/main.naver?code=XXXXXX 의
  <div class="section etf_asset"> 테이블 (로그인/API키 불필요, 정적 HTML)

주의: 상위 10종목까지만 제공됨(네이버 자체 고지: "1CU를 기준으로 하여 최대 10개까지").
개인 사용 목적 샘플 수집 — 과도한 동시 요청 없이 순차 + 딜레이로 수행한다.
"""
import csv
import os
import sys
import time

import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
SLEEP_SEC = 0.5
SAMPLE_SIZE = None  # None = 전종목

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(
    REPO_DIR, "reports",
    "naver_top10_holdings_sample.csv" if SAMPLE_SIZE else "naver_top10_holdings_full.csv",
)


def fetch_etf_universe():
    r = requests.get(
        "https://finance.naver.com/api/sise/etfItemList.nhn",
        params={"etfType": "0"}, headers=HEADERS, timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    items = data["result"]["etfItemList"]
    return [{"code": it["itemcode"], "name": it["itemname"]} for it in items]


def fetch_top10(code):
    """ETF 1종의 TOP10 구성종목을 가져온다. 실패/미제공 시 빈 리스트."""
    r = requests.get(
        "https://finance.naver.com/item/main.naver",
        params={"code": code}, headers=HEADERS, timeout=15,
    )
    r.encoding = "utf-8"
    soup = BeautifulSoup(r.text, "html.parser")
    section = soup.select_one("div.section.etf_asset table")
    if section is None:
        return []

    rows = []
    rank = 0
    for tr in section.select("tbody > tr"):
        name_cell = tr.select_one("td.ctg a")
        if name_cell is None:
            continue  # 구분선/공백 행
        rank += 1
        holding_code = name_cell["href"].split("code=")[-1]
        holding_name = name_cell.get_text(strip=True)
        tds = tr.find_all("td")
        qty = tds[1].get_text(strip=True) if len(tds) > 1 else None
        weight = tds[2].get_text(strip=True).rstrip("%") if len(tds) > 2 else None
        rows.append({
            "rank": rank,
            "holdingCode": holding_code,
            "holdingName": holding_name,
            "quantity": qty,
            "weightPct": weight,
        })
    return rows


def main():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    universe = fetch_etf_universe()
    print("전종목 수:", len(universe))

    sample = universe[:SAMPLE_SIZE]
    fieldnames = ["etfCode", "etfName", "rank", "holdingCode", "holdingName",
                  "quantity", "weightPct", "status"]

    counts = {"OK": 0, "EMPTY_NO_TABLE": 0, "REQUEST_FAILED": 0}

    with open(OUT_PATH, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for i, etf in enumerate(sample, 1):
            code, name = etf["code"], etf["name"]
            try:
                rows = fetch_top10(code)
            except requests.RequestException as e:
                w.writerow({"etfCode": code, "etfName": name, "rank": None,
                            "holdingCode": None, "holdingName": None,
                            "quantity": None, "weightPct": None,
                            "status": "REQUEST_FAILED:" + type(e).__name__})
                counts["REQUEST_FAILED"] += 1
                print("[{}/{}] {} {} -> REQUEST_FAILED".format(i, len(sample), code, name))
                time.sleep(SLEEP_SEC)
                continue

            if not rows:
                w.writerow({"etfCode": code, "etfName": name, "rank": None,
                            "holdingCode": None, "holdingName": None,
                            "quantity": None, "weightPct": None,
                            "status": "EMPTY_NO_TABLE"})
                counts["EMPTY_NO_TABLE"] += 1
                print("[{}/{}] {} {} -> EMPTY_NO_TABLE".format(i, len(sample), code, name))
            else:
                for row in rows:
                    w.writerow({"etfCode": code, "etfName": name, **row, "status": "OK"})
                counts["OK"] += 1
                print("[{}/{}] {} {} -> OK ({}종목)".format(i, len(sample), code, name, len(rows)))

            time.sleep(SLEEP_SEC)

    print("\n=== SUMMARY ===")
    print(counts)
    print("out:", OUT_PATH)


if __name__ == "__main__":
    sys.exit(main())
