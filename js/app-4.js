(function(){
  const VERSION = "8.0.0";
  const BUILD = "20260722-001";
  const RAW_BASE="https://raw.githubusercontent.com/B744F/crewportal/main/data/";
  const FLIGHT_GATE_API="https://flightdeck-api.201505-login.workers.dev/api/flight-gate";
  const PARKING_INTERVAL=5*60*1000;
  const ARINC_INTERVAL=15*60*1000;
  const PARKING_CACHE_KEY="crewportal-combined-parking-last-good";
  const $=id=>document.getElementById(id);
  const state={parking:null,airportParking:null,arinc:null,parkingHttp:"--",airportParkingHttp:"--",arincHttp:"--",parkingSource:"--",airportParkingSource:"--",arincRoute:"--"};

  function parseTaipei(value){
    if(!value)return null;
    let text=String(value).trim().replace(" ","T");
    if(!/[zZ]|[+-]\d\d:\d\d$/.test(text))text+="+08:00";
    const d=new Date(text);
    return Number.isNaN(d.getTime())?null:d;
  }
  function parseUtc(value){
    if(!value)return null;
    let text=String(value).trim().replace(" ","T");
    if(!/[zZ]|[+-]\d\d:\d\d$/.test(text))text+="Z";
    const d=new Date(text);
    return Number.isNaN(d.getTime())?null:d;
  }
  function ageText(ms){if(!Number.isFinite(ms)||ms<0)return"--";const m=Math.floor(ms/60000);if(m<1)return"< 1 min";if(m<60)return`${m} min`;const h=Math.floor(m/60),r=m%60;return`${h}h ${r}m`}
  function clock(d,utc=false){if(!d)return"--";return new Intl.DateTimeFormat("zh-TW",{timeZone:utc?"UTC":"Asia/Taipei",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d)+(utc?" UTC":"")}
  function nextSlot(interval){const now=Date.now();return new Date(Math.ceil(now/interval)*interval)}
  function setState(id,text,level){const el=$(id);if(!el)return;el.textContent=text;el.className=level||""}
  function newestParkingTime(data){if(!Array.isArray(data))return parseTaipei(data?.updatedAt||data?.updateTime||data?.lastUpdate);const values=data.map(x=>parseTaipei(x.updateTime)).filter(Boolean);return values.length?new Date(Math.max(...values.map(x=>x.getTime()))):null}
  function validAirport(data){return !!data&&[data.P1,data.P2,data.P4].every(v=>Number.isFinite(Number(v)))}
  function cachedParking(){try{return JSON.parse(localStorage.getItem(PARKING_CACHE_KEY)||"null")}catch(_e){return null}}
  async function fetchJson(url){const r=await fetch(url+(url.includes("?")?"&":"?")+"status="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error(`HTTP ${r.status}`);return {data:await r.json(),status:r.status}}

  async function loadParking(){
    try{const r=await fetchJson(RAW_BASE+"parking.json");state.parking=r.data;state.parkingHttp=`${r.status} OK`;state.parkingSource="GitHub raw"}
    catch(e){state.parkingHttp=e.message;try{const r=await fetchJson("data/parking.json");state.parking=r.data;state.parkingHttp=`${r.status} OK`;state.parkingSource="GitHub Pages"}catch(e2){const cached=cachedParking()?.crew;state.parking=cached||null;state.parkingSource=cached?"Browser cache":"Unavailable"}}
  }
  async function loadAirportParking(){
    try{const r=await fetchJson(RAW_BASE+"airport-parking.json");state.airportParking=r.data;state.airportParkingHttp=`${r.status} OK`;state.airportParkingSource=r.data.sourceType||"GitHub raw"}
    catch(e){state.airportParkingHttp=e.message;try{const r=await fetchJson("data/airport-parking.json");state.airportParking=r.data;state.airportParkingHttp=`${r.status} OK`;state.airportParkingSource=r.data.sourceType||"GitHub Pages"}catch(e2){const cached=cachedParking()?.airport;state.airportParking=cached||null;state.airportParkingSource=cached?"Browser cache":"Unavailable"}}
  }
  async function loadArinc(){
    try{const r=await fetchJson(RAW_BASE+"arinc.json");state.arinc=r.data;state.arincHttp=`${r.status} OK`;state.arincRoute=r.data.route||"Unknown"}
    catch(e){state.arincHttp=e.message;try{const r=await fetchJson("data/arinc.json");state.arinc=r.data;state.arincHttp=`${r.status} OK`;state.arincRoute=(r.data.route||"Unknown")+" (fallback)"}catch(e2){state.arinc=null;state.arincRoute="Unavailable"}}
  }
  async function loadVersion(){
    try{
      const r=await fetchJson("data/version.json");
      const version=r.data.version||VERSION, build=r.data.build||BUILD;
      if($("diagVersion"))$("diagVersion").textContent=`v${version} · ${build}`;
      if($("footerVersion"))$("footerVersion").textContent=`Version v${version}`;
      if($("footerBuild"))$("footerBuild").textContent=`Build ${build}`;
    } catch(_e){
      if($("diagVersion"))$("diagVersion").textContent=`v${VERSION} · ${BUILD}`;
      if($("footerVersion"))$("footerVersion").textContent=`Version v${VERSION}`;
      if($("footerBuild"))$("footerBuild").textContent=`Build ${BUILD}`;
    }
  }
  function levelFromAge(data,time,maxFresh,maxDelayed){if(!data||!time)return"offline";const age=Date.now()-time.getTime();return age<=maxFresh?"normal":age<=maxDelayed?"delayed":"offline"}
  function render(){
    const now=Date.now(),crewTime=newestParkingTime(state.parking),airportTime=newestParkingTime(state.airportParking);
    const crewLevel=levelFromAge(state.parking,crewTime,10*60000,45*60000);
    const airportLevel=validAirport(state.airportParking)?levelFromAge(state.airportParking,airportTime,10*60000,45*60000):"offline";
    let parkingLevel="offline",parkingText="Offline";
    if(crewLevel==="normal"&&airportLevel==="normal"){parkingLevel="normal";parkingText="Operational"}
    else if(crewLevel!=="offline"||airportLevel!=="offline"){parkingLevel="delayed";parkingText="Partial Sync"}
    setState("systemParkingState",parkingText,parkingLevel);
    const parkingTimes=[crewTime,airportTime].filter(Boolean),newest=parkingTimes.length?new Date(Math.max(...parkingTimes.map(d=>d.getTime()))):null;
    if($("systemParkingLast"))$("systemParkingLast").textContent=newest?clock(newest):"--";
    if($("systemParkingAge"))$("systemParkingAge").textContent=newest?ageText(now-newest.getTime()):"--";
    if($("systemParkingNext"))$("systemParkingNext").textContent=clock(nextSlot(PARKING_INTERVAL));
    if($("systemGithubParking"))$("systemGithubParking").textContent=state.parkingHttp;
    if($("systemGithubAirportParking"))$("systemGithubAirportParking").textContent=state.airportParkingHttp;
    const af=parseUtc(state.arinc?.fetchedAtUtc),aa=af?now-af.getTime():Infinity;
    const arincLevel=state.arinc?(aa<=45*60000?"normal":aa<=3*3600000?"delayed":"offline"):"offline";
    setState("systemArincState",arincLevel==="normal"?"Operational":arincLevel==="delayed"?"Delayed":"Offline",arincLevel);
    const vf=parseUtc(state.arinc?.validFromUtc);
    if($("systemArincValid"))$("systemArincValid").textContent=vf?clock(vf,true):"--";
    if($("systemArincLast"))$("systemArincLast").textContent=af?clock(af,true):"--";
    if($("systemArincNext"))$("systemArincNext").textContent=clock(nextSlot(ARINC_INTERVAL),true);
    if($("systemGithubArinc"))$("systemGithubArinc").textContent=state.arincHttp;
    if($("systemCheckedAt"))$("systemCheckedAt").textContent=clock(new Date());
    if($("diagParkingSource"))$("diagParkingSource").textContent=`Crew: ${state.parkingSource}｜Airport: ${state.airportParkingSource}`;
    if($("diagParkingHttp"))$("diagParkingHttp").textContent=state.parkingHttp;
    if($("diagAirportParkingHttp"))$("diagAirportParkingHttp").textContent=state.airportParkingHttp;
    if($("diagArincRoute"))$("diagArincRoute").textContent=state.arincRoute;
    if($("diagArincHttp"))$("diagArincHttp").textContent=state.arincHttp;
    const available=[parkingLevel,arincLevel];let overall="normal",overallText="Operational";
    if(available.every(x=>x==="offline")){overall="offline";overallText="Offline"}
    else if(available.some(x=>x!=="normal")){overall="delayed";overallText="Partial Sync"}
    const dot=$("systemOverallDot");if(dot)dot.className="system-dot "+overall;
    if($("systemOverallText"))$("systemOverallText").textContent=overallText;
  }

  function applyPortalLabels(){
    const kicker=document.querySelector(".hero-copy .kicker");
    if(kicker)kicker.remove();

    const parkingPanel=document.querySelector(".parking-panel");
    if(parkingPanel)parkingPanel.setAttribute("aria-label","Parking Information");

    const parkingTitle=document.querySelector(".parking-title span:last-child");
    if(parkingTitle)parkingTitle.textContent="PARKING INFORMATION";
  }

  function installAircraftTracking(){
    const atisPanel=document.querySelector(".atis-panel");
    if(!atisPanel||$("aircraftTrackForm"))return;
    const style=document.createElement("style");
    style.textContent=`
      .glass-panel{background:linear-gradient(180deg,rgba(8,25,44,.78),rgba(4,13,24,.72))!important;backdrop-filter:blur(16px)!important;-webkit-backdrop-filter:blur(16px)!important;box-shadow:0 18px 42px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.10)!important}
      .atis-panel{display:flex;flex-direction:column}.aircraft-track-divider{height:1px;background:rgba(255,255,255,.12);margin:10px 0 8px}
      .aircraft-track-title{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:14px;font-weight:900;letter-spacing:.04em;color:#eef7ff}
      .aircraft-track-title span:first-child{color:var(--gold2);font-size:17px}
      .aircraft-track-form{display:grid;grid-template-columns:1fr 108px;align-items:center;border:1px solid rgba(255,255,255,.22);background:rgba(0,5,12,.30);border-radius:10px;overflow:hidden;height:39px}
      #aircraftTrackInput{height:100%;min-width:0;border:0;outline:0;background:transparent;color:#fff;font-size:15px;font-weight:750;padding:0 16px;text-transform:uppercase;letter-spacing:.06em}
      #aircraftTrackInput::placeholder{color:rgba(238,247,255,.48);font-weight:700;letter-spacing:.03em;text-transform:none}
      .aircraft-track-button{height:100%;border:1px solid rgba(216,178,93,.76);border-right:0;border-top:0;border-bottom:0;background:linear-gradient(180deg,rgba(216,178,93,.88),rgba(147,108,43,.82));color:#07111d;font-size:13px;font-weight:1000;letter-spacing:.06em;cursor:pointer}
      .aircraft-track-button:hover{filter:brightness(1.12)}#aircraftTrackStatus{display:none;margin-top:7px;font-size:12px;color:#ffc8c8}
      .aircraft-gate-divider{height:1px;background:rgba(255,255,255,.12);margin:10px 0 8px}
      .aircraft-gate-title{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:14px;font-weight:900;letter-spacing:.04em;color:#eef7ff}
      .aircraft-gate-title span:first-child{color:#86d4ff;font-size:16px}
      .aircraft-gate-form{display:grid;grid-template-columns:1fr 108px;align-items:center;border:1px solid rgba(105,189,255,.35);background:rgba(0,5,12,.30);border-radius:10px;overflow:hidden;height:39px}
      #aircraftGateInput{height:100%;min-width:0;border:0;outline:0;background:transparent;color:#fff;font-size:15px;font-weight:750;padding:0 16px;text-transform:uppercase;letter-spacing:.06em}
      #aircraftGateInput::placeholder{color:rgba(238,247,255,.48);font-weight:700;letter-spacing:.03em;text-transform:none}
      .aircraft-gate-button{height:100%;border:1px solid rgba(105,189,255,.50);border-right:0;border-top:0;border-bottom:0;background:linear-gradient(180deg,rgba(52,137,190,.88),rgba(22,75,116,.88));color:#eff9ff;font-size:13px;font-weight:1000;letter-spacing:.06em;cursor:pointer}
      .aircraft-gate-button:hover{filter:brightness(1.12)}#aircraftGateStatus{display:none;margin-top:7px;font-size:12px;color:#b9d8ed}
      .aircraft-gate-result{display:none;margin-top:8px;border:1px solid rgba(105,189,255,.25);border-radius:9px;overflow:hidden;background:rgba(0,8,16,.24)}
      .aircraft-gate-result-head{display:flex;justify-content:space-between;gap:8px;padding:6px 9px;border-bottom:1px solid rgba(255,255,255,.10);color:#9fb7ca;font-size:10px}
      .aircraft-gate-result-head strong{color:#dcefff;font-size:11px}.aircraft-gate-result-head small{white-space:nowrap}.aircraft-gate-route-inline{display:inline-block;margin-left:14px;padding:2px 7px;border-radius:3px;background:#fff;color:#08111b;font-size:12px;font-weight:1000;letter-spacing:.09em;white-space:nowrap;box-shadow:0 1px 0 rgba(0,0,0,.35)}
      .aircraft-gate-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:7px 9px;border-top:1px solid rgba(255,255,255,.08)}
      .aircraft-gate-row:first-child{border-top:0}.aircraft-gate-row div{min-width:0}.aircraft-gate-row b{display:block;color:#eef7ff;font-size:11px}.aircraft-gate-value{display:flex;align-items:center;justify-content:flex-end;gap:2em;min-width:0}.aircraft-gate-terminal{display:inline-flex;align-items:center;justify-content:center;min-width:54px;padding:5px 7px;border:1px solid rgba(255,255,255,.35);border-radius:4px;box-shadow:0 1px 0 rgba(0,0,0,.35),inset 0 -2px 0 rgba(0,0,0,.18);color:#08111b;font-size:18px;line-height:1;font-weight:1000;letter-spacing:.03em}.aircraft-gate-terminal.t1{background:#35c86a;color:#08111b}.aircraft-gate-terminal.t2{background:#42a5ff;color:#08111b}.aircraft-gate-terminal.t3{background:#f05a5a;color:#08111b}.aircraft-gate-terminal.other{background:#cbd5df;color:#08111b}
      .aircraft-gate-row span{display:block;margin-top:2px;color:#9fb0c5;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aircraft-gate-row .aircraft-gate-terminal{font-size:18px;margin-top:0}.aircraft-gate-status-flown{color:#ff4f5e;font-style:normal;font-weight:1000}
      .aircraft-gate-row strong{min-width:54px;padding:5px 7px;text-align:center;background:#ffd21f;border:1px solid #ffea70;border-radius:4px;box-shadow:0 1px 0 rgba(0,0,0,.35),inset 0 -2px 0 rgba(104,72,0,.28);color:#08111b;font-size:18px;line-height:1;letter-spacing:.03em}.aircraft-gate-row strong.is-empty{color:#08111b;font-size:11px}
      @media(max-width:760px){.aircraft-track-form{grid-template-columns:1fr 96px}.aircraft-track-button{font-size:12px}}
      @media(max-width:760px){.aircraft-gate-form{grid-template-columns:1fr 96px}.aircraft-gate-button{font-size:12px}}
    `;
    document.head.appendChild(style);
    const wrap=document.createElement("div");
    wrap.innerHTML=`<div class="aircraft-track-divider"></div><div class="aircraft-track-title"><span>⌖</span><span>AIRCRAFT TRACKING</span></div><form class="aircraft-track-form" id="aircraftTrackForm"><input id="aircraftTrackInput" aria-label="Call Sign or aircraft registration number" autocomplete="off" maxlength="12" placeholder="CALL SIGN / REG No." type="text"><button class="aircraft-track-button" type="submit">TRACK ›</button></form><div id="aircraftTrackStatus"></div><div class="aircraft-gate-divider"></div><div class="aircraft-gate-title"><span>▣</span><span>RCTP GATE LOOKUP</span></div><form class="aircraft-gate-form" id="aircraftGateForm"><input id="aircraftGateInput" aria-label="Flight number for Taoyuan Airport gate lookup" autocomplete="off" maxlength="12" placeholder="e.g. CI100" type="text"><button class="aircraft-gate-button" type="submit">GATE ›</button></form><div id="aircraftGateStatus"></div><div id="aircraftGateResult" class="aircraft-gate-result"></div>`;
    atisPanel.appendChild(wrap);
    const trackForm=$("aircraftTrackForm"),trackInput=$("aircraftTrackInput"),trackStatus=$("aircraftTrackStatus");
    const gateForm=$("aircraftGateForm"),gateInput=$("aircraftGateInput"),gateStatus=$("aircraftGateStatus"),gateResult=$("aircraftGateResult");
    trackInput.addEventListener("input",()=>{trackInput.value=trackInput.value.toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,12);trackStatus.style.display="none"});
    trackForm.addEventListener("submit",e=>{
      e.preventDefault();const value=trackInput.value.trim().toUpperCase();
      if(!/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(value)){trackStatus.textContent="請輸入 Call Sign 或 REG No.";trackStatus.style.display="block";trackInput.focus();return}
      const path=value.includes("-")?"aircraft":"flights";
      window.open(`https://www.flightradar24.com/data/${path}/${encodeURIComponent(value.toLowerCase())}`,"_blank","noopener,noreferrer");
    });
    const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
    const todayTaipei=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const terminalClass=value=>({T1:"t1",T2:"t2",T3:"t3"}[String(value||"").trim().toUpperCase()]||"other");
    const normalizeFlightNumber=value=>{const compact=String(value||"").trim().toUpperCase().replace(/[\s-]/g,"");const match=compact.match(/^([A-Z]{2,3})?(\d{1,4}[A-Z]?)$/);if(!match)return"";const rawNumber=match[2],suffix=/[A-Z]$/.test(rawNumber)?rawNumber.slice(-1):"",digits=rawNumber.slice(0,rawNumber.length-suffix.length).replace(/^0+(?=\d)/,"");return`${match[1]||"CI"}${digits}${suffix}`};
    gateInput.addEventListener("input",()=>{gateInput.value=gateInput.value.toUpperCase().replace(/[^A-Z0-9 -]/g,"").slice(0,12);gateStatus.style.display="none"});
    gateForm.addEventListener("submit",async e=>{
      e.preventDefault();
      const value=normalizeFlightNumber(gateInput.value);
      if(!/^(?:[A-Z]{2,3}\s*-?\s*)?\d{1,4}[A-Z]?$/.test(value)){
        gateStatus.textContent="請輸入航班號碼，例如 CI100 或 100";gateStatus.style.display="block";gateResult.style.display="none";gateInput.focus();return;
      }
      gateStatus.textContent="正在查詢桃園機場官方航班資料…";gateStatus.style.display="block";gateResult.style.display="none";
      try{
        const response=await fetch(`${FLIGHT_GATE_API}?flight=${encodeURIComponent(value)}&v=${Date.now()}`,{cache:"no-store"});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||"查詢失敗");
        const matches=(data.matches||[]).filter(match=>match.date===todayTaipei());
        if(!matches.length){gateStatus.textContent="找不到今日的官方航班資料。";return}
        gateStatus.textContent=`已找到 ${matches.length} 筆今日官方航班資料`;
        const routes=[...new Set(matches.map(match=>match.route).filter(Boolean))].join(" · ")||"--/--";
        gateResult.innerHTML=`<div class="aircraft-gate-result-head"><strong>${escapeHtml(data.query)} 登機門<span class="aircraft-gate-route-inline">${escapeHtml(routes)}</span></strong><small>資料 ${escapeHtml(data.fetchedAt?.slice(11,16)||"--:--")} 更新</small></div>${matches.map(match=>{const gate=match.gate||"尚未公布",status=String(match.status||""),statusMarkup=status?` · <em class="${status.includes("已飛")?"aircraft-gate-status-flown":""}">${escapeHtml(status)}</em>`:"";return `<div class="aircraft-gate-row"><div><b>${escapeHtml(match.direction)}</b><span>${escapeHtml(match.date)} ${escapeHtml(match.time)}${statusMarkup}</span></div><div class="aircraft-gate-value"><span class="aircraft-gate-terminal ${terminalClass(match.terminal)}">${escapeHtml(match.terminal||"-")}</span><strong class="${match.gate?"":"is-empty"}">${escapeHtml(gate)}</strong></div></div>`}).join("")}`;
        gateResult.style.display="block";
      }catch(error){gateStatus.textContent=`查詢失敗：${error.message||"請稍後再試"}`;gateResult.style.display="none"}
    });
  }
  function updateVisibleVersion(){
    if($("footerVersion"))$("footerVersion").textContent=`Version v${VERSION}`;
    if($("footerBuild"))$("footerBuild").textContent=`Build ${BUILD}`;
    if($("diagVersion"))$("diagVersion").textContent=`v${VERSION} · ${BUILD}`;
  }
  async function refresh(){await Promise.allSettled([loadParking(),loadAirportParking(),loadArinc(),loadVersion()]);render();updateVisibleVersion()}
  applyPortalLabels();installAircraftTracking();updateVisibleVersion();refresh();setInterval(refresh,60000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});window.addEventListener("focus",refresh);
})();
