import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig, loadConfig, timeScaleEnv } from '../lib/config';
import { VettidOrgAuthStack } from '../lib/stacks/auth-stack';
import { VettidOrgMemberApiStack } from '../lib/stacks/member-api-stack';

/**
 * The staging time scale in the CDK app (MEMBER-API 2.8.0 "Staging time
 * scale"; STAGING-TIME-SCALE §4 item 5, §5.6): production is 1 in code and
 * refuses any other value; staging takes 1 or 24 and passes it only to the
 * functions that own a scaled wait. Bundling is skipped: templates only.
 */

const env = { account: '123456789012', region: 'us-east-1' };
const newApp = (context: Record<string, unknown> = {}) => new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });

/** Each Lambda function's logical id and its environment variables. */
function fnEnv(stack: cdk.Stack): Array<[string, Record<string, unknown>]> {
  return Object.entries<any>(Template.fromStack(stack).findResources('AWS::Lambda::Function'))
    .map(([id, f]) => [id, f.Properties.Environment?.Variables ?? {}]);
}
const scaled = (stack: cdk.Stack) => fnEnv(stack).filter(([, v]) => 'TIME_SCALE' in v || 'STAGE' in v);

describe('production: the time scale is 1, in code', () => {
  test('loadConfig gives 1 and refuses any context that sets another value', () => {
    expect(loadConfig(newApp().node).timeScale).toBe(1);
    expect(loadConfig(newApp({ prodTimeScale: 1 }).node).timeScale).toBe(1);
    for (const ctx of [{ timeScale: 24 }, { prodTimeScale: 24 }, { prodTimeScale: '24' }, { timeScale: 2 }, { prodTimeScale: 0 }, { stage: 'prod', prodTimeScale: 24 }]) {
      expect(() => loadConfig(newApp(ctx).node)).toThrow(/production time scale is 1/);
    }
    // A staging value never reaches a prod synth.
    expect(loadConfig(newApp({ stagingTimeScale: 24 }).node).timeScale).toBe(1);
  });

  test('the stacks refuse a production config with a scale other than 1, however it was built', () => {
    const forged = { ...loadConfig(newApp().node), timeScale: 24 } as AppConfig;
    expect(() => timeScaleEnv(forged)).toThrow(/production time scale is 1/);
    expect(() => new VettidOrgAuthStack(newApp(), 'Auth', { config: forged, env })).toThrow(/production time scale is 1/);
    expect(() => new VettidOrgMemberApiStack(newApp(), 'MemberApi', { config: forged, env })).toThrow(/production time scale is 1/);
  });

  test('no production function has STAGE or TIME_SCALE (the functions then use real time)', () => {
    const config = loadConfig(newApp().node);
    expect(timeScaleEnv(config)).toEqual({});
    expect(scaled(new VettidOrgAuthStack(newApp(), 'Auth', { config, env }))).toEqual([]);
    expect(scaled(new VettidOrgMemberApiStack(newApp(), 'MemberApi', { config, env }))).toEqual([]);
  });

  test('cdk.json sets the staging scale to 24 and nothing for production', () => {
    const ctx = JSON.parse(readFileSync(join(__dirname, '..', 'cdk.json'), 'utf8')).context;
    expect(ctx.stagingTimeScale).toBe(24);
    expect(ctx.timeScale).toBeUndefined();
    expect(ctx.prodTimeScale).toBeUndefined();
  });
});

describe('staging: 1 or 24, only on the functions that own a scaled wait', () => {
  test('loadConfig: stagingTimeScale 1 or 24, default 1, anything else refused', () => {
    expect(loadConfig(newApp({ stage: 'staging' }).node).timeScale).toBe(1);
    expect(loadConfig(newApp({ stage: 'staging', stagingTimeScale: 1 }).node).timeScale).toBe(1);
    expect(loadConfig(newApp({ stage: 'staging', stagingTimeScale: 24 }).node).timeScale).toBe(24);
    expect(loadConfig(newApp({ stage: 'staging', stagingTimeScale: '24' }).node).timeScale).toBe(24);
    for (const v of [0, 2, 12, 48, 3600, 'x', -24]) {
      expect(() => loadConfig(newApp({ stage: 'staging', stagingTimeScale: v }).node)).toThrow(/expected 1 or 24/);
    }
  });

  test('at 24: STAGE and TIME_SCALE on the account and vault routes (S15, S14) and the sign-in PIN check (S15), nowhere else', () => {
    const ctx = { stage: 'staging', stagingTimeScale: 24 };
    const config = loadConfig(newApp(ctx).node);
    const auth = scaled(new VettidOrgAuthStack(newApp(ctx), 'Auth', { config, env: { account: '347272280361', region: 'us-east-1' } }));
    expect(auth.map(([id, v]) => [id.replace(/[0-9A-F]{8}$/, ''), v.STAGE, v.TIME_SCALE])).toEqual([['VerifyAuthChallengeFn', 'staging', '24']]);
    const api = scaled(new VettidOrgMemberApiStack(newApp(ctx), 'MemberApi', { config, env: { account: '347272280361', region: 'us-east-1' } }));
    expect(api.map(([id, v]) => [id.replace(/[0-9A-F]{8}$/, ''), v.STAGE, v.TIME_SCALE]).sort()).toEqual([
      ['AccountFunctionFn', 'staging', '24'],
      ['VaultFunctionFn', 'staging', '24'],
    ]);
  });

  test('at 1: no function has either (real time)', () => {
    const ctx = { stage: 'staging', stagingTimeScale: 1 };
    const config = loadConfig(newApp(ctx).node);
    expect(scaled(new VettidOrgAuthStack(newApp(ctx), 'Auth', { config, env }))).toEqual([]);
    expect(scaled(new VettidOrgMemberApiStack(newApp(ctx), 'MemberApi', { config, env }))).toEqual([]);
  });
});
