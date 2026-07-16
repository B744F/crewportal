# Changelog

## v5.5.0 - 2026-07-08
- Changed parking panel to re-read `data/parking.json` every 15 seconds.
- Added immediate refresh when returning to the browser tab/window.
- Added cache-busting query strings to `app-1.js` and `app-2.js` so GitHub Pages loads the latest JavaScript after upload.
- Updated footer/version metadata to v5.5.0 / Build 20260708-005.


## v5.4.1 - 2026-07-08
- Fixed parking next sync display so it shows the next 5-minute cron time even before fresh data loads.
- Added absolute next sync clock time with countdown.
- Kept existing parking JSON fallback and live/stale status logic.

# FlightDeck Changelog

## v5.4.0 - 2026-07-08
- Added parking data age display.
- Added next sync countdown for cron/GitHub Actions updates.
- Added Live / expired / offline parking status behavior.
- Added smooth number pulse animation when parking values change.
- Updated footer and version metadata to v5.4.0.

# FlightDeck Changelog

## v5.3.0 - 2026-07-08

- Improved parking status wording from generic fallback to GitHub sync status.
- `js/app-2.js` now supports both raw API array and normalized `parking.json` object.
- Parking display refreshes `data/parking.json` every 30 seconds with cache busting.
- Added stale-data detection after 15 minutes.
- Updated GitHub Actions workflow with normalized parking JSON, concurrency protection, and offline preservation.
- Footer version updated to v5.3.0 / Build 20260708-003.

## v5.2.0 - 2026-07-08

- Added parking display from `data/parking.json`.
- Added Last Update display and status detection.
- Added GitHub Actions parking workflow foundation.

## v5.5.1 — 2026-07-16
- 修正手機與直向裝置 Hero 圖被裁切的問題。
- Hero 圖在窄螢幕改為依原始比例完整顯示，剩餘區域延續深藍背景。
- 加入 CSS 版本參數，避免瀏覽器沿用舊快取。
