# Implementation plan - emoji reactions in the anonymous chat

User request (verbatim): *"in the chat can you add reactions to messages? you don't need to notify about them."*

Everything below is grounded in the code as it stands on `main` (working tree read on the planning pass). Line numbers are from the current working tree and will drift once edits land - use the quoted anchors, not the numbers.

---

## 1. What the chat actually is today (findings)

**Server (`server.js`, section `==================== Anonymous messages (wiadomości) ====================`, ~line 2544 onwards)**

| Thing | Detail |
| --- | --- |
| Tables | `anon_threads (id, initiator_id, target_id, created_at)` and `anon_messages (id, thread_id, sender_id, body, is_read, created_at)`. Created lazily by `ensureAnonMessageTables()` (~2550), latched by the module-level `let anonTablesEnsured = false` and skipped entirely when `DEMO_MODE`. Every chat endpoint `await ensureAnonMessageTables()` first. |
| Auth | `requireAuth` (defined ~line 538, session based, returns `401 {error:'Wymagana autoryzacja'}`). Used on **all** `/api/wiadomosci/*` routes. |
| Participation check | Repeated inline in every thread route: `SELECT * FROM anon_threads WHERE id = ?`, then `if (thread.initiator_id !== userId && thread.target_id !== userId) return forbidden(res, 'To nie Twoja rozmowa')`. |
| Helpers | `handleDbError`, `notFound`, `forbidden`, `conflict`, `badRequest` (lines 142-161). All queries use `pool.execute` with `?` placeholders. |
| Identity exposure | `GET /api/wiadomosci/threads/:id` maps messages to `{ id, fromMe, body, createdAt }` with the comment *"sender_id is NEVER exposed - only fromMe"*. The initiator sees the target's username (`otherLabel`); the target only ever sees `'Święty Mikołaj 🎅'`. |
| Rate limiting | **None exists** anywhere in `server.js` (no `express-rate-limit` dependency in `package.json`). Nothing to reuse, and requirement 5 forbids a new dependency - so throttling is client side only (see decision D7). |
| Notifications | `notifyAnonMessage()` (~2585) deliberately **only** sends web-push, no `notifications` row. `ensureNotificationsTable()` is at ~3016. None of this is touched by this feature. |

**Chat endpoints that exist (unchanged list):**

- `GET  /api/wiadomosci/users`
- `GET  /api/wiadomosci/threads`
- `GET  /api/wiadomosci/unread-count`
- `POST /api/wiadomosci/threads`
- `GET  /api/wiadomosci/threads/:id`  ← reactions ride along in this payload
- `DELETE /api/wiadomosci/threads/:id`
- `POST /api/wiadomosci/threads/:id/messages`
- `GET  /api/link-preview?url=`

**Client (`public/wiadomosci.html`, single file - inline `<style>` at lines 25-152 and one inline `<script>` at 244-664; there is no `wiadomosci.js`)**

- Loads `styles.deduped.min.css`, `bottom-tab-bar.css?v=41`, `app-theme.css?v=13`, Bootstrap 5.3 CSS+JS, Font Awesome 6, Remixicon 3.5, plus `pluralize-pl.js` and `notification-text.js`; at the end `tab-bar-functions.js?v=16` and `desktop-nav.js?v=5`.
- **`public/realtime-updates.js` is NOT loaded on this page** (it is recipients-oriented: its hash fallback early-returns unless the path contains `recipients`). So the chat's refresh mechanism is entirely local to `wiadomosci.html`:
  1. `setInterval(() => { if (currentThreadId) loadThreadMessages(); }, 8000)` - the open conversation polls every 8 s.
  2. `setInterval(() => { if (!currentThreadId) loadThreads(); }, 60000)` - the list polls every 60 s.
  3. A `navigator.serviceWorker` `message` listener: the SW relays every push, and a push carrying `threadId` triggers an immediate `loadThreadMessages()`.
  4. `visibilitychange` → immediate refresh of whichever view is open.
