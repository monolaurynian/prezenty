# Composer v2 — verification (iteration 2)

Two things were asked for: a collapsed add-present bar without its redundant
`+`, and an end to the composer/dock scroll fight. Both are in. This iteration
also answers every finding from `composer-v2-review.json`, including the
blocking one.

**The judder's root cause, named:** the page's reserved bottom padding was
derived from the dock's *live visibility*. `tabBarOffset()` read
`bar.classList.contains('tab-bar-hidden')`, a `MutationObserver` on the dock
re-ran `updateComposerLayout()` on every class write, `--quick-add-bottom`
changed, `body.has-tab-bar.quick-add-docked`'s `padding-bottom` animated, and
`document.scrollHeight` therefore moved **in the middle of a scroll gesture**.
The browser clamped `scrollY` to the new maximum, the clamp arrived at the
scroll handler as a ">8px scrolled up" delta, the handler showed the dock
again, and the loop re-armed. Measured on a 30 × 22px downward drag at 375px:
**14 distinct `scrollHeight` values and 15 distinct padding values before, 1
and 1 after**; **30 dock attribute mutations before, 0 after**; the
composer-to-dock gap **collapsing from 28px to 1.6px before (to −0.65px at
320px, i.e. the composer overlapped the dock), pinned at 28px for the whole
travel after**.

**The blocking finding, reproduced and fixed:** entering add mode while the
dock was scroll-hidden dropped `transform` from the add-mode transition list,
so the 98px hide transform was removed in one frame while `bottom` animated
110→12 from the un-transformed position. Measured on the exact path the review
named (scroll down, tap the bar): **98px of single-frame composer displacement
at 375px and 414px, 94px at 320px — now 0.01–0.02px.**

---

## 1. What changed, file by file

### `public/formularz.html` (page-local CSS + one span of markup)

| Selector / block | Change |
|---|---|
| `.quick-add-cue` (base, desktop) | new `display: none` — desktop has no collapsed state |
| `.quick-add-composer` (mobile) | `transition` is `bottom 0.25s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`; `grid-template-columns` removed from the list (nothing animates the grid any more) |
| `body.dock-hidden:not(.quick-add-active) .quick-add-composer` | `transform: translateY(var(--dock-hide-shift, 98px))` — the composer rides the dock's flag |
| `body.quick-add-active .quick-add-composer` | **`transition: bottom 0.25s ease, transform 0.25s ease`** (was `bottom` only) — the blocking fix |
| `body:not(.quick-add-active) .quick-add-composer` | `cursor: pointer` + `:active` tint — the row is the affordance |
| `.quick-add-toggle` | `visibility: hidden; pointer-events: none`, revealed by `body.quick-add-active .quick-add-toggle`; its 48px column stays reserved |
| `.quick-add-cue` (mobile) | new: decorative 48×48 circle in the chevron's grid cell, `pointer-events: none`, hidden by `body.quick-add-active .quick-add-cue` |
| `.quick-add-submit` | `visibility: hidden; pointer-events: none` + explicit `transition: visibility 0s, …`; its 52px column stays reserved (the column-collapsing rules from iteration 1 are gone) |
| `body:not(.quick-add-active) .quick-add-name .form-control` | new: transparent background/border so the collapsed field reads as prompt text, not an unfilled input |
| `body.has-tab-bar.quick-add-docked` | `padding-bottom: calc(var(--quick-add-reserve, 172px) + 20px)` (was the `--quick-add-bottom` + `--quick-add-h` pair) |
| `body.quick-add-active .bottom-tab-bar` | comment only: states the precedence rule |
| `@media (prefers-reduced-motion: reduce)` | both new composer transform rules added to the group |
| markup | `<span class="quick-add-cue" aria-hidden="true"><i class="fas fa-plus"></i></span>` before `#quickAddToggle`; details hint reverted to HEAD's `Szczegóły pomagają trafić 🎯` |

### `public/formularz.js`

- `quickAddPresent()` — guard at the top: docked and not in add mode opens the
  composer and posts nothing.
- `dockFloor()` / `dockRestOffset()` replace `tabBarOffset()`'s visibility
  read; the dock `MutationObserver` (`watchBar`) is gone.
- `--dock-hide-shift` written at layout time (`dockRestOffset() − dockFloor()`),
  removed when undocked.
