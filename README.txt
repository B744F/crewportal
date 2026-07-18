# CrewPortal v6.4.3 狀態判斷修正版

請將資料夾內三個檔案上傳到 GitHub Repository 相同路徑並覆蓋：

- js/app-2.js
- js/app-4.js
- data/version.json

完成後請在瀏覽器執行強制重新整理：
- Mac：Command + Shift + R
- Windows：Ctrl + F5

本版修正：
1. 停車卡片明確顯示哪一組資料使用暫存。
2. System Status 會使用停車卡片已保存的瀏覽器暫存，不再因 parking.json 404 直接判定整體離線。
3. 桃園機場 P1/P2/P4 有有效資料時會列入 Parking 狀態。
4. Diagnostics 顯示 Crew 與 Airport 各自資料來源。
5. 修正 ARINC UTC 時間解析。
6. Overall Status 改為 Operational / Partial Sync / Offline。
7. 診斷區版本會讀取 data/version.json。