- `loadThreadMessages()` fetches `/api/wiadomosci/threads/<id>`, builds a signature `sig = threadId + ':' + msgs.length + ':' + lastId`, and **returns early when the signature is unchanged** so the DOM and the scroll position survive polls. On change it does a full `box.innerHTML = ...` and then `box.scrollTop = box.scrollHeight`.
- Bubbles: `<div class="chat-bubble from-me|from-them">` + inner `renderMessageBody()` + `<div id="lp-<id>">` (link-preview slot) + `<div class="chat-time">`. `.chat-messages` is `display:flex; flex-direction:column; gap:8px`, the bubbles use `align-self` and `max-width: 82%`.
- `.chat-bubble.from-me, .chat-bubble.from-me * { color: #ffffff !important; }` - anything rendered *inside* an own-side bubble is forced white. This dictates decision D5.
- Existing client helpers to reuse: `escapeHtml()` (textContent-based), `showToast(message, 'success'|'error')` (Bootstrap toasts already in the markup), `timeAgo()`, and the globals from `pluralize-pl.js` (`plForm`/`plPlural`/`plCount`).

**Other facts**

- `init-db.js` creates only `users`, `recipients`, `presents`, `sessions` + an index list. It does **not** contain the `anon_*` chat tables, nor `notifications`, nor `push_subscriptions`.
- `public/sw.js` line 1: `const CACHE_NAME = 'prezenty-v118';` - `urlsToCache` lists only a handful of shared assets. **`sw.js` is off-limits for this task**; the orchestrator bumps the cache afterwards.
- `package.json` has no test runner (`"test": "echo 'No tests specified'"`). Scripts: `start`, `dev`, `offline` (`cross-env OFFLINE_MODE=true ... node server.js`), `init-db`. `PORT` defaults to **3002**.
- `OFFLINE_MODE=true` (or a missing `DB_PASSWORD`) forces `DEMO_MODE`, in which the chat GETs return empty arrays and the chat POSTs return `503 {error:'Niedostępne w trybie demo'}`. Useful only for route-wiring smoke tests, not for data tests.
- Other agents currently have `server.js`, `public/app-theme.css`, `public/formularz.*`, `public/notification-text.js` and `public/tab-bar-functions.js` dirty. Per the concurrency constraints this plan touches **none** of those except `server.js`, and there only with targeted edits inside the chat section / new blocks.

---

## 2. Decisions

**D1 - Emoji set (fixed, server-validated, 6 entries).** `['❤️','😂','👍','🎁','😮','🙏']` - heart, joy, thumbs-up, gift, wow, thanks. Six covers the festive range, fits a 3x2 grid that stays thumb-sized at 320 px, and keeps the chip row from ever wrapping more than twice. Stored as the exact code-point sequence from the allowlist (`❤️` is U+2764 U+FE0F); because the server only ever writes a value taken *from* the allowlist, the stored form is canonical by construction. Rendering order follows allowlist order so chip order is stable across clients. Polish names for a11y labels: `serce`, `śmiech`, `łapka w górę`, `prezent`, `zdziwienie`, `podziękowanie` - all gender-neutral.

**D2 - `COLLATE utf8mb4_bin` on the emoji column.** Under `utf8mb4_general_ci` / `utf8mb4_unicode_ci` many 4-byte emoji compare **equal**, which would make `UNIQUE (message_id, user_id, emoji)` allow only one reaction per user per message and make `GROUP BY emoji` collapse all six into one bucket. The column is therefore declared `VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`. Precedent for a per-column binary collation already exists in the repo (`sessions.session_id COLLATE utf8mb4_bin` in `init-db.js`).

**D3 - Reactions travel in the existing thread payload.** No new GET, no second polling loop: `GET /api/wiadomosci/threads/:id` gains a `reactions` array per message, so the existing 8 s poll / push-relay / `visibilitychange` refresh delivers the other participant's reactions with zero new plumbing. One extra aggregate query per thread load (requirement 7).

**D4 - Toggle endpoint returns the fresh aggregate.** `POST /api/wiadomosci/messages/:messageId/reactions` responds with the recomputed aggregate for that one message, so the client reconciles immediately instead of waiting up to 8 s.

**D5 - Chips live OUTSIDE the bubble, in a new per-message wrapper.** `.chat-bubble.from-me * { color:#fff !important }` would whiten chip text and counts inside an own-side bubble. Each message is therefore wrapped in `.chat-msg-row` (flex column; `max-width:82%`; `align-self`/`align-items` flipped by a `from-me`/`from-them` class) holding the untouched `.chat-bubble` plus a sibling `.chat-reactions` strip. The bubble's own CSS stays exactly as it is.

