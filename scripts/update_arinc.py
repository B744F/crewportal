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


def freq(value: str) -> int | None:
    match = re.search(r"\b(\d{4,5})\b", value)
    if not match:
        return None

    number = int(match.group(1))
    return number if 2000 <= number <= 22000 else None


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
            "User-Agent": "CrewPortal-PacificHF/2.5",
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
            return (
                raw,
                parsed.isoformat(timespec="seconds").replace("+00:00", "Z"),
            )
        except ValueError:
            return raw, None

    return None, None


def assignments(html: str) -> dict[str, dict[str, int]]:
    soup = BeautifulSoup(html, "html.parser")
    output: dict[str, dict[str, int]] = {}
    candidate_rows: list[list[str]] = []

    for row in soup.select("tr"):
        cells = [
            re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()
            for cell in row.select(":scope > th, :scope > td")
        ]

        if not cells:
            continue

        key = region(" | ".join(cells))
        if not key:
            continue

        # The page also contains explanatory text mentioning region names.
        # Ignore those rows unless they look like the actual frequency row.
        if len(cells) < 4:
            continue

        if "air traffic control" not in norm(cells[1]):
            continue

        candidate_rows.append(cells)

        # Current ARINC Pacific table layout:
        # 0 = Region
        # 1 = Service label ("Air Traffic Control")
        # 2 = Primary
        # 3 = Secondary
        # 4 = Tertiary / blank (ignored)
        primary = freq(cells[2])
        secondary = freq(cells[3])

        if primary is None or secondary is None:
            raise RuntimeError(
                f"Unable to parse PRIMARY/SECONDARY for {key}; row={cells!r}"
            )

        if primary == secondary:
            raise RuntimeError(
                f"Duplicate PRIMARY/SECONDARY for {key}: {primary}; row={cells!r}"
            )

        output[key] = {
            "primary": primary,
            "secondary": secondary,
        }

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
            + "; rows: "
            + repr(candidate_rows[:30])
        )

    return output


def main() -> None:
    html = fetch_html()
    data_rows = assignments(html)
    raw_valid_time, utc_valid_time = valid_time(html)

    data = {
        "schemaVersion": 13,
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
