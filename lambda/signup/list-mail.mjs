// Mail the mailing list sends, and the unsubscribe link every such mail must
// carry. Shared by subscribe.mjs, check-verifications.mjs and
// scripts/list/unsubscribe-links.mjs; a future mailing tool must build its
// messages with listMessage() (RUNBOOK "Mailing list").
//
// The unsubscribe token is 32 random bytes kept on the subscriber's row
// (attribute `unsubToken`, looked up through the sparse `unsub-index`). It
// names the row without carrying or accepting an address, lasts as long as
// the row does, and dies with it: unsubscribing deletes the row, and a later
// sign-up gets a new token. No server secret is involved.
// Privacy: never log an email address or a token.

import { randomBytes } from 'node:crypto';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

export const SITE = 'https://vettid.org';
export const UNSUB_INDEX = 'unsub-index';
export const UNSUB_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

export const newUnsubscribeToken = () => randomBytes(32).toString('base64url');

// The link people click, in the message body. The token is in the URL
// FRAGMENT, which browsers never send: it reaches no server log. The page
// (website/unsubscribe/) posts it in a form body.
export const unsubscribePageUrl = (token) => `${SITE}/unsubscribe/#u=${token}`;

// The List-Unsubscribe URL (RFC 8058): mail providers POST to it with no
// page and no body of ours, so here the token has to be in the query string,
// and lands in the CloudFront and WAF logs. It can only remove that one
// address, and is dead once used.
export const unsubscribeOneClickUrl = (token) => `${SITE}/api/subscribe/unsubscribe?u=${token}`;

export const listHeaders = (token) => [
  { Name: 'List-Unsubscribe', Value: `<${unsubscribeOneClickUrl(token)}>` },
  { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
];

export const unsubscribeFooter = (token) =>
  `\n-- \nTo leave the VettID mailing list, open this link and press the button:\n${unsubscribePageUrl(token)}\n`;

/**
 * A message to one subscriber: the text with the unsubscribe footer, and the
 * List-Unsubscribe headers. Every mail to the list goes through this.
 */
export const listMessage = ({ to, subject, text, token }) =>
  new SendEmailCommand({
    FromEmailAddress: `VettID <${process.env.SENDER_EMAIL}>`,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Text: { Data: text + unsubscribeFooter(token) } },
        Headers: listHeaders(token),
      },
    },
  });

/**
 * The row's unsubscribe token, created if the row has none (rows confirmed
 * before unsubscribe existed). Returns undefined if the row is gone.
 */
export const ensureUnsubscribeToken = async (ddb, table, email) => {
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: table,
      Key: { email },
      UpdateExpression: 'SET unsubToken = if_not_exists(unsubToken, :t)',
      ConditionExpression: 'attribute_exists(email)',
      ExpressionAttributeValues: { ':t': newUnsubscribeToken() },
      ReturnValues: 'ALL_NEW',
    }));
    return res.Attributes?.unsubToken;
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    return undefined;
  }
};

/**
 * Tells the admin mailbox that somebody confirmed. It carries NO address and
 * nothing else about the subscriber: that mailbox is at another provider,
 * outside the list's own storage and its deletion. Best-effort: a failed
 * notice must never fail the subscription.
 */
export const notifyAdmin = async (ses, how) => {
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
                `Confirmed via: ${how}\n` +
                `At: ${new Date().toISOString()}\n\n` +
                `This notice leaves the address out on purpose. To count or export the list, see RUNBOOK "Mailing list".\n`,
            },
          },
        },
      },
    }));
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'notify_failed', code: err?.name }));
  }
};