**D6 - Picker: one page-level bottom sheet, reused for every message.** Hand-rolled (not a Bootstrap modal) because `app-theme.css` is off-limits and its sheet CSS is scoped to `#editPresentModal`; the new sheet gets its own styles in `public/chat-reactions.css` that visually match that pattern (slide-up, 20 px top radius, grab handle, `max-height: 90dvh` with internal scroll, `env(safe-area-inset-bottom)` padding). Above 768 px the same element renders as a small centered popover card. Six buttons in a 3x2 grid, each ≥ 56x56 px (6-across would need ~294 px of inner width at a 320 px viewport, which does not fit).

**D7 - No long-press shortcut.** Requirement 6 permits it only if it does not break text selection or scrolling. A 500 ms press-hold handler on a bubble inside a `overflow-y:auto` chat log needs `touch-action`/`user-select` suppression to be reliable, which costs exactly those two behaviours. The per-bubble "add reaction" button is already a ≥ 44 px thumb target, so the shortcut is skipped deliberately.

**D8 - Counts are always shown, including `1`.** Consistent chip width, no reflow when a count goes 1 → 2 → 1, and the count is what makes the chip readable as data rather than decoration.

**D9 - `init-db.js` gets the whole chat schema, mirrored.** The reactions table has FKs to `anon_messages` and `users`, and `anon_messages` is absent from `init-db.js`, so the reactions DDL alone cannot be added there. `npm run init-db` therefore gains an idempotent chat block creating `anon_threads`, `anon_messages` and `anon_message_reactions`, byte-identical in column/key definitions to `ensureAnonMessageTables()`, with a cross-reference comment in **both** places noting the mirror must stay in sync. Everything is `CREATE TABLE IF NOT EXISTS`, so running it against an existing database is a no-op and the lazy ensure-function remains the runtime source of truth.

**D10 - New assets, not edits to shared files.** `public/chat-reactions.css` + `public/chat-reactions.js`, both linked from `wiadomosci.html` with `?v=1`. The chat's JS is inline today; putting the reaction logic in its own file keeps the `wiadomosci.html` diff small and makes the logic `node --check`-able.

### How the privacy constraint is satisfied

1. `anon_message_reactions.user_id` exists **only** server-side, for the toggle lookup and the unique key. No endpoint, response field, or log line emits it.
2. The only shape ever sent to a browser is `{ emoji: string, count: number, mine: boolean }`. There is no per-user list, no `user_id`, no `username`, no "who reacted" endpoint - not even a masked label. `mine` is computed server-side from `req.session.userId`.
3. The aggregate query is scoped by `JOIN anon_messages m ... WHERE m.thread_id = ?` **after** the caller has been confirmed a participant, so reactions from other threads can never be read.
4. The toggle endpoint re-derives participation from the message itself (`anon_messages` → `anon_threads`) and returns `403 'To nie Twoja rozmowa'` otherwise, exactly like the existing thread routes. It never returns `sender_id`, so reacting cannot be used to probe who wrote a message.
5. Inherent 2-party inference is unchanged: in a 2-person thread, `count - (mine ? 1 : 0) > 0` tells you "the other side reacted" - the same pseudonymous fact that receiving a message already tells you. The target still only ever sees `Święty Mikołaj 🎅`; no real identity is added by this feature. This is the anonymous-safe default and matches the mode the existing chat already uses (`sender_id` never leaves the server).
6. Server-side logging stays identity-free: log `messageId` + `added`/`removed` only, never the user id or the emoji→user pair.

### Confirmation: no notification path is touched

The new endpoint and the modified GET contain **no** reference to `notifications`, `ensureNotificationsTable`, `sendPushToUser`, `notifyAnonMessage`, `webpush`, the activity feed, or `notification-text.js`. Reactions do not write `anon_messages.is_read`, do not affect `GET /api/wiadomosci/unread-count`, and do not touch the dock badge (`updateMessagesBadge`). `public/notification-text.js` and `public/sw.js` are not edited. The new code imports nothing new. Item 9 below re-verifies this against the actual diff.

---

## 3. API surface

### `GET /api/wiadomosci/threads/:id` (modified - additive)

`requireAuth`, existing 404/403 behaviour unchanged. Each entry of `messages` gains `reactions`:

```json
{
  "threadId": 12,
  "role": "initiator",
  "otherLabel": "Ania",
  "messages": [
    {
      "id": 345,
      "fromMe": true,
      "body": "Jaki rozmiar buta nosisz?",
      "createdAt": "2025-12-01T18:04:11.000Z",
      "reactions": [
        { "emoji": "❤️", "count": 2, "mine": true },
        { "emoji": "🎁", "count": 1, "mine": false }
      ]
    }
  ]
}
```

