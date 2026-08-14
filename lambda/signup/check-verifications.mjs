// Scheduled every 15 minutes: promote pending subscribers whose SES identity
// verification succeeded (the user accepted the SES verification email).
// Privacy: never log email addresses; log counts only.

import { SESv2Client, GetEmailIdentityCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

const notifyAdmin = async (email, how) => {
  // Best-effort: a notification failure must never fail the subscription.
  // In the SES sandbox this succeeds only once ADMIN_EMAIL is verified.
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: `VettID Mailing List <${process.env.SENDER_EMAIL}>`,
      Destination: { ToAddresses: [process.env.ADMIN_EMAIL] },
      Content: {
        Simple: {
          Subject: { Data: 'New mailing list subscriber' },
          Body: {
            Text: {
              Data:
                `A subscriber just confirmed their spot on the vettid.org mailing list.\n\n` +
                `Email: ${email}\n` +
                `Confirmed via: ${how}\n` +
                `At: ${new Date().toISOString()}\n`,
            },
          },
        },
      },
    }));
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'notify_failed', code: err?.name }));
  }
};


export const handler = async () => {
  const pending = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :pending',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending': 'pending' },
    Limit: 200,
  }));

  let confirmed = 0;
  let stillPending = 0;

  for (const item of pending.Items ?? []) {
    let verified = false;
    try {
      const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: item.email }));
      verified = identity.VerifiedForSendingStatus === true;
    } catch (err) {
      if (err?.name !== 'NotFoundException') {
        console.log(JSON.stringify({ outcome: 'ses_error', code: err?.name }));
      }
      continue;
    }

    if (!verified) {
      stillPending += 1;
      continue;
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { email: item.email },
      UpdateExpression: 'SET #s = :confirmed, confirmedAt = :now REMOVE expiresAt',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':confirmed': 'confirmed',
        ':now': new Date().toISOString(),
      },
    }));
    await notifyAdmin(item.email, 'SES verification email accepted');
    confirmed += 1;
  }

  console.log(JSON.stringify({ outcome: 'sweep', confirmed, stillPending }));
  return { confirmed, stillPending };
};
