#!/usr/bin/env python3
"""Extract the completed append-only DART PDF batch without network or raw writes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SCOPE = "dart_pdf_full_batch"
SOURCE_LEDGER = "data/raw/metadata-v2/dart-pdf-batch/ledger.jsonl"
RAW_PREFIX = "data/raw/metadata-v2/dart-pdf-batch/"
DEFAULT_INDEX = "data/reports/metadata-v2/dart-disclosure-index.json"
DEFAULT_OUTPUT = "data/reports/metadata-v2/dart-pdf-batch-extraction.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_latest_ledger(path: Path) -> tuple[dict[str, dict], int, int]:
    latest: dict[str, dict] = {}
    valid_lines = 0
    malformed_lines = 0
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            malformed_lines += 1
            continue
        key = row.get("universeKey")
        if not isinstance(key, str) or not re.fullmatch(r"[0-9A-Z]{6}", key):
            raise RuntimeError(f"invalid universeKey on ledger line {line_number}")
        latest[key] = row
        valid_lines += 1
    return latest, valid_lines, malformed_lines


def validated_pdf(root: Path, row: dict) -> tuple[Path, dict]:
    raw = row.get("raw", {}).get("pdf")
    if not isinstance(raw, dict):
        raise RuntimeError(f"{row['universeKey']}: successful ledger row has no raw PDF")
    stored_path = raw.get("path")
    if not isinstance(stored_path, str) or not stored_path.startswith(RAW_PREFIX) or not stored_path.lower().endswith(".pdf"):
        raise RuntimeError(f"{row['universeKey']}: PDF path is outside the DART batch")
    path = (root / stored_path).resolve()
    batch_root = (root / RAW_PREFIX).resolve()
    key_root = (batch_root / row["universeKey"]).resolve()
    if batch_root not in path.parents or key_root not in path.parents:
        raise RuntimeError(f"{row['universeKey']}: resolved PDF path escapes the DART batch")
    if not path.is_file():
        raise RuntimeError(f"{row['universeKey']}: missing or invalid PDF")
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise RuntimeError(f"{row['universeKey']}: missing or invalid PDF")
    size = path.stat().st_size
    if raw.get("bytes") != size:
        raise RuntimeError(f"{row['universeKey']}: PDF byte count mismatch")
    digest = sha256_file(path)
    if raw.get("sha256") != digest:
        raise RuntimeError(f"{row['universeKey']}: PDF hash mismatch")
    return path, raw


def extracted_value(item: dict, heading: str) -> dict | None:
    if not item.get("found") or not item.get("snippet"):
        return None
    selected_page = item.get("selectedPage")
    source_entries = [f"pdf:p{selected_page}"] if isinstance(selected_page, int) and selected_page > 0 else []
    return {
        "value": item["snippet"],
        "sectionHeading": heading,
        "snippet": item["snippet"],
        "sourceEntries": source_entries,
    }


def extract_row(root: Path, ledger_row: dict, index_row: dict) -> dict:
    try:
        from dart_pdf_canary import assess_extraction_quality, evidence_for_pages, extract_pdfplumber, extract_pypdf, normalize
        from dart_pdf_semantic import parse_semantic_fields
    except ModuleNotFoundError as error:
        if error.name in {"pdfplumber", "pypdf"}:
            raise RuntimeError(
                "DART PDF extraction requires pdfplumber and pypdf in the selected Python runtime"
            ) from error
        raise
    path, raw = validated_pdf(root, ledger_row)
    plumber_pages = extract_pdfplumber(path)
    pypdf_pages = extract_pypdf(path)
    quality = assess_extraction_quality(plumber_pages, pypdf_pages)
    evidence = evidence_for_pages(plumber_pages)
    semantic = parse_semantic_fields(plumber_pages)
    name = ledger_row.get("officialName") or index_row.get("officialName") or ""
    compact_name = re.sub(r"\s+", "", name).lower()
    official_name = None
    if compact_name:
        for page_number, page_text in enumerate(plumber_pages, 1):
            if compact_name in re.sub(r"\s+", "", normalize(page_text)).lower():
                official_name = {
                    "value": name,
                    "sectionHeading": "공식 펀드명",
                    "snippet": name,
                    "sourceEntries": [f"pdf:p{page_number}"],
                }
                break
    fields = {
        "officialName": official_name,
        "issuer": None,
        "productDescription": extracted_value(evidence["strategy"], "투자 전략"),
        "investmentObjective": extracted_value(evidence["objective"], "투자 목적"),
        "benchmarkName": None,
        "benchmarkDescription": extracted_value(evidence["benchmark"], "기초 지수"),
        "flags": {
            # The display name belongs to the ledger/index, not to the PDF
            # extraction. Do not emit name-derived facts with PDF provenance.
            "derivative": None,
            "leveraged": None,
            "inverse": None,
            "synthetic": None,
            "currencyHedged": None,
        },
        "distributionPolicy": extracted_value(evidence["distribution"], "분배 정책"),
    }
    return {
        "etfCode": ledger_row.get("shortCode") or ledger_row["universeKey"],
        "universeKey": ledger_row["universeKey"],
        "receptionNo": ledger_row.get("receptionNo"),
        "receptionDate": index_row.get("match", {}).get("receptionDate"),
        "source": {
            "sourceId": "opendart_pdf_batch",
            "viewerUrl": raw.get("url") or index_row.get("match", {}).get("viewerUrl"),
            "rawSha256": raw["sha256"],
            "rawSnapshotPath": raw["path"],
            "rawMediaType": "application/pdf",
        },
        "extraction": {
            "parserStatus": "pending_ocr" if quality["ocrRequired"] else "parsed",
            "diagnostics": {
                "coverOnly": False,
                "pdfplumberTextLength": quality["pdfplumber"]["textLength"],
                "pypdfTextLength": quality["pypdf"]["textLength"],
                "pdfplumberPageCoverage": quality["pdfplumber"]["pageCoverage"],
                "pypdfPageCoverage": quality["pypdf"]["pageCoverage"],
                "pdfplumberTokenContentRatio": quality["pdfplumber"]["tokenContentRatio"],
                "pypdfTokenContentRatio": quality["pypdf"]["tokenContentRatio"],
                "pdfplumberUniqueAlphanumericCharacterCount": quality["pdfplumber"]["uniqueAlphanumericCharacterCount"],
                "pypdfUniqueAlphanumericCharacterCount": quality["pypdf"]["uniqueAlphanumericCharacterCount"],
                "pdfplumberUniqueTokenCount": quality["pdfplumber"]["uniqueTokenCount"],
                "pypdfUniqueTokenCount": quality["pypdf"]["uniqueTokenCount"],
                "pdfplumberUniqueTokenRatio": quality["pdfplumber"]["uniqueTokenRatio"],
                "pypdfUniqueTokenRatio": quality["pypdf"]["uniqueTokenRatio"],
                "pdfplumberReplacementGlyphRatio": quality["pdfplumber"]["replacementGlyphRatio"],
                "pypdfReplacementGlyphRatio": quality["pypdf"]["replacementGlyphRatio"],
                "pdfplumberControlCharacterRatio": quality["pdfplumber"]["controlCharacterRatio"],
                "pypdfControlCharacterRatio": quality["pypdf"]["controlCharacterRatio"],
                "pdfplumberMojibakeSignalRatio": quality["pdfplumber"]["mojibakeSignalRatio"],
                "pypdfMojibakeSignalRatio": quality["pypdf"]["mojibakeSignalRatio"],
                "extractorAgreement": quality["agreement"],
                "nativeTextUsable": quality["nativeTextUsable"],
                "ocrRequired": quality["ocrRequired"],
                "layoutOrderDisagreement": quality["layoutOrderDisagreement"],
                "reviewRequired": quality["reviewRequired"],
                "reviewReasons": quality["reviewReasons"],
            },
            "fields": fields,
            # Clause-level candidates are isolated from the legacy discovery
            # windows above.  The converter consumes only this strict contract.
            "semanticFields": {
                key: value for key, value in semantic["fields"].items()
                if value is not None
            },
            "semanticDiagnostics": semantic["diagnostics"],
        },
    }


def extract_row_task(arguments: tuple[Path, dict, dict]) -> dict:
    """Pickle-friendly process-pool adapter for independent PDFs."""
    try:
        return extract_row(*arguments)
    except Exception as error:
        code = arguments[1].get("universeKey", "unknown")
        raise RuntimeError(f"{code}: extraction failed: {error}") from error


def repository_path(root: Path, path: Path, label: str) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError as error:
        raise RuntimeError(f"{label} must be inside the repository root") from error


def confined_report_output(root: Path, path: Path) -> Path:
    resolved = path.resolve()
    report_root = (root / "data/reports/metadata-v2").resolve()
    try:
        relation = resolved.relative_to(report_root)
    except ValueError as error:
        raise RuntimeError("output must be inside data/reports/metadata-v2") from error
    if not relation.parts or resolved.suffix.lower() != ".json":
        raise RuntimeError("output must be a JSON file inside data/reports/metadata-v2")
    return resolved


def validate_ledger_index_lineage(latest: dict[str, dict], index_rows: dict[str, dict]) -> None:
    for key in sorted(latest):
        ledger_row = latest[key]
        index_row = index_rows[key]
        match = index_row.get("match") or {}
        ledger_code = ledger_row.get("shortCode")
        index_code = index_row.get("shortCode")
        ledger_reception = ledger_row.get("receptionNo")
        index_reception = match.get("receptionNo")
        reception_date = match.get("receptionDate")
        if ledger_code != index_code or ledger_code != key:
            raise RuntimeError(f"{key}: ledger/index shortCode lineage mismatch")
        if ledger_reception != index_reception:
            raise RuntimeError(f"{key}: ledger/index receptionNo lineage mismatch")
        if not isinstance(reception_date, str) or not re.fullmatch(r"\d{8}", reception_date):
            raise RuntimeError(f"{key}: index receptionDate is invalid")
        if not isinstance(ledger_reception, str) or not ledger_reception.startswith(reception_date):
            raise RuntimeError(f"{key}: receptionNo/date lineage mismatch")
        main_url = ledger_row.get("raw", {}).get("main", {}).get("url")
        viewer_url = match.get("viewerUrl")
        if main_url != viewer_url:
            raise RuntimeError(f"{key}: ledger/index viewer URL lineage mismatch")
        attachment = ledger_row.get("attachment") or {}
        attachment_rcp = attachment.get("rcpNo")
        dcm_no = attachment.get("dcmNo")
        pdf_url = ledger_row.get("raw", {}).get("pdf", {}).get("url")
        pdf_query = parse_qs(urlparse(pdf_url or "").query)
        if attachment_rcp != ledger_reception or not isinstance(dcm_no, str) or not dcm_no:
            raise RuntimeError(f"{key}: attachment/reception lineage mismatch")
        if pdf_query.get("dcmNo") != [dcm_no]:
            raise RuntimeError(f"{key}: PDF/attachment URL lineage mismatch")


def build_report(root: Path, ledger_path: Path, index_path: Path, expected_target_count: int, workers: int = 1) -> dict:
    latest, valid_lines, malformed_lines = read_latest_ledger(ledger_path)
    if malformed_lines:
        raise RuntimeError(f"DART ledger contains {malformed_lines} malformed line(s)")
    if len(latest) != expected_target_count:
        raise RuntimeError(f"DART latest ledger count must be {expected_target_count}; got {len(latest)}")
    non_ok = sorted(key for key, row in latest.items() if row.get("status") != "ok")
    if non_ok:
        raise RuntimeError(f"DART full batch is incomplete; non-ok latest rows: {', '.join(non_ok[:10])}")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    mapped_rows = [row for row in index.get("rows", []) if row.get("status") == "mapped"]
    index_rows = {row["universeKey"]: row for row in mapped_rows}
    if len(index_rows) != len(mapped_rows):
        raise RuntimeError("DART mapped index contains duplicate universeKey values")
    if len(index_rows) != expected_target_count:
        raise RuntimeError(f"DART mapped index count must be {expected_target_count}; got {len(index_rows)}")
    if set(latest) != set(index_rows):
        raise RuntimeError("DART latest ledger keys do not exactly match the mapped disclosure index")
    validate_ledger_index_lineage(latest, index_rows)
    tasks = [(root, latest[key], index_rows[key]) for key in sorted(latest)]
    if workers < 1 or workers > 8:
        raise RuntimeError("workers must be between 1 and 8")
    if workers == 1:
        rows = [extract_row_task(task) for task in tasks]
    else:
        executor = ProcessPoolExecutor(max_workers=workers)
        try:
            future_keys = {
                executor.submit(extract_row_task, task): task[1]["universeKey"]
                for task in tasks
            }
            rows_by_key = {}
            for future in as_completed(future_keys):
                key = future_keys[future]
                rows_by_key[key] = future.result()
        except Exception:
            for future in future_keys:
                future.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
            raise
        else:
            executor.shutdown(wait=True)
        # Completion order is nondeterministic; serialized report order is not.
        rows = [rows_by_key[key] for key in sorted(latest)]
    parsed_count = sum(row["extraction"]["parserStatus"] == "parsed" for row in rows)
    pending_ocr_count = len(rows) - parsed_count
    return {
        "schemaVersion": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "extractionContract": {
            "scope": SCOPE,
            "sourceLedger": repository_path(root, ledger_path, "source ledger"),
            "sourceIndex": repository_path(root, index_path, "source index"),
            "expectedTargetCount": expected_target_count,
            "latestLedgerRowCount": len(latest),
            "successfulPdfCount": len(rows),
            "inputRowCount": len(rows),
            "complete": True,
            "ledgerValidLineCount": valid_lines,
            "ledgerMalformedLineCount": malformed_lines,
            "networkRequests": 0,
            "rawMutation": False,
            "missingValuePolicy": "null_without_explicit_pdf_evidence",
        },
        "metrics": {"parsedCount": parsed_count, "pendingOcrCount": pending_ocr_count},
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=Path(__file__).resolve().parents[2])
    parser.add_argument("--ledger", default=SOURCE_LEDGER)
    parser.add_argument("--index", default=DEFAULT_INDEX)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--expected-target-count", type=int, default=911)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    report = build_report(root, root / args.ledger, root / args.index, args.expected_target_count, args.workers)
    output = confined_report_output(root, root / args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({"output": str(output), "metrics": report["metrics"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"[metadata-v2:extract-dart] {error}", file=sys.stderr)
        raise SystemExit(1) from error