`reactions` is `[]` when there are none, is ordered by the allowlist, and only contains emoji with `count >= 1`. `DEMO_MODE` keeps returning `{ messages: [] }`.

### `POST /api/wiadomosci/messages/:messageId/reactions` (new)

Request: `{ "emoji": "❤️" }`

| Status | Body | When |
| --- | --- | --- |
| 200 | `{ "success": true, "action": "added"\|"removed", "messageId": 345, "emoji": "❤️", "reactions": [{emoji,count,mine}] }` | toggled |
| 400 | `{ "error": "Nieprawidłowa reakcja" }` | `emoji` missing / not in the allowlist |
| 400 | `{ "error": "Nieprawidłowa wiadomość" }` | `messageId` not a positive integer |
| 401 | `{ "error": "Wymagana autoryzacja" }` | `requireAuth` |
| 403 | `{ "error": "To nie Twoja rozmowa" }` | caller is not `initiator_id`/`target_id` of the message's thread |
| 404 | `{ "error": "Nie znaleziono wiadomości" }` | no such message |
| 500 | `{ "error": "Błąd podczas zapisywania reakcji" }` | via `handleDbError` |
| 503 | `{ "error": "Niedostępne w trybie demo" }` | `DEMO_MODE`, mirroring the other chat POSTs |

Toggle is idempotent: `DELETE ... WHERE message_id=? AND user_id=? AND emoji=?` first; if `affectedRows === 0` then `INSERT IGNORE` (duplicate-key from a racing double tap is swallowed and the response still reflects the real aggregate). Deliberately **no** `GET` sibling - reactions are read through the thread payload only (D3).

---

## 4. Implementation plan

- [ ] 1. **Add the reactions table to the lazy chat-schema ensure-function, plus the server-side allowlist.**
      In `server.js`, inside `ensureAnonMessageTables()` (anchor: `CREATE TABLE IF NOT EXISTS anon_messages`), append a third `await pool.execute(...)` **before** `anonTablesEnsured = true;`, and add the allowlist constant just above the function (next to the section header comment):
      ```js
      // Fixed, server-validated reaction set. Order here is the order the
      // UI renders chips in. Nothing outside this list can ever be stored.
      const CHAT_REACTION_EMOJI = ['❤️', '😂', '👍', '🎁', '😮', '🙏'];
      ```
      ```sql
      CREATE TABLE IF NOT EXISTS anon_message_reactions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          message_id INT NOT NULL,
          user_id INT NOT NULL,
          -- utf8mb4_bin: the *_ci collations compare many emoji as equal,
          -- which would break both the unique key and GROUP BY emoji
          emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_message_user_emoji (message_id, user_id, emoji),
          INDEX idx_reaction_message (message_id),
          FOREIGN KEY (message_id) REFERENCES anon_messages(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
      ```
      Add a comment noting the DDL is mirrored in `init-db.js` (D9). No other table, index or `ALTER` is needed - `CREATE TABLE IF NOT EXISTS` is the idempotent pattern already used here, by `ensureNotificationsTable()` (~3016), `ensureArchiveTable()` (~3528) and the `push_subscriptions` block (~2045); the `ALTER`-style migration used by `ensureCreatedByNullable()` (~3187) is not needed because this is a brand-new table. Keep the existing `if (DEMO_MODE || anonTablesEnsured) return;` guard as the only gate.
      Files: `server.js`
      Verify: `node --check server.js` exits 0. Then `$env:OFFLINE_MODE='true'; node server.js` starts clean on port 3002 with no new warnings (DEMO_MODE short-circuits the DDL, so this only proves the file parses and boots); stop the server afterwards.

