(function(){
  "use strict";
  const DATA_URL="data/mrt-stations.json";
  const STORAGE_KEY="crewportal-mrt-station";
  const TAIPEI_TZ="Asia/Taipei";
  const $=id=>document.getElementById(id);
  const els={select:$("mrtStationSelect"),updated:$("mrtUpdatedTime"),status:$("mrtStatus"),link:$("mrtOfficialLink"),tc:$("mrtTaipeiCommuter"),te:$("mrtTaipeiExpress"),zc:$("mrtZhongliCommuter"),ze:$("mrtZhongliExpress")};
  if(!els.select)return;
  let stations=[];
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
  function setCell(el,value,kind=""){
    el.className=`mrt-time ${kind}`.trim();
    if(value===null){el.textContent="Ended";el.classList.add("mrt-muted");return}
    if(typeof value==="string"&&!/^\d\d:\d\d$/.test(value)){el.textContent=value;el.classList.add("mrt-muted");return}
    el.textContent=value;
  }
  function render(){
    const station=stations.find(s=>s.code===els.select.value)||stations.find(s=>s.code==="A13");
    if(!station)return;
    const p=taipeiParts(),now=nowMinutes();
    els.updated.textContent=`${pad(p.hour)}:${pad(p.minute)}`;
    els.link.href=`https://www.tymetro.com.tw/tymetro-new/en/_pages/travel-guide/timetable-${station.code}`;
    if(station.comingSoon){setCell(els.tc,"Coming Soon");setCell(els.te,"尚未啟用");setCell(els.zc,"Coming Soon");setCell(els.ze,"尚未啟用");els.status.textContent="A14 Airport Terminal 3 is not yet in service.";return}
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
    els.status.textContent="Scheduled times · Actual service may vary.";
  }
  function populate(data){
    stations=data.stations||[];
    els.select.innerHTML=stations.map(s=>`<option value="${s.code}">${s.code} ${s.zh} · ${s.en}</option>`).join("");
    let saved="A13";try{saved=localStorage.getItem(STORAGE_KEY)||data.defaultStation||"A13"}catch(_e){}
    if(stations.some(s=>s.code===saved))els.select.value=saved;
    els.select.addEventListener("change",()=>{try{localStorage.setItem(STORAGE_KEY,els.select.value)}catch(_e){}render()});
    render();
    const delay=60000-(Date.now()%60000)+250;
    setTimeout(()=>{render();setInterval(render,60000)},delay);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)render()});
    window.addEventListener("focus",render);
  }
  fetch(`${DATA_URL}?v=6.6.0`,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(populate).catch(err=>{console.error("Airport MRT data load failed",err);els.status.textContent="Timetable data unavailable · 時刻資料無法載入"});
})();
