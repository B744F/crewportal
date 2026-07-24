# FlightDeck Crew Portal v8.0.0 部署

## 部署內容

1. 將 repository 的網站檔案部署至 GitHub Pages。
2. 將 `cloudflare-worker.js` 部署至 `flightdeck-api` Worker。
3. 保留 Cloudflare secrets：`TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`。
4. 不要把 TDX secrets 寫入 repository 或前端 JavaScript。

## 上線驗證

確認 `/api/health` 回傳：

```json
{
  "portalVersion": "v8.0.0",
  "workerVersion": "2.4.3",
  "timetableParser": "structured-official"
}
```

航班登機門查詢使用 `/api/flight-gate?flight=CI100`，資料由 GitHub Actions 每 5 分鐘擷取桃園機場 ADIP 官方即時航班資料並更新快照。

驗證車站：`A1`、`A3`、`A8`、`A12`、`A13`、`A21`、`A22`。

每個 `/api/mrt?station=...&debug=1` 回應都必須使用官方結構化時刻表。主要來源為 TDX `StationTimeTable`，桃園市政府 XML 為官方結構化備援；TDX LiveBoard 不得取代官方時刻表，也不得在資料缺失時補造班次。

完整結果請見 [MRT_TEST_REPORT.md](MRT_TEST_REPORT.md)。
