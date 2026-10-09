(function(){
  try{
    // Remove any old overlay in the static HTML
    var ov = document.getElementById("onboardOverlay");
    if (ov) { ov.remove(); }

    // Remove stray controls left in the normal flow (outside an overlay)
    var stray = Array.from(document.querySelectorAll(
      ".onNav, .onSlides, .onSlide, #onBack, #onNext, #onClose, #onDots, #onTitle"
    )).filter(function(el){ return !el.closest("#onboardOverlay"); });
    stray.forEach(function(el){ try{ el.remove(); }catch(_){}});

    // Reset once this browser session so the intro will show after this fix
    if (!sessionStorage.getItem("gt_reset_once")) {
      try { localStorage.removeItem("glycotank_onboard_seen"); } catch(_){}
      sessionStorage.setItem("gt_reset_once","1");
    }
  }catch(_){}
})();
