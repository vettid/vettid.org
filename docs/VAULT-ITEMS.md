---
title: VAULT-ITEMS
status: approved design note (owner, 2026-10-03); specified in VAULT-MESSAGING 0.7.0
version: 0.1.1
date: 2026-10-08
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.6.x): §3.5 Protean Credential, §10.6 credential secrets, §10.7 secrets, §10.8 profile, §10.11 LEASH, §10.12 grants, §10.13 critical-secret use
  - ANDROID-PLAN.md
classification: public (no secrets; safe for github.com/vettid)
---

# Vault items: one data model with tags

A design note for replacing the vault's three separate data models with a
single **item** model organised by **tags**, where sharing with
connections and agents is expressed as rules over tags. Once approved, it
becomes a VAULT-MESSAGING change and a vault batch before V4 batch 4.

## 1. Problem

Today a member's data lives in three places, each with its own messages,
limits, catalog rule and sharing path:

| Today | Stored | Shared by |
|---|---|---|
| Profile fields (§10.8) | DEK state, flat `key → value` | `shared` list (pushed to every connection) or a field grant |
| Secrets (§10.7) | DEK state, one value each | `cataloged` flag + per-item grant |
| Critical secrets (§10.6) | inside the Protean Credential | `cataloged` flag + per-use request (§10.13) |

Each item holds one value, so a passport, a bank account or a login needs
either a template or several loose entries. Sharing is item by item, and
every connection sees the same catalog. Agents (LEASH) name items one by
one.

## 2. Proposal in one paragraph

Everything the member stores is an **item**: a name, a category, any
number of typed **fields**, free-form **tags**, and a **sensitivity**
(`data`, `secret` or `critical`) that decides where the vault keeps it.
Templates only pre-fill fields and suggest tags. Sharing becomes **share
rules**: "this connection (or agent) may read items tagged *medical*",
with a mode that defaults to **ask me for each new item** (owner decision
2026-10-03). Underneath, the existing grant mechanics (counted, expiring,
revocable, values sealed to the fetching device) stay as they are; rules
just decide which items get grants. Critical items are never shared by a
rule: every use still needs the member's phone and password.

## 3. The item

```json
item: {
  "item_id": "<ULID>", "version": 3,
  "name": "Passport", "category": "identity_document",
  "sensitivity": "data|secret|critical",
  "template": "passport",
  "tags": ["travel", "identity"],
  "fields": [
    { "field_id": "f1", "label": "Number", "kind": "text", "value": "…" },
    { "field_id": "f2", "label": "Expires", "kind": "date", "value": "2031-04-30" },
    { "field_id": "f3", "label": "Scan", "kind": "file", "value": "<blob ref>" }
  ],
  "notes": "…", "created_at": "<ts>", "updated_at": "<ts>"
}
```

- **Fields.** Ordered, each with a `label` (≤ 64 bytes), a `kind`, and a
  `value`. Kinds: `text`, `multiline`, `number`, `date`, `email`, `phone`,
  `url`, `password` (masked by apps, revealed on purpose), `otp` (a TOTP
  seed; apps show codes), `file` (later: a blob reference), `address`
  (structured). Kinds drive input and display; the vault validates shape
  and size only.
- **Category.** One per item, from a recommended list (identity_document,
  login, payment_card, bank_account, medical, insurance, vehicle, contact,
  note, crypto_wallet, other) or any `[a-z][a-z0-9_]{0,31}`. It picks the
  icon and the template's suggested fields.
- **Templates** live in the apps (and a shared registry document), not in
  the vault. Choosing "Passport" pre-fills labelled fields and suggests
  tags; the member can add, remove or rename anything. Free-form items need
  no template at all.
- **Templates never add reserved tags** (`@profile` or any other `@`
  tag). Only the member puts an item into the shared profile, by tagging
  it `@profile` (owner decision 2026-10-08).
- **Contact information is one item per contact point.** Sharing is per
  item: a share rule selects whole items by tag, and the whole item goes
  to the connection. So the recommended templates are *Email address*,
  *Phone number*, *Postal address* and *Website*, each a single-field
  `contact` item, rather than one "contact details" item; a member can
  then share a phone number and an email address without the postal
  address (owner decision 2026-10-08).
- **Limits** (proposed): 64 fields per item, a field value ≤ 16 KiB, an
  item ≤ 64 KiB, 2,000 items. Critical items are bounded by the Protean
  Credential (§3.5.2); the proposal raises its limit from 64 secrets to 64
  critical *items*, each up to 16 fields and 8 KiB in total.

## 4. Sensitivity

Chosen **per item** at creation (default `data`; templates suggest one —
a login defaults to `secret`, a recovery phrase to `critical`).

| Sensitivity | Where the vault keeps it | Owner access | Sharing |
|---|---|---|---|
| `data` | DEK state | any owner device | share rules / grants |
| `secret` | DEK state; reads are audited | apps; desktops with step-up; values revealed on purpose | share rules / grants |
| `critical` | **inside the Protean Credential** (§3.5); metadata (name, category, tags, field labels — never values) in DEK state | apps only, with the credential password; every use rotates the CEK | **never by rule**: per-use requests only (§10.13) |

- Per item rather than per field keeps an item in one store; a member who
  wants one field of a login to be critical splits it into two items.
- Changing sensitivity: `data ↔ secret` is a metadata change;
  moving to or from `critical` is a credential operation (password, UTK,
  CEK rotation), and moving out of `critical` warns the member first.

## 5. Tags