- `--quick-add-reserve` replaces the `--quick-add-bottom` + `--quick-add-h`
  pair, with an entry-time floor (`reserveFloorUntil`, see §4).
- `syncPlaceholder(docked)` — `Dodaj prezent…` collapsed, `Nazwa prezentu…` in
  add mode and on desktop; called from `updateComposerLayout()`.
- row-wide `click` → `enterAddMode({ focus: true })`, guarded by `isAddMode()`
  and the 300ms `suppressEnterUntil` window.
- `dock-hidden` cleared on entry; `window.resetDockAutoHide()` on exit.
- **deleted**: `descDismissed`, `togglePointerDown`, `markTogglePointer`, the
  `pointerdown`/`mousedown` listeners, the `keepDesc` option and its branch,
  the `fromTogglePointer` branch in `focusin`.

### `public/tab-bar-functions.js` (shared, 8 pages)

`initTabBarAutoHide()` rewritten around **`body.dock-hidden`**: a no-op write
guard, a signed direction accumulator with `HIDE = 14px` / `SHOW = 8px` and
`NOISE = 1px`, a near-bottom force-show (`maxY − y < 72`), and
`window.resetDockAutoHide`. The handler reads only `window.scrollY`,
`window.innerWidth`, `document.documentElement.scrollHeight` and two body
classes — never the geometry of the dock or of anything that follows it.

### `public/bottom-tab-bar.css` (shared, 8 pages)

`.bottom-tab-bar.tab-bar-hidden` → `body.dock-hidden .bottom-tab-bar`, with
`transform: translateY(var(--dock-hide-shift, calc(100% + 28px)))`; plus a
shared `prefers-reduced-motion` rule. Pages that do not set the variable keep
today's travel byte for byte.

### `tests/e2e/composer.spec.js` (new, 20 tests) — replaces `composer.placeholder.spec.js`

Carries over all eleven behaviours the placeholder listed, plus the inline
per-frame sampler. `composer.placeholder.spec.js` is deleted (plan §2.4
granted write access to exactly this one file under `tests/`).

---

## 2. Requirement 2 — the scroll fight, before and after

Throwaway harness in `%TEMP%` (now deleted): three static copies of `public/`
behind a stubbed API — **before** = `git show HEAD:` of the four changed files,
**regression** = the working tree with only the add-mode `transform` transition
removed again, **after** = the working tree — driven in headless Edge with a
`requestAnimationFrame` sampler recording, per frame, both elements' rects, the
computed transform/bottom, `document.scrollHeight`, `body` padding and the two
body classes, plus MutationObservers counting `body` style writes and dock
attribute writes.

### One continuous gesture: 30 wheel notches of 22px, ~16ms apart

| | 320px before → after | 375px before → after | 414px before → after |
|---|---|---|---|
| distinct `document.scrollHeight` | **15 → 1** | **14 → 1** | **15 → 1** |
| distinct `body` `padding-bottom` | **16 → 1** | **15 → 1** | **16 → 1** |
| `--quick-add-bottom` writes | 1 → **0** | 1 → **0** | 1 → **0** |
| `.bottom-tab-bar` attribute mutations | **30 → 0** | **30 → 0** | **30 → 0** |
| dock state changes | 1 → 1 | 1 → 1 | 1 → 1 |
| scroll events (30 ticks sent) | 30 → 30 | 30 → 30 | 30 → 30 |
| composer→dock gap during travel | **−0.65…28px → 24…24px** | **1.59…28px → 28…28px** | **1.59…28px → 28…28px** |
| max single-frame step, composer / dock | 14.10 / 14.65 → **14.06 / 14.06** | 14.97 / 14.74 → **14.74 / 14.74** | 14.61 / 14.74 → **14.73 / 14.73** |
| composer travel | 94px → 94px | 98px → 98px | 98px → 98px |

The gap row is the "one unit" proof: before, the dock ran ahead of the composer
and the 28px between them closed to 1.6px (and at 320px went *negative* — the
composer overlapped the dock); after, the gap is constant and the two elements
move by the same number of pixels on the same frame (14.74 / 14.74).

### Hysteresis: alternating ±11px reversals, 12 of them

11px is above the old single `DELTA = 8` threshold and below the new
`HIDE = 14`, so this is exactly the judder case.

