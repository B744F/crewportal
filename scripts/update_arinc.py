#!/usr/bin/env python3
"""Fetch the ARINC Pacific page and update data/arinc.json.

Only the requested Primary and Secondary frequencies are stored. Tertiary values
are intentionally ignored.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def page_text(markup: str) -> str:
    markup = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", markup, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", markup)
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def frequencies(text: str, label_pattern: str) -> tuple[int, int]:
    match = re.search(
        label_pattern + r"\s+Air\s+Traffic\s+Control\s+(\d{4,5})\s*kHz\s+(\d{4,5})\s*kHz",
        text,
        flags=re.I,
    )
    if not match:
        raise RuntimeError(f"Could not locate frequencies for {label_pattern}")
    return int(match.group(1)), int(match.group(2))


def main() -> int:
    request = Request(SOURCE, headers={"User-Agent": "FlightDeck-CrewPortal/1.0"})
    with urlopen(request, timeout=30) as response:
        markup = response.read().decode("utf-8", errors="replace")

    text = page_text(markup)
    valid = re.search(r"Valid\s+from\s+(.+?\d{4},\s*\d{4}Z)", text, flags=re.I)
    if not valid:
        raise RuntimeError("Could not locate ARINC validity time")

    na_primary, na_secondary = frequencies(text, r"North\s+America\s*(?:→|&rarr;|->|to)\s*Asia")
    ak_primary, ak_secondary = frequencies(text, r"Alaska/North\s+Pacific\s*\(West\s+of\s+150W\)")

    data = {
        "source": SOURCE,
        "validFrom": valid.group(1).strip(),
        "northAmericaAsia": {"primary": na_primary, "secondary": na_secondary},
        "alaskaNorthPacific": {"primary": ak_primary, "secondary": ak_secondary},
    }

    previous = None
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    if previous == data:
        print("ARINC assignments unchanged")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {OUTPUT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
