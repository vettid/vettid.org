import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig, loadConfig, timeScaleEnv } from '../lib/config';
import { VettidOrgAdminApiStack } from '../lib/stacks/admin-api-stack';
import { VettidOrgAuthStack } from '../lib/stacks/auth-stack';
import { VettidOrgMemberApiStack } from '../lib/stacks/member-api-stack';

/**
 * The staging time scale in the CDK app (MEMBER-API 2.8.0 "Staging time
 * scale"; STAGING-TIME-SCALE §4 item 5, §5.6): production is 1 in code and
 * refuses any other value; only the staging stage takes 24 (with the first
 * vault release that ships `time_scale`), and passes it only to the
 * functions that own a scaled wait. cdk.json shipped staging at 1 (the
 * rollout). Bundling is skipped: templates only.
 */

const env = { account: '123456789012', region: 'us-east-1' };
const stagingEnv = { account: '347272280361', region: 'us-east-1' };
const newApp = (context: Record<string, unknown> = {}) => new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
const ON = { stage: 'staging', stagingTimeScale: 24, stagingTimeScaleFromRelease: 18 };

/** Each Lambda function's logical id and its environment variables. */
function fnEnv(stack: cdk.Stack): Array<[string, Record<string, unknown>]> {
  return Object.entries<any>(Template.fromStack(stack).findResources('AWS::Lambda::Function'))
    .map(([id, f]) => [id, f.Properties.Environment?.Variables ?? {}]);
}
const scaled = (stack: cdk.Stack) => fnEnv(stack).filter(([, v]) => 'TIME_SCALE' in v || 'STAGE' in v || 'TIME_SCALE_FROM_RELEASE' in v);
const rows = (stack: cdk.Stack) => scaled(stack).map(([id, v]) => [id.replace(/[0-9A-F]{8}$/, ''), v.STAGE, v.TIME_SCALE, v.TIME_SCALE_FROM_RELEASE]).sort();

describe('production: the time scale is 1, in code', () => {
  test('loadConfig gives 1 and refuses any context that sets another value', () => {
    expect(loadConfig(newApp().node).timeScale).toBe(1);
    expect(loadConfig(newApp({ prodTimeScale: 1 }).node).timeScale).toBe(1);
    for (const ctx of [{ timeScale: 24 }, { prodTimeScale: 24 }, { prodTimeScale: '24' }, { timeScale: 2 }, { prodTimeScale: 0 }, { stage: 'prod', prodTimeScale: 24 }, { prodTimeScaleFromRelease: 18 }, { timeScaleFromRelease: 18 }]) {
      expect(() => loadConfig(newApp(ctx).node)).toThrow(/production time scale is 1/);
    }
    // A staging value never reaches a prod synth.
    expect(loadConfig(newApp({ stagingTimeScale: 24, stagingTimeScaleFromRelease: 18 }).node).timeScale).toBe(1);
  });

  test('the stacks refuse a production config with a scale other than 1, however it was built', () => {
    const forged = { ...loadConfig(newApp().node), timeScale: 24, timeScaleFromRelease: 18 } as AppConfig;
    expect(() => timeScaleEnv(forged)).toThrow(/production time scale is 1/);
    expect(() => new VettidOrgAuthStack(newApp(), 'Auth', { config: forged, env })).toThrow(/production time scale is 1/);
    expect(() => new VettidOrgMemberApiStack(newApp(), 'MemberApi', { config: forged, env })).toThrow(/production time scale is 1/);
    expect(() => new VettidOrgAdminApiStack(newApp(), 'AdminApi', { config: forged, env })).toThrow(/production time scale is 1/);
  });

  test('no production function has STAGE, TIME_SCALE or TIME_SCALE_FROM_RELEASE (the functions then use real time)', () => {
    const config = loadConfig(newApp().node);
    expect(timeScaleEnv(config)).toEqual({});
    expect(scaled(new VettidOrgAuthStack(newApp(), 'Auth', { config, env }))).toEqual([]);
    expect(scaled(new VettidOrgMemberApiStack(newApp(), 'MemberApi', { config, env }))).toEqual([]);
    expect(scaled(new VettidOrgAdminApiStack(newApp(), 'AdminApi', { config, env }))).toEqual([]);
  });

  test('rollout: cdk.json has staging at 24 from release 18 (the first vault release with time_scale, published 2026-10-19), nothing for production', () => {
    const ctx = JSON.parse(readFileSync(join(__dirname, '..', 'cdk.json'), 'utf8')).context;
    expect(ctx.stagingTimeScale).toBe(24);
    expect(ctx.stagingTimeScaleFromRelease).toBe(18);
    for (const k of ['timeScale', 'prodTimeScale', 'timeScaleFromRelease', 'prodTimeScaleFromRelease']) expect(ctx[k]).toBeUndefined();
    expect(loadConfig(newApp({ stage: 'staging', stagingTimeScale: ctx.stagingTimeScale, stagingTimeScaleFromRelease: ctx.stagingTimeScaleFromRelease }).node).timeScale).toBe(24);
    expect(loadConfig(newApp({ stage: 'prod', ...ctx }).node).timeScale).toBe(1);
  });
});

