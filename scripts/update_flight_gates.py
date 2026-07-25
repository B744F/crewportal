#!/usr/bin/env python3
"""Fetch and publish the official Taoyuan Airport ADIP flight-gate snapshot."""

import csv
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


SOURCE_URL = "https://odp.taoyuan-airport.com/dataset/2025102001?format=csv"
DIRECT_IP_RESOLVES = (
    "odp.taoyuan-airport.com:443:60.251.215.156",
    "odp.taoyuan-airport.com:443:60.251.184.156",
)
FALLBACK_SOURCE_URL = "https://flightdeck-api.201505-login.workers.dev/api/flight-gate-source"
TDX_FALLBACK_SOURCE_URL = "https://flightdeck-api.201505-login.workers.dev/api/flight-gate-tdx-source"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "flight-gates.json"
TAIPEI = ZoneInfo("Asia/Taipei")
FETCH_ATTEMPTS = 1
FETCH_TIMEOUT_SECONDS = 15


def value(row: dict[str, str], key: str) -> str:
    raw = (row.get(key) or "").strip()
    return "" if raw.lower() == "null" else raw


def date_part(raw: str) -> str:
    return value({"value": raw}, "value")[:10]


def time_part(raw: str) -> str:
    text = value({"value": raw}, "value")
    return text[0:5] if len(text) >= 5 and text[2] == ":" else ""


def fetch_rows() -> tuple[list[dict[str, str]], str]:
    last_errors: list[str] = []
    sources = [(SOURCE_URL, "direct", FETCH_ATTEMPTS, [])]
    sources.extend(
        (SOURCE_URL, f"official-ip-{index + 1}", FETCH_ATTEMPTS, ["--resolve", resolve])
        for index, resolve in enumerate(DIRECT_IP_RESOLVES)
    )
    sources.append((FALLBACK_SOURCE_URL, "cloudflare-proxy", 1, []))
    for source_url, source_label, attempts, extra_args in sources:
        for attempt in range(1, attempts + 1):
            try:
                result = subprocess.run(
                    [
                        "curl", "--fail", "--silent", "--show-error", "--location", "--ipv4",
                        "--max-time", str(FETCH_TIMEOUT_SECONDS),
                        "--header", "Accept: text/csv,*/*",
                        "--header", "User-Agent: CrewPortal-FlightGate/1.0",
                        *extra_args,
                        source_url,
                    ],
                    capture_output=True,
                    timeout=FETCH_TIMEOUT_SECONDS + 5,
                    check=True,
                )
                body = result.stdout.decode("utf-8-sig")
                if source_label == "tdx-official":
                    payload = json.loads(body)
                    rows = payload.get("rows") if isinstance(payload, dict) else None
                    if not isinstance(rows, list) or not rows:
                        raise RuntimeError("TDX source returned no rows")
                    print("Fetched official TDX flight data")
                    return rows, source_label
                print(f"Fetched official ADIP data via {source_label}")
                return list(csv.DictReader(body.splitlines())), source_label
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, UnicodeDecodeError, OSError) as error:
                last_errors.append(f"{source_label} attempt {attempt}: {error}")
                if attempt < attempts:
                    print(f"{source_label} fetch attempt {attempt}/{attempts} failed: {error}; retrying")

    try:
        result = subprocess.run(
            [
                "curl", "--fail", "--silent", "--show-error", "--location", "--ipv4",
                "--max-time", str(FETCH_TIMEOUT_SECONDS),
                "--header", "Accept: application/json",
                "--header", "User-Agent: CrewPortal-FlightGate/1.0",
                TDX_FALLBACK_SOURCE_URL,
            ],
            capture_output=True,
            timeout=FETCH_TIMEOUT_SECONDS + 5,
            check=True,
        )
        payload = json.loads(result.stdout.decode("utf-8"))
        rows = payload.get("rows") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or not rows:
            raise RuntimeError("TDX source returned no rows")
        print("Fetched official TDX flight data")
        return rows, "tdx-official"
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, UnicodeDecodeError, json.JSONDecodeError, OSError, RuntimeError) as error:
        last_errors.append(f"tdx-official: {error}")

    detail = "; ".join(last_errors)
    raise RuntimeError(f"Unable to fetch official ADIP CSV from direct and fallback sources: {detail}")


