// Mailing-list signup: POST to the same-origin API, SES sends the
// verification email, accepting it confirms the subscription.
(function () {
  'use strict';

  var form = document.getElementById('signupForm');
  var status = document.getElementById('signupStatus');
  if (!form || !status) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var email = form.email.value.trim();
    if (!email || email.indexOf('@') < 1 || email.length > 320) {
      status.textContent = 'Please enter a valid email address.';
      status.className = 'signup-status error';
      return;
    }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    status.className = 'signup-status';
    status.textContent = 'Signing you up…';

    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, website: form.website.value })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.ok) {
        form.style.display = 'none';
        status.textContent = 'Check your inbox for a confirmation email from Amazon Web Services — clicking it confirms your spot on the list.';
      } else {
        status.textContent = (data && data.error) || 'Something went wrong — please try again.';
        status.className = 'signup-status error';
        btn.disabled = false;
      }
    }).catch(function () {
      status.textContent = 'Something went wrong — please try again.';
      status.className = 'signup-status error';
      btn.disabled = false;
    });
  });
})();
