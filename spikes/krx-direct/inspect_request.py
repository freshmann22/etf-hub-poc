# -*- coding: utf-8 -*-
"""
Workstream A — KRX Data Marketplace ETF PDF 메뉴 요청 구조 분석.

이 스크립트는 로그인 없이(익명) data.krx.co.kr 의 ETF PDF 메뉴 및
공통 데이터 엔드포인트(comm/bldAttendant/getJsonData.cmd)에 실제로 접근했을 때
서버가 무엇을 반환하는지 raw 로 기록한다.

발견 사실(브라우저 조사, 2026-07-14):
  - ETF PDF 메뉴(MDC0201030108)뿐 아니라 ETF 전종목 시세(MDC0201030101) 등
    일반 조회 메뉴도 클라이언트 JS 단에서 "로그인 또는 회원가입이 필요합니다"
    alert 로 차단된다 (menu 콘텐츠 자체가 로드되지 않음 → bld 파라미터 미확보).
  - 로그인 페이지 자체가 "보안프로그램을 설치하셔야 이용이 가능한 서비스입니다"
    설치를 요구한다.
  - 안전 원칙(로그인/차단 우회 금지)에 따라 로그인·보안프로그램 설치는 시도하지 않았다.

이 스크립트는 위 발견을 서버 레벨(HTTP status/redirect)에서도 재확인하기 위한
익명 요청만 수행한다. 로그인 세션을 위조하거나 우회하지 않는다.
"""
import json
import os
import time
from datetime import datetime

import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw",
                        datetime.now().strftime("%Y-%m-%d"))

BASE = "https://data.krx.co.kr"
ETF_PDF_MENU_ID = "MDC0201030108"   # ETF > PDF(Portfolio Deposit File)
ETF_LIST_MENU_ID = "MDC0201030101"  # ETF > 전종목 시세 (control — PDF 여부와 무관하게 로그인 게이트인지 확인)

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def now_iso():
    return datetime.now().astimezone().isoformat()


def probe_menu(session, menu_id, label):
    url = BASE + "/contents/MDC/MDI/mdiLoader/index.cmd"
    params = {"menuId": menu_id}
    rec = {
        "label": label,
        "menuId": menu_id,
        "requestUrl": url,
        "params": params,
        "collectedAt": now_iso(),
    }
    try:
        resp = session.get(url, params=params, headers=HEADERS, timeout=15,
                            allow_redirects=True)
        rec["finalUrl"] = resp.url
        rec["httpStatus"] = resp.status_code
        rec["redirectedToLogin"] = "MDCCOMS001.cmd" in resp.url
        rec["contentType"] = resp.headers.get("Content-Type")
        rec["bodyLength"] = len(resp.text)
        # status classification per prompt §7
        if rec["redirectedToLogin"]:
            rec["status"] = "BLOCKED"
        elif resp.status_code == 200:
            rec["status"] = "OK_HTTP_200_NEEDS_MANUAL_REVIEW"
        else:
            rec["status"] = "REQUEST_FAILED"
        raw_path = os.path.join(RAW_DIR, "{}.response.html".format(label))
        with open(raw_path, "w", encoding="utf-8") as f:
            f.write(resp.text)
        rec["rawPath"] = os.path.relpath(raw_path, REPO)
    except requests.RequestException as e:
        rec["status"] = "REQUEST_FAILED"
        rec["errorType"] = type(e).__name__ + ": " + str(e)
    return rec


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    session = requests.Session()  # 익명 — 로그인/쿠키 주입 없음

    results = []
    results.append(probe_menu(session, ETF_PDF_MENU_ID, "etf_pdf_menu_anonymous"))
    time.sleep(1.0)
    results.append(probe_menu(session, ETF_LIST_MENU_ID, "etf_list_menu_anonymous_control"))

    meta_path = os.path.join(RAW_DIR, "inspect_request.meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "generatedAt": now_iso(),
            "note": ("익명(비로그인) HTTP 요청. 로그인 세션 위조/쿠키 주입 없음. "
                      "이 스크립트만으로는 클라이언트 JS 게이트(alert)는 재현되지 않으므로 "
                      "서버 리다이렉트 여부만 관찰한다."),
            "results": results,
        }, f, ensure_ascii=False, indent=2)

    for r in results:
        print("[{}] menuId={} status={} httpStatus={} finalUrl={}".format(
            r["label"], r["menuId"], r.get("status"), r.get("httpStatus"), r.get("finalUrl")))
    print("meta:", meta_path)


if __name__ == "__main__":
    main()
