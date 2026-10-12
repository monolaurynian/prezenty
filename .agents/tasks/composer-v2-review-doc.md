# Collapsed add-present bar, and the composer/dock scroll fight (iteration 2)

The mobile quick-add composer on `public/formularz.html` loses its collapsed-state
submit button and the whole compact row becomes the "start adding" target; the
dock's hide-on-scroll moves from a class on the bar to `body.dock-hidden`, so the
composer can ride the same flag instead of measuring the dock. The judder was
diagnosed before any code moved and the cause is named: the page's reserved bottom
padding was derived from the dock's *live* visibility (`tabBarOffset()` read
`tab-bar-hidden`, a `MutationObserver` on the dock re-ran `updateComposerLayout()`
on every class write), so `document.scrollHeight` animated mid-gesture, the browser
clamped `scrollY`, and the clamp came back to the handler as a ">8px scrolled up"
delta that showed the dock again. This iteration also fixes the blocking finding
from the previous pass — entering add mode from a scroll-hidden dock dropped
`transform` from the transition list and snapped the composer 98px — and answers
all eight non-blocking ones, including the missing spec.

**Watch for:** `public/sw.js` `CACHE_NAME` is still `prezenty-v121` (confirmed —
though narrower in effect than the previous review stated, see below); the five
screenshots were captured ~32 minutes before the last write to `public/formularz.js`
(confirmed); the collapsed row still has no accessible name of its own, only a
labelled field inside a named section (confirmed, accepted remedy applied); the
reported full-suite count predates the spec's own timeout edit (confirmed,
self-disclosed).

**Verdict**: APPROVED

## High-level view

`tabBarOffset()` no longer reads the dock's visibility, the `MutationObserver` on
the dock is deleted, and the composer's offset plus the page's padding are now
functions of the dock's *resting* box only.
That makes `document.scrollHeight` constant while scrolling, which is the single
link that closed the loop, and the measurements show it: 14–16 distinct
`scrollHeight` values per gesture before, 1 after; 30 dock attribute mutations
before, 0 after; 11 dock state changes on an alternating ±11px gesture before, 1
after.

The two elements now hide off one flag with one distance. `--dock-hide-shift`
(`dockRestOffset() − dockFloor()`, 94px at 320px and 98px at 375/414px) is written
at layout time and consumed by both the composer and the shared dock CSS, both with
`transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`. The gap between them, which used to
close from 28px to 1.6px (and to −0.65px at 320px, i.e. an overlap), is now pinned
at 28px for the whole travel with both elements moving 14.74px on the same frame.

The previous pass's blocking regression is genuinely fixed, and the fix is the one
the geometry demands: on entry from a hidden dock, `bottom` animates 110→12 while
`translateY(98px)` animates to 0, so the rendered offset stays at 12px only while
both properties share a duration and an easing. The add-mode rule now reads
`transition: bottom 0.25s ease, transform 0.25s ease`, and the measured max
single-frame composer displacement on that exact path drops from 98px to 0.01–0.02px.

The collapsed bar is built from `visibility`, not `display`, so the 48px cue/chevron
column and the 52px submit column stay reserved in both states and the name field's
box is identical collapsed, open and closed again (77/162, 77/217, 77/256). There is
exactly one `grid-template-columns` declaration in the mobile block and the grid is
no longer in any transition list, so nothing depends on WebKit interpolating columns
— which resolves the previous iteration's finding 7 on the primary platform. The
submit `+`, the chevron and the close button are all unreachable by pointer, keyboard
and AT while collapsed; a preserved draft does not bring any of them back, and an
implicit `submit` on the collapsed form opens the composer and posts nothing.

Reserved padding is now one variable instead of a pair. `--quick-add-reserve`
replaces `--quick-add-bottom + --quick-add-h` because the page's scroll height
depends on their sum, and during entry the offset drops in one write while the row
grows over 0.2s — a live pair dips ~98px for a few frames and clamps a
bottom-pinned reader. A 320ms grow-only floor on entry takes the measured 9px of
uninvited scroll to 0.

Precedence is enforced in JS and documented in both files: `quick-add-active` wins
absolutely, the scroll handler returns before touching anything while it is set,
entering clears `dock-hidden`, and exiting calls `window.resetDockAutoHide()` so the
dock comes back shown regardless of scroll position or last scroll direction. Only
the deliberate add-mode hide touches `visibility`, `inert` and `aria-hidden`; the
transient scroll hide stays on `transform`/`opacity`/`pointer-events`, which is the
unchanged contract on all eight pages.

