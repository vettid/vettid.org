import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../lib/app';
import { hostName, loadConfig, stageZoneNs } from '../lib/config';
import { MANIFEST_SITE_PATH, VettidOrgStageSiteStack } from '../lib/stacks/stage-site-stack';
import { SERVED_PATHS, readReleaseFile } from '../lib/vault/release-list';
import { releaseStackId } from '../lib/stacks/vault-release-stack';

const ROOT = join(__dirname, '..');

/**
 * The staging copy (VAULT-RELEASES §11.1, W9): what `-c stage=staging`
 * builds, its names, and that staging never changes a prod stack.
 * Lambda bundling is skipped (`aws:cdk:bundling-stacks: []`): these tests
 * read templates, not code.
 */

const STAGING = '347272280361';
const PROD = '449757308783';
const NS = ['ns-1.awsdns-01.org', 'ns-2.awsdns-02.co.uk', 'ns-3.awsdns-03.com', 'ns-4.awsdns-04.net'];
const PROD_STREAM = 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults/stream/2026-10-04T16:29:56.236';
const STAGING_STREAM = `arn:aws:dynamodb:us-east-1:${STAGING}:table/vettid-org-staging-vaults/stream/2026-10-04T16:23:53.360`;

type Synth = Map<string, { stack: cdk.Stack; json: any }> & { missing?: unknown };

function synth(context: Record<string, unknown>): Synth {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  buildApp(app);
  const out: Synth = new Map();
  for (const c of app.node.children) {
    if (c instanceof cdk.Stack) out.set(c.stackName, { stack: c, json: Template.fromStack(c).toJSON() });
  }
  // Context lookups the CLI would have to make: in staging only the vault
  // host stack's availability zones (cached in cdk.context.json), no zone.
  out.missing = app.synth().manifest.missing;
  return out;
}

const resources = (json: any, type: string) => Object.values<any>(json.Resources ?? {}).filter((r) => r.Type === type);
const str = (x: unknown) => JSON.stringify(x);