| | 320px | 375px | 414px |
|---|---|---|---|
| dock state changes, before | **11** | **11** | **11** |
| dock state changes, after | **1** | **1** | **1** |
| distinct `scrollHeight`, before | **26** | **39** | **23** |
| distinct `scrollHeight`, after | **1** | **1** | **1** |
| `--quick-add-bottom` writes, before → after | 11 → **0** | 11 → **0** | 11 → **0** |

The single remaining change is the dock coming *back* on the first upward
flick (`SHOW = 8` is deliberately easier to cross than `HIDE = 14`); after that
it stays put through all eleven reversals.

At ±18px — above both thresholds — the dock still follows the user (11 changes,
by design), but now with **1** distinct `scrollHeight` and **0** var writes, so
following the user no longer drags the page height along.

### Single-tick behaviour and reachability

- One 30px tick after a flick up: **exactly 1** dock state change, 1 distinct
  `scrollHeight`, and the dock completes its travel (`top ≥ innerHeight`).
  Asserted in the committed spec.
- At max scroll the near-bottom force-show keeps the dock **shown**: clearance
  from the "Dodaj dla kogoś innego" button to the composer's top edge is
  **77px at 320px, 78px at 375/414px**, and the last list item clears it too.
  Before the change, the page's maximum scroll itself depended on the dock:
  **1579px with the dock hidden vs 1677px after** at 375px — 98px of the page
  that only existed in one of the two states.

---

## 3. Requirement 1 — the collapsed bar

Measured on the real page (14-item list), all three states in one pass:

| | 320px | 375px | 414px |
|---|---|---|---|
| `#quickAddTitle` left / width, collapsed | 77 / 162 | 77 / 217 | 77 / 256 |
| …in add mode | **77 / 162** | **77 / 217** | **77 / 256** |
| …after closing | **77 / 162** | **77 / 217** | **77 / 256** |
| row height collapsed → add mode → back | 70 → 215 → 70 | 70 → 215 → 70 | 70 → 215 → 70 |
| composer offset from the bottom edge | 106 → 12 → 106 | 110 → 12 → 110 | 110 → 12 → 110 |
| `--quick-add-reserve` | 176 → 227 → 176 | 180 → 227 → 180 | 180 → 227 → 180 |
| `body` padding-bottom | 196 → 247 → 196 | 200 → 247 → 200 | 200 → 247 → 200 |
| `document.scrollHeight` | 2485 → 2536 → 2485 | 2427 → 2474 → 2427 | 2427 → 2474 → 2427 |

The name field's box is **identical in all three states** — that is the "no
layout jump" guarantee, and it is structural rather than animated: both hidden
controls keep their grid columns (48px cue/chevron, 52px submit), so nothing
depends on an engine interpolating `grid-template-columns`. That resolves review
finding 7 (WebKit/iOS does not interpolate it, so iteration 1's animated column
would have snapped 52px on the primary platform).

`scrollHeight` only ever **grows** on entry and returns on exit, so entry
cannot clamp the scroll position (see §4).

### The design

| Cell | Collapsed | Add mode |
|---|---|---|
| 48px | `.quick-add-cue`: decorative green circle with a `+`, `aria-hidden`, `pointer-events: none`, no tab stop | `#quickAddToggle` chevron |
| 1fr | `#quickAddTitle`, borderless and transparent, placeholder `Dodaj prezent…` | `#quickAddTitle`, normal field, placeholder `Nazwa prezentu…` |
| 52px | `#quickAddBtn` `visibility: hidden` (box reserved) | `#quickAddBtn` visible |
| head row | collapsed to 0 height | title `Dodaj nowy prezent` + `#quickAddClose` |

- **Effective target**: the whole row, 70px tall × 296px (320px) to 390px
  (414px) — far above 44px — entered by a `click` listener on `#quickAddForm`.
  Verified by real `tap()`s at three points: the cue, the middle of the row, and
  the empty cell where the `+` used to be. All three enter add mode with the
  caret in `#quickAddTitle` and the details row open.
- **Keyboard**: `#quickAddTitle` is the collapsed row's single tab stop;
  focusing it enters add mode through the same `focusin` path.
- **Accessible name**: the row sits in `<section aria-labelledby="quickAddHeading">`
  = "Dodaj nowy prezent", and the field is labelled "Nazwa prezentu". The cue is
  `aria-hidden` and the prompt now carries the call to action, which answers
  review finding 6 — iteration 1 had dropped both the cue and the prompt swap, so
  nothing in the collapsed row said what it did.
