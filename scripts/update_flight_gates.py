#!/usr/bin/env python3
"""Fetch and publish the official Taoyuan Airport ADIP flight-gate snapshot."""

import csv
import json
import subprocess
from collections import Counter, defaultdict
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
# The public ADIP endpoint can be slow during the morning peak.  Retry each
# official route before falling back so a transient edge timeout does not
# publish a lower-quality TDX-only snapshot.
FETCH_ATTEMPTS = 2
FETCH_TIMEOUT_SECONDS = 25
FETCH_CONNECT_TIMEOUT_SECONDS = 10


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
                        "--connect-timeout", str(FETCH_CONNECT_TIMEOUT_SECONDS),
                        "--max-time", str(FETCH_TIMEOUT_SECONDS),
                        "--header", "Accept: text/csv,*/*",
                        "--header", "User-Agent: CrewPortal-FlightGate/1.0",
                        *extra_args,
                        source_url,
                    ],
                    capture_output=True,
                    timeout=FETCH_TIMEOUT_SECONDS + FETCH_CONNECT_TIMEOUT_SECONDS + 5,
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
                "--connect-timeout", str(FETCH_CONNECT_TIMEOUT_SECONDS),
                "--max-time", str(FETCH_TIMEOUT_SECONDS),
                "--header", "Accept: application/json",
                "--header", "User-Agent: CrewPortal-FlightGate/1.0",
                TDX_FALLBACK_SOURCE_URL,
            ],
            capture_output=True,
                timeout=FETCH_TIMEOUT_SECONDS + FETCH_CONNECT_TIMEOUT_SECONDS + 5,
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
    """Keep confirmed values when TDX blanks or removes a flight row."""
    previous_by_schedule = defaultdict(list)
    previous_by_route = defaultdict(list)
    for index, row in enumerate(previous_rows):
        previous_by_schedule[schedule_identity(row)].append((index, row))
        previous_by_route[route_identity(row)].append((index, row))
    merged = []
    matched_previous = set()
    continuity_rows = 0
    preserve_fields = ("gate", "estimatedDate", "estimatedTime", "status")

    for row in rows:
        candidates = [item for item in previous_by_schedule[schedule_identity(row)] if item[0] not in matched_previous]
        if not candidates:
            route_candidates = [item for item in previous_by_route[route_identity(row)] if item[0] not in matched_previous]
            candidates = route_candidates if len(route_candidates) == 1 else []
        if candidates:
            previous_index, previous = candidates[0]
            matched_previous.add(previous_index)
            merged_row = dict(row)
            for field in preserve_fields:
                if not merged_row.get(field) and previous.get(field):
                    merged_row[field] = previous[field]
            merged.append(merged_row)
        else:
            merged.append(row)

    for index, previous in enumerate(previous_rows):
        if index not in matched_previous:
            merged.append(previous)
            continuity_rows += 1

    return merged, continuity_rows


def route_filter_tdx_rows(rows: list[dict[str, str]], route_baseline: list[dict[str, str]]) -> list[dict[str, str]]:
    """Reject ambiguous TDX route expansion unless an official route baseline exists."""
    baseline_routes: defaultdict[tuple[str, str], set[tuple[str, str, str, str]]] = defaultdict(set)
    for row in route_baseline:
        baseline_routes[(row["flight"], row["date"])].add(route_identity(row))
    current_routes: defaultdict[tuple[str, str], set[tuple[str, str, str, str]]] = defaultdict(set)
    for row in rows:
        current_routes[(row["flight"], row["date"])].add(route_identity(row))

    filtered = []
    for row in rows:
        key = (row["flight"], row["date"])
        known = baseline_routes.get(key)
        if known:
            if route_identity(row) in known:
                filtered.append(row)
        elif len(current_routes[key]) == 1:
            filtered.append(row)
    return filtered


def route_identity(row: dict[str, str]) -> tuple[str, str, str, str]:
    return (row["flight"], row["date"], row["direction"], row["airportCode"])


def schedule_identity(row: dict[str, str]) -> tuple[str, str, str, str, str]:
    return (*route_identity(row), row["time"])


