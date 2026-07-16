# -*- coding: utf-8 -*-
"""
pykrx ETF 구성자산(holdings/PDF) availability benchmark — Workstream A.

Runs a REAL benchmark of stock.get_etf_portfolio_deposit_file() across a
representative ETF sample and multiple dates. Records ACTUAL results only;
never fabricates or substitutes mock data.

Outputs:
  reports/pykrx-benchmark-results.csv
  reports/pykrx-benchmark-raw.json
"""
import csv
import json
import os
import time
import traceback
from datetime import datetime, timedelta

from pykrx import stock

try:
    import pykrx
    PYKRX_VERSION = getattr(pykrx, "__version__", None)
except Exception:
    PYKRX_VERSION = None

ANCHOR_DATE = "20240105"      # real historical business day
REQUESTED_DATE = "20240105"   # single-shot request date
MAX_LOOKBACK_DAYS = 7
SLEEP = 0.6

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(REPO, "reports")

# Representative sample: (productType, etfCode, providedName)
SAMPLE = [
    ("국내현물", "069500", "KODEX 200"),
    ("국내현물", "102110", "TIGER 200"),
    ("국내현물", "069660", "KOSEF 200"),
    ("해외주식", "360750", "TIGER 미국S&P500"),
    ("해외주식", "133690", "TIGER 미국나스닥100"),
    ("채권", "148070", "KOSEF 국고채10년"),
    ("채권", "114260", "KODEX 국고채3년"),
    ("레버리지", "122630", "KODEX 레버리지"),
    ("인버스", "114800", "KODEX 인버스"),
    # 아래 4종: ticker-list 엔드포인트가 비어 자동 선별이 불가해, 유형 대표성을 위해
    # 실재성(OHLCV rows>0)을 사전 검증한 실제 코드를 정적으로 추가함.
    ("합성", "195930", "TIGER 유로스탁스50(합성 H)"),
    ("재간접", "251350", "KODEX 선진국MSCI World"),
    ("원자재/파생", "132030", "KODEX 골드선물(H)"),
    ("합성/원자재", "130680", "TIGER 원유선물Enhanced(H)"),
]


def now_iso():
    return datetime.now().astimezone().isoformat()


def probe_pdf(code, date):
    """Call get_etf_portfolio_deposit_file. Return dict with actual outcome."""
    rec = {
        "date": date,
        "holdingsCount": 0,
        "weightValidCount": 0,
        "columns": [],
        "errorType": None,
        "status": "EMPTY",
    }
    try:
        df = stock.get_etf_portfolio_deposit_file(code, date)
    except Exception as e:
        rec["errorType"] = type(e).__name__ + ": " + str(e)
        rec["status"] = "REQUEST_FAILED"
        return rec
    try:
        rows = len(df)
        cols = list(df.columns)
        rec["holdingsCount"] = int(rows)
        rec["columns"] = [str(c) for c in cols]
        if rows == 0:
            rec["errorType"] = "EMPTY"
            rec["status"] = "EMPTY"
            return rec
        # count rows with a numeric weight, if a weight-ish column exists
        weight_cols = [c for c in cols if ("비중" in str(c)) or ("weight" in str(c).lower())]
        wvalid = 0
        if weight_cols:
            wc = weight_cols[0]
            for v in df[wc].tolist():
                try:
                    fv = float(v)
                    if fv == fv:  # not NaN
                        wvalid += 1
                except (TypeError, ValueError):
                    pass
        rec["weightValidCount"] = int(wvalid)
        rec["status"] = "OK" if (weight_cols and wvalid == rows) else "PARTIAL"
        return rec
    except Exception as e:
        rec["errorType"] = "PARSE_" + type(e).__name__ + ": " + str(e)
        rec["status"] = "REQUEST_FAILED"
        return rec


