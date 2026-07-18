(function(){
  const RAW_BASE="https://raw.githubusercontent.com/B744F/crewportal/main/data/";
  const PARKING_INTERVAL=5*60*1000;
  const ARINC_INTERVAL=15*60*1000;
  const $=id=>document.getElementById(id);
  const state={parking:null,airportParking:null,arinc:null,parkingHttp:"--",airportParkingHttp:"--",arincHttp:"--",parkingSource:"--",airportParkingSource:"--",arincRoute:"--"};
  function parseTaipei(value){if(!value)return null;const d=new Date(String(value).replace(" ","T")+"+08:00");return isNaN(d)?null:d}
  function dateOf(value){const d=new Date(value||0);return isNaN(d)?null:d}
  function ageText(ms){if(!Number.isFinite(ms)||ms<0)return"--";const m=Math.floor(ms/60000);if(m<1)return"< 1 min";if(m<60)return`${m} min`;const h=Math.floor(m/60),r=m%60;return`${h}h ${r}m`}
  function clock(d,utc=false){if(!d)return"--";return new Intl.DateTimeFormat("zh-TW",{timeZone:utc?"UTC":"Asia/Taipei",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d)+(utc?" UTC":"")}
  function nextSlot(interval){const now=Date.now();return new Date(Math.ceil(now/interval)*interval)}
  function setState(id,text,level){const el=$(id);if(!el)return;el.textContent=text;el.className=level||""}
  function newestParkingTime(data){if(!Array.isArray(data))return parseTaipei(data?.updatedAt||data?.updateTime||data?.lastUpdate);const values=data.map(x=>parseTaipei(x.updateTime)).filter(Boolean);return values.length?new Date(Math.max(...values.map(x=>x.getTime()))):null}
  async function fetchJson(url){const r=await fetch(url+(url.includes("?")?"&":"?")+"status="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error(`HTTP ${r.status}`);return {data:await r.json(),status:r.status}}
  async function loadParking(){try{const r=await fetchJson(RAW_BASE+"parking.json");state.parking=r.data;state.parkingHttp=`${r.status} OK`;state.parkingSource="GitHub raw"}catch(e){state.parkingHttp=e.message;try{const r=await fetchJson("data/parking.json");state.parking=r.data;state.parkingSource="GitHub Pages fallback"}catch(e2){state.parking=null;state.parkingSource="Unavailable"}}}
  async function loadAirportParking(){try{const r=await fetchJson(RAW_BASE+"airport-parking.json");state.airportParking=r.data;state.airportParkingHttp=`${r.status} OK`;state.airportParkingSource="GitHub raw"}catch(e){state.airportParkingHttp=e.message;try{const r=await fetchJson("data/airport-parking.json");state.airportParking=r.data;state.airportParkingSource="GitHub Pages fallback"}catch(e2){state.airportParking=null;state.airportParkingSource="Unavailable"}}}
  async function loadArinc(){try{const r=await fetchJson(RAW_BASE+"arinc.json");state.arinc=r.data;state.arincHttp=`${r.status} OK`;state.arincRoute=r.data.route||"Unknown"}catch(e){state.arincHttp=e.message;try{const r=await fetchJson("data/arinc.json");state.arinc=r.data;state.arincRoute=(r.data.route||"Unknown")+" (fallback)"}catch(e2){state.arinc=null;state.arincRoute="Unavailable"}}}
  function render(){
    const now=Date.now();
    const pt=newestParkingTime(state.parking),pa=pt?now-pt.getTime():Infinity;
    const parkingLevel=pa<=10*60000?"normal":pa<=30*60000?"delayed":"offline";
    setState("systemParkingState",parkingLevel==="normal"?"Normal":parkingLevel==="delayed"?"Delayed":"Offline",parkingLevel);
    $("systemParkingLast").textContent=pt?clock(pt):"--";$("systemParkingAge").textContent=ageText(pa);$("systemParkingNext").textContent=clock(nextSlot(PARKING_INTERVAL));
    $("systemGithubParking").textContent=state.parkingHttp;if($("systemGithubAirportParking"))$("systemGithubAirportParking").textContent=state.airportParkingHttp;
    const af=dateOf(state.arinc?.fetchedAtUtc),aa=af?now-af.getTime():Infinity;
    const arincLevel=state.arinc?(aa<=45*60000?"normal":aa<=3*3600000?"delayed":"offline"):"offline";
    setState("systemArincState",arincLevel==="normal"?"Normal":arincLevel==="delayed"?"Delayed":"Offline",arincLevel);
    const vf=dateOf(state.arinc?.validFromUtc);$("systemArincValid").textContent=vf?clock(vf,true):"--";$("systemArincLast").textContent=af?clock(af,true):"--";$("systemArincNext").textContent=clock(nextSlot(ARINC_INTERVAL),true);
    $("systemGithubArinc").textContent=state.arincHttp;$("systemCheckedAt").textContent=clock(new Date());
    $("diagParkingSource").textContent=state.parkingSource;$("diagParkingHttp").textContent=state.parkingHttp;if($("diagAirportParkingHttp"))$("diagAirportParkingHttp").textContent=state.airportParkingHttp;$("diagArincRoute").textContent=state.arincRoute;$("diagArincHttp").textContent=state.arincHttp;
    const levels=[parkingLevel,arincLevel,state.parking&&state.airportParking&&state.arinc?"normal":"offline"];
    const overall=levels.includes("offline")?"offline":levels.includes("delayed")?"delayed":"normal";
    const dot=$("systemOverallDot");dot.className="system-dot "+overall;
    $("systemOverallText").textContent=overall==="normal"?"All Systems Normal":overall==="delayed"?"Minor Issues":"Service Degraded";
  }
  async function refresh(){await Promise.allSettled([loadParking(),loadAirportParking(),loadArinc()]);render()}
  refresh();setInterval(refresh,60000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});window.addEventListener("focus",refresh);
})();
