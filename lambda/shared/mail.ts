import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env, ses } from './aws';

/**
 * Plain-text system email from `VettID <no-reply@vettid.org>`.
 * SES is in the sandbox: the recipient must be a verified identity, or SES
 * rejects the send (MessageRejected). Callers decide whether that matters.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: `VettID <${env('SENDER_EMAIL')}>`,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } } },
    }),
  );
}