def deduplicate_schedule_rows(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    """Collapse terminal-only duplicates without hiding a confirmed gate/status."""
    grouped: dict[tuple[str, str, str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[schedule_identity(row)].append(row)

    deduplicated: list[dict[str, str]] = []
    for candidates in grouped.values():
        selected = max(
            candidates,
            key=lambda row: (
                not is_cancelled(row),
                bool(row.get("gate")),
                bool(row.get("status")),
                bool(row.get("estimatedDate") and row.get("estimatedTime")),
                row.get("terminal", ""),
            ),
        )
        deduplicated.append(selected)
    return deduplicated, len(rows) - len(deduplicated)


def is_cancelled(row: dict[str, str]) -> bool:
    status = value(row, "status").upper()
    return "取消" in status or "CANCEL" in status


def past_departures_without_gates(rows: list[dict[str, str]], now: datetime) -> list[dict[str, str]]:
    missing = []
    for row in rows:
        if row.get("date") != now.date().isoformat() or row.get("direction") != "D" or row.get("gate") or is_cancelled(row):
            continue
        flight_date = row.get("estimatedDate") or row.get("date")
        flight_time = row.get("estimatedTime") or row.get("time")
        try:
            departure = datetime.strptime(
                f"{flight_date} {flight_time}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=TAIPEI)
        except (TypeError, ValueError):
            continue
        if departure <= now:
            missing.append(row)
    return missing


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
    if fetch_route == "tdx-official" and not any(row["date"] == last_date.isoformat() for row in output_rows):
        raise RuntimeError("TDX Airport FIDS is missing next-day rows; refusing to publish a stale snapshot")

    continuity_rows = 0
    deduplicated_rows = 0
    previous_source = str(previous.get("source") or "")
    previous_route_base_rows = previous.get("officialRouteBaseRows") or (
        previous.get("rows") or []
        if not previous_source.startswith("TDX official")
        else []
    )
    continuity_base_rows = previous.get("continuityBaseRows") or previous.get("rows") or []
    if fetch_route == "tdx-official" and previous.get("rows"):
        previous_rows = [
            row for row in previous_route_base_rows
            if today.isoformat() <= row.get("date", "") <= last_date.isoformat()
        ]
        output_rows = route_filter_tdx_rows(output_rows, previous_rows)
        output_rows, continuity_rows = continuity_merge(output_rows, previous_rows)
        today_rows = [row for row in output_rows if row["date"] == today.isoformat()]
        today_gate_rows = [row for row in today_rows if row["gate"]]
        continuity_base_rows = [
            *previous_route_base_rows,
            *[
                row for row in output_rows
                if row.get("gate") or row.get("status")
            ],
        ]
        continuity_base_rows, _ = deduplicate_schedule_rows(continuity_base_rows)

    output_rows, deduplicated_rows = deduplicate_schedule_rows(output_rows)
    today_rows = [row for row in output_rows if row["date"] == today.isoformat()]
    today_gate_rows = [row for row in today_rows if row["gate"]]
    duplicate_keys = [key for key, count in Counter(schedule_identity(row) for row in output_rows).items() if count > 1]
    if duplicate_keys:
        raise RuntimeError(f"Official flight snapshot still contains duplicate schedule rows: {duplicate_keys[:3]}")
    missing_departure_gates = past_departures_without_gates(output_rows, now)
    if missing_departure_gates:
        flights = ", ".join(row["flight"] for row in missing_departure_gates[:8])
        if fetch_route == "tdx-official":
            print(
                f"TDX official snapshot has {len(missing_departure_gates)} departed flights without published gates; "
                f"keeping them as no-data rows: {flights}"
            )
        else:
            raise RuntimeError(
                f"Official snapshot contains departed non-cancelled flights without gates ({len(missing_departure_gates)}): {flights}"
            )
    today_departure_rows = [row for row in today_rows if row["direction"] == "D"]

    output_rows.sort(key=lambda row: (row["date"], row["time"], row["flight"]))
    fetched_at = (
        previous.get("fetchedAtUtc")
        if previous.get("rows") == output_rows
        else datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    is_tdx = fetch_route == "tdx-official"
    official_route_base_rows = previous_route_base_rows if is_tdx and previous_route_base_rows else output_rows
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
            "deduplicatedRows": deduplicated_rows,
            "todayDepartureRows": len(today_departure_rows),
            "departedRowsWithoutGate": len(missing_departure_gates),
        },
        "continuityBaseRows": continuity_base_rows if is_tdx and continuity_base_rows else output_rows,
        "officialRouteBaseRows": official_route_base_rows,
        "rows": output_rows,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Published {len(output_rows)} official flight rows to {OUTPUT}")


if __name__ == "__main__":
    main()
