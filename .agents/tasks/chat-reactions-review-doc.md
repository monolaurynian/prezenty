# Emoji reactions on chat messages - review pass 2

Second review pass over the uncommitted reaction feature: a new `anon_message_reactions`
table, an aggregate ride-along on `GET /api/wiadomosci/threads/:id`, a new toggle endpoint,
and a chip strip plus bottom-sheet picker on the chat page. Pass 1 raised one blocking
finding (chip repaints destroyed focus and swallowed the `aria-pressed` announcement) and
five non-blocking ones. All five code findings are fixed in code I read directly; the sixth
(no MySQL available to execute the DDL and aggregation) is unchanged and remains an
orchestrator task rather than an implementation defect.

Watch for: focus is still lost when a *new message* arrives mid-interaction, because that
path rebuilds the whole message list via `innerHTML` and the chips inside it (confirmed,
non-blocking); the add button's invisible 44px hit slop overhangs the bubble's bottom edge
by ~2px and can intercept a tap on a link sitting there (confirmed, non-blocking); the
schema and the real `GROUP BY` / `DELETE` / `INSERT IGNORE` have still never run against
MySQL (confirmed, carried over).

**Verdict**: APPROVED

## High-level view

`refreshStrips()` no longer
rewrites `innerHTML`: `syncStrip()` reconciles each strip against local state by mutating
the chips that stay (`applyChip()` sets `aria-pressed`, `aria-label` and the count's
`textContent` on the live node), removing only chips whose count hit zero, and inserting new
chips at their allowlist position via `nextChipAfter()` so no existing node is ever moved.
The add button is created once per strip and kept. The picker grid got the same treatment -
six buttons built once, afterwards only `aria-pressed` is updated - which matters because a
poll can call `refreshStrips()` while the sheet is open. The one case where focus genuinely
has nowhere to go (the focused chip disappears) falls back to the add button of the same
message, and that fallback is general: it also covers a chip disappearing because the *other*
participant un-reacted, not just a self-toggle.

Both read paths funnel through `buildReactionList()`, which emits exactly
`{emoji, count, mine}`; `mine` comes from `MAX(r.user_id = ?)`, so no user id is ever
projected into a response, and the toggle adds only `action`, `messageId` and the echoed
`emoji`. The `notificationText(...)` hunks in the `server.js` diff belong to a concurrent
task (present-added wording), not to this one - the reaction paths touch no notification
machinery at all.

Gating follows the neighbouring chat routes: `requireAuth` on the new endpoint, participation
re-derived from the message itself via `anon_messages JOIN anon_threads`, and the thread
aggregate scoped by `thread_id` behind the pre-existing 403 check. `sender_id` is never read
in the toggle path, so reacting cannot be used to probe authorship.

The new server-side throttle (finding 4) is an in-memory fixed-window counter, 30 toggles per
10 s per user id, with the window arithmetic extracted into the pure `reactionThrottleStep()`.
It runs after the cheap validation and before any query, prunes itself above 500 entries, and
adds no dependency. It does consume budget for requests that later 404 or 403, which only
costs the caller their own quota.

The colour-only pressed state and the low-contrast border are fixed with real non-colour
cues: the pressed chip gets `border-width: 2px` plus an inset white ring with padding reduced
by the same amount so nothing reflows, and the unpressed border moved from
`rgba(0,0,0,0.10)` to `#868F99`. Chat density (finding 5) is addressed by shrinking the add
button to a 32px circle with a 44px invisible hit slop and hiding it behind row hover/focus
under `(hover: hover) and (pointer: fine)` only, using opacity so the control stays in the
tab order and the accessibility tree. Touch is deliberately untouched.

Schema, SQL shape, and file scope are clean: parameterised `pool.execute` everywhere, the
message id forced through `parseMessageId()` (`/^[0-9]+$/` then `parseInt`, so `'7abc'`,
`'-1'`, `'1.5'` and `'1 OR 1=1'` all return `null`), `UNIQUE KEY uniq_message_user_emoji` and
`INDEX idx_reaction_message` in both DDLs, one grouped query per thread load, and the mirror
in `init-db.js`. None of the forbidden files carries reaction content.

