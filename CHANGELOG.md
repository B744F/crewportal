## v8.2.29 — 2026-07-30

- Fixed missing regional arrival gate values being rendered as `undefined`.
- Displays `無資料` when an arrived flight has no official boarding-gate value.

## v8.2.28 — 2026-07-30

- Added an airport selector to airport gate lookup with RCTP as the default.
- Added official real-time gate lookup support for RCSS, RCMQ, and RCKH.
- Kept the gate input hint as `Callsign or Flight No.` with a medium-sized font.

## v8.2.27 — 2026-07-30

- Updated the RCTP GATE INFO input placeholder to `Callsign or Flight No.` with a medium-sized hint font.

## v8.2.15 — 2026-07-27

- Removed the embedded lower Hero title, subtitle, logo, and value icons to reduce visual interference.
- Preserved the original Hero image as `images/hero-original.webp`.
- Added Hero image cache-busting and updated the portal version/build identifiers.

## Operational reliability update — 2026-07-25

- Added retry and timeout handling to the official Taoyuan flight-gate snapshot workflow.
- Rejects empty or malformed daily gate snapshots instead of publishing them.
- Reports flight-data freshness and visible stale-data warnings in the gate lookup.
- Separates Worker cache age from the source snapshot timestamp.
- Adds a Cloudflare official-source proxy for GitHub Runner connectivity failures.
- Uses IPv4 curl retrieval in the scheduled updater for the official CSV endpoint.
- Adds an official-IP `--resolve` route when DNS-based access is unavailable.

## v8.0.0 — 2026-07-22

- Rewrote Airport MRT parsing around the official structured fields `StationID`, `Direction`, `DestinationStationID`, and `TrainType`.
- Uses official TDX `StationTimeTable` as the primary source, with the official Taoyuan XML as a structured fallback.
- Removed direction detection from Chinese or display-name text.
- Corrected `StationTimeTable` XML parsing and separated official commuter and express services.
- Added 15-minute in-isolate and Cloudflare edge caching for official timetable rows to avoid TDX rate-limit failures during normal station refreshes.
- Kept A1/A22 endpoint direction availability data-driven; no fake timetable rows are generated.
- Kept TDX LiveBoard as secondary information only.
- Frontend timetable cells now render only `HH:mm` or `—`; removed scheduled backup text and generated timetable fallback.
- Updated Portal Version to v8.0.0 and Worker Version to 2.3.0.

## v7.2.0
- Replaced fragile station-page HTML scraping with the official Taoyuan City Government structured XML timetable dataset.
- Parses A1–A22 station records, direction, train type, service days and departure times from structured data.
- Keeps TDX LiveBoard only as optional secondary live information.
- Added `debug=1` API diagnostics and Worker health source reporting.
- Updated cache keys and website version assets.

## v7.1.2
- Fixed official timetable parsing for the southbound section labelled `往機場、中壢(老街溪站)`.
- Fixed missing Zhongli-bound departures and A1 timetable failures.

# v7.1.1 — Airport MRT Official Timetable Hotfix

- Replaced platform countdown data with TDX official daily timetable data.
- Displays actual next departure clock times (HH:mm).
- Removed estimated/fabricated timetable fallback.
- When timetable data is unavailable, shows a clear official-timetable prompt instead of misleading values.
- Updated Crew Portal version to v7.1.1 / Build 20260721-007.

# v7.0.0 — Airport MRT Next Train Timetable

- Airport MRT now displays the next train as a clock time (`HH:mm`).
- Replaced the large “Arriving” and minute-countdown presentation with timetable-first information.
- TDX real-time estimates are converted into useful next-train times.
- Kept a small arrival-status line for trains that are very close.
- Updated Crew Portal version to v7.0.0 / Build 20260721-005.
- Updated Cloudflare Worker API to v2.0.0.

# v6.9.1 — Version Display Fix

- Fixed the footer version being overwritten by the old `app-4.js` constant.
- Footer and diagnostics now read the version and build from `data/version.json`.
- Updated cache-busting values to force browsers and GitHub Pages to load the corrected files.

# v6.9.0 — TDX Live MRT Frontend Integration

