#!/usr/bin/env python3
"""Validate four already-downloaded official DART prospectus PDFs.

This script never downloads data. It reads the DART body-contract report, selects
one current attachment PDF per ETF, compares two text extractors, locates
evidence pages, renders review PNGs, and writes a deterministic JSON report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from difflib import SequenceMatcher
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


FIELDS = {
    "objective": [r"투자\s*목적", r"운용\s*목적", r"목표로\s*운용", r"운용함을\s*목적"],
    "strategy": [r"투자\s*전략", r"운용\s*전략", r"운용\s*방법", r"투자전략\s*및\s*위험관리"],
    "benchmark": [r"기초\s*지수", r"비교\s*지수", r"추종\s*지수"],
    "distribution": [r"월\s*분배금", r"매월.{0,30}분배금", r"분배금\s*지급기준일", r"분배\s*정책", r"이익분배금"],
}

HEADING_ANCHORS = {
    "objective": [r"(?:^|\s)1\.\s*투자\s*목적", r"투자\s*목적\s*및\s*투자\s*전략"],
    "strategy": [r"(?:^|\s)2\.\s*투자\s*전략", r"투자\s*목적\s*및\s*투자\s*전략"],
    "benchmark": [r"(?:기초|비교|참고)\s*지수\s*[:：]", r".{2,80}지수.{0,20}(?:를|을)\s*기초\s*지수로"],
    "distribution": [r"월\s*분배금", r"분배금\s*지급기준일", r"분배\s*정책"],
}

VISUAL_REVIEW = {
    "0193W0": {"objective": True, "strategy": True, "benchmark": True, "distribution": False},
    "0204S0": {"objective": True, "strategy": True, "benchmark": True, "distribution": False},
    "0197X0": {"objective": True, "strategy": True, "benchmark": True, "distribution": False},
    "0216K0": {"objective": True, "strategy": True, "benchmark": True, "distribution": True},
}

PASS_CRITERIA = {
    "validPdfRate": 1.0,
    "pdfplumberExtractionRate": 1.0,
    "pypdfExtractionRate": 1.0,
    "minimumExtractorAgreement": 0.80,
    "objectiveEvidenceRate": 1.0,
    "strategyEvidenceRate": 1.0,
    "visualFalsePositiveCount": 0,
    "benchmarkAndDistributionPolicy": "report explicit evidence rates; absence is not coerced to false",
    "ocrPolicy": "required only when either extractor yields fewer than 500 normalized characters or agreement is below 0.80",
}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_pdfplumber(path: Path) -> list[str]:
    with pdfplumber.open(path) as pdf:
        return [normalize(page.extract_text() or "") for page in pdf.pages]


def extract_pypdf(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    return [normalize(page.extract_text() or "") for page in reader.pages]


def agreement(left: str, right: str) -> float:
    compact_left = re.sub(r"\s+", "", left)
    compact_right = re.sub(r"\s+", "", right)
    return round(SequenceMatcher(None, compact_left, compact_right, autojunk=False).ratio(), 4)


def evidence_for_pages(pages: list[str]) -> dict[str, dict]:
    output = {}
    for field, patterns in FIELDS.items():
        scored = []
        for page_number, text in enumerate(pages, 1):
            hits = sum(len(re.findall(pattern, text, re.I | re.S)) for pattern in patterns)
            if not hits:
                continue
            heading_matches = [(pattern, match) for pattern in HEADING_ANCHORS[field] for match in re.finditer(pattern, text, re.I | re.S)]
            section_heading = bool(re.search(r"(?:^|\s)(?:1\.\s*투자\s*목적|2\.\s*투자\s*전략)|투자\s*목적\s*및\s*투자\s*전략", text, re.I | re.S))
            is_people_context = bool(re.search(r"운용\s*전문\s*인력|책임\s*운용", text)) and not heading_matches
            is_risk_context = (bool(re.search(r"주요\s*투자\s*위험|투자\s*위험의\s*주요\s*내용", text)) or text.count("위험") >= 5) and not section_heading
            if field in ("objective", "strategy") and is_people_context:
                continue
            if field in ("objective", "strategy", "benchmark") and is_risk_context:
                continue
            detail_bonus = sum(token in text for token in ("목적으로", "투자대상", "지수 산출", "지급기준일", "분배율", "운용"))
            heading_bonus = 100 if heading_matches else 0
            if field == "benchmark" and section_heading:
                heading_bonus += 300
            scored.append((hits * 10 + detail_bonus + heading_bonus, page_number, text, heading_matches))
        if not scored:
            output[field] = {"found": False, "candidatePages": [], "selectedPage": None, "snippet": None}
            continue
        scored.sort(key=lambda row: (-row[0], row[1]))
        _, selected_page, selected_text, selected_headings = scored[0]
        if selected_headings:
            anchor_pattern, anchor_match = min(selected_headings, key=lambda item: item[1].start())
        else:
            matches = [(pattern, match) for pattern in patterns for match in re.finditer(pattern, selected_text, re.I | re.S)]
            anchor_pattern, anchor_match = min(matches, key=lambda item: item[1].start())
        start = max(0, anchor_match.start() - 120)
        output[field] = {
            "found": True,
            "candidatePages": [row[1] for row in scored],
            "selectedPage": selected_page,
            "anchorPattern": anchor_pattern,
            "excludedContexts": ["운용전문인력", "주요투자위험"],
            "snippet": selected_text[start : start + 500],
        }
    return output


def command_path(explicit: str | None, name: str) -> str | None:
    if explicit:
        candidate = Path(explicit)
        if candidate.exists():
            return str(candidate)
    return shutil.which(name)


def pdfinfo(path: Path, executable: str | None) -> dict:
    if not executable:
        return {"available": False}
    result = subprocess.run([executable, str(path)], check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    values = {}
    for line in result.stdout.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip()
    return {"available": True, "pages": int(values.get("Pages", 0)), "encrypted": values.get("Encrypted"), "pageSize": values.get("Page size"), "pdfVersion": values.get("PDF version")}


def render_pages(path: Path, code: str, pages: dict[str, int], output_dir: Path, executable: str | None) -> list[dict]:
    if not executable:
        return []
    rendered = []
    for role, page in pages.items():
        prefix = output_dir / f"{code}_{role}_p{page:02d}"
        subprocess.run([executable, "-f", str(page), "-l", str(page), "-singlefile", "-r", "130", "-png", str(path), str(prefix)], check=True, capture_output=True)
        rendered.append({"role": role, "page": page, "path": f"tmp/pdfs/{prefix.name}.png"})
    return rendered


def select_current_pdf(root: Path, row: dict) -> tuple[Path, dict]:
    for document in row.get("attachmentDocuments", []):
        for download in document.get("downloads", []):
            if download.get("validPdfHeader"):
                return root / download["raw"]["path"], document["attachment"]
    raise RuntimeError(f"no valid current PDF for {row['etfCode']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=Path(__file__).resolve().parents[2])
    parser.add_argument("--pdfinfo")
    parser.add_argument("--pdftoppm")
    parser.add_argument("--output", default="data/reports/metadata-v2/dart-pdf-canary.json")
    parser.add_argument("--render-dir", default="tmp/pdfs")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output_path = root / args.output
    render_dir = root / args.render_dir
    render_dir.mkdir(parents=True, exist_ok=True)
    contract = json.loads((root / "data/reports/metadata-v2/dart-body-contract-canary.json").read_text(encoding="utf-8"))
    pdfinfo_exe = command_path(args.pdfinfo, "pdfinfo")
    pdftoppm_exe = command_path(args.pdftoppm, "pdftoppm")
    pdftotext_exe = shutil.which("pdftotext")
    tesseract_exe = shutil.which("tesseract")

    rows = []
    for source_row in contract["rows"]:
        path, attachment = select_current_pdf(root, source_row)
        plumber_pages = extract_pdfplumber(path)
        pypdf_pages = extract_pypdf(path)
        plumber_text = "\n".join(plumber_pages)
        pypdf_text = "\n".join(pypdf_pages)
        evidence = evidence_for_pages(plumber_pages)
        needs_ocr = min(len(normalize(plumber_text)), len(normalize(pypdf_text))) < 500 or agreement(plumber_text, pypdf_text) < PASS_CRITERIA["minimumExtractorAgreement"]
        render_roles = {"first": 1}
        for field, item in evidence.items():
            if item["selectedPage"] is not None:
                render_roles[field] = item["selectedPage"]
        rows.append({
            "etfCode": source_row["etfCode"],
            "receptionNo": attachment["rcpNo"],
            "dcmNo": attachment["dcmNo"],
            "raw": {"path": path.relative_to(root).as_posix(), "sha256": hash_file(path), "bytes": path.stat().st_size},
            "pdfinfo": pdfinfo(path, pdfinfo_exe),
            "extractors": {
                "pdftotext": {"available": bool(pdftotext_exe), "used": False, "reason": "binary unavailable in bundled/system Poppler" if not pdftotext_exe else "comparison deferred to avoid a third derived artifact"},
                "pdfplumber": {"available": True, "pages": len(plumber_pages), "textLength": len(normalize(plumber_text)), "nonEmptyPages": sum(bool(page) for page in plumber_pages)},
                "pypdf": {"available": True, "pages": len(pypdf_pages), "textLength": len(normalize(pypdf_text)), "nonEmptyPages": sum(bool(page) for page in pypdf_pages)},
                "agreement": agreement(plumber_text, pypdf_text),
            },
            "ocr": {"required": needs_ocr, "tesseractAvailable": bool(tesseract_exe), "performed": False},
            "evidence": evidence,
            "rendered": render_pages(path, source_row["etfCode"], render_roles, render_dir, pdftoppm_exe),
        })

    count = len(rows)
    rate = lambda predicate: round(sum(predicate(row) for row in rows) / count, 4)
    metrics = {
        "canaryCount": count,
        "validPdfRate": rate(lambda row: row["raw"]["bytes"] > 0 and row["pdfinfo"].get("pages", 0) > 0),
        "pdfplumberExtractionRate": rate(lambda row: row["extractors"]["pdfplumber"]["textLength"] >= 500),
        "pypdfExtractionRate": rate(lambda row: row["extractors"]["pypdf"]["textLength"] >= 500),
        "minimumExtractorAgreement": min(row["extractors"]["agreement"] for row in rows),
        "objectiveEvidenceRate": rate(lambda row: row["evidence"]["objective"]["found"]),
        "strategyEvidenceRate": rate(lambda row: row["evidence"]["strategy"]["found"]),
        "benchmarkEvidenceRate": rate(lambda row: row["evidence"]["benchmark"]["found"]),
        "distributionEvidenceRate": rate(lambda row: row["evidence"]["distribution"]["found"]),
        "ocrRequiredCount": sum(row["ocr"]["required"] for row in rows),
        "visualFalsePositiveCount": sum(
            row["evidence"][field]["found"] and not VISUAL_REVIEW[row["etfCode"]][field]
            for row in rows for field in FIELDS
        ),
        "visualFalseNegativeCount": sum(
            not row["evidence"][field]["found"] and VISUAL_REVIEW[row["etfCode"]][field]
            for row in rows for field in FIELDS
        ),
    }
    automated_pass = all((
        metrics["validPdfRate"] >= PASS_CRITERIA["validPdfRate"],
        metrics["pdfplumberExtractionRate"] >= PASS_CRITERIA["pdfplumberExtractionRate"],
        metrics["pypdfExtractionRate"] >= PASS_CRITERIA["pypdfExtractionRate"],
        metrics["minimumExtractorAgreement"] >= PASS_CRITERIA["minimumExtractorAgreement"],
        metrics["objectiveEvidenceRate"] >= PASS_CRITERIA["objectiveEvidenceRate"],
        metrics["strategyEvidenceRate"] >= PASS_CRITERIA["strategyEvidenceRate"],
    ))
    visual_pass = metrics["visualFalsePositiveCount"] == PASS_CRITERIA["visualFalsePositiveCount"] and metrics["visualFalseNegativeCount"] == 0
    report = {
        "schemaVersion": "1.0.0",
        "scope": "four existing official DART PDFs only; no network and no universe collection",
        "passCriteria": PASS_CRITERIA,
        "tooling": {"pdfinfo": bool(pdfinfo_exe), "pdftoppm": bool(pdftoppm_exe), "pdftotext": bool(pdftotext_exe), "pdfplumber": True, "pypdf": True, "tesseract": bool(tesseract_exe)},
        "metrics": metrics,
        "visualReview": {"method": "pdftoppm candidate-page PNG inspection", "expectedFieldPresence": VISUAL_REVIEW},
        "decision": "pass_pdf_parser_canary" if automated_pass and visual_pass else "fail_pdf_parser_canary",
        "rows": rows,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "metrics": metrics, "decision": report["decision"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
