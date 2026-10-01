/**
 * Member API, auth routes: /api/auth/*  (docs/MEMBER-API.md)
 *
 * Sign-in is a magic link plus an optional PIN, run server-side through
 * Cognito custom auth (triggers in lambda/triggers):
 *   start   → we email a single-use link (token stored hashed, 15 min)
 *   verify  → InitiateAuth(CUSTOM_AUTH) + answer the MAGIC challenge
 *   pin     → answer the PIN challenge (only if the member set one)
 * Tokens land in httpOnly cookies; the browser never handles them.
 */
import {
  InitiateAuthCommand,
  type InitiateAuthCommandOutput,
  RespondToAuthChallengeCommand,
  type RespondToAuthChallengeCommandOutput,
  RevokeTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cognito, env } from '../shared/aws';
import { HttpError, Router, email as normEmail, str } from '../shared/http';
import { COOKIES, LEGACY_REFRESH_PATH, MemberRequest, RateLimited, clearSessionCookies, cookie, memberHandler } from '../shared/member-http';
import { memberByEmail } from '../shared/members';
import { pinLockState } from '../shared/pin';
import { hit } from '../shared/ratelimit';
import { secret } from '../shared/secrets';

const lambdaClient = new LambdaClient({});

const router = new Router<MemberRequest>();
const clientId = () => env('MEMBER_CLIENT_ID');
const unauthorized = (m: string) => new HttpError(401, 'unauthorized', m);

function setSession(req: MemberRequest, out: { IdToken?: string; RefreshToken?: string; ExpiresIn?: number }) {
  if (!out.IdToken) throw new Error('No ID token in auth result');
  req.setCookies.push(cookie.set(COOKIES.id.name, out.IdToken, COOKIES.id.path, out.ExpiresIn ?? 3600));
  if (out.RefreshToken) {
    req.setCookies.push(
      cookie.set(COOKIES.refresh.name, out.RefreshToken, COOKIES.refresh.path, 30 * 86400),
      cookie.clear(COOKIES.refresh.name, LEGACY_REFRESH_PATH),
    );
  }
  req.setCookies.push(cookie.clear(COOKIES.pin.name, COOKIES.pin.path));
}

/**
 * vid_pin carries the Cognito session for the PIN step:
 * base64url(JSON{s, e}) + "." + HMAC. Signed so a forged cookie can't be used
 * to probe another member's PIN-lock state.
 */
const pinKey = () => secret(env('ORIGIN_VERIFY_SECRET_ARN'));
const pinCookie = {
  async encode(session: string, emailAddr: string): Promise<string> {
    const body = Buffer.from(JSON.stringify({ s: session, e: emailAddr })).toString('base64url');
    return `${body}.${createHmac('sha256', await pinKey()).update(`vid_pin:${body}`).digest('base64url')}`;
  },
  async decode(v: string | undefined): Promise<{ s: string; e: string } | null> {
    if (!v) return null;
    const [body, mac] = v.split('.');
    if (!body || !mac) return null;
    const want = Buffer.from(createHmac('sha256', await pinKey()).update(`vid_pin:${body}`).digest('base64url'));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return typeof o?.s === 'string' && typeof o?.e === 'string' ? o : null;
    } catch {
      return null;
    }
  },
};

type ChallengeOutput = InitiateAuthCommandOutput | RespondToAuthChallengeCommandOutput;

async function outcome(req: MemberRequest, out: ChallengeOutput, emailAddr: string) {
  if (out.AuthenticationResult) {
    setSession(req, out.AuthenticationResult);
    return { status: 'signed_in' };
  }
  if (out.ChallengeName === 'CUSTOM_CHALLENGE' && out.ChallengeParameters?.step === 'PIN' && out.Session) {
    req.setCookies.push(cookie.set(COOKIES.pin.name, await pinCookie.encode(out.Session, emailAddr), COOKIES.pin.path, 300));
    return { status: 'pin_required' };
  }
  throw unauthorized('Sign-in failed');
}

const isAuthFailure = (e: unknown) => ['NotAuthorizedException', 'UserNotFoundException', 'CodeMismatchException', 'ExpiredCodeException'].includes((e as Error).name);

// ---- start: email a link --------------------------------------------------------

router.on('POST', '/api/auth/start', async ({ body, ip }) => {
  const addr = normEmail(str(body, 'email', { max: 254 }));
  const byIp = await hit(`start#ip#${ip}`, 10, 900);
  if (!byIp.allowed) throw new RateLimited(byIp.retryAfter);
  // Per (address, network) limit is silent: same answer either way.
  const byPair = await hit(`start#pair#${addr}#${ip}`, 3, 900);
  if (byPair.allowed) {
    // Fire-and-forget: the mailer decides whether to send. Answering before
    // any account lookup keeps the response time independent of whether the
    // address has an account.
    await lambdaClient.send(
      new InvokeCommand({ FunctionName: env('LINK_MAILER_FN'), InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ email: addr })) }),
    );
  }
  return { ok: true };
});