describe('staging (-c stage=staging)', () => {
  // Prod's stream ARN is in cdk.json as `vaultsStreamArn`: a staging synth must ignore it.
  const staging = synth({ stage: 'staging', vaultsStreamArn: PROD_STREAM, stagingVaultsStreamArn: STAGING_STREAM });
  const t = (name: string) => staging.get(name)!.json;

  test('builds exactly the staging copy, all in the staging account, stateful stacks protected', () => {
    expect([...staging.values()].map(({ stack }) => [stack.stackName, stack.account, stack.terminationProtection])).toEqual([
      ['VettidOrgStageDnsStack', STAGING, true],
      ['VettidOrgAuthStack', STAGING, true],
      ['VettidOrgDataStack', STAGING, true],
      ['VettidOrgVaultStack', STAGING, true],
      ['VettidOrgVaultHostStack', STAGING, false],
      // one release stack per entry of vault/releases/staging.json with a `host`
      ...readReleaseFile(ROOT, 'staging', STAGING).releases.filter((e) => e.host)
        .map((e) => [releaseStackId(e.release), STAGING, false]),
      ['VettidOrgMemberApiStack', STAGING, false],
      ['VettidOrgAccountSiteStack', STAGING, false],
      ['VettidOrgStageSiteStack', STAGING, false],
      ['VettidOrgStageTestMailStack', STAGING, false],
    ]);
  });

  test('deploy order: zone first, member API after its pool, tables and vault stack, sites last', () => {
    const deps = (name: string) => staging.get(name)!.stack.dependencies.map((s) => s.stackName).sort();
    expect(deps('VettidOrgAuthStack')).toEqual(['VettidOrgStageDnsStack']);
    expect(deps('VettidOrgMemberApiStack')).toEqual(['VettidOrgAuthStack', 'VettidOrgDataStack', 'VettidOrgVaultStack']);
    expect(deps('VettidOrgAccountSiteStack')).toEqual(['VettidOrgMemberApiStack', 'VettidOrgStageDnsStack']);
    expect(deps('VettidOrgStageSiteStack')).toEqual(['VettidOrgStageDnsStack']);
    expect(deps('VettidOrgStageTestMailStack')).toEqual(['VettidOrgStageDnsStack']);
  });

  test('host names live under staging.vettid.org', () => {
    const config = loadConfig(new cdk.App({ context: { stage: 'staging' } }).node);
    expect(config.zoneName).toBe('staging.vettid.org');
    expect(hostName(config, 'account')).toBe('account.staging.vettid.org');
    expect(config.vault!.manifestUrl).toBe(`https://staging.vettid.org/${MANIFEST_SITE_PATH}`);

    expect(resources(t('VettidOrgStageDnsStack'), 'AWS::Route53::HostedZone').map((z) => z.Properties.Name)).toEqual(['staging.vettid.org.']);
    const certs = (n: string) => resources(t(n), 'AWS::CertificateManager::Certificate').map((c) => c.Properties.DomainName);
    expect(certs('VettidOrgAccountSiteStack')).toEqual(['account.staging.vettid.org']);
    expect(certs('VettidOrgStageSiteStack')).toEqual(['staging.vettid.org']);
    const aliases = (n: string) => resources(t(n), 'AWS::CloudFront::Distribution').map((d) => d.Properties.DistributionConfig.Aliases);
    expect(aliases('VettidOrgAccountSiteStack')).toEqual([['account.staging.vettid.org']]);
    expect(aliases('VettidOrgStageSiteStack')).toEqual([['staging.vettid.org']]);
  });

  test('no vettid.org lookup in staging: the sites use the stage zone by its SSM ref', () => {
    for (const n of ['VettidOrgAccountSiteStack', 'VettidOrgStageSiteStack']) {
      const certs = resources(t(n), 'AWS::CertificateManager::Certificate');
      expect(str(certs[0].Properties.DomainValidationOptions)).toContain('SsmParameterValuevettidorgstagingdnszoneid');
      for (const r of resources(t(n), 'AWS::Route53::RecordSet')) expect(str(r.Properties.HostedZoneId)).toContain('SsmParameterValuevettidorgstagingdnszoneid');
    }
    expect(staging.missing).toEqual([expect.objectContaining({ key: `availability-zones:account=${STAGING}:region=us-east-1` })]);
    Template.fromStack(staging.get('VettidOrgStageDnsStack')!.stack).hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/staging/dns/zone-id' });
  });

  test('the zone: CAA (Amazon only), the SES domain identity with its DKIM records, retained', () => {
    const json = t('VettidOrgStageDnsStack');
    const zone = Object.values<any>(json.Resources).find((r) => r.Type === 'AWS::Route53::HostedZone');
    expect(zone.DeletionPolicy).toBe('Retain');
    const caa = resources(json, 'AWS::Route53::RecordSet').filter((r) => r.Properties.Type === 'CAA');
    expect(caa).toHaveLength(1);
    expect(caa[0].Properties.ResourceRecords).toEqual(expect.arrayContaining(['0 issue "amazon.com"', '0 issuewild ";"']));
    expect(resources(json, 'AWS::SES::EmailIdentity').map((i) => i.Properties.EmailIdentity)).toEqual(['staging.vettid.org']);
    expect(resources(json, 'AWS::Route53::RecordSet').filter((r) => r.Properties.Type === 'CNAME')).toHaveLength(3);
  });

  test('system mail comes from no-reply@staging.vettid.org; ses:SendEmail stays on *', () => {
    for (const pool of resources(t('VettidOrgAuthStack'), 'AWS::Cognito::UserPool')) {
      expect(pool.Properties.EmailConfiguration).toMatchObject({ EmailSendingAccount: 'DEVELOPER', From: 'VettID <no-reply@staging.vettid.org>' });
      expect(str(pool.Properties.EmailConfiguration.SourceArn)).toContain(`:ses:us-east-1:${STAGING}:identity/staging.vettid.org"`);
    }
    const api = t('VettidOrgMemberApiStack');
    const fns = resources(api, 'AWS::Lambda::Function').filter((f) => f.Properties.Environment?.Variables?.SENDER_EMAIL);
    expect(fns.length).toBeGreaterThan(5);
    for (const f of fns) {
      expect(f.Properties.Environment.Variables.SENDER_EMAIL).toBe('no-reply@staging.vettid.org');
      expect(f.Properties.Environment.Variables.ACCOUNT_HOST).toBe('account.staging.vettid.org');
    }
    const send = resources(api, 'AWS::IAM::Policy')
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: any) => [s.Action].flat().includes('ses:SendEmail'));
    expect(send.length).toBeGreaterThan(0);
    for (const s of send) expect(s.Resource).toBe('*');
  });

  test('the member API uses the staging vault tables and the staging stream, never prod\'s', () => {
    const api = t('VettidOrgMemberApiStack');
    const sources = resources(api, 'AWS::Lambda::EventSourceMapping').map((m) => m.Properties.EventSourceArn);
    expect(sources).toContain(STAGING_STREAM);
    expect(str(api)).not.toContain('369484479783');
    expect(str(api)).not.toContain(PROD);
    const vaultFn = resources(api, 'AWS::Lambda::Function').find((f) => f.Properties.Environment?.Variables?.TABLE_VAULTS);
    expect(vaultFn.Properties.Environment.Variables.TABLE_VAULTS).toBe(`arn:aws:dynamodb:us-east-1:${STAGING}:table/vettid-org-staging-vaults`);
  });

  test('tables carry the stage name; an empty mailing-list table stands in for prod\'s signup list', () => {
    const names = resources(t('VettidOrgDataStack'), 'AWS::DynamoDB::GlobalTable').map((r) => r.Properties.TableName).sort();
    expect(names).toContain('vettid-org-staging-mailing-list');
    for (const n of names) expect(n).toMatch(/^vettid-org-staging-/);
  });

  test.each(['VettidOrgStageDnsStack', 'VettidOrgAuthStack', 'VettidOrgDataStack', 'VettidOrgMemberApiStack', 'VettidOrgAccountSiteStack', 'VettidOrgStageSiteStack', 'VettidOrgStageTestMailStack'])(
    '%s: no imports, under the resource budget, stateful resources retained',
    (name) => {
      const json = t(name);
      expect(str(json)).not.toContain('Fn::ImportValue');
      expect(Object.keys(json.Resources).length).toBeLessThanOrEqual(200);
      for (const [id, r] of Object.entries<any>(json.Resources)) {
        if (['AWS::DynamoDB::GlobalTable', 'AWS::Cognito::UserPool', 'AWS::Route53::HostedZone'].includes(r.Type)) {
          expect({ id, d: r.DeletionPolicy, u: r.UpdateReplacePolicy }).toEqual({ id, d: 'Retain', u: 'Retain' });
        }
      }
    },
  );

  test('left out of staging: public site, signup, admin, relay, audit, delegation', () => {
    const names = [...staging.keys()];
    for (const n of ['VettidOrgStack', 'VettidOrgDnsStack', 'VettidOrgSignupStack', 'VettidOrgPlaybooksStack', 'VettidDevRedirectStack',
      'VettidOrgAdminAccessStack', 'VettidOrgAdminApiStack', 'VettidOrgAdminSiteStack', 'VettidOrgRelayDataStack', 'VettidOrgRelayStack',
      'VettidOrgAuditStack', 'VettidOrgStagingDelegationStack']) {
      expect(names).not.toContain(n);
    }
  });
});

