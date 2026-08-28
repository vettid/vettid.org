// Tools We Trust staleness check: the six-month convention the playbooks
// follow, computed client-side because this site has no build step. Shows
// the page banner when the OLDEST entry's data-reviewed date is more than
// six months old. Progressive enhancement only — no requests, no storage,
// no tracking; without JS the per-entry "Last reviewed" lines still show.
(function() {
  'use strict';

  var banner = document.getElementById('staleBanner');
  if (!banner) {
    return;
  }

  var entries = document.querySelectorAll('.tool[data-reviewed]');
  var oldest = null;
  for (var i = 0; i < entries.length; i++) {
    var d = new Date(entries[i].getAttribute('data-reviewed'));
    if (!isNaN(d.getTime()) && (oldest === null || d < oldest)) {
      oldest = d;
    }
  }
  if (oldest === null) {
    return;
  }

  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  if (oldest < cutoff) {
    banner.classList.add('visible');
  }
})();
