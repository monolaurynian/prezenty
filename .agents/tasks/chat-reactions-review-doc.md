# Emoji reactions on anonymous chat messages

Six fixed emoji can be toggled on any message in the anonymous chat. The reaction aggregate rides along in the existing `GET /api/wiadomosci/threads/:id` payload, so the chat's 8-second poll delivers the other side's reactions with no new polling loop, and a new `POST /api/wiadomosci/messages/:messageId/reactions` toggles one reaction and answers with the recomputed aggregate for that message. The server only ever emits `{ emoji, count, mine }` — the reactor's `user_id` is stored for the toggle and the unique key and never leaves the process. The UI is chips in a per-message wrapper outside the bubble (the `from-me` bubble forces `color:#fff !important` on everything inside it) plus a hand-rolled bottom sheet picker, both in two new assets rather than edits to shared stylesheets.

Watch for: a keyboard/screen-reader user loses focus on **every** reaction repaint — `refreshStrips()` replaces the strip's `innerHTML`, so the focused chip is destroyed, focus falls to `<body>`, and the `aria-pressed` state change the toggle exists to communicate is never announced (confirmed). This also fires on poll-driven repaints, so focus can be stolen while the user is merely sitting on a chip. Everything else on the review checklist holds: privacy, no notification path, auth and participation, parameterised SQL, server-side allowlist, unique-key toggle, one query per thread, and the `init-db.js` mirror.

**Verdict**: NEEDS_CHANGES

## High-level view

`user_id` exists in `anon_message_reactions` only. Both read paths funnel through `buildReactionList()`, which builds each entry from the literal keys `emoji`, `count`, `mine` and drops anything off the emoji allowlist, so no reactor identity, per-user list or `sender_id` can reach a client. Participation is re-derived from the message itself (`anon_messages` → `anon_threads`), so reacting cannot be used to probe who wrote a message, and the thread aggregate is scoped by `thread_id` after the existing 403 check.

The no-notification requirement is met by omission: the new handler references no `notifications` table, no push, no activity feed, no `is_read`, and the shared logic module imports nothing. `notification-text.js` is untouched by this task.

Every statement is `pool.execute` with `?` placeholders, the message id passes a `^[0-9]+$` regex before `parseInt` so `'7abc'` or `'1 OR 1=1'` return `null` and produce a 400, and the emoji is validated against a six-entry allowlist server-side. The toggle is DELETE-then-`INSERT IGNORE` behind `UNIQUE (message_id, user_id, emoji)`, with `emoji` declared `COLLATE utf8mb4_bin` — without that the `*_ci` collations would compare distinct emoji as equal and collapse both the unique key and `GROUP BY emoji`. A whole thread's reactions come back in one grouped query with `INDEX idx_reaction_message (message_id)` behind it.

The accessibility work is thorough up to one gap: real `<button type="button">` everywhere, `aria-pressed` reflecting state, gender-neutral Polish labels built with `plCount`, a `role="dialog"` sheet with `aria-modal`, a Tab trap, Escape close and focus return to the add button, `prefers-reduced-motion` honoured at both breakpoints, and every interpolated value escaped before it reaches `innerHTML`. What is missing is focus management for the chips themselves — the strip is re-rendered wholesale on every optimistic toggle, every server response and every reaction-only poll, and nothing restores focus afterwards.

Two colour observations stay non-blocking. The pressed state differs from the unpressed state only in fill and border colour, which leans on WCAG 1.4.1 (`aria-pressed` covers assistive tech). The unpressed chip's `rgba(0,0,0,0.10)` border is ~1.25:1 against its white fill; the implementer disclosed this and it matches the treatment already used by `.chat-bubble.from-them` and `.thread-row`.

On file scope: the forbidden files do show as modified in `git diff --stat`, but grepping their diffs for `reaction|reakcj|chat-reactions` returns nothing — they are concurrent agents' work, as the verification states. The `server.js` diff likewise carries two unrelated `notificationText('present_added', …)` hunks and the `notification-text` require from the notification task.

<details>
<summary>Issues (6)</summary>