Cache-busting is complete: 8 × `tab-bar-functions.js?v=18`, 8 × `bottom-tab-bar.css?v=42`,
1 × `formularz.js?v=21`, no `?v=17`/`?v=41`/`?v=20` anywhere, and every edited
`<link>`/`<script>` boundary intact. The service worker's `CACHE_NAME` is still
`prezenty-v121`, but its effect is narrower than the previous review recorded: HTML
and navigations are network-first, so a connected browser gets the new HTML and with
it the new asset URLs, which are cache misses. The stale-HTML risk is confined to
the offline fallback.

<details>
<summary>Issues (4)</summary>

1. **Service-worker cache name** — `public/sw.js` `CACHE_NAME` is still
   `prezenty-v121`, so the offline fallback can serve HTML that references
   `?v=17`/`?v=41`. Bump it in the orchestrator's step (the file is on this task's
   do-not-edit list); online navigations are unaffected because HTML is network-first.
2. **Screenshots predate the final JS** — the five `composer-v2-*.png` were written
   at 15:54, `public/formularz.js` at 16:26. They match the final HTML/CSS (the
   add-mode shot carries the reverted `Szczegóły pomagają trafić 🎯` hint), and the
   only later change is the `--quick-add-reserve` plumbing, which moves padding
   during entry rather than in any settled state these shots capture. Note the gap in
   the verification or re-capture.
3. **Collapsed row has no accessible name of its own** — it is a `<form>` with a
   `click` listener, so AT users reach add mode by focusing a field labelled "Nazwa
   prezentu" inside a section named "Dodaj nowy prezent", with "Dodaj prezent…"
   carried as the placeholder. This is the remedy the previous review offered, so it
   is accepted; if the row should announce itself as an action, it needs a real
   control.
4. **Reported suite count is one edit stale** — the 113 passed / 0 failed / 11
   skipped run predates the `testInfo.setTimeout(90000)` added to the composer
   `describe`. The composer spec was re-run 20/20 green after that edit, and the
   change touches only the spec, so re-run the full suite once at the end rather than
   treating 113/0/11 as final.

</details>

<details>
<summary>Details</summary>

## The clamp loop, and the link that was actually cut

The diagnosis is backed by an isolation control, not just a narrative: pinning
`padding-bottom` with `!important` and `transition: none` took the single-input case
from 2 hide/show flips and 16 distinct `scrollHeight` values to 0 and 1, while
pinning the composer's `bottom` and leaving the padding alive changed nothing
(2 flips, 15 values). So the `bottom` animation was an aggravator and the padding was
the cause.

The diff cuts that link in three places and nothing else depends on dock visibility
afterwards:

```
tab-bar-functions.js   writes body.dock-hidden (no write to the bar at all)
                       reads  window.scrollY / innerWidth / documentElement.scrollHeight
                              + two body classes
formularz.js           dockFloor()      = max(computed bottom, 12)
                       dockRestOffset() = inset + offsetHeight + fabPoke + 8
                       tabBarOffset()   = isAddMode() ? dockFloor() : dockRestOffset()
                       (the `tab-bar-hidden` read and watchBar() are gone)
```

`Select-String` over `public/` finds one remaining mention of `tab-bar-hidden`, in a
comment, and nothing writes it. The composer's layout is now recomputed only by the
form's `ResizeObserver`, the `visualViewport` listeners, `resize`, the media-query
change and the `#editTab` observer — none of which fires on a plain scroll.

One residual: the `visualViewport` `scroll` listener still calls
`updateComposerLayout()`, which reads `getComputedStyle(bar).bottom` and
`bar.offsetHeight`. On engines where a page scroll shifts the visual viewport, that
is three forced style reads per event. It cannot reopen the loop — the values are
independent of the hide state, so the reserve and therefore `scrollHeight` do not
change — and it is pre-existing. Worth knowing, not worth changing here.

## One unit, and the two properties that have to unwind together

The mid-hide frame in `composer-v2-375-scrolled.png` was measured at capture time:
both transforms `matrix(1, 0, 0, 1, 0, 59.0097)`, gap exactly 28px.

The subtle part is the overlap the previous review caught. Entering add mode from a
scroll-hidden dock changes both properties at once in opposite directions:

```
bottom      110px ───────────► 12px      (moves the box DOWN 98px)
translateY   98px ───────────► 0         (moves the box UP   98px)
rendered offset = bottom − translateY = 12px, at every instant,
                  only while both curves have the same shape
```

With `transform` dropped from the list the residual was the full 98px in one frame;
with `bottom 0.25s ease, transform 0.25s ease` the measured residual is 0.01–0.02px
and the rendered offset stays inside 11.98…12px for the whole entry. The composer
does not leave the screen on a scroll hide — it drops into the space the dock
vacates (resting box `[innerHeight−180, innerHeight−110]`, hidden
`[innerHeight−82, innerHeight−12]`), which is the same end state the old `bottom`
animation produced, so the row stays tappable throughout.

