(function(){
  const VISIT_API="https://flightdeck-api.201505-login.workers.dev/api/visit";
  const body=new Blob([""],{type:"text/plain"});
  try{
    if(navigator.sendBeacon&&navigator.sendBeacon(VISIT_API,body))return;
  }catch(_e){}
  fetch(VISIT_API,{method:"POST",body:"",keepalive:true,mode:"cors"}).catch(()=>{});
})();
