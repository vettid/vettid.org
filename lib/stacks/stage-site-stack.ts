import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig } from '../config';
import { stageZone } from '../constructs/stage-zone';
import { StaticSite } from '../constructs/static-site';
import { SERVED_PATHS } from '../vault/release-list';

/** Where a channel's served manifest is published on its site (VAULT-RELEASES §7). */
export const MANIFEST_SITE_PATH = '.well-known/vettid/pcr-manifest.json';

export interface VettidOrgStageSiteStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Repository root (where vault/ lives); defaults to this file's repo. */
  readonly repoRoot?: string;
}

/**
 * Stateless, non-prod stages only: the stage's apex site, e.g.
 * https://staging.vettid.org (sites/staging), the host of the stage's vault
 * channel manifest (config.vault.manifestUrl), published byte for byte from
 * the committed served file (SERVED_PATHS, written by `npm run
 * vault:manifest -- publish --channel staging`). Until the channel's first
 * publication there is no file and the URL answers 404, which the manifest
 * sync reads as "nothing published yet". Redeploy this stack after each
 * staging publication (RUNBOOK "Staging").
 *
 * No release log: the log is production's (RELEASE-UPDATES §5; staging
 * entries carry no `log`). No WAF: static files only.
 */
export class VettidOrgStageSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgStageSiteStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.stage === 'prod') throw new Error('VettidOrgStageSiteStack is for non-prod stages (prod: VettidOrgStack serves vettid.org)');
    const vault = config.vault;
    if (!vault) throw new Error(`stage ${config.stage} has no vault channel (lib/config.ts)`);
    const manifestUrl = `https://${config.zoneName}/${MANIFEST_SITE_PATH}`;
    if (vault.manifestUrl !== manifestUrl) throw new Error(`stage ${config.stage}: manifestUrl must be ${manifestUrl}, the site this stack serves`);

    const served = join(props.repoRoot ?? join(__dirname, '..', '..'), SERVED_PATHS[vault.channel]);
    const files: Record<string, string> = {};
    if (existsSync(served)) files[MANIFEST_SITE_PATH] = readFileSync(served, 'utf8');

    new StaticSite(this, 'Site', {
      hostName: config.zoneName,
      hostedZone: stageZone(this, config),
      sourceDir: 'sites/staging',
      notFoundPage: '404.html',
      files,
    });
  }
}
