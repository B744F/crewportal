(function(){
  const PARKING_URL="data/parking.json";
  const ARINC_URL="data/arinc.json";
  const PARKING_INTERVAL=5*60*1000;
  const ARINC_INTERVAL=15*60*1000;
  const $=id=>document.getElementById(id);
  const state={parking:null,arinc:null,parkingHttp:"Checking",arincHttp:"Checking"};
  function parseTaipei(value){if(!value)return null;const d=new Date(String(value).replace(" ","T")+"+08:00");return isNaN(d)?null:d}
  function dateOf(value){const d=new Date(value||0);return isNaN(d)?null:d}
  function ageText(ms){if(!Number.isFinite(ms)||ms<0)return"--";const m=Math.floor(ms/60000);if(m<1)return"< 1 min";if(m<60)return`${m} min`;const h=Math.floor(m/60),r=m%60;return`${h}h ${r}m`}
  function clock(d,utc=false){if(!d)return"--";return new Intl.DateTimeFormat("zh-TW",{timeZone:utc?"UTC":"Asia/Taipei",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d)+(utc?" UTC":"")}
  function nextSlot(interval){return new Date(Math.ceil(Date.now()/interval)*interval)}
  function setState(id,text,level){const el=$(id);if(!el)return;el.textContent=text;el.className=level||""}
  function newestParkingTime(data){if(!Array.isArray(data))return parseTaipei(data?.updatedAt||data?.updateTime||data?.lastUpdate);const values=data.map(x=>parseTaipei(x.updateTime)).filter(Boolean);return values.length?new Date(Math.max(...values.map(x=>x.getTime()))):null}
  async function fetchJson(url){const r=await fetch(`${url}?status=${Date.now()}`,{cache:"no-store"});if(!r.ok)throw new Error(`HTTP ${r.status}`);return {data:await r.json(),status:r.status}}
  async function loadParking(){try{const r=await fetchJson(PARKING_URL);state.parking=r.data;state.parkingHttp=`${r.status} OK`;}catch(e){state.parking=null;state.parkingHttp=e.message}}
  async function loadArinc(){try{const r=await fetchJson(ARINC_URL);state.arinc=r.data;state.arincHttp=`${r.status} OK`;}catch(e){state.arinc=null;state.arincHttp=e.message}}
  function render(){
    const now=Date.now();
    const pt=newestParkingTime(state.parking),pa=pt?now-pt.getTime():Infinity;
    const parkingLevel=!state.parking?"offline":pa<=10*60000?"normal":pa<=30*60000?"delayed":"offline";
    setState("systemParkingState",parkingLevel==="normal"?"Normal":parkingLevel==="delayed"?"Delayed":"Offline",parkingLevel);
    $("systemParkingLast").textContent=pt?clock(pt):"--";$("systemParkingAge").textContent=ageText(pa);$("systemParkingNext").textContent=clock(nextSlot(PARKING_INTERVAL));
    $("systemGithubParking").textContent=state.parking?"Loaded":"Unavailable";

    const af=dateOf(state.arinc?.fetchedAtUtc),vf=dateOf(state.arinc?.validFromUtc);
    const arincLevel=state.arinc?"normal":"offline";
    setState("systemArincState",state.arinc?"Normal":"Offline",arincLevel);
    $("systemArincValid").textContent=vf?clock(vf,true):"--";$("systemArincLast").textContent=af?clock(af,true):"--";$("systemArincNext").textContent=clock(nextSlot(ARINC_INTERVAL),true);
    $("systemGithubArinc").textContent=state.arinc?"Loaded":"Unavailable";$("systemCheckedAt").textContent=clock(new Date());
    $("diagParkingSource").textContent=PARKING_URL;$("diagParkingHttp").textContent=state.parkingHttp;$("diagArincRoute").textContent=state.arinc?.route||"--";$("diagArincHttp").textContent=state.arincHttp;
    const levels=[parkingLevel,arincLevel];
    const overall=levels.includes("offline")?"offline":levels.includes("delayed")?"delayed":"normal";
    $("systemOverallDot").className="system-dot "+overall;
    $("systemOverallText").textContent=overall==="normal"?"All Systems Normal":overall==="delayed"?"Minor Issues":"Service Degraded";
  }
  async function refresh(){await Promise.allSettled([loadParking(),loadArinc()]);render()}
  refresh();setInterval(refresh,60000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});window.addEventListener("focus",refresh);
})();
