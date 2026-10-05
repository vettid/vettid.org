import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import { publishRef } from '../constructs/ssm-refs';
import { amazonOnlyCaa } from './dns-stack';

export interface VettidOrgStageDnsStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Stateful, non-prod stages only (staging: VAULT-RELEASES §11.1, W9): the
 * stage's own public zone `<stage>.vettid.org` in the stage's account, and
 * the SES domain identity that the stage's system mail is sent from
 * (no-reply@<stage>.vettid.org; Easy DKIM, its three CNAMEs land here).
 *
 * The zone answers only once vettid.org delegates to it:
 * VettidOrgStagingDelegationStack in prod, from context `stagingZoneNs`
 * (this stack's output NameServers; RUNBOOK "Staging"). Until then nothing
 * under the stage name resolves, so certificates for the stage's sites
 * cannot validate: deploy this stack, then the delegation, then the rest.
 *
 * No MX and no SPF: nothing receives mail at <stage>.vettid.org itself
 * (only the test subdomain test.<stage>.vettid.org does, with its own MX:
 * VettidOrgStageTestMailStack), SES's MAIL FROM is its own
 * domain, and DKIM (aligned with the organizational domain vettid.org)
 * carries DMARC, whose policy the stage inherits from vettid.org.
 */
export class VettidOrgStageDnsStack extends cdk.Stack {
  readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: VettidOrgStageDnsStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.stage === 'prod') throw new Error('VettidOrgStageDnsStack is for non-prod stages (prod: VettidOrgDnsStack)');

    this.zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: config.zoneName,
      comment: `${config.zoneName} (stage ${config.stage}) — managed by VettidOrgStageDnsStack; delegated from vettid.org`,
    });
    // A new zone gets new name servers, and the delegation in vettid.org
    // names these: keep it through a stray stack delete.
    this.zone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // As in vettid.org: only ACM may issue, no wildcards.
    amazonOnlyCaa(this, 'Caa', this.zone);

    // The stage's sending domain. In the SES sandbox (staging stays there):
    // every recipient must be a verified identity in this account, which is
    // the project's opt-in pattern anyway (RUNBOOK "Mailing list").
    new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.publicHostedZone(this.zone),
    });

    publishRef(this, config, 'dns/zone-id', this.zone.hostedZoneId);

    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(',', this.zone.hostedZoneNameServers ?? []),
      description: `Put into cdk.json context "${config.stage}ZoneNs" and deploy the delegation in prod (RUNBOOK "Staging")`,
    });
    new cdk.CfnOutput(this, 'ZoneId', { value: this.zone.hostedZoneId, description: 'Hosted zone ID' });
  }
}
