# Implementation plan - other side's reaction in the conversation-list preview

Worktree: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\chat-reaction-preview-1`
(branch `feat/chat-reaction-preview-1`, base `main`). Windows + PowerShell: use `;`, not `&&`.
OneDrive: retry on "cloud file provider exited unexpectedly". Never `git push`. Commit locally only.

**User intent (authoritative).** In the "wiadomości" conversation list, the last-message line must say that the
OTHER side reacted, never the viewer. Chosen wording, no name, gender-neutral (impersonal past form):

    Zareagowano 👍 na „treść wiadomości…”

No notifications for reactions (unchanged, deliberate). Out of scope: notifications, sort order, unread counts,
the reactions UI inside the thread view, other pages, CSS refactors, test refactors.

This is ONE coherent feature (~9 files, one data path from SQL to a text line). It does not decompose into
separable features, so no FEAT artifacts and no workflow restructuring: the existing implement-and-review loop runs
this plan.

---

## 1. What I read (facts the plan rests on)

- `routes/chat.js` `GET /api/wiadomosci/threads`: ONE query with correlated sub-selects (`last_body`, `last_at`,
  `unread_count`), `ORDER BY last_at DESC`, maps to `{ id, role, otherLabel, targetUserId, lastBody, lastAt,
  unreadCount }`. In DEMO_MODE it returns `demoThreadList(userId)` (`lib/demo-data.js`), "same projection".
- Reaction rows: `anon_message_reactions (id AUTO_INCREMENT, message_id, user_id, emoji, created_at TIMESTAMP)`,
  unique `(message_id, user_id, emoji)`, FK cascade to `anon_messages`. Toggle (`POST .../messages/:id/reactions`) is
  DELETE-then-INSERT, so a toggled-off reaction has NO row, and a re-added one gets a NEW higher `id`/`created_at`
  (ids are monotonic in creation order). The endpoint only lets thread participants react, so every reactor in a
  thread is one of `t.initiator_id` / `t.target_id`.
- There is no per-message delete endpoint (only thread delete, which cascades), so "reacted-to message is gone"
  means "the reaction row is gone" and falls out of the JOIN.
- Reactor side: identified by `user_id` compared with the VIEWER's session user id. "Other side" = `user_id <> viewer`
  (and `user_id IN (t.initiator_id, t.target_id)` as a defensive filter). This is role-independent: it is correct
  for the anonymous sender viewing sent threads (`role: initiator`) and for the recipient viewing received ones
  (`role: target`). No role branching needed.
- List UI: `public/wiadomosci-page.js` `loadThreads()` renders `<div class="thread-last">${escapeHtml(t.lastBody || '')}</div>`.
  `.thread-last` (in `public/wiadomosci-page.css`) is already `font-size:13px; color:#6b7280; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis`. The list refreshes: every 60 s when the list is shown, on every
  service-worker push relay with a `threadId`, on `visibilitychange`, on `showListView()`, on page open. `/api/*` is
  never cached by `public/sw.js`.
- `public/wiadomosci.html` loads (head) `pluralize-pl.js`, `notification-text.js` (no `?v`), `chat-reactions.js?v=2`,
  and (end of body) `wiadomosci-page.js?v=1`; CSS `wiadomosci-page.css?v=1`.
- `public/chat-reactions.js` is a dual module: pure logic (allowlist `CHAT_REACTIONS`, `isAllowedReactionEmoji`,
  `buildReactionList`, ...) exported via `module.exports` and required by `routes/chat.js`, `lib/chat.js`,
  `lib/demo-data.js` and by `tests/e2e/chat-reactions.spec.js`; the DOM part is guarded by `typeof document`.
  `window.ChatReactions.isAllowedReactionEmoji` exists in the browser. `wiadomosci-page.js` has a stub
  `reactionsApi` fallback WITHOUT that method.
- `public/notification-text.js` is the shared Polish wording module (IIFE, `root.notificationText = ...`,
  `module.exports = { notificationText, escapeHtml }`), required server-side by `routes/presents.js` and
  `routes/formularz.js`, loaded by `wiadomosci.html` and `activity.html`.
