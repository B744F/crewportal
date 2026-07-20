#!/usr/bin/env python3
"""Update CrewPortal Pacific HF data every 15 minutes."""

from __future__ import annotations

import html
import json
import re
import sys
import ssl
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.in_row = False
        self.cell_depth = 0
        self.cells = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "tr":
            self.in_row = True
            self.cells = []
        elif self.in_row and tag in {"td", "th"}:
            self.cell_depth += 1
            if self.cell_depth == 1:
                self.parts = []

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.in_row and tag in {"td", "th"} and self.cell_depth:
            self.cell_depth -= 1
            if self.cell_depth == 0:
                self.cells.append(normalize("".join(self.parts)))
        elif tag == "tr" and self.in_row:
            if self.cells:
                self.rows.append(self.cells)
            self.in_row = False
            self.cell_depth = 0

    def handle_data(self, data):
        if self.cell_depth:
            self.parts.append(data)


def normalize(value):
    value = html.unescape(value).replace("\xa0", " ")
    value = value.replace("→", "to").replace("->", "to")
    return re.sub(r"\s+", " ", value).strip().lower()


def number(cell):
    match = re.search(r"(\d{4,5})", cell)
    if not match:
        raise RuntimeError(f"Invalid frequency: {cell}")
    return int(match.group(1))


def find_row(rows, label):
    target = normalize(label)
    for cells in rows:
        if len(cells) >= 3 and normalize(cells[0]) == target:
            return number(cells[1]), number(cells[2])
    raise RuntimeError(f"Region not found: {label}")


def build_request():
    return Request(
        SOURCE,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/128.0 Safari/537.36"
            ),
            "Accept": (
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://radio.arinc.net/",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )


def fetch_arinc():
    request = build_request()

    try:
        context = ssl.create_default_context()
        with urlopen(request, timeout=30, context=context) as response:
            return response.read().decode("utf-8", errors="replace")

    except ssl.SSLCertVerificationError:
        pass

    except URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" not in str(e):
            raise

    except HTTPError as e:
        if e.code != 403:
            raise

    print("Retrying ARINC request with browser headers and relaxed SSL...")

    context = ssl._create_unverified_context()

    with urlopen(
        build_request(),
        timeout=30,
        context=context
    ) as response:
        return response.read().decode("utf-8", errors="replace")


def main():
    markup = fetch_arinc()

    text = re.sub(r"<[^>]+>", " ", markup)

    valid = re.search(
        r"Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        html.unescape(text),
        re.I,
    )

    if not valid:
        raise RuntimeError("Valid from not found")

    parser = TableParser()
    parser.feed(markup)

    na = find_row(parser.rows, "North America to Asia")
    alaska = find_row(parser.rows, "Alaska/North Pacific (West of 150W)")
    guam = find_row(parser.rows, "Guam Area")

    data = {
        "schemaVersion": 4,
        "source": SOURCE,
        "validFrom": valid.group(1),
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(),
        "northAmericaAsia": {
            "primary": na[0],
            "secondary": na[1],
        },
        "alaskaNorthPacific": {
            "primary": alaska[0],
            "secondary": alaska[1],
        },
        "guamArea": {
            "primary": guam[0],
            "secondary": guam[1],
        },
    }

    OUTPUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Updated data/arinc.json")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
