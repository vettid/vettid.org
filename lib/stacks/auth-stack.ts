import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { ApiFunction } from '../constructs/api-function';
import { publishRef } from '../constructs/ssm-refs';
import { tableEnv, tableGrant } from '../constructs/table-grants';

export interface VettidOrgAuthStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Stateful: the member and admin Cognito user pools (and the PIN pepper).
 * Rarely deployed; everything here is retained and deletion-protected.
 * Consumers read IDs through SSM refs, never stack exports.
 *
 * Member sign-in is magic link + optional PIN via Cognito custom auth; the
 * three challenge triggers live here with the pool (in the member API stack
 * they'd make the two stacks depend on each other). Members never use
 * passwords or the hosted UI.
 *
 * Admins sign in through the Cognito hosted UI (authorization code + PKCE)
 * with TOTP MFA required. Network-level restriction of the admin pool (WAF
 * allowlist on the exit-node IP) lives in VettidOrgAdminAccessStack, so this
 * stack never changes when the admin network does.
 */
export class VettidOrgAuthStack extends cdk.Stack {
  readonly memberPool: cognito.UserPool;
  readonly adminPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: VettidOrgAuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Cognito-sent mail (admin invitations / temporary passwords) goes through
    // the verified vettid.org SES domain identity. SES is in the sandbox by
    // decision, so recipients must be verified identities first.
    const email = cognito.UserPoolEmail.withSES({
      fromEmail: config.senderEmail,
      fromName: 'VettID',
      sesRegion: config.region,
      sesVerifiedDomain: config.domainName,
    });

    // ---- Members --------------------------------------------------------
    this.memberPool = new cognito.UserPool(this, 'MemberPool', {
      userPoolName: resourceName(config, 'members'),
      // Lite: custom auth is all members use, and it's the cheapest plan.
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: false, // users are created by the API (code) or an admin (approval)
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: {
        user_guid: new cognito.StringAttribute({ minLen: 36, maxLen: 36, mutable: false }),
      },
      accountRecovery: cognito.AccountRecovery.NONE, // no passwords to recover
      mfa: cognito.Mfa.OFF, // the PIN is the second factor, enforced in custom auth
      email,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, 'MemberGroupRegistered', {
      userPoolId: this.memberPool.userPoolId,
      groupName: 'registered',
      description: 'Approved or code-registered; may use the account site',
    });
    new cognito.CfnUserPoolGroup(this, 'MemberGroupMember', {
      userPoolId: this.memberPool.userPoolId,
      groupName: 'member',
      description: 'Accepted the current membership terms',
    });

    const memberClient = this.memberPool.addClient('MemberClient', {
      userPoolClientName: resourceName(config, 'account-site'),
      generateSecret: false,
      authFlows: { custom: true }, // magic link (+ PIN) only
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      authSessionValidity: cdk.Duration.minutes(5), // magic link → PIN step window
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, emailVerified: true })
        .withCustomAttributes('user_guid'),
      writeAttributes: new cognito.ClientAttributes(), // nothing user-writable
    });

    // ---- Admins ---------------------------------------------------------
    this.adminPool = new cognito.UserPool(this, 'AdminPool', {
      userPoolName: resourceName(config, 'admins'),
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
        passwordHistorySize: 5,
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'VettID admin access',
        emailBody:
          'You have been added as a VettID administrator.<br><br>' +
          'Username: {username}<br>Temporary password: {####}<br><br>' +
          `Connect to the admin tailnet (exit node on), then sign in at https://${hostName(config, 'admin')}/ ` +
          'within 3 days. You will set a new password and enroll an authenticator app.',
      },
      email,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.adminPool.userPoolId,
      groupName: 'admin',
      description: 'VettID administrators (single role by design)',
    });

    // Hosted UI on a Cognito-prefixed domain: no extra cert or DNS, and the
    // WAF allowlist in AdminAccessStack covers it. Prefix is global, so it's
    // stage-scoped via resourceName.
    const adminDomainPrefix = resourceName(config, 'admin');
    this.adminPool.addDomain('AdminLoginDomain', { cognitoDomain: { domainPrefix: adminDomainPrefix } });
    const adminLoginHost = `${adminDomainPrefix}.auth.${config.region}.amazoncognito.com`;

    const adminUrl = `https://${hostName(config, 'admin')}/`;
    const adminClient = this.adminPool.addClient('AdminClient', {
      userPoolClientName: resourceName(config, 'admin-site'),
      generateSecret: false,
      authFlows: {}, // hosted UI only; no direct password APIs from the browser
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [adminUrl],
        logoutUrls: [adminUrl],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(30),
      idTokenValidity: cdk.Duration.minutes(30),
      refreshTokenValidity: cdk.Duration.hours(8), // one working session
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true, emailVerified: true }),
      // vettid-dev let admins write custom:admin_type (self-escalation). Nothing is writable here.
      writeAttributes: new cognito.ClientAttributes(),
    });

    // ---- PIN pepper -----------------------------------------------------
    // PINs are stored as HMAC-SHA-256(pepper, user_guid || pin). The pepper
    // never leaves Secrets Manager + the auth Lambdas; a table dump alone
    // can't brute-force 4–6 digit PINs.
    const pinPepper = new secretsmanager.Secret(this, 'PinPepper', {
      secretName: `${resourceName(config, 'auth')}/pin-pepper`,
      description: 'HMAC pepper for member PIN hashes. Rotating it invalidates all PINs.',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---- Member custom-auth triggers ----------------------------------------
    const env = { ...tableEnv(config), PIN_PEPPER_SECRET_ARN: pinPepper.secretArn };
    const trigger = (id: string, file: string) =>
      new ApiFunction(this, id, { entry: `lambda/triggers/${file}.ts`, environment: env, timeout: cdk.Duration.seconds(5) }).fn;
    const define = trigger('DefineAuthChallenge', 'define-auth-challenge');
    const create = trigger('CreateAuthChallenge', 'create-auth-challenge');
    const verify = trigger('VerifyAuthChallenge', 'verify-auth-challenge');
    this.memberPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE, define);
    this.memberPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE, create);
    this.memberPool.addTrigger(cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE, verify);

    tableGrant(this, config, define, 'members', ['GetItem']);
    tableGrant(this, config, verify, 'members', ['GetItem']);
    tableGrant(this, config, verify, 'magic-links', ['UpdateItem']); // consume a link (conditional)
    tableGrant(this, config, verify, 'ratelimits', ['GetItem', 'UpdateItem', 'DeleteItem']); // PIN lockout
    pinPepper.grantRead(verify);

    publishRef(this, config, 'auth/member-pool-id', this.memberPool.userPoolId);
    publishRef(this, config, 'auth/member-pool-arn', this.memberPool.userPoolArn);
    publishRef(this, config, 'auth/member-client-id', memberClient.userPoolClientId);
    publishRef(this, config, 'auth/admin-pool-id', this.adminPool.userPoolId);
    publishRef(this, config, 'auth/admin-pool-arn', this.adminPool.userPoolArn);
    publishRef(this, config, 'auth/admin-client-id', adminClient.userPoolClientId);
    publishRef(this, config, 'auth/admin-login-domain', adminLoginHost);
    publishRef(this, config, 'auth/pin-pepper-secret-arn', pinPepper.secretArn);
  }
}
