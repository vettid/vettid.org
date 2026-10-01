import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';

/**
 * CAA: only Amazon (ACM) may issue certificates for the zone, and nobody may
 * issue wildcards (we use none). Violations are reported to security@.
 * Shared with the vettid.dev zone (VettidDevRedirectStack).
 */
export function amazonOnlyCaa(scope: Construct, id: string, zone: route53.IHostedZone): route53.CaaRecord {
  return new route53.CaaRecord(scope, id, {
    zone,
    values: [
      ...['amazon.com', 'amazontrust.com', 'awstrust.com', 'amazonaws.com'].map((value) => ({
        flag: 0,
        tag: route53.CaaTag.ISSUE,
        value,
      })),
      { flag: 0, tag: route53.CaaTag.ISSUEWILD, value: ';' },
      { flag: 0, tag: route53.CaaTag.IODEF, value: 'mailto:security@vettid.org' },
    ],
  });
}

export interface VettidOrgDnsStackProps extends cdk.StackProps {
  domainName: string;
}

/**
 * Route53 hosted zone for vettid.org plus every record that currently lives
 * at Hover, replicated exactly so the nameserver cutover is seamless:
 * ProtonMail MX/SPF/DKIM/DMARC and the domain verification TXT.
 *
 * The web stack adds the apex/www ALIAS records to CloudFront (it owns the
 * distribution). After deploying this stack, point the Hover nameservers at
 * the four NS values in the stack output; nothing changes until then.
 */
export class VettidOrgDnsStack extends cdk.Stack {
  public readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: VettidOrgDnsStackProps) {
    super(scope, id, props);

    this.zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: props.domainName,
      comment: 'vettid.org — managed by VettidOrgDnsStack',
    });

    // ── ProtonMail (replicated from current Hover records) ──
    new route53.MxRecord(this, 'ProtonMx', {
      zone: this.zone,
      values: [
        { priority: 10, hostName: 'mail.protonmail.ch.' },
        { priority: 20, hostName: 'mailsec.protonmail.ch.' },
      ],
    });

    new route53.TxtRecord(this, 'ApexTxt', {
      zone: this.zone,
      values: [
        'protonmail-verification=8ca39ade1e949e50e4a5a03cca6fa02c543ffe12',
        'v=spf1 include:_spf.protonmail.ch ~all',
      ],
    });

    const dkimSuffix = 'domainkey.dya6zpy2skjplu5wgxc6wloxm3uxiixteqnu3ixutw4hahbnroacq.domains.proton.ch.';
    for (const n of ['protonmail', 'protonmail2', 'protonmail3']) {
      new route53.CnameRecord(this, `Dkim-${n}`, {
        zone: this.zone,
        recordName: `${n}._domainkey`,
        domainName: `${n}.${dkimSuffix}`,
      });
    }

    new route53.TxtRecord(this, 'Dmarc', {
      zone: this.zone,
      recordName: '_dmarc',
      // Aggregate reports to admin@ (same domain: no external-destination
      // authorization record needed).
      values: ['v=DMARC1; p=quarantine; rua=mailto:admin@vettid.org'],
    });

    // Only ACM may issue for vettid.org (all certs here are ACM, none wildcard).
    amazonOnlyCaa(this, 'Caa', this.zone);

    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(', ', this.zone.hostedZoneNameServers ?? []),
      description: 'Set these four nameservers at the Hover control panel to complete the cutover',
    });

    new cdk.CfnOutput(this, 'ZoneId', {
      value: this.zone.hostedZoneId,
      description: 'Hosted zone ID',
    });
  }
}
