# Airport MRT Test Report — v8.0.0

測試日期：2026-07-22（Asia/Taipei）

## 測試範圍

- 直接載入本地 `cloudflare-worker.js`，以即時抓取的桃園市政府官方 XML 執行 parser smoke test。
- 未使用估算、備援或人工建立的 timetable data。
- TDX LiveBoard 在本地測試沒有 credentials，因此沒有被當作時刻表來源。
- 官方來源：https://opendata.tycg.gov.tw/api/dataset/8e6201c2-1968-4920-aba3-1a68093dab53/resource/83358afd-010a-4989-b63a-bbf20692e408/download

## 車站驗證

| Station | HTTP | Taipei 普通／直達 | Zhongli 普通／直達 | 結果 |
|---|---:|---|---|---|
| A1 | 200 | — ／ — | 17:07 ／ 17:00 | 通過：台北方向不可用 |
| A3 | 200 | 17:02 ／ 16:56 | 17:02 ／ 16:54 | 通過：兩方向均依官方資料顯示 |
| A8 | 200 | 16:58 ／ 16:56 | 17:08 ／ 17:06 | 通過：兩方向均依官方資料顯示 |
| A12 | 200 | 17:07 ／ 16:58 | 16:57 ／ 17:07 | 通過：兩方向均依官方資料顯示 |
| A13 | 200 | 17:04 ／ 16:55 | 17:00 ／ 17:41 | 通過：兩方向均依官方資料顯示 |
| A21 | 200 | 17:05 ／ 17:14 | — ／ — | 通過：只顯示官方目前回傳的有效方向 |
| A22 | 503 | — | — | 阻塞：官方 XML 目前沒有任何 A22 `StationID` 記錄 |

所有成功回應的 `sourceType` 均為 `structured-official`。A1 與 A21 的方向結果由 `Direction`、`StationID`、`DestinationStationID` 關係驗證，不讀取中文名稱；`TrainType` 另外分流普通車與直達車。

## Health 驗證

`/api/health` 回應 200，關鍵欄位如下：

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

本次未執行正式 GitHub Pages／Cloudflare 部署：本機 `gh` 與 Wrangler 都未登入，需由有權限的部署環境依 `DEPLOY.md` 上線後再做 production endpoint smoke test。

目前 production `/api/health` 仍回傳 Worker `2.2.0`、`structured-xml`，表示 v8.0.0 尚未上線；這是部署權限阻塞，不是本地程式驗證失敗。
