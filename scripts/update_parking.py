#!/usr/bin/env python3
"""Fetch and validate crew parking availability without corrupting last-good data."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SOURCE = os.environ.get("PARKING_SOURCE_URL", "http://1.34.202.50:9130/parking_place/huahang")
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "parking.json"
EXPECTED = ("BOT", "TSA", "RD1 A", "RD1 B")
CONNECT_TIMEOUT = 12
ATTEMPTS = 3


def fetch_once() -> bytes:
    request = Request(
        SOURCE,
        headers={
            "User-Agent": "CrewPortal/6.2 GitHub-Actions",
            "Accept": "application/json,text/plain;q=0.9,*/*;q=0.5",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    with urlopen(request, timeout=CONNECT_TIMEOUT) as response:
        status = getattr(response, "status", 200)
        if status < 200 or status >= 300:
            raise RuntimeError(f"Parking endpoint returned HTTP {status}")
        return response.read()


def validate(raw: bytes) -> list[dict]:
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"Parking endpoint did not return valid JSON: {exc}") from exc

    if not isinstance(payload, list):
        raise RuntimeError("Parking payload must be a JSON array")

    by_name: dict[str, dict] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if name in EXPECTED:
            remaining = item.get("remaining_space")
            update_time = item.get("updateTime")
            if isinstance(remaining, bool) or not isinstance(remaining, (int, float)):
                raise RuntimeError(f"Invalid remaining_space for {name}")
            if not isinstance(update_time, str) or not update_time.strip():
                raise RuntimeError(f"Invalid updateTime for {name}")
            by_name[name] = item

    missing = [name for name in EXPECTED if name not in by_name]
    if missing:
        raise RuntimeError("Parking payload missing: " + ", ".join(missing))

    # Keep the official array order/content, but require all four expected records.
    return payload


def main() -> int:
    last_error: Exception | None = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            print(f"Parking fetch attempt {attempt}/{ATTEMPTS}: {SOURCE}")
            payload = validate(fetch_once())
            serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            temp = OUTPUT.with_suffix(".json.tmp")
            temp.write_text(serialized, encoding="utf-8")
            temp.replace(OUTPUT)
            print("Parking data validated and written safely")
            return 0
        except (HTTPError, URLError, TimeoutError, RuntimeError, OSError) as exc:
            last_error = exc
            print(f"Attempt {attempt} failed: {exc}", file=sys.stderr)
            if attempt < ATTEMPTS:
                time.sleep(4)

    print(f"Parking update failed; preserving last-good data: {last_error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
