"""Polite HTTP client with a content-addressed raw cache.

* Identifies itself (``USER_AGENT``), at most one request per second per host
  (``RateLimiter``), exponential backoff on 429 / 5xx / network errors
  (honouring ``Retry-After``), timeouts on every request.
* Every response is written to the cache before anything parses it:
  ``<cache>/<source>/blobs/<sha256[:2]>/<sha256>`` holds the body (content
  addressed, so identical answers are stored once) and
  ``<cache>/<source>/req/<key[:2]>/<key>.json`` maps the request
  (method + URL + body) to the blob, status, content type and fetch time.
* ``offline=True`` never touches the network: a cached answer or ``OfflineMiss``.
* The network is a pluggable ``Transport``: ``RequestsTransport`` for real
  runs, ``FixtureTransport`` to serve recorded-shape files from
  ``ml/fixtures/raw`` (tests, and ``--fixtures`` on the CLI).
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit

log = logging.getLogger(__name__)

USER_AGENT = "CampPlanner/1.0 (family trip planner; github.com/landon-thompson/camping)"
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
# Statuses worth caching (a definite answer: the resource exists, or doesn't).
CACHE_STATUS = frozenset({200, 203, 204, 404, 410})


class HttpError(Exception):
    def __init__(self, url: str, status: int | None, message: str = ""):
        self.url = url
        self.status = status
        super().__init__(f"{message or 'HTTP ' + str(status)} for {url}")


class OfflineMiss(HttpError):
    def __init__(self, url: str):
        super().__init__(url, None, "not in the cache (offline)")


@dataclass
class Response:
    url: str
    status: int
    content: bytes
    content_type: str = ""
    fetched_at: str = ""
    from_cache: bool = False

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text())


class Transport(Protocol):
    def send(self, method: str, url: str, data: bytes | None, headers: dict[str, str], timeout: tuple[float, float]) -> tuple[int, dict[str, str], bytes]: ...


class RequestsTransport:
    """Real network via ``requests``."""

    def __init__(self) -> None:
        import requests

        self._requests = requests
        self.session = requests.Session()

    def send(self, method, url, data, headers, timeout):
        r = self.session.request(method, url, data=data, headers=headers, timeout=timeout)
        return r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content


class FixtureTransport:
    """Serves recorded-shape files listed in ``<root>/index.json``; unknown requests answer 404."""

    def __init__(self, root: Path | str):
        self.root = Path(root)
        idx = json.loads((self.root / "index.json").read_text(encoding="utf-8"))
        self.meta = {k: v for k, v in idx.items() if k != "entries"}
        self.entries: dict[tuple[str, str, str], dict[str, Any]] = {}
        for e in idx["entries"]:
            self.entries[(e.get("method", "GET"), e["url"], e.get("body") or "")] = e
        self.misses: list[str] = []
        self.sent: list[str] = []

    def send(self, method, url, data, headers, timeout):
        self.sent.append(url)
        e = self.entries.get((method, url, (data or b"").decode("utf-8")))
        if e is None:
            self.misses.append(url)
            return 404, {"content-type": "text/plain"}, b"fixture: no such request"
        body = (self.root / e["file"]).read_bytes() if e.get("file") else e.get("text", "").encode("utf-8")
        return int(e.get("status", 200)), {"content-type": e.get("content_type", "")}, body


class RateLimiter:
    """At most one request per ``interval`` seconds per host. ``clock``/``sleep`` are injectable for tests."""

    def __init__(self, interval: float = 1.0, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.interval = interval
        self.clock = clock
        self.sleep = sleep
        self.last: dict[str, float] = {}

    def wait(self, host: str) -> None:
        last = self.last.get(host)
        if last is not None:
            gap = self.clock() - last
            if gap < self.interval:
                self.sleep(self.interval - gap)
        self.last[host] = self.clock()


def request_key(method: str, url: str, data: bytes | None) -> str:
    h = hashlib.sha256()
    h.update(method.upper().encode())
    h.update(b"\n")
    h.update(url.encode())
    h.update(b"\n")
    h.update(data or b"")
    return h.hexdigest()


@dataclass
class RawCache:
    root: Path

    def _req_path(self, source: str, key: str) -> Path:
        return self.root / source / "req" / key[:2] / f"{key}.json"

    def _blob_path(self, source: str, sha: str) -> Path:
        return self.root / source / "blobs" / sha[:2] / sha

    def get(self, source: str, method: str, url: str, data: bytes | None) -> Response | None:
        p = self._req_path(source, request_key(method, url, data))
        if not p.exists():
            return None
        meta = json.loads(p.read_text(encoding="utf-8"))
        blob = self._blob_path(source, meta["sha256"])
        if not blob.exists():
            return None
        return Response(url=url, status=meta["status"], content=blob.read_bytes(), content_type=meta.get("contentType", ""), fetched_at=meta["fetchedAt"], from_cache=True)

    def put(self, source: str, method: str, url: str, data: bytes | None, resp: Response) -> None:
        sha = hashlib.sha256(resp.content).hexdigest()
        blob = self._blob_path(source, sha)
        if not blob.exists():
            blob.parent.mkdir(parents=True, exist_ok=True)
            tmp = blob.with_suffix(".tmp")
            tmp.write_bytes(resp.content)
            tmp.replace(blob)
        p = self._req_path(source, request_key(method, url, data))
        p.parent.mkdir(parents=True, exist_ok=True)
        meta = {
            "method": method,
            "url": url,
            "body": (data or b"").decode("utf-8", errors="replace"),
            "status": resp.status,
            "contentType": resp.content_type,
            "fetchedAt": resp.fetched_at,
            "sha256": sha,
            "bytes": len(resp.content),
        }
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, indent=1), encoding="utf-8")
        tmp.replace(p)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _age_days(fetched_at: str, now: datetime) -> float:
    try:
        t = datetime.strptime(fetched_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return float("inf")
    return (now - t).total_seconds() / 86400


@dataclass
class Stats:
    network: int = 0
    cache_hits: int = 0
    offline_misses: int = 0
    retries: int = 0
    errors: int = 0
    by_source: dict[str, int] = field(default_factory=dict)
    # Newest fetch time of any response used, per source (for the manifest's sources list).
    fetched_at: dict[str, str] = field(default_factory=dict)


class Client:
    """``get``/``post`` through the cache, rate limiter and backoff. Responses with any status are returned; raise on 5xx/429 after retries."""

    def __init__(
        self,
        cache_dir: Path | str,
        *,
        offline: bool = False,
        transport: Transport | None = None,
        limiter: RateLimiter | None = None,
        max_retries: int = 5,
        backoff_base: float = 2.0,
        max_backoff: float = 120.0,
        timeout: tuple[float, float] = (10.0, 60.0),
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        user_agent: str = USER_AGENT,
    ):
        self.cache = RawCache(Path(cache_dir))
        self.offline = offline
        self._transport = transport
        self.limiter = limiter or RateLimiter(sleep=sleep)
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.max_backoff = max_backoff
        self.timeout = timeout
        self.sleep = sleep
        self.now = now
        self.user_agent = user_agent
        self.stats = Stats()

    @property
    def transport(self) -> Transport:
        if self._transport is None:
            self._transport = RequestsTransport()
        return self._transport

    def get(self, source: str, url: str, *, max_age_days: float | None = None) -> Response:
        return self.request("GET", source, url, None, max_age_days=max_age_days)

    def post(self, source: str, url: str, data: bytes | str, *, content_type: str = "application/x-www-form-urlencoded", max_age_days: float | None = None) -> Response:
        body = data.encode("utf-8") if isinstance(data, str) else data
        return self.request("POST", source, url, body, max_age_days=max_age_days, content_type=content_type)

    def _used(self, source: str, resp: Response) -> Response:
        prev = self.stats.fetched_at.get(source, "")
        if resp.fetched_at > prev:
            self.stats.fetched_at[source] = resp.fetched_at
        return resp

    def request(self, method: str, source: str, url: str, data: bytes | None, *, max_age_days: float | None = None, content_type: str | None = None) -> Response:
        cached = self.cache.get(source, method, url, data)
        if cached is not None and (self.offline or max_age_days is None or _age_days(cached.fetched_at, self.now()) <= max_age_days):
            self.stats.cache_hits += 1
            return self._used(source, cached)
        if self.offline:
            self.stats.offline_misses += 1
            raise OfflineMiss(url)
        try:
            return self._used(source, self._fetch(method, source, url, data, content_type))
        except HttpError:
            if cached is None:
                raise
            log.warning("using stale cache for %s (network failed)", url)
            self.stats.cache_hits += 1
            return self._used(source, cached)

    def _fetch(self, method: str, source: str, url: str, data: bytes | None, content_type: str | None) -> Response:
        headers = {"User-Agent": self.user_agent, "Accept": "*/*"}
        if content_type:
            headers["Content-Type"] = content_type
        host = urlsplit(url).netloc
        attempt = 0
        while True:
            self.limiter.wait(host)
            self.stats.network += 1
            self.stats.by_source[source] = self.stats.by_source.get(source, 0) + 1
            try:
                status, rh, body = self.transport.send(method, url, data, headers, self.timeout)
            except Exception as e:  # network error / timeout
                status, rh, body = None, {}, b""
                err: Exception | None = e
            else:
                err = None
            if status is not None and status not in RETRY_STATUS:
                resp = Response(url=url, status=status, content=body, content_type=rh.get("content-type", ""), fetched_at=_iso(self.now()))
                if status in CACHE_STATUS:
                    self.cache.put(source, method, url, data, resp)
                return resp
            if attempt >= self.max_retries:
                self.stats.errors += 1
                if err is not None:
                    raise HttpError(url, None, f"network error ({type(err).__name__}: {err})") from err
                raise HttpError(url, status)
            delay = min(self.max_backoff, self.backoff_base * (2**attempt))
            ra = rh.get("retry-after") if status is not None else None
            if ra:
                delay = min(self.max_backoff, max(delay, _retry_after_seconds(ra, self.now())))
            log.info("retry %s in %.0fs (%s)", url, delay, status if status is not None else err)
            self.stats.retries += 1
            self.sleep(delay)
            attempt += 1


def _retry_after_seconds(value: str, now: datetime) -> float:
    try:
        return float(value)
    except ValueError:
        pass
    try:
        return max(0.0, (parsedate_to_datetime(value) - now).total_seconds())
    except (TypeError, ValueError):
        return 0.0
