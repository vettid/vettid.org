#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { VettidOrgStack } from '../lib/vettid.org-stack';

const app = new cdk.App();

// CloudFront + ACM certificates must be in us-east-1
new VettidOrgStack(app, 'VettidOrgStack', {
  domainName: 'vettid.org',
  enableCustomDomain: true, // Set to false to deploy without custom domain first
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1', // Required for CloudFront + ACM
  },
});
