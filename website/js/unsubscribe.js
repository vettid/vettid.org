// Leaving the mailing list. The link in our emails carries the subscriber's
// unsubscribe token in the URL FRAGMENT (#u=…), which the browser never
// sends to a server; this script moves it into the form, and the button
// posts it to /api/subscribe/unsubscribe. Opening the page changes nothing.
(function () {
  'use strict';

  var ask = document.getElementById('unsubAsk');
  var missing = document.getElementById('unsubMissing');
  var form = document.getElementById('unsubForm');
  var field = document.getElementById('unsubToken');
  if (!ask || !missing || !form || !field) return;

  var m = /^#u=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  if (!m) {
    missing.hidden = false;
    return;
  }
  field.value = m[1];
  ask.hidden = false;

  form.addEventListener('submit', function () {
    var btn = form.querySelector('button[type="submit"]');
    // After the form data is collected, so the post still goes out.
    window.setTimeout(function () { btn.disabled = true; }, 0);
  });
})();
