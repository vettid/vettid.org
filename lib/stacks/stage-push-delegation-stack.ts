import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import { stageZone } from '../constructs/stage-zone';

export interface VettidOrgStagePushDelegationStackProps extends cdk.StackProps {
  /** The stage's configuration (this stack lives in the stage's account, with its zone). */
  readonly config: AppConfig;
  /** The four name servers of the gateway's zone (VettidOrgPushDataStack output StagingZoneNameServers). */
  readonly nameServers: string[];
}

/**
 * A non-prod stage's app, the stage's account: one NS record in
 * `<stage>.vettid.org` that delegates `push.<stage>.vettid.org` to the zone
 * VettidOrgPushDataStack keeps in the main account, where the stage's push
 * gateway runs behind the relay's load balancer (PUSH-GATEWAY §10.4).
 *
 * The mirror of VettidOrgStageDelegationStack, one level down, and for the
 * same reasons a stack of its own: it owns exactly this record (so it can
 * touch no other record of the stage's zone), and it is built only when
 * context `<stage>PushZoneNs` is set. Nothing else of the gateway is in
 * this account, and the main account gets no access to this zone.
 */
export class VettidOrgStagePushDelegationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgStagePushDelegationStackProps) {
    super(scope, id, props);
    const { config, nameServers } = props;
    if (config.stage === 'prod') throw new Error('push.vettid.org is a record in vettid.org itself: nothing to delegate');
    if (!config.vault) throw new Error(`stage ${config.stage} has no push host`);
    if (nameServers.length !== 4) throw new Error(`delegation of ${config.vault.pushHost}: four name servers required`);

    new route53.NsRecord(this, 'Delegation', {
      zone: stageZone(this, config), // <stage>.vettid.org, by its SSM ref
      recordName: config.vault.pushHost,
      values: nameServers.map((ns) => `${ns}.`),
      // Short, as the stage's own delegation: a recreated zone takes over within the hour.
      ttl: cdk.Duration.hours(1),
    });
  }
}