- Demo mode (`lib/demo-data.js`): `demoChat.reactions` is `Map<messageId, Map<emoji, Set<userId>>>` with NO timestamps.
  Seeds: msg 2 has ❤️{1}, 😂{1,2}, 👍{2..10}; msg 6 has 🎁{2}. Demo viewer is always user 1. Thread 1 (viewer is
  initiator, other = user 2, 7 msgs, last = msg 7 "Dzięki, zapisuję!"), thread 2 (viewer is target, other = user 3,
  2 unread), thread 3 (viewer is initiator -> Ola/user 3, ONE message, msg 10, the 64-char unbreakable
  "Niezwykle...dzieci"). Existing specs only open `/wiadomosci?rozmowa=1` and the list page (`wiadomosci-list`
  in `tests/helpers/pages.js`, ready = `.thread-row`); nothing asserts the list preview text.
- `tests/README.md`: one shared in-memory demo dataset, one demo user (id 1), `workers: 1`, "if your test mutates
  demo state, restore it", "Add fixtures in `lib/demo-data.js`, append, do not renumber ids". The suite cannot
  execute SQL (no DB) and cannot exercise a second account.
- Escaping: `escapeHtml` in `wiadomosci-page.js` is the `textContent -> innerHTML` idiom, safe for ELEMENT CONTENT
  (that is where the preview goes; `xss-fix-plan.md` explicitly leaves the `wiadomosci` content uses alone). The
  rule from `xss-fix-plan.md`/`tests/e2e/xss-usernames.spec.js`: never put user text in attributes/inline handlers
  with that helper; assert payloads render as literal text.

---

## 2. Decisions (recommend -> coder implements; "REVISIT?" = the user may want to change it)

**D1 - Data: new optional `lastReaction` on each thread from `GET /api/wiadomosci/threads`.**

    lastReaction: null | { emoji: '👍', at: <ISO/Date>, messageId: 123, excerpt: 'Cześć! Jaki rozmiar buta…' }

All existing fields unchanged; key is always present (`null` when not applicable) so the client does not need
`'lastReaction' in t`. No user id, username, "reactor" or role leaks (the client already knows `role`; the
only fact added is "the other party reacted with E to message M at T", which a participant can already see in the
thread view as an aggregate). Key names deliberately avoid `/user|sender|reactor|identit|author|owner/`
(the regex `tests/e2e/chat-reactions.spec.js` uses to police payloads).

Computation, ONE extra query for all of the viewer's threads (no N+1), run after the existing threads query:

```sql
SELECT r.id, r.emoji, r.created_at AS reacted_at, r.message_id, m.thread_id, m.body
FROM anon_message_reactions r
JOIN anon_messages m ON m.id = r.message_id
JOIN anon_threads  t ON t.id = m.thread_id
WHERE (t.initiator_id = ? OR t.target_id = ?)
  AND r.user_id <> ?
  AND r.user_id IN (t.initiator_id, t.target_id)
  AND r.id = (
      SELECT r2.id
      FROM anon_message_reactions r2
      JOIN anon_messages m2 ON m2.id = r2.message_id
      WHERE m2.thread_id = m.thread_id
        AND r2.user_id <> ?
        AND r2.user_id IN (t.initiator_id, t.target_id)
      ORDER BY r2.id DESC
      LIMIT 1)
```
params `[userId, userId, userId, userId]`. It yields at most one row per thread: the other side's NEWEST
surviving reaction (newest = highest `id`, which equals creation order because toggle is delete+insert; no
window functions, so it also runs on MySQL 5.7). Viewer's own reactions are excluded by `r.user_id <> viewer` in
both the outer filter and the "newest" pick, so a viewer reaction can never mask or become the preview.
Extend the existing threads query with one more sub-select `last_id` (id of the last message) so the comparison
in D2 has it. Wrap the reaction query in its own `try/catch` that logs and continues with no `lastReaction`
(a failure in this nice-to-have must not break the whole list); the main query keeps `handleDbError`.