## Hysteresis, and what still flips

`HIDE = 14` / `SHOW = 8` with a signed accumulator that zeroes on a direction change,
plus a `setDockHidden` no-op guard and `accum = 0` after every state change. A
sustained downward gesture therefore produces exactly one state change no matter how
long it runs, and the measured −11px clamp that used to reverse the state now sits
below `HIDE` and is wiped by the direction reset.

`NOISE = 1` rather than the brief's "~<8px" is a different mechanism reaching the same
place: an isolated sub-threshold move changes nothing because it never reaches an
accumulator threshold, and a reversal discards what came before. At ±18px — above
both thresholds — the dock still follows the user 11 times per 11 reversals by
design, but each flip is now a clean transform with 1 distinct `scrollHeight` and 0
variable writes behind it, rather than a fight with the page's height.

The near-bottom force-show (`maxY − y < 72`) is what makes the reachability
requirement hold in both dock states: the reader lands at the true end of the page
with both bars shown, which is the state the reserve is sized for, and the measured
clearance from "Dodaj dla kogoś innego" to the composer's top edge is 77px at 320px
and 78px at 375/414px. Before the change the page's own maximum scroll depended on
the dock (1579px hidden vs 1677px shown at 375px), which is why that button used to
measure −17px of clearance mid-churn.

## The collapsed row

Everything that could submit, toggle or close is `visibility: hidden` +
`pointer-events: none` while collapsed, revealed by `body.quick-add-active`. That
takes all three out of the tab order *and* the accessibility tree, which is what
makes the previous iteration's keyboard wrinkle unreachable rather than discouraged:
you can no longer tab onto a control labelled "Dodaj opis (opcjonalnie)", have the
focus itself open the row, and then collapse it with the first Enter. The spec's
probe order matters — the three controls are `.focus()`-tested *before* anything
touches the name field, because touching the name field enters add mode.

The 48px and 52px columns stay reserved, so the name field's box does not move; the
decorative `.quick-add-cue` (`aria-hidden`, `pointer-events: none`, no tab stop)
takes over the chevron's cell. The visible `+` glyph in the collapsed row is this
cue, not a control: the submit button that the task asked to remove is gone, and the
cue sits in the left-hand 48px cell rather than stacked on the dock's own green
"Dodaj" tab, which is the duplication the user reported (measured 1px of horizontal
centre offset at 320px before).

The collapsed field is painted borderless and transparent so the row reads as one
surface, keyed on `body.quick-add-active` and not on `.is-expanded` — a user who
collapses the details row while add mode is on still needs a real-looking input.
`quickAddPresent()` gets a guard at the top so an implicit submission from the
collapsed row opens the composer instead of posting a preserved draft, which closes
the one path that could have added a present with no visible submit control.

## `--quick-add-reserve` and the entry-time floor

The floor is `reserve = Date.now() < reserveFloorUntil ? Math.max(live, reserve) : live`,
which only settles on the true value because the form's `ResizeObserver` re-runs
`updateComposerLayout()` as the row grows 70→215px: the reserve climbs to 227px
inside the 320ms window and never dips. Without that observer the entry-time read
would stick at the collapsed value. Exit is deliberately not floored, so the 47px
shrink keeps its existing 0.25s settle.

The fallback is preserved exactly: `calc(var(--quick-add-reserve, 172px) + 20px)` is
192px, the same as the old `calc(var(--quick-add-bottom, 100px) + var(--quick-add-h, 72px) + 20px)`.
`--quick-add-h` has no remaining reference anywhere in `public/`.

Accepted and documented: while the pair is transform-hidden mid-scroll there are up
to 98px of reserved blank below the content. That is the price of a padding that does
not move, and the near-bottom force-show means the reader never settles on it.

## Precedence and recovery

`exitAddMode()` early-returns when add mode is off, so the `resetDockAutoHide()` call
cannot fire on every layout recomputation — including the `exitAddMode('undocked')`
path that runs whenever the composer is not docked. The dock is `visibility: hidden`
+ `inert` + `aria-hidden="true"` while add mode is on, and all three are restored on
exit. Scrolling 8 notches down and 8 up inside add mode produced 0 dock state
changes, 0 dock attribute mutations and 0 variable writes; exiting with the last
motion downward left the dock visible, untransformed, non-inert and with
`dock-hidden` absent, from a preserved mid-page scroll position.

