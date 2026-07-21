(function(){
  const VERSION = "7.1.0";
  const BUILD = "20260721-007";
  const RAW_BASE="https://raw.githubusercontent.com/B744F/crewportal/main/data/";
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
      @media(max-width:760px){.aircraft-track-form{grid-template-columns:1fr 96px}.aircraft-track-button{font-size:12px}}
    `;
    document.head.appendChild(style);
    const wrap=document.createElement("div");
    wrap.innerHTML=`<div class="aircraft-track-divider"></div><div class="aircraft-track-title"><span>⌖</span><span>AIRCRAFT TRACKING</span></div><form class="aircraft-track-form" id="aircraftTrackForm"><input id="aircraftTrackInput" aria-label="Call Sign or aircraft registration number" autocomplete="off" maxlength="12" placeholder="CALL SIGN / REG No." type="text"><button class="aircraft-track-button" type="submit">TRACK ›</button></form><div id="aircraftTrackStatus"></div>`;
    atisPanel.appendChild(wrap);
    const trackForm=$("aircraftTrackForm"),trackInput=$("aircraftTrackInput"),trackStatus=$("aircraftTrackStatus");
    trackInput.addEventListener("input",()=>{trackInput.value=trackInput.value.toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,12);trackStatus.style.display="none"});
    trackForm.addEventListener("submit",e=>{
      e.preventDefault();const value=trackInput.value.trim().toUpperCase();
      if(!/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(value)){trackStatus.textContent="請輸入 Call Sign 或 REG No.";trackStatus.style.display="block";trackInput.focus();return}
      const path=value.includes("-")?"aircraft":"flights";
      window.open(`https://www.flightradar24.com/data/${path}/${encodeURIComponent(value.toLowerCase())}`,"_blank","noopener,noreferrer");
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