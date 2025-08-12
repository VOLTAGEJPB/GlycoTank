(function(){
  function isAndroidApp(){
    try{ if (window.Capacitor && typeof Capacitor.getPlatform==="function"){ return Capacitor.getPlatform()==="android"; } }catch(e){}
    var ua = navigator.userAgent||""; return /Android/i.test(ua) && /wv/.test(ua);
  }
  var KEY="glycotank_onboard_seen_app";

  function slides(){ return Array.prototype.slice.call(document.querySelectorAll("#onboardOverlay .onSlide")); }
  function activeIndex(){ var s=slides(); for(var i=0;i<s.length;i++){ if(s[i].classList.contains("active")) return i; } return 0; }
  function setStep(n){
    var s=slides(); if(!s.length) return; var max=s.length-1; if(n<0) n=0; if(n>max) n=max;
    for(var i=0;i<s.length;i++){ s[i].classList.toggle("active", i===n); }
    var back=document.getElementById("onBack"); if(back) back.disabled=(n===0);
    var next=document.getElementById("onNext"); if(next) next.textContent=(n===max)?"Let's go":"Next";
    var dots=document.getElementById("onDots"); if(dots){ dots.innerHTML=""; for(var k=0;k<s.length;k++){ var d=document.createElement("div"); d.className="dot"+(k===n?" active":""); dots.appendChild(d);} }
  }
  function closeIntro(){
    var ov=document.getElementById("onboardOverlay"); if(!ov) return;
    ov.setAttribute("hidden",""); ov.setAttribute("aria-hidden","true"); ov.style.pointerEvents="none"; document.body.style.overflow="";
    try{ localStorage.setItem(KEY,"1"); }catch(e){}
  }
  function step(dir){
    var s=slides(); if(!s.length){ closeIntro(); return; }
    var i=activeIndex(); var max=s.length-1;
    if(dir>0){ if(i<max) setStep(i+1); else closeIntro(); } else { setStep(i-1); }
  }
  function hideStrayIntro(){
    try{
      var stray = document.querySelectorAll(".onSlides, .onSlide");
      for(var i=0;i<stray.length;i++){
        var el=stray[i];
        var insideOverlay=false, p=el;
        while(p){ if(p.id==="onboardOverlay"){ insideOverlay=true; break; } p=p.parentElement; }
        if(!insideOverlay){ el.style.display="none"; }
      }
    }catch(e){}
  }
  function ensureMarkup(){
    if(document.getElementById("onboardOverlay")) return;
    var ov=document.createElement("div");
    ov.id="onboardOverlay"; ov.className="onboard-overlay"; ov.setAttribute("hidden",""); ov.setAttribute("aria-hidden","true");
    ov.innerHTML =
      '<div class="onboard" role="dialog" aria-labelledby="onTitle" aria-modal="true">'+
        '<button class="onX" id="onClose" aria-label="Close">x</button>'+
        '<h2 class="onTitle" id="onTitle">GlycoTank 101</h2>'+
        '<div class="onSlides">'+
          '<div class="onSlide active" data-i="0"><div class="onBody">'+
            '<p><strong>What is Glyco?</strong> Your estimated glycogen fuel tank (grams).</p>'+
            '<ul>'+
              '<li>Meals add: carbs × uptake% (e.g., 80 g × 85% → +68 g)</li>'+
              '<li>Workouts subtract: hard sets × set-cost; cardio mins × g/min × intensity</li>'+
              '<li>Low tank → easier day or add carbs. High tank → you are ready to push.</li>'+
            '</ul>'+
          '</div></div>'+
          '<div class="onSlide" data-i="1"><div class="onBody">'+
            '<p><strong>How to use it</strong></p>'+
            '<ul>'+
              '<li>Log meals to fill Protein/Fiber bars and raise Glyco.</li>'+
              '<li>Log sets/cardio to deplete Glyco with realistic costs.</li>'+
              '<li>Planner: enter tomorrow\'s sets/mins for a smart carb budget.</li>'+
            '</ul>'+
          '</div></div>'+
          '<div class="onSlide" data-i="2"><div class="onBody">'+
            '<p><strong>Make it yours</strong></p>'+
            '<ul>'+
              '<li>Personalize: weight/goal/training → tailored Protein, Fiber, Carb, and Glyco settings.</li>'+
              '<li>Favorites: one-tap meals and sessions.</li>'+
              '<li>Local-only: your data stays on your device.</li>'+
            '</ul>'+
          '</div></div>'+
        '</div>'+
        '<div class="onNav">'+
          '<button class="btn ghost" id="onBack" disabled>Back</button>'+
          '<div class="dots" id="onDots"></div>'+
          '<button class="btn primary" id="onNext">Next</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(ov);
  }
  function bindControls(){
    var next=document.getElementById("onNext");
    var back=document.getElementById("onBack");
    var x   =document.getElementById("onClose");
    var ov  =document.getElementById("onboardOverlay");
    var EVT = (window.PointerEvent && (navigator.maxTouchPoints||0)>0) ? "pointerup" : "click";
    var lastTs = 0;
    function wrap(fn){ return function(e){ var now=Date.now(); if(e && e.type!=="click"){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){ } } if(now-lastTs<250){ return; } lastTs=now; fn(); }; }
    if(next){ next.onclick=null; next.setAttribute("onclick","return false;"); next.addEventListener(EVT, wrap(function(){ step(1); }), {passive:false}); }
    if(back){ back.onclick=null; back.setAttribute("onclick","return false;"); back.addEventListener(EVT, wrap(function(){ step(-1); }), {passive:false}); }
    if(x){    x.onclick=null;    x.setAttribute("onclick","return false;"); x.addEventListener(EVT, wrap(closeIntro), {passive:false}); }
    if(ov){
      var mo = new MutationObserver(function(){ if(ov.hasAttribute("hidden")){ ov.style.pointerEvents="none"; document.body.style.overflow=""; } });
      mo.observe(ov,{attributes:true,attributeFilter:["hidden","aria-hidden"]});
    }
  }
  function showFirstRunIfAndroid(){
    if(!isAndroidApp()) return;
    var ov=document.getElementById("onboardOverlay"); if(!ov) return;
    var seen=null; try{ seen=localStorage.getItem(KEY); }catch(e){}
    if(!seen){ ov.removeAttribute("hidden"); ov.removeAttribute("aria-hidden"); ov.style.pointerEvents="auto"; document.body.style.overflow="hidden"; setStep(0); }
    else{ ov.setAttribute("hidden",""); ov.style.pointerEvents="none"; }
  }
  function init(){
    hideStrayIntro();        // hide any copies that leaked into Settings
    ensureMarkup();          // build overlay with slides
    var s=slides(); if(s.length && !s.some(function(el){return el.classList.contains("active");})){ s[0].classList.add("active"); }
    setStep(activeIndex());  // sync buttons/dots
    bindControls();          // single event with throttle
    showFirstRunIfAndroid(); // show only in app
  }
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", init); } else { init(); }
})();
