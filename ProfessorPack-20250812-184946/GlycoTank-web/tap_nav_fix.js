(function(){
  function $all(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function showTab(name){
    var tabs = $all("main .tab");
    for (var i=0;i<tabs.length;i++){ tabs[i].hidden = (tabs[i].id !== "tab-"+name); }
    var nav = document.getElementById("nav");
    if (nav){
      var btns = nav.querySelectorAll("button[data-tab]");
      for (var j=0;j<btns.length;j++){ btns[j].classList.toggle("active", btns[j].dataset.tab===name); }
    }
    if (name==="dash" && typeof window.renderDashboard==="function"){ try{ window.renderDashboard(); }catch(e){} }
    if (name==="settings" && typeof window.renderSettings==="function"){ try{ window.renderSettings(); }catch(e){} }
  }
  function hideOverlay(){
    var ov = document.getElementById("onboardOverlay");
    if (ov){ ov.setAttribute("hidden",""); ov.setAttribute("aria-hidden","true"); ov.style.pointerEvents="none"; }
    document.body.style.overflow="";
  }
  function bind(){
    hideOverlay(); // make sure nothing invisible blocks taps
    var nav = document.getElementById("nav");
    if (nav){
      nav.addEventListener("click", function(e){
        var t = e.target && e.target.closest ? e.target.closest("button[data-tab]") : null;
        if (!t) return;
        e.preventDefault();
        var tab = t.getAttribute("data-tab");
        if (tab){ showTab(tab); }
      }, true); // capture to beat any stray overlay handlers
    }
    document.addEventListener("click", function(){
      var ov = document.getElementById("onboardOverlay");
      if (ov && ov.hasAttribute("hidden")){ ov.style.pointerEvents="none"; }
    }, true);
  }
  if (document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", bind); } else { bind(); }
})();
