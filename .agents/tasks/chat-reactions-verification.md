# Verification - emoji reactions in the anonymous chat

Second pass. `.agents/tasks/chat-reactions-review.json` existed, so this pass is about the
six review findings (plus the parent session's note confirming findings 2 and 5 are in
scope). The first-pass evidence is kept at the bottom under "Carried over from pass 1".

## Review findings - what was done

| # | Finding | Status | Where |
| --- | --- | --- | --- |
| 1 | **blocking** - focus and `aria-pressed` announcement lost on every chip repaint | **fixed** | `public/chat-reactions.js` |
| 2 | Pressed state signalled by colour alone | **fixed** | `public/chat-reactions.css` |
| 3 | Unpressed chip border contrast ~1.25:1 | **fixed** | `public/chat-reactions.css` |
| 4 | No server-side throttle on the toggle endpoint | **fixed** | `server.js` + `public/chat-reactions.js` |
| 5 | A 44px add button under every message costs chat density | **fixed** | `public/chat-reactions.css` |
| 6 | DDL / aggregation never executed against MySQL | **still open, cannot be closed here** | see "Not exercised live" |

### 1 - Repaints no longer destroy focus (blocking)

`refreshStrips()` used to do `container.innerHTML = strip({id})` for **every** strip in the
thread, which detached the focused chip: focus fell to `<body>` and the `aria-pressed` flip
was never announced, because the button carrying the new value was a different element.

The strip is now **reconciled in place** (`syncStrip()`):

- chips that stay are **mutated**, not replaced - `applyChip()` updates `aria-pressed`,
  `aria-label` and the count's `textContent` on the live element, so the toggle announces
  its new state on the very control that was activated;
- existing chips are **never moved** (re-inserting a node drops its focus); a new chip is
  inserted before the first chip that sorts after it (`nextChipAfter()`), which keeps
  allowlist order because the list is always sorted;
- the **add button is created once** and kept for the lifetime of the strip, so focus on it
  survives any number of repaints;
- the only chip that can vanish under the user is the one they just un-reacted from
  (count hit zero). There is no equivalent chip to return to, so `refreshStrips()` moves
  focus to the **add button of the same message**.

The same bug existed in the picker (`paintSheet()` rebuilt the grid's `innerHTML`, and
`refreshStrips()` calls it while the sheet is open). The six buttons are now built once and
afterwards only their `aria-pressed` is updated.

Driven in the harness at 375x812 (real `chat-reactions.js`, `window.fetch` stubbed):

```
focusKeptOnToggle
  before          same=true  pressed=true   count=2  "Reakcja serce: 2 osoby. Usuń swoją reakcję"
  afterOptimistic same=true  pressed=false
  afterServer     stillInDom=true  same=true  activeTag=BUTTON  pressed=false  count=1
                  "Reakcja serce: 1 osoba. Dodaj swoją reakcję"
focusKeptOnPoll            same=true  count 1 -> 9  label re-pluralised to "9 osób"
focusKeptOnNewChip         same=true  order=[❤️,😂,👍,🎁]  addButtonIsLast=true
focusFallbackOnChipRemoval chipGone=true  activeIsAddButton=true  activeMsg=104
                           activeLabel="Dodaj reakcję do wiadomości"  notBody=true
sheetFocusKeptOnRepaint    same=true  activeTag=BUTTON
rollbackOnError            before=3/true -> restored=3/true
                           toast={msg:"Zbyt wiele reakcji. Odczekaj chwilę", kind:"error"}
```

`focusKeptOnToggle.afterOptimistic.same=true` is the important one: focus is already intact
**before** the server answers, i.e. the optimistic repaint no longer disturbs it.

### 2 - Pressed state no longer colour-only

`.chat-reaction-chip[aria-pressed="true"]` now adds a **2px border** (vs 1px) plus a
**1px white inner ring** (`box-shadow: inset 0 0 0 1px #fff`) on top of the purple fill.
Padding drops from `4px 10px` to `3px 9px` so the extra border width is absorbed and
**nothing reflows on toggle** - measured `pressedSize 53x32` vs `plainSize 53x32`.
`.reaction-sheet-btn[aria-pressed="true"]` gets the same treatment.

