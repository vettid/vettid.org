import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ApiFunctionProps {
  /** Path to the handler's TypeScript entry, relative to the repo root (e.g. 'lambda/member/account.ts'). */
  readonly entry: string;
  /** Exported handler name. Default 'handler'. */
  readonly handler?: string;
  readonly environment?: Record<string, string>;
  readonly timeout?: cdk.Duration;
  readonly memorySize?: number;
  readonly description?: string;
  /** Fixed physical name; only when something must reference the function by name. */
  readonly functionName?: string;
}

/**
 * The one way this repo defines a Node Lambda: bundled with esbuild, ARM64,
 * Node 24, and an explicit log group with bounded retention (no deprecated
 * `logRetention` custom resource). The AWS SDK is bundled too, at the
 * versions in package-lock.json: deploys are reproducible, and helpers the
 * runtime doesn't ship (e.g. the S3 presigner) just work.
 *
 * Keep per-function knobs here few on purpose — differences between
 * functions should be the code and the grants, not the packaging.
 */
export class ApiFunction extends Construct {
  readonly fn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiFunctionProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fn = new lambdaNode.NodejsFunction(this, 'Fn', {
      entry: props.entry,
      handler: props.handler ?? 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? cdk.Duration.seconds(10),
      description: props.description,
      functionName: props.functionName,
      logGroup,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ...props.environment,
      },
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node24',
        minify: true,
        sourceMap: true,
        externalModules: [],
        // ESM bundles of CJS deps need `require` available.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
