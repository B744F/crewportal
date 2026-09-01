(function(){
  "use strict";

  const dialog=document.getElementById("panelHelpDialog");
  const title=document.getElementById("panelHelpTitle");
  const body=document.getElementById("panelHelpDescription");
  const closeButton=dialog?.querySelector(".panel-help-close");
  if(!dialog||!title||!body||!closeButton)return;

  const panels={
    atis:{
      title:"Airport Operations｜機場作業工具",
      sections:[
        {
          heading:"AIRPORT ATIS｜機場自動情報服務",
          purpose:"查詢指定機場最新的 ATIS 廣播，例如跑道、風向風速、能見度與 QNH 等資訊。",
          purposeEn:"View the latest ATIS broadcast for a selected airport, including runway, wind, visibility and QNH information.",
          steps:[
            "在 ICAO 欄輸入 4 碼機場代碼，例如 RCTP（桃園）或 RJTT（東京羽田）。",
            "按下 OPEN ATIS，即可開啟該機場的 ATIS 頁面。"
          ],
          stepsEn:[
            "Enter a 4-letter ICAO airport code, such as RCTP (Taoyuan) or RJTT (Tokyo Haneda).",
            "Select OPEN ATIS to open the ATIS page for that airport."
          ]
        },
        {
          heading:"AIRCRAFT TRACKING｜航機追蹤",
          purpose:"使用航班號或航空器註冊號，在 FlightRadar24 開啟航機追蹤頁面。",
          purposeEn:"Open a FlightRadar24 tracking page using a flight number or aircraft registration number.",
          steps:[
            "輸入 Call Sign 或航空器註冊號，例如 CI100 或 B-18725。",
            "按下 TRACK，即可開啟對應的航機或航班頁面。"
          ],
          stepsEn:[
            "Enter a call sign or aircraft registration number, such as CI100 or B-18725.",
            "Select TRACK to open the corresponding aircraft or flight page."
          ]
        },
        {
          heading:"GATE INFO｜登機門資訊",
          purpose:"查詢指定機場今日航班的登機門、航廈或貨機坪資訊。",
          purposeEn:"Check today's gate, terminal or cargo stand information for a selected airport.",
          steps:[
            "先選擇機場，再輸入 Callsign + Flight No.，例如 CI100 或 5X61。",
            "華航的班機僅輸入班號即可查詢。",
            "按下 GATE，查看抵達／出發方向、航廈、登機門或貨機坪，以及資料更新時間。"
          ],
          stepsEn:[
            "Select an airport, then enter Callsign + Flight No., such as CI100 or 5X61.",
            "For China Airlines flights, enter the flight number only.",
            "Select GATE to view arrival/departure direction, terminal, gate or cargo stand, and the data update time."
          ]
        }
      ],
      note:"資料由外部或官方來源提供；實際飛航與作業判斷請以公司程序及最新正式資料為準。"
    },
    mrt:{
      title:"Airport MRT｜桃園機場捷運",
      sections:[{
        heading:"AIRPORT MRT｜桃園機場捷運",
        purpose:"查詢指定車站往台北或往中壢的下一班普通車與直達車。",
        purposeEn:"Find the next Commuter and Express trains from a selected station toward Taipei or Zhongli.",
        steps:[
          "在 Station 車站下拉選單選擇要查詢的車站。",
          "查看 To Taipei（往台北）或 To Zhongli（往中壢）的時間。",
          "Commuter 是普通車；Express 是直達車。需要完整時刻表時，按 Official timetable ↗。"
        ],
        stepsEn:[
          "Choose a station from the Station dropdown menu.",
          "Check the times for To Taipei or To Zhongli.",
          "Commuter means the regular train; Express means the express train. Select Official timetable ↗ for the full schedule."
        ]
      }],
      note:"班次時間依官方時刻表或即時資料顯示，請預留轉乘與步行時間。"
    }
  };

  let lastTrigger=null;

  function renderPanel(panel){
    title.textContent=panel.title;
    body.replaceChildren();

    panel.sections.forEach(section=>{
      const sectionTitle=document.createElement("h3");
      sectionTitle.className="panel-help-section-title";
      sectionTitle.textContent=section.heading;
      body.appendChild(sectionTitle);

      const purpose=document.createElement("p");
      purpose.className="panel-help-purpose";
      purpose.textContent=section.purpose;
      body.appendChild(purpose);

      const purposeEn=document.createElement("p");
      purposeEn.className="panel-help-en";
      purposeEn.textContent=section.purposeEn;
      body.appendChild(purposeEn);

      const steps=document.createElement("ol");
      steps.className="panel-help-steps";
      section.steps.forEach((step,index)=>{
        const item=document.createElement("li");
        const zh=document.createElement("span");
        zh.textContent=step;
        item.appendChild(zh);
        const en=document.createElement("span");
        en.className="panel-help-en";
        en.textContent=section.stepsEn[index];
        item.appendChild(en);
        steps.appendChild(item);
      });
      body.appendChild(steps);
    });

    const note=document.createElement("p");
    note.className="panel-help-note";
    note.textContent=panel.note;
    body.appendChild(note);
  }

  document.addEventListener("click",event=>{
    const trigger=event.target.closest?.("[data-help-panel]");
    if(!trigger)return;
    const panel=panels[trigger.dataset.helpPanel];
    if(!panel)return;
    lastTrigger=trigger;
    renderPanel(panel);
    if(typeof dialog.showModal==="function")dialog.showModal();
    else dialog.setAttribute("open","");
    closeButton.focus();
  });

  closeButton.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{
    if(event.target===dialog)dialog.close();
  });
  dialog.addEventListener("close",()=>{
    if(lastTrigger)lastTrigger.focus();
  });
}());