describe('the staging site serves the channel manifest byte for byte', () => {
  const site = (root: string) => {
    const app = new cdk.App({ context: { stage: 'staging', 'aws:cdk:bundling-stacks': [] } });
    const config = loadConfig(app.node);
    return Template.fromStack(new VettidOrgStageSiteStack(app, 'S', { config, repoRoot: root, env: { account: STAGING, region: 'us-east-1' } })).toJSON();
  };
  const fnCode = (json: any) => resources(json, 'AWS::CloudFront::Function')[0].Properties.FunctionCode as string;

  test('nothing published: no manifest (the URL answers 404)', () => {
    const json = site(mkdtempSync(join(tmpdir(), 'w9-')));
    expect(fnCode(json)).not.toContain('pcr-manifest.json');
  });

  const htmlSources = (json: any) =>
    resources(json, 'Custom::CDKBucketDeployment').find((d) => str(d.Properties.Include ?? '').includes('*.json')).Properties.SourceObjectKeys.length;

  test('published: the served file is deployed as is (one more source in the revalidating pass), and known to the 404 function', () => {
    const empty = site(mkdtempSync(join(tmpdir(), 'w9-')));
    const root = mkdtempSync(join(tmpdir(), 'w9-'));
    mkdirSync(join(root, 'vault', 'staging'), { recursive: true });
    writeFileSync(join(root, SERVED_PATHS.staging), '{"manifest":"AAAA","signature":"BBBB","key_id":"e9b3a403423120ac"}\n');
    const json = site(root);
    expect(fnCode(json)).toContain(`"/${MANIFEST_SITE_PATH}":1`);
    expect(htmlSources(json)).toBe(htmlSources(empty) + 1);
  });
});

