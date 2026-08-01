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
  let refreshPromise=null;
  let refreshSerial=0;
  const RETRY_DELAYS=[500,1200];

  function taipeiParts(date=new Date()){
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TAIPEI_TZ,hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date);
    const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return {year:+v.year,month:+v.month,day:+v.day,hour:+v.hour,minute:+v.minute,second:+v.second};
  }
  const pad=n=>String(n).padStart(2,"0");
  function setCell(el,value,kind=""){
    el.className=`mrt-time ${kind}`.trim();
    el.removeAttribute("title");
    const primary=/^\d{2}:\d{2}$/.test(String(value||""))?String(value):"—";
    el.textContent=primary;
    if(primary==="—")el.classList.add("mrt-muted");
  }
  function formatTimetableTrain(train){
    return train&&/^\d{2}:\d{2}$/.test(String(train.time||""))?train.time:null;
  }
  function currentStation(){return stations.find(s=>s.code===els.select.value)||stations.find(s=>s.code==="A13")}
  function setUpdated(iso){
    const date=iso?new Date(iso):new Date();
    if(Number.isNaN(date.getTime()))return;
    const p=taipeiParts(date);els.updated.textContent=`${pad(p.hour)}:${pad(p.minute)}`;
  }
  function renderTimetable(data){
    const rows=data.trains||{};
    const station=currentStation();
    const values={
      tc:formatTimetableTrain(rows.taipei?.commuter),
      te:formatTimetableTrain(rows.taipei?.express),
      zc:formatTimetableTrain(rows.zhongli?.commuter),
      ze:formatTimetableTrain(rows.zhongli?.express)
    };
    setCell(els.tc,values.tc,"commuter");
    setCell(els.zc,values.zc,"commuter");
    if(station&&!station.express){
      setCell(els.te,"—","express");
      setCell(els.ze,"—","express");
    }else{
      setCell(els.te,values.te,"express");
      setCell(els.ze,values.ze,"express");
    }
    setUpdated(data.updateTime||data.fetchedAt);
    els.status.textContent="Official timetable · 桃捷官方資料";
    els.status.className="mrt-status mrt-status-live";
  }
  function renderUnavailable(station){
    setUpdated();
    setCell(els.tc,null,"commuter");setCell(els.zc,null,"commuter");
    if(station&&!station.express){
      setCell(els.te,"—","express");
      setCell(els.ze,"—","express");
    }else{setCell(els.te,null,"express");setCell(els.ze,null,"express");}
    els.status.textContent="Official timetable unavailable · 請查詢桃捷官方資料";
    els.status.className="mrt-status mrt-status-unavailable";
  }
  function waitForRetry(delay,signal){
    return new Promise((resolve,reject)=>{
      const onAbort=()=>{clearTimeout(timer);const error=new Error("Aborted");error.name="AbortError";reject(error)};
      const timer=setTimeout(()=>{signal.removeEventListener("abort",onAbort);resolve()},delay);
      if(signal.aborted)onAbort();else signal.addEventListener("abort",onAbort,{once:true});
    });
  }
  async function fetchTimetable(station,signal){
    const url=`${API_URL}?station=${encodeURIComponent(station.code)}&t=${Math.floor(Date.now()/30000)}`;
    for(let attempt=0;;attempt++){
      try{
        const response=await fetch(url,{cache:"no-store",signal});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const data=await response.json();
        if(data.mode!=="timetable"||!data.trains)throw new Error(data.error||"Timetable unavailable");
        return data;
      }catch(err){
        if(err.name==="AbortError"||attempt>=RETRY_DELAYS.length)throw err;
        await waitForRetry(RETRY_DELAYS[attempt],signal);
      }
    }
  }
  function refresh(options={}){
    const station=currentStation();
    if(!station)return Promise.resolve();
    if(refreshPromise&&!options.restart)return refreshPromise;
    els.link.href=`https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-${station.code === "A14A" ? "A14a" : station.code}`;
    if(requestController)requestController.abort();
    const controller=new AbortController();
    requestController=controller;
    const serial=++refreshSerial;
    refreshPromise=(async()=>{
      try{
        if(station.comingSoon){renderUnavailable(station);return}
        const data=await fetchTimetable(station,controller.signal);
        if(serial!==refreshSerial||controller.signal.aborted)return;
        renderTimetable(data);
      }catch(err){
        if(err.name==="AbortError"||serial!==refreshSerial)return;
        console.warn("Airport MRT timetable unavailable",err);
        renderUnavailable(station);
      }finally{
        if(serial===refreshSerial){
          refreshPromise=null;
          if(requestController===controller)requestController=null;
        }
      }
    })();
    return refreshPromise;
  }
  function populate(data){
    stations=data.stations||[];
    els.select.innerHTML=stations.map(s=>`<option value="${s.code}">${s.code} ${s.zh} · ${s.en}</option>`).join("");
    let saved="A13";try{saved=localStorage.getItem(STORAGE_KEY)||data.defaultStation||"A13"}catch(_e){}
    if(stations.some(s=>s.code===saved))els.select.value=saved;
    els.select.addEventListener("change",()=>{try{localStorage.setItem(STORAGE_KEY,els.select.value)}catch(_e){}refresh({restart:true})});
    refresh();
    const delay=60000-(Date.now()%60000)+250;
    setTimeout(()=>{refresh();setInterval(refresh,60000)},delay);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
    window.addEventListener("focus",refresh);
  }
  fetch(`${DATA_URL}?v=8.0.0`,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(populate).catch(err=>{console.error("Airport MRT station data load failed",err);els.status.textContent="Station data unavailable · 車站資料無法載入"});
})();
