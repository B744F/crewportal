(function(){
  const VERSION="6.6.1";
  const OFFICIAL_PROXY="https://arinc-proxy.201505-login.workers.dev/";
  const RAW_ARINC="https://raw.githubusercontent.com/B744F/crewportal/main/data/arinc.json";
  const LOCAL_ARINC="data/arinc.json";
  const REFRESH_MS=5*60*1000;
  const STORAGE_KEY="crewportal-arinc-last-good-v5";

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

  function norm(value){
    return String(value||"").replace(/\s+/g," ").replace(/[→➡]/g," to ").replace(/->/g," to ").trim().toLowerCase();
  }

  function region(value){
    const text=norm(value);
    if(text.includes("north")&&text.includes("america")&&text.includes("asia"))return "northAmericaAsia";
    if(text.includes("alaska")&&text.includes("pacific"))return "alaskaNorthPacific";
    if(text.includes("guam"))return "guamArea";
    return null;
  }

  function validFrequency(value){
    const match=String(value||"").match(/\b(\d{4,5})\b/);
    if(!match)return null;
    const number=Number(match[1]);
    return number>=2000&&number<=22000?number:null;
  }

  function parseValidFrom(text){
    const match=String(text||"").match(/Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)/i);
    if(!match)return {raw:null,utc:null};
    const parts=match[1].match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{2})(\d{2})Z$/);
    if(!parts)return {raw:match[1],utc:null};
    const months={January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
    const timestamp=Date.UTC(Number(parts[3]),months[parts[1]],Number(parts[2]),Number(parts[4]),Number(parts[5]));
    return {raw:match[1],utc:Number.isFinite(timestamp)?new Date(timestamp).toISOString():null};
  }

  function parseOfficialHtml(html){
    const doc=new DOMParser().parseFromString(String(html||""),"text/html");
    const valid=parseValidFrom(doc.body?.textContent||"");
    const output={};
    for(const row of Array.from(doc.querySelectorAll("tr"))){
      const cells=Array.from(row.children)
        .filter(cell=>cell.tagName==="TH"||cell.tagName==="TD")
        .map(cell=>cell.textContent.replace(/\s+/g," ").trim());
      const key=region(cells.join(" | "));
      if(!key)continue;
      const values=[];
      for(const cell of cells){
        const number=validFrequency(cell);
        if(number!==null&&!values.includes(number))values.push(number);
      }
      if(values.length<2)continue;
      output[key]={primary:values[0],secondary:values[1]};
    }
    const required=["northAmericaAsia","alaskaNorthPacific","guamArea"];
    if(required.some(key=>!output[key]))throw new Error("官網資料缺少必要的 Pacific HF 區域");
    return {
      schemaVersion:14,
      source:"https://radio.arinc.net/pacific/",
      proxy:OFFICIAL_PROXY,
      route:"Official Pacific HF page via proxy",
      validFrom:valid.raw,
      validFromUtc:valid.utc,
      fetchedAtUtc:new Date().toISOString(),
      northAmericaAsia:output.northAmericaAsia,
      alaskaNorthPacific:output.alaskaNorthPacific,
      guamArea:output.guamArea
    };
  }

  function formatValidFrom(data){
    if(data?.validFrom)return String(data.validFrom).trim();
    const valid=dateOrNull(data?.validFromUtc);
    if(!valid)return "--";
    const parts=new Intl.DateTimeFormat("en-US",{
      timeZone:"UTC",year:"numeric",month:"long",day:"numeric",
      hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"
    }).formatToParts(valid);
    const get=type=>parts.find(part=>part.type===type)?.value||"";
    return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}${get("minute")}Z`;
  }

  function formatMeta(data){
    const fetched=dateOrNull(data?.fetchedAtUtc);
    const parts=[];
    parts.push(formatValidFrom(data));
    if(fetched){
      const hours=String(fetched.getUTCHours()).padStart(2,"0");
      const minutes=String(fetched.getUTCMinutes()).padStart(2,"0");
      parts.push(`Update ${hours}${minutes}Z`);
    }
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

  async function fetchOfficial(){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(OFFICIAL_PROXY+"?v="+Date.now(),{cache:"no-store",signal:controller.signal,headers:{"Accept":"text/html"}});
      if(!response.ok)throw new Error(`${response.status} ${OFFICIAL_PROXY}`);
      return parseOfficialHtml(await response.text());
    }finally{clearTimeout(timer)}
  }

  function publish(data,source){
    const detail={data,source};
    window.__crewportalArincLatest=detail;
    window.dispatchEvent(new CustomEvent("crewportal:arinc-updated",{detail}));
  }

  async function update(){
    setStatus("● 正在同步","syncing");
    const settled=await Promise.allSettled([
      fetchOfficial().then(data=>({data,source:"official"})),
      fetchJson(RAW_ARINC).then(data=>({data,source:"github"})),
      fetchJson(LOCAL_ARINC).then(data=>({data,source:"local"}))
    ]);
    const available=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);

    if(available.length){
      const newest=available.find(item=>item.source==="official")||available.sort((a,b)=>freshness(b.data)-freshness(a.data))[0];
      const data=newest.data;
      apply(data);
      save(data);
      publish(data,newest.source);

      const fetched=dateOrNull(data.fetchedAtUtc);
      const age=fetched?(Date.now()-fetched.getTime())/3600000:Infinity;
      const sourceText=newest.source==="official"?"● 官網即時同步":newest.source==="github"?"● GitHub 同步":"● 網站檔案同步";

      setStatus(
        age>2.5?"● 排程可能延遲":sourceText,
        age>2.5?"stale":"live",
        `${formatMeta(data)}｜來源：${newest.source}｜前端 v${VERSION}`
      );
      return;
    }

    const cached=load();
    if(cached){
      apply(cached);
      publish(cached,"cache");
      setStatus("● 瀏覽器暫存","stale","無法連線至官網代理、GitHub 與網站資料檔");
    }else{
      setStatus("● 無法取得資料","offline","請檢查網路或 GitHub Actions");
    }
  }

  update();
  setInterval(update,REFRESH_MS);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)update();});
  addEventListener("focus",update);
})();