describe('staging: 1 or 24 (staging only), only on the functions that own a scaled wait', () => {
  test('loadConfig: stagingTimeScale 1 or 24, default 1, anything else refused; 24 needs the release that ships time_scale', () => {
    expect(loadConfig(newApp({ stage: 'staging' }).node).timeScale).toBe(1);
    expect(loadConfig(newApp({ stage: 'staging', stagingTimeScale: 1 }).node).timeScale).toBe(1);
    expect(loadConfig(newApp(ON).node)).toMatchObject({ timeScale: 24, timeScaleFromRelease: 18 });
    expect(loadConfig(newApp({ ...ON, stagingTimeScale: '24', stagingTimeScaleFromRelease: '18' }).node)).toMatchObject({ timeScale: 24, timeScaleFromRelease: 18 });
    for (const v of [0, 2, 12, 48, 3600, 'x', -24]) {
      expect(() => loadConfig(newApp({ ...ON, stagingTimeScale: v }).node)).toThrow(/expected 1 or 24/);
    }
    expect(() => loadConfig(newApp({ stage: 'staging', stagingTimeScale: 24 }).node)).toThrow(/stagingTimeScaleFromRelease: required/);
    for (const v of [0, -1, 1.5, 'x', '']) {
      expect(() => loadConfig(newApp({ ...ON, stagingTimeScaleFromRelease: v }).node)).toThrow(/expected a release number/);
    }
  });

  test('only the staging stage may have 24: another non-prod stage is 1, and refuses 24', () => {
    expect(loadConfig(newApp({ stage: 'dev' }).node).timeScale).toBe(1);
    expect(loadConfig(newApp({ stage: 'dev', devTimeScale: 1 }).node).timeScale).toBe(1);
    expect(() => loadConfig(newApp({ stage: 'dev', devTimeScale: 24, devTimeScaleFromRelease: 18 }).node)).toThrow(/only the staging stage/);
    expect(() => loadConfig(newApp({ stage: 'dev', devTimeScaleFromRelease: 18 }).node)).toThrow(/only the staging stage/);
    const forged = { ...loadConfig(newApp({ stage: 'dev' }).node), timeScale: 24, timeScaleFromRelease: 18 } as AppConfig;
    expect(() => timeScaleEnv(forged)).toThrow(/only the staging stage/);
  });

  test('at 24: STAGE, TIME_SCALE and TIME_SCALE_FROM_RELEASE on the account and vault routes, the sign-in PIN check and the admin member routes, nowhere else', () => {
    const config = loadConfig(newApp(ON).node);
    expect(rows(new VettidOrgAuthStack(newApp(ON), 'Auth', { config, env: stagingEnv }))).toEqual([['VerifyAuthChallengeFn', 'staging', '24', '18']]);
    expect(rows(new VettidOrgMemberApiStack(newApp(ON), 'MemberApi', { config, env: stagingEnv }))).toEqual([
      ['AccountFunctionFn', 'staging', '24', '18'],
      ['VaultFunctionFn', 'staging', '24', '18'],
    ]);
    const admin = rows(new VettidOrgAdminApiStack(newApp(ON), 'AdminApi', { config, env: stagingEnv }));
    expect(admin).toHaveLength(1);
    expect(admin[0][0]).toMatch(/^People/);
    expect(admin[0].slice(1)).toEqual(['staging', '24', '18']);
  });

  test('at 1: no function has any of them (real time)', () => {
    const ctx = { stage: 'staging', stagingTimeScale: 1 };
    const config = loadConfig(newApp(ctx).node);
    expect(scaled(new VettidOrgAuthStack(newApp(ctx), 'Auth', { config, env }))).toEqual([]);
    expect(scaled(new VettidOrgMemberApiStack(newApp(ctx), 'MemberApi', { config, env }))).toEqual([]);
    expect(scaled(new VettidOrgAdminApiStack(newApp(ctx), 'AdminApi', { config, env }))).toEqual([]);
  });
});
