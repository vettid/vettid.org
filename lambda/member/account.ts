/**
 * Member API, account routes: /api/account/*  (docs/MEMBER-API.md)
 * Every route requires a valid session cookie and an active account; the
 * members table (not token claims) is the source of truth for state.
 */
import {
  AdminAddUserToGroupCommand,
  AdminDisableUserCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, s3, table } from '../shared/aws';
import { HttpError, Router, badRequest, conflict, forbidden, notFound, str } from '../shared/http';
import { nowIso } from '../shared/ids';
import { COOKIES, MemberRequest, cookie, memberHandler, requireSession } from '../shared/member-http';
import { canSignIn, memberByGuid } from '../shared/members';
import { hasVotingRights, MemberItem, SubscriptionItem } from '../shared/model';
import { checkPin, hashPin, pinProblem } from '../shared/pin';

const router = new Router<MemberRequest>();
const poolId = () => env('MEMBER_POOL_ID');

interface CurrentTerms {
  version_id: string;
  title: string;
  sha256: string;
}

async function currentTerms(): Promise<CurrentTerms | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.terms(),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :c',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':c': 'current' },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  return (r.Items?.[0] as CurrentTerms | undefined) ?? null;
}

async function subscriptionOf(guid: string): Promise<SubscriptionItem | null> {
  const r = await ddb.send(new GetCommand({ TableName: table.subscriptions(), Key: { user_guid: guid } }));
  return (r.Item as SubscriptionItem | undefined) ?? null;
}

async function loadMember(req: MemberRequest): Promise<MemberItem> {
  const s = await requireSession(req);
  const m = await memberByGuid(s.user_guid);
  if (!canSignIn(m) || m.email !== s.email) throw forbidden('This account is not active');
  return m;
}

async function me(m: MemberItem) {
  const [terms, sub] = await Promise.all([currentTerms(), subscriptionOf(m.user_guid)]);
  return {
    user_guid: m.user_guid,
    email: m.email,
    first_name: m.first_name,
    last_name: m.last_name,
    state: m.state,
    account_status: m.account_status,
    terms: {
      current_version: terms?.version_id ?? null,
      accepted_version: m.terms_version ?? null,
      needs_acceptance: !!terms && terms.version_id !== m.terms_version,
    },
    subscription: sub,
    voting_rights: hasVotingRights(m, sub),
    pin_enabled: !!m.pin_hash,
    preferences: { email_updates: m.email_updates !== false },
    created_at: m.created_at,
  };
}

async function setFields(m: MemberItem, set: Record<string, unknown>, remove: string[] = []): Promise<MemberItem> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries({ ...set, updated_at: nowIso() }).map(([k, v], i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = v;
    return `#k${i} = :v${i}`;
  });
  const rems = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  const r = await ddb.send(
    new UpdateCommand({
      TableName: table.members(),
      Key: { user_guid: m.user_guid },
      UpdateExpression: `SET ${sets.join(', ')}${rems.length ? ` REMOVE ${rems.join(', ')}` : ''}`,
      ConditionExpression: 'account_status = :active',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: { ...values, ':active': 'active' },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return r.Attributes as MemberItem;
}

async function requirePin(m: MemberItem, pin: unknown) {
  if (!m.pin_hash) return;
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw badRequest('Enter your current PIN');
  const r = await checkPin(m.user_guid, m.pin_hash, pin);
  if (!r.ok) {
    throw new HttpError(403, 'forbidden', r.locked ? 'Too many incorrect PINs; try again in 15 minutes.' : `Incorrect PIN. ${r.attemptsLeft} attempts left.`);
  }
}

// ---- me / terms -------------------------------------------------------------------

router.on('GET', '/api/account/me', async (req) => me(await loadMember(req)));

router.on('GET', '/api/account/terms', async (req) => {
  await loadMember(req);
  const t = await currentTerms();
  if (!t) throw notFound('No membership terms are published yet');
  const bucket = env('TERMS_BUCKET');
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `terms/${t.version_id}.txt` }));
  const text = await obj.Body!.transformToString('utf-8');
  const pdf_url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: `terms/${t.version_id}.pdf`, ResponseContentDisposition: `inline; filename="vettid-terms-${t.version_id}.pdf"` }),
    { expiresIn: 300 },
  );
  return { version_id: t.version_id, title: t.title, sha256: t.sha256, text, pdf_url };
});

router.on('POST', '/api/account/terms/accept', async (req) => {
  const m = await loadMember(req);
  const version = str(req.body, 'version_id', { max: 64 });
  const sha = str(req.body, 'sha256', { max: 64 });
  const t = await currentTerms();
  if (!t || t.version_id !== version || t.sha256 !== sha) throw conflict('These are not the current terms; reload and review them again');
  const updated = await setFields(m, { terms_version: t.version_id, terms_sha256: t.sha256, terms_accepted_at: nowIso(), state: 'member' });
  if (m.state !== 'member') {
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: m.email, GroupName: 'member' }));
  }
  await audit(m.email, 'member.accept_terms', m.user_guid, { version_id: t.version_id, sha256: t.sha256, from_state: m.state });
  return me(updated);
});

// ---- subscriptions ------------------------------------------------------------------

