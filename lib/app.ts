import * as cdk from 'aws-cdk-lib/core';
import { loadConfig } from './config';
import { VettidOrgStack } from './stacks/web-stack';
import { VettidOrgDnsStack } from './stacks/dns-stack';
import { VettidOrgSignupStack } from './stacks/signup-stack';
import { VettidDevRedirectStack } from './stacks/dev-redirect-stack';
import { VettidOrgPlaybooksStack } from './stacks/playbooks-stack';
import { VettidOrgAuthStack } from './stacks/auth-stack';
import { VettidOrgDataStack } from './stacks/data-stack';
import { VettidOrgAdminAccessStack } from './stacks/admin-access-stack';
import { VettidOrgAdminApiStack } from './stacks/admin-api-stack';
import { VettidOrgAdminSiteStack } from './stacks/admin-site-stack';

/**
 * Builds every stack in the vettid.org app. Kept out of bin/ so tests can
 * synthesize the whole app (see test/app-guardrails.test.ts).
 *
 * Stack groups (see docs/ACCOUNT-ADMIN-PLAN.md §3):
 *  - public site: Dns, Signup, Playbooks, VettidOrgStack, VettidDevRedirect
 *    (pre-existing; their construct IDs must not change)
 *  - stateful:  Auth, Data, AdminAccess       (rarely deployed, RETAIN)
 *  - stateless: MemberApi, AccountSite, AdminApi, AdminSite
 *  Stateful → stateless references go through SSM (lib/constructs/ssm-refs.ts),
 *  never CloudFormation exports.
 */
export function buildApp(app: cdk.App): void {
  const config = loadConfig(app.node);

  // Everything lives in us-east-1: CloudFront certs and CLOUDFRONT-scope WAF
  // require it, and one region keeps the growing environment simple.
  const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  };

  const domainName = config.domainName;

  // Deploy order: SignupStack and DnsStack first, then VettidOrgStack
  // (the web stack consumes both via props).
  //   npx cdk deploy VettidOrgDnsStack VettidOrgSignupStack VettidOrgStack

  const dns = new VettidOrgDnsStack(app, 'VettidOrgDnsStack', {
    domainName,
    env,
  });

  const signup = new VettidOrgSignupStack(app, 'VettidOrgSignupStack', { hostedZone: dns.zone, env });

  const playbooks = new VettidOrgPlaybooksStack(app, 'VettidOrgPlaybooksStack', { env });

  new VettidOrgStack(app, 'VettidOrgStack', {
    domainName,
    enableCustomDomain: true,
    hostedZone: dns.zone,
    apiDomain: signup.apiDomain,
    playbooksBucket: playbooks.bucket,
    env,
  });

  // The whole remaining vettid.dev footprint: a blanket 301 to vettid.org.
  // Deploy only after the old VettIDStack is deleted (alias exclusivity).
  new VettidDevRedirectStack(app, 'VettidDevRedirectStack', { env });

  // ---- Account + admin (docs/ACCOUNT-ADMIN-PLAN.md) ----
  // Deploy order: Auth, Data → AdminAccess (reads the admin pool ARN via SSM)
  //   → AdminApi, AdminSite (read pool/client IDs, egress IP, web ACL via SSM).
  new VettidOrgAuthStack(app, 'VettidOrgAuthStack', { config, env });
  new VettidOrgDataStack(app, 'VettidOrgDataStack', { config, env });
  if (config.adminAccess.headscaleLoginServer) {
    new VettidOrgAdminAccessStack(app, 'VettidOrgAdminAccessStack', { config, env });
  } else {
    cdk.Annotations.of(app).addWarningV2(
      'vettid:admin-access-unconfigured',
      'VettidOrgAdminAccessStack skipped: set context "headscaleLoginServer" in ~/.cdk.json',
    );
  }
  new VettidOrgAdminApiStack(app, 'VettidOrgAdminApiStack', { config, env });
  new VettidOrgAdminSiteStack(app, 'VettidOrgAdminSiteStack', { config, env });
}
