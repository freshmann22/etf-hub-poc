#!/usr/bin/env python3
"""Conservative clause-level semantics for native-text DART prospectus pages.

The parser deliberately returns null instead of guessing.  It operates on full
page text and keeps the older 500-character discovery windows out of the
canonical extraction path.
"""

from __future__ import annotations

import re
from typing import Iterable


GLYPH_TRANSLATION = str.maketrans({
    "\uf09e": "\u2022",
    "\uf09f": "\u2022",
    "\uf0d8": "\u25b6",
    "\uf06c": "\u2022",
})

SECTION_BOUNDARY = re.compile(
    r"(?:^|\n)\s*(?:\[?\s*)?(?:\d+[.)]|[가-하][.)])?\s*"
    r"(?:투자전략|주요\s*투자위험|투자위험|투자비용|투자실적|운용전문인력|분류|보수|수수료)\b",
    re.I,
)
PERFORMANCE_BLOCK = re.compile(
    r"투자실적|연평균\s*수익률|수익률\s*변동성|비교지수\s*성과|최근\s*\d+년|"
    r"총보수|동종유형|판매수수료|1,?000만원",
    re.I,
)
RISK_BLOCK = re.compile(r"보장|손실|추적오차|괴리율|주요\s*투자위험|투자위험", re.I)


def normalize_page(text: str) -> str:
    """Normalize glyphs/spacing while retaining line boundaries."""
    translated = (text or "").translate(GLYPH_TRANSLATION).replace("\r\n", "\n").replace("\r", "\n")
    translated = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]+", " ", translated)
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in translated.split("\n")]
    return "\n".join(line for line in lines if line)


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip(" -•▶\t\n")


def balanced_parentheses(text: str) -> bool:
    depth = 0
    for character in text:
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def clean_description_block(text: str) -> str:
    # Table extraction occasionally injects left-column row labels into a
    # right-column definition.  Remove only verified standalone labels.
    kept = []
    for line in text.splitlines():
        value = compact(line)
        if not value or re.fullmatch(r"(?:투자목적|및\s*전략|\d{1,3})", value):
            continue
        kept.append(value)
    return compact(" ".join(kept))


def evidence(value: str, heading: str, page: int, rule: str, start: int, end: int) -> dict:
    clause = compact(value)
    return {
        "value": clause,
        "sectionHeading": heading,
        "snippet": clause,
        "sourceEntries": [f"pdf:p{page}"],
        "rule": rule,
        "pageCharacterRange": {"start": start, "end": end},
    }


def first_boundary(text: str, start: int, maximum: int) -> int:
    match = SECTION_BOUNDARY.search(text, start, min(len(text), maximum))
    return match.start() if match else min(len(text), maximum)


OBJECTIVE_HEADING = re.compile(
    r"(?:^|\n)\s*(?:\[\s*)?(?:1\s*[.)]|1\)|[-•▶])?\s*투자\s*목적\s*(?:\])?\s*",
    re.I,
)
OBJECTIVE_SUBJECT = re.compile(r"(?:[-•▶]\s*)?이\s*(?:투자신탁\s*은|집합투자기구\s*는)\b", re.I)
OBJECTIVE_END = re.compile(
    r"(?:운용함을|운용하는\s*것을|운용하는\s*데)\s*(?:그\s*)?(?:투자\s*)?목적으로\s*합니다[.]?|"
    r"(?:초과성과|성과|수익률)[^.!?\n]{0,50}?목표로\s*합니다[.]?",
    re.I,
)
OBJECTIVE_TARGET = re.compile(
    r"주식|채권|집합투자증권|부동산|리츠|REIT|원자재|선물|지수|투자대상자산|순자산가치|ETF",
    re.I,
)


def parse_investment_objective(text: str, page: int) -> dict | None:
    for heading in OBJECTIVE_HEADING.finditer(text):
        heading_line_end = text.find("\n", heading.end())
        if heading_line_end < 0:
            heading_line_end = heading.end()
        heading_line = text[heading.start():heading_line_end]
        if "투자전략" in heading_line:
            continue
        search_end = first_boundary(text, heading.end(), heading.end() + 470)
        subject = OBJECTIVE_SUBJECT.search(text, heading.end(), search_end)
        if not subject:
            continue
        gap = compact(text[heading.end():subject.start()])
        if len(gap) > 40 or SECTION_BOUNDARY.search(text, heading.end(), subject.start()):
            continue
        terminal = OBJECTIVE_END.search(text, subject.start(), search_end)
        if not terminal:
            continue
        clause = compact(text[subject.start():terminal.end()])
        if not 35 <= len(clause) <= 430:
            continue
        if not OBJECTIVE_TARGET.search(clause) or RISK_BLOCK.search(clause):
            continue
        return evidence(clause, "투자목적", page, "explicit_investment_objective_clause", subject.start(), terminal.end())
    return None


