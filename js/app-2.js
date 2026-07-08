
(function(){
  const API_URL = "http://1.34.202.50:9130/parking_place/huahang";
  const FALLBACK_JSON = "data/parking.json";
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
      if(n <= 0) els[key].classList.add("parking-full");
      else if(n < 30) els[key].classList.add("parking-warn");
      else els[key].classList.add("parking-ok");
    }
  }

  function setUpdateTime(value){
    if(!updateEl) return;
    updateEl.textContent = value || "--";
  }

  function setStatus(text, offline=false){
    if(!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("offline", offline);
  }

  function latestUpdateTimeFromArray(data){
    return data
      .map(item => item.updateTime)
      .filter(Boolean)
      .sort()
      .pop() || "--";
  }

  function applyParkingData(data, source="api"){
    if(Array.isArray(data)){
      const find = name => data.find(item => item.name === name)?.remaining_space ?? "--";
      setValue("BOT", find("BOT"));
      setValue("TSA", find("TSA"));
      setValue("RD1A", find("RD1 A"));
      setValue("RD1B", find("RD1 B"));
      setUpdateTime(latestUpdateTimeFromArray(data));
      setStatus(source === "api" ? "● 即時更新" : "● 備援資料", source !== "api");
      return;
    }
    if(data && typeof data === "object"){
      setValue("BOT", data.BOT);
      setValue("TSA", data.TSA);
      setValue("RD1A", data.RD1A);
      setValue("RD1B", data.RD1B);
      setUpdateTime(data.updatedAt || data.updateTime || "--");
      setStatus("● 備援資料", true);
    }
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  async function updateParking(){
    try{
      const data = await fetchJson(API_URL);
      applyParkingData(data, "api");
    }catch(apiError){
      console.warn("Direct parking API failed; trying data/parking.json", apiError);
      try{
        const data = await fetchJson(FALLBACK_JSON);
        applyParkingData(data, "fallback");
      }catch(jsonError){
        console.warn("Parking fallback failed", jsonError);
        setStatus("● 離線", true);
      }
    }
  }

  updateParking();
  setInterval(updateParking, 15000);
})();
