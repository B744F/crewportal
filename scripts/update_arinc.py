#!/usr/bin/env python3
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


def frequency(value: str) -> int:
    match = re.search(r"\b(\d{4,5})\b", value)
    if not match:
        raise RuntimeError(f"Frequency not found in cell: {value!r}")
    result = int(match.group(1))
    if not 2000 <= result <= 22000:
        raise RuntimeError(f"Frequency out of expected range: {result}")
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
            "User-Agent": "CrewPortal-PacificHF/2.0",
            "Accept": "text/html,application/xhtml+xml",
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(request, timeout=45) as response:
        html = response.read().decode("utf-8", errors="replace")
    if "403 Forbidden" in html:
        raise RuntimeError("Cloudflare Worker returned the ARINC 403 page")
    if "ARINC request failed" in html:
        raise RuntimeError(f"Cloudflare Worker error: {html[:300]}")
    return html


def parse_assignments(html: str) -> dict[str, dict[str, int]]:
    soup = BeautifulSoup(html, "html.parser")
    assignments: dict[str, dict[str, int]] = {}
    for row in soup.select("tr"):
        cells = [
            re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()
            for cell in row.select("th, td")
        ]
        if len(cells) < 3:
            continue
        region = identify_region(cells[0])
        if not region:
            continue
        assignments[region] = {
            "primary": frequency(cells[1]),
            "secondary": frequency(cells[2]),
        }

    required = {"northAmericaAsia", "alaskaNorthPacific", "guamArea"}
    missing = sorted(required - assignments.keys())
    if missing:
        labels = [normalize(row.get_text(" ", strip=True)) for row in soup.select("tr")]
        useful = [
            label for label in labels
            if any(word in label for word in ("america", "asia", "alaska", "guam"))
        ]
        raise RuntimeError(
            "Missing region(s): " + ", ".join(missing)
            + "; matching rows seen: " + repr(useful[:20])
        )
    return assignments


def main() -> int:
    html = fetch_html()
    assignments = parse_assignments(html)
    data = {
        "schemaVersion": 8,
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
