(function(){
  const PARKING_JSON = "data/parking.json";
  const REFRESH_MS = 30000;
  const STALE_AFTER_MS = 15 * 60 * 1000;

  const els = {
    BOT: document.getElementById("parkingBOT"),
    TSA: document.getElementById("parkingTSA"),
    RD1A: document.getElementById("parkingRD1A"),
    RD1B: document.getElementById("parkingRD1B")
  };
  const updateEl = document.getElementById("parkingUpdateTime");
  const statusEl = document.getElementById("parkingStatus");

  function setValue(key, value){
    if(!els[key]) return;
    const display = (value === null || value === undefined || value === "") ? "--" : String(value);
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
    statusEl.classList.remove("offline", "syncing", "stale");
    if(state) statusEl.classList.add(state);
  }

  function parseTaipeiTime(value){
    if(!value || value === "--") return null;
    const normalized = String(value).replace(" ", "T") + "+08:00";
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isStale(value){
    const date = parseTaipeiTime(value);
    if(!date) return true;
    return (Date.now() - date.getTime()) > STALE_AFTER_MS;
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

  function applyParkingData(raw){
    const data = normalizeParkingData(raw);

    setValue("BOT", data.BOT);
    setValue("TSA", data.TSA);
    setValue("RD1A", data.RD1A);
    setValue("RD1B", data.RD1B);
    setUpdateTime(data.updatedAt);

    if(!data.online){
      setStatus("● 離線", "offline");
    }else if(isStale(data.updatedAt)){
      setStatus("● 資料逾時", "stale");
    }else{
      setStatus("● GitHub 同步", "");
    }
  }

  async function fetchJson(url){
    const res = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  async function updateParking(){
    try{
      setStatus("● 更新中", "syncing");
      const data = await fetchJson(PARKING_JSON);
      applyParkingData(data);
    }catch(err){
      console.warn("Parking data load failed", err);
      setStatus("● 離線", "offline");
    }
  }

  updateParking();
  setInterval(updateParking, REFRESH_MS);
})();
