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
  "workerVersion": "2.3.0",
  "timetableParser": "structured-official"
}
```

驗證車站：`A1`、`A3`、`A8`、`A12`、`A13`、`A21`、`A22`。

每個 `/api/mrt?station=...&debug=1` 回應都必須使用官方結構化時刻表；TDX LiveBoard 不得取代官方時刻表，也不得在資料缺失時補造班次。

完整結果請見 [MRT_TEST_REPORT.md](MRT_TEST_REPORT.md)。