BENCHMARK_NAME_LINE = re.compile(
    r"(추적대상지수\s*(?:\(\s*기초지수\s*\))?|추적대상지수|기초지수|비교지수|참고지수)\s*[:：]\s*(.+)",
    re.I,
)
BENCHMARK_NAME_STOP = re.compile(
    r"\s+(?:산출기관|지수개요|지수소개|산출방법|산출방식|시장상황|분류|투자전략|투자실적|수익률|보수)\b",
    re.I,
)


def parse_benchmark_name(text: str, page: int) -> dict | None:
    for line_offset, line in _lines_with_offsets(text):
        match = BENCHMARK_NAME_LINE.search(line)
        if not match:
            continue
        value = BENCHMARK_NAME_STOP.split(match.group(2), 1)[0]
        value = re.sub(r"\s*(?:[*×x]\s*100\s*%|\(\s*주\s*\d+\s*\)|[*×x])\s*$", "", value, flags=re.I)
        value = compact(value)
        if not 2 <= len(value) <= 180 or not balanced_parentheses(value) or not re.search(r"지수|Index|인덱스", value, re.I):
            continue
        start = line_offset + match.start(2)
        return evidence(value, compact(match.group(1)), page, "explicit_benchmark_name_label", start, start + len(value))
    return None


DESCRIPTION_HEADING = re.compile(
    r"(?:지\s*수\s*소\s*개|지\s*수\s*개\s*요|추적대상지수\s*\(\s*기초지수\s*\)\s*의\s*개요)\s*[:：]?",
    re.I,
)
DESCRIPTION_SIGNAL = re.compile(
    r"산출|발표|구성|유니버스|편입|선정|가중|정기변경|리밸런싱|기준일|하위지수|종목",
    re.I,
)
DESCRIPTION_STOP = re.compile(
    r"(?:^|\n)\s*(?:시장상황|투자전략|분류|투자위험|주요\s*투자위험|보수|수수료|투자실적|연평균\s*수익률|수익률\s*변동성)\b",
    re.I,
)
NOTICE_ONLY = re.compile(r"산출\s*(?:방법|방식)[^.!?\n]{0,50}(?:변경|중단)될?\s*수|정상적으로\s*산출할\s*수\s*없", re.I)


def parse_benchmark_description(text: str, page: int) -> dict | None:
    for anchor in DESCRIPTION_HEADING.finditer(text):
        start = anchor.end()
        end = min(len(text), start + 700)
        stop = DESCRIPTION_STOP.search(text, start, end)
        if stop:
            end = stop.start()
        block = text[start:end]
        perf = PERFORMANCE_BLOCK.search(block)
        if perf:
            block = block[:perf.start()]
            end = start + perf.start()
        clause = clean_description_block(block)
        if not 35 <= len(clause) <= 650:
            continue
        if not re.search(r"지수|Index|인덱스", clause, re.I) or not DESCRIPTION_SIGNAL.search(clause):
            continue
        if NOTICE_ONLY.search(clause) and not re.search(r"구성|유니버스|편입|선정|가중|하위지수|종목", clause, re.I):
            continue
        return evidence(clause, compact(anchor.group(0)), page, "explicit_benchmark_definition_section", start, end)

    inline = re.compile(r"(?:기초|비교|참고|추적대상)지수는\s+[^.!?\n]{20,580}?(?:산출|구성|선정|가중)[^.!?\n]{0,300}?[.!?]", re.I)
    for match in inline.finditer(text):
        clause = compact(match.group(0))
        if PERFORMANCE_BLOCK.search(clause) or NOTICE_ONLY.search(clause) or not DESCRIPTION_SIGNAL.search(clause):
            continue
        return evidence(clause, "기초지수 정의", page, "explicit_inline_benchmark_definition", match.start(), match.end())
    return None


