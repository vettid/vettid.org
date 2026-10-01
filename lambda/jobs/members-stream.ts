/**
 * Members table stream → lifecycle email. Sends the one "your account is
 * ready, sign in" email once a person is `registered` AND their address has
 * passed SES verification (whichever happens last: admin approval, invite
 * registration, or the verification click). `welcome_sent` makes it once-only.
 */
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, table } from '../shared/aws';
import { sendMail } from '../shared/mail';
import type { MemberItem } from '../shared/model';

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const rec of event.Records) {
    if (rec.eventName === 'REMOVE' || !rec.dynamodb?.NewImage) continue;
    const m = unmarshall(rec.dynamodb.NewImage as Parameters<typeof unmarshall>[0]) as MemberItem;
    if (m.state !== 'registered' || !m.email_verified || m.welcome_sent || m.account_status !== 'active') continue;

    // Claim the send first so a retry or a concurrent record can't double-send.
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          UpdateExpression: 'SET welcome_sent = :t',
          ConditionExpression: 'attribute_not_exists(welcome_sent)',
          ExpressionAttributeValues: { ':t': true },
        }),
      );
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') continue;
      throw e;
    }
    await sendMail(
      m.email,
      'Your VettID account is ready',
      `Hi ${m.first_name},\n\nYour VettID account is ready. Sign in here — we'll email you a one-time link:\n\n` +
        `https://${env('ACCOUNT_HOST')}/signin/\n\n` +
        'Once you are in, review and accept the membership terms to become a member.\n\n— VettID\n',
    );
  }
};
