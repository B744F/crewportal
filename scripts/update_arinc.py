#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright

SOURCE = "https://radio.arinc.net/pacific/"

OUT = Path(__file__).resolve().parents[1] / "arinc_network_log.txt"


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    page = browser.new_page(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/128 Safari/537.36"
        )
    )

    requests = []

    def record(response):
        url = response.url
        rtype = response.request.resource_type
        if rtype in ["xhr", "fetch", "document", "script"]:
            requests.append(
                f"{rtype}: {url}"
            )

    page.on("response", record)

    page.goto(
        SOURCE,
        wait_until="networkidle",
        timeout=60000
    )

    content = page.content()

    OUT.write_text(
        "\n".join(requests) +
        "\n\n===== PAGE TITLE =====\n" +
        page.title() +
        "\n\n===== HTML SIZE =====\n" +
        str(len(content)),
        encoding="utf-8"
    )

    print("Saved network log:", OUT)
    print("Requests:", len(requests))

    browser.close()
