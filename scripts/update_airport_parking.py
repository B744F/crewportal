#!/usr/bin/env python3
"""Update Taoyuan Airport P1/P2/P4 parking availability from official data."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

OFFICIAL_JSON = os.environ.get(
    "AIRPORT_PARKING_JSON_URL",
    "https://www.taoyuan-airport.com/api/api/thirdparty/park",
)
OFFICIAL_CSV = os.environ.get(
    "AIRPORT_PARKING_CSV_URL",
    "https://odp.taoyuan-airport.com/dataset/2023081813?format=csv",
)

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "airport-parking.json"
TAIPEI = timezone(timedelta(hours=8))
REQUIRED = ("P1", "P2", "P4")
ALL_CODES = ("P1", "P2", "P3", "P4")
TIMEOUT = 8


def now_text() -> str:
    return datetime.now(TAIPEI).strftime("%Y-%m-%d %H:%M:%S")


def fetch(url: str, accept: str, extra_headers: dict[str, str] | None = None) -> tuple[bytes, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; CrewPortal/8.2.51; +https://github.com/B744F/crewportal)",
        "Accept": accept,
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    if extra_headers:
        headers.update(extra_headers)
    request = Request(
        url,
        headers=headers,
    )
    with urlopen(request, timeout=TIMEOUT) as response:
        status = getattr(response, "status", 200)
        if not 200 <= status < 300:
            raise RuntimeError(f"HTTP {status}")
        return response.read(), response.headers.get("Content-Type", "")


def clean(value: object) -> str:
    return re.sub(r"[\s_\-（）()：:]+", "", str(value or "")).lower()


def parse_number(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"-?\d[\d,]*", str(value))
    return int(match.group(0).replace(",", "")) if match else None


def code_from_name(value: object) -> str | None:
    text = clean(value)
    for code in ALL_CODES:
        if code.lower() in text:
            return code
    return None


def pick(mapping: dict[str, Any], keywords: tuple[str, ...]) -> Any:
    for key, value in mapping.items():
        ck = clean(key)
        if any(clean(word) in ck for word in keywords):
            return value
    return None


def walk_records(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_records(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_records(child)


def extract_records(records: list[dict[str, Any]]) -> tuple[dict[str, int | None], str | None]:
    spaces = {code: None for code in ALL_CODES}
    source_updated: str | None = None
    for row in records:
        name = pick(row, ("停車場名稱", "名稱", "parkingname", "parkname", "name", "title"))
        code = code_from_name(name)
        if not code:
            continue
        remaining = pick(row, ("剩餘車位", "剩餘", "可用車位", "availablespaces", "available", "remain", "vacancy"))
        update_time = pick(row, ("更新時間", "資料時間", "updatetime", "updated", "timestamp", "datatime"))
        number = parse_number(remaining)
        if number is not None and number >= 0:
            spaces[code] = number
        if update_time:
            text = str(update_time).strip()
            if source_updated is None or text > source_updated:
                source_updated = text
    return spaces, source_updated


def parse_official_parking_json(raw: bytes):
    """Parse the airport website's PTYA parking endpoint.

    P4 is published as two official records, so its available spaces must be
    summed instead of allowing the second record to overwrite the first.
    """
    data = json.loads(raw.decode("utf-8-sig").strip())
    rows = data if isinstance(data, list) else list(walk_records(data))
    spaces: dict[str, int | None] = {code: None for code in ALL_CODES}
    ptya_to_code = {
        "PTYA0001": "P1",
        "PTYA0002": "P2",
        "PTYA0003": "P4",
        "PTYA0004": "P4",
    }
    p4_total = 0
    p4_seen = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        identifier = str(row.get("id") or row.get("ID") or "").strip().upper()
        code = ptya_to_code.get(identifier) or code_from_name(row.get("ParkName") or row.get("ParkNameZh"))
        if code not in REQUIRED:
            continue
        number = parse_number(row.get("AvailableCar"))
        if number is None or number < 0:
            continue
        if code == "P4":
            p4_total += number
            p4_seen = True
        else:
            spaces[code] = number
    if p4_seen:
        spaces["P4"] = p4_total
    return spaces, None


def decode_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "big5", "cp950"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise RuntimeError("Unable to decode response")


def parse_csv(raw: bytes):
    text = decode_text(raw).strip()
    if not text:
        raise RuntimeError("CSV is empty")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [dict(row) for row in csv.DictReader(io.StringIO(text), dialect=dialect) if row]
    if not rows:
        raise RuntimeError("CSV contains no records")
    return extract_records(rows)


def valid(spaces: dict[str, int | None]) -> bool:
    return all(isinstance(spaces.get(code), int) and spaces[code] >= 0 for code in REQUIRED)


def write_payload(payload: dict[str, Any]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)


def main() -> int:
    errors: list[str] = []
    sources: list[tuple[str, str, Callable, str, dict[str, str] | None]] = [
        (
            OFFICIAL_JSON,
            "application/json,text/plain;q=0.9,*/*;q=0.5",
            parse_official_parking_json,
            "official-json",
            {
                "Origin": "https://www.taoyuan-airport.com",
                "Referer": "https://www.taoyuan-airport.com/parking",
            },
        ),
        (OFFICIAL_CSV, "text/csv,text/plain;q=0.9,*/*;q=0.5", parse_csv, "official-csv", None),
    ]

    for url, accept, parser, source_type, extra_headers in sources:
        try:
            print(f"Fetching {source_type}: {url}")
            raw, content_type = fetch(url, accept, extra_headers)
            spaces, source_updated = parser(raw)
            print(f"Parsed {source_type}: P1={spaces['P1']} P2={spaces['P2']} P4={spaces['P4']}")
            if not valid(spaces):
                raise RuntimeError("P1/P2/P4 complete records not found")

            fetched_at = now_text()
            payload = {
                "online": True,
                "source": url,
                "sourceType": source_type,
                "contentType": content_type,
                "updatedAt": source_updated or fetched_at,
                "fetchedAt": fetched_at,
                "P1": spaces["P1"],
                "P2": spaces["P2"],
                "P4": spaces["P4"],
                "P3": spaces["P3"],
                "P3Available": spaces["P3"] is not None,
            }
            write_payload(payload)
            print("Airport parking data validated and written successfully.")
            return 0
        except (HTTPError, URLError, TimeoutError, RuntimeError, OSError, ValueError, json.JSONDecodeError) as exc:
            message = f"{source_type} failed: {exc}"
            errors.append(message)
            print(message, file=sys.stderr)

    print("All airport parking sources failed.", file=sys.stderr)
    print(" | ".join(errors), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
