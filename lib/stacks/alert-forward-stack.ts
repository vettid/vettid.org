import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ALERT_FORWARDER_ROLE_NAME, ALERT_FORWARDER_RULE_NAME, ORG } from '../config';

/** The management account's default event bus, where VettidOrgAuditStack's alert rules run. */
export const MANAGEMENT_BUS_ARN = `arn:aws:events:us-east-1:${ORG.management}:event-bus/default`;

/**
 * Security-alert forwarding for one member account of the organization
 * (vettid-vault-prod, vettid-vault-staging, proteus; docs/AWS-ACCOUNTS.md).
 *
 * CloudTrail delivers an account's management events to that account's own
 * default event bus only; the organization trail records them centrally but
 * does not put them on the management account's bus. So each member account
 * gets exactly one rule that forwards its CloudTrail events, unfiltered
 * except for read-only calls, to the management account's default bus.
 * VettidOrgAuditStack matches and emails them there: one place for the rules,
 * the allow-lists and the SNS subscription (RUNBOOK "Security alerts").
 *
 * us-east-1 only: global events (IAM, STS, sign-in, Organizations, Identity
 * Center) land there, and the Workloads SCP denies every other region.
 * GuardDuty findings are not forwarded: the management account is the
 * GuardDuty administrator and already receives every member's findings.
 *
 * Deploy after VettidOrgAuditStack (its bus policy admits this stack's role).
 */
export class VettidOrgAlertForwardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const role = new iam.Role(this, 'ForwarderRole', {
      roleName: ALERT_FORWARDER_ROLE_NAME,
      description: 'EventBridge: forward security events to the management account bus (VettidOrgAuditStack)',
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    });
    role.addToPolicy(new iam.PolicyStatement({ actions: ['events:PutEvents'], resources: [MANAGEMENT_BUS_ARN] }));

    new events.Rule(this, 'Forward', {
      ruleName: ALERT_FORWARDER_RULE_NAME,
      description: 'Forward CloudTrail write events and console sign-ins to the management account (VettID security alerts)',
      eventPattern: {
        detailType: ['AWS API Call via CloudTrail', 'AWS Console Sign In via CloudTrail'],
        // Writes only (including denied attempts). An event without the field
        // is forwarded too: anything-but never matches a missing field.
        detail: { $or: [{ readOnly: [false] }, { readOnly: events.Match.doesNotExist() }] },
      },
      targets: [new targets.EventBus(events.EventBus.fromEventBusArn(this, 'ManagementBus', MANAGEMENT_BUS_ARN), { role })],
    });
  }
}
