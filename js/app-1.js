
const input=document.getElementById('atisInput');
const form=document.getElementById('atisForm');
const statusEl=document.getElementById('atisStatus');
input.addEventListener('input',()=>{
  input.value=input.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
  statusEl.style.display='none';
});
form.addEventListener('submit',(e)=>{
  e.preventDefault();
  const code=input.value.trim().toUpperCase();
  if(!/^[A-Z]{4}$/.test(code)){
    statusEl.textContent='請輸入四碼 ICAO 機場代碼';
    statusEl.style.display='block';
    input.focus();
    return;
  }
  window.open('https://atis.guru/atis/'+encodeURIComponent(code),'_blank','noopener,noreferrer');
});
function pad(n){return String(n).padStart(2,'0')}
function updateTime(){
  const now=new Date();
  document.getElementById('localTime').textContent=pad(now.getHours())+':'+pad(now.getMinutes());
  document.getElementById('utcTime').textContent=pad(now.getUTCHours())+':'+pad(now.getUTCMinutes());
}
updateTime();setInterval(updateTime,30000);