- **No `+`, ever, while collapsed**: `#quickAddBtn`, `#quickAddToggle` and
  `#quickAddClose` are all `visibility: hidden`, and all three are probed with
  `.focus()` **before** anything touches the name field — none of them takes
  focus. A preserved draft does not bring the `+` back (asserted after close,
  Escape and scrim exits), and an implicit `submit` dispatched on the collapsed
  form opens the composer and posts **nothing** (request count asserted at 0).

### Prompt wording

The plan proposed `Dodaj nowy prezent…`. Measured at 320px the collapsed field
has **130px** of inner room and that string needs **159.1px**, so it was clipped
mid-word ("Dodaj nowy preze") on the narrowest supported screen — visible in the
first capture of `composer-v2-320-collapsed.png`. `Dodaj prezent…` needs
**115.6px** and fits at every width. Same register (gender-neutral imperative,
sentence case) and it echoes the dock's own "Dodaj" tab. The committed spec now
asserts the prompt *fits*, not just its text, so this cannot regress.

### Chevron: removed from the collapsed state, kept in add mode

Review findings 4 and 5. Iteration 1 kept it in both states on an instruction
that is not in the task record; the brief and the plan both asked for it to go.
It is now `visibility: hidden` while collapsed, which takes it out of the tab
order **and** the accessibility tree, so the keyboard wrinkle finding 5
describes — tab onto a control labelled "Dodaj opis (opcjonalnie)", have the
focus itself open the details row, then have the first Enter collapse what you
were reaching for — is structurally unreachable rather than merely discouraged.
Keeping it in add mode is right: it is the only control that re-opens a manually
collapsed details row, and the earlier review approved it in that role.

With it unreachable from the compact bar, the coordination code the brief asked
to delete is genuinely dead and is gone: `togglePointerDown`,
`markTogglePointer`, the `pointerdown`/`mousedown` listeners, the `keepDesc`
option and its branch in `enterAddMode`, and the `fromTogglePointer` branch in
the `focusin` listener. Every chevron event now happens with add mode already
on, where `enterAddMode()` early-returns and never touches the row.
`focusDesc()` and its one-shot 260ms retry stay — the textarea still inherits
the row's in-flight `visibility` change when the chevron opens it.

`Select-String public\formularz.js -Pattern "descDismissed|togglePointerDown|keepDesc|markTogglePointer|fromTogglePointer"`
now returns one line: the comment that records where the rule lives.

### `descDismissed`

Deleted, not wired in. Making the flag drive the rule would contradict "details
open with the form": on a *fresh* entry the row must open, so a flag that
survived entry would be wrong. The rule — *a details row the user collapsed with
the chevron stays collapsed for the rest of this add-mode session* — now lives in
a comment at `enterAddMode()`'s `if (isAddMode()) … return true` early return,
naming its three supports: (a) that early return, (b) the deliberate absence of
any first-keystroke expand, (c) the chevron's `click` handler being the only
writer of `is-expanded` while add mode is on. Asserted end to end: collapse by
hand, type in the name field, the row stays collapsed; close and re-enter, the
row opens again with the draft intact.

---

## 4. The entry-time padding dip (found while verifying, fixed)

While writing the committed spec, the "no scroll jump on entry" test failed at
the one position the earlier evidence never covered — pinned to the very bottom
of the page. Sampled at 0/60/150/300/450ms on the real demo server at 375×750:
**`scrollY` 1045, 1045, 1040, 1036, 1036 — 9px of uninvited scroll.**

Cause: the reserve is `where the composer sits + how tall it is`. On entry
`bottom` drops 110→12 in a single write while the row's height grows 70→215 over
the 0.2s head/description transition, so a live reading of the pair is ~98px
short for the first few frames. That shrank `document.scrollHeight` and clamped a
bottom-pinned reader — up to 98px on a longer page.

Fix: the two values are now written as **one** variable, `--quick-add-reserve`,
and for 320ms after an entry it may only grow (`reserveFloorUntil`). Leaving add
mode is deliberately *not* floored — the 47px shrink there is existing,
documented behaviour with its own 0.25s padding transition. After the fix the
same measurement is **0px of drift**, and `scrollHeight` goes 2427 → 2474 → 2427
(up on entry, back on exit, never down mid-transition).

---

## 5. Precedence: add-mode hide vs hide-on-scroll

Enforced in JS, not by cascade order, and written as a comment in both files:

