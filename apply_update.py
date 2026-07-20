#!/usr/bin/env python3
from pathlib import Path
import re
import sys

VERSION = "6.4.3"
BUILD = "20260720-027"

def fail(msg):
    print(f"[錯誤] {msg}")
    raise SystemExit(1)

base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
index = base / "index.html"
css = base / "css" / "style.css"

if not index.exists():
    fail(f"找不到 {index}")
if not css.exists():
    fail(f"找不到 {css}")

html = index.read_text(encoding="utf-8")
style = css.read_text(encoding="utf-8")

html = html.replace('aria-label="CAL Web-Mail"', 'aria-label="CAL Outlook"')
html = html.replace('alt="CAL Web-Mail icon"', 'alt="CAL Outlook icon"')
html = html.replace('href="https://webmail.china-airlines.com/"', 'href="https://outlook.com/china-airlines.com"')
html = html.replace('<strong>CAL Web-Mail</strong><span>Web Mail</span>',
                    '<strong>CAL Outlook</strong><span>Outlook Mail</span>')

html = re.sub(r'css/style\\.css\\?v=[0-9.]+', f'css/style.css?v={VERSION}', html)
html = re.sub(r'js/(app-[1-4]\\.js)\\?v=[0-9.]+', rf'js/\\1?v={VERSION}', html)
html = html.replace('v6.4.2', f'v{VERSION}')
html = html.replace('20260718-026', BUILD)

marker = "/* v6.4.3 - Compact Quick Access cards */"
if marker not in style:
    style += '''

/* v6.4.3 - Compact Quick Access cards
   Desktop cards are approximately 40% narrower than the previous 6-column layout.
   Icon size, text size and card height remain unchanged. */
.quick-grid{
  grid-template-columns:repeat(10,minmax(0,1fr));
  gap:12px;
}
@media(max-width:1250px){
  .quick-grid{grid-template-columns:repeat(5,minmax(0,1fr));}
}
@media(max-width:720px){
  .quick-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;}
}
@media(max-width:460px){
  .quick-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
}
'''

index.write_text(html, encoding="utf-8")
css.write_text(style, encoding="utf-8")

print("CrewPortal 正式版更新完成")
print(f"版本：v{VERSION}")
print(f"Build：{BUILD}")
print("修改：CAL Outlook 連結與名稱、Quick Access 按鈕寬度縮小約 40%")
