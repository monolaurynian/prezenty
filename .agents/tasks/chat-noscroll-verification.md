# Chat page: horizontal scrollbar removed structurally

First iteration (no `chat-noscroll-review.json` existed).

## Measured root causes

Diagnosed in a headless-Edge harness that walked the whole DOM: for every
element it compared `getBoundingClientRect().right` against the viewport's
client right edge AND against `#chatMessages`' content right edge, and
compared `scrollWidth` vs `clientWidth` on every element whose computed
`overflow-x`/`overflow-y` was `auto`/`scroll`. Pseudo-elements have no
client rect, so the add button's `::after` box was measured separately
from `getComputedStyle(el, '::after')`.

### 1. The scrollbar the user saw: `.chat-reactions .chat-reaction-add::after` (+6px)

`#chatMessages` measured **scrollWidth 323 / clientWidth 317 (+6px)** at
375px wide, and the same +6px at 320, 360, 414, 768 and 1024px.

- `.chat-messages` sets `overflow-y: auto` and leaves `overflow-x` at
  `visible`. Per CSS, `visible` next to a non-`visible` value computes to
  `auto`, so the messages scroller is horizontally scrollable: any overflow
  inside it is a real horizontal scrollbar. The body-level
  `overflow-x: hidden` cannot reach it, which is why the page already had
  that rule and the scrollbar still appeared.
- The add-reaction button drew a 32px circle and bought its 44px touch
  target back with a `::after` of `width: 44px; height: 44px` centred on
  the button (`left: 50%; transform: translate(-50%, -50%)`). That is 6px
  of box sticking out on each side.
- `.chat-msg-row.from-me` is `align-self: flex-end` with
  `justify-content: flex-end` on the strip, so on every outgoing message
  the add button's right edge sat exactly on the row's right edge and the
  slop hung 6px past it. Measured offender, per outgoing message:
  `button.chat-reaction-add::after +6px [pseudo]`.

The same slop is what the earlier reviewer saw overhanging the bubble's
bottom edge: the vertical half of it (44px tall on a 32px row) extends
~6px below the strip.

### 2. List view: `.thread-row` flex children with no `min-width: 0` (+288px)

With a long thread label the header row measured
`scrollWidth 608 / clientWidth 320 (+288px)` at 320px, +233px at 375px,
+194px at 414px; offenders `span.thread-who +217.8`,
`span.d-flex.align-items-center.gap-2 +288.5`, `span.thread-unread +243.8`,
`small +288.5`. `.thread-who` has `min-width: auto` as a flex item, so it
refused to shrink below its min-content width and pushed the unread badge
and timestamp out of the card. This produced no visible scrollbar only
because the shared `.container` clips it (see "Left alone"), i.e. the badge
and the timestamp were silently lost instead.

## Changes made

### `public/chat-reactions.css` (loaded as `chat-reactions.css?v=3`)

| Selector | Change | Why |
| --- | --- | --- |
| `.chat-reactions` | added `min-width: 0` | keeps the chip strip shrinkable as a flex item of `.chat-msg-row`; `flex-wrap: wrap` + `max-width: 100%` were already there and do the wrapping |
| `.chat-reactions .chat-reaction-add` | `width: 32px` → `width: 44px`, `height: 32px` kept, added `flex: none`, dropped `border-radius: 50%` and the `background` hover | the horizontal half of the touch target is now a **real box** the flex layout accounts for, so `max-width: 100%` on the strip actually contains it. Row height is still 32px, so no message is pushed out of the 58vh scroller |
| `.chat-reactions .chat-reaction-add::before` (new) | 32x32, `border-radius: 50%`, transparent, `transition: background` | draws the unchanged 32px circle inside the 44px box and carries the hover fill |
| `.chat-reactions .chat-reaction-add > i` (new) | `position: relative; z-index: 1` | an absolutely positioned `::before` would otherwise paint over the in-flow icon |
| `.chat-reactions .chat-reaction-add::after` | `width: 44px` → `left: 0; right: 0`; `transform: translate(-50%,-50%)` → `translateY(-50%)`; `height: 44px` kept | the slop is now never wider than the button's own box, so it cannot overflow horizontally. It still provides the vertical 6px+6px, on the axis the scroller handles |
| `.chat-reactions .chat-reaction-add:hover` / `:hover::before` | hover fill moved from the button to the `::before` circle | keeps the hover affordance a 32px circle, not a 44x32 pill |
| `.chat-reactions .chat-reaction-add:focus-visible` / `:focus-visible::before` (new) | `outline: none` on the button, `outline: 2px solid #1E88E5; outline-offset: 2px` on the `::before` | the ring keeps hugging the 32px circle: same 36px ring as before the box grew. Still an `outline`, so forced-colours mode keeps it |
| `@media (prefers-reduced-motion: reduce)` | added `::before { transition: none }` | the hover fill moved, so its transition had to move with it |

