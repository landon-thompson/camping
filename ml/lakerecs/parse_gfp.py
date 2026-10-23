"""SD GFP Fishery Reports: report lists and survey PDFs.

Ports, rule for rule:
* ``parseReportLinks``, ``pickSurvey``, ``waterNameVariants`` (api/src/lib/sdFishReports.ts)
* ``pdfLines`` (src/features/fishing/sdPdf.ts) on top of pdfplumber instead of pdf.js
* ``parseSurvey`` (src/features/fishing/sdParse.ts): species list, gear families,
  table rows, summary-sentence fallback.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date

from .species import SD_SPECIES

# ------------------------------------------------------------------ report list (sdFishReports.ts)


@dataclass
class ReportLink:
    id: str
    text: str


def _strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]*>", " ", s)
    s = s.replace("&nbsp;", " ").replace("&amp;", "&")
    s = re.sub(r"&#39;|&apos;", "'", s).replace("&quot;", '"')
    return re.sub(r"\s+", " ", s).strip()


_LINK = re.compile(r"""<a\b[^>]*href\s*=\s*["'][^"']*ExportPDF\.ashx\?ReportID=(\d+)[^"']*["'][^>]*>([\s\S]*?)</a>""", re.I)


def _js_last_index_of(s: str, sub: str, from_index: int) -> int:
    return s.rfind(sub, 0, from_index + len(sub))


def parse_report_links(page: str) -> list[ReportLink]:
    """Every report PDF linked on a Fishery Reports page, with link text plus a bit of its row."""
    out: list[ReportLink] = []
    seen: set[str] = set()
    for m in _LINK.finditer(page):
        rid = m.group(1)
        if rid in seen:
            continue
        seen.add(rid)
        row_start = max(_js_last_index_of(page, "<tr", m.start()), _js_last_index_of(page, "<li", m.start()), m.start() - 400)
        out.append(ReportLink(rid, _strip_tags(f"{page[row_start:m.start()]} {m.group(2)}")[-200:]))
    return out


def survey_links(links: list[ReportLink]) -> list[ReportLink]:
    """Lake survey reports, newest first (``pickSurvey``'s filter; falls back to its non-creel/stocking/map pool)."""
    surveys = [x for x in links if re.search(r"survey", x.text, re.I) and not re.search(r"creel|stocking|map|angler|harvest", x.text, re.I)]
    pool = surveys or [x for x in links if not re.search(r"creel|stocking|map", x.text, re.I)]
    return sorted(pool, key=lambda x: int(x.id), reverse=True)


def pick_survey(links: list[ReportLink]) -> ReportLink | None:
    s = survey_links(links)
    return s[0] if s else None


def water_name_variants(name: str) -> list[str]:
    """'Enemy Swim Lake' -> ['Enemy Swim Lake', 'Enemy Swim']."""
    n = re.sub(r"\s+", " ", name.strip())
    bare = re.sub(r"\s+(lake|reservoir|dam)$", "", re.sub(r"^lake\s+", "", n, flags=re.I), flags=re.I)
    out: list[str] = []
    for s in (n, bare):
        if s not in out and len(s) >= 2:
            out.append(s)
    return out


