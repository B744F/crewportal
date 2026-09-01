(function(){
  "use strict";

  const dialog=document.getElementById("panelHelpDialog");
  const title=document.getElementById("panelHelpTitle");
  const body=document.getElementById("panelHelpDescription");
  const closeButton=dialog?.querySelector(".panel-help-close");
  if(!dialog||!title||!body||!closeButton)return;

  const panels={
    atis:{
      title:"Airport ATIS｜機場自動情報服務",
      purpose:"查詢指定機場最新的 ATIS 廣播，例如跑道、風向風速、能見度與 QNH 等資訊。",
      steps:[
        "在 ICAO 欄輸入 4 碼機場代碼，例如 RCTP（桃園）或 RJTT（東京羽田）。",
        "按下 OPEN ATIS，即可開啟該機場的 ATIS 頁面。"
      ],
      note:"請以當地官方或公司發布的最新資料為準。"
    },
    parking:{
      title:"Parking Information｜停車資訊",
      purpose:"出勤或前往機場前，快速查看華航園區與桃園機場停車區的剩餘車位。",
      steps:[
        "BOT、RD1A、RD1B、TSA 是華航園區的停車區；P1、P2、P3、P4 是桃園機場停車區。",
        "各區數字代表目前可用車位，更新時間與資料年齡會顯示在卡片內。",
        "需要查看完整停車配置時，按右側的查看 ↗ 開啟停車頁面。"
      ],
      note:"顯示「尚未提供」不代表已滿位，請按查看 ↗ 以官方頁面為準。"
    },
    mrt:{
      title:"Airport MRT｜桃園機場捷運",
      purpose:"查詢指定車站往台北或往中壢的下一班普通車與直達車。",
      steps:[
        "在 Station 車站下拉選單選擇要查詢的車站。",
        "查看 To Taipei（往台北）或 To Zhongli（往中壢）的時間。",
        "Commuter 是普通車；Express 是直達車。需要完整時刻表時，按 Official timetable ↗。"
      ],
      note:"班次時間依官方時刻表或即時資料顯示，請預留轉乘與步行時間。"
    },
    hf:{
      title:"Pacific HF｜太平洋 HF 頻率",
      purpose:"查閱太平洋航路不同區域的 HF 通訊頻率，以及延伸距離與地面使用的 VHF 頻率。",
      steps:[
        "先依航段位置辨識適用區域，例如 North America → Asia、Alaska / North Pacific 或 Guam Area。",
        "PRIMARY 是主要頻率；SECONDARY 是備用頻率，實際選用請依公司程序與航段狀況。",
        "下方 VHF 區列出 Extended Range 與各地 On-ground 頻率。"
      ],
      note:"本區供快速查閱；實際通訊請依公司程序、航路資料與當日官方資料。"
    }
  };

  let lastTrigger=null;

  function renderPanel(panel){
    title.textContent=panel.title;
    body.replaceChildren();

    const purpose=document.createElement("p");
    purpose.className="panel-help-purpose";
    purpose.textContent=panel.purpose;
    body.appendChild(purpose);

    const stepsTitle=document.createElement("h3");
    stepsTitle.textContent="使用方式 / Steps";
    body.appendChild(stepsTitle);

    const steps=document.createElement("ol");
    steps.className="panel-help-steps";
    panel.steps.forEach(step=>{
      const item=document.createElement("li");
      item.textContent=step;
      steps.appendChild(item);
    });
    body.appendChild(steps);

    const note=document.createElement("p");
    note.className="panel-help-note";
    note.textContent=panel.note;
    body.appendChild(note);
  }

  document.querySelectorAll("[data-help-panel]").forEach(trigger=>{
    trigger.addEventListener("click",()=>{
      const panel=panels[trigger.dataset.helpPanel];
      if(!panel)return;
      lastTrigger=trigger;
      renderPanel(panel);
      if(typeof dialog.showModal==="function")dialog.showModal();
      else dialog.setAttribute("open","");
      closeButton.focus();
    });
  });

  closeButton.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{
    if(event.target===dialog)dialog.close();
  });
  dialog.addEventListener("close",()=>{
    if(lastTrigger)lastTrigger.focus();
  });
}());
