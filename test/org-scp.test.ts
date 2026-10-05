import * as fs from 'fs';
import * as path from 'path';
import { ALERT_FORWARDER_ROLE_NAME, ALERT_FORWARDER_RULE_NAME, ALERT_HEARTBEAT_RULE_NAME } from '../lib/config';

/** lib/org/scp-alert-forwarder.json: the Workloads OU policy protecting the member accounts' alert forwarders. */
describe('alert-forwarder SCP (lib/org/scp-alert-forwarder.json)', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'lib', 'org', 'scp-alert-forwarder.json'), 'utf8');
  const scp = JSON.parse(raw);
  const CFN_EXEC = 'arn:aws:iam::*:role/cdk-*-cfn-exec-role-*';
  const sid = (s: string) => scp.Statement.find((x: any) => x.Sid === s);

  test('valid, fits the SCP size limit, and only denies', () => {
    expect(scp.Version).toBe('2012-10-17');
    expect(JSON.stringify(scp).length).toBeLessThanOrEqual(5120);
    expect(scp.Statement).toHaveLength(2);
    for (const s of scp.Statement) {
      expect(s.Effect).toBe('Deny');
      expect(s.NotAction).toBeUndefined();
      expect(s.NotResource).toBeUndefined();
    }
  });

  test('every statement exempts exactly the CDK execution role (as the other SCPs do)', () => {
    for (const s of scp.Statement) expect(s.Condition).toEqual({ ArnNotLike: { 'aws:PrincipalArn': CFN_EXEC } });
  });

  test('rules: exactly the forward and heartbeat rules, against every change', () => {
    const s = sid('ProtectAlertForwarderRules');
    expect(s.Resource).toEqual([`arn:aws:events:*:*:rule/${ALERT_FORWARDER_RULE_NAME}`, `arn:aws:events:*:*:rule/${ALERT_HEARTBEAT_RULE_NAME}`]);
    expect([...s.Action].sort()).toEqual(['events:DeleteRule', 'events:DisableRule', 'events:PutRule', 'events:PutTargets', 'events:RemoveTargets']);
  });

  test('role: exactly the forwarder role, against deletion, trust/policy changes and being passed elsewhere', () => {
    const s = sid('ProtectAlertForwarderRole');
    expect(s.Resource).toBe(`arn:aws:iam::*:role/${ALERT_FORWARDER_ROLE_NAME}`);
    expect(s.Action).toEqual(
      expect.arrayContaining(['iam:DeleteRole', 'iam:UpdateAssumeRolePolicy', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:PassRole']),
    );
    for (const a of s.Action) expect(a).toMatch(/^iam:[A-Za-z]+$/); // no wildcards
  });

  test('no wildcard actions or resources beyond account/region', () => {
    for (const s of scp.Statement) {
      for (const a of [s.Action].flat()) expect(a).not.toContain('*');
      for (const r of [s.Resource].flat()) expect(r.split(':').slice(5).join(':')).not.toContain('*');
    }
  });
});
