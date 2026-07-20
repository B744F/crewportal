# CrewPortal v6.4.3 正式版更新包

本更新包會在現有 CrewPortal 正式版原始碼上，自動完成以下修改：

1. 公司系統區塊
   - `CAL Web-Mail` 改為 `CAL Outlook`
   - 連結改為 `https://outlook.com/china-airlines.com`
   - 副標改為 `Outlook Mail`

2. Quick Access 區塊
   - 桌面版由每排 6 個改為每排 10 個
   - 單一按鈕寬度約縮小 40%
   - 圖案、文字大小及按鈕高度保持不變
   - 平板每排 5 個、一般手機每排 3 個、窄手機每排 2 個

3. 版本資訊
   - Version：v6.4.3
   - Build：20260720-027
   - CSS、JavaScript 快取版本同步更新

## 使用方式

把本 ZIP 解壓縮後，將 `apply_update.py` 放進 CrewPortal 專案根目錄，也就是與 `index.html` 同一層。

在終端機執行：

```bash
python3 apply_update.py
```

也可以指定網站資料夾：

```bash
python3 apply_update.py /你的路徑/crewportal
```

完成後，將更新後的整個網站資料夾上傳至 GitHub Repo 即可。

## 注意

執行前建議先備份 `index.html` 與 `css/style.css`。
此更新腳本可重複執行，不會重複加入 Quick Access 樣式。
