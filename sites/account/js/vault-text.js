// Wording for the vault's status (MEMBER-API "Vault": VaultStatus,
// ReleaseInfo). Pure: returns plain strings and [label, tone] pairs, so the
// page modules stay about layout and the wording is unit-tested.

/** VaultStatus.state -> [chip label, chip tone, one-line explanation]. */
export const VAULT_STATE = {
  enrolling: ['Setting up', 'warn', "Your vault's setup isn't finished. Finish it in the VettID app."],
  locked: ['Locked', 'mute', 'Your app opens it with your vault PIN.'],
  unlocked: ['Unlocked', 'ok', 'Open in your VettID app.'],
};

export function vaultState(state) {
  return VAULT_STATE[state] ?? [String(state ?? 'Unknown'), 'mute', ''];
}

/** ReleaseInfo.status -> [chip label, tone]. */
const RELEASE_STATUS = {
  active: ['Current', 'ok'],
  canary: ['Canary', 'warn'],
  deprecated: ['Replaced', 'warn'],
  retired: ['Ending', 'warn'],
  removed: ['Ended', 'err'],
  unknown: ['Unknown', 'mute'],
};

export function releaseStatus(status) {
  return RELEASE_STATUS[status] ?? [String(status ?? 'Unknown'), 'mute'];
}

/** "October 6, 2026" in the viewer's locale; '' if unparseable. */
export function longDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(d);
}

/** "October 6, 2026, 2:05 PM" in the viewer's locale and time zone; '' if unparseable. */
export function dateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(d);
}

/**
 * The release notice (ReleaseInfo.notice) as { tone, title, text }, or null.
 * Approving an update happens in the app, at an unlock (RELEASE-UPDATES §2);
 * the site only tells the member.
 */
export function releaseNotice(release) {
  if (!release || !release.notice) return null;
  const n = release.number;
  const mine = n ? `release ${n}` : "your vault's release";
  const ends = release.ends_at ? longDate(release.ends_at) : '';
  switch (release.notice) {
    case 'update_available':
      return {
        tone: 'info',
        title: release.newest_active ? `Update available: release ${release.newest_active}` : 'Update available',
        text: `Your vault runs ${mine}. The next time you unlock your vault, the VettID app offers the update; approving it there moves your vault.${ends ? ` ${cap(mine)} keeps working until ${ends}.` : ''}`,
      };
    case 'final_warning':
      return {
        tone: 'warn',
        title: ends ? `${cap(mine)} ends on ${ends}` : `${cap(mine)} is ending`,
        text: 'After that, your vault can no longer be opened in it. Unlock your vault in the VettID app and approve the update before then.',
      };
    case 'ended':
      return {
        tone: 'error',
        title: `${cap(mine)} has ended`,
        text: 'Your vault can no longer be opened in it. Within 30 days of the end date, email support@vettid.org: VettID can restart the release once so that you can move your vault.',
      };
    case 'rescue':
      return {
        tone: 'warn',
        title: `${cap(mine)} has been restarted for you`,
        text: 'Unlock your vault in the VettID app now and approve the update. The restart is temporary.',
      };
    case 'unavailable':
      return {
        tone: 'warn',
        title: "Your vault's release isn't available",
        text: 'Your vault cannot be opened right now. If this lasts, email support@vettid.org.',
      };
    default:
      return null;
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "about 3 hours" / "about 25 minutes" / "less than a minute" until `iso`. */
export function timeUntil(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return 'less than a minute';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `about ${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 10 || m === 0) return `about ${Math.round(min / 60)} hour${Math.round(min / 60) === 1 ? '' : 's'}`;
  return `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * The operator's pause (MEMBER-API 1.2.0 "Vault service pause"): `status`
 * says `service: "paused"`. -> { tone, title, text } or null. Generic on
 * purpose: the operator's reason is never shown to members.
 */
export function servicePaused(status) {
  if (status?.service !== 'paused') return null;
  return {
    tone: 'warn',
    title: 'Vault service is paused for maintenance',
    text: "Setting up, unlocking and recovering a vault aren't available right now. Your vault and its data are not affected, and locking still works. Try again later.",
  };
}