def continuity_merge(rows: list[dict[str, str]], previous_rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    """Use TDX only to refresh the fixed last-known ADIP route set."""
    tdx_exact = {
        (row["flight"], row["date"], row["time"], row["direction"], row["airportCode"]): row
        for row in rows
    }
    merged = []
    continuity_rows = 0
    for row in previous_rows:
        exact = (row["flight"], row["date"], row["time"], row["direction"], row["airportCode"])
        if exact in tdx_exact:
            merged.append(tdx_exact[exact])
        else:
            merged.append(row)
            continuity_rows += 1
    return merged, continuity_rows


def main() -> None:
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    try:
        rows, fetch_route = fetch_rows()
    except RuntimeError as error:
        if previous.get("rows"):
            print(f"No official source available; preserving the last validated snapshot: {error}")
            return
        raise

    required = {"航空公司代碼", "班次", "機門", "往來地點", "表訂日期", "表訂時間"}
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
            "airportCode": value(row, "往來地點").upper(),
            "destination": value(row, "往來地點中文") or value(row, "往來地點"),
            "status": value(row, "航班動態中文") or value(row, "備註"),
        })

    today_rows = [row for row in output_rows if row["date"] == today.isoformat()]
    today_gate_rows = [row for row in today_rows if row["gate"]]
    if len(output_rows) < 100:
        raise RuntimeError(f"Official ADIP snapshot is unexpectedly small: {len(output_rows)} rows")
    if not today_rows:
        raise RuntimeError("Official ADIP snapshot contains no flights for today")
    if not today_gate_rows:
        raise RuntimeError("Official ADIP snapshot contains no gate assignments for today; refusing to publish")

    continuity_rows = 0
    continuity_base_rows = previous.get("continuityBaseRows") or previous.get("rows") or []
    if fetch_route == "tdx-official" and previous.get("rows"):
        previous_rows = [
            row for row in continuity_base_rows
            if today.isoformat() <= row.get("date", "") <= last_date.isoformat()
        ]
        output_rows, continuity_rows = continuity_merge(output_rows, previous_rows)
        today_rows = [row for row in output_rows if row["date"] == today.isoformat()]
        today_gate_rows = [row for row in today_rows if row["gate"]]

    output_rows.sort(key=lambda row: (row["date"], row["time"], row["flight"]))
    fetched_at = (
        previous.get("fetchedAtUtc")
        if previous.get("rows") == output_rows
        else datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    is_tdx = fetch_route == "tdx-official"
    payload = {
        "source": (
            "TDX official Airport FIDS with previous ADIP continuity rows"
            if is_tdx and continuity_rows
            else "TDX official Airport FIDS real-time flight data"
            if is_tdx
            else "Taoyuan Airport ADIP official real-time flight data"
        ),
        "sourceUrl": TDX_FALLBACK_SOURCE_URL if is_tdx else SOURCE_URL,
        "fetchRoute": fetch_route,
        "fetchedAtUtc": fetched_at,
        "quality": {
            "totalRows": len(output_rows),
            "todayRows": len(today_rows),
            "todayGateRows": len(today_gate_rows),
            "nextDayRows": sum(row["date"] == last_date.isoformat() for row in output_rows),
            "continuityRows": continuity_rows,
        },
        "continuityBaseRows": continuity_base_rows if is_tdx and continuity_base_rows else output_rows,
        "rows": output_rows,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Published {len(output_rows)} official flight rows to {OUTPUT}")


if __name__ == "__main__":
    main()
