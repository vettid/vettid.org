### The approvals indicator (0.1.88)

*Owner decision of 2026-10-27. The texts marked DRAFT wait for the
owner's approval.* A request that needs the member's decision (a
sign-in or admin approval, a connection request, a share or ask
approval, a transfer confirmation, a device or agent approval) used to
sit among ordinary information: in Approvals, which is in the drawer,
and in the bell. A sign-in request lives only minutes, and one landed
unseen while a conversation was open. So what waits for a decision
gets its own indicator, apart from the bell.

1. **What counts.** An **open approval** is an Approvals entry that is
   pending, not decided (on this phone or another device) and not
   expired. The count is the number of **entries** (a connection's
   asks within 10 minutes are one entry, 0.1.22; a batch is one). A
   notice (a paused connection's, a rate limit) is not an approval and
   does not count. An entry that has an expiry (`exp` or `expires_at`;
   the challenge's 10 minutes, a pairing's, a location request's 24
   hours) stops counting at that time, by the app's own timer and not
   only when a list is read; the vault's times are used as everywhere
   else in the app (§4 Devices & agents, "Staging time scale"). An
   entry with no expiry counts until it is decided. An expired entry
   never counts (the list and the resume read already drop it).
2. **Where.** In the top bar, **left of the bell**, on every screen
   inside the unlocked shell that has a top bar: the drawer screens
   **and the detail screens** (a conversation, a connection, an item),
   which have no bell, since that is where the missed sign-in was. Not
   on Approvals itself or on a request's screen opened from it (the
   list is the destination), and not on the full-screen flows (camera,
   photo viewer, a call, the unlock and the gate). It is **shown only
   while the count is above 0** and leaves no gap when hidden.
3. **Look.** The glyph of the drawer's Approvals entry with the
   existing `CountBadge` (gold; "99+" above 99). The bell's red stays
   the bell's: it means an urgent alarm, and this badge is never red.
   **Soon to expire** (below): the indicator becomes a pill with a
   clock glyph and the time left of the soonest entry as `M:SS`
   ("1:20"), in the design tokens' urgency colours (the error container
   and its on-colour, contrast 4.5:1 in both themes), bold. The cues
   that do not rely on colour are the clock glyph, the digits and the
   wider shape. The countdown ticks once a second only while it is
   on screen, with no flashing or movement.
4. **Soon to expire: the last 2 minutes** (`APPROVAL_URGENT_SECONDS =
   120`), a fixed time and not a share of the request's life. Asks live
   from 2 minutes to 24 hours; a share of life (a third) would call a
   24-hour location request urgent for eight hours and a 2-minute
   sign-in only for its last 40 seconds. Two minutes is about what the
   member needs to open the app, unlock and approve. A request that
   lives 2 minutes or less is urgent from its arrival. The window is not
   scaled by the staging time scale. In Approvals the entries are
   ordered **soonest expiry first inside the window**, then as today;
   a row inside the window shows a clock glyph and "Expires in 1:20"
   in bold in the urgency colour; a row outside it shows no countdown.
5. **Tapping the indicator always opens the Approvals list**, never
   the single waiting request, even when the count is 1. One
   destination that always agrees with the number; no request opened
   on top of the screen the member was in (and its back stack); and the
   urgent entry is first in the list, one tap away. (Open question 1
   in the PR for the owner.)
6. **Held, due, locked.** The indicator is derived from the in-memory
   list, so it follows the existing rules: **not shown** while the vault
   is held or the daily check is due (the gate comes first, and the
   cached feed MUST NOT be shown, §4 Notifications, 7), at the app lock
   and the unlock screen, and after a lock or a wipe. After the check
   the open read decides what shows (expired entries are gone). On
   the phone's lock screen the indicator does not exist: only the
   notification, by the rules of "Content" (§4 Notification modes).
7. **The drawer badge uses the same count** (one source, the open
   approvals of 1), so the two always agree. The drawer badge does not
   count down and has no urgent state.
8. **The request's notification opens that request.** Fix of a flaw:
   tapping a new request's notification while another request's screen
   was open showed the old request, because the navigation reused the
   open entry (`launchSingleTop` keeps an entry of the same route and
   its old arguments). The rule: the notification's `PendingIntent`
   carries the entry's `ref` and is unique per entry (a request code or
   data URI from the `item_id`; `FLAG_UPDATE_CURRENT`, immutable); the
   route of a request's screen carries its `ref`; on arrival the app
   **replaces** a request screen that shows another `ref` (pop it, then
   navigate; no `launchSingleTop` for it) and keeps one that shows the
   same `ref`; back goes to the Approvals list. When the entry is gone
   (decided or expired) the Approvals list opens with the existing text
   "This is no longer waiting" (§4 Notifications, 4). A batch opens its
   one entry.
9. **The notification goes when the request does.** Already specified:
   it is cancelled when its feed item is read, archived or deleted on
   any device (§4 Notification modes, 7), and deciding an ask marks the
   item read (question 2). Added here: it is also removed **at the
   entry's expiry**, which marks nothing. A notification for an entry
   with an expiry is posted with `setTimeoutAfter` (the time left), so
   it goes in every mode, with the app closed too, and the app cancels
   it at the same time by its timer and on resume.
10. **Texts (DRAFT; string resources).**

    | Id | Text |
    |---|---|
    | `approvals_indicator_description` | "Approvals, %d waiting" |
    | `approvals_indicator_description_urgent` | "Approvals, %d waiting. One expires in %s" (%s: "1 minute 20 seconds", "45 seconds") |
    | `approvals_indicator_time` | "%d:%02d" (the pill, M:SS) |
    | `approval_expires_in` | "Expires in %s" (the row, M:SS; read as "Expires in 1 minute 20 seconds") |
    | `approval_expires_announce` | "An approval expires in 2 minutes" (announced once, polite, when an entry enters the window; and "in 1 minute" at one minute) |

    The glyph is hidden from TalkBack; the indicator is one control
    with the description above, a 48 dp target; it announces nothing on
    each tick.
11. **Tests.** Unit: the count over pending, decided, expired and
    batched entries; an entry that expires while the app is open stops
    counting without a read; the window at 120 s, at 121 s and for a
    request that lives 90 s; the order inside the window; the
    indicator hidden when held, due, locked and on Approvals. UI: the
    pill and row in both themes and at the largest font scale, the
    description at 1 and 3 waiting, the 48 dp target, the detail screen
    top bar. Navigation: a notification for request B with request A's
    screen open shows B; the same `ref` keeps the screen; a gone entry
    shows the list and the text. Notification: removed at expiry with
    the app closed (`setTimeoutAfter` set from the time left).

