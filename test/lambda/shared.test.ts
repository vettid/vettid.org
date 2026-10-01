import { Router, decodeCursor, encodeCursor, email } from '../../lambda/shared/http';
import { requireAdminClaims as requireAdmin } from '../../lambda/shared/admin-auth';
import { hasVotingRights, SubscriptionItem } from '../../lambda/shared/model';
import { inviteCode } from '../../lambda/shared/ids';

describe('Router', () => {
  const r = new Router()
    .on('GET', '/admin/members', async () => 'list')
    .on('POST', '/admin/members/{user_guid}/suspend', async () => 'suspend');

  test('matches templates and decodes params', () => {
    const m = r.match('POST', '/admin/members/a%2Fb/suspend');
    expect(m).not.toBeNull();
    expect(m !== null && m !== 'method' && m.params).toEqual({ user_guid: 'a/b' });
  });

  test('tolerates a trailing slash, distinguishes wrong method from no route', () => {
    expect(r.match('GET', '/admin/members/')).not.toBeNull();
    expect(r.match('DELETE', '/admin/members')).toBe('method');
    expect(r.match('GET', '/admin/nope')).toBeNull();
  });

  test('params cannot span segments', () => {
    expect(r.match('POST', '/admin/members/a/b/suspend')).toBeNull();
  });
});

describe('requireAdmin', () => {
  const ev = (claims: Record<string, string>) => ({ requestContext: { authorizer: { claims } } }) as any;

  test('accepts the admin group in each format Cognito/API Gateway emits', () => {
    for (const g of ['admin', 'other,admin', '[admin other]']) {
      expect(requireAdmin(ev({ email: 'A@X.org', 'cognito:groups': g }))).toBe('a@x.org');
    }
  });

  test('rejects missing group (403) and missing identity (401)', () => {
    expect(() => requireAdmin(ev({ email: 'a@x.org', 'cognito:groups': 'administrators' }))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => requireAdmin(ev({}))).toThrow(expect.objectContaining({ status: 401 }));
  });
});

describe('hasVotingRights', () => {
  const sub = (o: Partial<SubscriptionItem>): SubscriptionItem => ({
    user_guid: 'g', type_id: 't', type_name: 'T', status: 'active', paid: true,
    started_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', ...o,
  });
  const member = { state: 'member' as const, account_status: 'active' as const };

  test('member + active paid unexpired subscription votes', () => {
    expect(hasVotingRights(member, sub({}))).toBe(true);
  });

  test.each([
    ['free trial', sub({ status: 'trial', paid: false })],
    ['unpaid', sub({ paid: false })],
    ['expired', sub({ expires_at: '2020-01-01T00:00:00Z' })],
    ['no subscription', null],
  ])('%s does not vote', (_n, s) => {
    expect(hasVotingRights(member, s)).toBe(false);
  });

  test('registered (terms not accepted) or suspended does not vote', () => {
    expect(hasVotingRights({ state: 'registered', account_status: 'active' }, sub({}))).toBe(false);
    expect(hasVotingRights({ state: 'member', account_status: 'suspended' }, sub({}))).toBe(false);
  });
});

describe('helpers', () => {
  test('cursor round-trips and rejects junk', () => {
    const k = { user_guid: 'x', state: 'member' };
    expect(decodeCursor(encodeCursor(k)!)).toEqual(k);
    expect(() => decodeCursor('not-a-cursor')).toThrow();
  });

  test('email normalizes and validates', () => {
    expect(email('  Foo@Example.ORG ')).toBe('foo@example.org');
    expect(() => email('nope')).toThrow();
  });

  test('invite codes are XXXXX-XXXXX Crockford base32', () => {
    for (let i = 0; i < 50; i++) expect(inviteCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });
});

describe('rate-limit keys from CloudFront-Viewer-Address', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rateKeyFromViewer, expandIPv6 } = require('../../lambda/shared/member-http');
  test.each([
    ['198.51.100.10:46532', '198.51.100.10'],
    ['2001:db8:85a3::8a2e:370:7334:443', '2001:0db8:85a3:0000::/64'],
    ['2001:db8:85a3:0:ffff:ffff:ffff:ffff:5', '2001:0db8:85a3:0000::/64'],
    ['[2001:db8::1]:443', '2001:0db8:0000:0000::/64'],
  ])('%s → %s', (v, want) => {
    expect(rateKeyFromViewer(v, 'fallback')).toBe(want);
  });
  test('every address in one /64 shares a key', () => {
    expect(rateKeyFromViewer('2001:db8:1:2:aaaa::1:1', '')).toBe(rateKeyFromViewer('2001:db8:1:2:bbbb:cccc:dddd:eeee:2', ''));
  });
  test('expands :: and embedded IPv4', () => {
    expect(expandIPv6('::ffff:192.0.2.1')).toEqual(['0000', '0000', '0000', '0000', '0000', 'ffff', 'c000', '0201']);
    expect(expandIPv6('1::2::3')).toBeNull();
  });
});