Reduced motion is covered in both files: the shared CSS gains
`@media (prefers-reduced-motion: reduce) { .bottom-tab-bar { transition: none; } }`
for the other seven pages, and `formularz.html`'s existing `!important` group picks
up both new composer transform selectors. `test.use({ reducedMotion })` did not reach
the page through this project's fixture, so the spec calls `emulateMedia` explicitly
and asserts the emulation landed before asserting the behaviour.

The safe-area inset survives because both new helpers derive from
`getComputedStyle(bar).bottom`, which is `max(12px, env(safe-area-inset-bottom))`,
and `keyboardOffset()` plus the `visualViewport` listeners are untouched.

## Test coverage

`tests/e2e/composer.spec.js` exists (50KB, 20 tests across four `describe` blocks),
`composer.placeholder.spec.js` is deleted, and `node --check` passes on the spec and
both changed JS files. The spec covers the two behaviours this task fixed with
per-frame sampling — entry from a scroll-hidden dock, and the hide-as-one-unit
geometry — plus the eleven the placeholder reserved, the precedence and recovery
paths, reachability at max scroll, reduced motion, desktop at 1024px and the shared
dock on home and recipients, with measured numbers in the failure messages.

Not tested: no real WebKit/iOS engine, and no momentum scrolling (Chromium's
`Input.synthesizeScrollGesture` no-ops in this harness), so the iOS paths are
simulated in the shape iOS produces. The fix removes the mid-gesture `scrollHeight`
change that momentum would amplify rather than depending on momentum behaviour, so
the residual risk is narrow. Also not tested as a live mechanism: hide-on-scroll on
`recipients.html`, where `tab-bar-functions.js` loads before the dock markup, so the
IIFE finds no dock and returns — pre-existing, and the spec pins it by probing
`typeof window.resetDockAutoHide`. On `formularz.html` the order is the other way
round (markup at 1567, script at 1673), so the mechanism under review is live on the
page it targets.

## Unrelated changes in the tree

The working tree carries a concurrent XSS workflow's changes (`public/escape-html.js`,
`home.html`, `leaderboard.html`, `activity.html`, `recipients.html` handler
rewrites, `notification-text.js`, `filters.js`, `recipients.js`, `osoby.html`,
`intro.html`, `server.js`, the `styles-clean.css` / `styles.purged.css` deletions)
plus the e2e harness workflow's `tests/`, `playwright.config.js`, `package.json` and
`.gitignore`. On the eight bumped pages this task's edits are confined to the two
`?v=` lines, which is verifiable line by line in the diff. Nothing in this task's
file set touches `public/sw.js`, `app-theme.css`, `chat-reactions.*`,
`pluralize-pl.js` or any other file under `tests/`.

</details>

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `public/tab-bar-functions.js` | `initTabBarAutoHide()` rewritten around `body.dock-hidden`: no-op guard, signed accumulator with `HIDE`/`SHOW`/`NOISE`, near-bottom force-show, add-mode early return, `window.resetDockAutoHide` export, precedence comment |
| `public/bottom-tab-bar.css` | `.bottom-tab-bar.tab-bar-hidden` → `body.dock-hidden .bottom-tab-bar` with `translateY(var(--dock-hide-shift, calc(100% + 28px)))`; shared reduced-motion rule |
| `public/formularz.js` | `dockFloor()`/`dockRestOffset()` replace the visibility read; `watchBar()` deleted; `--dock-hide-shift` and `--quick-add-reserve` written at layout time with an entry-time floor; `syncPlaceholder()`; row-wide `click` → add mode; collapsed-submit guard; `dock-hidden` cleared on entry and `resetDockAutoHide()` on exit; `descDismissed` / `togglePointerDown` / `markTogglePointer` / `keepDesc` / `fromTogglePointer` deleted |
| `public/formularz.html` | composer gains the hide transform and the matched add-mode transition; collapsed `visibility: hidden` for submit/chevron/close with columns reserved; new `.quick-add-cue` (markup + CSS, `display: none` on desktop); transparent collapsed field; `--quick-add-reserve` padding; precedence and reduced-motion updates; hint reverted to HEAD's wording; `?v=` bumps |
| `public/{activity,home,leaderboard,recipients,rezerwacje,ustawienia,wiadomosci}.html` | `bottom-tab-bar.css?v=42` + `tab-bar-functions.js?v=18` only |
| `tests/e2e/composer.spec.js` | new, 20 tests with an inline per-frame sampler; replaces the deleted `composer.placeholder.spec.js` |

Full diff: `git -P diff -- public/formularz.html public/formularz.js public/tab-bar-functions.js public/bottom-tab-bar.css`

</details>
