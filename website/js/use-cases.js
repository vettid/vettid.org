// Scrollspy for the use-case chip nav: highlights the chip for the section
// currently in view. Pure presentation — observes scroll position locally,
// records nothing, sends nothing.
(function () {
  'use strict';

  var nav = document.querySelector('.section-nav');
  if (!nav || !('IntersectionObserver' in window)) return;

  var links = {};
  nav.querySelectorAll('a[href^="#"]').forEach(function (a) {
    links[a.getAttribute('href').slice(1)] = a;
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var link = links[entry.target.id];
      if (!link) return;
      Object.keys(links).forEach(function (k) { links[k].classList.remove('active'); });
      link.classList.add('active');
    });
  }, {
    // A band around the upper-middle of the viewport decides which section
    // counts as "current" — stable while reading, flips near the heading.
    rootMargin: '-35% 0px -55% 0px',
  });

  document.querySelectorAll('.uc[id]').forEach(function (section) {
    observer.observe(section);
  });
})();
