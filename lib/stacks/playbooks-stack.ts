import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';

/**
 * Origin bucket for the /playbooks/* section (see docs/playbooks-design-spec.md).
 * Content is built and synced by the separate vettid-playbooks repo:
 *
 *   aws s3 sync dist/ s3://vettid-org-playbooks/playbooks/ --delete
 *   aws cloudfront create-invalidation --paths "/playbooks/*"
 *
 * The web stack attaches this bucket as a path-routed CloudFront origin, so
 * playbooks content deploys independently of the main site.
 */
export class VettidOrgPlaybooksStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'PlaybooksBucket', {
      bucketName: 'vettid-org-playbooks',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
    });

    new cdk.CfnOutput(this, 'PlaybooksBucketName', {
      value: this.bucket.bucketName,
      description: 'Origin bucket for /playbooks/* (synced by the vettid-playbooks repo)',
    });
  }
}