Greyscale evidence: `chat-reactions-375-greyscale.png` (page rendered with
`filter: grayscale(1)`). The three own reactions (❤️2, 😂5, 🎁3) read as the heavier-bordered
chips with a visible inner ring; the others keep a hairline border. Measured in greyscale:

```
pressedBorderWidth 2px   plainBorderWidth 1px
pressedRing  rgb(255,255,255) 0 0 0 1px inset, rgba(0,0,0,0.12) 0 1px 3px
plainRing    rgba(0,0,0,0.12) 0 1px 3px
```

So the pressed state is distinguishable in greyscale, independent of hue.

### 3 - Unpressed chip border contrast

Raised from `rgba(0,0,0,0.10)` (~1.25:1, computed) to **`#868F99`**:

| Pair | Ratio |
| --- | --- |
| `#868F99` on `#ffffff` (chip fill) | **3.28** |
| `#868F99` on `#f8f9fa` (sheet button fill) | **3.11** |
| old `rgba(0,0,0,0.1)` ≈ `#e6e6e6` on `#ffffff` | 1.25 |

Both clear the WCAG 1.4.11 3:1 non-text floor. This is a deliberate, small departure from
the page's existing `rgba(0,0,0,0.08)` hairline convention (`.chat-bubble.from-them`,
`.thread-row`): the chip is an interactive control whose boundary is its only outline,
whereas those are static containers. Checked in `chat-reactions-375.png` / `-1024.png` -
at 1px it still reads as a quiet outline, not a heavy frame.

### 4 - Server-side throttle on the toggle endpoint

`server.js` now carries a tiny in-memory fixed-window counter, **no new dependency**:
`REACTION_RATE_MAX = 30` toggles per `REACTION_RATE_WINDOW_MS = 10 s` per user id, checked
*after* the cheap validation (so malformed requests do not consume budget) and *before* any
query. Over the limit: `429 { error: 'Zbyt wiele reakcji. Odczekaj chwilę' }`. The bucket
map is pruned opportunistically above 500 entries, so it cannot grow without bound.

The window arithmetic lives in `reactionThrottleStep(bucket, now, maxHits, windowMs)` in
`public/chat-reactions.js` - pure, caller owns the store, unit-tested in isolation.

Client side: a non-2xx response now surfaces the server's own `error` string in the toast
(falling back to `Nie udało się zapisać reakcji`), and the optimistic state rolls back -
see `rollbackOnError` above.

### 5 - Add-reaction affordance, chat density

Two changes, both keeping the control a real `<button>` in the tab order:

1. **Inline and compact with a hit slop.** The button now draws as a **32x32** circle at
   the end of the existing chip strip but keeps a **44x44 touch target** through an
   invisible `::after` (`position:absolute; width:44px; height:44px; transform:translate(-50%,-50%)`).
   Measured: `visual 32x32`, `hitSlop 44px x 44px`. The strip row is **32px** tall instead
   of 44 - about a quarter of the old per-message cost removed inside the `max-height: 58vh`
   scroller, with the thumb target unchanged.
2. **Quiet on pointer devices.** Under `@media (hover: hover) and (pointer: fine)` the
   button sits at `opacity: 0` and is revealed by `.chat-msg-row:hover`,
   `.chat-msg-row:focus-within`, `:focus` and `:focus-visible`. Opacity (not
   `display`/`visibility`) is deliberate: the button stays in the tab order, in the
   accessibility tree and announced at all times. **Touch is untouched** - the media query
   does not match, so the affordance is always visible on phones, which is where the
   reach matters.

Measured at 1024x768:

```
desktopAddHidden            opacity=0  inTabOrder=true  display=flex  visibility=visible
desktopAddOnHover           opacity=1
desktopAddOnFocus           opacity=1  focused=true          (keyboard reaches it)
desktopAddOnChipFocusWithin opacity=1  activeIsChip=true     (:focus-within reveals it)
```

Measured at 375 and 320: `addOpacity = 1`, size `32x32`, slop `44x44`.

No long-press was added: a long-press on the bubble would have to suppress text selection
and could swallow a scroll start, and the compact inline button already sits inside the
thumb zone. The bottom-sheet picker remains the primary path.

### 6 - Not closeable in this environment

