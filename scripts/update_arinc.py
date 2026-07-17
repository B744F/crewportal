#!/usr/bin/env python3
"""Fetch and publish the newest ARINC Pacific HF assignment for GitHub Pages.

v6.0.1: routes are fetched concurrently with strict per-request timeouts so a
slow public proxy cannot stall the GitHub Actions job.
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"
REQUEST_TIMEOUT = 10
MAX_WORKERS = 8


def page_text(markup: str) -> str:
    markup = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", markup, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", markup)
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_valid_from(text: str) -> tuple[str, datetime]:
    patterns = [
        r"Pacific\s+HF\s+Frequency\s+Assignments\s+Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        r"Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            raw = re.sub(r"\s+", " ", match.group(1)).strip()
            dt = datetime.strptime(raw, "%B %d, %Y, %H%MZ").replace(tzinfo=timezone.utc)
            return raw, dt
    raise RuntimeError("Valid from heading not found")


def frequencies(text: str, label_pattern: str) -> tuple[int, int]:
    match = re.search(
        label_pattern + r"\s+Air\s+Traffic\s+Control\s+(\d{4,5})\s*kHz\s+(\d{4,5})\s*kHz",
        text,
        flags=re.I,
    )
    if not match:
        raise RuntimeError(f"Frequencies not found for {label_pattern}")
    return int(match.group(1)), int(match.group(2))


def request_text(url: str, *, json_wrapper: bool = False) -> str:
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache",
    })
    with urlopen(req, timeout=REQUEST_TIMEOUT) as response:
        body = response.read().decode("utf-8", errors="replace")
    if json_wrapper:
        payload = json.loads(body)
        body = payload.get("contents") or payload.get("body") or ""
    return body


def fetch_route(route: tuple[str, str, bool]) -> dict:
    name, url, wrapped = route
    text = page_text(request_text(url, json_wrapper=wrapped))
    valid_raw, valid_dt = parse_valid_from(text)
    na = frequencies(text, r"North\s+America\s*(?:→|&rarr;|->|to)\s*Asia")
    ak = frequencies(text, r"Alaska/North\s+Pacific\s*\(West\s+of\s+150W\)")
    return {"route": name, "valid_raw": valid_raw, "valid_dt": valid_dt, "na": na, "ak": ak}


def fetch_candidates() -> list[dict]:
    stamp = str(int(time.time()))
    encoded = quote(SOURCE, safe="")
    routes = [
        ("direct-query", f"{SOURCE}?crewportal={stamp}", False),
        ("direct-index", f"{SOURCE}index.html?crewportal={stamp}", False),
        ("direct-fragment", f"{SOURCE}?_={stamp}#crewportal", False),
        ("google-translate", f"https://radio-arinc-net.translate.goog/pacific/?_x_tr_sl=en&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp&crewportal={stamp}", False),
        ("jina-https", f"https://r.jina.ai/https://radio.arinc.net/pacific/?crewportal={stamp}", False),
        ("jina-http", f"https://r.jina.ai/http://radio.arinc.net/pacific/?crewportal={stamp}", False),
        ("allorigins", f"https://api.allorigins.win/get?url={encoded}%3Fcrewportal%3D{stamp}", True),
        ("corsproxy", f"https://corsproxy.io/?url={encoded}%3Fcrewportal%3D{stamp}", False),
    ]

    parsed: list[dict] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_route, route): route[0] for route in routes}
        for future in as_completed(futures):
            name = futures[future]
            try:
                item = future.result()
                parsed.append(item)
                print(f"Candidate {name}: {item['valid_raw']} | NA {item['na'][0]}/{item['na'][1]} | AK {item['ak'][0]}/{item['ak'][1]}")
            except Exception as exc:
                print(f"Route {name} unavailable: {exc}", file=sys.stderr)
    return parsed


def main() -> int:
    candidates = fetch_candidates()
    if not candidates:
        raise RuntimeError("No complete ARINC response was available")
    newest = max(candidates, key=lambda x: x["valid_dt"])
    now = datetime.now(timezone.utc)
    data = {
        "schemaVersion": 2,
        "source": SOURCE,
        "route": newest["route"],
        "validFrom": newest["valid_raw"],
        "validFromUtc": newest["valid_dt"].isoformat().replace("+00:00", "Z"),
        "fetchedAtUtc": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "northAmericaAsia": {"primary": newest["na"][0], "secondary": newest["na"][1]},
        "alaskaNorthPacific": {"primary": newest["ak"][0], "secondary": newest["ak"][1]},
        "diagnostics": [
            {"route": c["route"], "validFrom": c["valid_raw"]}
            for c in sorted(candidates, key=lambda x: x["valid_dt"], reverse=True)
        ],
    }
    previous = None
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    keys = ("validFromUtc", "northAmericaAsia", "alaskaNorthPacific")
    if previous and all(previous.get(k) == data.get(k) for k in keys):
        previous.update({
            "route": data["route"],
            "fetchedAtUtc": data["fetchedAtUtc"],
            "diagnostics": data["diagnostics"],
            "schemaVersion": 2,
        })
        OUTPUT.write_text(json.dumps(previous, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Assignments unchanged; heartbeat refreshed ({data['validFrom']})")
        return 0
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Selected {newest['route']}: {data['validFrom']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
