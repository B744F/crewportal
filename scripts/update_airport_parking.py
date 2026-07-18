#!/usr/bin/env python3
"""Fetch Taoyuan Airport parking data with JSON primary and CSV fallback."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

JSON_SOURCE = os.environ.get(
    "AIRPORT_PARKING_JSON_URL",
    "https://www.taoyuan-airport.com/api/chinese/Info/CurrentParking",
)
CSV_SOURCE = os.environ.get(
    "AIRPORT_PARKING_CSV_URL",
    "https://odp.taoyuan-airport.com/dataset/2023081813?format=csv",
)
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "airport-parking.json"
TIMEOUT = 8
TAIPEI = timezone(timedelta(hours=8))
CODES = ("P1", "P2", "P3", "P4")


def fetch(url: str, accept: str) -> tuple[bytes, str]:
    req = Request(url, headers={
        "User-Agent": "CrewPortal/6.4.1 GitHub-Actions",
        "Accept": accept,
        "Cache-Control": "no-cache",
    })
    with urlopen(req, timeout=TIMEOUT) as response:
        status = getattr(response, "status", 200)
        if not 200 <= status < 300:
            raise RuntimeError(f"HTTP {status}")
        return response.read(), response.headers.get("Content-Type", "")


def clean(value: object) -> str:
    return re.sub(r"[\s_\-（）()]+", "", str(value or "")).lower()


def parse_number(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"-?\d[\d,]*", str(value))
    return int(match.group(0).replace(",", "")) if match else None


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
    spaces: dict[str, int | None] = {code: None for code in CODES}
    source_updated: str | None = None
    for row in records:
        name = pick(row, ("停車場名稱", "名稱", "parkingname", "parkname", "name", "title"))
        remaining = pick(row, ("剩餘車位", "剩餘", "可用車位", "available", "remain", "space", "vacancy"))
        update_time = pick(row, ("更新時間", "資料時間", "updatetime", "updated", "timestamp", "datatime"))
        normalized = clean(name)
        if not normalized:
            continue
        for code in CODES:
            if clean(code) in normalized:
                number = parse_number(remaining)
                if number is not None and number >= 0:
                    spaces[code] = number
                if update_time:
                    text = str(update_time).strip()
                    if source_updated is None or text > source_updated:
                        source_updated = text
    return spaces, source_updated


def parse_json(raw: bytes) -> tuple[dict[str, int | None], str | None]:
    text = raw.decode("utf-8-sig").strip()
    data = json.loads(text)
    records = list(walk_records(data))
    return extract_records(records)


def decode_csv(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "big5", "cp950"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise RuntimeError("Unable to decode CSV")


def parse_csv(raw: bytes) -> tuple[dict[str, int | None], str | None]:
    text = decode_csv(raw).strip()
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


def load_last_good() -> dict[str, Any] | None:
    try:
        data = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if any(parse_number(data.get(code)) is not None for code in ("P1", "P2", "P4")):
            return data
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return None


def write_payload(payload: dict[str, Any]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)


def main() -> int:
    errors: list[str] = []
    sources = [
        (JSON_SOURCE, "application/json,text/plain;q=0.9,*/*;q=0.5", parse_json, "official-json"),
        (CSV_SOURCE, "text/csv,text/plain;q=0.9,*/*;q=0.5", parse_csv, "official-csv"),
    ]

    for url, accept, parser, source_type in sources:
        try:
            print(f"Fetching {source_type}: {url}")
            raw, content_type = fetch(url, accept)
            spaces, source_updated = parser(raw)
            if spaces["P4"] is None:
                raise RuntimeError("P4 record not found")
            now = datetime.now(TAIPEI).strftime("%Y-%m-%d %H:%M:%S")
            payload = {
                "online": True,
                "source": url,
                "sourceType": source_type,
                "contentType": content_type,
                "updatedAt": source_updated or now,
                "fetchedAt": now,
                "P1": spaces["P1"],
                "P2": spaces["P2"],
                "P4": spaces["P4"],
                "P3": spaces["P3"],
                "P3Available": spaces["P3"] is not None,
            }
            write_payload(payload)
            print(f"Airport parking data updated: P1={spaces['P1']} P2={spaces['P2']} P4={spaces['P4']}")
            return 0
        except (HTTPError, URLError, TimeoutError, RuntimeError, OSError, ValueError, json.JSONDecodeError) as exc:
            message = f"{source_type} failed: {exc}"
            errors.append(message)
            print(message, file=sys.stderr)

    previous = load_last_good()
    if previous:
        print("All live sources failed; preserving last successful airport parking data.", file=sys.stderr)
        print(" | ".join(errors), file=sys.stderr)
        return 0

    print("All live sources failed and no last-good data exists.", file=sys.stderr)
    print(" | ".join(errors), file=sys.stderr)
    # Keep workflow green so a temporary upstream outage does not create repeated red runs.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
