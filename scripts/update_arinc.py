#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import re
import html
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def clean(text):
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


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

        rows = page.locator("body").inner_text()

        print("===== ARINC PAGE TEXT START =====")
        print(rows[:10000])
        print("===== ARINC PAGE TEXT END =====")

        tables = page.locator("table").count()
        print(f"DEBUG TABLE COUNT: {tables}")

        for i in range(tables):
            data = page.locator("table").nth(i).inner_text()
            print(f"===== TABLE {i} =====")
            print(data[:3000])

        browser.close()


if __name__ == "__main__":
    main()
