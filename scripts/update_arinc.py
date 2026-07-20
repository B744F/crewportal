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
    text = text.replace("→", " ").replace("->", " ")
    return re.sub(r"\s+", " ", text).strip().lower()


def get_frequency(value):
    match = re.search(r"\d{4,5}", value)
    if not match:
        raise RuntimeError(f"Frequency missing: {value}")
    return int(match.group())


def identify_region(name):
    n = clean(name)

    if "north" in n and "america" in n and "asia" in n:
        return "northAmericaAsia"

    if "alaska" in n and "150" in n:
        return "alaskaNorthPacific"

    if "guam" in n:
        return "guamArea"

    return None


def parse_rows(rows):
    result = {}

    for row in rows:
        if len(row) < 3:
            continue

        region = identify_region(row[0])

        if region:
            result[region] = {
                "primary": get_frequency(row[1]),
                "secondary": get_frequency(row[2]),
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

        page.goto(
            SOURCE,
            wait_until="networkidle",
            timeout=60000
        )

        rows = page.locator("tr").evaluate_all(
            """
            rows => rows.map(
              row => Array.from(
                row.querySelectorAll("td,th")
              ).map(
                cell => cell.innerText
              )
            )
            """
        )

        browser.close()


    data = parse_rows(rows)


    required = [
        "northAmericaAsia",
        "alaskaNorthPacific",
        "guamArea",
    ]


    for item in required:
        if item not in data:
            raise RuntimeError(
                f"Missing region: {item}"
            )


    output = {
        "schemaVersion": 6,
        "source": SOURCE,
        "fetchedAtUtc": datetime.now(
            timezone.utc
        ).isoformat(),
        "northAmericaAsia": data["northAmericaAsia"],
        "alaskaNorthPacific": data["alaskaNorthPacific"],
        "guamArea": data["guamArea"],
    }


    OUTPUT.write_text(
        json.dumps(
            output,
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8",
    )


    print("Updated data/arinc.json")


if __name__ == "__main__":
    main()
