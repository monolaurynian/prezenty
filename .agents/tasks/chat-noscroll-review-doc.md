# Horizontal scrollbar on the chat page removed by making the add-reaction touch target a real box

The chat page's horizontal scrollbar came from the add-reaction button's hit slop, not from the page
or the body: `.chat-reaction-add` drew a 32px circle and bought its 44px touch target back with a
44x44 `::after` centred on the button, so 6px of box hung past each side. On right-aligned
(`from-me`) rows that 6px landed outside `#chatMessages`, whose `overflow-y: auto` makes `overflow-x`
compute to `auto` — a real horizontal scroller that the page's body-level `overflow-x: hidden` can
never reach. The fix converts the horizontal half of the touch target into a laid-out 44px-wide
button box (the circle moves to a new `::before`, the `::after` keeps only the vertical slop via
`left: 0; right: 0`), adds `min-width: 0` to the shrinkable flex items, replaces `max-width: 100vw`
with `100%`, and gives the thread-list header row a shrinkable label plus a non-shrinking
badge/timestamp column. No container gained `overflow-x: hidden`.

Watch for: the verification doc asks a downstream step to bump `sw.js` `CACHE_NAME` so the new CSS
reaches installed clients — the service worker is cache-first on an exact URL match, so `?v=3`
already bypasses every cached entry and the bump is unnecessary (confirmed). The prior pass's
non-blocking finding about the slop overhanging the *bubble above* is still open: only the
horizontal axis was constrained, the 6px of vertical slop above the button remains (confirmed).
Nothing blocking.

**Verdict**: APPROVED

## High-level view

The diagnosis is concrete and measured, not inferred: `#chatMessages` at `scrollWidth 323 /
clientWidth 317` (+6px) at 375px and the same +6px at 320/360/414/768/1024, with the offending box
named as `button.chat-reaction-add::after [pseudo] +6px` per outgoing message. The second,
invisible overflow (the thread-row header at +288px on 320px, silently clipped by the shared
`.container { overflow-x: hidden }` instead of scrolling) was found and fixed in the same pass.

The fix attacks the cause. Every change is a shrink/wrap mechanism — a real box instead of
unaccounted pseudo-element width, `min-width: 0` on the strip, bubble, scroller and thread label,
`flex-shrink: 0` on the badge column, `100vw` → `100%`. The body-level `overflow-x: hidden` stays
but is demonstrated to be inert: half of the 78-combination matrix re-measures with that rule
emptied and reports +0 at all six widths with `document.scrollingElement` clean.

Reaction accessibility survives the geometry change. Chips are untouched in the diff and still carry
the 2px border plus `inset 0 0 0 1px #ffffff` pressed cue; the add button keeps its 44x44 effective
target (44px real width x 44px slop height on a 32px-tall row, so chat density is unchanged); the
focus ring moved to the `::before` circle so it still hugs the visible 32px affordance and is still
an `outline`, which forced-colours mode preserves. `chat-reactions.js` is not in the diff at all, so
the in-place chip reconciliation, the dialog focus trap, Escape handling and focus return are
structurally undisturbed.

Long content behaves: `overflow-wrap: break-word` with an explicit `word-break: normal` on the
bubble breaks a 60-char unbreakable token but never chops ordinary Polish words, and the chip strip
wraps to a second row rather than widening the page. URLs keep the inherited
`.chat-bubble a { word-break: break-all }`, so they wrap instead of ellipsizing — a documented
deviation from the task's stated preference, argued on the grounds that a URL is often the entire
message.

Forbidden files are clean for this task. `sw.js`, `tab-bar-functions.js`, `formularz.*` and the
`?v=17` sweep across seven pages all show in the diff, but file mtimes place `sw.js` at 12:20
(immediately after the reactions review closed at 12:19) and the form files at 12:46–12:47, while
this task's two files were written at 12:50–12:51. No shared stylesheet was edited; the
`.container { overflow-x: hidden }` root cause was reported with a recommended fix instead, which is
the required behaviour.

<details>
<summary>Issues (6)</summary>

1. **Unnecessary `CACHE_NAME` bump requested** (confirmed, non-blocking) — `sw.js` is cache-first via
   `caches.match(event.request)` with no `ignoreSearch`, so `chat-reactions.css?v=3` cannot match the
   precached `/chat-reactions.css` or the previously cached `?v=2` entry. The `?v=` bump alone
   delivers the new CSS; drop the bump request from the handoff so a downstream step does not do
   needless work. The unversioned `/chat-reactions.css` precache entry is dead weight for the same
   reason.