### `public/wiadomosci.html` (inline `<style>` only)

| Selector | Change | Why |
| --- | --- | --- |
| `html, body` | `max-width: 100vw` → `max-width: 100%` | `100vw` includes the vertical scrollbar, so it is ~15px wider than the viewport on desktop - a latent overflow source. `overflow-x: hidden` kept as a belt-and-braces guard only (proven unnecessary below) |
| `.chat-messages` | added `min-width: 0` + a comment recording that `overflow-y: auto` makes `overflow-x` compute to `auto` | documents the trap for the next change |
| `.chat-bubble` | added `min-width: 0` and an explicit `word-break: normal` | wraps at spaces, breaks only a token that cannot fit on a line of its own; Polish words are never chopped letter by letter |
| `.thread-row .thread-who` | added `min-width: 0; overflow-wrap: break-word; word-break: normal` | lets the label shrink and wrap instead of pushing the badge and timestamp out |
| `.thread-row > .d-flex > .d-flex` (new) | `flex-shrink: 0` | the unread badge + timestamp column stays intact while the label absorbs the shrink |
| `<link href="chat-reactions.css?v=2">` | → `?v=3` | cache-buster for the CSS change |

No `overflow-x: hidden` was added to any container as part of the fix.

## Cache busters

- `chat-reactions.css?v=2` → **`?v=3`** in `public/wiadomosci.html`.
- `chat-reactions.js?v=2` — **unchanged**, the JS was not touched.
- `public/sw.js` was not edited (owned by a concurrent workflow). It
  precaches `/chat-reactions.css`, so **`CACHE_NAME` needs a bump from
  `prezenty-v120`** for the new CSS to reach installed clients.

## Verification

Harness in `%TEMP%\chat-noscroll-harness` (outside the repo, deleted
afterwards), following `.agents/tasks/verification.md`:

- `build.js` read the real `public/wiadomosci.html`, extracted its inline
  `<style>` verbatim and linked the real stylesheets as `file:///` URLs
  into `public/` (`styles.deduped.min.css`, `bottom-tab-bar.css`,
  `app-theme.css`, `chat-reactions.css`) plus the three CDN stylesheets,
  and loaded the real `chat-reactions.js` and `pluralize-pl.js`. Body
  markup is the real `#listView` / `#chatView` / `#reactionSheet` /
  `.bottom-tab-bar`.
- The `html, body { overflow-x: hidden; max-width: ... }` rule was split
  into its own `<style id="overflowGuard">`, same cascade position, so the
  harness can empty it and re-measure.
- Messages are rendered by the same template string as
  `loadThreadMessages()`, with the chip strips produced by the real
  `window.ChatReactions.ingest()` + `.strip()`.
- Driven by `playwright-core@1.47.2` against the installed Edge, headless,
  with **true viewports** (plain headless Edge `--window-size` clamps to
  ~490px).

### Scenarios x widths

Six scenarios (`normal` incoming+outgoing with strips, `longword` 60-char
unbroken word, `longurl`, `manychips` all six allowlisted emoji with
3-digit counts, `addfocus` short message with the add button focused,
`sheet` open bottom sheet) plus a `listview` pass, each at 320, 360, 375,
414, 768 and 1024px, each run twice (guard on / guard off) = 78 measured
combinations. Full JSON in the harness `report-before.json` /
`report-after.json` (deleted with the harness).

`#chatMessages` scrollWidth / clientWidth, identical for every scenario at
a given width:

| width | BEFORE | AFTER |
| --- | --- | --- |
| 320 | 268 / 262 (**+6**) | 262 / 262 (**+0**) |
| 360 | 308 / 302 (**+6**) | 302 / 302 (**+0**) |
| 375 | 323 / 317 (**+6**) | 317 / 317 (**+0**) |
| 414 | 362 / 356 (**+6**) | 356 / 356 (**+0**) |
| 768 | 692 / 686 (**+6**) | 686 / 686 (**+0**) |
| 1024 | 564 / 558 (**+6**) | 558 / 558 (**+0**) |

`document.scrollingElement` measured `scrollWidth == clientWidth` (+0) at
every width before and after - the overflow was always inside the chat
scroller, which is why the existing body-level guard never helped.

List view header row, BEFORE → AFTER: 320px `608/320 (+288)` → `+0`;
360px `+248` → `+0`; 375px `+233` → `+0`; 414px `+194` → `+0`;
768 and 1024px were already clean. Offender count 4 → 0.

After the fix, **every one of the 78 combinations reports zero overflowing
scroll containers and zero offending boxes**, including the pseudo-element
check.

### Without the body-level guard