No MySQL is reachable from here: `node_modules` is not installed, there is no `.env`,
`DB_PASSWORD` is unset, and `mysql` / `mysqld` / `docker` are all absent from PATH
(checked). The DDL, the real `GROUP BY` and the real `DELETE`/`INSERT IGNORE` are still
proven only as SQL text with bound parameters. **This finding stays open for the
orchestrator: run `npm run init-db` and a two-account smoke test before release.**

## Commands run

### `node --check`

```
node --check server.js                 => exit 0
node --check init-db.js                => exit 0
node --check public/chat-reactions.js  => exit 0
```

(`public/chat-reactions.css` and `public/wiadomosci.html` are not JS; the page's inline
script was not modified in this pass beyond the two `?v=` bumps.)

### Unit test of the pure logic - `%TEMP%\prezenty-rx2\logic-test.js` (deleted)

**52 assertions passed, 0 failed.** Exports asserted to be exactly
`CHAT_REACTIONS, CHAT_REACTION_EMOJI, buildReactionList, groupReactionsByMessage,
isAllowedReactionEmoji, parseMessageId, reactionThrottleStep, toggleAction`. Covers, as in
pass 1: the six-emoji allowlist and its rejections (`💩`, `🔥`, `👍👍`, bare `❤`,
`<script>`, `'; DROP TABLE users; --`, non-strings), `parseMessageId` (`'0'`, `'-1'`,
`'1.5'`, `'7abc'`, `'1 OR 1=1'`, `'1e3'` → `null`), `buildReactionList` emitting exactly
`{count,emoji,mine}` with no `user_id`/`username` leak, `groupReactionsByMessage` numeric
keys, `toggleAction`, and a toggle sequence against an in-memory store that enforces
`UNIQUE (message_id, user_id, emoji)`.

New in this pass:

```
--- reactionThrottleStep (server-side throttle) ---
  PASS  first MAX allowed, rest blocked        [true,true,true,false,false]
  PASS  window rollover resets                 allowed=true hits=1
  PASS  no bucket => fresh                     {start:50,hits:1,allowed:true}
  PASS  garbage bucket => fresh                ({start:'x',hits:99} is not trusted)
  PASS  pure: input bucket untouched
```

### Route test against the REAL handlers - `%TEMP%\prezenty-rx2\route-test.js` (deleted)

`node_modules` is not installed, so the real `server.js` was loaded with `Module._load`
interception (stubbed express / session / mysql2 / web-push / sharp / multer / cron /
dotenv) over an in-memory fake pool, and the **actually registered** handlers were driven.
**35 assertions passed, 0 failed:**

```
--- wiring ---            toggle route registered, 2 handlers (requireAuth + handler); thread GET registered
--- auth / validation --- 401 no session; 400 off-allowlist ("Nieprawidłowa reakcja"); 400 missing emoji;
                          400 for 'abc','1.5','-3','0','10; DROP TABLE users'; 404 unknown message;
                          403 non-participant ("To nie Twoja rozmowa")
--- toggle ---            first tap adds; second removes; <=1 row under 6 rapid repeats; other participant aggregates
--- privacy ---           no user_id/userId/username/sender in the response; entry keys exactly count/emoji/mine
--- thread GET ---        reactions array on every message; [] when none; no identity fields;
                          ONE grouped query per thread load (no N+1)
--- no notifications ---  no notifications/push/activity/is_read write during reactions; web-push never called
--- SQL ---               every reaction statement parameterised; emoji never in SQL text;
                          message ids arrive as numbers; DDL has the unique key, idx_reaction_message, utf8mb4_bin
--- throttle (new) ---    429 after 29 further toggles (30 in the window); body "Zbyt wiele reakcji. Odczekaj chwilę";
                          throttled requests wrote nothing extra; throttle is per user - the other participant is unaffected
```

## Visual / a11y harness

Rebuilt in `%TEMP%\prezenty-rx2\harness` (outside the repo, deleted afterwards).
`build.js` reads the **real** `public/wiadomosci.html`, rewrites relative
stylesheet/image URLs to `file:///` links into `public/`, keeps every inline `<style>`
block and the real body markup (reaction sheet, composer, bottom tab bar), strips the
app's own scripts, then injects a driver that loads the shipping `pluralize-pl.js` and
`chat-reactions.js` and renders four message rows through `ChatReactions.ingest()` /
`strip()` - the chips and picker in the captures are produced by the shipped code. It also
performs the real `box.scrollTop = box.scrollHeight`. `playwright-core@1.47.2` (installed
only in the temp dir) drove the local Edge at true viewports, `deviceScaleFactor: 2`.

