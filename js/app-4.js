(function(){
  const VERSION = "8.1.7";
  const BUILD = "20260726-026";
  const DEFAULT_FLIGHT_AIRLINE = "CI";
  const RAW_BASE="https://raw.githubusercontent.com/B744F/crewportal/main/data/";
  const FLIGHT_GATE_API="https://flightdeck-api.201505-login.workers.dev/api/flight-gate";
  const CARGO_STAND_API="https://flightdeck-api.201505-login.workers.dev/api/cargo-stand";
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
      .aircraft-gate-button:hover{filter:brightness(1.12)}#aircraftGateStatus{display:none;margin-top:7px;font-size:12px;color:#b9d8ed}#aircraftGateStatus.warning{color:#ffd27a}#aircraftGateStatus.error{color:#ffc8c8}
      .aircraft-gate-result{display:none;margin-top:8px;border:1px solid rgba(105,189,255,.25);border-radius:9px;overflow:hidden;background:rgba(0,8,16,.24)}
      .aircraft-cargo-block{border-top:1px solid rgba(255,207,64,.25);background:rgba(43,28,0,.10)}.aircraft-cargo-title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 9px;border-bottom:1px solid rgba(255,207,64,.18);color:#ffd21f;font-size:10px;font-weight:1000;letter-spacing:.06em}.aircraft-cargo-title small{color:#d7bd78;font-size:9px;font-weight:700;letter-spacing:0}.aircraft-cargo-block .aircraft-gate-row strong{background:#ffbd2e;border-color:#ffe27a}
      .aircraft-gate-result-head{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;align-items:center;gap:8px;padding:6px 9px;border-bottom:1px solid rgba(255,255,255,.10);color:#9fb7ca;font-size:10px}
      .aircraft-gate-result-head strong{min-width:max-content;overflow:visible;text-overflow:clip;white-space:nowrap;color:#dcefff;font-size:11px}.aircraft-gate-result-head small,.aircraft-gate-route-inline{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aircraft-gate-result-head small{text-align:right}.aircraft-gate-route-inline{margin:0;color:#ffd400;font-size:12px;font-weight:1000;letter-spacing:.09em;text-align:center}
      .aircraft-gate-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(62px,auto) minmax(54px,auto);align-items:center;gap:8px;padding:7px 9px;border-top:1px solid rgba(255,255,255,.08)}
      .aircraft-gate-row:first-child{border-top:0}.aircraft-gate-row div{min-width:0}.aircraft-gate-row b{display:block;color:#eef7ff;font-size:11px}.aircraft-gate-value{display:contents}.aircraft-gate-terminal{display:inline-flex;align-items:center;justify-content:center;min-width:62px;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;color:#eef7ff;font-size:17px;line-height:1;font-weight:1000;letter-spacing:.03em;white-space:nowrap}.aircraft-gate-terminal.t1{color:#35c86a}.aircraft-gate-terminal.t2{color:#42a5ff}.aircraft-gate-terminal.t3{color:#f05a5a}.aircraft-gate-terminal.other{color:#cbd5df}
      .aircraft-gate-row span{display:block;margin-top:2px;color:#9fb0c5;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aircraft-gate-row .aircraft-gate-terminal{font-size:18px;margin-top:0}.aircraft-gate-status-flown{color:#ff4f5e;font-style:normal;font-weight:1000}
      .aircraft-gate-row strong{min-width:54px;padding:5px 7px;text-align:center;background:#ffd21f;border:1px solid #ffea70;border-radius:4px;box-shadow:0 1px 0 rgba(0,0,0,.35),inset 0 -2px 0 rgba(104,72,0,.28);color:#08111b;font-size:18px;line-height:1;letter-spacing:.03em}.aircraft-gate-row strong.is-empty{color:#08111b;font-size:11px}
      @media(max-width:760px){.aircraft-track-form{grid-template-columns:1fr 96px}.aircraft-track-button{font-size:12px}}
      @media(max-width:760px){.aircraft-gate-form{grid-template-columns:1fr 96px}.aircraft-gate-button{font-size:12px}.aircraft-gate-result-head{gap:5px;padding-left:7px;padding-right:7px}.aircraft-gate-result-head strong{font-size:10px}.aircraft-gate-route-inline{font-size:11px;letter-spacing:.04em}.aircraft-gate-result-head small{font-size:9px}.aircraft-gate-row{grid-template-columns:minmax(0,1fr) 54px 54px;gap:5px;padding-left:7px;padding-right:7px}.aircraft-gate-terminal{min-width:54px;font-size:15px}.aircraft-gate-row strong{min-width:54px;padding-left:4px;padding-right:4px;font-size:16px}.aircraft-cargo-title{padding-left:7px;padding-right:7px}}
    `;
    document.head.appendChild(style);
    const wrap=document.createElement("div");
    wrap.innerHTML=`<div class="aircraft-track-divider"></div><div class="aircraft-track-title"><span>⌖</span><span>AIRCRAFT TRACKING</span></div><form class="aircraft-track-form" id="aircraftTrackForm"><input id="aircraftTrackInput" aria-label="Call Sign or aircraft registration number" autocomplete="off" maxlength="12" placeholder="CALL SIGN / REG No." type="text"><button class="aircraft-track-button" type="submit">TRACK ›</button></form><div id="aircraftTrackStatus"></div><div class="aircraft-gate-divider"></div><div class="aircraft-gate-title"><span>◈</span><span>RCTP GATE INFO</span></div><form class="aircraft-gate-form" id="aircraftGateForm"><input id="aircraftGateInput" aria-label="Flight number for Taoyuan Airport gate lookup" autocomplete="off" maxlength="12" placeholder="e.g. CI100 or 100 = CI100" type="text"><button class="aircraft-gate-button" type="submit">GATE ›</button></form><div id="aircraftGateStatus"></div><div id="aircraftGateResult" class="aircraft-gate-result"></div>`;
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
    const terminalCode=value=>{const text=String(value||"").trim().toUpperCase(),match=text.match(/^T?([1-3])$/);return match?`T${match[1]}`:(text||"-")};
    const terminalClass=value=>({T1:"t1",T2:"t2",T3:"t3"}[terminalCode(value)]||"other");
    const directionLabel=value=>({"抵達":"抵達 ARRIVAL","出發":"出發 DEPARTURE"}[String(value||"")]||String(value||"--"));
    const effectiveFlightTime=match=>parseTaipei(`${match.estimatedDate||match.date}T${match.estimatedTime||match.time}`);
    const flightHasDeparted=match=>{
      const status=String(match.status||"");
      if(status.includes("取消"))return false;
      if(status.includes("已飛"))return true;
      const scheduled=effectiveFlightTime(match);
      return String(match.direction||"")==="出發"&&scheduled&&scheduled.getTime()<=Date.now();
    };
    const flightHasArrived=match=>{
      const status=String(match.status||"");
      return String(match.direction||"")==="抵達"&&(status.includes("已到")||status.includes("ARRIVED")||status.includes("抵達"));
    };
    const normalizeFlightNumber=value=>{const compact=String(value||"").trim().toUpperCase().replace(/[\s-]/g,"");const numericOnly=compact.match(/^(\d{1,4}[A-Z]?)$/),match=numericOnly||compact.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/)||compact.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);if(!match)return"";const airline=numericOnly?DEFAULT_FLIGHT_AIRLINE:match[2]?match[1]:DEFAULT_FLIGHT_AIRLINE,rawNumber=match[2]||match[1],suffix=/[A-Z]$/.test(rawNumber)?rawNumber.slice(-1):"",digits=rawNumber.slice(0,rawNumber.length-suffix.length).replace(/^0+(?=\d)/,"");return`${airline}${digits}${suffix}`};
    const renderFlightRow=(match,cargo=false,freshness="fresh")=>{const departed=flightHasDeparted(match),arrived=flightHasArrived(match),rawStatus=String(match.status||""),status=rawStatus||(departed?"已飛":""),position=cargo?match.stand:match.gate,emptyLabel=cargo?"無資料":(rawStatus.includes("取消")||departed||arrived?"無資料":freshness==="fresh"?"尚未公布":"無法確認"),displayDate=match.estimatedDate||match.date,displayTime=match.estimatedTime||match.time,timeChanged=match.estimatedTime&&match.estimatedTime!==match.time,statusMarkup=status?` · <em class="${status.includes("已飛")||status.includes("DEPARTED")?"aircraft-gate-status-flown":""}">${escapeHtml(status)}</em>`:"",timeMarkup=timeChanged?" · 預計":"",aircraftMarkup=cargo&&match.aircraftType?` · ${escapeHtml(match.aircraftType)}`:"";return `<div class="aircraft-gate-row"><div><b>${escapeHtml(directionLabel(match.direction))}</b><span>${escapeHtml(displayDate)} ${escapeHtml(displayTime)}${timeMarkup}${aircraftMarkup}${statusMarkup}</span></div><div class="aircraft-gate-value"><span class="aircraft-gate-terminal ${terminalClass(match.terminal)}">${escapeHtml(terminalCode(match.terminal))}</span><strong class="${position?"":"is-empty"}">${escapeHtml(position||emptyLabel)}</strong></div></div>`};
    const setGateStatus=(text,level="")=>{gateStatus.textContent=text;gateStatus.className=level;gateStatus.style.display="block"};
    gateInput.addEventListener("input",()=>{gateInput.value=gateInput.value.toUpperCase().replace(/[^A-Z0-9 -]/g,"").slice(0,12);gateStatus.style.display="none"});
    gateForm.addEventListener("submit",async e=>{
      e.preventDefault();
      const value=normalizeFlightNumber(gateInput.value);
      if(!/^(?:[A-Z0-9]{2,3}\s*-?\s*)?\d{1,4}[A-Z]?$/.test(value)){
        setGateStatus("請輸入航班號碼，例如 CI100、5X61 或 100","error");gateResult.style.display="none";gateInput.focus();return;
      }
      setGateStatus("正在查詢桃園機場航班與貨機坪資料…");gateResult.style.display="none";
      try{
        const [gateResultData,cargoResultData]=await Promise.all([fetch(`${FLIGHT_GATE_API}?flight=${encodeURIComponent(value)}&v=${Date.now()}`,{cache:"no-store"}).then(async response=>({response,data:await response.json()})).catch(()=>({response:null,data:null})),fetch(`${CARGO_STAND_API}?flight=${encodeURIComponent(value)}&v=${Date.now()}`,{cache:"no-store"}).then(async response=>({response,data:await response.json()})).catch(()=>({response:null,data:null}))]);
        const response=gateResultData.response,data=gateResultData.data||{},cargoResponse=cargoResultData.response,cargoData=cargoResultData.data||{};
        const matches=response?.ok&&data.ok?(data.matches||[]).filter(match=>match.date===todayTaipei()):[];
        const cargoMatches=cargoResponse?.ok&&cargoData.ok?(cargoData.matches||[]).filter(match=>match.date===todayTaipei()):[];
        if(!matches.length&&!cargoMatches.length&&!response?.ok){
          if(data.errorCode==="LIVE_FLIGHT_DATA_UNAVAILABLE")throw new Error("桃園機場官方即時資料暫時無法取得，未使用過期快照，請稍後重試。");
          throw new Error(data.error||"查詢失敗");
        }
        const freshness=data.freshness||"fresh",ageSeconds=Number(data.dataAgeSeconds),age=Number.isFinite(ageSeconds)?ageText(ageSeconds*1000):"未知時間",showGateFreshness=matches.length>0;
        const freshnessMessage=showGateFreshness?(freshness==="stale"?` ⚠ 資料已過期（${age}前）`:(freshness==="delayed"?` ⚠ 資料更新延遲（${age}前）`:"")):"";
        const freshnessLevel=showGateFreshness&&freshness!=="fresh"?"warning":"";
        if(!matches.length&&!cargoMatches.length){setGateStatus(`找不到今日的官方航班或貨機坪資料。${freshnessMessage}`,freshnessLevel||"error");return}
        if(freshnessMessage)setGateStatus(freshnessMessage.trim(),freshnessLevel);else{gateStatus.textContent="";gateStatus.className="";gateStatus.style.display="none";}
        const allRoutes=[...new Set([...matches,...cargoMatches].map(match=>match.route).filter(Boolean))].join(" · ")||"--/--";
        const fetchedAt=parseUtc(cargoMatches.length&&!matches.length?cargoData.fetchedAt:(data.fetchedAt||cargoData.fetchedAt)),fetchedClock=fetchedAt?clock(fetchedAt):"--:--:--",queryLabel=data.query||cargoData.query||value,headerLabel=matches.length&&cargoMatches.length?"登機門／貨機坪":matches.length?"登機門":"貨機坪";
        const passengerRows=matches.map(match=>renderFlightRow(match,false,freshness)).join("");
        const cargoRows=cargoMatches.length?`<div class="aircraft-cargo-block"><div class="aircraft-cargo-title"><span>貨機坪停機位</span><small>TPE GOSS · 501–525</small></div>${cargoMatches.map(match=>renderFlightRow(match,true,"fresh")).join("")}</div>`:"";
        gateResult.innerHTML=`<div class="aircraft-gate-result-head"><strong>${escapeHtml(queryLabel)} ${headerLabel}</strong><span class="aircraft-gate-route-inline">${escapeHtml(allRoutes)}</span><small>資料 ${escapeHtml(fetchedClock)} 更新</small></div>${passengerRows}${cargoRows}`;
        gateResult.style.display="block";
      }catch(error){setGateStatus(`查詢失敗：${error.message||"請稍後再試"}`,"error");gateResult.style.display="none"}
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
