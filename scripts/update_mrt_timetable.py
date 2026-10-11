#!/usr/bin/env python3
"""Fetch and validate the Taoyuan Metro official structured timetable."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo


SOURCE_URL = "https://opendata.tycg.gov.tw/api/dataset/8e6201c2-1968-4920-aba3-1a68093dab53/resource/83358afd-010a-4989-b63a-bbf20692e408/download"
OFFICIAL_PAGE = "https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-"
STATIONS = [
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13",
    "A14", "A14A", "A15", "A16", "A17", "A18", "A19", "A20", "A21", "A22",
]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def text(element: ET.Element | None, path: str = "") -> str:
    if element is None:
        return ""
    child = element.find(path) if path else element
    return "" if child is None or child.text is None else child.text.strip()


def station_number(value: str) -> int | None:
    match = re.fullmatch(r"A(\d+)(?:A)?", value.upper())
    return int(match.group(1)) if match else None


def runs_today(record: ET.Element, weekday: str) -> bool:
    service_days = record.find("ServiceDays")
    if service_days is None:
        return True
    value = text(service_days, weekday).lower()
    return value in {"1", "true", "yes", "y"}


def clock(value: str) -> tuple[str, int, int] | None:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value.strip())
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}", hour, minute


def direction(record: ET.Element, station: str) -> str | None:
    station_index = station_number(station)
    destination_index = station_number(text(record, "DestinationStationID") or text(record, "DestinationStaionID") or text(record, "DestinStationID"))
    if station_index is None or destination_index is None:
        return None
    code = text(record, "Direction")
    if code == "0" and destination_index > station_index:
        return "zhongli"
    if code == "1" and destination_index < station_index:
        return "taipei"
    return None


def parse_rows(root: ET.Element, station: str, weekday: str) -> tuple[list[dict], int]:
    rows: list[dict] = []
    seen: set[str] = set()
    records = 0
    for record in root.findall(".//StationTimeTable"):
        record_station = text(record, "StationID").upper()
        if record_station != station:
            continue
        records += 1
        if not runs_today(record, weekday):
            continue
        route_direction = direction(record, station)
        if not route_direction:
            continue
        entries = record.findall("./Timetables/Timetable") or record.findall("./Timetable")
        for entry in entries:
            value = text(entry, "DepartureTime") or text(entry, "ArrivalTime")
            parsed_clock = clock(value)
            train_type = text(entry, "TrainType")
            if not parsed_clock or train_type not in {"0", "1", "2", "commuter", "express"}:
                continue
            normalized_type = "express" if train_type in {"2", "express"} else "commuter"
            time_value, hour, minute = parsed_clock
            key = f"{route_direction}:{normalized_type}:{time_value}"
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "direction": route_direction,
                "type": normalized_type,
                "time": time_value,
                "hour": hour,
                "minute": minute,
            })
    return rows, records


def main() -> None:
    now = dt.datetime.now(ZoneInfo("Asia/Taipei"))
    service_date = now.date().isoformat()
    weekday = WEEKDAYS[now.weekday()]
    completed = subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--max-time", "45", SOURCE_URL,
        "-H", "Accept: application/xml,text/xml,*/*",
        "-H", "User-Agent: Mozilla/5.0 (compatible; CrewPortal MRT timetable updater)",
    ], check=True, capture_output=True)
    root = ET.fromstring(completed.stdout.lstrip(b"\xef\xbb\xbf"))
    stations: dict[str, dict] = {}
    valid_station_count = 0
    for station in STATIONS:
        rows, record_count = parse_rows(root, station, weekday)
        stations[station] = {"rows": rows, "sourceRecords": record_count}
        if rows:
            valid_station_count += 1
        print(f"{station}: {len(rows)} rows")
    if valid_station_count < 20:
        raise RuntimeError(f"Official MRT XML returned too few usable stations: {valid_station_count}")

    snapshot = {
        "source": "Taoyuan Metro official timetable via Taoyuan City Open Data",
        "sourceUrl": SOURCE_URL,
        "officialPage": OFFICIAL_PAGE,
        "serviceDate": service_date,
        "weekday": weekday,
        "fetchedAtUtc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "stations": stations,
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
