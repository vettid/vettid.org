import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import { stageZone } from '../constructs/stage-zone';

export interface VettidOrgStageDelegationStackProps extends cdk.StackProps {
  /** The prod configuration (this stack lives in the management account). */
  readonly config: AppConfig;
  /** The delegated stage, e.g. `staging` → staging.vettid.org. */
  readonly stage: string;
  /** The stage zone's four name servers (VettidOrgStageDnsStack output NameServers). */
  readonly nameServers: string[];
}

/**
 * Prod app, management account: one NS record in the vettid.org zone that
 * delegates `<stage>.vettid.org` to the stage account's zone.
 *
 * A stack of its own rather than a record in VettidOrgDnsStack: deploying it
 * cannot touch any existing vettid.org record (it owns exactly this one
 * record, and CloudFormation refuses to create it over an existing one),
 * and it is built only when context `<stage>ZoneNs` is set, so prod's other
 * stacks never change because of staging. Removing the context does not
 * delete the stack (CDK never deletes stacks); `cdk destroy` does.
 */
export class VettidOrgStageDelegationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgStageDelegationStackProps) {
    super(scope, id, props);
    const { config, stage, nameServers } = props;
    if (config.stage !== 'prod') throw new Error('the stage delegation lives in the prod app (vettid.org zone)');
    if (stage === 'prod' || nameServers.length !== 4) throw new Error(`delegation of ${stage}: four name servers required`);

    new route53.NsRecord(this, 'Delegation', {
      zone: stageZone(this, config), // vettid.org (cached lookup)
      recordName: `${stage}.${config.domainName}`,
      values: nameServers.map((ns) => `${ns}.`),
      // Short, so a recreated stage zone (new name servers) takes over
      // within the hour instead of the usual two days.
      ttl: cdk.Duration.hours(1),
    });
  }
}
