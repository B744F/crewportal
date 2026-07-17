#!/usr/bin/env python3
"""Safely update the ARINC Pacific HF assignment used by CrewPortal.

v6.1 changes:
- Parse the actual HTML table row and its cells instead of matching numbers in
  flattened page text.
- Treat the valid date and both requested rows as one atomic assignment.
- Never replace a newer stored assignment with an older cached response.
- For a same-date frequency change, require agreement from two independent
  routes unless the official direct route supplies it.
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

SOURCE = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"
REQUEST_TIMEOUT = 10
MAX_WORKERS = 8
DIRECT_ROUTES = {"direct-query", "direct-index", "direct-fragment"}


class TableRowParser(HTMLParser):
    """Collect visible text from each HTML table row and cell."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._in_row = False
        self._cell_depth = 0
        self._cells: list[str] = []
        self._cell_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        tag = tag.lower()
        if tag == "tr":
            self._in_row = True
            self._cells = []
        elif self._in_row and tag in {"td", "th"}:
            self._cell_depth += 1
            if self._cell_depth == 1:
                self._cell_parts = []
        elif self._cell_depth and tag in {"br", "p", "div"}:
            self._cell_parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._in_row and tag in {"td", "th"} and self._cell_depth:
            self._cell_depth -= 1
            if self._cell_depth == 0:
                cell = normalize("".join(self._cell_parts))
                self._cells.append(cell)
                self._cell_parts = []
        elif tag == "tr" and self._in_row:
            if self._cells:
                self.rows.append(self._cells)
            self._in_row = False
            self._cell_depth = 0
            self._cells = []
            self._cell_parts = []

    def handle_data(self, data: str) -> None:
        if self._cell_depth:
            self._cell_parts.append(data)


def normalize(value: str) -> str:
    value = html.unescape(value).replace("\xa0", " ")
    value = value.replace("&rarr;", "→").replace("->", "→")
    return re.sub(r"\s+", " ", value).strip()


def page_text(markup: str) -> str:
    markup = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", markup, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", markup)
    return normalize(text)


def parse_valid_from(markup: str) -> tuple[str, datetime]:
    text = page_text(markup)
    match = re.search(
        r"Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        text,
        flags=re.I,
    )
    if not match:
        raise RuntimeError("Valid from heading not found")
    raw = normalize(match.group(1))
    dt = datetime.strptime(raw, "%B %d, %Y, %H%MZ").replace(tzinfo=timezone.utc)
    return raw, dt


def number_from_cell(cell: str) -> int:
    match = re.fullmatch(r"\s*(\d{4,5})(?:\s*kHz)?\s*", cell, flags=re.I)
    if not match:
        raise RuntimeError(f"Invalid frequency cell: {cell!r}")
    value = int(match.group(1))
    if not 2000 <= value <= 22000:
        raise RuntimeError(f"Frequency out of range: {value}")
    return value


def canonical_label(value: str) -> str:
    value = normalize(value).lower().replace("→", "to")
    value = re.sub(r"\s+", " ", value)
    return value


def find_row(rows: list[list[str]], wanted: str) -> tuple[int, int]:
    wanted_key = canonical_label(wanted)
    matches: list[tuple[int, int]] = []
    for cells in rows:
        if len(cells) < 3:
            continue
        if canonical_label(cells[0]) != wanted_key:
            continue
        try:
            primary = number_from_cell(cells[1])
            secondary = number_from_cell(cells[2])
        except RuntimeError:
            continue
        if primary == secondary:
            raise RuntimeError(f"Primary equals secondary for {wanted}")
        matches.append((primary, secondary))
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one complete table row for {wanted}; got {len(matches)}")
    return matches[0]


def parse_assignment(markup: str) -> dict:
    valid_raw, valid_dt = parse_valid_from(markup)
    parser = TableRowParser()
    parser.feed(markup)
    parser.close()
    if not parser.rows:
        raise RuntimeError("No HTML table rows found")

    na = find_row(parser.rows, "North America to Asia")
    ak = find_row(parser.rows, "Alaska/North Pacific (West of 150W)")
    return {"valid_raw": valid_raw, "valid_dt": valid_dt, "na": na, "ak": ak}


def request_text(url: str, *, json_wrapper: bool = False) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache, no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )
    with urlopen(req, timeout=REQUEST_TIMEOUT) as response:
        body = response.read().decode("utf-8", errors="replace")
    if json_wrapper:
        payload = json.loads(body)
        body = payload.get("contents") or payload.get("body") or ""
    return body


def fetch_route(route: tuple[str, str, bool]) -> dict:
    name, url, wrapped = route
    assignment = parse_assignment(request_text(url, json_wrapper=wrapped))
    assignment["route"] = name
    return assignment