1. **`body.quick-add-active` wins absolutely.** Entering add mode removes
   `dock-hidden`; while it is set the scroll handler returns before reading or
   writing anything but its own seeds. It is the only mechanism that ever
   touches `visibility`, `inert` or `aria-hidden` on the dock.
2. **`body.dock-hidden` is transient** and only ever set while
   `quick-add-active` is off; it only ever affects `transform`, `opacity` and
   `pointer-events` — the same contract `.tab-bar-hidden` had on all 8 pages.
3. **Leaving add mode calls `window.resetDockAutoHide()`**, which re-seeds
   `lastY` from the current scroll position, zeroes the accumulator and leaves
   the dock **shown**, so the dock's state after an exit never depends on which
   way the user last scrolled. The `typeof` guard matters: a stale cached
   `tab-bar-functions.js?v=17` does not export it, and then nothing auto-hides
   anyway.

Measured: in add mode `body.dock-hidden` is absent, the dock is
`visibility: hidden` + `inert` + `aria-hidden="true"`; scrolling 8 notches down
and 8 up inside add mode produces **0** dock state changes, **0** dock attribute
mutations and **0** var writes; exiting with the last motion *downward* leaves
the dock `visibility: visible`, `transform: none`, `opacity: 1`, `inert: false`,
no `aria-hidden`, `dock-hidden` absent — from a mid-page scroll position that is
preserved (`scrollY > 0`).

The composer's two properties also had to be made to unwind together, which is
the blocking fix: on entry from a hidden dock, `bottom` animates 110→12 (moving
the box *down* 98px) while `translateY(98px)` animates to 0 (moving it *up* 98px).
Rendered offset = `bottom − translateY` = 12px at every instant **only** while
both use the same duration and the same easing; with different progress curves
the residual is `98 × (p₂ − p₁)`. Measured per frame on that exact path:

| | 320px | 375px | 414px |
|---|---|---|---|
| max single-frame composer displacement, `transform` dropped from the transition (iteration 1) | **94px** | **98px** | **98px** |
| …after the fix | **0.01px** | **0.02px** | **0.01px** |
| rendered offset range during entry, after | 11.99…12 | 11.98…12 | 11.99…12 |

A mid-flight frame of the shared hide, captured and measured together:
`composerTransform` and `dockTransform` both `matrix(1, 0, 0, 1, 0, 59.0097)`,
gap exactly `28px` — that is `composer-v2-375-scrolled.png`.

**Reduced motion**: `page.emulateMedia({ reducedMotion: 'reduce' })` →
`matchMedia` confirms the emulation, both elements compute `transition: none`,
and 60ms after the flag lands the pair is fully translated (composer offset
≤ 14px, dock `top ≥ innerHeight`); entry from the hidden state lands instantly
at `transform: none` with the offset ≤ 14px, i.e. no jump on the reduced-motion
path either. (Note: `test.use({ reducedMotion })` did **not** reach the page
through this project's context fixture — `matchMedia` stayed false — so the spec
calls `emulateMedia` explicitly and asserts it.)

`env(safe-area-inset-bottom)` is untouched: `dockFloor()` and
`dockRestOffset()` both derive from `getComputedStyle(bar).bottom`, which is
`max(12px, env(safe-area-inset-bottom))`. The `visualViewport` resize/scroll
listeners and `keyboardOffset()` are untouched.

---

## 6. Desktop (≥769px): unchanged, by construction

Every new rule lives inside `@media (max-width: 768px)`, and `.quick-add-cue`
gets `display: none` in the base block. Measured at 1024×800:
`quick-add-docked: false`, clicking the card does **not** enter add mode (the
row-wide listener bails in `refreshDocked()`), `.quick-add-cue`,
`#quickAddToggle` and `#quickAddClose` are all `display: none`, `#quickAddBtn`
is visible and labelled, the scrim is `display: none`, the dock is
`display: none`, `--dock-hide-shift` is unset, and the name field's box is
369/581 in every state. `composer-v2-1024.png` shows the inline card exactly as
it shipped. The 769–991px band is covered by the same media-query boundary.

---

## 7. Cache-busters

No shared file changed in this iteration beyond what iteration 1 already bumped,
so the table is unchanged and verified again across all pages:

| File | From | To | Pages (8) |
|---|---|---|---|
| `tab-bar-functions.js` | `?v=17` | `?v=18` | activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci |
| `bottom-tab-bar.css` | `?v=41` | `?v=42` | activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci |
| `formularz.js` | `?v=20` | `?v=21` | formularz (1 occurrence) |

