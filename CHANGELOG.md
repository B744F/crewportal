# Changelog

## v6.0 — 2026-07-17

- 重新設計 GitHub Pages 的 ARINC 同步架構。
- 前端優先直接讀取 GitHub Raw `data/arinc.json`，避開 Pages 建置與 CDN 延遲。
- GitHub Actions 固定於 UTC 每個整點後 5 分鐘執行。
- 每次排程即使頻率未變，也更新 `fetchedAtUtc` 心跳時間，方便確認排程是否正常。
- 抓取程式擴充多來源比對與診斷資料，只採用最新完整表格。
- GitHub Actions 加入重試、rebase 與推送保護。
- 移除不適用於 GitHub Pages 的 `_worker.js`。
- 版本號統一更新為 v6.0，Build 20260717-016。
