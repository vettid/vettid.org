import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiFunction } from '../lib/constructs/api-function';
import { compareStack, fingerprint, needsAttention, normalizeTemplate, renderReport, templateDifferences } from '../lib/ops/drift';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeSourceMap } = require('../lib/constructs/sourcemap-paths.cjs');

/** A deployed-looking template: one function, the CDK metadata, a non-ASCII description. */
const base = () => ({
  Resources: {
    AuthFnABC: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: { S3Bucket: 'cdk-hnb659fds-assets-449757308783-us-east-1', S3Key: 'aaaa.zip' },
        Description: 'PIN check (MEMBER-API §4) → lockout',
      },
      Metadata: { 'aws:asset:path': 'asset.aaaa' },
    },
    CDKMetadata: { Type: 'AWS::CDK::Metadata', Properties: { Analytics: 'v2:deflate64:one' } },
  },
  Conditions: { CDKMetadataAvailable: { 'Fn::Equals': ['a', 'a'] } },
});

const deployedOf = (template: object) => ({ template: template as any, stackStatus: 'UPDATE_COMPLETE', lastUpdated: '2026-10-01T12:00:00.000Z' });

describe('template comparison', () => {
  test('identical templates: in sync', () => {
    expect(compareStack({ stackName: 'S', account: '1', synthesized: base(), deployed: deployedOf(base()) }).state).toBe('in-sync');
  });

  test('GetTemplate folds non-ASCII to "?" and CDK metadata varies: still in sync', () => {
    const deployed: any = base();
    deployed.Resources.AuthFnABC.Properties.Description = 'PIN check (MEMBER-API ?4) ? lockout';
    deployed.Resources.CDKMetadata.Properties.Analytics = 'v2:deflate64:other-cdk-version';
    delete deployed.Conditions;
    expect(templateDifferences(base(), deployed)).toEqual([]);
    expect(normalizeTemplate(base())).not.toHaveProperty('Resources.CDKMetadata');
  });

  test('merged code change not deployed: drift, reported as Lambda code', () => {
    const synthesized: any = base();
    synthesized.Resources.AuthFnABC.Properties.Code.S3Key = 'bbbb.zip';
    synthesized.Resources.AuthFnABC.Metadata['aws:asset:path'] = 'asset.bbbb';
    const r = compareStack({ stackName: 'VettidOrgMemberApiStack', account: '449757308783', synthesized, deployed: deployedOf(base()) });
    expect(r.state).toBe('drift');
    expect(r.differences).toEqual(['Resources/AuthFnABC/Properties/Code/S3Key (Lambda code)']);
  });

  test('resources added or removed in master are named', () => {
    const synthesized: any = base();
    synthesized.Resources.NewTable = { Type: 'AWS::DynamoDB::Table', Properties: {} };
    const deployed: any = base();
    deployed.Resources.OldQueue = { Type: 'AWS::SQS::Queue', Properties: {} };
    expect(templateDifferences(synthesized, deployed)).toEqual([
      'Resources/NewTable (added in master)',
      'Resources/OldQueue (only in the deployed stack)',
    ]);
  });

  test('not deployed, mid-update', () => {
    expect(compareStack({ stackName: 'S', account: '1', synthesized: base() }).state).toBe('not-deployed');
    const r = compareStack({ stackName: 'S', account: '1', synthesized: base(), deployed: { ...deployedOf(base()), stackStatus: 'UPDATE_IN_PROGRESS' } });
    expect(r.state).toBe('error');
  });
});

describe('report', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const drift = { stackName: 'VettidOrgMemberApiStack', account: '449757308783', state: 'drift' as const, stackStatus: 'UPDATE_COMPLETE', lastUpdated: '2026-10-01T12:00:00.000Z', differences: ['Resources/AuthFnABC/Properties/Code/S3Key (Lambda code)'] };
  const ok = { stackName: 'VettidOrgDnsStack', account: '449757308783', state: 'in-sync' as const };

  test('lists the drifted stack, its age and the commits merged since', () => {
    const md = renderReport({
      results: [drift, ok],
      commitsSince: { '449757308783/VettidOrgMemberApiStack': [{ sha: 'abc1234', date: '2026-10-01T15:00:00Z', subject: 'Member API: PIN lockout fix (#99)' }] },
      now,
      head: 'abc1234',
    });
    expect(md).toContain('1 of 2 production stacks');
    expect(md).toContain('### VettidOrgMemberApiStack (449757308783): differs from master');
    expect(md).toContain('4 days ago');
    expect(md).toContain('- abc1234 2026-10-01 Member API: PIN lockout fix (#99)');
    expect(md).toContain('In sync: VettidOrgDnsStack.');
  });

  test('all in sync: no attention, stable fingerprint', () => {
    expect(needsAttention([ok])).toEqual([]);
    expect(renderReport({ results: [ok], commitsSince: {}, now, head: 'abc1234' })).toContain('no drift');
    expect(fingerprint([drift, ok])).toBe('<!-- drift:449757308783/VettidOrgMemberApiStack:drift -->');
  });
});

describe('source-map paths (asset hashes independent of where the app is synthesized)', () => {
  const root = '/home/al/VettID/vettid.org';
  const map = (sources: string[]) =>
    `{\n  "version": 3,\n  "sources": [${sources.map((s) => JSON.stringify(s)).join(', ')}],\n  "sourcesContent": ["x", "y"],\n  "mappings": "AAAA"\n}\n`;

  test('the default cdk.out layout is left byte-for-byte unchanged', () => {
    const text = map(['../../node_modules/a/index.js', '../../lambda/member/auth.ts']);
    expect(normalizeSourceMap(text, `${root}/cdk.out/bundling-temp-123`, root)).toBe(text);
  });

  test('any other output location gives the same bytes as the default', () => {
    const elsewhere = map(['../../../../../home/al/VettID/vettid.org/node_modules/a/index.js', '../../../../../home/al/VettID/vettid.org/lambda/member/auth.ts']);
    expect(normalizeSourceMap(elsewhere, '/tmp/claude/out/x/bundling-temp-9', root))
      .toBe(map(['../../node_modules/a/index.js', '../../lambda/member/auth.ts']));
  });

  test('a map without esbuild\'s layout fails loudly', () => {
    expect(() => normalizeSourceMap('{"version":3,"sources":[]}', '/x', '/')).toThrow(/sources/);
  });

  test('sourcemap-only difference → same asset hash → no drift (real esbuild bundles)', () => {
    const dirs: string[] = [];
    const synth = (nested: string[]) => {
      const top = mkdtempSync(join(tmpdir(), 'drift-outdir-'));
      dirs.push(top);
      const app = new cdk.App({ outdir: join(top, ...nested) });
      const stack = new cdk.Stack(app, 'S', { env: { account: '123456789012', region: 'us-east-1' } });
      new ApiFunction(stack, 'Fn', { entry: 'test/fixtures/handler.ts' });
      return Template.fromStack(stack).toJSON();
    };
    try {
      const a = synth([]);
      const b = synth(['deeper', 'than', 'the', 'other']);
      const key = (t: any) => Object.values<any>(t.Resources).find((r) => r.Type === 'AWS::Lambda::Function').Properties.Code.S3Key;
      expect(key(a)).toBe(key(b));
      expect(compareStack({ stackName: 'S', account: '123456789012', synthesized: a, deployed: deployedOf(b) }).state).toBe('in-sync');
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});
