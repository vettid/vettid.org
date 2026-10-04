/**
 * Membership records, shared by the admin API (Phase 1b) and the member API
 * (Phase 2). See docs/ACCOUNT-ADMIN-PLAN.md §5.1 and docs/ADMIN-API.md.
 */

export type State = 'requested' | 'registered' | 'member' | 'rejected';
export type AccountStatus = 'active' | 'suspended' | 'canceled';

/** Row in vettid-org-members. */
export interface MemberItem {
  user_guid: string;
  email: string; // lowercased
  first_name: string;
  last_name: string;
  state: State;
  account_status: AccountStatus;
  email_verified: boolean; // SES identity verified (sandbox opt-in); refreshed by sweeps/checks
  invite_code?: string;
  created_at: string;
  updated_at: string;
  terms_version?: string;
  terms_accepted_at?: string;
  has_used_trial?: boolean;
  pin_hash?: string; // never leaves the backend
  reject_reason?: string;
  suspend_reason?: string;
  delete_after?: string; // set on cancel; cleanup job deletes after this
  terms_sha256?: string; // hash of the accepted terms text
  email_updates?: boolean; // default true
  pin_prompt_dismissed?: boolean; // "skip for now" on the Getting started PIN step
  welcome_sent?: boolean; // "you can sign in" email delivered
  vault_canary?: boolean; // operator-set: may use canary vault releases (VAULT-RELEASES §10.1 step 9); never shown to the member
}

/** Row in vettid-org-subscriptions (one per member). */
export interface SubscriptionItem {
  user_guid: string;
  type_id: string;
  type_name: string;
  status: 'trial' | 'active' | 'expired' | 'canceled';
  paid: boolean;
  started_at: string;
  expires_at: string;
}

export interface MemberView {
  user_guid: string;
  email: string;
  first_name: string;
  last_name: string;
  state: State;
  account_status: AccountStatus;
  email_verified: boolean;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
  terms_version: string | null;
  pin_enabled: boolean;
  subscription: SubscriptionItem | null;
  voting_rights: boolean;
}

/**
 * The one definition of voting rights (plan §5.1): a member in good standing
 * with an active, paid, unexpired subscription. A free trial does not vote.
 */
export function hasVotingRights(m: Pick<MemberItem, 'state' | 'account_status'>, sub: SubscriptionItem | null, now = new Date()): boolean {
  return (
    m.state === 'member' &&
    m.account_status === 'active' &&
    !!sub &&
    sub.status === 'active' &&
    sub.paid &&
    new Date(sub.expires_at) > now
  );
}

export function toMemberView(m: MemberItem, sub: SubscriptionItem | null): MemberView {
  return {
    user_guid: m.user_guid,
    email: m.email,
    first_name: m.first_name,
    last_name: m.last_name,
    state: m.state,
    account_status: m.account_status,
    email_verified: !!m.email_verified,
    invite_code: m.invite_code ?? null,
    created_at: m.created_at,
    updated_at: m.updated_at,
    terms_version: m.terms_version ?? null,
    pin_enabled: !!m.pin_hash,
    subscription: sub,
    voting_rights: hasVotingRights(m, sub),
  };
}