**D2 - When the reaction replaces the last-message preview.** `lastReaction` is non-null only when the other
side's newest reaction is NEWER than the thread's last message: `reacted_at > last_at`, OR the reaction targets the
last message itself (`message_id === last_id`; a reaction on the last message necessarily postdates it, and this
removes the 1-second `TIMESTAMP` tie). Otherwise `null` -> normal `lastBody` preview, so a newer message from either
party always wins again. Toggled off -> row deleted -> falls back to the next-newest other-side reaction if one
exists and is still newer than the last message, else normal preview. Reacted-to message gone -> row cascaded away
-> normal preview. Off-allowlist emoji (legacy row) -> `null` (validated with `isAllowedReactionEmoji`).

One shared pure implementation used by BOTH the SQL path and the demo path (so demo tests exercise the shipped
logic): add to the pure section of `public/chat-reactions.js` and export in `core`:

- `reactionExcerpt(body, max = 50)`: `String(body ?? '')`, collapse all whitespace runs (incl. newlines) to one
  space, trim; if longer than `max` CODE POINTS (use `Array.from`, never `.slice` on UTF-16 units, so emoji/surrogate
  pairs are not split) cut to `max - 1` code points, `trimEnd()`, append `…`. This is the same "show the raw text,
  let the line clamp it" behaviour the normal preview has (there is no richer last-message excerpt logic to reuse:
  the list prints raw `lastBody`; link-only messages therefore show the URL, which is consistent). Empty/whitespace
  -> `''`. The messages table has body only (no attachments), so there is no attachment case.
- `buildLastReaction(row, last)`: `row` = `{ emoji, reacted_at, message_id, body }` (or null), `last` =
  `{ id, at }`. Returns `null` or `{ emoji, at: row.reacted_at, messageId: Number(row.message_id), excerpt:
  reactionExcerpt(row.body) }` per the rule above (Date/ISO strings compared via `new Date(...)`, NaN -> `null`).

**D3 - Sort order, unread counts, badges: unchanged.** `ORDER BY last_at DESC` stays; `unreadCount`, the dock
badge and `GET /api/wiadomosci/unread-count` do not change. Consequences to report in the final summary:
(a) a thread with a fresh reaction does not move to the top; (b) the preview text changes but there is no unread
badge or push for it, so it is easy to miss; (c) the time label on the row stays `timeAgo(lastAt)` (time of the last
MESSAGE, consistent with the sort; showing the reaction time would make the list look unsorted). REVISIT?:
optional follow-up "bump thread by reaction time" and/or "show the reaction time" - both are deliberately NOT done.
Also REVISIT?: the line stays until a newer message or the reaction is toggled off, even after the viewer opened
the thread (there is no read state for reactions).

**D4 - Wording lives in ONE place: `public/notification-text.js`.** Add

```js
// "Zareagowano 👍 na „treść…”" - impersonal past form: no name, no gender.
// Plain text on purpose (callers escape for their own context).
function reactionPreview(emoji, excerpt) {
    const text = String(excerpt == null ? '' : excerpt);
    return text ? `Zareagowano ${emoji} na „${text}”` : `Zareagowano ${emoji} na wiadomość`;
}
```
exported as `root.reactionPreview = reactionPreview;` and added to `module.exports` (keep the file's export style;
update its header comment). Changing the wording later = editing that one template. The client builds the string
from the structured field; the server sends NO wording. The empty-excerpt fallback "na wiadomość" is an assumption
(a body can't be empty today because POST trims and rejects empty).

**D5 - Security.** `emoji` and `excerpt` are user-influenced. Server: emoji is re-validated against the allowlist
(D2) and the excerpt is collapsed + truncated server-side (D2). Client: only call `reactionPreview` when
`typeof reactionsApi.isAllowedReactionEmoji === 'function' && reactionsApi.isAllowedReactionEmoji(r.emoji)` and
`typeof window.reactionPreview === 'function'`; otherwise fail closed to the normal `lastBody` preview. The
resulting string goes through the existing `escapeHtml(...)` into element content (exactly like `lastBody` today),
never into an attribute or inline handler. No new `innerHTML` of raw values. Not logged: no emoji->user pairs
(the route has none; keep it that way).

**D6 - Accessibility / visual.** Reuse `.thread-last` as is: same font, muted `#6b7280`, one line, nowrap +
ellipsis clamp. NO new CSS class, NO CSS change (`wiadomosci-page.css` untouched, so no conflict with the
`css-consolidate-1` workflow and no `?v` bump for it). No new interactive element; the row remains the existing
clickable `div`. The emoji is read by screen readers in its default name (acceptable; a per-emoji Polish name span
is possible later). The 50-code-point excerpt cap plus the CSS clamp keep the line to one row at 320/375/1024; the
demo seed (below) puts the worst case (a 64-char unbreakable word) on the list so
`tests/e2e/no-horizontal-overflow.spec.js` (`wiadomosci-list` x all viewports) and the a11y smoke automatically
cover it.

**D7 - Live update.** No new plumbing: `lastReaction` flows through the same `loadThreads()` that already refreshes
the list (60 s poll while the list is open, push relay, `visibilitychange`, `showListView`, page open). Reactions
produce no push, so the other side's reaction appears on the next of those refreshes (worst case about 60 s while
the list stays open; immediately on page open/refocus). State this in the final summary. Do not add polling.

