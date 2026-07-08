# Changelog

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