The `noguard` half of the matrix empties
`html, body { overflow-x: hidden; max-width: 100% }` before measuring.
BEFORE: the same +6px on `#chatMessages` at all six widths. AFTER: +0 at
all six widths, document `scrollWidth == clientWidth`. The layout measures
clean without the guard, so the guard is belt-and-braces, not the fix.

### Feature / a11y checks (375px, `func.js`)

- Add button: real box 44x32, `::after` slop 44px tall and 44px wide (never
  wider than the box) = **44x44 effective touch target**; `::before` circle
  still 32x32 with `border-radius: 50%`; button right edge exactly on the
  row's right edge (`buttonRightVsRowRight: 0`); still
  `<button type="button" aria-label="Dodaj reakcję do wiadomości">`.
- Chips: still `BUTTON` elements with `aria-pressed` and full Polish
  aria-labels; pressed chip keeps its **non-colour cue** - `border-width`
  1px → 2px plus the `inset 0 0 0 1px #ffffff` ring; chip box unchanged at
  53x32.
- Focus ring: keyboard focus puts `outline: rgb(30, 136, 229) solid 2px` on
  the `::before` circle and `outline-style: none` on the button, i.e. the
  same visible 36px ring as before. Confirmed visually in a 3x close-up.
- Hover: the 32px grey circle renders **with the icon on top of it**
  (confirmed visually in a 3x close-up, so the `> i { z-index: 1 }` fix
  works).
- Picker: `role="dialog"`, `aria-modal="true"`, `inert`/`aria-hidden`
  removed on open, 6 emoji buttons, focus lands on the first emoji;
  Escape closes it, restores `inert` and returns focus to the add button.
- In-place reconciliation: after `ingest()` + `refreshStrips()` with a
  changed aggregate, the add button is the **same DOM node**
  (`sameNode: true`), focus stayed on it (`focusKept: true`), chips kept
  allowlist order (`👍2`, `🎁5`) and the add button stayed last.
- Touch device (`hasTouch: true, isMobile: true`): add button computed
  `opacity: 1` (no hover media query), 44x32 box with the 44px slop, and
  `tap()` on it opens the sheet.

### Screenshots (`.agents/tasks/screenshots/`)

`chat-noscroll-320.png`, `chat-noscroll-375.png`,
`chat-noscroll-375-longurl.png`, `chat-noscroll-375-manychips.png`,
`chat-noscroll-1024.png`. Reviewed all five:

- No horizontal scrollbar and no clipped content at any width.
- Bubbles, timestamps, chips, the composer and the fixed tab bar all
  render normally; the newest message is at the bottom of the scroller.
- The long URL wraps inside the bubble (incoming and outgoing) and stays
  inside the card.
- The six 3-digit chips wrap onto two rows of three instead of widening
  the row.
- At 1024px the layout is unchanged from before the fix apart from the
  chips sitting ~12px further from the bubble's right edge, which is the
  invisible add-button box now being laid out instead of overhanging.

Temporary harness files (`build.js`, `run.js`, `func.js`, `hover.js`,
`harness.html`, both reports, the close-up PNGs, `node_modules`) were
deleted.

## Left alone, deliberately

- **`public/styles.deduped.min.css`: `.container { overflow-x: hidden }`**
  (shared stylesheet, not edited). Two effects worth recording:
  1. Because `overflow-x` is `hidden` and `overflow-y` is `visible`,
     `overflow-y` computes to `auto`, so every `.container` on every page
     is a scroll container. That is what was silently clipping the thread
     row's unread badge and timestamp instead of showing a scrollbar.
  2. It is a symptom-masking rule of exactly the kind this task forbids.
  Recommended fix, for a change that is allowed to touch shared CSS:
  drop `overflow-x: hidden` from `.container` (or switch it to
  `overflow-x: clip`, which does not force `overflow-y` to `auto` and does
  not create a scroll container), then re-measure the pages that rely on
  it. Not done here: a shared-stylesheet edit forces a cache-buster bump on
  ~10 pages and risks regressions outside the chat. The page-scoped
  `min-width: 0` / `flex-shrink: 0` fix above makes the chat page measure
  clean regardless of what `.container` does.
- **`.chat-bubble a { word-break: break-all }`** kept, so a long URL wraps
  across lines rather than being ellipsized. The task preferred an
  ellipsis for URLs, but in the chat a URL is often the entire message, and
  hiding most of it would be a user-visible behaviour change rather than an
  overflow fix. Measured: wrapping produces zero overflow at 320px, so the
  overflow requirement is met either way.
- **Chip height (32px)** unchanged. Making chips 44px tall would change the
  message spacing the earlier reaction work deliberately tuned, and it is
  not needed for the overflow fix.
- **`public/sw.js`** not edited (concurrent workflow owns it); the needed
  `CACHE_NAME` bump is reported above.
- **`public/formularz.*`, `bottom-tab-bar.*`, `tab-bar-functions.js`,
  `server.js`** not touched, per the concurrency constraints.