**0 console errors and 0 page errors at 375, 320 and 1024.**

### Screenshots (`.agents/tasks/screenshots/`) - all re-captured this pass

| File | What it shows |
| --- | --- |
| `chat-reactions-375.png` | chips both bubble directions, own ones purple + 2px border, 32px add button |
| `chat-reactions-375-picker.png` | bottom sheet open (handle, 3x2 grid, two own emoji pressed) |
| `chat-reactions-375-greyscale.png` | **finding 2** - pressed state readable without colour |
| `chat-reactions-375-focus.png` | `:focus-visible` ring on a chip |
| `chat-reactions-320.png` | narrowest phone, chips wrapping to a second row |
| `chat-reactions-320-picker.png` | bottom sheet at 320 px |
| `chat-reactions-1024.png` | desktop; add buttons hidden except on the hovered row (**finding 5**) |
| `chat-reactions-1024-picker.png` | desktop centred popover card |

### Measured at 375 x 812

- Own chip `53x32`, `#4A148C` on `#F3E5F5`, border `2px #7B1FA2` + white inner ring,
  `aria-pressed="true"`, label `Reakcja serce: 2 osoby. Usuń swoją reakcję`.
- Other chip `53x32`, `#2d3748` on `#ffffff`, border `1px #868F99`,
  `aria-pressed="false"`, label `Reakcja prezent: 1 osoba. Dodaj swoją reakcję`
  (correct `plCount` forms: `1 osoba` / `2 osoby` / `5 osób` / `12 osób`).
- Add button: visual `32x32`, hit slop `44x44`, `aria-label="Dodaj reakcję do wiadomości"`.
- Chip strip row height **32px** (was 44).
- Every chip / add button / sheet button is a real `<button type="button">`; no chip is
  inside a `.chat-bubble` (`chipsInsideBubble: 0`), which is why the from-me bubble's
  `color:#fff !important` still measures `rgb(255,255,255)` on its text while chips keep
  their own colours.
- Layout not regressed: `.chat-msg-row.from-me` 260px wide, bubble inside it also 260px
  (the 82% cap moved to the wrapper, bubble width unchanged); `documentElement.scrollWidth`
  stays at the viewport width at 375 and 320; `scrolledToBottom: true` after render.
- Clearance: composer bottom 708px, fixed tab bar top 730px. Chips live inside the
  `overflow-y: auto` message box, so they grow the scroller, not the page.
- Tab order inside a strip: `chip ❤️ → chip 😂 → chip 👍 → chip 🎁 → add button`.
  Focus ring `2px solid rgb(30,136,229)`, offset 2px.

### Bottom sheet

`role="dialog"`, `aria-modal="true"`, `aria-labelledby="reactionSheetTitle"`, title
"Wybierz reakcję". Pinned to the viewport bottom, full width, `border-radius 20px / 0px`,
grab handle `40x4 rgba(0,0,0,0.18)`, `max-height` resolving to 730.8px (90 dvh of 812),
grid `overflow-y: auto`, `padding-bottom` including `env(safe-area-inset-bottom)`.
Buttons `105x56` at 375 and `87x56` at 320 - both past 44x44. Labels
`Reakcja serce / śmiech / łapka w górę / prezent / zdziwienie / podziękowanie`
(gender-neutral). Opening focuses the **first emoji**; `Shift+Tab` from there wraps to
"Zamknij" and stays inside the sheet; `Escape` closes (`is-open` removed, `aria-hidden`
and `inert` restored, overlay `visibility: hidden`) and returns focus to the add button.
Desktop (1024): the same element becomes a 320px card centred at `512 of 512` /
`384 of 384`, grab handle `display: none`.

`prefers-reduced-motion: reduce` (Edge emulation): sheet `transition-duration: 0s`,
`transform: none` at 375 and `0s` at 1024; the new add-button opacity transition is also
`0s` under reduced motion.

### Contrast (computed from the measured colours)