interface SubscriptionTypeItem {
  type_id: string;
  name: string;
  description: string;
  duration_days: number;
  is_trial: boolean;
  paid: boolean;
  enabled: boolean;
}

async function enabledTypes(): Promise<SubscriptionTypeItem[]> {
  const r = await ddb.send(new ScanCommand({ TableName: table.subscriptionTypes(), Limit: 200 }));
  return ((r.Items ?? []) as SubscriptionTypeItem[]).filter((t) => t.enabled);
}

router.on('GET', '/api/account/subscription-types', async (req) => {
  const m = await loadMember(req);
  const items = (await enabledTypes())
    .filter((t) => !(t.is_trial && m.has_used_trial))
    .map(({ type_id, name, description, duration_days, is_trial, paid }) => ({ type_id, name, description, duration_days, is_trial, paid }));
  return { items };
});

router.on('POST', '/api/account/subscription', async (req) => {
  const m = await loadMember(req);
  if (m.state !== 'member') throw conflict('Accept the membership terms first');
  const typeId = str(req.body, 'type_id', { max: 80 });
  const t = (await enabledTypes()).find((x) => x.type_id === typeId);
  if (!t) throw notFound('No such subscription type');
  if (t.paid) throw conflict('Payments are not available yet');
  if (!t.is_trial) throw conflict('This subscription type cannot be started here');
  if (m.has_used_trial) throw conflict('You have already used your free trial');
  const existing = await subscriptionOf(m.user_guid);
  if (existing && (existing.status === 'trial' || existing.status === 'active') && new Date(existing.expires_at) > new Date()) {
    throw conflict('You already have an active subscription');
  }
  const now = new Date();
  const sub: SubscriptionItem = {
    user_guid: m.user_guid,
    type_id: t.type_id,
    type_name: t.name,
    status: 'trial',
    paid: false,
    started_at: now.toISOString(),
    expires_at: new Date(now.getTime() + t.duration_days * 86_400_000).toISOString(),
  };
  // Mark the trial used first (conditionally) so two tabs can't both start one.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET has_used_trial = :t, updated_at = :n',
        ConditionExpression: 'attribute_not_exists(has_used_trial) OR has_used_trial = :f',
        ExpressionAttributeValues: { ':t': true, ':f': false, ':n': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw conflict('You have already used your free trial');
    throw e;
  }
  await ddb.send(new PutCommand({ TableName: table.subscriptions(), Item: sub }));
  await audit(m.email, 'subscription.start', m.user_guid, { type_id: t.type_id, expires_at: sub.expires_at });
  return me({ ...m, has_used_trial: true });
});

router.on('POST', '/api/account/subscription/cancel', async (req) => {
  const m = await loadMember(req);
  const sub = await subscriptionOf(m.user_guid);
  if (!sub || sub.status === 'canceled' || sub.status === 'expired') throw conflict('No active subscription');
  await ddb.send(new PutCommand({ TableName: table.subscriptions(), Item: { ...sub, status: 'canceled' } }));
  await audit(m.email, 'subscription.cancel', m.user_guid, { type_id: sub.type_id });
  return me(m);
});

// ---- PIN ----------------------------------------------------------------------------

router.on('POST', '/api/account/pin', async (req) => {
  const m = await loadMember(req);
  const pin = req.body.pin;
  const problem = pinProblem(pin);
  if (problem) throw badRequest(problem);
  if (m.pin_hash) await requirePin(m, req.body.current_pin);
  const updated = await setFields(m, { pin_hash: await hashPin(m.user_guid, pin as string) });
  await audit(m.email, m.pin_hash ? 'member.pin_change' : 'member.pin_enable', m.user_guid);
  return me(updated);
});

router.on('DELETE', '/api/account/pin', async (req) => {
  const m = await loadMember(req);
  if (!m.pin_hash) throw conflict('No PIN is set');
  await requirePin(m, req.body.current_pin);
  const updated = await setFields(m, {}, ['pin_hash']);
  await audit(m.email, 'member.pin_disable', m.user_guid);
  return me(updated);
});

// ---- preferences / cancel -----------------------------------------------------------

router.on('POST', '/api/account/preferences', async (req) => {
  const m = await loadMember(req);
  if (typeof req.body.email_updates !== 'boolean') throw badRequest('email_updates must be true or false');
  const updated = await setFields(m, { email_updates: req.body.email_updates });
  return me(updated);
});

router.on('POST', '/api/account/cancel', async (req) => {
  const m = await loadMember(req);
  if (req.body.confirm !== 'CANCEL') throw badRequest('Type CANCEL to confirm');
  await requirePin(m, req.body.pin);
  const deleteAfter = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await setFields(m, { account_status: 'canceled', delete_after: deleteAfter });
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: poolId(), Username: m.email }));
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: poolId(), Username: m.email }));
  await audit(m.email, 'member.cancel', m.user_guid, { delete_after: deleteAfter });
  req.setCookies.push(
    cookie.clear(COOKIES.id.name, COOKIES.id.path),
    cookie.clear(COOKIES.refresh.name, COOKIES.refresh.path),
  );
  return { ok: true };
});

export const handler = memberHandler(router);
