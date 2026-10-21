#!/usr/bin/env python3
"""Fetch and validate Taoyuan Metro's official station timetable pages."""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import html
import json
import os
import re
import tempfile
import urllib.request
from zoneinfo import ZoneInfo


SOURCE_URL = "https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-"
OFFICIAL_PAGE = SOURCE_URL
STATIONS = [
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13",
    "A14", "A14A", "A15", "A16", "A17", "A18", "A19", "A20", "A21", "A22",
]
ACTIVE_STATIONS = [station for station in STATIONS if station != "A14"]
TABLE_RE = re.compile(r"<table\b(?P<attrs>[^>]*)>(?P<body>[\s\S]*?)</table>", re.IGNORECASE)
ROW_RE = re.compile(r"<tr\b[^>]*>(?P<body>[\s\S]*?)</tr>", re.IGNORECASE)
INPUT_RE = re.compile(r"<input\b[^>]*>", re.IGNORECASE)
SPAN_RE = re.compile(
    r"<span\b(?P<attrs>[^>]*)>\s*<i\b[^>]*>\s*(?P<minute>\d{1,2})\s*</i>",
    re.IGNORECASE,
)


def attribute(tag: str, name: str) -> str:
    match = re.search(rf"\b{re.escape(name)}\s*=\s*([\"'])(.*?)\1", tag, re.IGNORECASE | re.DOTALL)
    return html.unescape(match.group(2)).strip() if match else ""


def text_content(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", value)).strip()


def official_station_code(station: str) -> str:
    return "A14a" if station == "A14A" else station


def parse_official_page(page: str, station: str, service_date: str) -> list[dict]:
    date_value = ""
    for match in INPUT_RE.finditer(page):
        tag = match.group(0)
        if attribute(tag, "id") == "timetable_date":
            date_value = attribute(tag, "value")
            break
    if date_value != service_date:
        raise RuntimeError(
            f"Official timetable page date mismatch for {station}: {date_value or 'missing'} != {service_date}"
        )

    rows: list[dict] = []
    seen_rows: set[str] = set()
    seen_directions: set[str] = set()
    for table in TABLE_RE.finditer(page):
        attrs = table.group("attrs")
        if "time-table" not in attribute(attrs, "class").split():
            continue
        summary = attribute(attrs, "summary")
        if "往台北" in summary:
            direction = "taipei"
        elif "中壢" in summary:
            direction = "zhongli"
        else:
            continue
        if direction in seen_directions:
            continue
        seen_directions.add(direction)

        for row_match in ROW_RE.finditer(table.group("body")):
            row_html = row_match.group("body")
            hour_match = re.search(
                r"<th\b[^>]*scope\s*=\s*([\"'])row\1[^>]*>([\s\S]*?)</th>",
                row_html,
                re.IGNORECASE,
            )
            if not hour_match:
                continue
            hour_text = text_content(hour_match.group(2))
            if not re.fullmatch(r"\d{1,2}", hour_text):
                continue
            hour = int(hour_text)
            if hour > 23:
                continue

            for span in SPAN_RE.finditer(row_html):
                class_match = re.search(r"\b(des0[1-5])\b", attribute(span.group("attrs"), "class"), re.IGNORECASE)
                if not class_match:
                    continue
                minute = int(span.group("minute"))
                if minute > 59:
                    continue
                marker = class_match.group(1).lower()
                train_type = "express" if marker in {"des01", "des02"} else "commuter"
                time_value = f"{hour:02d}:{minute:02d}"
                key = f"{direction}:{train_type}:{time_value}"
                if key in seen_rows:
                    continue
                seen_rows.add(key)
                rows.append({
                    "direction": direction,
                    "type": train_type,
                    "time": time_value,
                    "hour": hour,
                    "minute": minute,
                })

    expected_directions = {"zhongli"} if station == "A1" else {"taipei"} if station == "A22" else {"taipei", "zhongli"}
    if not expected_directions.issubset(seen_directions) or not rows:
        raise RuntimeError(
            f"Official timetable page returned incomplete rows for {station}: "
            f"directions={sorted(seen_directions)}, rows={len(rows)}"
        )
    return sorted(rows, key=lambda row: (row["direction"], row["hour"], row["minute"], row["type"]))


def fetch_station(station: str, service_date: str) -> tuple[str, list[dict]]:
    url = f"{SOURCE_URL}{official_station_code(station)}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Mozilla/5.0 (compatible; CrewPortal MRT timetable updater)",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        content_type = response.headers.get_content_type()
        payload = response.read()
    if content_type != "text/html" or len(payload) < 10_000:
        raise RuntimeError(f"Official timetable page returned invalid content for {station}: {content_type}, {len(payload)} bytes")
    return station, parse_official_page(payload.decode("utf-8", errors="replace"), station, service_date)


def main() -> None:
    now = dt.datetime.now(ZoneInfo("Asia/Taipei"))
    service_date = now.date().isoformat()
    stations: dict[str, dict] = {"A14": {"rows": [], "sourceRecords": 0}}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_station, station, service_date): station for station in ACTIVE_STATIONS}
        for future in concurrent.futures.as_completed(futures):
            station, rows = future.result()
            stations[station] = {"rows": rows, "sourceRecords": len(rows)}
            print(f"{station}: {len(rows)} rows")

    valid_station_count = sum(bool(stations.get(station, {}).get("rows")) for station in ACTIVE_STATIONS)
    if valid_station_count < 20:
        raise RuntimeError(f"Official MRT pages returned too few usable stations: {valid_station_count}")

    snapshot = {
        "source": "Taoyuan Metro official station timetable pages",
        "sourceUrl": SOURCE_URL,
        "officialPage": OFFICIAL_PAGE,
        "serviceDate": service_date,
        "fetchedAtUtc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "stations": {station: stations[station] for station in STATIONS},
    }
    output_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "mrt-timetable.json")
    directory = os.path.dirname(output_path)
    fd, temp_path = tempfile.mkstemp(prefix="mrt-timetable.", suffix=".json", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(snapshot, output, ensure_ascii=False, separators=(",", ":"))
            output.write("\n")
        os.replace(temp_path, output_path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


if __name__ == "__main__":
    main()
