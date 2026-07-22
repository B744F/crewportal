# Airport MRT Test Report — v8.0.0

測試日期：2026-07-22（Asia/Taipei）
正式部署：已完成 GitHub Pages 與 Cloudflare Worker production deployment

## 測試範圍

- 以 production Worker 執行即時抓取的桃園市政府官方 XML parser smoke test。
- 未使用估算、備援或人工建立的 timetable data。
- TDX LiveBoard 即使已設定，也只作次要即時資訊，沒有被當作時刻表來源。
- 官方來源：https://opendata.tycg.gov.tw/api/dataset/8e6201c2-1968-4920-aba3-1a68093dab53/resource/83358afd-010a-4989-b63a-bbf20692e408/download

## 車站驗證

| Station | HTTP | Taipei 普通／直達 | Zhongli 普通／直達 | 結果 |
|---|---:|---|---|---|
| A1 | 200 | — ／ — | 17:37 ／ 17:30 | 通過：台北方向不可用 |
| A3 | 200 | 17:32 ／ 17:26 | 17:32 ／ 17:39 | 通過：兩方向均依官方資料顯示 |
| A8 | 200 | 17:28 ／ 17:26 | 17:38 ／ 17:36 | 通過：兩方向均依官方資料顯示 |
| A12 | 200 | 17:37 ／ 17:28 | 17:27 ／ 17:37 | 通過：兩方向均依官方資料顯示 |
| A13 | 200 | 17:34 ／ 17:40 | 17:30 ／ 17:41 | 通過：兩方向均依官方資料顯示 |
| A21 | 200 | 17:35 ／ 18:14 | — ／ — | 通過：只顯示官方目前回傳的有效方向 |
| A22 | 503 | — | — | 阻塞：官方 XML 目前沒有任何 A22 `StationID` 記錄 |

所有成功回應的 `sourceType` 均為 `structured-official`。A1 與 A21 的方向結果由 `Direction`、`StationID`、`DestinationStationID` 關係驗證，不讀取中文名稱；`TrainType` 另外分流普通車與直達車。

## Health 驗證

production `/api/health` 回應 200，關鍵欄位如下：

```json
{
  "portalVersion": "v8.0.0",
  "workerVersion": "2.3.0",
  "timetableParser": "structured-official"
}
```

## 靜態檢查

- `node --check cloudflare-worker.js`：通過
- `node --check js/airport-mrt.js`：通過
- `git diff --check`：通過
- 前端 MRT 時刻欄位輸出限制為 `HH:mm` 或 `—`：通過
- 已移除前端估算班次、排程備援文字與方向中文文字判斷：通過
- `.DS_Store`、`__pycache__`、`README.txt`、`CHANGELOG.txt`、舊部署文件與暫存檔：已清理

## 剩餘問題

官方 XML 資料來源目前沒有 A22 記錄，因此本版不會顯示 A22 的任何時刻，也不會用官方網頁文字或自行推算資料填補。部署後若官方結構化來源補回 A22 記錄，現有 parser 會依欄位自動顯示有效的台北方向，並維持中壢方向為 `—`。

GitHub Pages 已載入 v8.0.0 資產，Cloudflare Worker 已部署 Worker `2.3.0`；production health 與指定車站 smoke test 均已完成。
