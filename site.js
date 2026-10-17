// Catch Marrakech · shared page behaviour (top bar, navigation panel, reveal on scroll)
(function () {
  var nav = document.getElementById('nav');
  if (nav && !nav.classList.contains('solid')) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  var burger = document.getElementById('burger');
  function setOpen(open) {
    document.body.classList.toggle('menu-open', open);
    document.body.classList.toggle('locked', open);
    if (burger) { burger.setAttribute('aria-expanded', open ? 'true' : 'false'); burger.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); }
    var d = document.getElementById('drawer'); if (d) d.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (burger) burger.addEventListener('click', function () { setOpen(!document.body.classList.contains('menu-open')); });
  document.querySelectorAll('#drawer a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
})();
