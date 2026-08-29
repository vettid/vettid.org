// VettID shared navigation: hamburger toggle for the slide-out menu.
// Progressive enhancement only — all navigation works as plain links
// without this script. No external requests, no storage, no tracking.
(function() {
  'use strict';

  var toggle = document.querySelector('.nav-toggle');
  var navMenu = document.getElementById('navMenu');
  var overlay = document.querySelector('.nav-overlay');

  if (!toggle || !navMenu) {
    return;
  }

  var isOpen = false;

  function openMenu() {
    isOpen = true;
    toggle.classList.add('active');
    navMenu.style.display = 'flex';
    if (overlay) {
      overlay.style.display = 'block';
    }
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    isOpen = false;
    toggle.classList.remove('active');
    navMenu.style.display = 'none';
    if (overlay) {
      overlay.style.display = 'none';
    }
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  if (overlay) {
    overlay.addEventListener('click', function(e) {
      e.preventDefault();
      closeMenu();
    });
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) {
      closeMenu();
    }
  });

  // Desktop dropdown groups. On mouse devices, CSS :hover/:focus-within is
  // the ONLY open mechanism — no click state to get out of sync with it.
  // The .open class (click/tap toggling) exists solely for hover-less
  // devices (tablets at desktop width), where hover can't happen and so
  // the two mechanisms can never both be active.
  var groups = document.querySelectorAll('.nav-group');
  var hoverless = window.matchMedia('(hover: none)').matches;

  function closeGroups(except) {
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g === except) continue;
      g.classList.remove('open');
      var btn = g.querySelector('button.nav-parent');
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
      }
    }
  }

  if (hoverless) {
    for (var i = 0; i < groups.length; i++) {
      (function(group) {
        var parent = group.querySelector('.nav-parent');
        if (!parent) {
          return;
        }
        parent.addEventListener('click', function(e) {
          var isButton = parent.tagName === 'BUTTON';
          if (!isButton && group.classList.contains('open')) {
            // Link parent, dropdown already open: second tap navigates.
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          var open = group.classList.toggle('open');
          closeGroups(group);
          if (isButton) {
            parent.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
        });
      })(groups[i]);
    }

    document.addEventListener('click', function() {
      closeGroups(null);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeGroups(null);
      }
    });
  }
})();
