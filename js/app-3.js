(function(){
  const VERSION="6.5.1";
  const RAW_ARINC="https://raw.githubusercontent.com/B744F/crewportal/main/data/arinc.json";
  const LOCAL_ARINC="data/arinc.json";
  const REFRESH_MS=15*60*1000;
  const STORAGE_KEY="crewportal-arinc-last-good-v4";

  const els={
    validFrom:document.getElementById("arincValidFrom"),
    naPrimary:document.getElementById("arincNorthAmericaPrimary"),
    naSecondary:document.getElementById("arincNorthAmericaSecondary"),
    alaskaPrimary:document.getElementById("arincAlaskaPrimary"),
    alaskaSecondary:document.getElementById("arincAlaskaSecondary"),
    guamPrimary:document.getElementById("arincGuamPrimary"),
    guamSecondary:document.getElementById("arincGuamSecondary"),
    status:document.getElementById("arincStatus")
  };

  function setStatus(text,state,title){
    if(!els.status)return;
    els.status.textContent=text;
    els.status.classList.remove("syncing","stale","offline","live");
    if(state)els.status.classList.add(state);
    els.status.title=title||"";
  }

  function setText(el,value,frequency){
    if(!el)return;
    const text=value===null||value===undefined||value===""?"--":String(value);
    if(el.textContent!==text){
      el.classList.add("arinc-pulse");
      setTimeout(()=>el.classList.remove("arinc-pulse"),650);
    }
    el.textContent=text;
    if(frequency)el.dataset.empty=text==="--"?"true":"false";
  }

  function dateOrNull(value){
    const d=new Date(value||0);
    return Number.isNaN(d.getTime())||!d.getTime()?null:d;
  }

  function fmt(date,timeZone){
    return new Intl.DateTimeFormat("zh-TW",{
      timeZone,year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",hour12:false
    }).format(date);
  }

  function formatMeta(data){
    const valid=dateOrNull(data?.validFromUtc);
    const fetched=dateOrNull(data?.fetchedAtUtc);
    const parts=[];
    if(valid)parts.push(`生效 ${fmt(valid,"UTC")} UTC`);
    else if(data?.validFrom)parts.push(`生效 ${data.validFrom}`);
    else parts.push("生效時間 --");
    if(fetched)parts.push(`檢查 ${fmt(fetched,"Asia/Taipei")} 台灣`);
    return parts.join("｜");
  }

  function freshness(data){
    return dateOrNull(data?.fetchedAtUtc)||dateOrNull(data?.validFromUtc)||new Date(0);
  }

  function apply(data){
    setText(els.validFrom,formatMeta(data),false);
    setText(els.naPrimary,data?.northAmericaAsia?.primary,true);
    setText(els.naSecondary,data?.northAmericaAsia?.secondary,true);
    setText(els.alaskaPrimary,data?.alaskaNorthPacific?.primary,true);
    setText(els.alaskaSecondary,data?.alaskaNorthPacific?.secondary,true);
    setText(els.guamPrimary,data?.guamArea?.primary,true);
    setText(els.guamSecondary,data?.guamArea?.secondary,true);
  }

  function save(data){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(_e){}}
  function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");}catch(_e){return null;}}

  async function fetchJson(url){
    const join=url.includes("?")?"&":"?";
    const response=await fetch(url+join+"v="+Date.now(),{cache:"no-store",headers:{"Accept":"application/json"}});
    if(!response.ok)throw new Error(`${response.status} ${url}`);
    return response.json();
  }

  async function update(){
    setStatus("● 正在同步","syncing");
    const settled=await Promise.allSettled([fetchJson(RAW_ARINC),fetchJson(LOCAL_ARINC)]);
    const available=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);

    if(available.length){
      const newest=available.sort((a,b)=>freshness(b)-freshness(a))[0];
      apply(newest);
      save(newest);

      const fetched=dateOrNull(newest.fetchedAtUtc);
      const age=fetched?(Date.now()-fetched.getTime())/3600000:Infinity;
      const fromRaw=settled[0].status==="fulfilled"&&newest===settled[0].value;

      setStatus(
        age>2.5?"● 排程可能延遲":(fromRaw?"● GitHub 即時同步":"● 網站檔案同步"),
        age>2.5?"stale":"live",
        `${formatMeta(newest)}｜前端 v${VERSION}`
      );
      return;
    }

    const cached=load();
    if(cached){
      apply(cached);
      setStatus("● 瀏覽器暫存","stale","無法連線至 GitHub 與網站資料檔");
    }else{
      setStatus("● 無法取得資料","offline","請檢查網路或 GitHub Actions");
    }
  }

  update();
  setInterval(update,REFRESH_MS);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)update();});
  addEventListener("focus",update);
})();