- **One namespace**, member-defined, normalised to lowercase
  `[a-z0-9][a-z0-9 _-]{0,31}`, at most 16 per item. A small tag registry in
  vault state (`tag.list`) holds optional colour, icon and description, and
  supports rename and merge.
- **Labels and sharing use the same tags.** A tag means nothing to
  connections by itself; it becomes a sharing tag only when a share rule
  names it. The apps show, on every tag, which rules use it.
- **Tag names never leave the vault.** Connections and agents see items
  (name, category, field labels they're allowed to see), never the
  member's tags or rules.
- **Reserved tag `@profile`.** Items carrying it form what connections see
  as the member's profile (`profile.update`); this replaces the separate
  profile fields and `shared` list. The display name and photo stay a tiny
  profile object. The shared profile contains **only items the member
  tagged `@profile`**: no template, default or import adds the tag
  (owner decision 2026-10-08).

## 6. Share rules (the connection contract)

```json
share_rule: {
  "rule_id": "<ULID>", "version": 1,
  "subject": { "connection_id": "<id>" } | { "agent_id": "<id>" },
  "tags": ["medical"], "match": "any|all",
  "access": "read",
  "mode": "ask|auto",
  "uses": 10, "expires_at": "<ts>|null",
  "include_existing": true
}
```

- **Mode `ask` (default).** When an item gains a matching tag — new, or
  re-tagged — the member's apps get `share.pending` ("Share *Allergy list*
  with *Dr Lee*?"). Only approved items become visible to the subject.
  Declined items are remembered and not asked again unless re-tagged.
- **Mode `auto`.** Matching items are included without asking; the app
  still shows the impact before the rule or the tag is saved ("this will
  share 4 items with Dr Lee").
- **`include_existing`.** When a rule is created, existing matching items
  are listed for the member to confirm (in `ask` mode) or included (in
  `auto` mode), after a preview either way.
- **Underneath:** an included item becomes an ordinary grant (§10.12): the
  subject fetches values sealed to its device, uses are counted, grants
  expire and are revocable. Removing the tag, deleting the rule or
  revoking ends future fetches at once.
- **Per-connection catalog.** A connection's catalog becomes the items its
  rules (and one-off grants) make visible to it — not one catalog for
  everyone. A connection can still ask for something specific
  (`grant.request` by category or description), which the member answers.
- **Critical items** never match a rule. A rule can make a critical item
  *usable* (listed for §10.13 use requests), never readable; each use
  still needs the member's phone and password.
- **Agents (LEASH).** A LEASH grant's data scopes become share rules with
  an `agent_id` subject (`ask` by default; `auto` only with an explicit
  tag list, matching the current `secrets.get` rule). The signed delegation
  carries the rule (tags, access, limits) so relying parties see what the
  agent may read.
- **Audit.** Rule changes, inclusions, declines and every fetch are
  audited; the connection's own audit view (shared action
  `audit.recent`) shows what it fetched.

## 7. What changes in the spec and code

| Replaced | By |
|---|---|
| `secret.put/get/list/delete` (§10.7) | `item.put/get/list/delete` for `data` and `secret` items; `item.list` filters by tag, category, sensitivity |
| `credential.secret.add/get/list/delete/catalog` (§10.6) | `item.*` with `sensitivity: critical`, carrying the credential, UTK-sealed fields and reply keys exactly as today |
| profile fields + `shared` (§10.8) | items tagged `@profile`; `profile.get/set` keep only name and photo |
| `discoverability`/`cataloged` flags | share rules and per-connection catalogs |
| grant items `{kind: field|secret}` (§10.12) | `{kind: item, ref: item_id, fields?: [field_id]}` |
| LEASH secret scopes (§10.11) | share rules with an agent subject |
| — (new) | `tag.list/set/delete/merge`; `share.rule.set/list/delete`; `share.pending` (V→D) and `share.decide`; `sync.event` kinds `item.changed`, `item.deleted`, `tag.changed`, `share.rule.changed` |

Grant fetching, value sealing, critical-secret use (§10.13), the
credential rules (§3.5) and the audit model stay as they are.

## 8. Decisions (owner, 2026-10-03)

1. Sensitivity is **per item**.
2. **One tag namespace**; sharing is defined by share rules.
3. The profile is the **`@profile` tag** (display name and photo stay a
   small profile object).
4. **Files in items later** (blob storage and size policy first).
5. **Agents default to `ask`**, like connections.

## 9. Plan

1. Owner review of this note.
2. VAULT-MESSAGING 0.7.0: §10.6–§10.8, §10.11–§10.13 rewritten around
   items, tags and share rules (spec PR for approval).
3. A vault batch ("V4 items") implementing it, with migration of nothing
   (no production data yet), then V4 batch 4 (location, wallet, presence).
4. ANDROID-PLAN updated: one "Add" screen (template or blank → name,
   category, sensitivity, tags, fields), a tag filter on lists, and a
   share-rule editor on each connection and agent.

## 10. Changelog

- **0.1.1** (2026-10-08), owner decision of 2026-10-08: templates never
  add reserved tags, so the shared profile holds only items the member
  tagged `@profile` (§3, §5); contact information is one item per contact
  point so each can be shared on its own (§3). The registry's
  `contact_card` template (tagged `@profile`) is replaced by
  `email_address`, `phone_number`, `postal_address` and `website`, none
  tagged (vettid-vault `docs/item-templates.json` version 2).
- **0.1.0** (2026-10-03): approved design note.
