## v5.7.2
- 修正 ARINC 有效日期來源：只擷取頁面最上端「Pacific HF Frequency Assignments」標題下方的 Valid from。
- 同時抓取多個快取變體並選擇最新的有效時間，避免 CDN 舊快取造成日期落後。
- 初始有效時間更新為 July 16, 2026, 1300Z。

## v5.7.1
- 修正 ARINC 生效時間：辨識 Zulu/UTC 並同步顯示台灣時間（UTC+8）。
- ARINC 抓取加入 cache-busting 與 no-cache headers，降低取得舊快取資料的機率。
- JSON 新增 validFromUtc 與 fetchedAtUtc。

## v5.7.0 — 2026-07-16
- 在「華航園區停車位」右側新增 PACIFIC HF 資訊卡。
- 顯示 ARINC Pacific 表格最上方有效時間。
- 僅顯示「North America → Asia」與「Alaska/North Pacific (West of 150W)」的 Primary／Secondary；不顯示 Tertiary。
- 新增 `data/arinc.json`、前端自動刷新與瀏覽器備援快取。
- 新增 GitHub Actions 每 30 分鐘檢查官方資料；內容變更時自動更新網站資料。
- 桌面版採 ATIS／停車位／PACIFIC HF 三欄，窄螢幕自動改為直向排列。

## v5.6.1 — 2026-07-16
- 調整 Hero 上方留白，讓浮動 Logo 不再遮住「China Airlines Crew Portal」文字。
- 修正停車資訊讀取失敗時全部顯示「--」的問題。
- 停車資料成功讀取後會保存於瀏覽器；同步暫時失敗時自動顯示最近一次有效資料。
- 加入內建備援停車資料及 Git 合併標記容錯處理，恢復後會自動切回即時同步。
- 修正頁面不存在時鐘元素所造成的 JavaScript 錯誤。
- CSS、JavaScript、頁尾與版本資料同步更新至 v5.6.1。

## v5.6.0 — 2026-07-16
- 移除頁面最上方固定式 FlightDeck 標頭，避免遮擋 Hero 圖。
- 將圓形網站 Logo 移至 Hero 左上角並放大。
- Logo 加入柔和金色呼吸光、微幅漂浮及滑鼠懸停立體效果。
- Hero 文字與操作面板加入柔和淡入動畫。
- 支援 prefers-reduced-motion，減少動態偏好的裝置會自動停用動畫。
- 網站版本更新為 v5.6.0。

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
