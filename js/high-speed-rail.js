(function(){
  "use strict";
  const DATA_URL="data/hsr-stations.json";
  const API_URL="https://flightdeck-api.201505-login.workers.dev/api/hsr";
  const STORAGE_KEY="crewportal-hsr-station";
  const $=id=>document.getElementById(id);
  const els={
    select:$('hsrStationSelect'),updated:$('hsrUpdatedTime'),status:$('hsrStatus'),
    north:$('hsrNorthboundList'),south:$('hsrSouthboundList'),details:$('hsrStopDetails')
  };
  if(!els.select)return;

  let stations=[];
  let refreshPromise=null;
  let requestController=null;
  let refreshSerial=0;
  let currentData=null;

  function taipeiParts(date=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(date);
    return Object.fromEntries(parts.map(part=>[part.type,part.value]));
  }
  function setUpdated(value){
    const date=value?new Date(value):new Date();
    if(Number.isNaN(date.getTime())){els.updated.textContent='—';return}
    const parts=taipeiParts(date);els.updated.textContent=`${parts.hour}:${parts.minute}`;
  }
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function stationName(code){return stations.find(station=>station.code===String(code))?.zh||String(code||'');}
  function trainDestination(train){return train.destinationName||stationName(train.destinationStationId)||'—';}
  function renderEmpty(list,message='—'){list.innerHTML=`<div class="hsr-empty">${escapeHtml(message)}</div>`;}
  function renderTrainList(list,trains,direction){
    if(!Array.isArray(trains)||!trains.length){renderEmpty(list,'今日已無後續車班 · No more trains today');return}
    list.innerHTML=trains.slice(0,2).map((train,index)=>{
      const trainNo=String(train.trainNo||'—').padStart(4,'0');
      const stops=Array.isArray(train.stops)?train.stops.length:0;
      return `<button class="hsr-train-row" data-direction="${direction}" data-index="${index}" type="button">
        <span class="hsr-train-time">${escapeHtml(train.departureTime||'—')}</span>
        <span class="hsr-train-main"><b>車次 ${escapeHtml(trainNo)}</b><small>To ${escapeHtml(trainDestination(train))}</small></span>
        <span class="hsr-train-arrow" aria-hidden="true">›</span>
        <span class="hsr-train-stop-count">${stops} stops</span>
      </button>`;
    }).join('');
    list.querySelectorAll('.hsr-train-row').forEach(button=>button.addEventListener('click',()=>{
      const train=currentData?.trains?.[button.dataset.direction]?.[Number(button.dataset.index)];
      if(train)renderStops(train,button);
    }));
  }
  function renderStops(train,button){
    const trainNo=String(train.trainNo||'—').padStart(4,'0');
    if(els.details.dataset.train===`${trainNo}-${train.departureTime}`){els.details.hidden=true;delete els.details.dataset.train;button.classList.remove('is-selected');return}
    els.details.dataset.train=`${trainNo}-${train.departureTime}`;
    document.querySelectorAll('.hsr-train-row.is-selected').forEach(row=>row.classList.remove('is-selected'));
    button.classList.add('is-selected');
    const stops=Array.isArray(train.stops)?train.stops:[];
    els.details.innerHTML=`<div class="hsr-stop-head"><strong>車次 ${escapeHtml(trainNo)}</strong><span>${escapeHtml(train.departureTime||'—')} · ${escapeHtml(trainDestination(train))}</span><button aria-label="Close stop information" class="hsr-stop-close" type="button">×</button></div><div class="hsr-stop-list">${stops.map((stop,index)=>`<div class="hsr-stop-row"><span class="hsr-stop-index">${index+1}</span><span class="hsr-stop-name"><b>${escapeHtml(stop.stationName||stationName(stop.stationId)||'—')}</b><small>${escapeHtml(stop.stationNameEn||'')}</small></span><strong>${escapeHtml(stop.departureTime||stop.arrivalTime||'—')}</strong></div>`).join('')}</div>`;
    els.details.hidden=false;
    els.details.querySelector('.hsr-stop-close')?.addEventListener('click',()=>{els.details.hidden=true;delete els.details.dataset.train;button.classList.remove('is-selected')});
  }
  function renderUnavailable(message='Official timetable unavailable · 請稍後再試'){
    currentData=null;setUpdated();renderEmpty(els.north,message);renderEmpty(els.south,message);els.details.hidden=true;els.status.textContent=message;els.status.className='hsr-status hsr-status-unavailable';
  }
  function render(data){
    currentData=data;
    renderTrainList(els.north,data.trains?.northbound,'northbound');
    renderTrainList(els.south,data.trains?.southbound,'southbound');
    setUpdated(data.fetchedAt||data.updateTime);
    els.status.textContent='Official timetable · 高鐵官方資料';
    els.status.className='hsr-status hsr-status-live';
    els.details.hidden=true;delete els.details.dataset.train;
  }
  async function refresh(options={}){
    const station=stations.find(item=>item.code===els.select.value);
    if(!station)return;
    if(refreshPromise&&!options.restart)return refreshPromise;
    if(requestController)requestController.abort();
    const controller=new AbortController();requestController=controller;const serial=++refreshSerial;
    refreshPromise=(async()=>{
      try{
        const timeout=setTimeout(()=>controller.abort(),15000);
        const response=await fetch(`${API_URL}?station=${encodeURIComponent(station.code)}&t=${Math.floor(Date.now()/60000)}`,{cache:'no-store',signal:controller.signal});
        clearTimeout(timeout);
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||`HTTP ${response.status}`);
        if(serial!==refreshSerial||controller.signal.aborted)return;
        render(data);
      }catch(error){
        if(error.name==='AbortError'||serial!==refreshSerial)return;
        console.warn('Taiwan HSR timetable unavailable',error);renderUnavailable('Official timetable unavailable · 高鐵資料暫時無法取得');
      }finally{
        if(serial===refreshSerial){refreshPromise=null;if(requestController===controller)requestController=null;}
      }
    })();
    return refreshPromise;
  }
  function populate(data){
    stations=data.stations||[];
    els.select.innerHTML=stations.map(station=>`<option value="${escapeHtml(station.code)}">${escapeHtml(station.zh)} · ${escapeHtml(station.en)}</option>`).join('');
    let saved=data.defaultStation||'1020';try{saved=localStorage.getItem(STORAGE_KEY)||saved}catch(_e){}
    if(stations.some(station=>station.code===saved))els.select.value=saved;
    els.select.addEventListener('change',()=>{try{localStorage.setItem(STORAGE_KEY,els.select.value)}catch(_e){}refresh({restart:true})});
    refresh();
    setInterval(refresh,60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
    window.addEventListener('focus',refresh);
  }
  fetch(`${DATA_URL}?v=20260914-2109`,{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}).then(populate).catch(error=>{console.error('HSR station data load failed',error);renderUnavailable('Station data unavailable · 車站資料無法載入')});
})();
