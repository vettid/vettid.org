// Welcome page: if the visitor already has a session, go straight to it.
// Otherwise the static page (Request membership / Sign in) is all there is.

import { get } from './api.js';

get('/api/account/me', { redirect: false }).then(
  () => location.replace('/account/'),
  () => {
    /* not signed in — stay here */
  },
);
