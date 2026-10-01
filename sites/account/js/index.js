// Welcome page: if the visitor already has a session, go straight to it.
// Otherwise the static page (Request membership / Sign in) is all there is.

import { get, hasSessionHint } from './api.js';

// Only probe when the presence cookie suggests a session (no 401 noise for
// visitors who clearly aren't signed in).
if (hasSessionHint()) {
  get('/api/account/me', { redirect: false }).then(
    () => location.replace('/account/'),
    () => {
      /* not signed in — stay here */
    },
  );
}
