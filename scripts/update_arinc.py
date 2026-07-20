#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def normalize(text):
    return re.sub(r"\s+", " ", text.lower()).strip()


def find_frequency(text):
    m = re.findall(r"\b\d{4,5}\b", text)
    if not m:
        return None
    return int(m[0])


def detect_region(text):
    t = normalize(text)

    if "north" in t and "america" in t and "asia" in t:
        return "northAmericaAsia"

    if "alaska" in t and ("150" in t or "pacific" in t):
        return "alaskaNorthPacific"

    if "guam" in t:
        return "guamArea"

    return None


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/128 Safari/537.36"
            )
        )

        page.goto(
            SOURCE,
            wait_until="networkidle",
            timeout=60000
        )

        rows = page.locator("tr").evaluate_all(
            """
            rows => rows.map(row =>
                Array.from(row.querySelectorAll("td,th"))
                .map(cell => cell.innerText)
            )
            """
        )

        browser.close()

    result = {}

    for row in rows:
        if len(row) < 3:
            continue

        region = detect_region(row[0])

        if region:
            primary = find_frequency(row[1])
            secondary = find_frequency(row[2])

            if primary and secondary:
                result[region] = {
                    "primary": primary,
                    "secondary": secondary
                }

    required = [
        "northAmericaAsia",
        "alaskaNorthPacific",
        "guamArea"
    ]

    missing = [x for x in required if x not in result]

    if missing:
        raise RuntimeError(
            "Missing region: " + ", ".join(missing)
        )

    data = {
        "schemaVersion": 7,
        "source": SOURCE,
        "fetchedAtUtc": datetime.now(
            timezone.utc
        ).isoformat(),
        **result
    }

    OUTPUT.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        ) + "\n",
        encoding="utf-8"
    )

    print("Updated data/arinc.json")


if __name__ == "__main__":
    main()
