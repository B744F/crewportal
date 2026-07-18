(function(){
  const CREW_JSON = "data/parking.json";
  const AIRPORT_JSON = "data/airport-parking.json";
  const REFRESH_MS = 15000;
  const STALE_AFTER_MS = 10 * 60 * 1000;
  const STORAGE_KEY = "crewportal-combined-parking-last-good";

  const els = {
    BOT: document.getElementById("parkingBOT"),
    TSA: document.getElementById("parkingTSA"),
    RD1A: document.getElementById("parkingRD1A"),
    RD1B: document.getElementById("parkingRD1B"),
    P1: document.getElementById("parkingP1"),
    P2: document.getElementById("parkingP2"),
    P4: document.getElementById("parkingP4"),
    P3: document.getElementById("parkingP3")
  };
  const crewUpdateEl = document.getElementById("parkingUpdateTime");
  const airportUpdateEl = document.getElementById("airportParkingUpdateTime");
  const statusEl = document.getElementById("parkingStatus");
  const nextEl = document.getElementById("parkingNextUpdate");
  const ageEl = document.getElementById("parkingAge");

  let latestDataTime = null;
  let statusMode = "offline";
  let countdownTimer = null;

  function setValue(key, value, unavailableText){
    const el = els[key];
    if(!el) return;
    const display = (value === null || value === undefined || value === "") ? (unavailableText || "--") : String(value);
    if(el.textContent !== display){
      el.classList.add("parking-pulse");
      window.setTimeout(() => el.classList.remove("parking-pulse"), 650);
    }
    el.textContent = display;
    el.classList.remove("parking-ok", "parking-warn", "parking-full", "parking-unavailable");
    const n = Number(value);
    if(Number.isFinite(n)){
      if(n < 20) el.classList.add("parking-full");
      else if(n < 100) el.classList.add("parking-warn");
      else el.classList.add("parking-ok");
    }else if(unavailableText){
      el.classList.add("parking-unavailable");
    }
  }

  function setStatus(text, state){
    if(!statusEl) return;
    statusMode = state || "offline";
    statusEl.textContent = text;
    statusEl.classList.remove("offline", "syncing", "stale", "live");
    statusEl.classList.add(statusMode);
  }

  function parseTaipeiTime(value){
    if(!value || value === "--") return null;
    let normalized = String(value).trim().replace(" ", "T");
    if(!/[zZ]|[+-]\d\d:\d\d$/.test(normalized)) normalized += "+08:00";
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function latestUpdateTimeFromArray(data){
    return data.map(item => item.updateTime).filter(Boolean).sort().pop() || "--";
  }

  function normalizeCrew(data){
    if(Array.isArray(data)){
      const find = name => data.find(item => item.name === name)?.remaining_space ?? "--";
      return {online:true, updatedAt:latestUpdateTimeFromArray(data), BOT:find("BOT"), TSA:find("TSA"), RD1A:find("RD1 A"), RD1B:find("RD1 B")};
    }
    if(data && typeof data === "object"){
      return {online:data.online !== false, updatedAt:data.updatedAt || data.updateTime || data.lastUpdate || "--", BOT:data.BOT ?? "--", TSA:data.TSA ?? "--", RD1A:data.RD1A ?? data["RD1 A"] ?? "--", RD1B:data.RD1B ?? data["RD1 B"] ?? "--"};
    }
    return {online:false, updatedAt:"--", BOT:"--", TSA:"--", RD1A:"--", RD1B:"--"};
  }

  function normalizeAirport(data){
    if(data && typeof data === "object"){
      return {online:data.online !== false, updatedAt:data.updatedAt || data.fetchedAt || "--", P1:data.P1 ?? "--", P2:data.P2 ?? "--", P4:data.P4 ?? "--", P3:data.P3 ?? null, P3Available:data.P3Available === true || Number.isFinite(Number(data.P3))};
    }
    return {online:false, updatedAt:"--", P1:"--", P2:"--", P4:"--", P3:null, P3Available:false};
  }

  function secondsText(ms){
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60), s = total % 60;
    return m > 0 ? `${m}分${String(s).padStart(2,"0")}秒` : `${s}秒`;
  }

  function formatClock(date){
    return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}:${String(date.getSeconds()).padStart(2,"0")}`;
  }

  function nextCronTime(now){
    const next = new Date(now.getTime());
    next.setSeconds(0,0);
    const remainder = next.getMinutes() % 5;
    next.setMinutes(next.getMinutes() + (remainder === 0 ? 5 : 5 - remainder));
    return next;
  }

  function updateCountdown(){
    const now = new Date(), next = nextCronTime(now);
    if(nextEl) nextEl.textContent = `下次同步：${formatClock(next)}（約 ${secondsText(next-now)}）`;
    if(!latestDataTime){ if(ageEl) ageEl.textContent = "資料年齡：--"; return; }
    const ageMs = now - latestDataTime;
    if(ageEl) ageEl.textContent = `最新資料約 ${secondsText(ageMs)} 前更新`;
    if(ageMs > STALE_AFTER_MS && statusMode === "live") setStatus("● 資料可能過期", "stale");
  }

  function startCountdown(){
    if(countdownTimer) clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = setInterval(updateCountdown,1000);
  }

  function applyData(crewRaw, airportRaw, sourceState){
    const crew = normalizeCrew(crewRaw), airport = normalizeAirport(airportRaw);
    setValue("BOT",crew.BOT); setValue("TSA",crew.TSA); setValue("RD1A",crew.RD1A); setValue("RD1B",crew.RD1B);
    setValue("P1",airport.P1); setValue("P2",airport.P2); setValue("P4",airport.P4);
    setValue("P3",airport.P3Available ? airport.P3 : null, "未提供");
    if(crewUpdateEl) crewUpdateEl.textContent = crew.updatedAt || "--";
    if(airportUpdateEl) airportUpdateEl.textContent = airport.updatedAt || "--";

    const times = [parseTaipeiTime(crew.updatedAt), parseTaipeiTime(airport.updatedAt)].filter(Boolean).sort((a,b)=>b-a);
    latestDataTime = times[0] || null;

    if(sourceState.crewLive && sourceState.airportLive) setStatus("● 即時同步", "live");
    else if(!sourceState.crewLive && sourceState.crewCached && sourceState.airportLive) setStatus("● 華航園區使用暫存", "stale");
    else if(sourceState.crewLive && !sourceState.airportLive && sourceState.airportCached) setStatus("● 桃園機場使用暫存", "stale");
    else if(sourceState.crewCached || sourceState.airportCached) setStatus("● 部分資料使用暫存", "stale");
    else if(crew.online || airport.online) setStatus("● 部分資料在線", "stale");
    else setStatus("● 資料離線", "offline");
    startCountdown();
  }

  async function fetchJson(url){
    const res = await fetch(url + "?t=" + Date.now(), {cache:"no-store"});
    if(!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return JSON.parse(await res.text());
  }
  function saveLastGood(data){ try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); }catch(_err){} }
  function loadLastGood(){ try{ const value=localStorage.getItem(STORAGE_KEY); return value?JSON.parse(value):null; }catch(_err){ return null; } }

  async function updateParking(){
    if(!latestDataTime) setStatus("● 正在讀取最新資料", "syncing");
    const [crewResult, airportResult] = await Promise.allSettled([fetchJson(CREW_JSON), fetchJson(AIRPORT_JSON)]);
    const cached = loadLastGood() || {};
    const sourceState = {
      crewLive: crewResult.status === "fulfilled",
      airportLive: airportResult.status === "fulfilled",
      crewCached: crewResult.status !== "fulfilled" && !!cached.crew,
      airportCached: airportResult.status !== "fulfilled" && !!cached.airport
    };
    const crew = sourceState.crewLive ? crewResult.value : cached.crew;
    const airport = sourceState.airportLive ? airportResult.value : cached.airport;
    if(sourceState.crewLive || sourceState.airportLive) saveLastGood({crew,airport});
    applyData(crew,airport,sourceState);
    if(!sourceState.crewLive || !sourceState.airportLive){
      console.warn("Combined parking data partial failure", crewResult, airportResult);
    }
  }

  updateParking();
  setInterval(updateParking,REFRESH_MS);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) updateParking(); });
  window.addEventListener("focus",updateParking);
})();