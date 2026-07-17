(function(){
  // GitHub Pages is static hosting. ARINC data is refreshed by GitHub Actions,
  // which commits data/arinc.json at UTC minute 05 every hour.
  const ARINC_JSON = "data/arinc.json";
  const REFRESH_MS = 5 * 60 * 1000;
  const STORAGE_KEY = "crewportal-arinc-last-good";
  const FALLBACK = {
    validFrom: "July 16, 2026, 2215Z",
    validFromUtc: "2026-07-16T22:15:00Z",
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

  function formatValidTime(data){
    const iso = data?.validFromUtc;
    if(!iso) return data?.validFrom || "--";
    const date = new Date(iso);
    if(Number.isNaN(date.getTime())) return data?.validFrom || "--";
    const utc = new Intl.DateTimeFormat("zh-TW", {
      timeZone:"UTC", year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", hour12:false
    }).format(date);
    const taipei = new Intl.DateTimeFormat("zh-TW", {
      timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", hour12:false
    }).format(date);
    return `${utc} UTC｜台灣 ${taipei}`;
  }

  function normalize(data){
    return {
      validFrom: formatValidTime(data),
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
      const fetched = data.fetchedAtUtc ? new Date(data.fetchedAtUtc) : null;
      const ageHours = fetched && !Number.isNaN(fetched.getTime()) ? (Date.now() - fetched.getTime()) / 3600000 : null;
      if(ageHours !== null && ageHours > 3){
        setStatus("● 排程資料逾期", "stale");
      }else{
        setStatus("● GitHub 排程同步", "live");
      }
      if(els.status && data.fetchedAtUtc) els.status.title = `最後抓取：${data.fetchedAtUtc}`;
    }catch(error){
      console.warn("ARINC data load failed", error);
      const cached = load();
      apply(cached || FALLBACK);
      setStatus(cached ? "● 暫存資料" : "● 備援資料", "stale");
    }
  }

  async function updateFooterVersion(){
    const versionEl = document.getElementById("footerVersion");
    const buildEl = document.getElementById("footerBuild");
    if(!versionEl && !buildEl) return;
    try{
      const response = await fetch("data/version.json?t=" + Date.now(), { cache:"no-store" });
      if(!response.ok) throw new Error("HTTP " + response.status);
      const meta = await response.json();
      if(versionEl && meta.version) versionEl.textContent = `Version v${meta.version}`;
      if(buildEl && meta.build) buildEl.textContent = `Build ${meta.build}`;
    }catch(error){
      console.warn("Version metadata load failed", error);
    }
  }

  updateFooterVersion();
  update();
  window.setInterval(update, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if(!document.hidden) update(); });
  window.addEventListener("focus", update);
})();
