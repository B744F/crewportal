#!/usr/bin/env python3
"""Fetch and update CrewPortal Pacific HF data through Cloudflare Worker."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

WORKER_URL = "https://arinc-proxy.201505-login.workers.dev/"
SOURCE_URL = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def normalize(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = value.replace("→", " to ").replace("->", " to ")
    return re.sub(r"\s+", " ", value).strip().lower()


def frequency_or_none(value: str) -> int | None:
    match = re.search(r"\b(\d{4,5})\b", value)
    if not match:
        return None

    result = int(match.group(1))
    if not 2000 <= result <= 22000:
        return None

    return result


def identify_region(label: str) -> str | None:
    text = normalize(label)

    if "north" in text and "america" in text and "asia" in text:
        return "northAmericaAsia"

    if "alaska" in text and "pacific" in text:
        return "alaskaNorthPacific"

    if "guam" in text:
        return "guamArea"

    return None


def fetch_html() -> str:
    request = Request(
        WORKER_URL,
        headers={
            "User-Agent": "CrewPortal-PacificHF/2.1",
            "Accept": "text/html,application/xhtml+xml",
            "Cache-Control": "no-cache",
        },
    )

    with urlopen(request, timeout=45) as response:
        markup = response.read().decode("utf-8", errors="replace")

    if "403 Forbidden" in markup:
        raise RuntimeError("Cloudflare Worker returned the ARINC 403 page")

    if "ARINC request failed" in markup:
        raise RuntimeError(f"Cloudflare Worker error: {markup[:300]}")

    return markup


def parse_assignments(markup: str) -> dict[str, dict[str, int]]:
    soup = BeautifulSoup(markup, "html.parser")
    assignments: dict[str, dict[str, int]] = {}
    debug_rows: list[list[str]] = []

    for row in soup.select("tr"):
        cells = [
            re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()
            for cell in row.select("th, td")
        ]

        if not cells:
            continue

        joined = " | ".join(cells)
        region = identify_region(joined)

        if not region:
            continue

        debug_rows.append(cells)

        # Ignore navigation/category rows such as:
        # North America → Asia | Air Traffic Control | ...
        frequencies = [
            value
            for cell in cells
            if (value := frequency_or_none(cell)) is not None
        ]

        if len(frequencies) < 2:
            continue

        # The ARINC table orders the desired values as Primary, then Secondary.
        assignments[region] = {
            "primary": frequencies[0],
            "secondary": frequencies[1],
        }

    required = {"northAmericaAsia", "alaskaNorthPacific", "guamArea"}
    missing = sorted(required - assignments.keys())

    if missing:
        raise RuntimeError(
            "Missing region(s): "
            + ", ".join(missing)
            + "; candidate rows: "
            + repr(debug_rows[:30])
        )

    return assignments


def main() -> int:
    markup = fetch_html()
    assignments = parse_assignments(markup)

    data = {
        "schemaVersion": 9,
        "source": SOURCE_URL,
        "proxy": WORKER_URL,
        "fetchedAtUtc": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "northAmericaAsia": assignments["northAmericaAsia"],
        "alaskaNorthPacific": assignments["alaskaNorthPacific"],
        "guamArea": assignments["guamArea"],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Updated data/arinc.json")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
