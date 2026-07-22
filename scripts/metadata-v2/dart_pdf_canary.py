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
    "objective": [r"(?:^|\s)1\.\s*투자\s*목적", r"(?:^|\s)투자\s*목적\s*및(?=\s*(?:를|이\s*투자신탁|신탁\s*재산|$))", r"투자\s*목적\s*및\s*투자\s*전략"],
    "strategy": [r"(?:^|\s)2\.\s*투자\s*전략", r"(?:^|\s)투자\s*전략(?=\s*(?:함|이\s*투자신탁|신탁\s*재산|$))", r"투자\s*목적\s*및\s*투자\s*전략"],
    "benchmark": [r"※\s*(?:기초|비교|참고)\s*지수\s*[:：]", r"(?:기초|비교|참고)\s*지수\s*[:：]", r".{2,80}지수.{0,20}(?:를|을)\s*기초\s*지수로"],
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
    "ocrPolicy": "required only when neither native-text extractor passes length, page coverage, token-content, diversity, replacement-glyph, control-character, and mojibake guards; low order-sensitive agreement is a review warning",
}

MIN_NATIVE_TEXT_LENGTH = 500
MIN_PAGE_TEXT_LENGTH = 50
MIN_PAGE_COVERAGE = 0.80
MIN_TOKEN_CONTENT_RATIO = 0.50
MIN_UNIQUE_ALPHANUMERIC_CHARACTERS = 10
MIN_UNIQUE_TOKENS = 20
MIN_UNIQUE_TOKEN_RATIO = 0.01
MAX_REPLACEMENT_GLYPH_RATIO = 0.01
MAX_CONTROL_CHARACTER_RATIO = 0.30
MAX_MOJIBAKE_SIGNAL_RATIO = 0.10
LOCAL_CONTEXT_BEFORE = 260
LOCAL_CONTEXT_AFTER = 340

# Some DART PDFs expose Wingdings/Symbol list markers through Private Use
# Area code points. Translate only the glyphs observed and verified as list
# markers; unknown private-use characters must remain visible to hygiene gates.
PDF_GLYPH_TRANSLATION = str.maketrans({
    "\uf09e": "\u2022",
    "\uf09f": "\u2022",
    "\uf0d8": "\u25b6",
    "\uf06c": "\u2022",
})

RISK_DISCLAIMER_PATTERNS = (
    r"투자\s*전략에\s*따른\s*투자\s*목적",
    r"(?:투자\s*목적|성과\s*목표).{0,100}(?:실현|보장).{0,50}(?:없|아니)",
    r"(?:주요\s*투자\s*위험|투자\s*위험의\s*주요\s*내용)",
)

SUBSTANTIVE_PATTERNS = {
    "objective": (r"목표로\s*운용", r"운용함을\s*목적", r"초과\s*성과를\s*달성", r"투자할\s*계획"),
    "strategy": (r"투자할\s*계획", r"투자\s*대상", r"비교\s*지수.{0,100}초과", r"신탁\s*재산"),
    "benchmark": (r"※\s*(?:기초|비교|참고)\s*지수\s*[:：]", r"(?:기초|비교|참고)\s*지수\s*[:：]"),
    "distribution": (r"분배금\s*지급\s*기준일", r"매월.{0,30}분배금", r"이익\s*분배금"),
}


def normalize(text: str) -> str:
    translated = (text or "").translate(PDF_GLYPH_TRANSLATION)
    translated = re.sub(r"\s*([\u2022\u25b6])\s*", r" \1 ", translated)
    without_controls = re.sub(r"[\x00-\x1f\x7f]+", " ", translated)
    return re.sub(r"\s+", " ", without_controls).strip()


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_pdfplumber(path: Path) -> list[str]:
    with pdfplumber.open(path) as pdf:
        return [page.extract_text() or "" for page in pdf.pages]


