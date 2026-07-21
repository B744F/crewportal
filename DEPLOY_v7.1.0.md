# Crew Portal v7.1.1 部署說明

## 本次升級

- 機場捷運主要資料改為「桃園捷運官網各站時刻表」。
- 顯示下一班普通車與直達車的官方時刻（HH:mm）。
- TDX LiveBoard 僅作為即時狀態補充；即使 TDX 暫時失效，官方時刻仍可顯示。
- 移除不存在的 TDX DailyTimetable API，修正 404 問題。
- API 失敗時不再產生推估或假時刻。

## 部署順序

1. 將網站資料夾內容推送到 GitHub Pages。
2. 開啟 Cloudflare Workers & Pages → `flightdeck-api`。
3. 用本專案根目錄的 `cloudflare-worker.js` 完整覆蓋 Worker 程式碼。
4. 按 **Deploy**。
5. 測試：

   `https://flightdeck-api.201505-login.workers.dev/api/mrt?station=A13`

成功時應看到：

- `"ok": true`
- `"mode": "timetable"`
- `"source": "Taoyuan Metro Official Timetable"`
- `trains` 內為 `HH:mm` 時刻

## Secrets

原本的 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 請保留，用於補充 LiveBoard 狀態。官方時刻表本身不依賴 TDX Secrets。
