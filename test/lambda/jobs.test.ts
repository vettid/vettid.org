import { mockClient } from 'aws-sdk-client-mock';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { marshall } from '@aws-sdk/util-dynamodb';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_SUBSCRIPTIONS: 'subs', TABLE_AUDIT: 'audit', TABLE_MAILING_LIST: 'list',
  MEMBER_POOL_ID: 'pool', SENDER_EMAIL: 'no-reply@vettid.org', ACCOUNT_HOST: 'account.vettid.org',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const cleanup = require('../../lambda/jobs/cleanup');
const stream = require('../../lambda/jobs/members-stream');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const ccf = () => Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });

beforeEach(() => {
  ddb.reset(); idp.reset(); ses.reset();
  ddb.on(PutCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
});

describe('cleanup job', () => {
  const canceled = { user_guid: 'g1', email: 'gone@x.org', state: 'member', account_status: 'canceled', delete_after: '2020-01-01T00:00:00Z' };

  test('a member reinstated after the query is left completely alone', async () => {
    ddb.on(QueryCommand, { TableName: 'members', ExpressionAttributeValues: { ':s': 'member', ':c': 'canceled', ':now': expect.anything() } } as any).resolves({ Items: [canceled] });
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':c'] === 'canceled' && input.ExpressionAttributeValues?.[':s'] === 'member' ? { Items: [canceled] } : { Items: [] }));
    ddb.on(DeleteCommand).rejects(ccf()); // conditional row delete fails: reinstated
    const r = await cleanup.handler();
    expect(r.deleted).toBe(0);
    expect(idp.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1); // only the guarded attempt
  });

  test('stale unverified request: row + marker removed; SES identity kept if the mailing list uses it', async () => {
    const stale = { user_guid: 'g2', email: 'list@x.org', state: 'requested', email_verified: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':r'] === 'requested' ? { Items: [stale] } : { Items: [] }));
    ddb.on(DeleteCommand).resolves({});
    ddb.on(GetCommand, { TableName: 'list' }).resolves({ Item: { email: 'list@x.org' } });
    const r = await cleanup.handler();
    expect(r.reclaimed).toBe(1);
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([{ user_guid: 'g2' }, { user_guid: 'email:list@x.org' }]);
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });

  test('stale unverified request not on the list: its SES identity is deleted too', async () => {
    const stale = { user_guid: 'g3', email: 'nobody@x.org', state: 'requested', email_verified: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':r'] === 'requested' ? { Items: [stale] } : { Items: [] }));
    ddb.on(DeleteCommand).resolves({});
    ddb.on(GetCommand, { TableName: 'list' }).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
    await cleanup.handler();
    expect(ses.commandCalls(DeleteEmailIdentityCommand)[0].args[0].input.EmailIdentity).toBe('nobody@x.org');
  });
});

describe('members stream mailer', () => {
  const rec = (img: Record<string, unknown>) => ({ eventName: 'MODIFY', dynamodb: { NewImage: marshall(img) } });
  const ready = { user_guid: 'g1', email: 'm@x.org', first_name: 'Evil\nhttps://phish', state: 'registered', account_status: 'active', email_verified: true };

  test('the once-only claim re-checks the live row (never recreates a deleted member)', async () => {
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).resolves({});
    await stream.handler({ Records: [rec(ready)] } as any, {} as any, () => undefined);
    const claim = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(claim.ConditionExpression).toContain('attribute_exists(user_guid)');
    expect(claim.ConditionExpression).toContain('account_status = :active');
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Body!.Text!.Data!;
    expect(text).not.toContain('phish'); // no member-supplied text in system email
  });

  test('if the claim fails (deleted/suspended/already sent) nothing is emailed', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    await stream.handler({ Records: [rec(ready)] } as any, {} as any, () => undefined);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});
