(function(){
  "use strict";
  var INTRO_KEY="glycotank_onboard_seen_app",INTRO_VERSION=1;
  var overlay=document.getElementById("introOverlay"); if(!overlay)return;
try{ if(overlay.parentNode!==document.body){ document.body.appendChild(overlay);} }catch(e){}
try{
  var stray=document.querySelectorAll("#onBack,#onNext,.onNav");
  for(var i=0;i<stray.length;i++){
    if(!overlay.contains(stray[i])){
      try{ stray[i].parentNode && stray[i].parentNode.removeChild(stray[i]); }catch(_){}
    }
  }
}catch(_){}
  var slides=Array.prototype.slice.call(overlay.querySelectorAll(".onSlide"));
  var btnBack=document.getElementById("introBack");
  var btnNext=document.getElementById("introNext");
  var btnClose=document.getElementById("introClose");
  function loadState(){try{return JSON.parse(localStorage.getItem("glycotank")||"{}")}catch(e){return {}}}
  function seenVal(){try{return JSON.parse(localStorage.getItem(INTRO_KEY)||"null")}catch(e){return null}}
  function markSeen(){try{localStorage.setItem(INTRO_KEY,JSON.stringify({v:INTRO_VERSION,seen:true,ts:Date.now()}))}catch(e){}}
  function noDataYet(){var s=loadState();var w=Array.isArray(s.workouts)?s.workouts.length:0;var m=Array.isArray(s.meals)?s.meals.length:0;return (w+m)===0}
  function shouldAutoShow(){var sv=seenVal(); if(sv&&sv.seen) return false; return noDataYet()}
  var idx=0; function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
  function setIdx(n){idx=clamp(n,0,slides.length-1); for(var i=0;i<slides.length;i++){ if(i===idx)slides[i].classList.add("active"); else slides[i].classList.remove("active"); }
    btnBack.disabled=(idx===0); btnNext.textContent=(idx===slides.length-1)?"Let's go":"Next"; }
  function step(d){ if(idx===slides.length-1 && d>0){ closeIntro(true); return; } setIdx(idx+d); }
  var lastFocus=null; function getFocusables(){return Array.prototype.slice.call(overlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function(el){return !el.hasAttribute("disabled")&&el.offsetParent!==null})}
  function trapTab(e){ if(e.key!=="Tab")return; var f=getFocusables(); if(!f.length)return; var first=f[0],last=f[f.length-1];
    if(e.shiftKey && document.activeElement===first){last.focus(); e.preventDefault();} else if(!e.shiftKey && document.activeElement===last){first.focus(); e.preventDefault();} }
  var backSub=null; function addHardwareBack(){ try{ var Cap=window.Capacitor||{}; var App=Cap.App||(Cap.Plugins&&Cap.Plugins.App)||null; if(App&&typeof App.addListener==="function"){ backSub=App.addListener("backButton",function(){ step(-1); }); } }catch(e){} }
  function removeHardwareBack(){ try{ if(backSub && typeof backSub.remove==="function") backSub.remove(); backSub=null; }catch(e){} }
  function showIntro(force){ if(!force && !shouldAutoShow()) return; lastFocus=document.activeElement; overlay.hidden=false; overlay.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden"; setIdx(0); addHardwareBack(); try{ (btnNext||overlay).focus(); }catch(e){}; overlay.addEventListener("keydown",trapTab); }
  function closeIntro(mark){ overlay.hidden=true; overlay.setAttribute("aria-hidden","true"); overlay.style.pointerEvents="none"; document.body.style.overflow=""; removeHardwareBack(); overlay.removeEventListener("keydown",trapTab); if(mark)markSeen(); try{ if(lastFocus&&lastFocus.focus) lastFocus.focus(); }catch(e){} }
  overlay.addEventListener("click",function(e){ if(e.target===overlay) closeIntro(true); });
  if(btnClose) btnClose.addEventListener("click",function(){ closeIntro(true); });
  btnBack.addEventListener("click",function(){ step(-1); });
  btnNext.addEventListener("click",function(){ step(1); });
  overlay.addEventListener("keydown",function(e){ if(e.key==="Escape") closeIntro(true); else if(e.key==="Enter") step(1); });
  window.GT=window.GT||{}; window.GT.intro={ show:function(){ showIntro(true); }, close:function(){ closeIntro(false); }, step:function(d){ step(d>0?1:-1); } };
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",function(){ if(shouldAutoShow()) showIntro(false); }); } else { if(shouldAutoShow()) showIntro(false); }
})();