def resolve_business_day_pdf(code, anchor, max_days):
    """Step back up to max_days calendar days until a non-empty PDF."""
    base = datetime.strptime(anchor, "%Y%m%d")
    for i in range(max_days + 1):
        d = (base - timedelta(days=i)).strftime("%Y%m%d")
        r = probe_pdf(code, d)
        time.sleep(SLEEP)
        if r["status"] in ("OK", "PARTIAL"):
            return {
                "resolved": True,
                "resolvedBaseDate": d,
                "lookbackDays": i,
                "probe": r,
            }
    return {
        "resolved": False,
        "resolvedBaseDate": None,
        "lookbackDays": max_days,
        "probe": r,  # last probe
    }


def try_ticker_list():
    """Attempt to enrich sample with real 액티브/합성/TR/재간접 codes."""
    diag = {"tickerListWorked": False, "count": 0, "error": None, "picked": []}
    extra = []
    try:
        codes = stock.get_etf_ticker_list(ANCHOR_DATE)
    except Exception as e:
        diag["error"] = type(e).__name__ + ": " + str(e)
        return diag, extra
    codes = list(codes) if codes is not None else []
    diag["count"] = len(codes)
    if not codes:
        diag["error"] = "EMPTY_TICKER_LIST"
        return diag, extra
    diag["tickerListWorked"] = True
    wanted = [("액티브", "액티브"), ("합성", "합성"), ("TR", "TR"),
              ("재간접", "재간접")]
    used_codes = set()
    for label, kw in wanted:
        for c in codes:
            if c in used_codes:
                continue
            try:
                name = stock.get_etf_ticker_name(c)
            except Exception:
                name = ""
            if name and kw in name:
                extra.append((label, c, name))
                used_codes.add(c)
                diag["picked"].append({"type": label, "code": c, "name": name})
                break
    return diag, extra


def get_name(code, provided):
    try:
        n = stock.get_etf_ticker_name(code)
        if n:
            return str(n), True
    except Exception:
        pass
    return provided, False


