# FlightDeck Crew Portal v6.2

Long-term stable GitHub Pages package.

## Data schedules

- Parking: every 5 minutes (`*/5 * * * *`)
- Pacific HF: every 15 minutes (`*/15 * * * *`)

Both workflows share the `crewportal-data-writes` concurrency group, so only one data writer can commit at a time. Each updater validates its complete JSON payload before atomically replacing a data file. Failed network requests preserve the last-good file.

## Important upload rule

This package intentionally does **not** contain `data/parking.json`. Uploading the package therefore cannot overwrite the live parking data maintained by GitHub Actions.

Make hidden files visible and confirm these files exist in the repository:

- `.github/workflows/update-parking.yml`
- `.github/workflows/update-arinc.yml`
- `scripts/update_parking.py`
- `scripts/update_arinc.py`
- `scripts/commit_data_file.sh`

## System Status (v6.4.1)
The footer monitoring dashboard reads the public GitHub raw JSON files with cache-busting requests. It reports data-pipeline health based on file availability and timestamp freshness; it does not claim to read private GitHub Actions failure logs.
