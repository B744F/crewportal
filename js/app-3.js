(function(){
  const VERSION = "6.4.1";
  const RAW_ARINC = "https://raw.githubusercontent.com/B744F/crewportal/main/data/arinc.json";
  const LOCAL_ARINC = "data/arinc.json";
  const REFRESH_MS = 15 * 60 * 1000;
  const STORAGE_KEY = "crewportal-arinc-last-good-v2";

  const els = {
    validFrom: document.getElementById("arincValidFrom"),
    naPrimary: document.getElementById("arincNorthAmericaPrimary"),
    naSecondary: document.getElementById("arincNorthAmericaSecondary"),
    alaskaPrimary: document.getElementById("arincAlaskaPrimary"),
    alaskaSecondary: document.getElementById("arincAlaskaSecondary"),
    status: document.getElementById("arincStatus")
  };

  function setStatus(text,state,title){
    if(!els.status) return;
    els.status.textContent=text;
    els.status.classList.remove("syncing","stale","offline","live");
    if(state) els.status.classList.add(state);
    els.status.title=title||"";
  }
  function setText(el,value,frequency){
    if(!el) return;
    const text=value===null||value===undefined||value===""?"--":String(value);
    if(el.textContent!==text){el.classList.add("arinc-pulse");setTimeout(()=>el.classList.remove("arinc-pulse"),650);}
    el.textContent=text;
    if(frequency) el.dataset.empty=text==="--"?"true":"false";
  }
  function validDate(data){const d=new Date(data?.validFromUtc||0);return Number.isNaN(d.getTime())?new Date(0):d;}
  function formatValidTime(data){
    const date=validDate(data);
    if(!date.getTime()) return data?.validFrom||"--";
    const fmt=(timeZone)=>new Intl.DateTimeFormat("zh-TW",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date);
    return `${fmt("UTC")} UTC｜台灣 ${fmt("Asia/Taipei")}`;
  }
  function apply(data){
    setText(els.validFrom,formatValidTime(data),false);
    setText(els.naPrimary,data?.northAmericaAsia?.primary,true);
    setText(els.naSecondary,data?.northAmericaAsia?.secondary,true);
    setText(els.alaskaPrimary,data?.alaskaNorthPacific?.primary,true);
    setText(els.alaskaSecondary,data?.alaskaNorthPacific?.secondary,true);
  }
  function save(data){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(_e){}}
  function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");}catch(_e){return null;}}
  async function fetchJson(url){
    const join=url.includes("?")?"&":"?";
    const response=await fetch(url+join+"v="+Date.now(),{cache:"no-store",headers:{"Accept":"application/json"}});
    if(!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }
  async function update(){
    setStatus("● 正在同步","syncing");
    const settled=await Promise.allSettled([fetchJson(RAW_ARINC),fetchJson(LOCAL_ARINC)]);
    const available=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
    if(available.length){
      const newest=available.sort((a,b)=>validDate(b)-validDate(a))[0];
      apply(newest); save(newest);
      const fetched=new Date(newest.fetchedAtUtc||0);
      const age=Number.isNaN(fetched.getTime())?Infinity:(Date.now()-fetched.getTime())/3600000;
      const fromRaw=settled[0].status==="fulfilled" && newest===settled[0].value;
      const diagnostics=(newest.diagnostics||[]).map(x=>`${x.route}: ${x.validFrom}`).join("\n");
      const title=[`資料來源：${fromRaw?"GitHub 儲存庫即時檔":"網站備援檔"}`,newest.fetchedAtUtc?`最後檢查：${newest.fetchedAtUtc}`:"",diagnostics].filter(Boolean).join("\n");
      setStatus(age>2.5?"● 排程可能延遲":(fromRaw?"● GitHub 即時同步":"● 網站檔案同步"),age>2.5?"stale":"live",title);
      return;
    }
    const cached=load();
    if(cached){apply(cached);setStatus("● 瀏覽器暫存","stale","無法連線至 GitHub 與網站資料檔");}
    else setStatus("● 無法取得資料","offline","請檢查網路或 GitHub Actions");
  }
  async function updateFooterVersion(){
    const versionEl=document.getElementById("footerVersion"),buildEl=document.getElementById("footerBuild");
    if(versionEl) versionEl.textContent=`Version v${VERSION}`;
    try{
      const meta=await fetchJson("data/version.json");
      if(versionEl&&meta.version) versionEl.textContent=`Version v${meta.version}`;
      if(buildEl&&meta.build) buildEl.textContent=`Build ${meta.build}`;
    }catch(error){console.warn("Version metadata load failed",error);}
  }
  function scheduleQuarterHourUpdate(){
    const now=new Date();
    const next=new Date(now);
    next.setUTCSeconds(5,0);
    const minute=now.getUTCMinutes();
    const nextQuarter=(Math.floor(minute/15)+1)*15;
    if(nextQuarter>=60){
      next.setUTCHours(now.getUTCHours()+1,0,5,0);
    }else{
      next.setUTCMinutes(nextQuarter,5,0);
    }
    const delay=Math.max(1000,next.getTime()-now.getTime());
    setTimeout(()=>{
      update();
      setInterval(update,REFRESH_MS);
    },delay);
  }
  updateFooterVersion(); update();
  scheduleQuarterHourUpdate();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)update();});
  addEventListener("focus",update);
})();
