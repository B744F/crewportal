# v6.3.3 Emergency ARINC Correction

- Corrected official bulletin to July 17, 2026, 0215Z.
- Corrected North America → Asia to 11282 / 5547.
- Preserved Alaska/North Pacific at 17946 / 13339.
- Older CDN/cache responses can no longer replace newer verified data.
- Every workflow run now records whether the upstream response was fresh, stale, or unavailable.

# CrewPortal v6.3.3 Hotfix

- Separate ARINC bulletin effective time from workflow check time.
- Add `checkedAtUtc` and publish it after every successful 15-minute check.
- Show the complete UTC date and time for Pacific HF Valid From.
- Use `checkedAtUtc` for System Status Last Check.
- Upgrade GitHub checkout action to v5.
- Version v6.3.3 / Build 20260717-026.

## v6.3.1 Hotfix
- Restored data/parking.json so GitHub Pages no longer returns HTTP 404.
- Monitoring now reads the same local JSON files as the main cards.
- Pacific HF is no longer marked delayed merely because the official bulletin did not change.
- Version updated to v6.3.1 / Build 20260717-024.

# Changelog

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