<details>
<summary>Issues (3)</summary>

1. **Focus lost on the new-message re-render path** (confirmed, non-blocking) - when a poll
   brings a new message, `loadThreadMessages()` rebuilds `box.innerHTML`, destroying the chip
   the user had focused and dropping focus to `<body>`. Restore focus by `(messageId, emoji)`
   after the rebuild, reusing the lookup `refreshStrips()` already performs.
2. **Add-button hit slop overhangs the bubble** (confirmed, non-blocking) - the `::after`
   44x44 slop extends 6px above a button that starts 4px below the bubble, so it covers the
   bubble's bottom ~2px and, being on a positioned element, paints above it. A link on the
   bubble's last line directly over the button can have its tap swallowed. Cap the upward
   slop or raise `.chat-reactions { margin-top }` to 6px.
3. **DDL and aggregation never executed against MySQL** (confirmed, carried over) - no
   database was reachable, so `CREATE TABLE`, the real `GROUP BY` and the
   `DELETE`/`INSERT IGNORE` are proven only as SQL text with bound parameters. Run
   `npm run init-db` plus a two-account smoke test before release.

</details>

<details>
<summary>Details</summary>

## Checklist

**1. Privacy - PASS.** Both read paths funnel through `buildReactionList()`
(`public/chat-reactions.js`), which constructs `{emoji, count: Math.round(count), mine:
Number(row.mine) === 1}` and nothing else, discarding rows whose emoji is off the allowlist
or whose count is below 1. The thread aggregate selects `r.message_id, r.emoji, COUNT(*) AS
cnt, MAX(r.user_id = ?) AS mine` - no user id column is ever projected. The toggle response
is `{success, action, messageId, emoji, reactions}`. No per-user list, no username, no
`sender_id`, and the log line is `Reaction ${action} on message ${messageId}` with no
identity. The residual two-party inference (`count - (mine ? 1 : 0) > 0` tells you the other
side reacted) was disclosed in the plan and is the same pseudonymous fact that receiving a
message already conveys; the target still only ever sees `Święty Mikołaj 🎅`.

**2. No notifications - PASS.** The toggle handler body contains, end to end: DEMO_MODE
guard, id parse, allowlist check, throttle, `ensureAnonMessageTables()`, the message+thread
lookup, `DELETE`, conditional `INSERT IGNORE`, the aggregate re-read, one `console.log`, and
the JSON response. No `notifications`, `ensureNotificationsTable`, `sendPushToUser`,
`notifyAnonMessage`, `webpush`, activity feed or `is_read` write anywhere in it. The thread
GET addition is two statements (the aggregate query plus `groupReactionsByMessage`) and
leaves the existing `UPDATE anon_messages SET is_read = 1` untouched. `notification-text.js`
is not referenced from any reaction code path.

**3. Auth and participation - PASS.** `app.post('/api/wiadomosci/messages/:messageId/
reactions', requireAuth, ...)`. Participation comes from the message:

```js
SELECT m.id, t.initiator_id, t.target_id
FROM anon_messages m JOIN anon_threads t ON t.id = m.thread_id
WHERE m.id = ?
```

404 when empty, then `403 'To nie Twoja rozmowa'` unless the session user is one of the two
participants. On the read side the aggregate is `WHERE m.thread_id = ?` and sits after the
thread's own participation check (server.js 2745-2747), so reactions from other threads are
unreachable.

**4. SQL - PASS.** Every reaction statement is `pool.execute` with `?` placeholders; the
emoji never enters SQL text. `parseMessageId()` rejects anything that is not a plain positive
integer *before* the id reaches a query, and additionally requires `Number.isSafeInteger`.
The DDL is a static template literal with no interpolation.