1. **Focus and state announcement lost on every chip repaint** (blocking, confirmed) — `refreshStrips()` in `public/chat-reactions.js` rebuilds `container.innerHTML` for every `[data-reactions-for]` strip, destroying the focused chip; focus drops to `<body>` and the `aria-pressed` flip is never announced. Capture the active chip's message id + emoji before the repaint and re-focus the equivalent chip (or the add button when the chip disappears), or mutate the existing chips' `textContent`/`aria-*` in place instead of replacing them.
2. **Pressed state signalled by colour alone** (non-blocking, confirmed) — `.chat-reaction-chip[aria-pressed="true"]` differs from the default only in `background`, `border-color` and `color`. Consider a non-colour cue (border width, a subtle ring, or a leading check glyph) for WCAG 1.4.1.
3. **Unpressed chip border contrast ~1.25:1** (non-blocking, disclosed) — `rgba(0,0,0,0.10)` on `#ffffff`. Matches existing page conventions; left as-is deliberately, but it will not pass a strict 1.4.11 audit.
4. **No server-side throttle on the toggle endpoint** (non-blocking, confirmed) — debouncing is client-side only. The unique key caps storage at six rows per user per message, so the blast radius is small, but a participant can still spin the endpoint. Acceptable given no rate-limiting infrastructure exists in `server.js`.
5. **Chat density: a 44px add button under every message** (non-blocking, confirmed) — the strip renders unconditionally inside the `max-height: 58vh` scroller, so visible message count drops noticeably on phones. Consider revealing the add button on hover/focus on desktop, or shrinking the strip when a message has no reactions.
6. **DDL and aggregation never executed against MySQL** (non-blocking, disclosed) — no database was available, so the `CREATE TABLE`, the real `GROUP BY` and the `DELETE`/`INSERT IGNORE` are proven only as SQL text with bound parameters. Worth one run of `npm run init-db` plus a two-account smoke test before release.

</details>

<details>
<summary>Details</summary>

### Privacy: the aggregate is the only shape that exists

`buildReactionList(rows)` constructs each entry by literal key — `{ emoji, count: Math.round(count), mine: Number(row.mine) === 1 }` — so a row carrying extra columns cannot leak them, and it drops off-allowlist emoji and sub-1 counts so a legacy or hand-inserted row can never render. `groupReactionsByMessage()` fans the flat thread rows out by `parseMessageId(row.message_id)` into numeric keys, matching the `reactionsByMessage.get(Number(m.id))` lookup in the response map. The toggle response adds only `{ success, action, messageId, emoji }` around that list, where `emoji` is the value the caller just sent and `action` comes from `DELETE`'s `affectedRows`.

The residual inference is the one the plan names explicitly: in a two-person thread, `count - (mine ? 1 : 0) > 0` means the other side reacted. That is the same pseudonymous fact receiving a message already conveys, and the target still only ever sees `Święty Mikołaj 🎅`.

### Auth and participation

```
POST /api/wiadomosci/messages/:messageId/reactions
  requireAuth ──► 401 Wymagana autoryzacja
  DEMO_MODE   ──► 503 Niedostępne w trybie demo
  parseMessageId ──► 400 Nieprawidłowa wiadomość
  allowlist      ──► 400 Nieprawidłowa reakcja
  SELECT m.id, t.initiator_id, t.target_id
    FROM anon_messages m JOIN anon_threads t ON t.id = m.thread_id
    WHERE m.id = ?        ──► 404 Nie znaleziono wiadomości
  userId ∈ {initiator_id, target_id} ──► else 403 To nie Twoja rozmowa
```

Id and emoji validation run before any query. On the thread GET, the pre-existing 404/403 ladder sits at lines 2741-2746 and the reaction query is added at 2761, after it.

### Focus handling is the one real gap

`refreshStrips()` is called from three places: synchronously after the optimistic update, again once the server answers, and from `loadThreadMessages()` when a poll brings a reaction-only change. Each call does:

```js
document.querySelectorAll('[data-reactions-for]').forEach(container => {
    const id = parseMessageId(container.getAttribute('data-reactions-for'));
    if (id === null) return;
    container.innerHTML = strip({ id: id });
});
```

Every strip in the thread is replaced, not just the one that changed. A chip that had focus is detached, so focus resets to `<body>` and the next Tab restarts from the top of the page — past the thread list, the header and the composer. For a screen-reader user the state flip is also silent: the button carrying the new `aria-pressed` value is a different element than the one that was activated, so a control whose entire purpose is to be a toggle never announces its new state.

