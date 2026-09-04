(function(){
  const input=document.getElementById('atisInput');
  const form=document.getElementById('atisForm');
  const statusEl=document.getElementById('atisStatus');
  const ATIS_API='https://flightdeck-api.201505-login.workers.dev/api/atis';
  const STALE_AFTER_MINUTES=90;

  function isAmericanAirport(code){
    return code.startsWith('K') || /^(PA|PF|PH|PG|PO|PP|PW)/.test(code) || ['TJSJ','TIST','TISX'].includes(code);
  }

  function sourceFor(code){
    if(isAmericanAirport(code))return {label:'ATIS.info · FAA Digital ATIS',url:`https://atis.info/${code}`};
    if(code==='RCTP'||code==='RJAA')return {label:'CoffeeTeaOrMe · ACARS D-ATIS',url:`https://info.coffeeteaorme.vip/Public-D-ATIS/${code}`};
    return {label:'ATIS.guru · Live digital ATIS',url:`https://atis.guru/atis/${code}`};
  }

  function setStatus(text,state){
    statusEl.textContent=text;
    statusEl.dataset.state=state||'';
    statusEl.style.display='block';
  }

  function formatTime(value){
    const date=value?new Date(value):null;
    if(!date||Number.isNaN(date.getTime()))return '--';
    const p=value=>String(value).padStart(2,'0');
    return `${date.getUTCFullYear()}-${p(date.getUTCMonth()+1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}Z`;
  }

  function openSource(url){
    const popup=window.open('about:blank','_blank');
    if(popup){
      try{popup.opener=null;popup.location.href=url;return true}catch(_error){}
    }
    return Boolean(window.open(url,'_blank','noopener,noreferrer'));
  }

  async function checkFreshness(code){
    const response=await fetch(`${ATIS_API}?airport=${encodeURIComponent(code)}&t=${Date.now()}`,{cache:'no-store',headers:{Accept:'application/json'}});
    let data=null;
    try{data=await response.json()}catch(_error){data={}}
    if(!response.ok||!data.ok)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }

  function renderFreshness(data,fallback){
    const source=data.source||fallback.label;
    const time=formatTime(data.dataTime);
    if(data.status==='stale'||data.stale){
      setStatus(`來源：${source}｜資料時間：${time}｜Stale／過期（超過 ${STALE_AFTER_MINUTES} 分鐘，不可視為目前有效 ATIS）`,'stale');
      return;
    }
    if(data.status==='fresh'){
      setStatus(`來源：${source}｜資料時間：${time}｜Fresh／新鮮度正常`,'fresh');
      return;
    }
    setStatus(`來源：${source}｜資料時間：${time}｜Unavailable／目前沒有可確認的 ATIS`,'unavailable');
  }

  input.addEventListener('input',()=>{
    input.value=input.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
    statusEl.style.display='none';
  });

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const code=input.value.trim().toUpperCase();
    if(!/^[A-Z]{4}$/.test(code)){
      setStatus('請輸入四碼 ICAO 機場代碼','error');
      input.focus();
      return;
    }
    const fallback=sourceFor(code);
    const opened=openSource(fallback.url);
    if(!opened)setStatus(`來源：${fallback.label}｜瀏覽器阻擋新分頁，請允許開啟來源頁面`,'error');
    else setStatus(`正在檢查 ${code} 的資料時間…`,'checking');
    try{
      const data=await checkFreshness(code);
      renderFreshness(data,fallback);
    }catch(error){
      setStatus(`來源：${fallback.label}｜無法確認資料新鮮度，未將資料視為目前有效 ATIS`,'unavailable');
      console.warn('D-ATIS freshness check failed',error);
    }
  });

  function pad(n){return String(n).padStart(2,'0')}
  function updateTime(){
    const now=new Date();
    const localTime=document.getElementById('localTime');
    const utcTime=document.getElementById('utcTime');
    if(localTime)localTime.textContent=pad(now.getHours())+':'+pad(now.getMinutes());
    if(utcTime)utcTime.textContent=pad(now.getUTCHours())+':'+pad(now.getUTCMinutes());
  }
  updateTime();setInterval(updateTime,30000);
})();