**5. Allowlist - PASS.** `isAllowedReactionEmoji(emoji)` requires `typeof emoji === 'string'`
and membership in the `EMOJI_ORDER` map built from the six-entry allowlist; failure returns
`400 'Nieprawidłowa reakcja'` before the throttle and before any query. The check runs
server-side from the shared module, so the client cannot bypass it.

**6. Toggle - PASS.** `UNIQUE KEY uniq_message_user_emoji (message_id, user_id, emoji)` is in
both `ensureAnonMessageTables()` and `init-db.js`, on an `emoji VARCHAR(16) CHARACTER SET
utf8mb4 COLLATE utf8mb4_bin` column - the binary collation matters, because the `*_ci`
collations compare many 4-byte emoji as equal and would collapse both the unique key and
`GROUP BY emoji`. `DELETE` first, `INSERT IGNORE` only when `affectedRows === 0`, so a racing
double tap converges and the response always carries the recomputed aggregate.

**7. Performance - PASS.** One grouped query per thread load, fanned out in JS by
`groupReactionsByMessage()`; `INDEX idx_reaction_message (message_id)` in both DDLs. The
toggle's re-read is scoped to the single message.

**8. A11y - PASS with one non-blocking gap.** Chips, the add button, the sheet buttons and
the close control are all real `<button type="button">`, keyboard reachable, with
`aria-pressed` on the toggles. The sheet is `role="dialog" aria-modal="true"
aria-labelledby="reactionSheetTitle"`, `aria-hidden` + `inert` while closed, opens focus on
the first emoji, traps Tab/Shift+Tab at the edges, closes on Escape (both a sheet-level and a
document-level listener, the second guarded by `sheetMessageId !== null` so it cannot
double-fire), and returns focus to `focusBeforeSheet` with a lookup fallback to the strip's
add button when that node is gone. `prefers-reduced-motion: reduce` zeroes the sheet
transition at both breakpoints and the new add-button opacity transition. Client-rendered
values go through `esc()` (page `escapeHtml` with a `textContent` fallback) even though
emoji and counts are already constrained. Polish labels are gender-neutral.

The repaint fix is the substance of this pass. `syncStrip()` mutates surviving chips rather
than replacing them:

```js
function applyChip(button, item) {
    button.setAttribute('aria-pressed', item.mine ? 'true' : 'false');
    button.setAttribute('aria-label', chipLabel(item));
    const count = button.querySelector('.chat-reaction-count');
    if (count) count.textContent = String(item.count);
}
```

so the `aria-pressed` flip lands on the very control that was activated, and the optimistic
repaint (which runs before the server answers) no longer disturbs focus. New chips are
inserted at their allowlist slot without moving existing nodes; the add button persists for
the strip's lifetime.

The gap that remains: the *message-list* render path in `wiadomosci.html` is still
`box.innerHTML = msgs.map(...)`. When a poll delivers a new message, every chip in the thread
is destroyed and recreated, so a user sitting on a chip loses focus to `<body>`. This is
narrower than finding 1 (it needs a new message to arrive, not just a reaction change) and
the strip-only path - the common one - is now safe, but the focusable chips are what makes
this path newly consequential: before this change the rebuilt subtree held only links.

A smaller note: each chip carries both `aria-pressed` and an accessible name that changes on
activation (`Dodaj swoją reakcję` → `Usuń swoją reakcję`). Screen readers will announce both
the state and the changed name. It is not wrong, but a stable name with `aria-pressed`
carrying the state alone is the more conventional toggle pattern.

The add button's hit slop is where geometry bites. `.chat-reactions` has `margin-top: 4px`
and the button is 32px tall, while the `::after` slop is 44x44 centred on it - so it extends
6px above the button box, i.e. ~2px into the bubble above. The button is `position: relative`,
so the pseudo-element paints above the bubble's non-positioned content and will absorb a tap
on anything in that 2px band. In practice that is a link on the bubble's last line, directly
above the add button; narrow, but a confirmed overlap rather than a hypothetical one.

