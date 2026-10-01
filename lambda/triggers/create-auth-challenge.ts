/**
 * Cognito CreateAuthChallenge (member pool). Names the step only: the magic
 * link is emailed by /api/auth/start (not here), and both answers are checked
 * in VerifyAuthChallenge against server-side state — so no secret ever goes
 * into challenge parameters, and nothing here reveals whether a PIN is set
 * until the magic link has already been proven.
 */
import type { CreateAuthChallengeTriggerHandler } from 'aws-lambda';

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session ?? [];
  const step = session.length === 0 ? 'MAGIC' : 'PIN';
  event.response.publicChallengeParameters = { step };
  event.response.privateChallengeParameters = { step };
  event.response.challengeMetadata = step;
  return event;
};
