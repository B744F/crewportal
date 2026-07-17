# Changelog

## v6.1.3 — 2026-07-17
- Restore the missing `.github/workflows/update-parking.yml` workflow.
- Add connection timeout, retries, HTTP failure detection, and strict JSON validation.
- Preserve the last valid parking file whenever the upstream server is unavailable or returns malformed data.
- Use one shared GitHub Actions concurrency group for parking and ARINC data commits to prevent merge conflicts.
- Rebase before pushing updated parking data.
- Version updated to v6.1.3, Build 20260717-021.

## v6.1.2
- Prevent website update packages from overwriting live `data/parking.json`.
- Refresh bundled emergency fallback with the latest verified parking snapshot.
- Keep Pacific HF and parking update paths isolated.

# Changelog

## v6.1 — 2026-07-17
- 修正 GitHub Actions 因多個代理來源逐一等待逾時而長時間卡住。
- 改為 8 個來源平行抓取，每個來源最多等待 10 秒。
- 單次 Python 執行限制 35 秒，最多重試 2 次。
- Workflow 總上限縮短為 3 分鐘，通常 15～30 秒完成。
- 新執行會取消仍在進行的舊執行，避免排程堆積。
- 版本更新為 v6.1，Build 20260717-018。

## v6.0 — 2026-07-17

- 重新設計 GitHub Pages 的 ARINC 同步架構。
- 前端優先直接讀取 GitHub Raw `data/arinc.json`，避開 Pages 建置與 CDN 延遲。
- GitHub Actions 固定於 UTC 每個整點後 5 分鐘執行。
- 每次排程即使頻率未變，也更新 `fetchedAtUtc` 心跳時間，方便確認排程是否正常。
- 抓取程式擴充多來源比對與診斷資料，只採用最新完整表格。
- GitHub Actions 加入重試、rebase 與推送保護。
- 移除不適用於 GitHub Pages 的 `_worker.js`。
- 版本號統一更新為 v6.0，Build 20260717-016。