def sd_slug(water: str) -> str:
    """Same slug as ``sdReportId`` in src/features/fishing/sdReport.ts."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", water.lower()))


def sd_lake_key(water: str) -> str:
    return f"sd:{sd_slug(water)}"


# ------------------------------------------------------------------ PDF -> lines (sdPdf.ts)


def pdf_lines(data: bytes, max_pages: int = 12) -> list[list[str]]:
    """Text as lines per page: words on the same baseline (2 pt buckets) left to right; gaps > 12 pt become ' | '."""
    import pdfplumber

    pages: list[list[str]] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages[:max_pages]:
            rows: dict[int, list[dict]] = {}
            for w in page.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5):
                if not w["text"].strip():
                    continue
                # Baseline from the bottom of the page, like pdf.js transform[5].
                y = round((page.height - w["bottom"]) / 2) * 2
                rows.setdefault(y, []).append(w)
            lines = []
            for y in sorted(rows, reverse=True):
                items = sorted(rows[y], key=lambda w: w["x0"])
                line = ""
                end = float("-inf")
                for it in items:
                    x = it["x0"]
                    if line:
                        line += " | " if x - end > 12 else " " if x - end > 1 else ""
                    line += it["text"].strip()
                    end = it["x1"]
                line = re.sub(r"\s+", " ", line).strip()
                if line:
                    lines.append(line)
            pages.append(lines)
    return pages


# ------------------------------------------------------------------ survey parsing (sdParse.ts)

_SPECIES_ALT = "|".join(s.replace(" ", r"\s+") for s in SD_SPECIES)
SPECIES_RE = re.compile(rf"\b({_SPECIES_ALT})s?\b", re.I)
_ROW_RE = re.compile(rf"^({_SPECIES_ALT})s?\b[\s|]*(-?\d.*)$", re.I)
_SENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:/|per)\s*(gill|frame|trap)\s*net", re.I)
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def canonical(s: str) -> str:
    key = re.sub(r"s$", "", re.sub(r"\s+", " ", s.lower()))
    return next((n for n in SD_SPECIES if n.lower() == key), s)


def gear_of(s: str) -> str | None:
    if re.search(r"gill\s*net", s, re.I):
        return "Gill nets"
    if re.search(r"(frame|trap)\s*net", s, re.I):
        return "Frame nets"
    if re.search(r"electrofish|boat\s*shock", s, re.I):
        return "Electrofishing"
    return None


@dataclass
class SdCatch:
    species: str
    gear: str  # 'Gill nets' | 'Frame nets' | 'Electrofishing'
    cpue: float
    source: str  # 'summary' | 'table'  (TS field `from`)


@dataclass
class SdSurvey:
    title: str
    year: int | None
    summary: list[str]
    catches: list[SdCatch] = field(default_factory=list)
    date: date | None = None


def _catches_from_sentence(sentence: str) -> list[SdCatch]:
    out = []
    for m in _SENT_RE.finditer(sentence):
        names = list(SPECIES_RE.finditer(sentence[: m.start()]))
        if not names:
            continue
        sp = names[-1].group(1)
        out.append(SdCatch(canonical(sp), "Gill nets" if m.group(2).lower() == "gill" else "Frame nets", float(m.group(1)), "summary"))
    return out


_MONTHS = {m: i + 1 for i, m in enumerate("january february march april may june july august september october november december".split())}


def _full_date(text: str) -> date | None:
    """A full date written out ('June 14, 2021' or '6/14/2021') near the top of the report, if any."""
    m = re.search(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(19[89]\d|20\d{2})\b", text, re.I)
    try:
        if m:
            return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
        m = re.search(r"\b(\d{1,2})/(\d{1,2})/(19[89]\d|20\d{2})\b", text)
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None
    return None


def parse_survey(pages: list[list[str]]) -> SdSurvey:
    all_lines = [line for p in pages for line in p]
    title_line = next((x for x in all_lines if re.search(r"survey summary|statewide fisheries survey", x, re.I)), all_lines[0] if all_lines else "Lake survey")
    head = " ".join(all_lines[:15])
    ym = re.search(r"\b(19[89]\d|20\d{2})\b", head)

    first = pages[0] if pages else []
    stop = next((i for i, x in enumerate(first) if re.match(r"(table|figure)\s*\d", x, re.I)), -1)
    kept = [
        x
        for x in first[: stop if stop >= 0 else len(first)]
        if " | " not in x and len(x) > 25 and not re.search(r"survey summary|statewide fisheries survey", x, re.I) and (len(x) > 60 or re.search(r"[.,;]", x))
    ]
    prose = re.sub(r"\s+", " ", " ".join(kept))
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", prose)]
    summary = [s for s in sentences if SPECIES_RE.search(s) and len(s) < 400][:10]

    catches: dict[str, SdCatch] = {}
    for s in sentences:
        for c in _catches_from_sentence(s):
            catches[f"{c.species}|{c.gear}"] = c

    gear: str | None = None
    for line in all_lines:
        g = gear_of(line)
        if g and not SPECIES_RE.search(line.split("|")[0]) and (len(line) < 60 or re.match(r"table\s*\d", line, re.I)):
            gear = g
            continue
        m = _ROW_RE.match(line)
        if not m or not gear:
            continue
        nums = _NUM_RE.findall(m.group(2) or "")
        try:
            cpue = float(nums[0]) if nums else float("nan")
        except ValueError:
            continue
        if not (cpue == cpue) or cpue < 0 or cpue > 2000:
            continue
        sp = canonical(m.group(1))
        catches[f"{sp}|{gear}"] = SdCatch(sp, gear, cpue, "table")

    ordered = sorted(catches.values(), key=lambda c: -c.cpue)
    ordered = sorted(ordered, key=lambda c: c.gear)
    return SdSurvey(
        title=re.sub(r"\s*\|\s*", " ", title_line)[:120],
        year=int(ym.group(1)) if ym else None,
        summary=summary,
        catches=ordered,
        date=_full_date(head),
    )


def survey_type(title: str) -> str:
    if re.search(r"statewide fisheries survey", title, re.I):
        return "Statewide Fisheries Survey"
    if re.search(r"survey summary", title, re.I):
        return "Survey Summary"
    return "GFP report"
