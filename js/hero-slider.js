(function(){
  const stage=document.getElementById("heroStage");
  if(!stage)return;

  const slides=[
    "images/hero.webp?v=20260808-2004",
    "images/hero-a330-300.webp?v=20260808-2004",
    "images/hero-b737-800.webp?v=20260808-2004",
    "images/hero-b777-300er.webp?v=20260808-2004",
    "images/hero-b787-10.webp?v=20260808-2004",
    "images/hero-a321neo.webp?v=20260808-2004",
    "images/hero-a350-1000.webp?v=20260808-2004"
  ];
  const intervalMs=10_000;
  const fadeMs=2_200;
  let activeIndex=0;
  let activeSlide=stage.querySelector(".hero-slide.is-active");
  let nextImage=null;
  let timer=null;

  function preload(index){
    const image=new Image();
    image.decoding="async";
    image.src=slides[index];
    nextImage={index,image};
  }

  function schedule(){
    window.clearTimeout(timer);
    timer=window.setTimeout(showNext,intervalMs);
  }

  function showNext(){
    const nextIndex=(activeIndex+1)%slides.length;
    const ready=nextImage&&nextImage.index===nextIndex&&nextImage.image.complete&&nextImage.image.naturalWidth>0;
    if(!ready){
      if(!nextImage||nextImage.index!==nextIndex)preload(nextIndex);
      window.setTimeout(showNext,250);
      return;
    }

    const nextSlide=nextImage.image;
    nextSlide.className="hero-slide";
    nextSlide.alt="";
    nextSlide.setAttribute("aria-hidden","true");
    stage.appendChild(nextSlide);
    void nextSlide.offsetWidth;
    nextSlide.classList.add("is-active");
    activeSlide.classList.remove("is-active");
    const previousSlide=activeSlide;
    activeSlide=nextSlide;
    activeIndex=nextIndex;
    window.setTimeout(()=>previousSlide.remove(),fadeMs+100);
    preload((activeIndex+1)%slides.length);
    schedule();
  }

  preload(1);
  schedule();
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden){
      window.clearTimeout(timer);
      return;
    }
    schedule();
  });
})();
