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