| Pair | Ratio |
| --- | --- |
| own chip text `#4A148C` on `#F3E5F5` | 9.80 |
| own chip border `#7B1FA2` on `#F3E5F5` | 6.77 |
| other chip text `#2d3748` on `#ffffff` | 11.99 |
| **unpressed chip border `#868F99` on `#ffffff`** | **3.28** |
| sheet button border `#868F99` on `#f8f9fa` | 3.11 |
| add button icon `#4a5568` on `#ffffff` | 7.53 |

Full WCAG conformance still needs manual testing with assistive technology; what is
reported here is computed contrast plus driven keyboard behaviour.

## Not exercised live

- **No MySQL.** `node_modules` absent, no `.env`, `DB_PASSWORD` unset, no `mysql`/`mysqld`/
  `docker` on PATH. The `CREATE TABLE`, the real `GROUP BY` and the `DELETE`/`INSERT IGNORE`
  are proven as SQL text with bound parameters only (finding 6 stays open). The collation
  trap is handled up front: `emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  because the `*_ci` collations compare many 4-byte emoji as equal and would collapse both
  the unique key and `GROUP BY emoji`.
- `npm run init-db` not run (needs the production `DB_PASSWORD`).
- No end-to-end run with two real logged-in browsers; the cross-participant path is covered
  by the route test's two-user scenarios.
- The throttle was exercised through the real handler with a stubbed clock-free loop; it was
  not observed under real concurrent load.

## File scope

Changed by **this** task:

| File | Status |
| --- | --- |
| `server.js` | modified - targeted additions only (require, DDL, thread aggregate, toggle endpoint, throttle) |
| `init-db.js` | modified in pass 1 - chat schema mirrored for fresh installs (46 added, 0 removed) |
| `public/wiadomosci.html` | modified - asset links (`?v=2`), message wrapper, reaction signature, sheet markup |
| `public/chat-reactions.js` | **new** - shared logic (required by `server.js`) + browser UI |
| `public/chat-reactions.css` | **new** - chips, add button, bottom sheet / desktop card |

`git -P diff` on `public/formularz.html`, `public/formularz.js`, `public/notification-text.js`,
`public/sw.js`, `public/app-theme.css` and `public/leaderboard.html` greps **0** lines
matching `reaction|reakcj|chat-reactions` - those files show as modified in the working tree
but none of it is this task's work. The `server.js` diff likewise carries concurrent
`notificationText('present_added', …)` hunks.

## Service worker / cache busters (NOT edited here)

- `public/sw.js` untouched. `CACHE_NAME` needs a bump so returning PWA clients pick up the
  modified `wiadomosci.html`.
- Optionally add to `urlsToCache`: `/chat-reactions.css` and `/chat-reactions.js`. They work
  uncached either way (the fetch handler is network-first for navigations/HTML).
- Cache busters bumped in `wiadomosci.html` this pass: `chat-reactions.css?v=1 → ?v=2` and
  `chat-reactions.js?v=1 → ?v=2`. No other `?v=` on that page needed bumping.

## Cleanup

Deleted after use: `%TEMP%\prezenty-rx2\logic-test.js`, `%TEMP%\prezenty-rx2\route-test.js`
and the whole `%TEMP%\prezenty-rx2\harness` directory (harness, `node_modules`, shots,
`report.json`). Nothing temporary was written inside the repo; only the eight screenshots
and this document.

---

## Carried over from pass 1

- The deviation from plan D10 still stands: the allowlist and aggregation live in
  `public/chat-reactions.js` (the pattern already used by `pluralize-pl.js` and
  `notification-text.js`) rather than inside `server.js`, because hard requirement 4 asks
  for them to be unit-testable without booting express / MySQL / cron / web-push.
- The residual privacy inference is unchanged and was accepted in the plan: in a two-person
  thread, `count - (mine ? 1 : 0) > 0` tells you the other side reacted. That is the same
  pseudonymous fact that receiving a message already conveys; the target still only ever
  sees `Święty Mikołaj 🎅`.
- `anonTablesEnsured` is a per-process latch, so an existing deployment creates the
  reactions table on its next restart - no `ALTER` migration needed.
- `init-db.js` had to be rebuilt from its git blob in pass 1 because OneDrive kept failing
  reads with `UNKNOWN`; `git -P diff --numstat init-db.js` reported `46 0`, purely additive
  with no line-ending churn.