def main():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    collected_at = now_iso()

    # --- Connectivity diagnostic: OHLCV works while PDF empty ---
    ohlcv_diag = {"code": "069500", "start": "20240102", "end": "20240105",
                  "rowCount": None, "error": None}
    try:
        ohlcv = stock.get_market_ohlcv("20240102", "20240105", "069500")
        ohlcv_diag["rowCount"] = int(len(ohlcv))
    except Exception as e:
        ohlcv_diag["error"] = type(e).__name__ + ": " + str(e)
    time.sleep(SLEEP)

    pdf_diag = probe_pdf("069500", REQUESTED_DATE)
    time.sleep(SLEEP)

    # --- ticker-list enrichment attempt ---
    ticker_diag, extra = try_ticker_list()

    sample = list(SAMPLE)
    for label, code, name in extra:
        sample.append((label, code, name))

    records = []
    counts = {"OK": 0, "PARTIAL": 0, "EMPTY": 0, "REQUEST_FAILED": 0}

    for productType, code, provided in sample:
        name, name_from_api = get_name(code, provided)
        req = probe_pdf(code, REQUESTED_DATE)
        time.sleep(SLEEP)
        resolved = resolve_business_day_pdf(code, ANCHOR_DATE, MAX_LOOKBACK_DAYS)

        status = req["status"]
        # prefer resolved status if the resolver actually found rows
        if resolved["resolved"]:
            status = resolved["probe"]["status"]
        counts[status] = counts.get(status, 0) + 1

        rec = {
            "productType": productType,
            "etfCode": code,
            "etfName": name,
            "etfNameFromApi": name_from_api,
            "requestedDate": REQUESTED_DATE,
            "requestedDateResult": req,
            "resolvedBaseDate": resolved["resolvedBaseDate"],
            "lookbackDays": resolved["lookbackDays"],
            "businessDayResolved": resolved["resolved"],
            "holdingsCount": req["holdingsCount"],
            "weightValidCount": req["weightValidCount"],
            "columns": req["columns"],
            "errorType": req["errorType"],
            "status": status,
            "provider": "PYKRX",
            "collectedAt": now_iso(),
        }
        records.append(rec)
        print("[{}] {} {} -> {} (rows={})".format(
            productType, code, name, status, req["holdingsCount"]))

    total = len(records)
    success = counts.get("OK", 0) + counts.get("PARTIAL", 0)
    success_rate = (success / total * 100.0) if total else 0.0

    full_dry_run = {
        "performed": False,
        "reason": "표본 성공률 <80% (구조적 EMPTY)",
        "entryThresholdPct": 80,
        "actualSuccessRatePct": round(success_rate, 2),
    }
    if success_rate >= 80.0:
        full_dry_run = {
            "performed": False,
            "reason": "게이트는 통과했으나 이 워크스트림 범위상 full dry-run 미실행",
            "entryThresholdPct": 80,
            "actualSuccessRatePct": round(success_rate, 2),
        }

    root_cause = ("get_etf_portfolio_deposit_file(PDF/구성자산) 엔드포인트가 이 환경에서 "
                  "구조적으로 빈 DataFrame 반환 (OHLCV는 정상) — KRX PDF 응답 파싱 불가/차단")

    raw = {
        "meta": {
            "anchorDate": ANCHOR_DATE,
            "requestedDate": REQUESTED_DATE,
            "maxLookbackDays": MAX_LOOKBACK_DAYS,
            "generatedAt": collected_at,
            "pykrxVersion": PYKRX_VERSION,
            "provider": "PYKRX",
            "note": "REAL benchmark; no fabricated data.",
        },
        "connectivityDiagnostic": {
            "ohlcv": ohlcv_diag,
            "pdf": pdf_diag,
            "interpretation": ("OHLCV rowCount>0 이면서 PDF holdingsCount==0 이면 "
                               "네트워크는 정상이나 구성자산 엔드포인트만 실패."),
        },
        "tickerListDiagnostic": ticker_diag,
        "sampleUsed": [
            {"productType": p, "etfCode": c, "providedName": n}
            for (p, c, n) in sample
        ],
        "records": records,
        "statusCounts": counts,
        "totalSample": total,
        "successCount": success,
        "successRatePct": round(success_rate, 2),
        "fullDryRun": full_dry_run,
        "rootCauseHypothesis": root_cause,
    }

    raw_path = os.path.join(REPORTS_DIR, "pykrx-benchmark-raw.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)

    csv_path = os.path.join(REPORTS_DIR, "pykrx-benchmark-results.csv")
    fields = ["productType", "etfCode", "etfName", "requestedDate",
              "resolvedBaseDate", "lookbackDays", "businessDayResolved",
              "holdingsCount", "weightValidCount", "columns", "errorType",
              "status", "provider", "collectedAt"]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["# pykrx ETF holdings benchmark",
                    "anchorDate=" + ANCHOR_DATE,
                    "generatedAt=" + collected_at,
                    "pykrxVersion=" + str(PYKRX_VERSION)])
        w.writerow(fields)
        for r in records:
            w.writerow([
                r["productType"], r["etfCode"], r["etfName"], r["requestedDate"],
                r["resolvedBaseDate"], r["lookbackDays"], r["businessDayResolved"],
                r["holdingsCount"], r["weightValidCount"],
                "|".join(r["columns"]), r["errorType"], r["status"],
                r["provider"], r["collectedAt"],
            ])

    print("\n=== SUMMARY ===")
    print("statusCounts:", counts)
    print("successRatePct:", round(success_rate, 2))
    print("tickerListWorked:", ticker_diag.get("tickerListWorked"))
    print("ohlcvRowCount:", ohlcv_diag.get("rowCount"),
          "pdfHoldingsCount:", pdf_diag.get("holdingsCount"))
    print("fullDryRun:", full_dry_run)
    print("files:", csv_path, raw_path)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
