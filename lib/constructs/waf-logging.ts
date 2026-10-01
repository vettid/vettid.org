import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface WafLoggingProps {
  /** ARN of the web ACL to log. */
  readonly webAclArn: string;
  /** CloudWatch log group name; WAF requires the `aws-waf-logs-` prefix. */
  readonly logGroupName: string;
}

/**
 * WAF request logging to CloudWatch, as the public site does it
 * (lib/stacks/web-stack.ts): 90-day retention, group retained on stack
 * delete, and credential-bearing headers (cookie, authorization) redacted
 * (logging spec §5).
 */
export class WafLogging extends Construct {
  readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: WafLoggingProps) {
    super(scope, id);
    if (!props.logGroupName.startsWith('aws-waf-logs-')) {
      throw new Error(`WAF log group names must start with aws-waf-logs- (got ${props.logGroupName})`);
    }
    this.logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: props.logGroupName,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new wafv2.CfnLoggingConfiguration(this, 'Config', {
      resourceArn: props.webAclArn,
      // WAF wants the log group ARN without the trailing :* of logGroupArn.
      logDestinationConfigs: [
        cdk.Stack.of(this).formatArn({
          service: 'logs',
          resource: 'log-group',
          resourceName: this.logGroup.logGroupName,
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      redactedFields: [{ singleHeader: { Name: 'cookie' } }, { singleHeader: { Name: 'authorization' } }],
    });
  }
}
