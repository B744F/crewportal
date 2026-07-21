#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

WORKER_URL = "https://arinc-proxy.201505-login.workers.dev/"
SOURCE_URL = "https://radio.arinc.net/pacific/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "arinc.json"


def norm(value: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        value.replace("\xa0", " ").replace("→", " to ").replace("->", " to "),
    ).strip().lower()


def frequencies(value: str) -> list[int]:
    """Return all valid HF frequencies in source order, without duplicates."""
    result: list[int] = []
    for match in re.finditer(r"\b(\d{4,5})\b", value):
        number = int(match.group(1))
        if 2000 <= number <= 22000 and number not in result:
            result.append(number)
    return result


def first_frequency(value: str) -> int | None:
    values = frequencies(value)
    return values[0] if values else None


def region(value: str) -> str | None:
    value = norm(value)

    if "north" in value and "america" in value and "asia" in value:
        return "northAmericaAsia"

    if "alaska" in value and "pacific" in value:
        return "alaskaNorthPacific"

    if "guam" in value:
        return "guamArea"

    return None


def fetch_html() -> str:
    request = Request(
        WORKER_URL,
        headers={
            "User-Agent": "CrewPortal-PacificHF/2.3",
            "Accept": "text/html",
            "Cache-Control": "no-cache",
        },
    )

    with urlopen(request, timeout=45) as response:
        html = response.read().decode("utf-8", errors="replace")

    if "403 Forbidden" in html:
        raise RuntimeError("Worker returned ARINC 403 page")

    if "ARINC request failed" in html:
        raise RuntimeError(f"Worker error: {html[:300]}")

    return html


def valid_time(html: str) -> tuple[str | None, str | None]:
    text = re.sub(
        r"\s+",
        " ",
        BeautifulSoup(html, "html.parser").get_text(" ", strip=True),
    )

    patterns = (
        r"Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        r"Effective\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
    )

    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue

        raw = re.sub(r"\s+", " ", match.group(1)).strip()

        try:
            parsed = datetime.strptime(raw, "%B %d, %Y, %H%MZ").replace(
                tzinfo=timezone.utc
            )
            utc = parsed.isoformat(timespec="seconds").replace("+00:00", "Z")
            return raw, utc
        except ValueError:
            return raw, None

    return None, None


def cell_texts(row) -> list[str]:
    return [
        re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()
        for cell in row.select(":scope > th, :scope > td")
    ]


def header_indexes(cells: list[str]) -> tuple[int, int] | None:
    normalized = [norm(cell) for cell in cells]

    primary_index = next(
        (index for index, value in enumerate(normalized) if "primary" in value),
        None,
    )
    secondary_index = next(
        (index for index, value in enumerate(normalized) if "secondary" in value),
        None,
    )

    if primary_index is None or secondary_index is None:
        return None

    return primary_index, secondary_index


def parse_table(table) -> dict[str, dict[str, int]]:
    rows = table.select("tr")
    active_indexes: tuple[int, int] | None = None
    parsed: dict[str, dict[str, int]] = {}

    for row in rows:
        cells = cell_texts(row)
        if not cells:
            continue

        detected_indexes = header_indexes(cells)
        if detected_indexes:
            active_indexes = detected_indexes
            continue

        key = region(" | ".join(cells))
        if not key:
            continue

        primary: int | None = None
        secondary: int | None = None

        # Preferred method: use PRIMARY and SECONDARY column positions detected
        # from the current table's header.
        if active_indexes:
            primary_index, secondary_index = active_indexes

            if primary_index < len(cells):
                primary = first_frequency(cells[primary_index])

            if secondary_index < len(cells):
                secondary = first_frequency(cells[secondary_index])

        # Safe fallback for unexpected markup:
        # collect unique frequencies in row order and use the first two distinct
        # values only. This never reads a third value as "tertiary" when the
        # proper PRIMARY/SECONDARY columns were detected.
        if primary is None or secondary is None:
            row_values: list[int] = []
            for cell in cells:
                for number in frequencies(cell):
                    if number not in row_values:
                        row_values.append(number)

            if primary is None and row_values:
                primary = row_values[0]

            if secondary is None:
                secondary = next(
                    (number for number in row_values if number != primary),
                    None,
                )

        if primary is None or secondary is None:
            raise RuntimeError(
                f"Unable to parse PRIMARY/SECONDARY for {key}; row={cells!r}; "
                f"header_indexes={active_indexes!r}"
            )

        if primary == secondary:
            raise RuntimeError(
                f"Duplicate PRIMARY/SECONDARY for {key}: {primary}; row={cells!r}"
            )

        parsed[key] = {
            "primary": primary,
            "secondary": secondary,
        }

    return parsed


def assignments(html: str) -> dict[str, dict[str, int]]:
    soup = BeautifulSoup(html, "html.parser")
    output: dict[str, dict[str, int]] = {}
    inspected_tables: list[list[list[str]]] = []

    for table in soup.select("table"):
        rows_preview = [cell_texts(row) for row in table.select("tr")[:12]]
        inspected_tables.append(rows_preview)

        parsed = parse_table(table)
        output.update(parsed)

    required = {
        "northAmericaAsia",
        "alaskaNorthPacific",
        "guamArea",
    }
    missing = sorted(required - output.keys())

    if missing:
        raise RuntimeError(
            "Missing region(s): "
            + ", ".join(missing)
            + "; table previews: "
            + repr(inspected_tables[:10])
        )

    return output


def main() -> None:
    html = fetch_html()
    data_rows = assignments(html)
    raw_valid_time, utc_valid_time = valid_time(html)

    data = {
        "schemaVersion": 11,
        "source": SOURCE_URL,
        "proxy": WORKER_URL,
        "validFrom": raw_valid_time,
        "validFromUtc": utc_valid_time,
        "fetchedAtUtc": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "northAmericaAsia": data_rows["northAmericaAsia"],
        "alaskaNorthPacific": data_rows["alaskaNorthPacific"],
        "guamArea": data_rows["guamArea"],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Updated data/arinc.json")
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ARINC update failed: {error}", file=sys.stderr)
        raise