describe('prod is unaffected by staging', () => {
  const base = synth({});
  const withNs = synth({ stagingZoneNs: NS.join(',') });

  test('the prod stack set is unchanged; no stage stacks in prod', () => {
    const names = [...base.keys()];
    expect(names).not.toEqual(expect.arrayContaining(['VettidOrgStageDnsStack']));
    for (const n of names) expect(n).not.toMatch(/Stage(Dns|Site|TestMail)Stack|StagingDelegation/);
    for (const { stack } of base.values()) expect(['369484479783', PROD]).toContain(stack.account);
  });

  test('stagingZoneNs adds only VettidOrgStagingDelegationStack, and changes no other prod template', () => {
    expect([...withNs.keys()].filter((n) => !base.has(n))).toEqual(['VettidOrgStagingDelegationStack']);
    for (const [name, { json }] of base) expect({ name, json: withNs.get(name)!.json }).toEqual({ name, json });
  });

  test('the delegation: one NS record for staging.vettid.org in vettid.org, in the management account', () => {
    const { stack, json } = withNs.get('VettidOrgStagingDelegationStack')!;
    expect(stack.account).toBe(PROD);
    expect(stack.terminationProtection).toBe(false);
    const records = resources(json, 'AWS::Route53::RecordSet');
    expect(records).toHaveLength(1);
    expect(records[0].Properties).toMatchObject({ Name: 'staging.vettid.org.', Type: 'NS', TTL: '3600', ResourceRecords: NS.map((n) => `${n}.`) });
    expect(Object.keys(json.Resources).filter((k) => json.Resources[k].Type !== 'AWS::CDK::Metadata')).toHaveLength(1);
  });

  test('stagingZoneNs must be four Route 53 name servers', () => {
    const node = (v: unknown) => new cdk.App({ context: { stagingZoneNs: v } }).node;
    expect(stageZoneNs(node(NS), 'staging')).toEqual(NS);
    expect(stageZoneNs(node(NS.map((n) => `${n.toUpperCase()}.`).join(', ')), 'staging')).toEqual(NS);
    expect(stageZoneNs(node(''), 'staging')).toEqual([]);
    expect(() => stageZoneNs(node(NS.slice(0, 3)), 'staging')).toThrow(/four Route 53 name servers/);
    expect(() => stageZoneNs(node([...NS.slice(0, 3), 'ns1.example.com']), 'staging')).toThrow(/four/);
    expect(() => stageZoneNs(node([NS[0], NS[0], NS[1], NS[2]]), 'staging')).toThrow(/four/);
  });
});
