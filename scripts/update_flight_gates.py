#!/usr/bin/env python3
"""Fetch and publish the official Taoyuan Airport ADIP flight-gate snapshot."""

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


SOURCE_URL = "https://odp.taoyuan-airport.com/dataset/2025102001?format=csv"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "flight-gates.json"
TAIPEI = ZoneInfo("Asia/Taipei")


def value(row: dict[str, str], key: str) -> str:
    raw = (row.get(key) or "").strip()
    return "" if raw.lower() == "null" else raw


def date_part(raw: str) -> str:
    return value({"value": raw}, "value")[:10]


def time_part(raw: str) -> str:
    text = value({"value": raw}, "value")
    return text[0:5] if len(text) >= 5 and text[2] == ":" else ""


def main() -> None:
    request = Request(SOURCE_URL, headers={"Accept": "text/csv,*/*", "User-Agent": "CrewPortal-FlightGate/1.0"})
    with urlopen(request, timeout=45) as response:
        rows = list(csv.DictReader(response.read().decode("utf-8-sig").splitlines()))

    required = {"航空公司代碼", "班次", "機門", "表訂日期", "表訂時間"}
    if not rows or not required.issubset(rows[0]):
        raise RuntimeError("Official ADIP CSV is missing required fields")

    now = datetime.now(TAIPEI)
    today = now.date()
    last_date = today + timedelta(days=1)
    output_rows = []
    for row in rows:
        airline = value(row, "航空公司代碼").upper()
        number = value(row, "班次").replace(" ", "")
        scheduled_date = date_part(value(row, "表訂日期"))
        scheduled_time = time_part(value(row, "表訂時間"))
        if not airline or not number or not scheduled_date or not scheduled_time:
            continue
        try:
            flight_date = datetime.strptime(scheduled_date, "%Y-%m-%d").date()
        except ValueError:
            continue
        if not today <= flight_date <= last_date:
            continue
        output_rows.append({
            "flight": f"{airline}{number}",
            "airline": airline,
            "airlineName": value(row, "航空公司中文"),
            "number": number,
            "terminal": value(row, "航廈"),
            "direction": value(row, "方向"),
            "date": scheduled_date,
            "time": scheduled_time,
            "estimatedDate": date_part(value(row, "預計日期")),
            "estimatedTime": time_part(value(row, "預計時間")),
            "gate": value(row, "機門"),
            "destination": value(row, "往來地點中文") or value(row, "往來地點"),
            "status": value(row, "航班動態中文") or value(row, "備註"),
        })

    if len(output_rows) < 100:
        raise RuntimeError(f"Official ADIP snapshot is unexpectedly small: {len(output_rows)} rows")

    output_rows.sort(key=lambda row: (row["date"], row["time"], row["flight"]))
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    fetched_at = previous.get("fetchedAtUtc") if previous.get("rows") == output_rows else None
    payload = {
        "source": "Taoyuan Airport ADIP official real-time flight data",
        "sourceUrl": SOURCE_URL,
        "fetchedAtUtc": fetched_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "rows": output_rows,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Published {len(output_rows)} official flight rows to {OUTPUT}")


if __name__ == "__main__":
    main()
