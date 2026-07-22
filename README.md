# FlightDeck Crew Portal v8.0.0

正式版 FlightDeck Crew Portal。Airport MRT 優先使用 TDX `StationTimeTable` 官方結構化時刻表，桃園市政府 XML 作官方備援，解析 `StationID`、`Direction`、`DestinationStationID` 與 `TrainType`；TDX LiveBoard 僅作次要即時資訊，不會產生估算或虛構班次。

## 版本

- Portal Version：v8.0.0
- Worker Version：2.3.0
- Timetable Parser：`structured-official`

## 本版重點

- A1 僅顯示官方資料中的中壢方向；台北方向無有效班次時顯示 `—`。
- A22 僅顯示官方資料中的台北方向；中壢方向無有效班次時顯示 `—`。
- A2–A21 依官方結構化欄位顯示所有有效方向，並分開普通車與直達車。
- 時刻表欄位只顯示 `HH:mm` 或 `—`，移除排程備援與估算班次。

## 部署

請依 [DEPLOY.md](DEPLOY.md) 部署 GitHub Pages 與 Cloudflare Worker，並在部署後驗證 `/api/health` 及指定車站 API。

## 資料來源

- TDX：官方桃園捷運 `StationTimeTable`
- 桃園市政府開放資料：官方桃園捷運站別時刻表 XML 備援
- TDX LiveBoard：僅作次要即時資訊
