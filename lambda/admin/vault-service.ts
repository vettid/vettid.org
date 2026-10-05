/**
 * Admin route group: the vault service pause (the operator's kill switch).
 *   /admin/vault-service  /admin/vault-service/pause  /admin/vault-service/resume
 * Contract: docs/ADMIN-API.md "Vault service"; effect: MEMBER-API "Vault
 * service pause".
 *
 * Its own Lambda so that the only rights to the switch are this role's
 * ssm:GetParameter / ssm:PutParameter on that one parameter
 * (lib/stacks/admin-api-stack.ts). It never touches a vault, a key, a
 * manifest or a release row.
 */
import { audit } from '../shared/audit';
import { adminHandler } from '../shared/admin-handler';
import { Router, badRequest, conflict, str } from '../shared/http';
import { nowIso } from '../shared/ids';
import { REASON_MAX, VaultServiceState, readVaultService, writeVaultService } from '../shared/vault-service';

/** The audit subject of every change. */
export const SUBJECT = 'vault-service';

const router = new Router();

// Always read fresh (never the 30 s cache): the operator sees what is set.
router.on('GET', '/admin/vault-service', async () => readVaultService());

router.on('POST', '/admin/vault-service/pause', async ({ body, actor }) => {
  const reason = str(body, 'reason', { max: REASON_MAX });
  if (!reason) throw badRequest('reason is required');
  const cur = await readVaultService();
  if (!cur.enabled) throw conflict('The vault service is already paused');
  const next: VaultServiceState = { enabled: false, reason, set_by: actor, set_at: nowIso() };
  await writeVaultService(next);
  await audit(actor, 'vault.service.pause', SUBJECT, { reason });
  return next;
});

router.on('POST', '/admin/vault-service/resume', async ({ actor }) => {
  const cur = await readVaultService();
  if (cur.enabled) throw conflict('The vault service is not paused');
  const next: VaultServiceState = { enabled: true, reason: null, set_by: actor, set_at: nowIso() };
  await writeVaultService(next);
  await audit(actor, 'vault.service.resume', SUBJECT, { paused_reason: cur.reason, paused_by: cur.set_by, paused_at: cur.set_at });
  return next;
});

export const handler = adminHandler(router);
