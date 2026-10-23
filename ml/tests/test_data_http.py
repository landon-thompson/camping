"""Polite client: rate limit, backoff, timeouts, content-addressed cache, offline mode (all with fake time)."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from lakerecs.http import USER_AGENT, Client, FixtureTransport, HttpError, OfflineMiss, RateLimiter


class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.sleeps = []

    def clock(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(round(s, 3))
        self.t += s


class FakeTransport:
    """Answers from a script: list of (status, headers, body) or Exception, per call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def send(self, method, url, data, headers, timeout):
        self.calls.append((method, url, data, dict(headers), timeout))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def client(tmp_path, script, clock=None, **kw):
    clock = clock or FakeClock()
    t = FakeTransport(script)
    c = Client(tmp_path / "cache", transport=t, limiter=RateLimiter(1.0, clock=clock.clock, sleep=clock.sleep), sleep=clock.sleep, now=kw.pop("now", lambda: NOW), **kw)
    return c, t, clock


def test_rate_limit_is_per_host():
    clk = FakeClock()
    rl = RateLimiter(1.0, clock=clk.clock, sleep=clk.sleep)
    rl.wait("a.example")
    rl.wait("b.example")  # other host: no wait
    clk.t += 0.25
    rl.wait("a.example")  # 0.25 s after the last: wait 0.75
    rl.wait("a.example")  # immediately again: full second
    assert clk.sleeps == [0.75, 1.0]


def test_backoff_on_429_and_5xx_then_success(tmp_path):
    c, t, clk = client(tmp_path, [(503, {}, b""), (429, {"retry-after": "7"}, b""), (502, {}, b""), (200, {"content-type": "application/json"}, b'{"ok":1}')])
    r = c.get("src", "https://a.example/x")
    assert r.json() == {"ok": 1} and r.status == 200 and not r.from_cache
    # backoff 2, max(4, Retry-After 7), 8 — plus the 1 s per-host spacing after each sleep is already satisfied
    assert [s for s in clk.sleeps if s >= 2] == [2.0, 7.0, 8.0]
    assert c.stats.retries == 3 and c.stats.network == 4
    assert all(call[3]["User-Agent"] == USER_AGENT for call in t.calls)
    assert all(call[4] == (10.0, 60.0) for call in t.calls)


def test_gives_up_after_max_retries(tmp_path):
    c, t, clk = client(tmp_path, [(500, {}, b"")] * 3, max_retries=2)
    with pytest.raises(HttpError) as e:
        c.get("src", "https://a.example/x")
    assert e.value.status == 500
    assert len(t.calls) == 3
    # 5xx is never cached
    c2, _, _ = client(tmp_path, [], offline=True)
    with pytest.raises(OfflineMiss):
        c2.get("src", "https://a.example/x")


def test_network_errors_are_retried(tmp_path):
    c, t, clk = client(tmp_path, [ConnectionError("reset"), TimeoutError("slow"), (200, {}, b"fine")])
    assert c.get("src", "https://a.example/y").text() == "fine"
    c, t, clk = client(tmp_path, [ConnectionError("reset")] * 2, max_retries=1)
    with pytest.raises(HttpError, match="network error"):
        c.get("src", "https://a.example/z")


def test_cache_then_offline(tmp_path):
    c, t, clk = client(tmp_path, [(200, {"content-type": "text/html"}, b"<p>hi</p>"), (404, {}, b"none")])
    first = c.get("src", "https://a.example/page")
    again = c.get("src", "https://a.example/page")
    assert again.from_cache and again.content == first.content and again.content_type == "text/html"
    assert again.fetched_at == "2026-10-01T00:00:00Z"
    assert len(t.calls) == 1
    assert c.get("src", "https://a.example/missing").status == 404  # definite answers are cached too
    off, t2, _ = client(tmp_path, [], offline=True)
    assert off.get("src", "https://a.example/page").text() == "<p>hi</p>"
    assert off.get("src", "https://a.example/missing").status == 404
    with pytest.raises(OfflineMiss):
        off.get("src", "https://a.example/never")
    with pytest.raises(OfflineMiss):
        off.get("other-src", "https://a.example/page")  # cache is per source folder
    assert t2.calls == [] and off.stats.offline_misses == 2


def test_cache_is_content_addressed_and_keyed_by_body(tmp_path):
    c, t, clk = client(tmp_path, [(200, {}, b"same"), (200, {}, b"same"), (200, {}, b"other")])
    c.get("src", "https://a.example/1")
    c.get("src", "https://a.example/2")
    c.post("src", "https://a.example/1", "data=x")  # same URL, POST with a body: a different request
    blobs = [p for p in (tmp_path / "cache/src/blobs").rglob("*") if p.is_file()]
    reqs = [p for p in (tmp_path / "cache/src/req").rglob("*.json") if p.is_file()]
    assert len(blobs) == 2 and len(reqs) == 3
    assert t.calls[2][3]["Content-Type"] == "application/x-www-form-urlencoded" and t.calls[2][2] == b"data=x"


def test_max_age_refetch_and_stale_fallback(tmp_path):
    now = [NOW]
    c, t, clk = client(tmp_path, [(200, {}, b"v1"), (200, {}, b"v2"), (503, {}, b""), (503, {}, b"")], now=lambda: now[0], max_retries=1)
    assert c.get("src", "https://a.example/list", max_age_days=30).text() == "v1"
    now[0] = NOW + timedelta(days=10)
    assert c.get("src", "https://a.example/list", max_age_days=30).text() == "v1"  # fresh enough
    now[0] = NOW + timedelta(days=31)
    assert c.get("src", "https://a.example/list", max_age_days=30).text() == "v2"  # refetched
    now[0] = NOW + timedelta(days=90)
    r = c.get("src", "https://a.example/list", max_age_days=30)  # server down: stale copy beats nothing
    assert r.text() == "v2" and r.from_cache
    assert c.get("src", "https://a.example/list").text() == "v2"  # no max age: never refetched


def test_fixture_transport(tmp_path):
    root = tmp_path / "fx"
    root.mkdir()
    (root / "a.json").write_text('{"a": 1}')
    (root / "index.json").write_text('{"bbox": {"MN": [0, 0, 1, 1]}, "entries": [{"url": "https://f.example/a", "file": "a.json", "content_type": "application/json"}, {"method": "POST", "url": "https://f.example/q", "body": "data=1", "file": "a.json"}]}')
    ft = FixtureTransport(root)
    assert ft.meta == {"bbox": {"MN": [0, 0, 1, 1]}}
    c = Client(tmp_path / "cache", transport=ft, sleep=lambda s: None, now=lambda: NOW)
    assert c.get("fx", "https://f.example/a").json() == {"a": 1}
    assert c.post("fx", "https://f.example/q", "data=1").json() == {"a": 1}
    assert c.get("fx", "https://f.example/nope").status == 404
    assert ft.misses == ["https://f.example/nope"]