---

## 3. Conflict context (sibling worktrees)

Do NOT touch `.worktrees/split-recipients-1` (`public/recipients.js`, `recipients.html` script tags, `sw.js`) or
`.worktrees/css-consolidate-1` (CSS files, `<link>` tags, `sw.js`). This feature touches no CSS and no
`recipients.*`. Expected overlap is only `public/sw.js` (and `<link>`/`<script>` lines in `wiadomosci.html`, which
`css-consolidate-1` may edit): bump `CACHE_NAME` ONCE (`prezenty-v125` -> `prezenty-v126`) and update the one
`urlsToCache` entry for `wiadomosci-page.js`. On rebase: keep BOTH sides' `urlsToCache` entries and make
`CACHE_NAME` strictly greater than main's at that time. Bump the `?v=` of every asset whose bytes change:

| Asset changed | Where it is referenced | Action |
| --- | --- | --- |
| `public/wiadomosci-page.js` | `wiadomosci.html` `?v=1`; `sw.js` `'/wiadomosci-page.js?v=1'` | `?v=2` in BOTH |
| `public/chat-reactions.js` | `wiadomosci.html` `?v=2`; `sw.js` has unversioned `'/chat-reactions.js'` | `?v=3` in html; sw entry unchanged |
| `public/notification-text.js` | `wiadomosci.html` no `?v`; `activity.html` no `?v`; `sw.js` unversioned | add `?v=2` to the `wiadomosci.html` tag only; the `CACHE_NAME` bump invalidates the cache-first copy for `activity.html` (its bytes change but its behaviour doesn't) |
| `wiadomosci-page.css` | - | not changed |

---

## 4. Ordered steps

Each step leaves the repo buildable. There is no build step ("No build step required"); "build" = `node --check` +
the Playwright suite.

- [ ] 0. **Prepare the test environment in the worktree.** `tests/.cache/` (CDN cache) is gitignored and missing here.
      Copy it from the main checkout so no internet is needed:
      `Copy-Item -Recurse -Force "c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\tests\.cache" ".\tests\.cache"`
      (run with cwd = worktree; retry on OneDrive errors). `node_modules` already exists.
      Verify: `npx playwright test --list` lists the specs (exit 0).

- [ ] 1. **Wording: add `reactionPreview` to `public/notification-text.js`** (D4). Update the header comment, add
      `root.reactionPreview`, add to `module.exports`.
      Files: `public/notification-text.js`
      Verify: `node --check public/notification-text.js`; `node -e "console.log(require('./public/notification-text').reactionPreview('👍','Cześć'))"`
      prints `Zareagowano 👍 na „Cześć”`.

- [ ] 2. **Shared pure logic: `reactionExcerpt` + `buildLastReaction` in `public/chat-reactions.js`** (D2). Add to the
      pure section (above `core`), export both in `core` and also on `root.ChatReactions` (browser object) for
      symmetry. Update the file-header privacy comment: the wire shapes are now `{ emoji, count, mine }` for
      aggregates and `{ emoji, at, messageId, excerpt }` for the list preview; still no user id/name anywhere, and
      still nothing touches notifications/push/unread.
      Files: `public/chat-reactions.js`
      Verify: `node --check public/chat-reactions.js`; quick node one-liner: `reactionExcerpt('a\n  b')` -> `a b`;
      a 64-char string -> 50 code points ending in `…`; `buildLastReaction` returns `null` for an older reaction,
      non-null for newer / same-message, `null` for an off-allowlist emoji.

- [ ] 3. **Server: `routes/chat.js` threads endpoint** (D1/D2). Add `last_id` sub-select to the existing query; run
      the single reaction query (own try/catch, fall back to no reactions); index rows by `thread_id`; per thread
      `lastReaction: buildLastReaction(row, { id: t.last_id, at: t.last_at })` (or `null`). Import
      `buildLastReaction` from `../public/chat-reactions` in the existing destructure. Keep `ORDER BY last_at DESC`
      and every existing field exactly as is. Add a comment next to it: viewer's own reactions are excluded,
      no identity leaves the server, and the reactions endpoints still create no notification/push/unread change.
      Do NOT touch the reactions POST handler, `lib/chat.js` notification code, or `unread-count`.
      Files: `routes/chat.js`
      Verify: `node --check routes/chat.js`. The SQL cannot be run in this repo's tests (no DB): re-read the query
      against the DDL in `lib/chat.js` (column names, `user_id <> ?` placeholder count = 4, `id` ordering) and state
      in the final report that it is UNVERIFIED by execution; if a local MySQL is available and `.env` credentials
      exist, run it once, otherwise do not attempt `npm run init-db`/production DB. The README already records a
      real two-account MySQL smoke test as owed - repeat that for this feature in the report.

- [ ] 4. **Demo data: timestamps + other-side seed + `lastReaction` in `demoThreadList`** (`lib/demo-data.js`).
      a. Add `reactionTimes: new Map()` to `demoChat` (key `` `${messageId}|${emoji}|${userId}` `` -> `Date`) and a
         helper `demoReactionTime(messageId, emoji, userId)` returning the stored time, else the target message's
         `created_at + 60000` ms (so existing seeds are "just after their message" and stay OLDER than thread 1's
         last message: thread 1's preview must remain the normal one).
      b. `demoReactionToggle`: record `new Date()` when added; delete the key when removed (also tidy keys when a
         thread is deleted in `routes/chat.js` if trivial; otherwise skip, keys are harmless).
      c. Append ONE seed: `[10, new Map([['🙏', new Set([3])]])]` to `demoChat.reactions` (Ola, the other side, reacts
         to the viewer's last message in thread 3). Append only; do not renumber anything.
      d. New helper `demoLastReactionRow(threadId, userId)`: scan the thread's messages' reactions, keep entries with
         `userId !== viewer` that are thread participants, pick the newest by `demoReactionTime` (ties: higher message
         id), return `{ emoji, reacted_at, message_id, body }` or `null` (same row shape as the SQL).
      e. `demoThreadList`: add `lastReaction: buildLastReaction(demoLastReactionRow(t.id, userId), { id: last.id,
         at: last.created_at })` (null when no last message). Import `buildLastReaction` next to the existing
         `toggleAction` import. Export the new helper if routes need it (they should not).
      Expected demo result for viewer 1: thread 1 `null` (seed reactions older than msg 7), thread 2 `null`,
      thread 3 `{ emoji:'🙏', messageId:10, excerpt:'Niezwyklenie…' (49 chars + …), at }`. Order stays [1,2,3];
      `unreadCount` stays [0,2,0].
      Files: `lib/demo-data.js`
      Verify: `node --check lib/demo-data.js`; `node -e "const d=require('./lib/demo-data'); console.log(JSON.stringify(d.demoThreadList(1),null,1))"`
      shows exactly the expected values above, and `demoThreadList(3)` / `(2)` (other viewers) show NO reaction in
      thread 3 for Ola herself (her own reaction must not appear to her) while viewer 3 does see user-2/viewer-1
      reactions only if newer than the last message (none seeded -> `null`).

- [ ] 5. **Client: render the reaction line** (`public/wiadomosci-page.js`, `public/wiadomosci.html`).
      a. In `wiadomosci-page.js` add `threadPreviewText(t)` (D5): if `t.lastReaction` has an allowlisted emoji
         (via `reactionsApi.isAllowedReactionEmoji`, fail closed if the stub lacks it) and
         `typeof window.reactionPreview === 'function'`, return `window.reactionPreview(r.emoji, r.excerpt)`; else
         `t.lastBody || ''`. In `loadThreads()` replace `escapeHtml(t.lastBody || '')` with
         `escapeHtml(threadPreviewText(t))`. Leave `timeAgo(t.lastAt)`, the unread badge, `thread-who` and the sort
         untouched (D3). No other change to the file.
      b. In `wiadomosci.html`: `wiadomosci-page.js?v=1` -> `?v=2`, `chat-reactions.js?v=2` -> `?v=3`,
         `notification-text.js` -> `notification-text.js?v=2`. No other change (css-consolidate may edit nearby
         `<link>` lines: keep the diff to these three tokens).
      Files: `public/wiadomosci-page.js`, `public/wiadomosci.html`
      Verify: `node --check public/wiadomosci-page.js`; then in demo mode in a REAL browser (see step 8) the
      list shows the new line for thread 3 - reading the code is not verification.

- [ ] 6. **Service worker: `public/sw.js`.** `CACHE_NAME` `prezenty-v125` -> `prezenty-v126`; the
      `urlsToCache` entry `'/wiadomosci-page.js?v=1'` -> `'/wiadomosci-page.js?v=2'`. Nothing else. (No new files are
      added by this feature, so no new precache entries.) Before committing, `git fetch`/compare with `main`'s
      value and ensure the new name is strictly greater.
      Files: `public/sw.js`
      Verify: `node --check public/sw.js`.

- [ ] 7. **Tests: new `tests/e2e/chat-reaction-preview.spec.js`** (house rules: import from `../fixtures`, use
      `openPage`/`setViewport`, no `waitForTimeout`, measured values in messages, restore demo state).
      Cases:
      1. Pure (no browser): `reactionPreview('👍','Cześć')` === `Zareagowano 👍 na „Cześć”`; empty excerpt ->
         `Zareagowano 👍 na wiadomość`; the string contains no name/pronoun. `reactionExcerpt`: whitespace/newline
         collapse, 50-code-point cap with `…`, emoji not split, empty -> `''`. `buildLastReaction`: older -> null,
         newer -> object, same-message tie -> object, off-allowlist emoji -> null, null row -> null, key set is
         exactly `emoji, at, messageId, excerpt`.
      2. API (demo): `GET /api/wiadomosci/threads` via `page.request`/`page.evaluate(fetch)`: every thread keeps
         `id, role, otherLabel, targetUserId, lastBody, lastAt, unreadCount` and gains `lastReaction`; thread 3's is
         `{ emoji:'🙏', messageId:10 }` with an excerpt that is whitespace-collapsed, <= 50 code points and ends in
         `…`; threads 1 and 2 are `null`; order is still [1,2,3] and `unreadCount` still [0,2,0]; no key matching
         `/user|sender|reactor|identit|author|owner/` anywhere in the payload (reuse the `identityKeys` idea).
      3. UI list: open `/wiadomosci` (`wiadomosci-list`); thread 3's `.thread-last` text matches
         `^Zareagowano 🙏 na „Niezwykle\S*…”$`; thread 1's `.thread-last` is still `Dzięki, zapisuję!`.
      4. Own reactions never appear: as the demo viewer, POST a reaction on message 7 (thread 1's last message) and
         on message 10 (❤️, thread 3); re-GET the list: thread 1 `lastReaction` is `null` and its preview is the
         normal text; thread 3 still shows 🙏 (the OTHER side's), never ❤️. Toggle both back in a `finally`
         (restore shared state; the server throttle is 30 per 10 s - stay far below it). Also assert the reactions
         POST response still has only `success, action, messageId, emoji, reactions` (no new keys) and that
         `GET /api/wiadomosci/unread-count` is unchanged by reacting.
      5. Overflow/clamp at 320, 375, 1024: `setViewport` then `collectOverflow` (from `helpers/overflow`) reports no
         overflow on `/wiadomosci`; `.thread-last` for thread 3 is a single line (`scrollHeight <= clientHeight + 1`)
         and `getComputedStyle` still has `white-space: nowrap`, `text-overflow: ellipsis`, colour `rgb(107, 114, 128)`,
         font-size `13px` (same as a normal preview).
      6. Escaping: `page.route('**/api/wiadomosci/threads', ...)` (register BEFORE `openPage`) returning a thread with
         `lastReaction.excerpt = '<img src=x onerror=window.__xss=1>"\'&'` and a valid emoji: `.thread-last`
         `textContent` equals `reactionPreview(...)` of it literally, the row contains no `img`/`script` element,
         `window.__xss` is undefined. Second route variant with an off-allowlist emoji (`'<b>x</b>'`) -> the row
         falls back to the normal `lastBody`.
      7. No-notification guard: a plain read assertion is NOT enough here, but add a cheap runtime one: after the
         reaction POST in case 4, `GET /api/notifications` (or whatever the demo list endpoint is; read
         `routes/notifications.js` first) contains no new entry compared with before.
      Also: `tests/README.md` - add `chat-reaction-preview` to the spec list (alphabetical) and extend the `demoChat`
      bullet with "one seeded reaction from the other side (Ola on message 10) so the list shows the
      `Zareagowano ...` line".
      Files: `tests/e2e/chat-reaction-preview.spec.js` (new), `tests/README.md`
      Verify: `npm run test:e2e -- chat-reaction-preview` all green.

- [ ] 8. **Full verification, in demo mode, in a real browser** (this is the "needs verification during
      implementation" item; do NOT conclude from reading code):
      a. `npm run test:e2e` for the whole suite (expect the same 11 documented fixme skips as before and no new
         failures; `no-horizontal-overflow`, `a11y`, `chat-reactions`, `escaping`, `wrapping`, `xss-usernames`,
         `pluralization`, `smoke` must stay green).
      b. `npm run offline` (demo server, see `tests/helpers/start-demo-server.js`; or `node tests/helpers/start-demo-server.js --foreground`),
         open `/wiadomosci` in Edge at 320, 375 and 1024 px and look at the list: thread 3 reads
         `Zareagowano 🙏 na „Niezwyklenie…”` clamped on one line with the same muted style as the other rows; threads 1
         and 2 unchanged. Then react to the last message of thread 1 yourself and confirm its row does NOT change.
      c. Confirm in the Network tab that the thread payload contains `lastReaction` only as specified and that no
         request to a notification/push endpoint is made by reacting.
      d. Honest limits to state in the report: SQL not executed (no DB in this suite); the "other side toggled it
         off / a newer message arrived" transitions are covered by pure-function tests + reasoning, not by a
         two-account run; Edge/Chromium only.
      Verify: all of the above green; record outputs briefly in the final report.

- [ ] 9. **Commit locally** (never push), conventional message, one commit for the feature (or two if tests are
      separated): e.g. `feat(wiadomosci): show other side's reaction in thread list preview`. Stage specific files only:
      `public/notification-text.js public/chat-reactions.js routes/chat.js lib/demo-data.js public/wiadomosci-page.js
      public/wiadomosci.html public/sw.js tests/e2e/chat-reaction-preview.spec.js tests/README.md`. Do not stage
      `.agents/` artifacts unless the repo already tracks them. Re-read `git -P diff --stat` and confirm no CSS file,
      no `recipients.*`, no sibling-worktree path is in it.

---

## 5. Assumptions / things the user may want to revisit (put in the final summary)

1. Any reaction by the other side counts, including a reaction to their OWN message (the schema allows it).
   Restricting to "reactions on the viewer's messages" is a one-line change in the SQL (`m.sender_id = viewer`) but
   would need `sender_id` in that query; not done to keep the rule simple.
2. Row time label and sort stay tied to the last MESSAGE (D3); no bump on reaction, no unread badge, no push.
3. Only the single newest other-side reaction is shown (no "and N more"), and it persists until a newer message or
   it is toggled off.
4. Excerpt cap is 50 code points server-side (adjust the default in `reactionExcerpt`); the CSS clamp still cuts
   the line at the row width on narrow phones, so the closing quote may be clipped there, exactly like the normal
   preview.
5. Reactions appear in the list within the existing refresh cadence (<= 60 s while the list is open), because they
   deliberately send no push.
6. `notification-text.js` gets `?v=2` only on `wiadomosci.html`; `activity.html` relies on the `CACHE_NAME` bump.
