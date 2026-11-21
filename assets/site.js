/* redesign preview subpages: menu sheet + current-page marker */
(function(){
  var sheet = document.getElementById('sheet'), btn = document.getElementById('menuBtn'), close = document.getElementById('sheetClose');
  function open(){ sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); btn.setAttribute('aria-expanded', 'true'); }
  function shut(){ sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); btn.setAttribute('aria-expanded', 'false'); }
  if (btn) btn.addEventListener('click', open);
  if (close) close.addEventListener('click', shut);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') shut(); });
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .sheet a.big').forEach(function(a){
    if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
  });
})();

/* phone scroll cue: plain words on load when the page has a hero, fades on first scroll (no box, nothing to tap — Tony 10-12) */
(function(){
  var hero = document.querySelector(".pg-hero"); if (!hero || window.scrollY > 40) return;
  var c = document.createElement("div"); c.className = "scroll-cue"; c.setAttribute("aria-hidden", "true"); c.textContent = "Scroll for more \u2193";
  document.body.appendChild(c);
  function hide(){ if (window.scrollY > 60){ c.classList.add("gone"); window.removeEventListener("scroll", hide); setTimeout(function(){ c.remove(); }, 400); } }
  window.addEventListener("scroll", hide, { passive: true });
})();

/* clips (Tony 10-12): each video plays only while it is on screen and pauses when it leaves,
   so a page never loads every clip at once. Low Power Mode on iPhone blocks autoplay: the first tap anywhere starts what's on screen. */
(function(){
  var vids = [].slice.call(document.querySelectorAll("video[muted]")); if (!vids.length) return;
  var seen = [];
  function play(v){ v.muted = true; var p = v.play(); if (p && p.catch) p.catch(function(){}); }
  if (!("IntersectionObserver" in window)){ vids.forEach(play); return; }
  var io = new IntersectionObserver(function(es){ es.forEach(function(en){
    var v = en.target, i = seen.indexOf(v);
    if (en.isIntersecting){ if (i < 0) seen.push(v); play(v); } else { if (i >= 0) seen.splice(i, 1); v.pause(); }
  }); }, { threshold: 0.35 });
  vids.forEach(function(v){ io.observe(v); });
  function wake(){ seen.forEach(function(v){ if (v.paused) play(v); }); }
  document.addEventListener("touchend", wake, { passive: true });
  document.addEventListener("click", wake);
})();
/* Tidal pattern (11-21): pin every section's tile to the page, so two same-colour sections in a row read as one continuous sheet (no restart line at the join) */
(function(){
  var q = '.band,.closer,.on-pacific,.on-light,.on-dark', raf = 0;
  function align(){ raf = 0; var y = window.scrollY || 0;
    document.querySelectorAll(q).forEach(function(e){ e.style.backgroundPositionY = -Math.round(e.getBoundingClientRect().top + y) + 'px'; }); }
  function soon(){ if (!raf) raf = requestAnimationFrame(align); }
  align(); window.addEventListener('load', align); window.addEventListener('resize', soon);
  if (window.ResizeObserver) new ResizeObserver(soon).observe(document.body);
})();