SCHEDULE_CORE = re.compile(
    r"매월\s*(?:마지막|최종)\s*영업일(?:\s*및\s*회계기간\s*종료일)?|"
    r"매월\s*\d{1,2}\s*일(?:\s*및\s*회계기간\s*종료일)?|"
    r"(?:매년\s*)?(?:1|4|7|10)\s*월(?:\s*,\s*(?:1|4|7|10)\s*월){1,3}\s*(?:마지막\s*)?영업일|"
    r"회계기간\s*종료일",
    re.I,
)
PAYOUT_OFFSET = re.compile(r"(?:지급기준일\s*)?(?:익일|익영업일)(?:로부터|부터)?\s*\d+\s*영업일\s*이내", re.I)
NON_BUSINESS = re.compile(r"(?:영업일|거래소\s*영업일)이\s*아닌\s*경우\s*(?:그\s*)?직전\s*영업일|비영업일이면\s*직전\s*영업일", re.I)
DIST_ANCHOR = re.compile(r"분배에\s*관한\s*사항|분배\s*주기|지급기준일|분배기준일|지급시기", re.I)


def parse_distribution(text: str, page: int) -> tuple[dict | None, dict | None]:
    schedule = None
    frequency = None
    for core in SCHEDULE_CORE.finditer(text):
        context_start = max(0, core.start() - 120)
        context_end = min(len(text), core.end() + 240)
        context = text[context_start:context_end]
        if not DIST_ANCHOR.search(context):
            continue
        pieces = [compact(core.group(0))]
        non_business = NON_BUSINESS.search(context)
        payout = PAYOUT_OFFSET.search(context)
        if non_business:
            pieces[0] += f"({compact(non_business.group(0))})"
        if payout:
            pieces.append(compact(payout.group(0)))
        value = "; ".join(dict.fromkeys(pieces))
        schedule = evidence(value, "분배에 관한 사항", page, "structured_distribution_schedule", core.start(), core.end())
        if re.search(r"매월", core.group(0)):
            frequency = evidence("monthly", "분배주기", page, "frequency_from_distribution_schedule", core.start(), core.end())
        break

    explicit_frequencies = (
        ("monthly", re.compile(r"분배\s*주기\s*[:：]?\s*(?:매\s*월|월\s*1\s*회)|월\s*1\s*회", re.I)),
        ("quarterly", re.compile(r"분배\s*주기\s*[:：]?\s*(?:분기\s*1\s*회|매\s*분기)", re.I)),
        ("semiannual", re.compile(r"분배\s*주기\s*[:：]?\s*(?:반기\s*1\s*회|연\s*2\s*회)", re.I)),
        ("annual", re.compile(r"분배\s*주기\s*[:：]?\s*(?:연\s*1\s*회|매\s*년)", re.I)),
    )
    if frequency is None:
        for token, pattern in explicit_frequencies:
            match = pattern.search(text)
            if match:
                frequency = evidence(token, "분배주기", page, "explicit_distribution_frequency", match.start(), match.end())
                break
    if frequency is None:
        policy = re.search(r"(?:매월\s*분배금을\s*(?:지급하는\s*구조|지급함을\s*(?:목적|목표))|월분배\s*상품)", text, re.I)
        if policy:
            frequency = evidence("monthly", "분배정책", page, "explicit_monthly_distribution_policy", policy.start(), policy.end())
    return schedule, frequency


def _lines_with_offsets(text: str) -> Iterable[tuple[int, str]]:
    offset = 0
    for line in text.splitlines(keepends=True):
        yield offset, line.rstrip("\n")
        offset += len(line)


def parse_semantic_fields(pages: list[str]) -> dict:
    """Return conservative field evidence plus page-level diagnostics."""
    fields = {
        "investmentObjective": None,
        "benchmarkName": None,
        "benchmarkDescription": None,
        "distributionSchedule": None,
        "distributionFrequency": None,
    }
    candidate_pages = {key: [] for key in fields}
    for page_number, raw_page in enumerate(pages, 1):
        text = normalize_page(raw_page)
        if not text:
            continue
        candidates = {
            "investmentObjective": parse_investment_objective(text, page_number),
            "benchmarkName": parse_benchmark_name(text, page_number),
            "benchmarkDescription": parse_benchmark_description(text, page_number),
        }
        schedule, frequency = parse_distribution(text, page_number)
        candidates["distributionSchedule"] = schedule
        candidates["distributionFrequency"] = frequency
        for key, candidate in candidates.items():
            if candidate:
                candidate_pages[key].append(page_number)
                if fields[key] is None:
                    fields[key] = candidate
    return {
        "fields": fields,
        "diagnostics": {
            "parserVersion": "dart-pdf-semantic-1.0.0",
            "inputPageCount": len(pages),
            "candidatePages": candidate_pages,
            "fieldCount": sum(value is not None for value in fields.values()),
            "policy": "strict_clause_only_null_without_explicit_evidence",
        },
    }