// ---- verify: answer the magic-link challenge ------------------------------------

router.on('POST', '/api/auth/verify', async (req) => {
  const addr = normEmail(str(req.body, 'email', { max: 254 }));
  const token = str(req.body, 'token', { max: 100 });
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized('That sign-in link is not valid');
  const lim = await hit(`verify#ip#${req.ip}`, 20, 900);
  if (!lim.allowed) throw new RateLimited(lim.retryAfter);
  try {
    const init = await cognito.send(new InitiateAuthCommand({ ClientId: clientId(), AuthFlow: 'CUSTOM_AUTH', AuthParameters: { USERNAME: addr } }));
    if (init.ChallengeName !== 'CUSTOM_CHALLENGE' || init.ChallengeParameters?.step !== 'MAGIC') throw unauthorized('Sign-in failed');
    const out = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId(),
        ChallengeName: 'CUSTOM_CHALLENGE',
        Session: init.Session,
        ChallengeResponses: { USERNAME: addr, ANSWER: token },
      }),
    );
    return await outcome(req, out, addr);
  } catch (e) {
    if (isAuthFailure(e)) throw unauthorized('That sign-in link is invalid, expired or already used. Request a new one.');
    throw e;
  }
});

// ---- pin: answer the PIN challenge -------------------------------------------------

router.on('POST', '/api/auth/pin', async (req) => {
  const lim = await hit(`pin#ip#${req.ip}`, 20, 900);
  if (!lim.allowed) throw new RateLimited(lim.retryAfter);
  const pending = await pinCookie.decode(req.cookies[COOKIES.pin.name]);
  if (!pending) throw unauthorized('Your sign-in expired. Request a new link.');
  const pin = str(req.body, 'pin', { max: 8 });
  try {
    const out = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId(),
        ChallengeName: 'CUSTOM_CHALLENGE',
        Session: pending.s,
        ChallengeResponses: { USERNAME: pending.e, ANSWER: pin },
      }),
    );
    if (!out.AuthenticationResult && out.ChallengeParameters?.step === 'PIN' && out.Session) {
      // Wrong PIN, retry allowed within this sign-in.
      req.setCookies.push(cookie.set(COOKIES.pin.name, await pinCookie.encode(out.Session, pending.e), COOKIES.pin.path, 300));
      const m = await memberByEmail(pending.e);
      const state = m ? await pinLockState(m.user_guid) : { locked: false, attemptsLeft: 0 };
      throw unauthorized(`Incorrect PIN. ${state.attemptsLeft} attempt${state.attemptsLeft === 1 ? '' : 's'} left.`);
    }
    return await outcome(req, out, pending.e);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (isAuthFailure(e)) {
      req.setCookies.push(cookie.clear(COOKIES.pin.name, COOKIES.pin.path));
      const m = await memberByEmail(pending.e);
      const state = m ? await pinLockState(m.user_guid) : { locked: false, attemptsLeft: 0 };
      throw unauthorized(
        state.locked
          ? 'Too many incorrect PINs. Your PIN is locked for 15 minutes; then request a new sign-in link.'
          : 'This sign-in has expired. Request a new link.',
      );
    }
    throw e;
  }
});

// ---- refresh / signout -------------------------------------------------------------

router.on('POST', '/api/auth/refresh', async (req) => {
  const rt = req.cookies[COOKIES.refresh.name];
  if (!rt) throw unauthorized('Not signed in');
  try {
    const out = await cognito.send(new InitiateAuthCommand({ ClientId: clientId(), AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: rt } }));
    if (!out.AuthenticationResult) throw unauthorized('Session expired');
    setSession(req, out.AuthenticationResult);
    return { ok: true };
  } catch (e) {
    if (isAuthFailure(e)) {
      req.setCookies.push(...clearSessionCookies());
      throw unauthorized('Session expired');
    }
    throw e;
  }
});

router.on('POST', '/api/auth/signout', async (req) => {
  const rt = req.cookies[COOKIES.refresh.name];
  if (rt) {
    try {
      await cognito.send(new RevokeTokenCommand({ ClientId: clientId(), Token: rt }));
    } catch (e) {
      console.warn('revoke failed', (e as Error).name); // sign out locally regardless
    }
  }
  req.setCookies.push(...clearSessionCookies());
  return { ok: true };
});

export const handler = memberHandler(router);