- Airport MRT now uses the verified Cloudflare `/api/mrt` endpoint.
- Live countdowns show `Arriving`, minutes remaining, scheduled time and destination.
- Missing Express data is no longer incorrectly labelled as permanent no-service at Express stations.
- Stations without Express service display a clear bilingual status.
- Updated cache-busting, version metadata and Worker health version.

# Changelog

## v6.8.0 — 2026-07-21

### Airport MRT production upgrade
- Connected the GitHub Pages front end to the dedicated Cloudflare Worker endpoint.
- Added a deploy-ready `cloudflare-worker.js` with TDX OAuth, LiveBoard lookup, edge caching, CORS, validation, health check, and error handling.
- Preserved the existing parking proxy at `/` and `/api/parking`.
- Kept the local scheduled estimate as an automatic front-end fallback when live data is unavailable.
- Updated asset cache versions and site version metadata.

## v6.7.0 — 2026-07-21

- Added secure TDX OAuth integration through the Cloudflare Pages Worker.
- Airport MRT now prefers official TDX LiveBoard data.
- Added 30-second edge caching to reduce API usage.
- Preserved automatic scheduled-time fallback when TDX is unavailable.
- Added visible Live / Scheduled data-source status.
- Added TDX deployment and secret configuration instructions.

## v6.6.0 — 2026-07-21

- Added bilingual Airport MRT timetable card.
- Added station selector for A1–A22, defaulting to A13 Airport Terminal 2.
- Added next scheduled Commuter and Express train display with minute-boundary refresh.
- Added official timetable links and A14 coming-soon handling.
- Updated responsive hero operations layout and site version.

## v6.4.2 — 2026-07-18
- 修正桃園機場停車更新流程的「假成功」問題。
- 僅在 P1、P2、P4 都取得有效數字時寫入資料。
- 加入第三備援來源，官方 JSON／CSV 暫時無法連線時仍可更新。
- 第一次同步若完全無法取得資料，GitHub Actions 會正確顯示失敗。
- 更新 actions/checkout 至 v5。
- 版本更新為 v6.4.2，Build 20260718-026。

## v6.2 — Build 20260717-022

- Rebuilt Parking and Pacific HF as independent validated updaters.
- Parking checks every five minutes; Pacific HF checks every fifteen minutes.
- Both writers share one repository-wide concurrency queue.
- Added atomic Parking JSON replacement and strict field validation.
- Added shared rebase/push retry logic.
- Failed sources preserve the last-good data instead of corrupting or partially updating files.
- Removed `data/parking.json` from the upload package to prevent manual deployments from overwriting live data.
- Corrected footer and version metadata to v6.2.

## v6.3 — Monitoring Dashboard
- Added a black-gold System Status panel above the footer.
- Parking health is calculated from the latest parking data timestamp.
- Pacific HF shows bulletin time, last repository check, and next 15-minute check.
- GitHub raw JSON availability is checked independently for Parking and ARINC.
- Added expandable diagnostics for source, HTTP result, ARINC route, cache policy, version, and build.

## v6.4 — 2026-07-18
- 將「華航園區停車位」整合為單一「停車資訊」面板。
- 保留 BOT、TSA、RD1A、RD1B 即時剩餘車位。
- 新增桃園國際機場 P4 即時剩餘車位資料。
- P3 在官方未提供即時資料時明確顯示「未提供」。
- 新增獨立機場停車 CSV 抓取與驗證程式，避免影響華航園區資料。
- 更新 GitHub Actions，每 5 分鐘同步兩份停車資料。
- 更新版本號至 v6.4 / Build 20260718-024。

## v6.4.2 — 2026-07-18
- 桃園機場停車資訊新增 P1、P2，並保留 P4 與 P3「官方未提供」。
- 改用官方 CurrentParking JSON API 為主要來源，CSV 為備援。
- 資料來源暫時無回應時保留上次成功資料，workflow 不再因單次逾時顯示失敗。
- 縮短連線等待時間並強化多種 JSON／CSV 格式解析。
- 更新版本號至 v6.4.2 / Build 20260718-026。
## Operational reliability update — 2026-07-25