`closeSheet()` already re-looks the add button up by message id precisely because the strip may have been re-rendered underneath it. The same lookup applied to the active chip after a repaint closes this gap.

### The collation trap and the migration path

The `emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` declaration is the non-obvious part and it is right: under `utf8mb4_general_ci`/`_unicode_ci` many 4-byte emoji compare equal, which would let the unique key hold only one reaction per user per message and collapse all six buckets in `GROUP BY emoji`. The same per-column collation appears in both the lazy ensure-function and the `init-db.js` mirror, with cross-reference comments in both directions.

Because `anonTablesEnsured` is a per-process latch, an existing deployment creates the new table on its next restart — no `ALTER` migration is needed and no install that already ran the ensure-function is left without the table.

### Rendering safety and graceful degradation

Interpolated values in `chipHtml`, `addButtonHtml` and `paintSheet` go through `esc()`, which prefers the page's own `textContent`-based `escapeHtml` and falls back to a local equivalent; `normalizeIncoming()` re-validates the server's own response through `buildReactionList` before it is trusted for render. The inline-script guard `const reactionsApi = window.ChatReactions || { ingest: () => '', strip: () => '', refreshStrips: () => {}, reset: () => {} }` means a stale cache that fails to serve `chat-reactions.js` degrades to a chat without reaction UI instead of throwing on every poll.

### Polish wording

Strings are gender-neutral and in sentence case: `Wybierz reakcję`, `Zamknij`, `Dodaj reakcję do wiadomości`, `Reakcja serce: 2 osoby. Usuń swoją reakcję`, `Nie udało się zapisać reakcji`. Plurals go through `plCount(count, 'osoba', 'osoby', 'osób')`, giving `1 osoba` / `2 osoby` / `5 osób` / `22 osoby`. The emoji names (`serce`, `śmiech`, `łapka w górę`, `prezent`, `zdziwienie`, `podziękowanie`) carry no gendered agreement, and no `dodał(a)`-style construction appears in the new code.

### Scope and bundled changes

`git diff --stat` shows `public/formularz.html`, `public/formularz.js`, `public/notification-text.js`, `public/sw.js` and `public/app-theme.css` as modified, which on a literal reading of the constraint looks like a violation. Grepping those five diffs for `reaction|reakcj|chat-reactions` returns no matches, so none of it belongs to this task — it is the concurrent work the verification document calls out. The `server.js` diff similarly contains the `notification-text` require and two `notificationText('present_added', …)` hunks from the notification task, tracked by its own review files.

The reaction-specific `server.js` footprint is four targeted additions (DDL block, shared-module require, thread aggregate, toggle endpoint) with no rewrite of surrounding code; `public/wiadomosci.html` is 63 changed lines and the bubble's inner markup is byte-identical. Reaction CSS lives entirely in the new `public/chat-reactions.css`.

One correction to the verification's hand-off note: `sw.js` does not strictly need another cache bump for this change. Its fetch handler is network-first for `.html` and navigations, and the two new assets are not in `urlsToCache`, so they are fetched from the network on first request and cached from there.

</details>

<details>
<summary>File map</summary>

- `server.js` — reactions DDL inside `ensureAnonMessageTables()`, shared-logic require, one grouped aggregate query in the thread GET, new toggle endpoint. (Also carries unrelated `notificationText` hunks from a concurrent task.)
- `init-db.js` — `anon_threads` / `anon_messages` / `anon_message_reactions` mirrored for fresh installs, purely additive.
- `public/chat-reactions.js` — **new**; allowlist, id parsing, aggregate shaping and toggle-action logic shared with `server.js`, plus the browser chips, optimistic toggle and sheet picker.
- `public/chat-reactions.css` — **new**; message wrapper, chips, 44px add button, bottom sheet / desktop card, reduced-motion handling.
- `public/wiadomosci.html` — asset links, per-message wrapper around the untouched bubble, reaction signature in the poll, sheet markup, `reset()` calls on view switches.

Full diff: `git -P diff server.js init-db.js public/wiadomosci.html` plus the two untracked files under `public/`.

</details>
