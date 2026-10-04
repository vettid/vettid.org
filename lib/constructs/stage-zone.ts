import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import { readRef } from './ssm-refs';

/**
 * The hosted zone a stage's sites put their records and certificate
 * validation in (construct id `Zone`).
 *
 *  - prod: vettid.org, looked up (VettidOrgDnsStack; the lookup is cached in
 *    cdk.context.json). Unchanged from before staging existed.
 *  - other stages: `<stage>.vettid.org` (config.zoneName), owned by
 *    VettidOrgStageDnsStack in the stage's account, whose ID is read from
 *    SSM at deploy time. No lookup: a staging synth must work before the
 *    zone exists (the zone's own stack is in the same app).
 */
export function stageZone(scope: Construct, config: AppConfig): route53.IHostedZone {
  if (config.stage === 'prod') {
    return route53.HostedZone.fromLookup(scope, 'Zone', { domainName: config.domainName });
  }
  return route53.HostedZone.fromHostedZoneAttributes(scope, 'Zone', {
    hostedZoneId: readRef(scope, config, 'dns/zone-id'),
    zoneName: config.zoneName,
  });
}
