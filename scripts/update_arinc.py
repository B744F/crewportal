#!/usr/bin/env python3
"""Update data/arinc.json for a GitHub Pages deployment.

GitHub Pages cannot execute server-side code. This script is run by GitHub
Actions at UTC minute 05 every hour and commits the latest valid assignment.
Only Primary and Secondary are stored; Tertiary is intentionally ignored.
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def page_text(markup: str) -> str:
    markup = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", markup, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", markup)
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_valid_from(text: str) -> tuple[str, datetime]:
    match = re.search(
        r"Pacific\s+HF\s+Frequency\s+Assignments\s+Valid\s+from\s+"
        r"([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        text,
        flags=re.I,
    )
    if not match:
        raise RuntimeError("Could not locate the heading-level Valid from value")
    raw = re.sub(r"\s+", " ", match.group(1)).strip()
    dt = datetime.strptime(raw, "%B %d, %Y, %H%MZ").replace(tzinfo=timezone.utc)
    return raw, dt


def frequencies(text: str, label_pattern: str) -> tuple[int, int]:
    match = re.search(
        label_pattern + r"\s+Air\s+Traffic\s+Control\s+(\d{4,5})\s*kHz\s+(\d{4,5})\s*kHz",
        text,
        flags=re.I,
    )
    if not match:
        raise RuntimeError(f"Could not locate frequencies for {label_pattern}")
    return int(match.group(1)), int(match.group(2))


def request_text(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache, no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )
    with urlopen(request, timeout=35) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_candidates() -> list[tuple[str, str]]:
    stamp = str(int(time.time()))
    urls = [
        ("direct", SOURCE + "?crewportal=" + stamp),
        ("direct-index", SOURCE + "index.html?crewportal=" + stamp),
        ("google-translate", "https://radio-arinc-net.translate.goog/pacific/?_x_tr_sl=en&_x_tr_tl=en&_x_tr_hl=en&crewportal=" + stamp),
        ("jina-reader", "https://r.jina.ai/http://radio.arinc.net/pacific/?crewportal=" + stamp),
    ]
    results: list[tuple[str, str]] = []
    errors: list[str] = []
    for name, url in urls:
        try:
            results.append((name, request_text(url)))
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    if not results:
        raise RuntimeError("All ARINC requests failed: " + " | ".join(errors))
    for error in errors:
        print("Request warning:", error, file=sys.stderr)
    return results


def main() -> int:
    candidates = []
    for route, markup in fetch_candidates():
        try:
            text = page_text(markup)
            valid_raw, valid_dt = parse_valid_from(text)
            na_primary, na_secondary = frequencies(text, r"North\s+America\s*(?:→|&rarr;|->|to)\s*Asia")
            ak_primary, ak_secondary = frequencies(text, r"Alaska/North\s+Pacific\s*\(West\s+of\s+150W\)")
            candidates.append({
                "route": route,
                "valid_raw": valid_raw,
                "valid_dt": valid_dt,
                "na_primary": na_primary,
                "na_secondary": na_secondary,
                "ak_primary": ak_primary,
                "ak_secondary": ak_secondary,
            })
            print(f"Candidate {route}: {valid_raw}")
        except Exception as exc:
            print(f"Ignored unusable response from {route}: {exc}", file=sys.stderr)

    if not candidates:
        raise RuntimeError("No response contained a complete assignment table")

    newest = max(candidates, key=lambda item: item["valid_dt"])
    valid_dt = newest["valid_dt"]
    data = {
        "source": SOURCE,
        "route": newest["route"],
        "validFrom": newest["valid_raw"],
        "validFromUtc": valid_dt.isoformat().replace("+00:00", "Z"),
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "northAmericaAsia": {"primary": newest["na_primary"], "secondary": newest["na_secondary"]},
        "alaskaNorthPacific": {"primary": newest["ak_primary"], "secondary": newest["ak_secondary"]},
    }

    previous = None
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    comparable = ("source", "route", "validFrom", "validFromUtc", "northAmericaAsia", "alaskaNorthPacific")
    if previous and all(previous.get(key) == data.get(key) for key in comparable):
        print(f"Assignments unchanged ({data['validFrom']})")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {OUTPUT} via {newest['route']} ({data['validFrom']})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