**9. Polish wording - PASS.** `Wybierz reakcję`, `Zamknij`, `Dodaj reakcję do wiadomości`,
`Dodaj swoją reakcję`, `Usuń swoją reakcję`, `Zbyt wiele reakcji. Odczekaj chwilę`,
`Nieprawidłowa reakcja`, `Nieprawidłowa wiadomość`, `Nie znaleziono wiadomości`,
`To nie Twoja rozmowa`, `Błąd podczas zapisywania reakcji`, `Nie udało się zapisać reakcji` -
all gender-neutral, all Polish sentence case, no `dodal(a)` or masculine-only participle
anywhere. Emoji names (`serce`, `śmiech`, `łapka w górę`, `prezent`, `zdziwienie`,
`podziękowanie`) are neutral nouns. Counts use `plCount(count, 'osoba', 'osoby', 'osób')`,
the correct Polish triple, with a numeric fallback if `pluralize-pl.js` is missing.

**10. Forbidden files - PASS for this task.** `git diff --stat` shows `formularz.html`,
`formularz.js`, `notification-text.js`, `sw.js` and `app-theme.css` as modified, but grepping
their combined diff for `reaction|reakcj|chat-reaction` returns **0** lines - that is
concurrent agents' work (the `sw.js` hunk is a one-line `CACHE_NAME` bump to `prezenty-v119`,
which incidentally covers the modified `wiadomosci.html`). Reaction CSS is entirely in the new
`public/chat-reactions.css`; no rule was added to `wiadomosci.html`'s inline `<style>`. The
`server.js` footprint is additive and targeted: the require, the third `CREATE TABLE` inside
`ensureAnonMessageTables()`, the thread aggregate, the throttle, and the new endpoint.

**11. init-db.js - PASS.** 46 added lines, 0 removed: `anon_threads`, `anon_messages` and
`anon_message_reactions` with column and key definitions matching
`ensureAnonMessageTables()`, each `CREATE TABLE IF NOT EXISTS`, cross-reference comments in
both files naming the runtime ensure-function as the source of truth, and the three names
added to the closing summary.

## Verification evidence

The evidence file covers what I could not: a route test that loads the real `server.js`
through `Module._load` interception over a fake pool and drives the actually-registered
handlers (401/400/403/404 paths, toggle idempotence under six rapid repeats, response-key
assertions, no-notification assertions, the 429 after 30 toggles and its per-user scoping), a
52-assertion unit test of the pure logic, and a Playwright harness built from the real
`wiadomosci.html` that reports `focusKeptOnToggle.afterOptimistic.same=true`,
`focusFallbackOnChipRemoval.activeIsAddButton=true`, `sheetFocusKeptOnRepaint.same=true`, and
measured geometry (`pressedSize 53x32` vs `plainSize 53x32`, `visual 32x32` / `hitSlop 44x44`,
strip row 32px). Measured contrast: `#868F99` on `#ffffff` 3.28:1, on `#f8f9fa` 3.11:1, own
chip text 9.80:1. Zero console and page errors at 375, 320 and 1024. Per the review brief I
did not re-run any of it. Full WCAG conformance still needs manual assistive-technology
testing; what is on record is computed contrast plus driven keyboard behaviour.

</details>

<details>
<summary>Files changed</summary>

| File | What changed |
| --- | --- |
| `server.js` | require of the shared module, reactions DDL in `ensureAnonMessageTables()`, thread aggregate query, in-memory throttle, new toggle endpoint (the `notificationText` hunks are a concurrent task) |
| `init-db.js` | chat schema mirrored for fresh installs (+46, -0) |
| `public/chat-reactions.js` | new - pure logic shared with `server.js` plus the browser UI; this pass rewrote `refreshStrips()` into an in-place reconcile and made the picker grid build once |
| `public/chat-reactions.css` | new - chips (pressed state now border + inner ring, border `#868F99`), 32px add button with 44px hit slop and pointer-only hover reveal, bottom sheet / desktop card |
| `public/wiadomosci.html` | asset links at `?v=2`, `.chat-msg-row` wrapper, reaction signature in the poll, sheet markup |

</details>