- [ ] 2. **Return the thread's reaction aggregate from `GET /api/wiadomosci/threads/:id`.**
      After the existing `const [msgs] = await pool.execute('SELECT id, sender_id, body, created_at FROM anon_messages WHERE thread_id = ? ORDER BY id ASC', ...)` and the participation check, add **one** query (no N+1):
      ```js
      const [reactionRows] = await pool.execute(`
          SELECT r.message_id, r.emoji, COUNT(*) AS cnt, MAX(r.user_id = ?) AS mine
          FROM anon_message_reactions r
          JOIN anon_messages m ON m.id = r.message_id
          WHERE m.thread_id = ?
          GROUP BY r.message_id, r.emoji
      `, [userId, thread.id]);
      ```
      Build a `Map<messageId, Array>` in JS, sort each array by `CHAT_REACTION_EMOJI.indexOf(emoji)` (and drop anything not on the list, so a legacy row can never render), and emit `reactions: byMessage.get(m.id) || []` in the existing `messages.map(...)`. `count: Number(cnt)`, `mine: Number(mine) === 1`. **Do not** add `sender_id` or `user_id` to the response, and leave the `UPDATE anon_messages SET is_read = 1 ...` line and the `otherLabel` logic untouched.
      Files: `server.js`
      Verify: `node --check server.js` exits 0; `$env:OFFLINE_MODE='true'; node server.js` boots and `curl -i http://localhost:3002/api/wiadomosci/threads/1` returns `401` (unauthenticated) rather than a 500 - i.e. the route still wires up through `requireAuth`.

- [ ] 3. **Add the toggle endpoint `POST /api/wiadomosci/messages/:messageId/reactions`.**
      Place it in the chat section, immediately after `POST /api/wiadomosci/threads/:id/messages` and before the `---- Link previews ----` comment. Shape it exactly like its neighbours: `requireAuth`, `if (DEMO_MODE) return res.status(503)...`, `await ensureAnonMessageTables()`, `pool.execute` with `?` placeholders only, errors through `badRequest`/`notFound`/`forbidden`/`handleDbError`.
      Steps inside the handler: coerce `const messageId = Number.parseInt(req.params.messageId, 10)` and reject `!Number.isInteger(messageId) || messageId <= 0`; validate `emoji` against `CHAT_REACTION_EMOJI` with `includes` (reject off-list with 400); resolve message + thread in one query (`SELECT m.id, t.initiator_id, t.target_id FROM anon_messages m JOIN anon_threads t ON t.id = m.thread_id WHERE m.id = ?`), 404 if empty, 403 unless the session user is one of the two participants; `DELETE` then conditional `INSERT IGNORE` for the toggle; re-read the aggregate for that message only (`SELECT emoji, COUNT(*) AS cnt, MAX(user_id = ?) AS mine ... WHERE message_id = ? GROUP BY emoji`), sort by allowlist order, and respond per the table in §3. One `console.log` with `messageId` + action only - no user id, no emoji→user pair.
      Nothing in this handler may reference notifications, push, the activity feed or `is_read`.
      Files: `server.js`
      Verify: `node --check server.js` exits 0; with `$env:OFFLINE_MODE='true'; node server.js` running, `curl -i -X POST http://localhost:3002/api/wiadomosci/messages/1/reactions -H "Content-Type: application/json" -d "{\"emoji\":\"❤️\"}"` returns `401` (auth gate ahead of everything else) and the server log shows no stack trace. Stop the server.

- [ ] 4. **Mirror the chat schema into `init-db.js` so fresh installs are complete.**
      After the `sessions` block and before the index list, add an idempotent chat block creating `anon_threads`, `anon_messages` and `anon_message_reactions` with definitions identical to `ensureAnonMessageTables()` (D9), each followed by the file's existing `console.log("✓ ... table created")` style, and add the three names to the closing "Tables created:" summary. Head the block with a comment pointing at `ensureAnonMessageTables()` in `server.js` as the runtime source of truth that must stay in sync. Use `connection.execute` (the file's existing call style) and keep `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` on the table like the other `init-db.js` tables, with the per-column `COLLATE utf8mb4_bin` on `emoji`.
      Files: `init-db.js`
      Verify: `node --check init-db.js` exits 0. (`npm run init-db` is not runnable here - it needs the production `DB_PASSWORD`; do **not** attempt it.)