- Added TDX official Airport FIDS as the final gate-data fallback when the Taoyuan ADIP endpoint is unreachable from GitHub Actions.
- Normalized official TDX departure/arrival rows into the existing gate snapshot schema and retained strict same-day gate validation.
- Added short-lived Worker-side caching for TDX fallback requests to avoid repeated upstream calls.
- Bumped Worker version to 2.6.0.
## Flight gate continuity fix — 2026-07-25

- Prevented TDX Airport FIDS code-share expansion from replacing the last known ADIP route set for an existing flight.
- Restored lookup continuity for numeric queries such as `601` and `701` and normalized `CI008` to the correct `CI8` route set.
- Added an API warning when a previous ADIP row is retained for continuity.
- Bumped Worker version to 2.7.0.
## Flight gate snapshot reset — 2026-07-25

- Stopped cumulative carry-over of malformed TDX flight rows between scheduled updates.
- TDX fallback now refreshes only the fixed last-known ADIP route set and never appends unverified extra routes.
- Added a cache-busting frontend script URL and removed continuity wording from the API response.
- Bumped Worker version to 2.8.0 and frontend build to 20260725-004.
## Gate panel layout update — 2026-07-25

- Separated the terminal column from the gate column so terminal values remain visible at desktop and mobile widths.
- Normalized terminal labels to `T1`, `T2`, and `T3`.
- Added English labels after arrival/departure directions.
- Bumped frontend build to 20260725-005.
## Gate data continuity and departure-time fix — 2026-07-26

- Preserved confirmed same-day gates when TDX temporarily returns an empty gate or removes a departed flight.
- Merged same-flight rows by route identity so schedule-time changes do not create stale duplicates.
- Displayed official estimated departure/arrival times and marked changed times as `預計`.
- Replaced misleading `尚未公布` for departed flights without an official gate with honest `無資料`.

## Gate source freshness guard — 2026-07-26

- Refused to publish TDX snapshots that do not contain next-day rows, preventing stale-date data from replacing the last validated snapshot.
- Kept stale-data warnings visible after a successful lookup and changed blank gates on stale data to `無法確認`.
- Bumped frontend build to 20260726-002.

## Full flight-gate snapshot validation — 2026-07-26

- Rejected duplicate route rows and any departed non-cancelled flight without an official gate.
- Added snapshot quality counters for today’s departure coverage and missing departed gates.
- Bumped frontend build to 20260726-003.

## Gate status semantics cleanup — 2026-07-26

- Displayed `無資料` instead of `尚未公布` for cancelled flights without an official gate.
- Bumped frontend build to 20260726-004.

## Continuous automation stability fix — 2026-07-26

- Distinguished legitimate multiple scheduled services of the same flight number from duplicate route rows.
- Preserved gate continuity only when the scheduled time is exact, or when a changed time has one unambiguous prior route.
- Restored the recurring flight-gate workflow after its duplicate-row guard caused three consecutive scheduled failures.
- Bumped frontend build to 20260726-005.

## TDX fallback resilience — 2026-07-26

- Deterministically collapsed official TDX rows duplicated only by terminal while preserving non-cancelled status and confirmed gates.
- Added the deduplicated-row count to snapshot quality metrics so the full recurring refresh remains auditable.
- Kept officially unpublished gates as auditable no-data rows during TDX fallback instead of aborting the full refresh.
- Bumped frontend build to 20260726-007.

## Crew parking display order — 2026-07-26

- Reordered the China Airlines parking cells to BOT, RD1A, RD1B, TSA.
- Bumped frontend build to 20260726-008.

## Live flight fallback and multi-route layout — 2026-07-26

- Added a direct TDX Airport FIDS live fallback when the GitHub flight snapshot is more than 10 minutes old.
- Kept the last validated snapshot when the live fallback is unavailable, with the existing freshness warning.
- Constrained multi-route gate headers with responsive grid columns and ellipsis so route text cannot overlap the query or update time.
- Bumped frontend build to 20260726-018 and Worker version to 2.8.9.

## Prevent stale flight fallback — 2026-07-26

