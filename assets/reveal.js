/* ============================================================================
   reveal.js — scroll reveals for the static subpages. No GSAP, no Lenis here;
   index.html owns that stack, these pages stay cheap.

   The important part is the failsafe. `.rv` elements are hidden by CSS the moment
   html.js is set, and only this script can show them again. That trade is fine
   for a flourish and fatal for a page whose entire job is to be read — by a guest
   deciding on a $1,800 day, or by Googlebot. So we never assume the observer runs:
   we PROVE it against a sentinel that is guaranteed on screen, and if it stays
   silent we drop the animation and show everything.

   Not theoretical. A fresh IntersectionObserver watching an element centred in the
   viewport measured zero callbacks in the headless preview (same frozen-compositor
   class of failure as the rAF stall documented in index.html). Low-power modes and
   some extensions starve IO the same way. Losing the fade is nothing. Losing the
   page is the whole business.
   ========================================================================== */
(function () {
  var rv = [].slice.call(document.querySelectorAll('.rv'));
  if (!rv.length) return;

  /* Bail out of the reveal system entirely rather than adding .in to each element.
     Where the observer stalls, the CSS transition is usually stalled too — measured
     in the headless preview: .in applied, cascade correct, opacity still pinned at
     0 because the transition never advanced. html.static drops the hiding rule, so
     the content is simply there, no transition in the path. */
  function showAll() { document.documentElement.classList.add('static'); }

  if (!('IntersectionObserver' in window)) { showAll(); return; }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -12% 0px' });

  rv.forEach(function (e) { io.observe(e); });

  /* Sentinel: the hero is on screen at load by definition, so a healthy observer
     reports on it almost immediately. Do NOT probe `.rv.in` instead — the first
     .rv sits below a 78svh hero, so "nothing revealed yet" is the correct state
     at load and would trip the failsafe on every healthy page. */
  var sentinel = document.querySelector('.pg-hero') || document.body;
  var alive = false;
  var probe = new IntersectionObserver(function () { alive = true; probe.disconnect(); });
  probe.observe(sentinel);

  setTimeout(function () {
    if (!alive) { try { probe.disconnect(); io.disconnect(); } catch (e) {} showAll(); }
  }, 1400);
})();
