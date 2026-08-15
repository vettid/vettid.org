# VettID Playbooks & /why — Design Specification

**Version:** 1.0 draft
**Date:** August 2026
**Status:** For developer implementation
**Owner:** Al Liebl (VettID)

---

## 1. Purpose and scope

This document specifies two new areas of vettid.org:

1. **`/playbooks/`** — the education and coaching section. Articles teach the *why* of online security, privacy, and trust; playbooks coach the reader through the *how*, step by step, on their own device. A client-side "coach" tool routes visitors from a stated concern to the right playbook.
2. **`/why`** — the mission and editorial position page. This is where VettID speaks; the playbooks are where VettID teaches. The separation is deliberate and must be preserved in implementation.

Everything in this section is static content plus client-side JavaScript. There is no backend, no accounts, no analytics on user answers, and no data leaving the device. This is not just a cost decision — it is a demonstration of the VettID philosophy and is stated explicitly in the UI (see §8 and §9).

### Out of scope for v1
- AI-powered coach (v1 is a deterministic decision tree)
- Desktop OS playbooks (mobile only: iOS, Android, GrapheneOS)
- User accounts, server-side progress sync, comments
- Localization

---

## 2. Information architecture

### 2.1 Navigation changes

Add to the top navigation of vettid.org, as peers of existing items:

| Label | Route | Notes |
|---|---|---|
| Privacy Playbooks | `/playbooks/` | The education + coaching section |
| Why VettID | `/why` | Mission + editorial position |

"Why VettID" must be top-level navigation, not a footer link. The position is meant to be discoverable; burying it reads as hedging.

### 2.2 URL scheme

```
vettid.org/
├── why                                  # Mission + position (single page, main site repo)
└── playbooks/                           # Landing page (playbooks repo, dedicated S3 origin)
    ├── coach/                           # Coach decision tree (also embedded on landing)
    ├── articles/                        # Article index
    │   └── {article-slug}               # e.g. articles/what-is-privacy
    ├── {platform}/                      # Playbook shelf per platform
    │   └── {playbook-slug}              # e.g. grapheneos/first-day-setup
    └── plays/                           # (optional v1.1) standalone single plays
```

- Platforms: `ios`, `android`, `grapheneos`. Cross-platform playbooks (rare) live under a `universal/` shelf.
- Slugs are lowercase-hyphenated, written in the user's language, not industry jargon: `lock-down-your-iphone`, not `ios-device-hardening`.
- All routes are static pages; the coach is client-side JS on a static page.

### 2.3 Deployment

Per the earlier architecture decision: `/playbooks/*` is served from the main vettid.org CloudFront distribution via **path-based routing to a dedicated S3 origin**, so this content has its own repo/build pipeline and deploys independently of the main site.

