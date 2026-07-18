#!/usr/bin/env python3
"""Fetch Taoyuan Airport open-data CSV and publish a compact parking JSON file."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SOURCE = os.environ.get(
    "AIRPORT_PARKING_SOURCE_URL",
    "https://odp.taoyuan-airport.com/dataset/2023081813?format=csv",
)
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "airport-parking.json"
ATTEMPTS = 3
TIMEOUT = 20
TAIPEI = timezone(timedelta(hours=8))


def fetch_once() -> bytes:
    req = Request(SOURCE, headers={
        "User-Agent": "CrewPortal/6.4 GitHub-Actions",
        "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.5",
        "Cache-Control": "no-cache",
    })
    with urlopen(req, timeout=TIMEOUT) as response:
        status = getattr(response, "status", 200)
        if not 200 <= status < 300:
            raise RuntimeError(f"Airport parking endpoint returned HTTP {status}")
        return response.read()


def decode_csv(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "big5", "cp950"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise RuntimeError("Unable to decode airport parking CSV")


def clean(value: object) -> str:
    return re.sub(r"[\s_\-（）()]+", "", str(value or "")).lower()


def pick(row: dict[str, str], keywords: tuple[str, ...]) -> str | None:
    for key, value in row.items():
        ck = clean(key)
        if any(clean(word) in ck for word in keywords):
            return value
    return None


def parse_number(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"-?\d[\d,]*", str(value))
    return int(match.group(0).replace(",", "")) if match else None


def validate(raw: bytes) -> dict:
    text = decode_csv(raw).strip()
    if not text:
        raise RuntimeError("Airport parking CSV is empty")

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = [dict(row) for row in reader if row]
    if not rows:
        raise RuntimeError("Airport parking CSV contains no records")

    spaces: dict[str, int | None] = {"P3": None, "P4": None}
    source_updated = None

    for row in rows:
        name = pick(row, ("名稱", "停車場名稱", "name", "parking"))
        remaining = pick(row, ("剩餘車位", "剩餘", "available", "remain"))
        update_time = pick(row, ("更新時間", "資料時間", "updatetime", "timestamp"))
        normalized_name = clean(name)
        for code in ("P3", "P4"):
            if clean(code) in normalized_name:
                number = parse_number(remaining)
                if number is not None:
                    spaces[code] = number
                if update_time and (source_updated is None or str(update_time) > source_updated):
                    source_updated = str(update_time).strip()

    if spaces["P4"] is None:
        raise RuntimeError("Airport parking CSV does not contain a valid P4 record")

    now = datetime.now(TAIPEI).strftime("%Y-%m-%d %H:%M:%S")
    return {
        "online": True,
        "source": SOURCE,
        "updatedAt": source_updated or now,
        "fetchedAt": now,
        "P4": spaces["P4"],
        "P3": spaces["P3"],
        "P3Available": spaces["P3"] is not None,
    }


def main() -> int:
    last_error: Exception | None = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            print(f"Airport parking fetch attempt {attempt}/{ATTEMPTS}: {SOURCE}")
            payload = validate(fetch_once())
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            temp = OUTPUT.with_suffix(".json.tmp")
            temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temp.replace(OUTPUT)
            print("Airport parking data validated and written safely")
            return 0
        except (HTTPError, URLError, TimeoutError, RuntimeError, OSError) as exc:
            last_error = exc
            print(f"Attempt {attempt} failed: {exc}", file=sys.stderr)
            if attempt < ATTEMPTS:
                time.sleep(4)
    print(f"Airport parking update failed; preserving last-good data: {last_error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
