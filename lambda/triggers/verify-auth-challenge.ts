/**
 * Cognito VerifyAuthChallengeResponse (member pool).
 *   MAGIC: SHA-256(answer) must be an unused, unexpired link for this
 *          address; it is consumed atomically (single use).
 *   PIN:   peppered HMAC compare with a cross-sign-in lockout
 *          (5 failures → 15 minutes), see lambda/shared/pin.ts.
 */
import type { VerifyAuthChallengeResponseTriggerHandler } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env } from '../shared/aws';
import { memberByGuid } from '../shared/members';
import { checkPin } from '../shared/pin';
import { sha256Hex } from '../shared/terms-pdf';

async function consumeLink(token: string, emailAddr: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env('TABLE_MAGIC_LINKS'),
        Key: { token_hash: sha256Hex(token) },
        UpdateExpression: 'SET used_at = :n',
        ConditionExpression: 'attribute_exists(token_hash) AND email = :e AND expires_at > :now AND attribute_not_exists(used_at)',
        ExpressionAttributeValues: { ':n': new Date().toISOString(), ':e': emailAddr, ':now': Math.floor(Date.now() / 1000) },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const step = event.request.privateChallengeParameters?.step;
  const answer = String(event.request.challengeAnswer ?? '');
  const emailAddr = String(event.request.userAttributes.email ?? '').toLowerCase();
  const guid = event.request.userAttributes['custom:user_guid'];

  if (step === 'MAGIC') {
    event.response.answerCorrect = await consumeLink(answer, emailAddr);
    return event;
  }
  if (step === 'PIN' && guid) {
    const m = await memberByGuid(guid);
    event.response.answerCorrect = !!m?.pin_hash && /^\d{4,8}$/.test(answer) && (await checkPin(guid, m.pin_hash, answer)).ok;
    return event;
  }
  event.response.answerCorrect = false;
  return event;
};