def extract_pypdf(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    return [page.extract_text() or "" for page in reader.pages]


def agreement(left: str, right: str) -> float:
    compact_left = re.sub(r"\s+", "", normalize(left))
    compact_right = re.sub(r"\s+", "", normalize(right))
    return round(SequenceMatcher(None, compact_left, compact_right, autojunk=False).ratio(), 4)


def native_text_quality(pages: list[str]) -> dict:
    raw_text = "\n".join(pages)
    normalized_pages = [normalize(page) for page in pages]
    text = " ".join(page for page in normalized_pages if page)
    compact = re.sub(r"\s+", "", text)
    alphanumeric_characters = [character.lower() for character in compact if character.isalnum()]
    tokens = [token.lower() for token in re.findall(r"[0-9A-Za-z가-힣]+", text)]
    unique_alphanumeric_count = len(set(alphanumeric_characters))
    unique_token_count = len(set(tokens))
    unique_token_ratio = round(unique_token_count / len(tokens), 4) if tokens else 0.0
    token_count = len(alphanumeric_characters)
    page_count = len(normalized_pages)
    non_empty_pages = sum(len(page) >= MIN_PAGE_TEXT_LENGTH for page in normalized_pages)
    page_coverage = round(non_empty_pages / page_count, 4) if page_count else 0.0
    token_content_ratio = round(token_count / len(compact), 4) if compact else 0.0
    text_length = len(normalize(text))
    raw_length = len(raw_text)
    replacement_glyph_count = raw_text.count("\ufffd")
    control_character_count = sum(ord(character) < 32 and character not in "\t\r\n" for character in raw_text)
    private_use_count = sum(0xE000 <= ord(character) <= 0xF8FF for character in raw_text)
    unexpected_cjk_count = sum(0x3400 <= ord(character) <= 0x9FFF for character in raw_text)
    replacement_glyph_ratio = round(replacement_glyph_count / raw_length, 4) if raw_length else 0.0
    control_character_ratio = round(control_character_count / raw_length, 4) if raw_length else 0.0
    mojibake_signal_ratio = round((replacement_glyph_count + private_use_count + unexpected_cjk_count) / raw_length, 4) if raw_length else 0.0
    usable = (
        text_length >= MIN_NATIVE_TEXT_LENGTH
        and page_coverage >= MIN_PAGE_COVERAGE
        and token_content_ratio >= MIN_TOKEN_CONTENT_RATIO
        and unique_alphanumeric_count >= MIN_UNIQUE_ALPHANUMERIC_CHARACTERS
        and unique_token_count >= MIN_UNIQUE_TOKENS
        and unique_token_ratio >= MIN_UNIQUE_TOKEN_RATIO
        and replacement_glyph_ratio <= MAX_REPLACEMENT_GLYPH_RATIO
        and control_character_ratio <= MAX_CONTROL_CHARACTER_RATIO
        and mojibake_signal_ratio <= MAX_MOJIBAKE_SIGNAL_RATIO
    )
    return {
        "textLength": text_length,
        "pageCount": page_count,
        "nonEmptyPages": non_empty_pages,
        "pageCoverage": page_coverage,
        "tokenContentRatio": token_content_ratio,
        "uniqueAlphanumericCharacterCount": unique_alphanumeric_count,
        "tokenCount": len(tokens),
        "uniqueTokenCount": unique_token_count,
        "uniqueTokenRatio": unique_token_ratio,
        "replacementGlyphCount": replacement_glyph_count,
        "replacementGlyphRatio": replacement_glyph_ratio,
        "controlCharacterCount": control_character_count,
        "controlCharacterRatio": control_character_ratio,
        "privateUseCharacterCount": private_use_count,
        "unexpectedCjkCharacterCount": unexpected_cjk_count,
        "mojibakeSignalRatio": mojibake_signal_ratio,
        "usableNativeText": usable,
    }


def assess_extraction_quality(plumber_pages: list[str], pypdf_pages: list[str]) -> dict:
    plumber = native_text_quality(plumber_pages)
    pypdf = native_text_quality(pypdf_pages)
    extractor_agreement = agreement("\n".join(plumber_pages), "\n".join(pypdf_pages))
    native_text_usable = plumber["usableNativeText"] or pypdf["usableNativeText"]
    layout_disagreement = native_text_usable and extractor_agreement < PASS_CRITERIA["minimumExtractorAgreement"]
    review_reasons = []
    if layout_disagreement:
        review_reasons.append("layout_order_disagreement")
    if not native_text_usable:
        review_reasons.append("native_text_unusable_requires_ocr")
    return {
        "pdfplumber": plumber,
        "pypdf": pypdf,
        "agreement": extractor_agreement,
        "nativeTextUsable": native_text_usable,
        "ocrRequired": not native_text_usable,
        "layoutOrderDisagreement": layout_disagreement,
        "reviewRequired": bool(review_reasons),
        "reviewReasons": review_reasons,
    }


def local_context(text: str, match: re.Match) -> str:
    return text[max(0, match.start() - LOCAL_CONTEXT_BEFORE) : match.end() + LOCAL_CONTEXT_AFTER]


def is_safe_evidence_context(field: str, context: str, explicit_heading: bool) -> bool:
    if field in ("objective", "strategy") and re.search(r"운용\s*전문\s*인력|책임\s*운용", context, re.I | re.S) and not explicit_heading:
        return False
    risk_disclaimer = any(re.search(pattern, context, re.I | re.S) for pattern in RISK_DISCLAIMER_PATTERNS)
    substantive = any(re.search(pattern, context, re.I | re.S) for pattern in SUBSTANTIVE_PATTERNS[field])
    return not risk_disclaimer or (explicit_heading and substantive)


def evidence_for_pages(pages: list[str]) -> dict[str, dict]:
    output = {}
    for field, patterns in FIELDS.items():
        scored = []
        for page_number, raw_text in enumerate(pages, 1):
            text = normalize(raw_text)
            heading_matches = [(pattern, match) for pattern in HEADING_ANCHORS[field] for match in re.finditer(pattern, text, re.I | re.S)]
            candidates = []
            for pattern in patterns:
                for match in re.finditer(pattern, text, re.I | re.S):
                    nearby_headings = [
                        (heading_pattern, heading_match)
                        for heading_pattern, heading_match in heading_matches
                        if abs(heading_match.start() - match.start()) <= LOCAL_CONTEXT_BEFORE + LOCAL_CONTEXT_AFTER
                    ]
                    explicit_heading = bool(nearby_headings)
                    context = local_context(text, match)
                    if is_safe_evidence_context(field, context, explicit_heading):
                        candidates.append((pattern, match, context, nearby_headings))
            if not candidates:
                continue
            best_pattern, best_match, best_context, nearby_headings = max(
                candidates,
                key=lambda item: (
                    100 if item[3] else 0,
                    sum(bool(re.search(pattern, item[2], re.I | re.S)) for pattern in SUBSTANTIVE_PATTERNS[field]),
                    -item[1].start(),
                ),
            )
            hits = len(candidates)
            detail_bonus = sum(bool(re.search(pattern, best_context, re.I | re.S)) for pattern in SUBSTANTIVE_PATTERNS[field])
            heading_bonus = 100 if nearby_headings else 0
            if field == "benchmark" and nearby_headings:
                heading_bonus += 300
            anchor = min(nearby_headings, key=lambda item: abs(item[1].start() - best_match.start())) if nearby_headings else (best_pattern, best_match)
            scored.append((hits * 10 + detail_bonus + heading_bonus, page_number, text, anchor))
        if not scored:
            output[field] = {"found": False, "candidatePages": [], "selectedPage": None, "snippet": None}
            continue
        scored.sort(key=lambda row: (-row[0], row[1]))
        _, selected_page, selected_text, (anchor_pattern, anchor_match) = scored[0]
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
        quality = assess_extraction_quality(plumber_pages, pypdf_pages)
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
                "pdfplumber": {"available": True, **quality["pdfplumber"]},
                "pypdf": {"available": True, **quality["pypdf"]},
                "agreement": quality["agreement"],
            },
            "ocr": {"required": quality["ocrRequired"], "tesseractAvailable": bool(tesseract_exe), "performed": False},
            "review": {
                "required": quality["reviewRequired"],
                "reasons": quality["reviewReasons"],
                "layoutOrderDisagreement": quality["layoutOrderDisagreement"],
            },
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
