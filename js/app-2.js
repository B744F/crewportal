(function(){
  const PARKING_JSON = "data/parking.json";
  const REFRESH_MS = 15000;
  const STALE_AFTER_MS = 10 * 60 * 1000;
  const CRON_INTERVAL_MS = 5 * 60 * 1000;

  const els = {
    BOT: document.getElementById("parkingBOT"),
    TSA: document.getElementById("parkingTSA"),
    RD1A: document.getElementById("parkingRD1A"),
    RD1B: document.getElementById("parkingRD1B")
  };
  const updateEl = document.getElementById("parkingUpdateTime");
  const statusEl = document.getElementById("parkingStatus");
  const nextEl = document.getElementById("parkingNextUpdate");
  const ageEl = document.getElementById("parkingAge");

  let lastDataTime = null;
  let countdownTimer = null;

  function setValue(key, value){
    if(!els[key]) return;
    const display = (value === null || value === undefined || value === "") ? "--" : String(value);
    if(els[key].textContent !== display){
      els[key].classList.add("parking-pulse");
      window.setTimeout(() => els[key].classList.remove("parking-pulse"), 650);
    }
    els[key].textContent = display;
    els[key].classList.remove("parking-ok", "parking-warn", "parking-full");
    const n = Number(display);
    if(Number.isFinite(n)){
      if(n < 20) els[key].classList.add("parking-full");
      else if(n < 100) els[key].classList.add("parking-warn");
      else els[key].classList.add("parking-ok");
    }
  }

  function setUpdateTime(value){
    if(updateEl) updateEl.textContent = value || "--";
  }

  function setStatus(text, state){
    if(!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove("offline", "syncing", "stale", "live");
    if(state) statusEl.classList.add(state);
  }

  function parseTaipeiTime(value){
    if(!value || value === "--") return null;
    const normalized = String(value).replace(" ", "T") + "+08:00";
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function latestUpdateTimeFromArray(data){
    return data
      .map(item => item.updateTime)
      .filter(Boolean)
      .sort()
      .pop() || "--";
  }

  function normalizeParkingData(data){
    if(Array.isArray(data)){
      const find = name => data.find(item => item.name === name)?.remaining_space ?? "--";
      return {
        online: true,
        updatedAt: latestUpdateTimeFromArray(data),
        BOT: find("BOT"),
        TSA: find("TSA"),
        RD1A: find("RD1 A"),
        RD1B: find("RD1 B")
      };
    }

    if(data && typeof data === "object"){
      return {
        online: data.online !== false,
        updatedAt: data.updatedAt || data.updateTime || data.lastUpdate || "--",
        BOT: data.BOT ?? "--",
        TSA: data.TSA ?? "--",
        RD1A: data.RD1A ?? data["RD1 A"] ?? "--",
        RD1B: data.RD1B ?? data["RD1 B"] ?? "--"
      };
    }

    return { online:false, updatedAt:"--", BOT:"--", TSA:"--", RD1A:"--", RD1B:"--" };
  }

  function secondsText(ms){
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}分${String(s).padStart(2,"0")}秒` : `${s}秒`;
  }

  function formatClock(date){
    const hh = String(date.getHours()).padStart(2,"0");
    const mm = String(date.getMinutes()).padStart(2,"0");
    const ss = String(date.getSeconds()).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }

  function nextCronTime(now){
    const next = new Date(now.getTime());
    next.setSeconds(0, 0);
    const minute = next.getMinutes();
    const remainder = minute % 5;
    if(remainder === 0 && now.getSeconds() === 0){
      return next;
    }
    const addMinutes = remainder === 0 ? 5 : (5 - remainder);
    next.setMinutes(minute + addMinutes);
    return next;
  }

  function updateCountdown(){
    const now = new Date();
    const next = nextCronTime(now);
    const nextMs = next.getTime() - now.getTime();

    if(nextEl){
      nextEl.textContent = `下次同步：${formatClock(next)}（約 ${secondsText(nextMs)}）`;
    }

    if(!lastDataTime){
      if(ageEl) ageEl.textContent = "資料年齡：--";
      return;
    }

    const ageMs = now.getTime() - lastDataTime.getTime();
    if(ageEl) ageEl.textContent = `資料約 ${secondsText(ageMs)} 前更新`;

    if(ageMs > STALE_AFTER_MS){
      setStatus("● 資料可能過期", "stale");
    }
  }

  function startCountdown(){
    if(countdownTimer) window.clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function applyParkingData(raw){
    const data = normalizeParkingData(raw);

    setValue("BOT", data.BOT);
    setValue("TSA", data.TSA);
    setValue("RD1A", data.RD1A);
    setValue("RD1B", data.RD1B);
    setUpdateTime(data.updatedAt);

    lastDataTime = parseTaipeiTime(data.updatedAt);

    if(!data.online){
      setStatus("● 離線", "offline");
    }else if(!lastDataTime || (Date.now() - lastDataTime.getTime()) > STALE_AFTER_MS){
      setStatus("● 資料可能過期", "stale");
    }else{
      setStatus("● Live 最新同步", "live");
    }

    startCountdown();
  }

  async function fetchJson(url){
    const res = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  async function updateParking(){
    try{
      if(!lastDataTime) setStatus("● 正在讀取最新資料", "syncing");
      const data = await fetchJson(PARKING_JSON);
      applyParkingData(data);
    }catch(err){
      console.warn("Parking data load failed", err);
      setStatus("● 離線", "offline");
      if(nextEl) nextEl.textContent = "同步失敗，稍後重試";
    }
  }

  // Initial load and automatic refresh. The query string in fetchJson() prevents GitHub Pages/browser caching.
  updateParking();
  window.setInterval(updateParking, REFRESH_MS);

  // Refresh immediately when the user returns to the tab or window.
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden) updateParking();
  });
  window.addEventListener("focus", updateParking);
})();