- Stopped the Worker from returning the old GitHub flight snapshot when the live TDX source is unavailable.
- Added an explicit live-data-unavailable response so morning flights such as CI833 cannot intermittently appear or disappear based on the Worker instance handling the request.
- Bumped frontend build to 20260726-019 and Worker version to 2.8.10.

## Preserve same-day completed flights — 2026-07-26

- Merged same-day departed, arrived, and cancelled rows from the validated continuity snapshot into the live TDX result when the live FIDS list has already dropped them.
- Kept live TDX rows authoritative for current and future flights, including gates and estimated times.
- Bumped frontend build to 20260726-020 and Worker version to 2.8.11.

## Correct official flight route matching — 2026-07-26

- Made the official Taoyuan Airport ADIP CSV the primary live source for gate lookup.
- Rejected ambiguous TDX multi-route expansion when no official route baseline exists, preventing CI008 from displaying unrelated PVG, ANC, BKK, or PUS sectors.
- Preserved CI833's official TPE/BKK continuity row while keeping CI008 as TPE/LAX with gate D2.
- Bumped frontend build to 20260726-021 and Worker version to 2.8.12.

## Preserve gate result title — 2026-07-26

- Reserved a max-content column for the flight title so `CI160 登機門` and similar labels remain complete.
- Kept long route text ellipsized in the middle column instead of truncating the title.
- Bumped frontend build to 20260726-022.

## Gate success-status cleanup — 2026-07-25

- Removed the successful gate-query status line from the result panel.
- Kept the flight result rows and retained error messages for failed lookups.
- Bumped frontend build to 20260725-006.

## Cargo stand integration — 2026-07-26

- Added a Worker cargo-stand endpoint backed by TPE GOSS public ground-operations data.
- Validated cargo positions against the RCTP cargo-stand range 501–525 and today’s Taipei date before displaying them.
- Added cargo-airline query support such as `5X61` and kept cargo stands separate from passenger boarding gates in RCTP GATE INFO.
- Bumped portal version to v8.1.4, frontend build to 20260726-023, and Worker version to 2.8.13.

## Cargo-only freshness display — 2026-07-26

- Kept passenger flight snapshot delay warnings separate from fresh cargo-stand results.
- Bumped portal version to v8.1.5 and frontend build to 20260726-024.

## Numeric flight input defaults to China Airlines — 2026-07-26

- Made the default airline explicit: numeric-only input such as `160` is normalized to `CI160` in both frontend and Worker queries.
- Updated the input hint to document the behavior.
- Bumped portal version to v8.1.6, frontend build to 20260726-025, and Worker version to 2.8.14.

## Numeric CI normalization guard — 2026-07-26

- Evaluated numeric-only input before airline-prefix parsing so `160` cannot be misread as airline `16` plus flight `0`.
- Bumped portal version to v8.1.7, frontend build to 20260726-026, and Worker version to 2.8.15.

# Use 未定 for unpublished gate or stand — 2026-07-27
- Bumped portal version to v8.2.7, frontend build to 20260727-1405, and Worker version to 2.8.25.
- Replaced all pending empty gate/stand labels, including delayed-data states, with `未定`; departed or cancelled flights remain `無資料`.
- Merged ADIP and TDX official live flight rows by schedule so a gate published by either source is retained.
- Pending flights no longer bypass live refresh merely because they already exist in the continuity snapshot.
- Disabled Cloudflare subrequest caching for the ADIP fetch path so the official feed is requested directly.

## Official source retry and dual-source refresh — 2026-07-27
- Bumped portal version to v8.2.8, frontend build to 20260727-1411, and Worker version to 2.8.26.
- Retry each official ADIP route twice with a 10-second connection timeout and 25-second response timeout before using TDX fallback.
- Keep ADIP and TDX official rows merged by flight schedule whenever both sources are available.

## Retry completed flights with missing gates — 2026-07-27
- Bumped portal version to v8.2.9, frontend build to 20260727-1419, and Worker version to 2.8.27.
- A completed flight with a blank gate or stand no longer short-circuits to an expired snapshot; it requests the official sources again.

## Preserve confirmed gates across fallback — 2026-07-27
- Bumped portal version to v8.2.10, frontend build to 20260727-1424, and Worker version to 2.8.28.
- The scheduled updater now carries forward previously confirmed ADIP gate/status values when a later run must fall back to TDX.

