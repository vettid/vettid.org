#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { VettidOrgStack } from '../lib/stacks/web-stack';
import { VettidOrgDnsStack } from '../lib/stacks/dns-stack';
import { VettidOrgSignupStack } from '../lib/stacks/signup-stack';

const app = new cdk.App();

// Everything lives in us-east-1: CloudFront certs and CLOUDFRONT-scope WAF
// require it, and one region keeps the growing environment simple.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

const domainName = 'vettid.org';

// Deploy order: SignupStack and DnsStack first, then VettidOrgStack
// (the web stack consumes both via props).
//   npx cdk deploy VettidOrgDnsStack VettidOrgSignupStack VettidOrgStack

const dns = new VettidOrgDnsStack(app, 'VettidOrgDnsStack', {
  domainName,
  env,
});

const signup = new VettidOrgSignupStack(app, 'VettidOrgSignupStack', { env });

new VettidOrgStack(app, 'VettidOrgStack', {
  domainName,
  enableCustomDomain: true,
  hostedZone: dns.zone,
  apiDomain: signup.apiDomain,
  env,
});
