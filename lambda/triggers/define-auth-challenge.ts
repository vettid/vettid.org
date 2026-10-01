/**
 * Cognito DefineAuthChallenge (member pool). The flow (see lambda/member/auth.ts):
 *   1. MAGIC — the emailed link's token
 *   2. PIN   — only if the member has set one; up to 3 tries per sign-in
 *              (cross-sign-in lockout is enforced in verify)
 * Only active registered/member accounts may complete sign-in.
 */
import type { DefineAuthChallengeTriggerHandler } from 'aws-lambda';
import { memberByGuid, canSignIn } from '../shared/members';

const MAX_PIN_TRIES_PER_SIGN_IN = 3;

export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const fail = () => {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  };
  const challenge = () => {
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    return event;
  };

  if (event.request.userNotFound) return fail();
  const guid = event.request.userAttributes['custom:user_guid'];
  const member = guid ? await memberByGuid(guid) : null;
  if (!canSignIn(member)) return fail();

  const session = event.request.session ?? [];
  if (session.length === 0) return challenge(); // → MAGIC

  const last = session[session.length - 1];
  if (last.challengeName !== 'CUSTOM_CHALLENGE') return fail();

  if (last.challengeMetadata === 'MAGIC') {
    if (!last.challengeResult) return fail();
    if (member.pin_hash) return challenge(); // → PIN
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  if (last.challengeMetadata === 'PIN') {
    if (last.challengeResult) {
      event.response.issueTokens = true;
      event.response.failAuthentication = false;
      return event;
    }
    const pinTries = session.filter((s) => s.challengeMetadata === 'PIN').length;
    return pinTries < MAX_PIN_TRIES_PER_SIGN_IN ? challenge() : fail();
  }
  return fail();
};
