"""The tidy tables, as code (docs/LAKE_RECS_PLAN.md section 2).

Agent B (model) imports this module: ``validate_frame(df, "surveys")`` returns
a list of problems (empty = valid), ``read_tidy(dir)`` loads every table with
canonical dtypes, ``coerce_frame`` casts a frame to them.

Canonical pandas dtypes by column kind:

=========  ==========================  ======================================
kind       pandas dtype                parquet (arrow) type
=========  ==========================  ======================================
str        ``string`` (pd.NA = null)   string
float      ``float64`` (NaN = null)    float64
int        ``Int64`` (pd.NA = null)    int64
date       ``datetime64[ns]`` (NaT)    date32
lengths    ``object``: list of         list<struct<inch: int32, count: int32>>
           ``{"inch": int, "count": int}`` dicts, or None
=========  ==========================  ======================================

Columns marked ``optional`` are pipeline additions beyond the plan's table
(e.g. ``survey_year``); a frame without them still validates and
``coerce_frame`` adds them as nulls. Everything else is required.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

STATES = ("MN", "SD")
GEAR_FAMILIES = ("gill", "trap", "electro", "seine", "other")
PARSE_SOURCES = ("lakefinder-json", "gfp-table", "gfp-summary")
RAMP_CLASSES = ("concrete", "gravel", "carry-in", "unknown")
EFFORT_SOURCES = ("gear_count", "catch/cpue")

LAKE_KEY_RE = r"mn:\d{8}|sd:[a-z0-9]+(?:-[a-z0-9]+)*"
SPECIES_RE = r"[A-Z]{3}"


@dataclass(frozen=True)
class Col:
    name: str
    kind: str  # str | float | int | date | lengths
    nullable: bool = True
    optional: bool = False
    choices: tuple[str, ...] | None = None
    pattern: str | None = None
    min: float | None = None
    min_exclusive: bool = False
    doc: str = ""


TABLES: dict[str, tuple[Col, ...]] = {
    "surveys": (
        Col("lake_key", "str", False, pattern=LAKE_KEY_RE, doc="mn:<DOW> / sd:<slug>"),
        Col("state", "str", False, choices=STATES),
        Col("species", "str", False, pattern=SPECIES_RE, doc="DNR 3-letter code"),
        Col("survey_id", "str", False, doc="MN: '<date>|<type>'; SD: GFP ReportID"),
        Col("survey_date", "date", True, doc="null when only the year is published (most SD reports)"),
        Col("survey_year", "int", False, optional=True, doc="addition: always set (from the date, or the SD report's year)"),
        Col("survey_type", "str", False, doc="e.g. 'Standard Survey', 'Population Assessment · Large Lake'"),
        Col("gear", "str", False, doc="raw gear text"),
        Col("gear_family", "str", False, choices=GEAR_FAMILIES),
        Col("effort", "float", True, min=0, min_exclusive=True, doc="denominator of the published CPUE: nets, or hours for electrofishing"),
        Col("gear_count", "float", True, optional=True, min=0, doc="addition: gearCount as published (MN)"),
        Col("effort_source", "str", True, optional=True, choices=EFFORT_SOURCES, doc="addition: how effort was found"),
        Col("total_catch", "int", True, min=0),
        Col("cpue", "float", True, min=0, doc="as published"),
        Col("normal_low", "float", True, min=0, doc="DNR similar-lake 25th pct (MN)"),
        Col("normal_high", "float", True, min=0, doc="DNR similar-lake 75th pct (MN)"),
        Col("avg_weight_lb", "float", True, min=0),
        Col("normal_weight_low", "float", True, min=0),
        Col("normal_weight_high", "float", True, min=0),
        Col("lengths", "lengths", True, doc="length distribution when published (LakeFinder key: verify)"),
        Col("source_url", "str", False),
        Col("parse_source", "str", False, choices=PARSE_SOURCES),
    ),
    "lakes": (
        Col("lake_key", "str", False, pattern=LAKE_KEY_RE),
        Col("state", "str", False, choices=STATES),
        Col("name", "str", False),
        Col("county", "str", True),
        Col("lat", "float", True, doc="null when no source gives a point (logged in gaps)"),
        Col("lng", "float", True),
        Col("area_acres", "float", True, min=0, min_exclusive=True),
        Col("max_depth_ft", "float", True, min=0, min_exclusive=True),
        Col("clarity_ft", "float", True, min=0, min_exclusive=True),
        Col("region", "str", False, doc="'MN:<region from LakeFinder>' or '<ST>:cell:<floor lat>_<floor lng>'"),
        Col("source_url", "str", False),
        Col("parent_key", "str", True, optional=True, pattern=LAKE_KEY_RE, doc="addition: whole lake for a sub-basin (DOW not ending 00)"),
    ),
    "launches": (
        Col("lake_key", "str", False, pattern=LAKE_KEY_RE),
        Col("name", "str", False),
        Col("lat", "float", False),
        Col("lng", "float", False),
        Col("ramp", "str", False, doc="as the source says ('' when blank)"),
        Col("ramp_class", "str", False, choices=RAMP_CLASSES),
        Col("source", "str", False),
    ),
    "stocking": (
        Col("lake_key", "str", False, pattern=LAKE_KEY_RE),
        Col("year", "int", False, min=1900),
        Col("species", "str", False, pattern=SPECIES_RE),
        Col("count", "int", True, min=0),
        Col("size", "str", False, doc="as published, e.g. 'fry', 'fingerling' ('' when blank)"),
        Col("source_url", "str", False),
    ),
}

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "surveys": ("lake_key", "species", "survey_id", "gear"),
    "lakes": ("lake_key",),
    "launches": ("lake_key", "name", "lat", "lng"),
}

FILES = {
    "surveys": "surveys.parquet",
    "lakes": "lakes.parquet",
    "launches": "launches.parquet",
    "stocking": "stocking.parquet",
    "regs": "regs.json",
    "gaps": "gaps.json",
    "sources": "sources.json",
}

_PANDAS = {"str": "string", "float": "float64", "int": "Int64", "date": "datetime64[ns]", "lengths": "object"}
_LENGTHS_ARROW = pa.list_(pa.struct([("inch", pa.int32()), ("count", pa.int32())]))
_ARROW = {"str": pa.string(), "float": pa.float64(), "int": pa.int64(), "date": pa.date32(), "lengths": _LENGTHS_ARROW}


def cols(table: str, include_optional: bool = True) -> tuple[Col, ...]:
    return tuple(c for c in TABLES[table] if include_optional or not c.optional)


def column_names(table: str, include_optional: bool = True) -> list[str]:
    return [c.name for c in cols(table, include_optional)]


def pandas_dtypes(table: str) -> dict[str, str]:
    return {c.name: _PANDAS[c.kind] for c in TABLES[table]}


def arrow_schema(table: str) -> pa.Schema:
    # Optional columns may be all-null (a frame built without them), so they're nullable on disk.
    return pa.schema([pa.field(c.name, _ARROW[c.kind], nullable=c.nullable or c.optional) for c in TABLES[table]])


def empty_frame(table: str) -> pd.DataFrame:
    return coerce_frame(pd.DataFrame({c.name: [] for c in TABLES[table]}), table)


# ------------------------------------------------------------------ coercion


def _is_null(v: Any) -> bool:
    if v is None or v is pd.NA or v is pd.NaT:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return False


def _norm_lengths(v: Any) -> list[dict[str, int]] | None:
    if v is None or (not isinstance(v, (list, tuple, np.ndarray)) and _is_null(v)):
        return None
    out = []
    for item in list(v):
        if isinstance(item, dict):
            out.append({"inch": int(item["inch"]), "count": int(item["count"])})
        else:  # (inch, count) pair
            inch, count = item
            out.append({"inch": int(inch), "count": int(count)})
    return out


def coerce_frame(df: pd.DataFrame, table: str) -> pd.DataFrame:
    """Columns in schema order with canonical dtypes; missing optional columns added as nulls."""
    out = pd.DataFrame(index=df.index)
    for c in TABLES[table]:
        if c.name in df.columns:
            s = df[c.name]
        elif c.optional:
            s = pd.Series([None] * len(df), index=df.index, dtype="object")
        else:
            raise KeyError(f"{table}: missing column {c.name}")
        if c.kind == "str":
            s = s.astype("object").where(~s.isna(), None).astype("string")
        elif c.kind == "float":
            s = pd.to_numeric(s.astype("object").where(~s.isna(), np.nan), errors="raise").astype("float64")
        elif c.kind == "int":
            s = pd.to_numeric(s.astype("object").where(~s.isna(), np.nan), errors="raise").astype("Int64")
        elif c.kind == "date":
            s = pd.to_datetime(s, errors="raise").astype("datetime64[ns]")
        elif c.kind == "lengths":
            s = pd.Series([_norm_lengths(v) for v in s], index=df.index, dtype="object")
        out[c.name] = s
    return out.reset_index(drop=True)


# ------------------------------------------------------------------ validation


def _kind_ok(s: pd.Series, kind: str) -> bool:
    nn = s.dropna()
    if kind == "str":
        if pd.api.types.is_string_dtype(s.dtype) and s.dtype != object:
            return True
        return s.dtype == object and all(isinstance(v, str) for v in nn)
    if kind == "float":
        return pd.api.types.is_float_dtype(s.dtype) or pd.api.types.is_integer_dtype(s.dtype)
    if kind == "int":
        if pd.api.types.is_integer_dtype(s.dtype):
            return True
        return pd.api.types.is_float_dtype(s.dtype) and bool(np.all(np.mod(nn.to_numpy(dtype=float), 1) == 0))
    if kind == "date":
        if pd.api.types.is_datetime64_any_dtype(s.dtype):
            return True
        return s.dtype == object and all(isinstance(v, (date, datetime)) for v in nn)
    if kind == "lengths":
        return s.dtype == object
    return False


def _lengths_problem(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, (list, tuple, np.ndarray)):
        return f"not a list: {type(v).__name__}"
    for item in v:
        if not isinstance(item, dict) or set(item) != {"inch", "count"}:
            return f"bad item {item!r}"
        if not all(isinstance(item[k], (int, np.integer)) for k in ("inch", "count")):
            return f"non-integer item {item!r}"
        if item["count"] < 0 or item["inch"] < 0:
            return f"negative item {item!r}"
    return None


def validate_frame(df: pd.DataFrame, table: str, *, allow_extra: bool = False, max_examples: int = 3) -> list[str]:
    """Problems with ``df`` as tidy table ``table`` ("surveys", "lakes", "launches", "stocking"); [] = valid."""
    if table not in TABLES:
        return [f"unknown table {table!r}"]
    errs: list[str] = []
    spec = {c.name: c for c in TABLES[table]}
    for c in TABLES[table]:
        if c.name not in df.columns and not c.optional:
            errs.append(f"{table}: missing column {c.name}")
    extra = [k for k in df.columns if k not in spec]
    if extra and not allow_extra:
        errs.append(f"{table}: unexpected columns {extra}")

    def ex(mask: pd.Series) -> str:
        rows = df.index[mask.to_numpy(dtype=bool)][:max_examples].tolist()
        return f"{int(mask.sum())} rows, e.g. index {rows}"

    for name in [k for k in df.columns if k in spec]:
        c = spec[name]
        s = df[name]
        if not _kind_ok(s, c.kind):
            errs.append(f"{table}.{name}: dtype {s.dtype} is not {c.kind}")
            continue
        nulls = s.isna() if c.kind != "lengths" else s.map(lambda v: v is None or (isinstance(v, float) and math.isnan(v)))
        if not c.nullable and nulls.any():
            errs.append(f"{table}.{name}: nulls not allowed ({ex(nulls)})")
        nn = s[~nulls]
        if c.choices is not None and len(nn):
            bad = ~s.isin(c.choices) & ~nulls
            if bad.any():
                errs.append(f"{table}.{name}: values outside {list(c.choices)}: {sorted(set(map(str, s[bad])))[:max_examples]}")
        if c.pattern is not None and len(nn):
            rx = re.compile(c.pattern)
            bad = s.map(lambda v: not _is_null(v) and not rx.fullmatch(str(v))).astype(bool)
            if bad.any():
                errs.append(f"{table}.{name}: values not matching /{c.pattern}/: {sorted(set(map(str, s[bad])))[:max_examples]}")
        if c.min is not None and c.kind in ("float", "int") and len(nn):
            vals = pd.to_numeric(s, errors="coerce")
            bad = (vals <= c.min) if c.min_exclusive else (vals < c.min)
            bad = bad.fillna(False).astype(bool)
            if bad.any():
                errs.append(f"{table}.{name}: values {'<=' if c.min_exclusive else '<'} {c.min} ({ex(bad)})")
        if c.kind == "float" and len(nn):
            vals = pd.to_numeric(s, errors="coerce")
            inf = np.isinf(vals.to_numpy(dtype=float, na_value=np.nan))
            if inf.any():
                errs.append(f"{table}.{name}: infinite values")
        if c.kind == "lengths":
            probs = [(i, p) for i, p in ((i, _lengths_problem(v)) for i, v in nn.items()) if p]
            if probs:
                errs.append(f"{table}.{name}: {len(probs)} bad length lists, e.g. index {probs[0][0]}: {probs[0][1]}")

    # Cross-column rules.
    if {"lake_key", "state"} <= set(df.columns) and len(df):
        pref = df["lake_key"].astype("string").str.slice(0, 2).str.upper()
        bad = (pref != df["state"].astype("string")).fillna(False).astype(bool)
        if bad.any():
            errs.append(f"{table}: lake_key prefix doesn't match state ({ex(bad)})")
    for lo, hi in (("normal_low", "normal_high"), ("normal_weight_low", "normal_weight_high")):
        if {lo, hi} <= set(df.columns) and len(df):
            a = pd.to_numeric(df[lo], errors="coerce")
            b = pd.to_numeric(df[hi], errors="coerce")
            bad = (a > b).fillna(False).astype(bool)
            if bad.any():
                errs.append(f"{table}: {lo} > {hi} ({ex(bad)})")
    for a, b in (("lat", "lng"),):
        if {a, b} <= set(df.columns) and len(df):
            bad = (df[a].isna() != df[b].isna()).astype(bool)
            if bad.any():
                errs.append(f"{table}: lat/lng only half set ({ex(bad)})")
            la = pd.to_numeric(df[a], errors="coerce")
            ln = pd.to_numeric(df[b], errors="coerce")
            bad = (~la.between(40, 50) | ~ln.between(-105, -88)) & la.notna()
            if bad.astype(bool).any():
                errs.append(f"{table}: points outside MN/SD ({ex(bad.astype(bool))})")
    pk = PRIMARY_KEYS.get(table)
    if pk and set(pk) <= set(df.columns) and len(df):
        dup = df.duplicated(list(pk), keep=False)
        if dup.any():
            errs.append(f"{table}: duplicate primary key {list(pk)} ({ex(dup)})")
    return errs


def check_frame(df: pd.DataFrame, table: str, **kw: Any) -> pd.DataFrame:
    """``validate_frame`` that raises ``ValueError`` on any problem; returns ``df``."""
    errs = validate_frame(df, table, **kw)
    if errs:
        raise ValueError("; ".join(errs))
    return df


def validate_regs(obj: Any) -> list[str]:
    """``regs.json``: {lake_key: [{species: code|null, text, url, fetchedAt}]}."""
    errs: list[str] = []
    if not isinstance(obj, dict):
        return ["regs: not an object"]
    rx = re.compile(LAKE_KEY_RE)
    sp = re.compile(SPECIES_RE)
    for key, items in obj.items():
        if not rx.fullmatch(key):
            errs.append(f"regs: bad lake key {key!r}")
        if not isinstance(items, list):
            errs.append(f"regs[{key}]: not a list")
            continue
        for i, r in enumerate(items):
            if not isinstance(r, dict) or set(r) != {"species", "text", "url", "fetchedAt"}:
                errs.append(f"regs[{key}][{i}]: keys must be species, text, url, fetchedAt")
                continue
            if r["species"] is not None and not (isinstance(r["species"], str) and sp.fullmatch(r["species"])):
                errs.append(f"regs[{key}][{i}]: bad species {r['species']!r}")
            if not isinstance(r["text"], str) or not r["text"].strip():
                errs.append(f"regs[{key}][{i}]: empty text")
            if not isinstance(r["url"], str) or not r["url"].startswith("http"):
                errs.append(f"regs[{key}][{i}]: bad url")
            if not isinstance(r["fetchedAt"], str) or not re.match(r"\d{4}-\d{2}-\d{2}T", r["fetchedAt"]):
                errs.append(f"regs[{key}][{i}]: fetchedAt must be ISO time")
    return errs


def validate_gaps(obj: Any) -> list[str]:
    """``gaps.json``: {"bySource": {source: {kind: {"count": int, "examples": [str]}}}, "summary": [str], "verify": [str]}."""
    if not isinstance(obj, dict) or set(obj) != {"bySource", "summary", "verify"}:
        return ["gaps: keys must be bySource, summary, verify"]
    errs: list[str] = []
    for src, kinds in obj["bySource"].items():
        for kind, v in kinds.items():
            if not isinstance(v, dict) or not isinstance(v.get("count"), int) or not isinstance(v.get("examples"), list):
                errs.append(f"gaps[{src}][{kind}]: needs count (int) and examples (list)")
    if not all(isinstance(s, str) for s in obj["summary"]) or not all(isinstance(s, str) for s in obj["verify"]):
        errs.append("gaps: summary and verify must be lists of strings")
    return errs


def validate_sources(obj: Any) -> list[str]:
    """``sources.json``: [{name, url, terms, fetchedAt}] (fetchedAt: newest response used, or null)."""
    if not isinstance(obj, list):
        return ["sources: not a list"]
    return [f"sources[{i}]: keys must be name, url, terms, fetchedAt" for i, s in enumerate(obj) if not isinstance(s, dict) or set(s) != {"name", "url", "terms", "fetchedAt"}]


# ------------------------------------------------------------------ files


def write_parquet(df: pd.DataFrame, path: Path | str, table: str) -> None:
    df = coerce_frame(df, table)
    data: dict[str, Any] = {}
    for c in TABLES[table]:
        s = df[c.name]
        if c.kind == "date":
            data[c.name] = [None if pd.isna(v) else v.date() for v in s]
        elif c.kind == "lengths":
            data[c.name] = list(s)
        elif c.kind == "float":
            data[c.name] = [None if pd.isna(v) else float(v) for v in s]
        else:
            data[c.name] = [None if pd.isna(v) else v for v in s.astype("object")]
    pq.write_table(pa.Table.from_pydict(data, schema=arrow_schema(table)), str(path))


def read_parquet(path: Path | str, table: str) -> pd.DataFrame:
    t = pq.read_table(str(path))
    kinds = {c.name: c.kind for c in TABLES[table]}
    data = {}
    for name in t.column_names:
        col = t.column(name)
        if kinds.get(name) in ("lengths", "str", "int"):
            data[name] = col.to_pylist()
        else:
            data[name] = col.to_pandas()
    return coerce_frame(pd.DataFrame(data), table)


def write_tidy(out_dir: Path | str, tables: dict[str, Any]) -> dict[str, Path]:
    """Write every table that's present in ``tables`` (frames as parquet, the rest as JSON)."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = {}
    for name, value in tables.items():
        path = out / FILES[name]
        if name in TABLES:
            write_parquet(value, path, name)
        else:
            path.write_text(json.dumps(value, indent=1, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")
        written[name] = path
    return written


def read_tidy(tidy_dir: Path | str) -> dict[str, Any]:
    """All tidy tables in a folder: frames for the four tables, parsed JSON for regs/gaps/sources (missing files skipped)."""
    d = Path(tidy_dir)
    out: dict[str, Any] = {}
    for name, fname in FILES.items():
        p = d / fname
        if not p.exists():
            continue
        out[name] = read_parquet(p, name) if name in TABLES else json.loads(p.read_text(encoding="utf-8"))
    return out


def validate_tidy(tables: dict[str, Any]) -> list[str]:
    """Every check for a full set of tidy tables, plus referential integrity (rows point at known lakes)."""
    errs: list[str] = []
    for name in TABLES:
        if name in tables:
            errs += validate_frame(tables[name], name)
    if "regs" in tables:
        errs += validate_regs(tables["regs"])
    if "gaps" in tables:
        errs += validate_gaps(tables["gaps"])
    if "sources" in tables:
        errs += validate_sources(tables["sources"])
    if "lakes" in tables:
        known = set(tables["lakes"]["lake_key"].dropna())
        for name in ("surveys", "launches", "stocking"):
            if name in tables and len(tables[name]):
                missing = sorted(set(tables[name]["lake_key"].dropna()) - known)
                if missing:
                    errs.append(f"{name}: lake keys not in lakes: {missing[:3]} ({len(missing)} total)")
        if "regs" in tables:
            missing = sorted(set(tables["regs"]) - known)
            if missing:
                errs.append(f"regs: lake keys not in lakes: {missing[:3]}")
    return errs


def frame_from_rows(rows: Iterable[dict[str, Any]], table: str) -> pd.DataFrame:
    rows = list(rows)
    if not rows:
        return empty_frame(table)
    return coerce_frame(pd.DataFrame(rows), table)
