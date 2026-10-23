"""``python -m lakerecs <command>`` (run from ``ml/``).

Data commands (this module): ``fetch`` (download + cache raw responses),
``tidy`` (raw cache -> tidy tables, never touches the network), ``all``
(both). Other modules can add commands without editing this file: any of
``EXTRA_COMMAND_MODULES`` that exists and defines
``register(subparsers, common_parent)`` is asked to add its subcommands
(set ``func`` with ``set_defaults(func=...)``; it receives the parsed args).
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import schema
from . import sources as S
from .fetch import Gaps, Options, collect
from .http import Client, FixtureTransport

ML_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = ML_DIR / "cache"
DEFAULT_TIDY = ML_DIR / "data" / "tidy"
FIXTURE_NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)

# Agent B's modules (model/validate/export) may register "fit", "validate", "export", ...
EXTRA_COMMAND_MODULES = ("lakerecs.model", "lakerecs.validate", "lakerecs.export", "lakerecs.encode")

log = logging.getLogger("lakerecs")


def _bbox(text: str) -> tuple[float, float, float, float]:
    try:
        w, s, e, n = (float(x) for x in text.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError("bbox is west,south,east,north in degrees, e.g. -93.5,47.5,-91.5,48.2")
    if not (w < e and s < n):
        raise argparse.ArgumentTypeError("bbox must be west<east and south<north")
    return (w, s, e, n)


def common_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False)
    g = p.add_argument_group("data pipeline")
    g.add_argument("--state", choices=["MN", "SD", "both"], default="both", help="which state(s) to process (default both)")
    g.add_argument("--limit", type=int, default=None, metavar="N", help="first N lakes per state (smoke runs)")
    g.add_argument("--bbox", type=_bbox, default=None, metavar="W,S,E,N", help="only this box (degrees)")
    g.add_argument("--offline", action="store_true", help="cache only: never touch the network")
    g.add_argument("--cache", type=Path, default=None, help=f"raw cache folder (default {DEFAULT_CACHE})")
    g.add_argument("--out", type=Path, default=DEFAULT_TIDY, help=f"tidy output folder (default {DEFAULT_TIDY})")
    g.add_argument("--fixtures", type=Path, default=None, metavar="DIR", help="serve recorded-shape fixture files instead of the network (e.g. fixtures/raw)")
    g.add_argument("--grid-km", type=float, default=S.LF_GRID_KM, help="LakeFinder by_point grid spacing")
    g.add_argument("--sd-reports", type=int, default=3, help="newest GFP survey PDFs per SD lake")
    g.add_argument("--sd-min-acres", type=float, default=10.0, help="skip SD waters smaller than this (OSM outline)")
    g.add_argument("--lf-stocking-type", default=None, help="LakeFinder detail.cgi type= for stocking ('' to skip; default: discover)")
    g.add_argument("--lf-regs-type", default=None, help="LakeFinder detail.cgi type= for special regulations ('' to skip; default: discover)")
    g.add_argument("--max-retries", type=int, default=5, help="retries per request on 429/5xx/network errors (backoff 2, 4, 8 … s)")
    g.add_argument("-v", "--verbose", action="store_true")
    return p


def options_from(args: argparse.Namespace, fixture_meta: dict | None = None) -> Options:
    state_bbox = None
    if fixture_meta and fixture_meta.get("bbox"):
        state_bbox = {k: tuple(v) for k, v in fixture_meta["bbox"].items()}
    return Options(
        states=("MN", "SD") if args.state == "both" else (args.state,),
        bbox=args.bbox,
        state_bbox=state_bbox,
        limit=args.limit,
        grid_km=args.grid_km,
        lf_stocking_type=args.lf_stocking_type,
        lf_regs_type=args.lf_regs_type,
        sd_reports=args.sd_reports,
        sd_min_acres=args.sd_min_acres,
    )


def make_client(args: argparse.Namespace, offline: bool) -> tuple[Client, dict | None]:
    cache = args.cache
    transport = None
    meta = None
    kw = {}
    if args.fixtures is not None:
        transport = FixtureTransport(args.fixtures)
        meta = transport.meta
        kw = {"now": lambda: FIXTURE_NOW, "sleep": lambda s: None}
        if cache is None:
            cache = Path(getattr(args, "_fixture_cache", None) or tempfile.mkdtemp(prefix="lakerecs-fixture-cache-"))
            args._fixture_cache = str(cache)
    return Client(cache or DEFAULT_CACHE, offline=offline, transport=transport, max_retries=getattr(args, "max_retries", 5), **kw), meta


def cmd_fetch(args: argparse.Namespace) -> int:
    client, meta = make_client(args, offline=args.offline)
    gaps = Gaps()
    collect(client, options_from(args, meta), gaps)
    st = client.stats
    print(f"fetch: {st.network} requests, {st.cache_hits} from cache, {st.offline_misses} not in cache, {st.retries} retries, {st.errors} failures")
    for src, kinds in sorted(gaps.data.items()):
        for kind, v in sorted(kinds.items()):
            print(f"  gap {src}/{kind}: {v['count']}")
    return 0


def cmd_tidy(args: argparse.Namespace) -> int:
    if args.fixtures is not None and args.cache is None and not getattr(args, "_fixture_cache", None):
        # Fixture files stand in for the network: fill a throwaway cache from them first.
        fc, meta = make_client(args, offline=False)
        collect(fc, options_from(args, meta), Gaps())
    client, meta = make_client(args, offline=True)
    gaps = Gaps()
    col = collect(client, options_from(args, meta), gaps)
    from .tidy import build_tables

    tables = build_tables(col, gaps, client)
    if len(tables["lakes"]) == 0 and client.stats.offline_misses:
        print(f"tidy: the cache has nothing for this selection ({client.stats.offline_misses} requests missing); run `python -m lakerecs fetch` first", file=sys.stderr)
        return 3
    errs = schema.validate_tidy(tables)
    if errs:
        print("tidy: schema problems:\n  " + "\n  ".join(errs), file=sys.stderr)
        return 2
    written = schema.write_tidy(args.out, tables)
    print(f"tidy: {len(tables['lakes'])} lakes, {len(tables['surveys'])} survey rows, {len(tables['launches'])} launches, {len(tables['stocking'])} stocking rows, {len(tables['regs'])} lakes with regulations -> {args.out}")
    for line in tables["gaps"]["summary"]:
        print(f"  {line}")
    log.debug(json.dumps({k: str(v) for k, v in written.items()}))
    return 0


def cmd_all(args: argparse.Namespace) -> int:
    rc = cmd_fetch(args)
    return rc or cmd_tidy(args)


def build_parser() -> argparse.ArgumentParser:
    parent = common_parser()
    p = argparse.ArgumentParser(prog="python -m lakerecs", description="Lake recommender pipeline (public MN DNR / SD GFP / OpenStreetMap data).")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch", parents=[parent], help="download and cache raw responses (rate-limited)").set_defaults(func=cmd_fetch)
    sub.add_parser("tidy", parents=[parent], help="raw cache -> tidy tables (no network)").set_defaults(func=cmd_tidy)
    sub.add_parser("all", parents=[parent], help="fetch, then tidy").set_defaults(func=cmd_all)
    for mod_name in EXTRA_COMMAND_MODULES:
        try:
            mod = importlib.import_module(mod_name)
        except ModuleNotFoundError as e:
            if e.name != mod_name:
                raise
            continue
        if hasattr(mod, "register"):
            mod.register(sub, parent)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if getattr(args, "verbose", False) else logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return int(args.func(args) or 0)