- [ ] 5. **Create `public/chat-reactions.css`.**
      New file, no edits to `app-theme.css` or any other shared stylesheet. Contents:
      - `.chat-msg-row { display:flex; flex-direction:column; max-width:82%; min-width:0; }`, `.chat-msg-row.from-me { align-self:flex-end; align-items:flex-end; }`, `.chat-msg-row.from-them { align-self:flex-start; align-items:flex-start; }`, and `.chat-msg-row > .chat-bubble { max-width:100%; }` so the existing 82 % bubble width and left/right alignment are preserved exactly.
      - `.chat-reactions { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; align-items:center; }`.
      - `.chat-reaction-chip`: real-button reset, white `#fff` background, `1px solid rgba(0,0,0,0.10)`, `border-radius:14px`, `padding:4px 10px`, `min-height:32px`, `font-size:13px`, `color:#2d3748`, soft shadow `0 1px 3px rgba(0,0,0,0.12)`; count in a `.chat-reaction-count` span with `font-weight:600`. `.chat-reaction-chip[aria-pressed="true"]` (current user): orange accent - `background:#FFF3E0`, `border-color:#F57C00`, `color:#E65100`. `:focus-visible { outline:2px solid #1E88E5; outline-offset:2px; }`.
      - `.chat-reaction-add`: 32x32 visual circle with `padding` so the hit area is ≥ 44x44 px (`min-width:44px; min-height:44px; display:inline-flex; align-items:center; justify-content:center; background:transparent; border:none; color:#6b7280;`), `:hover`/`:focus-visible` states.
      - Bottom sheet: `#reactionSheetOverlay` (fixed, `rgba(0,0,0,0.5)`, `z-index:10000`, `opacity`/`visibility` transition) and `#reactionSheet` (fixed bottom, full width, `border-radius:20px 20px 0 0`, `box-shadow:0 -8px 32px rgba(0,0,0,0.3)`, `max-height:90vh` then `max-height:90dvh`, `display:flex; flex-direction:column; overflow:hidden`, `transform:translateY(100%)` → `translateY(0)` on `.is-open`, `z-index:10001`, `padding-bottom:calc(16px + env(safe-area-inset-bottom, 0px))`). `z-index` sits above the `9999` notifications panel / toasts used by `bottom-tab-bar.css`.
      - Grab handle via `#reactionSheet::before` (40x4, `rgba(0,0,0,0.18)`, centered, `top:8px`) matching the `#editPresentModal` handle in `app-theme.css`.
      - `.reaction-sheet-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; overflow-y:auto; -webkit-overflow-scrolling:touch; }` with `.reaction-sheet-btn { min-height:56px; font-size:26px; border-radius:14px; background:#f8f9fa; border:1px solid rgba(0,0,0,0.08); }` and an `[aria-pressed="true"]` orange state.
      - `@media (min-width: 769px)`: re-position `#reactionSheet` as a centered `max-width:320px` card with full `border-radius:20px`, `transform` swapped for a scale/none transition.
      - `@media (prefers-reduced-motion: reduce)`: `transform:none; transition:none` for sheet + overlay.
      Files: `public/chat-reactions.css`
      Verify: visual check happens in item 9; for now confirm the file is valid CSS by loading the chat page in the harness built in item 9 and seeing no console/parse errors.

