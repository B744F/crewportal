#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def clean(text):
    text = html.unescape(text).replace("\xa0", " ")
    text = text.replace("→", "to").replace("->", "to")
    return re.sub(r"\s+", " ", text).strip().lower()


def get_frequency(value):
    m = re.search(r"(\d{4,5})", value)
    if not m:
        raise RuntimeError(f"Frequency missing: {value}")
    return int(m.group(1))


def parse_rows(rows):
    result = {}

    for row in rows:
        cells = [clean(x) for x in row]
        if len(cells) < 3:
            continue

        name = cells[0]

        if name in [
            "north america to asia",
            "alaska/north pacific (west of 150w)",
            "guam area",
        ]:
            result[name] = {
                "primary": get_frequency(cells[1]),
                "secondary": get_frequency(cells[2]),
            }

    return result


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/128 Safari/537.36"
            )
        )

        page.goto(SOURCE, wait_until="networkidle", timeout=60000)

        rows = page.locator("tr").evaluate_all(
            """
            rows => rows.map(
              r => Array.from(r.querySelectorAll('td,th'))
              .map(c => c.innerText)
            )
            """
        )

        browser.close()

    data = parse_rows(rows)

    required = [
        "north america to asia",
        "alaska/north pacific (west of 150w)",
        "guam area",
    ]

    for item in required:
        if item not in data:
            raise RuntimeError(f"Missing region: {item}")

    output = {
        "schemaVersion": 5,
        "source": SOURCE,
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(),
        "northAmericaAsia": data["north america to asia"],
        "alaskaNorthPacific": data["alaska/north pacific (west of 150w)"],
        "guamArea": data["guam area"],
    }

    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Updated data/arinc.json")


if __name__ == "__main__":
    main()
