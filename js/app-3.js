(function(){
  const ARINC_JSON = "data/arinc.json";
  const REFRESH_MS = 5 * 60 * 1000;
  const STORAGE_KEY = "crewportal-arinc-last-good";
  const FALLBACK = {
    validFrom: "June 3, 2026, 0525Z",
    northAmericaAsia: { primary: 11282, secondary: 5547 },
    alaskaNorthPacific: { primary: 17946, secondary: 10048 }
  };

  const els = {
    validFrom: document.getElementById("arincValidFrom"),
    naPrimary: document.getElementById("arincNorthAmericaPrimary"),
    naSecondary: document.getElementById("arincNorthAmericaSecondary"),
    alaskaPrimary: document.getElementById("arincAlaskaPrimary"),
    alaskaSecondary: document.getElementById("arincAlaskaSecondary"),
    status: document.getElementById("arincStatus")
  };

  function setStatus(text, state){
    if(!els.status) return;
    els.status.textContent = text;
    els.status.classList.remove("syncing", "stale", "offline", "live");
    if(state) els.status.classList.add(state);
  }

  function setText(el, value, frequency){
    if(!el) return;
    const text = value === null || value === undefined || value === "" ? "--" : String(value);
    if(el.textContent !== text){
      el.classList.add("arinc-pulse");
      window.setTimeout(() => el.classList.remove("arinc-pulse"), 650);
    }
    el.textContent = text;
    if(frequency) el.dataset.empty = text === "--" ? "true" : "false";
  }

  function normalize(data){
    return {
      validFrom: data?.validFrom || "--",
      northAmericaAsia: {
        primary: data?.northAmericaAsia?.primary ?? "--",
        secondary: data?.northAmericaAsia?.secondary ?? "--"
      },
      alaskaNorthPacific: {
        primary: data?.alaskaNorthPacific?.primary ?? "--",
        secondary: data?.alaskaNorthPacific?.secondary ?? "--"
      }
    };
  }

  function apply(raw){
    const data = normalize(raw);
    setText(els.validFrom, data.validFrom, false);
    setText(els.naPrimary, data.northAmericaAsia.primary, true);
    setText(els.naSecondary, data.northAmericaAsia.secondary, true);
    setText(els.alaskaPrimary, data.alaskaNorthPacific.primary, true);
    setText(els.alaskaSecondary, data.alaskaNorthPacific.secondary, true);
  }

  function save(data){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(_err){} }
  function load(){ try{ const value=localStorage.getItem(STORAGE_KEY); return value ? JSON.parse(value) : null; }catch(_err){ return null; } }

  async function update(){
    try{
      setStatus("● 正在同步", "syncing");
      const response = await fetch(ARINC_JSON + "?t=" + Date.now(), { cache:"no-store" });
      if(!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      apply(data);
      save(data);
      setStatus("● 官方資料同步", "live");
    }catch(error){
      console.warn("ARINC data load failed", error);
      const cached = load();
      apply(cached || FALLBACK);
      setStatus(cached ? "● 暫存資料" : "● 備援資料", "stale");
    }
  }

  update();
  window.setInterval(update, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if(!document.hidden) update(); });
  window.addEventListener("focus", update);
})();