## English departed status and flown cargo badge — 2026-07-27
- Bumped portal version to v8.2.11 and frontend build to 20260727-1654.
- Normalized departed flight status to `DEPARTED` without the Chinese status text.
- Replaced the cargo stand number with a red-background, white-text `DEPARTED` badge after departure.

## Cache-busted departed badge hotfix — 2026-07-27
- Bumped portal version to v8.2.12 and frontend build to 20260727-1704.
- Advanced the asset cache-buster so browsers cannot retain the pre-hotfix `app-4.js` bundle.

## Hide terminal on departed flights — 2026-07-27
- Bumped portal version to v8.2.13 and frontend build to 20260727-1711.
- Departed passenger and cargo flights now hide terminal and gate/stand values and show a red-background, white-text `已飛` badge.
- The status line remains the English `DEPARTED` label for foreign crew.

## Right-align flown badge — 2026-07-27
- Bumped portal version to v8.2.14 and frontend build to 20260727-1736.
- Right-aligned the red `已飛` badge for both passenger gates and cargo stands.

# Preserve pending same-day flights during live-source fallback — 2026-07-27
- Bumped portal version to v8.2.3, frontend build to 20260727-0732, and Worker version to 2.8.21.
- Preserved current same-day scheduled flights from the validated official snapshot when the live TDX source omits pending rows, while retaining live rows as the authoritative values when present.

## Compact English flight input hint — 2026-07-27

- Bumped portal version to v8.2.2, frontend build to 20260727-0717, and Worker version to 2.8.20.
- Shortened the RCTP GATE INFO input hint to `CI100 / 4 digits` so it remains visible beside the GATE button.

## Simplified cargo and foreign-crew input guidance — 2026-07-27

- Bumped portal version to v8.2.1, frontend build to 20260727-002, and Worker version to 2.8.19.
- Removed the cargo-stand title row and passenger-flight data-freshness warning from the visible RCTP GATE INFO result.
- Changed the flight input hint to English: `CI100 or 4 digits = CI flight`.

## Cargo lookup display and responsive CI normalization — 2026-07-27

- Bumped portal version to v8.2.0, frontend build to 20260727-001, and Worker version to 2.8.18.
- Removed the visible TPE GOSS source line from the cargo-stand result and hid terminal information for cargo stands.
- Cargo-stand results render as soon as the cargo source responds instead of waiting for a slow passenger gate lookup.
- Documented that a four-digit numeric input is automatically treated as a CI flight; the existing frontend and Worker normalization continues to enforce CI plus the number.

## Numeric CI normalization and upstream timeout guard — 2026-07-26

- Bumped portal version to v8.1.8, frontend build to 20260726-027, and Worker version to 2.8.16.
- Added bounded timeouts to official flight, TDX fallback, and cargo upstream requests so a stalled source cannot leave lookup indefinitely in a loading state.
- Preserved the rule that stale official snapshots are not silently presented as current live data.

## Numeric CI query responsiveness — 2026-07-26

- Bumped portal version to v8.1.9, frontend build to 20260726-028, and Worker version to 2.8.17.
- Return a requested same-day completed flight from the official continuity snapshot immediately when live upstream data is delayed, with the stale-data warning preserved.
## v8.1.0 — 2026-07-26

- Added three selectable premium Hero typography treatments via `?heroStyle=1`, `?heroStyle=2`, and `?heroStyle=3`.
- Preserved the existing wording, background artwork, responsive layout, and operational panels.
- Bumped frontend build to 20260726-009.
## v8.1.1 — 2026-07-26

- Updated Pacific HF validity metadata to the official English format: `Valid from July 26, 2026, 1100Z`.
- Bumped frontend build to 20260726-010.
## v8.1.2 — 2026-07-26

- Shortened the Hero subtitle to `Professional Resources for Crew`.
- Bumped frontend build to 20260726-011.
## v8.1.3 — 2026-07-26

- Renamed the Pacific HF table header from `區域` to `Region`.
- Removed the VHF `用途／頻率` header row for a cleaner compact panel.
- Bumped frontend build to 20260726-012.