2. **Vertical hit slop still overhangs the bubble above** (confirmed, non-blocking, carried over from
   the reactions pass) — `::after` keeps `height: 44px` centred on a 32px row, so 6px extends above
   the button and ~2px into the bubble above it (`.chat-reactions` has `margin-top: 4px`), where it
   can absorb a tap on a link on the bubble's last line. The verification doc describes the slop as
   extending "below the strip", which understates it. Cap the upward half (asymmetric `top`/`height`)
   or raise `margin-top` to 6px.
3. **Add circle no longer flush with the row's right edge** (confirmed, cosmetic) — the 44px box now
   sits on the `from-me` row's right edge, so the visible 32px circle is inset ~6px from the bubble
   and chips above it. Acknowledged in the doc as a ~12px shift at 1024px; accept or re-align with a
   negative margin if the asymmetry reads as a bug.
4. **URLs wrap rather than ellipsize** (confirmed, non-blocking) — `.chat-bubble a
   { word-break: break-all }` kept, against the task's stated "URLs prefer ellipsis". Measured clean
   at 320px, so the overflow requirement is met; confirm the product preference if ellipsis was a
   hard requirement.
5. **`.container { overflow-x: hidden }` left in the shared stylesheet** (confirmed, informational) —
   correctly reported rather than edited, but it still forces `overflow-y: auto` on every
   `.container` on every page and silently clips rather than scrolls. Needs a follow-up change that
   is allowed to touch shared CSS (`overflow-x: clip` or removal, then re-measure).
6. **Undocumented `app-theme.css?v=13` → `?v=14` bump in `wiadomosci.html`** (confirmed,
   non-blocking) — brings the page in line with the other nine pages and `app-theme.css` itself is
   unmodified, so it is harmless, but it is not recorded in the verification doc's change tables.

</details>

<details>
<summary>Details</summary>

## The diagnosis holds up against the CSS

The load-bearing claim is that `#chatMessages` is itself horizontally scrollable, and it holds for a
non-obvious reason: `.chat-messages` declares only `overflow-y: auto`, and CSS computes a `visible`
value to `auto` when the other axis is not `visible`. That is why the page already carried
`html, body { overflow-x: hidden }` and still showed a scrollbar — the guard applies to the document
and the overflow was two levels in, which the harness corroborates from the other direction
(`document.scrollingElement` measured `scrollWidth == clientWidth` before *and* after).

The geometry is checkable without re-running anything. The old rule was `width: 44px; height: 44px;
left: 50%; top: 50%; transform: translate(-50%, -50%)` on a 32px-wide button — (44 - 32) / 2 = 6px of
overhang per side — and `.chat-msg-row.from-me .chat-reactions` is `justify-content: flex-end`, so the
right-hand 6px sits exactly on the row's right edge for every outgoing message. The reported offender
and pixel count match the arithmetic.

## The fix changes layout, not clipping

```
BEFORE                              AFTER
.chat-reaction-add  32px box        .chat-reaction-add  44px box  (flex: none)
  ::after  44x44, centred             ::before  32x32 circle, centred
           6px  |====|  6px                     (hover fill + focus ring)
           outside the flex layout     ::after  left:0 right:0, height:44px
                                                vertical slop only
```

The horizontal touch target is now something the flex layout measures, which is what makes the
pre-existing `max-width: 100%` on `.chat-reactions` actually contain it. The vertical slop stays a
pseudo-element deliberately — a 44px-tall button under every bubble would cost roughly one message
per screen in the 58vh scroller (`#chatMessages` carries an inline `max-height: 58vh`, overriding the
stylesheet's 45vh, so the comment's "58vh" is accurate). The absolutely positioned `::before` would
otherwise paint over the in-flow icon, hence `> i { position: relative; z-index: 1 }`.

No rule in the diff adds `overflow-x: hidden` to any container, and the remaining additions
(`min-width: 0` on the scroller, bubble, chip strip and thread label; `flex-shrink: 0` on the
badge/timestamp column; `100vw` → `100%`) are all shrink mechanisms.

## The guard-off proof is the part that matters

