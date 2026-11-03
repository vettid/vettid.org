import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { env } from './aws';
import type { MemberVaults } from '../jobs/cleanup';

const lambdaClient = new LambdaClient({});

/**
 * Ask the member API's member-vaults function (its task `member_vaults`;
 * its own role may only Query the vaults table and its user-index) which of
 * the member's vaults are not deleted. Used by the admin API's Delete and
 * (MEMBER-API 2.14.0) the member's account deletion, neither of which holds
 * a right on the vault tables. Anything but its own well-formed answer is an
 * error: the caller then answers 500 and changes nothing, so "no vault" is
 * never taken from a failure. `what` names the caller in the log line.
 */
export async function requestMemberVaults(userGuid: string, what: string): Promise<MemberVaults> {
  const out = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: env('MEMBER_VAULTS_FN'),
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ task: 'member_vaults', user_guid: userGuid })),
    }),
  );
  let r: Partial<MemberVaults> | null = null;
  try {
    r = out.FunctionError || !out.Payload ? null : (JSON.parse(Buffer.from(out.Payload).toString('utf8')) as Partial<MemberVaults>);
  } catch {
    r = null;
  }
  if (!r || r.ok !== true || r.task !== 'member_vaults' || !Array.isArray(r.vaults)) {
    console.error(`${what}: the member-vaults function did not answer as expected`, JSON.stringify({ user_guid: userGuid, function_error: out.FunctionError ?? null }));
    throw new Error('member vaults check failed');
  }
  return r as MemberVaults;
}
