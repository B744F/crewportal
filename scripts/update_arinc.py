#!/usr/bin/env python3
"""Update CrewPortal Pacific HF data every 15 minutes.

Stores only:
- North America to Asia
- Alaska/North Pacific (West of 150W)
- Guam Area

Primary and Secondary only.
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

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
        elif self.cell_depth and tag in {"br", "p", "div"}:
            self.parts.append(" ")

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
    value = re.sub(r"\s+", " ", value).strip().lower()
    return value.replace(" / ", "/")


def number(cell):
    match = re.fullmatch(r"\s*(\d{4,5})(?:\s*khz)?\s*", cell, re.I)
    if not match:
        raise RuntimeError(f"Invalid frequency cell: {cell!r}")
    value = int(match.group(1))
    if not 2000 <= value <= 22000:
        raise RuntimeError(f"Frequency out of range: {value}")
    return value


def find_row(rows, label):
    target = normalize(label)
    matches = []
    for cells in rows:
        if len(cells) < 3 or normalize(cells[0]) != target:
            continue
        matches.append((number(cells[1]), number(cells[2])))
    if len(matches) != 1:
        raise RuntimeError(f"Expected one row for {label}; got {len(matches)}")
    return matches[0]


def main():
    request = Request(
        SOURCE,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; CrewPortal-PacificHF/1.0)",
            "Accept": "text/html,application/xhtml+xml",
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(request, timeout=30) as response:
        markup = response.read().decode("utf-8", errors="replace")

    text = re.sub(r"<[^>]+>", " ", markup)
    valid_match = re.search(
        r"Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        html.unescape(text),
        re.I,
    )
    if not valid_match:
        raise RuntimeError("Valid from heading not found")

    valid_raw = re.sub(r"\s+", " ", valid_match.group(1)).strip()
    valid_dt = datetime.strptime(valid_raw, "%B %d, %Y, %H%MZ").replace(tzinfo=timezone.utc)

    parser = TableParser()
    parser.feed(markup)

    na = find_row(parser.rows, "North America to Asia")
    alaska = find_row(parser.rows, "Alaska/North Pacific (West of 150W)")
    guam = find_row(parser.rows, "Guam Area")

    data = {
        "schemaVersion": 4,
        "source": SOURCE,
        "validFrom": valid_raw,
        "validFromUtc": valid_dt.isoformat().replace("+00:00", "Z"),
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "northAmericaAsia": {"primary": na[0], "secondary": na[1]},
        "alaskaNorthPacific": {"primary": alaska[0], "secondary": alaska[1]},
        "guamArea": {"primary": guam[0], "secondary": guam[1]},
    }

    previous = None
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            pass

    comparable = ("validFromUtc", "northAmericaAsia", "alaskaNorthPacific", "guamArea")
    if previous and all(previous.get(k) == data.get(k) for k in comparable):
        print("Pacific HF assignment unchanged.")
        return 0

    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated data/arinc.json")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
