#!/usr/bin/env python3
"""Fetch and validate the Taiwan High Speed Rail official daily timetable."""

from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import tempfile
import urllib.parse
from zoneinfo import ZoneInfo


SEARCH_URL = "https://www.thsrc.com.tw/TimeTable/Search"
SOURCE_PAGE = "https://www.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c"
STATION_CODES = {
    "01": "0990", "02": "1000", "03": "1010", "04": "1020", "05": "1030", "06": "1035",
    "07": "1040", "08": "1043", "09": "1047", "10": "1050", "11": "1060", "12": "1070",
}
STATION_EN = {
    "0990": "NanGang", "1000": "TaiPei", "1010": "BanQiao", "1020": "TaoYuan",
    "1030": "XinZhu", "1035": "MiaoLi", "1040": "TaiZhong", "1043": "ZhangHua",
    "1047": "YunLin", "1050": "JiaYi", "1060": "TaiNan", "1070": "ZuoYing",
}
STATION_ORDER = ["0990", "1000", "1010", "1020", "1030", "1035", "1040", "1043", "1047", "1050", "1060", "1070"]
STATION_ZH = {
    "0990": "南港站", "1000": "台北站", "1010": "板橋站", "1020": "桃園站", "1030": "新竹站",
    "1035": "苗栗站", "1040": "台中站", "1043": "彰化站", "1047": "雲林站", "1050": "嘉義站",
    "1060": "台南站", "1070": "左營站",
}


def clock(value: object) -> str:
    text = str(value or "").strip()
    if len(text) >= 5 and text[0:2].isdigit() and text[2] == ":" and text[3:5].isdigit():
        hour, minute = int(text[0:2]), int(text[3:5])
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return f"{hour:02d}:{minute:02d}"
    return ""


def search(start: str, end: str, service_date: str) -> dict:
    form = urllib.parse.urlencode({
        "SearchType": "S",
        "Lang": "TW",
        "StartStation": start,
        "EndStation": end,
        "OutWardSearchDate": service_date.replace("-", "/"),
        "OutWardSearchTime": "00:00",
        "ReturnSearchDate": "",
        "ReturnSearchTime": "",
        "DiscountType": "",
    }).encode()
    completed = subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--max-time", "30", "-X", "POST", SEARCH_URL,
        "-H", "Accept: application/json",
        "-H", "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
        "-H", "Origin: https://www.thsrc.com.tw",
        "-H", f"Referer: {SOURCE_PAGE}",
        "-H", "User-Agent: Mozilla/5.0 (compatible; CrewPortal official timetable updater)",
        "-H", "X-Requested-With: XMLHttpRequest",
        "--data-binary", form.decode("ascii"),
    ], check=True, capture_output=True, text=True)
    payload = json.loads(completed.stdout)
    if payload.get("success") is not True:
        raise RuntimeError("THSRC timetable search returned unsuccessful response")
    return payload


def parse(payload: dict, direction: str, service_date: str, destination_id: str) -> list[dict]:
    train_items = payload.get("data", {}).get("DepartureTable", {}).get("TrainItem", [])
    rows: list[dict] = []
    for item in train_items:
        stops: list[dict] = []
        for index, info in enumerate(item.get("StationInfo") or []):
            station_id = STATION_CODES.get(str(info.get("StationNo") or "").strip().zfill(2))
            departure = clock(info.get("DepartureTime"))
            arrival = clock(info.get("ArrivalTime"))
            time = departure or arrival
            if not station_id or not time:
                continue
            stops.append({
                "stationId": station_id,
                "stationName": str(info.get("StationName") or STATION_ZH[station_id]),
                "stationNameEn": STATION_EN[station_id],
                "arrivalTime": arrival or time,
                "departureTime": departure or time,
                "stopSequence": STATION_ORDER.index(station_id) if station_id in STATION_ORDER else index,
            })
        stops.sort(key=lambda stop: stop["stopSequence"], reverse=direction == "northbound")
        train_no = str(item.get("TrainNumber") or "").strip()
        if not train_no or len(stops) < 2 or not any(stop["stationId"] == destination_id for stop in stops):
            continue
        rows.append({
            "trainNo": train_no,
            "serviceDate": str(item.get("RunDate") or service_date).replace("/", "-"),
            "direction": direction,
            "stops": stops,
        })
    return rows


def main() -> None:
    now = dt.datetime.now(ZoneInfo("Asia/Taipei"))
    service_date = now.date().isoformat()
    stations: dict[str, dict] = {}
    for station_id in STATION_ORDER:
        rows: list[dict] = []
        if station_id != "0990":
            rows.extend(parse(search(STATION_EN[station_id], "NanGang", service_date), "northbound", service_date, "0990"))
        if station_id != "1070":
            rows.extend(parse(search(STATION_EN[station_id], "ZuoYing", service_date), "southbound", service_date, "1070"))
        if not rows:
            raise RuntimeError(f"No official THSRC rows found for station {station_id}")
        stations[station_id] = {"rows": rows}
        print(f"{station_id}: {len(rows)} rows")

    snapshot = {
        "source": "THSRC official timetable search",
        "sourceUrl": SOURCE_PAGE,
        "serviceDate": service_date,
        "fetchedAtUtc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "stations": stations,
    }
    output_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "hsr-timetable.json")
    directory = os.path.dirname(output_path)
    fd, temp_path = tempfile.mkstemp(prefix="hsr-timetable.", suffix=".json", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(snapshot, output, ensure_ascii=False, separators=(",", ":"))
            output.write("\n")
        os.replace(temp_path, output_path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


if __name__ == "__main__":
    main()
