#!/usr/bin/env python3
"""Update Taoyuan Airport P1/P2/P4 parking availability.

Source order:
1. Taoyuan Airport official JSON API.
2. Taoyuan Airport official open-data CSV.
3. Public TDX presentation page as a read-only fallback.

A run is successful only when P1, P2 and P4 are all valid non-negative integers,
or when a previously valid file is preserved during a temporary upstream outage.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

OFFICIAL_JSON = os.environ.get(
    "AIRPORT_PARKING_JSON_URL",
    "https://www.taoyuan-airport.com/api/chinese/Info/CurrentParking",
)
OFFICIAL_CSV = os.environ.get(
    "AIRPORT_PARKING_CSV_URL",
    "https://odp.taoyuan-airport.com/dataset/2023081813?format=csv",
)
PUBLIC_FALLBACK = os.environ.get(
    "AIRPORT_PARKING_FALLBACK_URL",
    "https://www.opendata.vip/tdx/parkingAirport",
)
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "airport-parking.json"
TIMEOUT = 10
TAIPEI = timezone(timedelta(hours=8))
REQUIRED = ("P1", "P2", "P4")
ALL_CODES = ("P1", "P2", "P3", "P4")


def now_text() -> str:
    return datetime.now(TAIPEI).strftime("%Y-%m-%d %H:%M:%S")


def fetch(url: str, accept: str) -> tuple[bytes, str]:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; CrewPortal/6.4.2; +https://github.com/B744F/crewportal)",
            "Accept": accept,
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(req, timeout=TIMEOUT) as response:
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


def pick(mapping: dict[str, Any], keywords: tuple[str, ...]) -> Any:
    for key, value in mapping.items():
        key_clean = clean(key)
        if any(clean(word) in key_clean for word in keywords):
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


def code_from_name(name: object) -> str | None:
    text = clean(name)
    if not text:
        return None
    # Match a standalone parking code and avoid accidental matches in unrelated text.
    for code in ALL_CODES:
        if re.search(rf"(?<![a-z0-9]){code.lower()}(?![a-z0-9])", str(name).lower()) or code.lower() in text:
            return code
    return None


def extract_records(records: list[dict[str, Any]]) -> tuple[dict[str, int | None], str | None]:
    spaces: dict[str, int | None] = {code: None for code in ALL_CODES}
    source_updated: str | None = None
    for row in records:
        name = pick(row, ("停車場名稱", "名稱", "parkingname", "parkname", "name", "title"))
        code = code_from_name(name)
        if not code:
            continue
        # Prefer explicit availability fields. Do not use the generic word "space",
        # because official payloads may also contain total-space fields.
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


def parse_json(raw: bytes) -> tuple[dict[str, int | None], str | None]:
    data = json.loads(raw.decode("utf-8-sig").strip())
    return extract_records(list(walk_records(data)))


def decode_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "big5", "cp950"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise RuntimeError("Unable to decode response")


def parse_csv(raw: bytes) -> tuple[dict[str, int | None], str | None]:
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


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "tr":
            self._row = []
        elif tag.lower() in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif lower == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
            self._cell = None


def parse_public_html(raw: bytes) -> tuple[dict[str, int | None], str | None]:
    text = decode_text(raw)
    parser = TableParser()
    parser.feed(text)
    spaces: dict[str, int | None] = {code: None for code in ALL_CODES}

    # Normal table layout: parking name in one cell, "available/total" in another.
    for cells in parser.rows:
        row_text = " | ".join(cells)
        code = code_from_name(row_text)
        if code not in REQUIRED:
            continue
        ratio = re.search(r"(\d[\d,]*)\s*/\s*(\d[\d,]*)", row_text)
        if ratio:
            spaces[code] = int(ratio.group(1).replace(",", ""))

    # Fallback for minified or non-semantic HTML.
    if any(spaces[code] is None for code in REQUIRED):
        plain = re.sub(r"<[^>]+>", " ", text)
        plain = re.sub(r"\s+", " ", plain)
        patterns = {
            "P1": r"(?:第一航廈出境停車場\s*P1|P1[^0-9]{0,80})(\d[\d,]*)\s*/\s*\d[\d,]*",
            "P2": r"(?:第一航廈入境停車場\s*P2|P2[^0-9]{0,80})(\d[\d,]*)\s*/\s*\d[\d,]*",
            "P4": r"(?:P4西側停車場|P4[^0-9]{0,80})(\d[\d,]*)\s*/\s*\d[\d,]*",
        }
        for code, pattern in patterns.items():
            if spaces[code] is None:
                match = re.search(pattern, plain, flags=re.IGNORECASE)
                if match:
                    spaces[code] = int(match.group(1).replace(",", ""))

    return spaces, None


def valid_required(spaces: dict[str, int | None]) -> bool:
    return all(isinstance(spaces.get(code), int) and spaces[code] >= 0 for code in REQUIRED)


def load_last_good() -> dict[str, Any] | None:
    try:
        data = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if all(parse_number(data.get(code)) is not None for code in REQUIRED):
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
    sources: list[tuple[str, str, Callable[[bytes], tuple[dict[str, int | None], str | None]], str]] = [
        (OFFICIAL_JSON, "application/json,text/plain;q=0.9,*/*;q=0.5", parse_json, "official-json"),
        (OFFICIAL_CSV, "text/csv,text/plain;q=0.9,*/*;q=0.5", parse_csv, "official-csv"),
        (PUBLIC_FALLBACK, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", parse_public_html, "public-tdx-fallback"),
    ]

    for url, accept, parser, source_type in sources:
        try:
            print(f"Fetching {source_type}: {url}")
            raw, content_type = fetch(url, accept)
            spaces, source_updated = parser(raw)
            print(f"Parsed {source_type}: P1={spaces['P1']} P2={spaces['P2']} P4={spaces['P4']} P3={spaces['P3']}")
            if not valid_required(spaces):
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

    previous = load_last_good()
    if previous:
        print("All live sources failed; preserving previously valid airport parking data.", file=sys.stderr)
        print(" | ".join(errors), file=sys.stderr)
        return 0

    print("All airport parking sources failed and no valid previous data exists.", file=sys.stderr)
    print(" | ".join(errors), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
