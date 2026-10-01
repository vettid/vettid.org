---
title: MEMBER-API
status: v1 (Phase 2)
related: ACCOUNT-ADMIN-PLAN.md (§5 member account site), ADMIN-API.md
---

# Member API (v1)

Served **same-origin** under `https://account.vettid.org/api/*` (CloudFront
forwards `/api/*` to an HTTP API). No CORS anywhere.

## Session model

- The browser never sees a token. Sign-in sets **httpOnly, Secure,
  SameSite=Strict, host-only** cookies:
  - `vid_id` — Cognito ID token (Path `/api`, ~60 min)
  - `vid_rt` — refresh token (Path `/api/auth`, 30 days)
  - `vid_pin` — pending PIN step (Path `/api/auth`, 5 min, only mid sign-in)
- Every **state-changing** request (`POST`/`DELETE`) must send header
  `X-VettID-CSRF: 1` (a custom header cross-site forms can't send; belt and
  braces with SameSite=Strict). Missing → `403 csrf`.
- When an authenticated call returns `401`, the client calls
  `POST /api/auth/refresh` once and retries; if that also fails, the user is
  signed out (send them to `/signin/`).

## Conventions

JSON in/out. Errors: non-2xx with `{ "error": "<code>", "message": "<text>" }`.
Codes: `bad_request`, `unauthorized`, `forbidden`, `csrf`, `not_found`,
`conflict`, `rate_limited` (with `retry_after` seconds), `internal`.
Responses are `Cache-Control: no-store`.

## Public

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/public/request` | `{email, first_name, last_name, invite_code?: string, consent: true}` | `{outcome}` (below) |

`consent` must be `true`: while SES is in sandbox, we can only email
addresses that have verified with SES, and that verification **is** the
email opt-in. Every new request triggers an SES verification email
("Amazon Web Services – Email Address Verification Request") which the
applicant must click before we can send them anything (including sign-in
links).

`outcome`:
- `"pending_approval"` — no code (or code invalid/expired/used up): an admin
  will review. *The response does not say whether a code was rejected* —
  invalid codes silently fall back to review.
- `"registered"` — valid code: the account exists; they can sign in once the
  SES verification is clicked.

Duplicate requests for an address that already exists return
`"pending_approval"` (no existence oracle). Rate-limited per IP.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/start` | `{email}` | `{ok: true}` always (no existence oracle). If the address belongs to an active account with verified email, a sign-in link is emailed: `https://account.vettid.org/auth/#t=<token>&e=<email>` (valid 15 min, single use). Rate-limited per email and IP. |
| POST | `/api/auth/verify` | `{email, token}` | `{status: "signed_in"}` (cookies set) or `{status: "pin_required"}` (`vid_pin` set). `401 unauthorized` for a bad/expired/used link. |
| POST | `/api/auth/pin` | `{pin}` | `{status: "signed_in"}` or `401` (`message` says attempts left / locked). Requires `vid_pin`. |
| POST | `/api/auth/refresh` | — | `{ok: true}` (new `vid_id`) or `401` |
| POST | `/api/auth/signout` | — | `{ok: true}`; revokes the refresh token, clears cookies |

The link token travels in the URL **fragment** (never sent to servers or
logs); the `/auth/` page reads it, POSTs it to `/api/auth/verify`, and
removes it from the address bar immediately.

## Account (requires `vid_id`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/account/me` | — | `Me` |
| GET | `/api/account/terms` | — | `{version_id, title, sha256, text, pdf_url}` current terms (`pdf_url` presigned, 5 min) |
| POST | `/api/account/terms/accept` | `{version_id, sha256}` | `Me` — must match the current version; `registered` → `member` |
| GET | `/api/account/subscription-types` | — | `{items: SubscriptionType[]}` — enabled types this member may start (trials hidden once used) |
| POST | `/api/account/subscription` | `{type_id}` | `Me` — members only; trials only for now (no payments yet), once per person |
| POST | `/api/account/subscription/cancel` | — | `Me` |
| POST | `/api/account/pin` | `{pin, current_pin?}` | `Me` — set (no current) or change (`current_pin` required). 4–8 digits, not trivially weak |
| DELETE | `/api/account/pin` | `{current_pin}` | `Me` — disable |
| POST | `/api/account/preferences` | `{email_updates: boolean}` | `Me` |
| POST | `/api/account/cancel` | `{confirm: "CANCEL", pin?}` | `{ok: true}` — `pin` required if a PIN is set. Account disabled now, deleted after 7 days; cookies cleared |

```ts
interface Me {
  user_guid: string;
  email: string;
  first_name: string;
  last_name: string;
  state: 'registered' | 'member';
  account_status: 'active';
  terms: {
    current_version: string | null;   // null if none published
    accepted_version: string | null;
    needs_acceptance: boolean;        // current exists and differs from accepted
  };
  subscription: {
    type_id: string; type_name: string;
    status: 'trial' | 'active' | 'expired' | 'canceled';
    paid: boolean; started_at: string; expires_at: string;
  } | null;
  voting_rights: boolean;
  pin_enabled: boolean;
  preferences: { email_updates: boolean };
  created_at: string;
}

interface SubscriptionType {
  type_id: string; name: string; description: string;
  duration_days: number; is_trial: boolean; paid: boolean;
}
```

Notes for the UI:
- `registered` members see terms acceptance as the next step; subscription
  only after becoming `member`.
- If the published terms change, `needs_acceptance` turns true again for
  existing members (they stay `member`; the UI should prompt).
- Paid types are listed but can't be started yet (`409` "Payments are not
  available yet").
