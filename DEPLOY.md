# FlightDeck Crew Portal v8.2.72 部署

## 部署內容

1. 將 repository 的網站檔案部署至 GitHub Pages。
2. 將 `cloudflare-worker.js` 部署至 `flightdeck-api` Worker。
3. 保留 Cloudflare secrets：`TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`。
4. 不要把 TDX secrets 寫入 repository 或前端 JavaScript。

## 上線驗證

確認 `/api/health` 回傳：

```json
{
  "portalVersion": "v8.2.72",
  "workerVersion": "2.8.72",
  "timetableParser": "structured-official"
}
```

航班登機門查詢使用 `/api/flight-gate?airport=RCTP&flight=CI100`，支援 RCTP、RCSS、RCMQ、RCKH；公開查詢使用桃園機場 ADIP／快照與各機場官方即時資料，RCSS 不再由使用者查詢直接觸發 TDX Airport FIDS；TDX FIDS 僅保留給排程備援。若抵達機門未公布，會以同航空公司、同往返航線、抵達後短時間內唯一對應的官方出發機門標示為「推定」。即時來源的航班號會保留完整數字，不會將 CI602 誤解析為 CI2；同日已確認的登機門也不會因即時來源短暫空值而退回「未定」。

貨機坪查詢使用 `/api/cargo-stand?flight=5X61`，由 Worker 取得 TPE GOSS 公開地面作業資料，只接受今日且落在 RCTP 貨機坪 501–525 的停機位；前端在 RCTP GATE INFO 中將貨機坪與客機登機門分開顯示。

驗證車站：`A1`、`A3`、`A8`、`A12`、`A13`、`A21`、`A22`。

每個 `/api/mrt?station=...&debug=1` 回應都必須使用官方結構化時刻表。主要來源為 TDX `StationTimeTable`，桃園市政府 XML 為官方結構化備援；TDX LiveBoard 已停用，不得取代官方時刻表，也不得在資料缺失時補造班次。

完整結果請見 [MRT_TEST_REPORT.md](MRT_TEST_REPORT.md)。