`app-theme.css` stays at `?v=14` on all 10 pages — nothing in this change
touches it. No `?v=17`, `?v=41` or `?v=20` reference remains. `archiwum.html`
and `osoby.html` load neither shared file; `tab-bar-demo.html` loads an
unversioned copy and was left alone.

**Still to do by the orchestrator:** `public/sw.js` `CACHE_NAME` is still
`prezenty-v121`. The three `?v=` bumps are correct, but the cached *HTML* that
references them does not rotate until the cache name does. `public/sw.js` is on
this task's do-not-edit list (review finding 9 — acknowledged, not actionable
here).

Structural check after every edit: `public/formularz.html` has 3 `<style>`/
`</style>` pairs with balanced braces (2/2, 65/65, 76/76), 7 `<script>`/
`</script>` pairs, 12 `<link>` tags with the head block intact, 6 `<form>`/
`</form>` pairs. `node --check` passes on `public/formularz.js`,
`public/tab-bar-functions.js` and `tests/e2e/composer.spec.js`. All three edited
files are UTF-8 with no BOM and no replacement characters.

---

## 8. Test evidence

### The committed spec: `tests/e2e/composer.spec.js`, 20 tests, all green

Review finding 2. The spec replaces `composer.placeholder.spec.js` (deleted) and
covers all eleven behaviours it listed, plus the two this task fixed. It uses the
project's own fixtures and helpers (`sampleScrollY`, `activeDescription`,
`collectOverflow`) and keeps the per-frame sampler inline, as plan §2.4 requires.

1. the collapsed bar has no `+` and no chevron, and neither is reachable (320/375/414)
2. entering and leaving add mode moves the name field by 0px (320/375/414)
3. a tap anywhere on the collapsed row opens the form and focuses the name field
4. **entering add mode from a scroll-hidden dock does not move the composer** (320/375/414)
5. **the composer and the dock hide as one unit, with no padding or scrollHeight churn** (320/375/414)
6. one downward tick after a flick up changes the dock state exactly once
7. hide-on-scroll is inert during add mode and recovers on exit from any scroll position
8. entering add mode does not move the scroll position, including at the very bottom
9. the last present and "Dodaj dla kogoś innego" stay reachable with the dock shown and hidden
10. details open with the form, not on the first keystroke, and survive a manual collapse
11. no exit path clears typed text, and the collapsed bar cannot submit it
12. Enter and Ctrl+Enter add the present, then the composer blurs, collapses and the dock returns
13. the dock's "Dodaj" tab opens the composer and focuses the name field
14. the scrim tones the list down behind the open form, and is inert
15. the edit sheet's "Dodatkowe informacje" box is tall by default here too
16. no horizontal overflow at 320px, collapsed or open
17. reduced motion: the composer and the dock change state instantly
18. desktop at 1024px: the inline card is unchanged
19./20. the shared dock on home and recipients

Every failure message quotes the numbers it measured.

### Suite results

- **Baseline, before any edit in this iteration**: `npm run test:e2e` →
  **74 passed, 3 failed, 23 skipped** (4.4m). The three failures belonged to a
  concurrent workflow: `escaping.spec.js:110` (leaderboard XSS sink) and two
  `osoby` failures caused by a `SyntaxError: Unexpected identifier 'presents'`
  on that page.
- **After**: `npm run test:e2e` → **113 passed, 0 failed, 11 skipped** (8.9m).
  The composer spec's 20 tests are green inside the full run; the three baseline
  failures were fixed by that other workflow while this one was in flight, and
  its new specs (`xss-usernames.spec.js`) are included in the 113.
- `npm run test:e2e -- composer` → 20/20 green, run twice end to end, plus
  `--repeat-each=3` on the heaviest scroll test.

**One honest caveat, now fixed**: test 5 ("hide as one unit") failed twice in
runs where the machine was stalled (leftover Playwright/Edge processes from
interrupted turns plus OneDrive sync). Both failures were the same thing, and not
an assertion: `Test timeout of 30000ms exceeded` inside `page.goto`, because the
test walks three phone widths with a fresh page load each (~12s quiet, ~33s
stalled). That was a spec problem, so the composer `describe` now sets
`testInfo.setTimeout(90000)` in a `beforeEach`. After stopping the stray
processes and adding that, the composer spec ran **20/20 green** (2.6m), and the
five scroll-geometry assertions it makes were never the thing that failed.
The final full-suite number in the list above (113 passed / 0 failed / 11
skipped) was taken before this timeout change, which touches only the spec.

