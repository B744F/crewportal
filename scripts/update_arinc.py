#!/usr/bin/env python3
"""Fetch ARINC Pacific assignments and update data/arinc.json.

The page can be served through more than one cache layer. We therefore request
several URL variants, parse the header-level "Valid from" value from each
response, and keep the newest valid assignment. Only Primary and Secondary are
stored; Tertiary is intentionally ignored.
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
    # Anchor the match to the page heading so unrelated dates lower in the page
    # cannot be mistaken for the assignment's actual effective time.
    match = re.search(
        r"Pacific\s+HF\s+Frequency\s+Assignments\s+Valid\s+from\s+"
        r"([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        text,
        flags=re.I,
    )
    if not match:
        raise RuntimeError("Could not locate header-level ARINC validity time")
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


def fetch_candidates() -> list[tuple[str, str]]:
    stamp = str(int(time.time()))
    urls = [
        SOURCE,
        SOURCE + "?nocache=" + stamp,
        SOURCE.rstrip("/") + "?nocache=" + stamp,
        SOURCE + "index.html?nocache=" + stamp,
    ]
    results: list[tuple[str, str]] = []
    errors: list[str] = []
    for url in urls:
        try:
            request = Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache, no-store, max-age=0",
                    "Pragma": "no-cache",
                },
            )
            with urlopen(request, timeout=30) as response:
                markup = response.read().decode("utf-8", errors="replace")
            results.append((url, markup))
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    if not results:
        raise RuntimeError("All ARINC requests failed: " + " | ".join(errors))
    return results


def main() -> int:
    candidates = []
    for url, markup in fetch_candidates():
        try:
            text = page_text(markup)
            valid_raw, valid_dt = parse_valid_from(text)
            na_primary, na_secondary = frequencies(text, r"North\s+America\s*(?:→|&rarr;|->|to)\s*Asia")
            ak_primary, ak_secondary = frequencies(text, r"Alaska/North\s+Pacific\s*\(West\s+of\s+150W\)")
            candidates.append({
                "url": url,
                "text": text,
                "valid_raw": valid_raw,
                "valid_dt": valid_dt,
                "na_primary": na_primary,
                "na_secondary": na_secondary,
                "ak_primary": ak_primary,
                "ak_secondary": ak_secondary,
            })
        except Exception as exc:
            print(f"Ignored unusable ARINC response from {url}: {exc}", file=sys.stderr)

    if not candidates:
        raise RuntimeError("No ARINC response contained a complete current assignment table")

    newest = max(candidates, key=lambda item: item["valid_dt"])
    valid_dt = newest["valid_dt"]
    data = {
        "source": SOURCE,
        "validFrom": newest["valid_raw"],
        "validFromUtc": valid_dt.isoformat().replace("+00:00", "Z"),
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "northAmericaAsia": {
            "primary": newest["na_primary"],
            "secondary": newest["na_secondary"],
        },
        "alaskaNorthPacific": {
            "primary": newest["ak_primary"],
            "secondary": newest["ak_secondary"],
        },
    }

    previous = None
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    # fetchedAtUtc naturally changes every run. Compare only actual assignment data
    # so GitHub does not create unnecessary commits.
    comparable_keys = ("source", "validFrom", "validFromUtc", "northAmericaAsia", "alaskaNorthPacific")
    if previous and all(previous.get(key) == data.get(key) for key in comparable_keys):
        print(f"ARINC assignments unchanged ({data['validFrom']})")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {OUTPUT} from {newest['url']} ({data['validFrom']})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
