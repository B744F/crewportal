# CrewPortal v6.1.2

GitHub Pages 版本。

## ARINC 更新架構

1. `.github/workflows/update-arinc.yml` 於每個 UTC 整點後 5 分鐘執行。
2. `scripts/update_arinc.py` 透過多個獨立來源抓取 ARINC 頁面，選擇最新且完整的資料。
3. 更新結果提交到 `data/arinc.json`。
4. 網頁優先直接讀取 GitHub 儲存庫的 Raw JSON，因此不必等待 GitHub Pages 重新部署或 CDN 更新。
5. 網站內的 `data/arinc.json` 與瀏覽器 localStorage 僅作備援。

## 部署

解壓縮後，把所有檔案連同隱藏資料夾 `.github` 一起上傳到儲存庫根目錄。macOS Finder 可用 `⌘ + Shift + .` 顯示隱藏檔。

上傳後到 GitHub 的 Actions 頁面，確認能看到 **Update ARINC Pacific HF**，並手動執行一次。


## ARINC 更新排程
- GitHub Actions 於 UTC 每小時 00、15、30、45 分檢查一次。
- 網頁會在每個 UTC 15 分鐘節點後約 5 秒重新讀取最新資料，並在回到分頁或視窗取得焦點時再次檢查。


## v6.1.2 deployment safety
- `data/parking.json` is intentionally excluded from this update package.
- Dragging the update files to GitHub will therefore preserve the live parking file maintained by the parking updater.
- Do not manually upload an old `data/parking.json`, because it can overwrite current parking availability.