The harness is built for the guard-off requirement: the `html, body { overflow-x: hidden; max-width:
100% }` rule lives in its own `<style id="overflowGuard">` at the same cascade position so it can be
emptied and re-measured. The `noguard` half of the matrix reports +0 on `#chatMessages` and
`scrollWidth == clientWidth` on the document at 320/360/375/414/768/1024, and reproduced the +6px at
all six widths before the fix — which also rules out the harness simply failing to see overflow.
Across 78 combinations (six scenarios including longword, longurl, manychips and the open sheet, plus
a list-view pass, two guard states, six widths) nothing overflows after the fix, including the
pseudo-element pass that found the bug.

I did not re-run any of this, so the pixel values rest on the coder's record. What I verified
independently is that the CSS in the working tree implements the mechanism the doc describes and that
the before/after geometry agrees with the reported numbers.

## Reaction a11y: the focus ring was the thing that could have quietly disappeared

Moving a focus ring onto a pseudo-element is the kind of change that deletes a focus indicator
silently. Here the button takes `outline: none` and `::before` takes `outline: 2px solid #1E88E5;
outline-offset: 2px` — same 36px ring around the same visible circle, still an `outline` so
forced-colours mode keeps it, measured as `rgb(30, 136, 229) solid 2px` with the button at
`outline-style: none`. The reveal rules are untouched (opacity under
`@media (hover: hover) and (pointer: fine)` with `:focus`/`:focus-visible` in the selector list), so
the button never leaves the tab order and touch devices, which do not match the query, keep it at
full opacity.

Chips are not in the diff: `.chat-reaction-chip[aria-pressed="true"]` still carries `border-width:
2px` with `padding: 3px 9px` (so the toggle does not reflow) plus `box-shadow: inset 0 0 0 1px
#ffffff`, so the non-colour pressed cue survives. `chat-reactions.js` is absent from the diff
entirely, so chip reconciliation, the dialog semantics, the Tab trap, Escape and focus return cannot
have regressed; the functional pass additionally records `sameNode: true` / `focusKept: true` across
a `refreshStrips()` with a changed aggregate, and `tap()` opening the sheet under
`hasTouch: true, isMobile: true`.

## Thread-row shrink is a behaviour change, not just an overflow fix

Bubble alignment, timestamps, the composer, the tab-bar clearance and `box.scrollTop =
box.scrollHeight` are all outside the diff. The thread-list header is the one place where behaviour
improves beyond the scrollbar: the unread badge and the timestamp were previously pushed out of the
card and clipped by `.container` on narrow screens (+288px at 320px, zero visible scrollbar), and now
survive because the label shrinks and wraps instead.

## Forbidden-file attribution

The diff spans 14 files, four of which are on the forbidden list, so attribution had to be settled
rather than assumed. File mtimes do it: `sw.js` 12:20:52 — one minute after the reactions review JSON
was written at 12:19:51, and its content (adding `/chat-reactions.css` and `/chat-reactions.js` to the
precache list, `v119` → `v120`) is reactions-feature work that the prior review recorded as still
`v119`. `formularz.js` 12:46:53 and `tab-bar-functions.js` 12:47:05 carry the "Dodaj dock tab opens
the add composer" wiring and the `?v=17` sweep, which is the concurrent add-mode workflow (its own
verification doc also disclaims `sw.js`). This task's files are `chat-reactions.css` 12:50:48 and
`wiadomosci.html` 12:51:12. No shared stylesheet is modified.

</details>

<details>
<summary>Files changed (this task)</summary>

- `public/chat-reactions.css` — add button becomes a 44x32 laid-out box; circle, hover fill and focus
  ring move to a new `::before`; `::after` reduced to vertical slop; `min-width: 0` on the chip strip;
  reduced-motion block follows the transition.
- `public/wiadomosci.html` — `max-width: 100vw` → `100%`; `min-width: 0` on `.chat-messages` and
  `.chat-bubble` plus explicit `word-break: normal`; shrinkable `.thread-who` with a non-shrinking
  badge/timestamp column; `chat-reactions.css?v=2` → `?v=3`; `app-theme.css?v=13` → `?v=14`.

Not from this task (mtime-attributed to concurrent workflows): `public/sw.js`,
`public/tab-bar-functions.js`, `public/formularz.html`, `public/formularz.js`, and the `?v=17` sweep
in `activity.html`, `archiwum.html`, `home.html`, `recipients.html`, `rezerwacje.html`,
`ustawienia.html`.

Full diff: `git -C "c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty" diff -- public/wiadomosci.html public/chat-reactions.css`

</details>