### Screenshots

In `.agents/tasks/screenshots/`, all captured from the final working tree at
`deviceScaleFactor: 2` over the page's real photo background, and all looked at:

| File | What it shows |
|---|---|
| `composer-v2-375-collapsed.png` | the new compact bar: green `+` cue, `Dodaj prezent…`, no submit, no chevron, the dock's own green **Dodaj** tab 28px below it |
| `composer-v2-375-addmode.png` | add mode: title + close, chevron, focused name field, the `Szczegóły pomagają trafić 🎯` hint, description box, green `+`, dock gone, page dimmed |
| `composer-v2-375-scrolled.png` | mid-hide, measured at the moment of capture: both transforms `translateY(59.0097px)`, gap exactly 28px, the dock fading out below the composer with no gap opening |
| `composer-v2-320-collapsed.png` | the narrowest screen: the prompt fits, nothing clipped |
| `composer-v2-1024.png` | desktop: the inline card, visible labelled **+ Dodaj**, no cue, no chevron, no dock |

Review finding 3 is answered: these were re-captured *after* the last edit to
`public/formularz.html`, and the add-mode shot shows the hint string that is
actually in the file (HEAD's wording — see §9).

The `%TEMP%` harness (three static trees, the static/stubbed server, the
samplers, `results.json`) has been deleted.

---

## 9. Decisions, trade-offs and things deliberately not done

- **Bundled copy change reverted** (review finding 8). Iteration 1 had changed
  the details hint from `Szczegóły pomagają trafić 🎯` to `Szczegóły ułatwią
  zakupy 🎯`, which neither requirement asked for. It is back to HEAD's wording.
- **Up to 98px of reserved blank below the content while the pair is
  transform-hidden mid-scroll.** Accepted: the padding is sized for the
  dock-shown state and never changes while scrolling, which is what closes the
  loop, and the near-bottom force-show means the reader never *lands* on it.
- **The 47px padding shrink when leaving add mode** keeps its documented 0.25s
  settle. Unchanged behaviour, deliberately not floored.
- **The transient scroll hide still leaves the dock tabbable** while off screen
  (`transform`/`opacity`/`pointer-events` only). Unchanged, and shared with the
  other seven pages; only the deliberate add-mode hide takes the dock out of the
  tab order and the a11y tree.
- **Hide-on-scroll has never been active on `recipients.html`**:
  `tab-bar-functions.js` is loaded at line ~2449, *before* the
  `.bottom-tab-bar` markup at ~2452, so `initTabBarAutoHide()` finds no dock and
  returns. Pre-existing, untouched, and now asserted as such — the spec probes
  `typeof window.resetDockAutoHide` (only exported past that early return) and
  requires a dock that never moves on such a page. Home, which has the dock in
  the document before the script, hides and returns with ≤2 state changes, 1
  distinct `scrollHeight` and no `--dock-hide-shift`.
- **The empty-state copy was left alone.** `public/formularz.js`'s "Nie masz
  jeszcze żadnych prezentów" panel says *Wpisz nazwę prezentu w polu „Nazwa
  prezentu…"*, which is still exactly right on desktop but names the add-mode
  placeholder rather than the mobile collapsed prompt. Rewriting shipped copy is
  outside both requirements, the sentence still tells the user what to do, and
  the row it refers to is directly below it; flagged here rather than changed.
- **`public/sw.js`, `chat-reactions.*`, `notification-text.js`,
  `pluralize-pl.js`, `server.js`, `app-theme.css`** not touched. Nothing under
  `tests/` other than `composer.spec.js` (added) and
  `composer.placeholder.spec.js` (deleted); `playwright.config.js`,
  `package.json` and `.gitignore` untouched.
- Nothing is committed; everything is left in the working tree. The tree also
  carries unrelated in-flight changes from a concurrent workflow
  (`public/filters.js`, `home.html`, `intro.html`, `leaderboard.html`,
  `osoby.html`, `recipients.js`, `notification-text.js`, `escape-html.js`,
  `server.js`, deletions of `styles-clean.css` / `styles.purged.css`), left
  exactly as found.