- **`/why` lives in the main site repo**, not the playbooks repo. It is a single, rarely-changing brand page and deploys with the main site. Playbooks content links to it by URL only — no repo coupling.
- Repo suggestion: `vettid-playbooks` in the `vettid` GitHub org.
- Content is Markdown + JSON (schemas in §6), built by a static site generator (developer's choice; Hugo or Astro both fit — no server runtime).
- CI: gitleaks scan on every push (org standard), build, deploy to S3, CloudFront invalidation scoped to `/playbooks/*` and `/why`.
- No third-party scripts, no external fonts at runtime (self-host), no analytics beyond CloudFront standard logs. A privacy education site must be exemplary in its own network tab — assume visitors will open DevTools, because they will.

---

## 3. The /why page

A single page, three sections, in this order. This page carries the full weight of differentiating VettID from generic privacy education until the product is publicly usable — it is the highest-leverage single page on the site.

### 3.1 Section 1 — The mission (2–3 sentences)

Plain language, no jargon. Working draft (wordsmith before launch):

> **VettID exists to help ordinary people get security, privacy, and trust online — without needing to become experts.**
> The internet asks you to trade your privacy for participation. We think that trade is broken, and we're building the proof.

### 3.2 Section 2 — Where we stand (the editorial position)

Explicitly labeled as position, not education. Heading: **"Where we stand."** Content covers, in this order:

1. **The "nothing to hide" trope, dismantled positively.** Privacy is not about hiding wrongdoing; it is a right you are entitled to. VettID's framing: *a strong, positive assertion of your identity entitles you to your right to privacy.* You shouldn't have to choose between being known and being safe.
2. **Identity vs. anonymity — different tools for different threat models.** Anonymity is the right tool against powerful adversaries: dissidents, journalists, abuse survivors. Asserted identity is the right tool for building trusted relationships: banking, healthcare, commerce, community. Neither is universally right. The tragedy of the current internet is that it forces everyone into a third thing — surveilled pseudo-identity — which is the worst of both: you get neither the protection of anonymity nor the trust benefits of verified identity, while everything you do is collected anyway.
3. **Why anonymity alone can't carry trust.** Trust requires accountability, and accountability requires identity. Anonymity has its place and we defend it — but a society that runs on anonymity alone hands its infrastructure to malicious actors. The answer isn't less privacy; it's identity architecture where *you* control what is asserted, to whom, and nothing more.

Tone requirement: argue with respect and precision. The GrapheneOS community — the first audience for the playbooks — includes people who hold anonymity as a core value. This section wins the argument by framing threat models, never by dismissing anonymity or the people who need it.

### 3.3 Section 3 — How this shapes what we build

The coherence proof. Short subsections mapping worldview → implementation, so a skeptical reader can verify claims against choices:

- **Why the playbooks exist:** teaching self-reliance is the mission in miniature. The coach never touches your phone; every play, you run yourself.
- **Why the coach runs entirely on your device:** we never see your answers. (Link to the coach.)
- **Why VettID's architecture never sees your data:** one-paragraph plain-language summary of zero-direct-access / non-custodial design, linking out to the GitHub org (github.com/vettid) and technical content on vettid.org for the technical audience.
- **One honest sentence about editorial influence:** "Our worldview shapes which problems we choose to solve — not whether the solutions are sound. Every playbook stands on its own merits, whether or not you share our position."

### 3.4 Linking discipline

- Articles and playbooks may link **to** `/why` at natural moments (e.g., an article touching the anonymity discussion; a footer line "Why we built this →").
- `/why` is never a prerequisite. Playbook steps never argue the worldview.
- Editorial test for any article: *if the /why link were deleted, would the educational content still stand complete?* If not, the article is doing position work and must be revised.

---

## 4. The /playbooks landing page

Structured around the triage question, not content categories. Concern-first at the front door; taxonomy behind it.

### 4.1 Page layout (top to bottom)

1. **Hero: "What brings you here?"** — the coach entry point. Either the first coach question rendered inline, or a prominent set of concern buttons (see §8) that launch the coach. One line beneath the hero, verbatim or close: *"The coach runs entirely on your device. We never see your answers."*
2. **Playbook shelves by platform** — GrapheneOS, iOS, Android. Each shelf shows playbook cards: title (user language), concern tags, estimated time, difficulty, last-verified date. GrapheneOS shelf listed first at launch (go-to-market sequencing), but iOS/Android shelves must be populated at launch — see §10.
3. **Featured articles** — 3–5 cards: title, one-line hook, reading time.
4. **"Start here" strip** — for readers with no specific concern: links to the anchor articles (§5.3) and the "Lock down your phone in 15 minutes" quick-win playbooks.
5. **Footer note** — "Why we built this →" linking to `/why`.

### 4.2 Article index (`/playbooks/articles/`)

Simple filterable list: filter by concept (security, privacy, trust, identity, anonymity) and by concern tag. Each entry: title, hook, reading time, related playbook count.

### 4.3 Platform shelves (`/playbooks/{platform}/`)

One page per platform. Short intro paragraph per platform (what this OS gives you out of the box, one honest sentence about its tradeoffs), then playbook cards sorted with quick wins first.

---

## 5. Content model

### 5.1 Concern tags — the core metadata

Every article and every playbook carries one or more **concern tags**. This is the engine of the section: articles link forward to the playbooks that implement their best practices; playbooks link back to the article that explains why they matter; the coach resolves a concern to a ranked playbook list. All three relationships are derived from the same tag data — nothing is hand-wired per page.

Initial concern taxonomy (extendable; keep under ~15 at launch):

| Tag | User-language label |
|---|---|
| `tracking` | "Companies are tracking me" |
| `data-collection` | "Apps collect too much about me" |
| `account-takeover` | "Someone may have access to my accounts" |
| `stalkerware` | "Someone may be monitoring my phone" |
| `device-loss` | "What if my phone is lost or stolen?" |
| `travel` | "I'm traveling and worried about my phone" |
| `kids` | "My kid is getting their first phone" |
| `scams-phishing` | "I keep getting scam texts and emails" |
| `network-privacy` | "Who can see what I do online?" |
| `new-phone` | "I'm setting up a new phone and want to do it right" |

Rules: tags are defined in a single `concerns.json` (id, label, short description, icon). Adding a concern requires updating exactly one file plus tagging content. The coach tree (§8) references these ids.

### 5.2 Content anatomy — Articles

Articles teach concepts to the average person. Fixed template, enforced by frontmatter + section structure:

```yaml
# frontmatter (article)
type: article
title: "Privacy isn't about hiding"        # user language, no jargon
slug: privacy-isnt-about-hiding
concepts: [privacy]                         # security|privacy|trust|identity|anonymity
concerns: [tracking, data-collection]       # concern tag ids
reading_minutes: 6
published: 2026-09-01
updated: 2026-09-01
sources:                                    # real-world grounding
  - title: "..."
    outlet: "..."
    url: "..."
    date: 2026-05-14
```

Body structure (H2s, in order):

1. **What it is** — define the concept in plain language. Two to four paragraphs. Analogies over acronyms.
2. **Why it's a problem** — the real-world grounding. Reference actual reported events (from `sources`) in summary form. Never sensationalize; the facts are alarming enough. Summarize and cite — do not reproduce article text.
3. **What you can do** — the best practice, in principle. Ends in a **playbook bridge**: an auto-rendered block listing every playbook sharing a concern tag, styled as "Ready to fix this? →".
4. *(Optional)* **Where we stand** — only if the topic touches editorial territory (identity/anonymity). One short paragraph max, clearly voiced, linking to `/why`. Most articles omit this section entirely.

### 5.3 Anchor articles (launch set)

1. **"Security, privacy, trust: what these words actually mean"** — the definitional foundation; every other article can link to it instead of re-defining.
2. **"Your layers, explained"** — personal defense in depth. Decision-tree structure: what your OS already protects for free, what a VPN actually does and does not protect against, when DNS filtering earns its place, when you genuinely don't need a tool. The explicit goal: tell people when they *don't* need to buy something. This article is the trust-builder for the whole section.
3. **"Privacy isn't about hiding"** — the accessible version of the "nothing to hide" rebuttal. Educational in tone; the full argued position lives at `/why`, linked once at the end.
4. **"Who's tracking you, and how"** — tracking and data collection grounded in reported real-world examples.

### 5.4 Content anatomy — Playbooks

Playbooks coach the reader through implementing a best practice on their own device. Fixed template:

```yaml
# frontmatter (playbook)
type: playbook
title: "Lock down your iPhone in 15 minutes"   # user language
slug: lock-down-your-iphone
platform: ios                                   # ios|android|grapheneos|universal
concerns: [new-phone, tracking, device-loss]
difficulty: warmup                              # warmup|fundamentals|advanced
time_minutes: 15
os_verified: "iOS 19.2"                         # exact version tested against
verified_date: 2026-08-10
plays: 8
```

Body structure:

1. **Why this matters** — one line + link to the related article. Never more; the playbook is not the place for the argument.
2. **What you'll be able to do afterward** — 2–4 outcome statements ("Your phone will require your face or PIN for every sensitive change").
3. **The plays** — discrete numbered steps. Each play: an imperative title, the exact taps for this platform ("Settings → Face ID & Passcode → …"), a one-line "what this just did," and a checkbox (see §9). Screenshots optional but every screenshot adds maintenance cost — prefer precise tap-paths; use screenshots only where the UI is genuinely ambiguous.
4. **"You're now covered against…"** — the recap. Restates the concerns addressed, in user language. This is the competence payoff and the shareable proof-of-progress.
5. **Footer metadata block** — auto-rendered from frontmatter: platform, verified OS version, verified date, difficulty, time. Visible on every playbook. A playbook that says "verified on iOS 19.2, August 2026" builds trust; hiding staleness destroys it.

### 5.5 Difficulty progression vocabulary

Coaching language gives the curriculum its structure without a mascot:

- **Warm-ups** — quick wins, under 20 minutes, no risk of breaking anything (lock screen, auto-lock, SIM PIN, ad-tracking toggles).
- **Fundamentals** — the core curriculum (passwords + manager, 2FA, app permission audit, backups).
- **Advanced training** — higher effort or higher stakes (GrapheneOS migration, network privacy, travel prep, stalkerware response).

These three labels appear on cards, in filters, and in the coach's output ordering (warm-ups surfaced first).

---

## 6. Data schemas (developer contract)

Three JSON files drive all cross-linking and the coach. All live in the content repo, validated in CI.

### 6.1 `concerns.json`

```json
{
  "concerns": [
    {
      "id": "stalkerware",
      "label": "Someone may be monitoring my phone",
      "short": "Signs your device is being watched, and how to respond safely.",
      "icon": "eye-off"
    }
  ]
}
```

### 6.2 Content frontmatter → build-time index

The static site generator builds a `content-index.json` at build time from all article/playbook frontmatter. The playbook bridges (§5.2.3), related-article links (§5.4.1), shelf pages, and coach results all render from this index. No hand-maintained cross-link lists anywhere.

### 6.3 `coach-tree.json`

See §8.3.

---

## 7. Style guide (voice and tone)

Publish this as a short internal page (or CONTRIBUTING.md in the repo) so future contributors — or the author at midnight — stay consistent.

**Voice:** factual, positive, fun. Snark is permitted and encouraged with one absolute rule: **aim the snark at the surveillance economy, never at the reader.**

- ✅ "Your apps have been gossiping about you. Time to end the group chat."
- ✅ "That flashlight app does not need your contacts. It's a flashlight."
- ❌ Anything implying the reader should have known better, or is late, careless, or naive.

**Placement rules:**

- Voice lives in **framing**: article intros, playbook openings, recaps, card copy, coach prompts.
- **Play steps are precision zones.** No jokes inside numbered steps — humor in step 4 of 12 slows people down and ages badly when the settings screen moves. Imperative, exact, boring on purpose.
- Fear is a tool we don't use. State risks factually with real-world grounding; the facts carry the weight. No countdown urgency, no "hackers are watching RIGHT NOW."
- "You," never "we'll handle it." The coach's promise, usable anywhere: *"The coach never touches your phone. Every play, you run yourself."*
- Plain words beat industry words everywhere a user can see: "someone watching your traffic," not "adversary-in-the-middle"; "prove it's really you," not "authenticate."

**Editorial boundary (restated from §3.4):** education content teaches; `/why` argues. If a draft article starts arguing, move that text to `/why` or cut it.

---

## 8. The Privacy Coach (v1: deterministic decision tree)

### 8.1 What it is

A client-side wizard: "What's worrying you?" → zero to three follow-up questions → a ranked list of playbooks (and one related article). No AI, no backend, no network calls after page load. Deterministic, auditable, works offline.

### 8.2 Privacy statement (verbatim in UI, near the coach)

> **The coach runs entirely on your device. Your answers never leave it — we couldn't see them if we wanted to.**

This is a product feature and a marketing claim; the implementation must keep it true. CI check idea: the coach page's built output makes zero network requests post-load (assert in an integration test).

### 8.3 `coach-tree.json` structure

```json
{
  "root": {
    "question": "What brings you here?",
    "options": [
      { "label": "Companies are tracking me", "next": "node_tracking" },
      { "label": "Someone may have access to my accounts", "next": "node_takeover" },
      { "label": "I'm setting up a new phone", "next": "node_newphone" },
      { "label": "I'm traveling soon", "next": "node_travel" },
      { "label": "I'm worried about someone close to me monitoring my phone", "next": "node_stalkerware" },
      { "label": "Just show me everything", "result": { "concerns": [], "mode": "browse" } }
    ]
  },
  "nodes": {
    "node_newphone": {
      "question": "Which phone?",
      "options": [
        { "label": "iPhone", "result": { "concerns": ["new-phone"], "platform": "ios" } },
        { "label": "Android", "result": { "concerns": ["new-phone"], "platform": "android" } },
        { "label": "GrapheneOS (or curious about it)", "result": { "concerns": ["new-phone"], "platform": "grapheneos" } }
      ]
    }
  }
}
```

Resolution logic: a result's `concerns` + optional `platform` filter the content index; matching playbooks rank by (platform match, difficulty ascending — warm-ups first, verified_date descending). Render as cards with a "start here" marker on the top result, plus the single most-related article beneath.

Tree rules: maximum depth 3 (concern → platform → at most one refining question). Every leaf must resolve to at least one playbook that exists at launch — CI validates leaves against the content index so the coach can never dead-end.

### 8.4 Sensitive path: stalkerware

The `stalkerware` branch requires special handling, not snark:

- Tone shifts to calm and serious for this entire path. No jokes anywhere on it.
- The result page leads with a safety note: if someone dangerous may be monitoring the device, changes the monitor can detect (removing apps, factory reset) can escalate risk — consider using a different, safe device to read this guide and reach out to local support resources first.
- The playbook itself follows the same principle: observation and safety planning before removal steps, with clear flags on which plays are detectable by a monitoring party.

### 8.5 v2 (explicitly out of scope, noted for architecture)

An AI-assisted coach could later front the same tree (free-text concern → mapped to concern tags). The tree remains the source of truth for routing either way — the deterministic version may remain the better product indefinitely.

---

## 9. Progress tracking (localStorage only)

- Every play has a checkbox; state persists in `localStorage`, keyed by playbook slug + play id.
- Playbook cards show per-device progress ("5 of 8 plays done").
- One-line note where progress first appears: *"Progress is saved only on this device. It never leaves your phone."*
- No accounts, no sync, no cookies. Clearing browser data clears progress — acceptable and stated.

---

## 10. Phased launch plan

**Phase 1 ships accounts-and-habits content; Phase 2 adds device-level platform content.** The seam is deliberate: the highest-value early playbooks (account takeover response, password manager + 2FA, scam recognition, travel basics) happen in browsers and account settings pages that look the same on every phone — they can be written once with full precision, no per-platform tap-paths. Device-level hardening is the content that costs 3x to write and maintain; it comes second, when there's time to do it right.

### Phase 1 — Launch (universal content)

| Content | Platform | Difficulty |
|---|---|---|
| Anchor articles x4 (§5.3) | — | — |
| Someone may have access to my accounts | universal | fundamentals |
| Passwords + 2FA: set it up once, done forever | universal | fundamentals |
| Spot the scam: texts, emails, and calls | universal | warmup |
| Prep your accounts for travel | universal | fundamentals |
| Lock down your iPhone in 15 minutes * | ios | warmup |
| Lock down your Android in 15 minutes * | android | warmup |
| /why page (main site repo) | — | — |
| Coach tree covering every Phase 1 concern | — | — |

\* The two quick-win device playbooks are the only device-level content in Phase 1 — they are the single most-requested artifact in this genre and the broad hook for the average person. If launch scope forces a cut, they become the first Phase 2 items, ahead of GrapheneOS.

**Phase 1 coach tree:** omits the "Which phone?" refinement node and any concern that only device-level playbooks can address. The CI leaf-validation rule (§8.3) enforces this automatically — the tree launches smaller, not broken.

**Phase 1 landing page:** no platform shelves; a single "Playbooks" shelf renders all universal content. The shelf component must be data-driven (shelves derived from platforms present in the content index), not hardcoded to three platforms.

### Phase 2 — Platform depth

GrapheneOS-first is go-to-market sequencing for this phase, not the section's identity: the enthusiast community amplifies new resources and its credibility flows downhill to mainstream coverage.

| Content | Platform | Difficulty |
|---|---|---|
| First day with GrapheneOS: set it up right | grapheneos | fundamentals |
| Is GrapheneOS for you? (honest fit guide) | grapheneos | warmup |
| App permission audit | per platform | fundamentals |
| Stalkerware response (§8.4 safety handling) | per platform | advanced |
| Network privacy (VPN/DNS article's companion) | per platform | advanced |
| Kids' first phone | per platform | fundamentals |

Phase 2 also adds the "Which phone?" node to the coach tree and activates platform shelves on the landing page.

---

## 11. Maintenance operations

This section's biggest ongoing cost is verification, not writing.

- **Quarterly re-verification pass:** every playbook re-tested against current OS versions; `os_verified` / `verified_date` updated even when nothing changed (the freshness signal is the product).
- **OS release triggers:** major iOS/Android/GrapheneOS releases trigger an out-of-cycle pass on affected playbooks within two weeks.
- **Staleness UI:** if `verified_date` is older than 6 months, the playbook renders a visible "being re-verified" banner automatically. Trust is built by admitting staleness, not hiding it.
- Content lives in git; every playbook change is a reviewable diff. When a settings path moves, the diff is the changelog.

---

## 12. Implementation checklist (suggested order)

1. Repo `vettid-playbooks`: static site generator scaffold, CI with gitleaks + build + deploy to dedicated S3 origin, CloudFront path routing for `/playbooks/*` and `/why`.
2. Content schemas: `concerns.json`, frontmatter validation, build-time `content-index.json`, CI leaf-validation for the coach tree.
3. Templates: article, playbook (with auto-rendered bridges, metadata block, checkboxes/localStorage), shelf pages, article index.
4. `/why` page (in the main site repo/pipeline, coordinated so it ships before or with the playbooks launch).
5. Landing page with coach hero + shelves.
6. Coach wizard (client-side, `coach-tree.json`, zero post-load network requests, asserted in a test).
7. Phase 1 content (§10) authored against the style guide (§7).
8. Pre-launch pass: DevTools network-tab audit (no third-party requests), accessibility check (the audience includes non-technical users on small screens), and a full run of every playbook on a physical device.

---

*End of specification.*
