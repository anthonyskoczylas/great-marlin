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
