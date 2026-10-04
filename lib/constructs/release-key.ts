import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppConfig, VaultConfig, vaultRoleArn } from '../config';
import { renderReleaseKeyPolicy } from '../vault/release-key-policy';
import { publishRef } from './ssm-refs';

/** One release whose sealing key the vault stack holds (from releases.json, W7). */
export interface ReleaseKeySpec {
  readonly release: number;
  /** The release's PCR0 (96 lowercase hex). */
  readonly pcr0: string;
  /** PCR0s of every release not `removed` when this key is created (§6.2). */
  readonly admittedPcr0s: readonly string[];
}

export interface ReleaseKeyProps extends ReleaseKeySpec {
  readonly config: AppConfig;
  readonly vault: VaultConfig;
  /** The release-key creator function's ARN. */
  readonly serviceToken: string;
}

/**
 * A release sealing key (docs/VAULT-RELEASES.md §6.2), created by the
 * release-key custom resource with the exact §11.10.7 policy. Immutable:
 * changing any property fails the deploy; removing it from the stack leaves
 * the key alone (RETAIN, and the handler's delete is a no-op). Its ARN is
 * published as SSM `vault/releases/<n>/seal-key-arn`.
 */
export class ReleaseKey extends Construct {
  readonly keyArn: string;
  /** The exact policy the key is created with. */
  readonly policy: Record<string, unknown>;

  constructor(scope: Construct, id: string, props: ReleaseKeyProps) {
    super(scope, id);
    const { config, vault } = props;
    this.policy = renderReleaseKeyPolicy({
      account: vault.account,
      release: props.release,
      pcr0: props.pcr0,
      admittedPcr0s: props.admittedPcr0s,
      hostRoleArn: vaultRoleArn(vault, 'host'),
      retirementRoleArn: vaultRoleArn(vault, 'retirement'),
      retirementWindowDays: vault.retirementWindowDays,
    });

    const key = new cdk.CustomResource(this, 'Key', {
      serviceToken: props.serviceToken,
      resourceType: 'Custom::VettidReleaseKey',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      properties: {
        Release: String(props.release),
        Channel: vault.channel,
        Account: vault.account,
        Region: config.region,
        Pcr0: props.pcr0,
        AdmittedPcr0s: [...props.admittedPcr0s],
        RetirementWindowDays: String(vault.retirementWindowDays),
        Description: `VettID ${vault.channel} vault release ${props.release} sealing key (VAULT-MESSAGING §11.10.7; immutable)`,
        Policy: JSON.stringify(this.policy, null, 2),
      },
    });
    this.keyArn = key.getAttString('KeyArn');
    publishRef(this, config, `vault/releases/${props.release}/seal-key-arn`, this.keyArn);
  }
}
