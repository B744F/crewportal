(function(){
  const API_URL="https://flightdeck-api.201505-login.workers.dev/api/visitor-stats";
  const $=id=>document.getElementById(id);
  const numberFormat=new Intl.NumberFormat("zh-TW");

  function flagFor(code){
    const normalized=String(code||"").trim().toUpperCase();
    if(!/^[A-Z]{2}$/.test(normalized))return"🌐";
    return String.fromCodePoint(...[...normalized].map(letter=>127397+letter.charCodeAt(0)));
  }
  function nameFor(code){
    const normalized=String(code||"").trim().toUpperCase();
    if(normalized==="UN")return"未知／未辨識";
    try{return new Intl.DisplayNames(["zh-TW"],{type:"region"}).of(normalized)||normalized}catch(_e){return normalized}
  }
  function timeFor(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return"--";
    return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date);
  }
  function showStatus(message,level){
    const status=$("visitorStatsStatus");
    if(!status)return;
    status.textContent=message;
    status.className=`visitor-stats-status ${level||""}`;
  }
  function render(data){
    const countries=Array.isArray(data.countries)?data.countries:[];
    $("totalVisits").textContent=numberFormat.format(Number(data.totalVisits)||0);
    $("countryCount").textContent=numberFormat.format(countries.length);
    const tbody=$("visitorStatsBody");
    tbody.textContent="";
    if(!countries.length){
      const row=document.createElement("tr"),cell=document.createElement("td");
      cell.colSpan=4;cell.className="visitor-empty";cell.textContent="目前尚無統計資料。";row.appendChild(cell);tbody.appendChild(row);return;
    }
    countries.forEach(country=>{
      const code=String(country.countryCode||"UN").toUpperCase();
      const row=document.createElement("tr");
      const nameCell=document.createElement("td");nameCell.className="visitor-country";
      const flag=document.createElement("span");flag.className="visitor-flag";flag.setAttribute("aria-hidden","true");flag.textContent=flagFor(code);
      const name=document.createElement("span");name.textContent=nameFor(code);
      nameCell.append(flag,name);
      const codeCell=document.createElement("td");codeCell.textContent=code;
      const countCell=document.createElement("td");countCell.className="visitor-count";countCell.textContent=numberFormat.format(Number(country.visitCount)||0);
      const timeCell=document.createElement("td");timeCell.textContent=timeFor(country.lastSeenAt);
      row.append(nameCell,codeCell,countCell,timeCell);tbody.appendChild(row);
    });
  }
  async function load(){
    showStatus("正在載入統計資料…");
    try{
      const response=await fetch(`${API_URL}?v=${Date.now()}`,{cache:"no-store"});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(!data.ok)throw new Error(data.error||"Statistics unavailable");
      render(data);showStatus(`最後更新：${timeFor(data.generatedAt)}（臺北時間）`,"is-ready");
    }catch(error){
      $("totalVisits").textContent="--";$("countryCount").textContent="--";
      showStatus(`目前無法取得統計資料：${error.message||"請稍後再試"}`,"is-error");
    }
  }
  load();
})();