- [ ] 6. **Create `public/chat-reactions.js` - all reaction behaviour, exposed as `window.ChatReactions`.**
      Self-contained IIFE, no new dependencies, uses the page's existing `escapeHtml`, `showToast` and the global `plCount` from `pluralize-pl.js`. Public surface consumed by `wiadomosci.html`:
      - `ChatReactions.EMOJI` - the same 6-entry allowlist with Polish names (`serce`, `śmiech`, `łapka w górę`, `prezent`, `zdziwienie`, `podziękowanie`); it mirrors `CHAT_REACTION_EMOJI` in `server.js` and the server remains the authority (off-list values are rejected with 400).
      - `ChatReactions.ingest(messages)` - store the server aggregate per message id, **skipping** any message with an in-flight optimistic toggle, and return a fingerprint string (`id:emoji:count:mine|...`) the caller folds into its change detection.
      - `ChatReactions.strip(message)` → the chip-strip HTML for a message: zero or more `<button type="button" class="chat-reaction-chip" data-message-id data-emoji aria-pressed="true|false" aria-label="Reakcja serce, 2 osoby">❤️ <span class="chat-reaction-count">2</span></button>` (count always rendered, D8; label pluralised with `plCount(n, 'osoba', 'osoby', 'osób')`), plus the trailing `<button class="chat-reaction-add" aria-label="Dodaj reakcję do wiadomości" data-message-id>` carrying `<i class="ri-emotion-line" aria-hidden="true"></i>`. Emoji come from the allowlist and counts are numbers, but every interpolated value still goes through `escapeHtml` before it reaches `innerHTML`.
      - `ChatReactions.refreshStrips()` - re-render only the existing `.chat-reactions` containers in place (`querySelectorAll('[data-reactions-for]')`), used when a poll brings reaction-only changes so **the chat never scroll-jumps** for a reaction.
      - `ChatReactions.reset()` - clear state when switching/closing a thread.
      Internals:
      - Delegated `click` listener on `#chatMessages` (attached once) handling `.chat-reaction-chip` → `toggle(messageId, emoji)` and `.chat-reaction-add` → `openSheet(messageId)`. No long-press handler (D7).
      - `toggle()`: an in-flight `Set` keyed `messageId + '|' + emoji` debounces rapid taps (a tap while in flight is ignored); applies the optimistic count/`mine` change and `refreshStrips()` immediately; `fetch('/api/wiadomosci/messages/' + messageId + '/reactions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ emoji }) })`; on success replace local state with the authoritative `reactions` from the response; on HTTP error or network failure restore the snapshot, `refreshStrips()`, and `showToast('Nie udało się zapisać reakcji', 'error')` (the page's existing non-intrusive toast); always clear the in-flight key in `finally`.
      - Bottom sheet: `openSheet(messageId)` fills the grid from `EMOJI` with each button's `aria-pressed` reflecting current state, remembers `document.activeElement`, adds `.is-open` to overlay+sheet, moves focus to the first grid button, traps `Tab`/`Shift+Tab` inside the sheet, closes on `Escape`, on overlay click, on close-button click and after a pick (pick → `toggle()` → close), and returns focus to the remembered element. Sheet element carries `role="dialog" aria-modal="true" aria-labelledby="reactionSheetTitle"` and is `inert`/`aria-hidden` while closed.
      Files: `public/chat-reactions.js`
      Verify: `node --check public/chat-reactions.js` exits 0.

- [ ] 7. **Wire the chat page up: wrapper markup, hooks, sheet, asset links.**
      Targeted edits in `public/wiadomosci.html` only (depends on items 5 and 6):
      - `<head>`: add `<link href="chat-reactions.css?v=1" rel="stylesheet">` after the existing `app-theme.css?v=13` line.
      - Before `</body>` (after `desktop-nav.js`): add `<script src="chat-reactions.js?v=1"></script>`. It must load after `pluralize-pl.js`, which it already does.
      - In `loadThreadMessages()`, change the signature to also cover reactions: keep the existing `sig` for the message list, and compute `const rsig = ChatReactions.ingest(msgs)`. If `sig === lastChatSignature`: when `rsig !== lastReactionSignature`, store it and call `ChatReactions.refreshStrips()`, then return (no innerHTML rewrite, no scroll change). Otherwise return as today. This preserves the current "nothing new → keep the DOM and scroll position" behaviour exactly.
      - Change the full-render template to the wrapper from D5, leaving the bubble's inner markup (`renderMessageBody`, the `lp-<id>` slot, `.chat-time`) byte-identical:
        ```html
        <div class="chat-msg-row ${m.fromMe ? 'from-me' : 'from-them'}">
            <div class="chat-bubble ${m.fromMe ? 'from-me' : 'from-them'}"> ...unchanged... </div>
            <div class="chat-reactions" data-reactions-for="${m.id}">${ChatReactions.strip(m)}</div>
        </div>
        ```
        Keep `box.scrollTop = box.scrollHeight` after the rewrite and keep the link-preview loop as is.
      - `openThread()` / `openNewChat()` / `showListView()`: add `ChatReactions.reset();` next to the existing `lastChatSignature = null;` lines and reset `lastReactionSignature` too.
      - Add the sheet markup right before the toast container: `#reactionSheetOverlay` and `#reactionSheet` (grab handle, `<h5 id="reactionSheetTitle">Wybierz reakcję</h5>` in Polish sentence case, a close `<button>` with `aria-label="Zamknij"`, and an empty `.reaction-sheet-grid` the JS fills).
      - Guard for safety: if `window.ChatReactions` is missing (e.g. the new file fails to load from a stale cache), fall back to an empty strip so the chat keeps working.
      Nothing else in the file changes - compose box, thread list, delete flow, tab bar, notifications panel and the `updateMessagesBadge()` calls stay exactly as they are.
      Files: `public/wiadomosci.html`
      Verify: `$env:OFFLINE_MODE='true'; node server.js`, open `http://localhost:3002/wiadomosci` and confirm the page loads with an empty console (DEMO_MODE shows no threads, so this is a load/parse check); plus the harness screenshots in item 9.

- [ ] 8. **Note the new assets and cache-busters for the orchestrator (no `sw.js` edit).**
      Record in the verification doc (item 9) that this change adds two new static assets - `public/chat-reactions.css` and `public/chat-reactions.js`, both referenced with `?v=1` - and that `public/sw.js` must have `CACHE_NAME` bumped from `prezenty-v118` to the next version by the orchestrator so returning PWA clients pick up the modified `wiadomosci.html`. Optionally suggest adding the two files to `urlsToCache`; they work uncached either way. Do **not** edit `public/sw.js`.
      Files: `.agents/tasks/chat-reactions-verification.md` (created in item 9)
      Verify: `git status --short` shows no modification to `public/sw.js`.

- [ ] 9. **Verification pass + write `.agents/tasks/chat-reactions-verification.md`.**
      Run, and record the real output of:
      - `node --check server.js`, `node --check init-db.js`, `node --check public/chat-reactions.js` - all exit 0.
      - Offline smoke on port 3002 (`$env:OFFLINE_MODE='true'; node server.js`): unauthenticated `GET /api/wiadomosci/threads/1` → 401, unauthenticated `POST /api/wiadomosci/messages/1/reactions` → 401, `/wiadomosci` → 200 with a clean console. Stop the server afterwards.
      - Static harness screenshots following the approach documented in `.agents/tasks/verification.md`: build the harness in `%TEMP%\prezenty-reactions-harness` (outside the repo, deleted afterwards), copy the real `<head>` of `wiadomosci.html` with `file:///` stylesheet links including `chat-reactions.css`, inject hand-written markup matching the post-change bubble template (an own-side bubble with 2 chips, an other-side bubble with 1 chip and the add button, one bubble with no reactions, and one long message to check wrapping), and drive the local Edge with `playwright-core` at true viewports 320 / 375 / 768 / 1024. Capture: chip strips in both bubble directions, the open bottom sheet at 320 and 375, the desktop popover at 1024, a `:focus-visible` state, and a bottom-of-page shot proving clearance above the composer and the ~70 px fixed tab bar. Save as `.agents/tasks/screenshots/chat-reactions-*.png`.
      - Manual a11y checks in the harness: Tab reaches every chip and the add button, `aria-pressed` flips, `Escape` closes the sheet and focus returns to the add button, `prefers-reduced-motion` (Edge emulation) removes the slide animation, and chip/own-chip text contrast is ≥ 4.5:1 on the measured backgrounds.
      - Privacy/no-notification diff review: `git -P diff` on `server.js` and confirm the new/changed regions contain no `notifications`, `sendPushToUser`, `notifyAnonMessage`, `webpush`, `is_read` or `notification-text` reference, and that no response object includes `user_id`, `sender_id` or `username`.
      - `git status --short` to confirm the change set is exactly `server.js`, `init-db.js`, `public/wiadomosci.html`, `public/chat-reactions.css`, `public/chat-reactions.js` plus the `.agents/tasks/` docs - and that `public/formularz.*`, `public/notification-text.js`, `public/sw.js`, `public/app-theme.css` and `public/tab-bar-functions.js` carry no edits from this task.
      Files: `.agents/tasks/chat-reactions-verification.md`, `.agents/tasks/screenshots/chat-reactions-*.png`
      Verify: the doc lists each command with its actual result and every screenshot exists on disk.

---

## 5. Known gaps / assumptions

- **No DB available in this environment.** `DEMO_MODE` is forced without `DB_PASSWORD`, so the DDL, the aggregate query and the toggle cannot be exercised against MySQL here. The SQL is therefore written to the patterns already proven in this file (`pool.execute` + placeholders, `CREATE TABLE IF NOT EXISTS`) and the collation trap is handled up front (D2). Assumption: MySQL 5.7+/8.x, consistent with the existing `utf8mb4` + `express-mysql-session` setup.
- **`MAX(col = ?)`** returns `1`/`0` in MySQL and is an aggregate, so it is `ONLY_FULL_GROUP_BY`-safe. Coerced with `Number(...) === 1` on the server rather than trusted as a JS boolean.
- **Reaction counts are not shown in the thread list** (`GET /api/wiadomosci/threads`), on purpose: it would add a second aggregate to the 60 s list poll for no user value.
- **Deletion cascades**: `ON DELETE CASCADE` on both FKs means deleting a thread (which already cascades to `anon_messages`) or a user removes their reactions automatically - no extra cleanup code, and `DELETE FROM anon_threads` in the account-deletion path (~line 836) keeps working unchanged.
- `?v=1` on the two new assets is a starting value; the orchestrator owns the `sw.js` cache bump.
