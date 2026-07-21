# Crew Portal v7.1.2 — Airport MRT direction hotfix

## Fixed

- Corrected the official Taoyuan Metro southbound timetable marker.
- Restored southbound (airport / Zhongli / Laojie River) departures for all stations.
- Fixed A1 Taipei Main Station, which previously showed timetable unavailable.
- Prevented southbound rows from being misclassified as Taipei-bound trains.

## Deployment

1. Upload the website files to GitHub Pages.
2. Replace the Cloudflare Worker code with `cloudflare-worker.js`.
3. Deploy the Worker.
4. Test A1, A3, A8, A12, A13 and A22.
