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

## v6.4 — 2026-07-18
- 將「華航園區停車位」整合為單一「停車資訊」面板。
- 保留 BOT、TSA、RD1A、RD1B 即時剩餘車位。
- 新增桃園國際機場 P4 即時剩餘車位資料。
- P3 在官方未提供即時資料時明確顯示「未提供」。
- 新增獨立機場停車 CSV 抓取與驗證程式，避免影響華航園區資料。
- 更新 GitHub Actions，每 5 分鐘同步兩份停車資料。
- 更新版本號至 v6.4 / Build 20260718-024。

## v6.4.1 — 2026-07-18
- 桃園機場停車資訊新增 P1、P2，並保留 P4 與 P3「官方未提供」。
- 改用官方 CurrentParking JSON API 為主要來源，CSV 為備援。
- 資料來源暫時無回應時保留上次成功資料，workflow 不再因單次逾時顯示失敗。
- 縮短連線等待時間並強化多種 JSON／CSV 格式解析。
- 更新版本號至 v6.4.1 / Build 20260718-025。