def fetch_candidates() -> list[dict]:
    stamp = str(int(time.time()))
    encoded = quote(SOURCE, safe="")
    routes = [
        ("direct-query", f"{SOURCE}?crewportal={stamp}", False),
        ("direct-index", f"{SOURCE}index.html?crewportal={stamp}", False),
        ("direct-fragment", f"{SOURCE}?_={stamp}#crewportal", False),
        ("google-translate", f"https://radio-arinc-net.translate.goog/pacific/?_x_tr_sl=en&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp&crewportal={stamp}", False),
        ("allorigins", f"https://api.allorigins.win/get?url={encoded}%3Fcrewportal%3D{stamp}", True),
        ("corsproxy", f"https://corsproxy.io/?url={encoded}%3Fcrewportal%3D{stamp}", False),
    ]

    parsed: list[dict] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_route, route): route[0] for route in routes}
        for future in as_completed(futures):
            name = futures[future]
            try:
                item = future.result()
                parsed.append(item)
                print(
                    f"Candidate {name}: {item['valid_raw']} | "
                    f"NA {item['na'][0]}/{item['na'][1]} | AK {item['ak'][0]}/{item['ak'][1]}"
                )
            except Exception as exc:
                print(f"Route {name} unavailable: {exc}", file=sys.stderr)
    return parsed


def assignment_key(item: dict) -> tuple:
    return (item["valid_dt"], item["na"], item["ak"])


def choose_candidate(candidates: list[dict], previous: dict | None) -> dict | None:
    if not candidates:
        return None

    previous_dt = None
    previous_key = None
    if previous and previous.get("validFromUtc"):
        previous_dt = datetime.fromisoformat(previous["validFromUtc"].replace("Z", "+00:00"))
        previous_key = (
            previous_dt,
            (previous["northAmericaAsia"]["primary"], previous["northAmericaAsia"]["secondary"]),
            (previous["alaskaNorthPacific"]["primary"], previous["alaskaNorthPacific"]["secondary"]),
        )

    newest_dt = max(c["valid_dt"] for c in candidates)
    if previous_dt and newest_dt < previous_dt:
        print(f"All fetched assignments are older than stored data ({newest_dt} < {previous_dt}); keeping stored data.")
        return None

    newest = [c for c in candidates if c["valid_dt"] == newest_dt]
    counts = Counter(assignment_key(c) for c in newest)
    winner_key, winner_count = counts.most_common(1)[0]
    winners = [c for c in newest if assignment_key(c) == winner_key]

    # A newer dated assignment can be accepted from one complete route. For a
    # same-date frequency mutation, demand either an official direct response or
    # agreement from at least two routes.
    if previous_dt and newest_dt == previous_dt and previous_key != winner_key:
        has_direct = any(c["route"] in DIRECT_ROUTES for c in winners)
        if winner_count < 2 and not has_direct:
            raise RuntimeError("Same-date frequency change lacked independent confirmation")

    route_priority = {name: index for index, name in enumerate(DIRECT_ROUTES)}
    winners.sort(key=lambda c: (c["route"] not in DIRECT_ROUTES, route_priority.get(c["route"], 99)))
    selected = winners[0]
    selected["agreementCount"] = winner_count
    return selected


def load_previous() -> dict | None:
    if not OUTPUT.exists():
        return None
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        return None


def main() -> int:
    previous = load_previous()
    candidates = fetch_candidates()
    selected = choose_candidate(candidates, previous)
    if selected is None:
        if previous:
            print("No safe replacement selected; existing verified assignment retained.")
            return 0
        raise RuntimeError("No complete ARINC response was available")

    now = datetime.now(timezone.utc)
    data = {
        "schemaVersion": 3,
        "source": SOURCE,
        "route": selected["route"],
        "agreementCount": selected["agreementCount"],
        "validFrom": selected["valid_raw"],
        "validFromUtc": selected["valid_dt"].isoformat().replace("+00:00", "Z"),
        "fetchedAtUtc": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "northAmericaAsia": {"primary": selected["na"][0], "secondary": selected["na"][1]},
        "alaskaNorthPacific": {"primary": selected["ak"][0], "secondary": selected["ak"][1]},
        "diagnostics": [
            {
                "route": c["route"],
                "validFrom": c["valid_raw"],
                "northAmericaAsia": list(c["na"]),
                "alaskaNorthPacific": list(c["ak"]),
            }
            for c in sorted(candidates, key=lambda x: x["valid_dt"], reverse=True)
        ],
    }

    comparable = ("validFromUtc", "northAmericaAsia", "alaskaNorthPacific")
    if previous and all(previous.get(k) == data.get(k) for k in comparable):
        print(f"Assignments unchanged ({data['validFrom']}); no repository write needed.")
        return 0

    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Selected {selected['route']} with {selected['agreementCount']} agreeing route(s): {data['validFrom']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARINC update failed: {exc}", file=sys.stderr)
        raise
