(function(){
  const VERSION = "6.4.3";
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
    try{
      const r=await fetchJson(RAW_BASE+"parking.json");
      state.parking=r.data;state.parkingHttp=`${r.status} OK`;state.parkingSource="GitHub raw";
    }catch(e){
      state.parkingHttp=e.message;
      try{
        const r=await fetchJson("data/parking.json");
        state.parking=r.data;state.parkingHttp=`${r.status} OK`;state.parkingSource="GitHub Pages";
      }catch(e2){
        const cached=cachedParking()?.crew;
        state.parking=cached||null;
        state.parkingSource=cached?"Browser cache":"Unavailable";
      }
    }
  }

  async function loadAirportParking(){
    try{
      const r=await fetchJson(RAW_BASE+"airport-parking.json");
      state.airportParking=r.data;state.airportParkingHttp=`${r.status} OK`;
      state.airportParkingSource=r.data.sourceType||"GitHub raw";
    }catch(e){
      state.airportParkingHttp=e.message;
      try{
        const r=await fetchJson("data/airport-parking.json");
        state.airportParking=r.data;state.airportParkingHttp=`${r.status} OK`;
        state.airportParkingSource=r.data.sourceType||"GitHub Pages";
      }catch(e2){
        const cached=cachedParking()?.airport;
        state.airportParking=cached||null;
        state.airportParkingSource=cached?"Browser cache":"Unavailable";
      }
    }
  }

  async function loadArinc(){
    try{
      const r=await fetchJson(RAW_BASE+"arinc.json");
      state.arinc=r.data;state.arincHttp=`${r.status} OK`;state.arincRoute=r.data.route||"Unknown";
    }catch(e){
      state.arincHttp=e.message;
      try{
        const r=await fetchJson("data/arinc.json");
        state.arinc=r.data;state.arincHttp=`${r.status} OK`;state.arincRoute=(r.data.route||"Unknown")+" (fallback)";
      }catch(e2){state.arinc=null;state.arincRoute="Unavailable"}
    }
  }

  async function loadVersion(){
    try{
      const r=await fetchJson("data/version.json");
      if($("diagVersion"))$("diagVersion").textContent=`v${r.data.version||VERSION} · ${r.data.build||"--"}`;
    }catch(_e){
      if($("diagVersion"))$("diagVersion").textContent=`v${VERSION}`;
    }
  }

  function levelFromAge(data,time,maxFresh,maxDelayed){
    if(!data||!time)return"offline";
    const age=Date.now()-time.getTime();
    return age<=maxFresh?"normal":age<=maxDelayed?"delayed":"offline";
  }

  function render(){
    const now=Date.now();
    const crewTime=newestParkingTime(state.parking);
    const airportTime=newestParkingTime(state.airportParking);
    const crewLevel=levelFromAge(state.parking,crewTime,10*60000,45*60000);
    const airportLevel=validAirport(state.airportParking)?levelFromAge(state.airportParking,airportTime,10*60000,45*60000):"offline";

    let parkingLevel="offline",parkingText="Offline";
    if(crewLevel==="normal"&&airportLevel==="normal"){parkingLevel="normal";parkingText="Operational"}
    else if(crewLevel!=="offline"||airportLevel!=="offline"){parkingLevel="delayed";parkingText="Partial Sync"}
    setState("systemParkingState",parkingText,parkingLevel);

    const parkingTimes=[crewTime,airportTime].filter(Boolean);
    const newest=parkingTimes.length?new Date(Math.max(...parkingTimes.map(d=>d.getTime()))):null;
    $("systemParkingLast").textContent=newest?clock(newest):"--";
    $("systemParkingAge").textContent=newest?ageText(now-newest.getTime()):"--";
    $("systemParkingNext").textContent=clock(nextSlot(PARKING_INTERVAL));

    $("systemGithubParking").textContent=state.parkingHttp;
    if($("systemGithubAirportParking"))$("systemGithubAirportParking").textContent=state.airportParkingHttp;

    const af=parseUtc(state.arinc?.fetchedAtUtc),aa=af?now-af.getTime():Infinity;
    const arincLevel=state.arinc?(aa<=45*60000?"normal":aa<=3*3600000?"delayed":"offline"):"offline";
    setState("systemArincState",arincLevel==="normal"?"Operational":arincLevel==="delayed"?"Delayed":"Offline",arincLevel);
    const vf=parseUtc(state.arinc?.validFromUtc);
    $("systemArincValid").textContent=vf?clock(vf,true):"--";
    $("systemArincLast").textContent=af?clock(af,true):"--";
    $("systemArincNext").textContent=clock(nextSlot(ARINC_INTERVAL),true);
    $("systemGithubArinc").textContent=state.arincHttp;
    $("systemCheckedAt").textContent=clock(new Date());

    $("diagParkingSource").textContent=`Crew: ${state.parkingSource}｜Airport: ${state.airportParkingSource}`;
    $("diagParkingHttp").textContent=state.parkingHttp;
    if($("diagAirportParkingHttp"))$("diagAirportParkingHttp").textContent=state.airportParkingHttp;
    $("diagArincRoute").textContent=state.arincRoute;
    $("diagArincHttp").textContent=state.arincHttp;

    const available=[parkingLevel,arincLevel];
    let overall="normal",overallText="Operational";
    if(available.every(x=>x==="offline")){overall="offline";overallText="Offline"}
    else if(available.some(x=>x!=="normal")){overall="delayed";overallText="Partial Sync"}
    const dot=$("systemOverallDot");dot.className="system-dot "+overall;
    $("systemOverallText").textContent=overallText;
  }

  async function refresh(){
    await Promise.allSettled([loadParking(),loadAirportParking(),loadArinc(),loadVersion()]);
    render();
  }
  refresh();
  setInterval(refresh,60000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
  window.addEventListener("focus",refresh);
})();