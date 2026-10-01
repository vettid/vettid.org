import { mockClient } from 'aws-sdk-client-mock';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

// Stand-in verifier: "good-*" tokens verify, anything else is "expired".
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (t: string) => {
        if (t.startsWith('good-')) return { 'custom:user_guid': 'g1', email: 'M@x.org' };
        throw new Error('JwtExpiredError');
      },
    }),
  },
}));

Object.assign(process.env, { MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client' });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requireSession } = require('../../lambda/shared/member-http');

const idp = mockClient(CognitoIdentityProviderClient);
const req = (cookies: Record<string, string>) => ({ cookies, setCookies: [] as string[] }) as any;

beforeEach(() => idp.reset());

test('a valid ID token needs no refresh', async () => {
  const r = req({ vid_id: 'good-1', vid_rt: 'rt', vid_s: '1' });
  expect(await requireSession(r)).toEqual({ email: 'm@x.org', user_guid: 'g1' });
  expect(idp.calls()).toHaveLength(0);
  expect(r.setCookies).toEqual([]);
});

test('a valid session missing the presence cookie gets it re-set (edge gate self-heals)', async () => {
  const r = req({ vid_id: 'good-1' });
  await requireSession(r);
  expect(r.setCookies).toEqual(['vid_s=1; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict']);
});

test('an expired ID token is renewed in-request from the refresh cookie (no 401)', async () => {
  idp.on(InitiateAuthCommand).resolves({ AuthenticationResult: { IdToken: 'good-2', ExpiresIn: 3600 } });
  const r = req({ vid_id: 'stale', vid_rt: 'rt', vid_s: '1' });
  expect(await requireSession(r)).toEqual({ email: 'm@x.org', user_guid: 'g1' });
  expect(idp.commandCalls(InitiateAuthCommand)[0].args[0].input).toMatchObject({ AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: 'rt' } });
  expect(r.setCookies).toEqual(['vid_id=good-2; Path=/api; Max-Age=3600; Secure; HttpOnly; SameSite=Strict']);
});

test('a missing ID token is also renewed when the refresh cookie exists', async () => {
  idp.on(InitiateAuthCommand).resolves({ AuthenticationResult: { IdToken: 'good-3' } });
  expect(await requireSession(req({ vid_rt: 'rt' }))).toEqual({ email: 'm@x.org', user_guid: 'g1' });
});

test('a revoked refresh token ends the session: 401 and every cookie cleared', async () => {
  idp.on(InitiateAuthCommand).rejects(Object.assign(new Error('x'), { name: 'NotAuthorizedException' }));
  const r = req({ vid_id: 'stale', vid_rt: 'revoked' });
  await expect(requireSession(r)).rejects.toMatchObject({ status: 401 });
  expect(r.setCookies.every((c: string) => c.includes('Max-Age=0'))).toBe(true);
  expect(r.setCookies).toHaveLength(5);
});

test('no cookies at all: 401 without calling Cognito', async () => {
  await expect(requireSession(req({}))).rejects.toMatchObject({ status: 401 });
  expect(idp.calls()).toHaveLength(0);
});
