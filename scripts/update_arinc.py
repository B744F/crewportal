#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,urlopen
from bs4 import BeautifulSoup

WORKER_URL="https://arinc-proxy.201505-login.workers.dev/"
SOURCE_URL="https://radio.arinc.net/pacific/"
OUTPUT=Path(__file__).resolve().parents[1]/"data"/"arinc.json"

def norm(s):
    return re.sub(r"\s+"," ",s.replace("\xa0"," ").replace("→"," to ").replace("->"," to ")).strip().lower()

def freq(s):
    m=re.search(r"\b(\d{4,5})\b",s)
    if not m:return None
    n=int(m.group(1))
    return n if 2000<=n<=22000 else None

def region(s):
    s=norm(s)
    if "north" in s and "america" in s and "asia" in s:return "northAmericaAsia"
    if "alaska" in s and "pacific" in s:return "alaskaNorthPacific"
    if "guam" in s:return "guamArea"
    return None

def fetch_html():
    req=Request(WORKER_URL,headers={"User-Agent":"CrewPortal-PacificHF/2.2","Accept":"text/html","Cache-Control":"no-cache"})
    with urlopen(req,timeout=45) as r:
        html=r.read().decode("utf-8",errors="replace")
    if "403 Forbidden" in html:raise RuntimeError("Worker returned ARINC 403 page")
    if "ARINC request failed" in html:raise RuntimeError(f"Worker error: {html[:300]}")
    return html

def valid_time(html):
    text=re.sub(r"\s+"," ",BeautifulSoup(html,"html.parser").get_text(" ",strip=True))
    for pat in (
        r"Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)",
        r"Effective\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)"
    ):
        m=re.search(pat,text,re.I)
        if m:
            raw=re.sub(r"\s+"," ",m.group(1)).strip()
            try:
                dt=datetime.strptime(raw,"%B %d, %Y, %H%MZ").replace(tzinfo=timezone.utc)
                return raw,dt.isoformat(timespec="seconds").replace("+00:00","Z")
            except ValueError:
                return raw,None
    return None,None

def assignments(html):
    soup=BeautifulSoup(html,"html.parser")
    out={}
    candidates=[]
    for row in soup.select("tr"):
        cells=[re.sub(r"\s+"," ",c.get_text(" ",strip=True)).strip() for c in row.select("th,td")]
        if not cells:continue
        key=region(" | ".join(cells))
        if not key:continue
        candidates.append(cells)
        nums=[n for c in cells if (n:=freq(c)) is not None]
        if len(nums)<2:continue
        out[key]={"primary":nums[0],"secondary":nums[1]}
    missing=sorted({"northAmericaAsia","alaskaNorthPacific","guamArea"}-out.keys())
    if missing:raise RuntimeError("Missing region(s): "+", ".join(missing)+"; rows: "+repr(candidates[:30]))
    return out

def main():
    html=fetch_html()
    data_rows=assignments(html)
    raw,utc=valid_time(html)
    data={
        "schemaVersion":10,
        "source":SOURCE_URL,
        "proxy":WORKER_URL,
        "validFrom":raw,
        "validFromUtc":utc,
        "fetchedAtUtc":datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
        "northAmericaAsia":data_rows["northAmericaAsia"],
        "alaskaNorthPacific":data_rows["alaskaNorthPacific"],
        "guamArea":data_rows["guamArea"]
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Updated data/arinc.json")
    print(json.dumps(data,ensure_ascii=False,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as e:
        print(f"ARINC update failed: {e}",file=sys.stderr)
        raise
