#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright

SOURCE = "https://radio.arinc.net/pacific/"

OUT = Path(__file__).resolve().parents[1] / "debug_arinc.html"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/128 Safari/537.36"
        )
    )

    page.goto(SOURCE, wait_until="networkidle", timeout=60000)

    html = page.content()

    OUT.write_text(html, encoding="utf-8")

    print("Saved:", OUT)
    print("Title:", page.title())
    print("Tables:", page.locator("table").count())
    print("Rows:", page.locator("tr").count())

    browser.close()
