(function(){
  "use strict";
  const DATA_URL="data/mrt-stations.json";
  const API_URL="https://flightdeck-api.201505-login.workers.dev/api/mrt";
  const STORAGE_KEY="crewportal-mrt-station";
  const TAIPEI_TZ="Asia/Taipei";
  const $=id=>document.getElementById(id);
  const els={select:$("mrtStationSelect"),updated:$("mrtUpdatedTime"),status:$("mrtStatus"),link:$("mrtOfficialLink"),tc:$("mrtTaipeiCommuter"),te:$("mrtTaipeiExpress"),zc:$("mrtZhongliCommuter"),ze:$("mrtZhongliExpress")};
  if(!els.select)return;

  let stations=[];
  let requestController=null;

  function taipeiParts(date=new Date()){
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TAIPEI_TZ,hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date);
    const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return {year:+v.year,month:+v.month,day:+v.day,hour:+v.hour,minute:+v.minute,second:+v.second};
  }
  const pad=n=>String(n).padStart(2,"0");
  function nowMinutes(){const p=taipeiParts();return p.hour*60+p.minute+(p.second/60)}
  function formatMinutes(total){total=((Math.round(total)%1440)+1440)%1440;return `${pad(Math.floor(total/60))}:${pad(total%60)}`}
  function nextPattern(now,start,end,minutes,offset){
    const candidates=[];
    for(let h=Math.floor(start/60);h<=Math.floor(end/60);h++)for(const m of minutes){const t=h*60+m+offset;if(t>=start+offset&&t<=end+offset&&t>=now)candidates.push(t)}
    return candidates.length?Math.min(...candidates):null;
  }
  function setCell(el,value,kind="",subtext=""){
    el.className=`mrt-time ${kind}`.trim();
    el.removeAttribute("title");
    if(value===null||value===undefined){
      el.innerHTML='<span class="mrt-primary">--</span><small class="mrt-secondary">暫無資料</small>';
      el.classList.add("mrt-muted");
      return;
    }
    const primary=String(value);
    el.innerHTML=`<span class="mrt-primary">${primary}</span>${subtext?`<small class="mrt-secondary">${subtext}</small>`:""}`;
    if(!/^\d\d:\d\d$/.test(primary)&&primary!=="Arriving")el.classList.add("mrt-muted");
  }
  function formatLiveTrain(train){
    if(!train)return {value:"--",subtext:"暫無下一班"};
    const seconds=Number(train.seconds);
    const value=/^\d{2}:\d{2}$/.test(String(train.time||""))?train.time:"--";
    if(Number.isFinite(seconds)){
      if(seconds<=45)return {value,subtext:"即將到站"};
      if(seconds<3600)return {value,subtext:`約 ${Math.max(1,Math.ceil(seconds/60))} 分鐘`};
    }
    return {value,subtext:train.destination||"下一班時刻"};
  }
  function currentStation(){return stations.find(s=>s.code===els.select.value)||stations.find(s=>s.code==="A13")}
  function setUpdated(iso){
    const date=iso?new Date(iso):new Date();
    if(Number.isNaN(date.getTime()))return;
    const p=taipeiParts(date);els.updated.textContent=`${pad(p.hour)}:${pad(p.minute)}`;
  }
  function renderScheduled(station,reason=""){
    const now=nowMinutes();
    setUpdated();
    if(station.comingSoon){
      setCell(els.tc,"Coming Soon");setCell(els.te,"尚未啟用");setCell(els.zc,"Coming Soon");setCell(els.ze,"尚未啟用");
      els.status.textContent="A14 Airport Terminal 3 is not yet in service.";
      return;
    }
    const northOffset=station.minutesFromA13;
    const southOffset=station.minutesFromA13;
    const tc=nextPattern(now,364,1429,[4,19,34,49],northOffset);
    const zc=nextPattern(now,369,1434,[9,24,39,54],southOffset);
    const te=station.express?nextPattern(now,355,1375,[10,25,40,55],northOffset):"No Service";
    const ze=station.express&&["A12","A13","A18","A21"].includes(station.code)?nextPattern(now,370,1210,[10,25,40,55],southOffset):"No Service";
    setCell(els.tc,tc===null?null:formatMinutes(tc),"commuter");
    setCell(els.zc,zc===null?null:formatMinutes(zc),"commuter");
    setCell(els.te,typeof te==="number"?formatMinutes(te):te,"express");
    setCell(els.ze,typeof ze==="number"?formatMinutes(ze):ze,"express");
    els.status.textContent=reason?`Scheduled backup · ${reason}`:"Scheduled backup · 班表備援";
    els.status.className="mrt-status mrt-status-scheduled";
  }
  function renderLive(data){
    const rows=data.trains||{};
    const station=currentStation();
    const values={
      tc:formatLiveTrain(rows.taipei?.commuter),
      te:formatLiveTrain(rows.taipei?.express),
      zc:formatLiveTrain(rows.zhongli?.commuter),
      ze:formatLiveTrain(rows.zhongli?.express)
    };
    setCell(els.tc,values.tc.value,"commuter",values.tc.subtext);
    setCell(els.zc,values.zc.value,"commuter",values.zc.subtext);
    if(station&&!station.express){
      setCell(els.te,"--","express","No express service");
      setCell(els.ze,"--","express","No express service");
    }else{
      setCell(els.te,values.te.value,"express",values.te.subtext);
      setCell(els.ze,values.ze.value,"express",values.ze.subtext);
    }
    setUpdated(data.updateTime||data.fetchedAt);
    els.status.textContent="TDX Next Train · 官方下一班時刻";
    els.status.className="mrt-status mrt-status-live";
  }
  async function refresh(){
    const station=currentStation();
    if(!station)return;
    els.link.href=`https://www.tymetro.com.tw/tymetro-new/en/_pages/travel-guide/timetable-${station.code}`;
    if(station.comingSoon){renderScheduled(station);return}
    if(requestController)requestController.abort();
    requestController=new AbortController();
    try{
      const response=await fetch(`${API_URL}?station=${encodeURIComponent(station.code)}&t=${Math.floor(Date.now()/30000)}`,{cache:"no-store",signal:requestController.signal});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(data.mode!=="live"||!data.trains)throw new Error(data.error||"Live data unavailable");
      renderLive(data);
    }catch(err){
      if(err.name==="AbortError")return;
      console.warn("TDX MRT live data unavailable; using scheduled backup",err);
      renderScheduled(station,"Live unavailable");
    }
  }
  function populate(data){
    stations=data.stations||[];
    els.select.innerHTML=stations.map(s=>`<option value="${s.code}">${s.code} ${s.zh} · ${s.en}</option>`).join("");
    let saved="A13";try{saved=localStorage.getItem(STORAGE_KEY)||data.defaultStation||"A13"}catch(_e){}
    if(stations.some(s=>s.code===saved))els.select.value=saved;
    els.select.addEventListener("change",()=>{try{localStorage.setItem(STORAGE_KEY,els.select.value)}catch(_e){}refresh()});
    refresh();
    const delay=60000-(Date.now()%60000)+250;
    setTimeout(()=>{refresh();setInterval(refresh,60000)},delay);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
    window.addEventListener("focus",refresh);
  }
  fetch(`${DATA_URL}?v=7.0.0`,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(populate).catch(err=>{console.error("Airport MRT station data load failed",err);els.status.textContent="Station data unavailable · 車站資料無法載入"});
})();
