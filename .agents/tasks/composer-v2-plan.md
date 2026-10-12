# Composer v2: simplify the collapsed add bar + fix the composer/dock scroll fight

Target: the mobile (`max-width: 768px`) quick-add composer on
`public/formularz.html` → `#editTab` ("Dodaj i edytuj moje prezenty"), plus the
shared hide-on-scroll dock.

Everything in §0–§3 was measured in a throwaway Playwright/Edge harness against
the **real** `public/` tree (API stubs only), at 320 / 375 / 414 × 750,
`isMobile`/`hasTouch`, sampling every animation frame. Numbers quoted below are
from that run; the harness lived in `%TEMP%\prezenty-composer2` and is deleted.

---

## 0. The current hide-on-scroll mechanism, exactly as it ships

| Question | Answer |
|---|---|
| Which file | `public/tab-bar-functions.js`, the `initTabBarAutoHide()` IIFE (lines ~437–470). Runs at parse time on every page that loads the script. |
| Which element | `document.querySelector('.bottom-tab-bar')` — the class `tab-bar-hidden` is added/removed on **the bar itself**. |
| Which events | one listener: `window.addEventListener('scroll', onScroll, { passive: true })`. No resize, no touch, no visualViewport. |
| Throttling | rAF-throttled already (`ticking` flag, work inside `requestAnimationFrame`). |
| Thresholds | a single `DELTA = 8`. `diff = scrollY - lastY`; `diff > 8` → hide, `diff < -8` → show. `lastY` only advances when `Math.abs(diff) > 8`. |
| Force-show rules | `window.innerWidth >= 992`, an open menu/notifications panel, or `scrollY < 40`. **No near-bottom rule.** |
| Animated property | `public/bottom-tab-bar.css:26` `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;` and `:29` `.bottom-tab-bar.tab-bar-hidden { transform: translateY(calc(100% + 28px)); opacity: 0; pointer-events: none; }`. So the **dock** is transform-animated — it is not the layout offender. |
| Does anything measure the other element? | **Yes.** `public/formularz.js:754 tabBarOffset()` reads the dock's live geometry — `getComputedStyle(bar).bottom`, `bar.offsetHeight`, `getComputedStyle(fab).top`, and crucially `bar.classList.contains('tab-bar-hidden')` (line 767) — and `public/formularz.js:809 watchBar()` wires a `MutationObserver` on the bar's `class`/`style` attributes that calls `updateComposerLayout()`. |
| Hysteresis | none. One threshold for both directions. |
| No-op guard | none. `onScroll` calls `classList.add`/`remove` on **every** rAF tick; `DOMTokenList` re-serialises the attribute even when the token set does not change, so the attribute mutates once per scroll event. Measured: `dockAttrMutations == scrollEvents` exactly (23/23, 30/30), with the state already correct in 28 of 30 cases. |

Resting geometry (measured, compact state):

| | 320px | 375px | 414px |
|---|---|---|---|
| dock height / bottom inset / FAB poke | 70 / 12 / 16 | 70 / 12 / 20 | 70 / 12 / 20 |
| `--quick-add-bottom` (composer rest) | 106px | 110px | 110px |
| `--quick-add-h` (composer height) | 70px | 70px | 70px |
| `body` padding-bottom | 196px | 200px | 200px |
| composer `transition` | `bottom 0.25s` | `bottom 0.25s` | `bottom 0.25s` |
| `body` transition | `padding-bottom 0.25s` | same | same |

---

## 1. Named measured root cause

### **The padding/scroll-height clamp loop**

The composer's reserved bottom padding is derived from the dock's *current*
visibility, so hiding the dock shrinks `document.scrollHeight` mid-gesture; near
the bottom the browser clamps `scrollY` to the new maximum; that clamp arrives as
an unrequested `scroll` event with a negative delta larger than the handler's
single 8px threshold, which the handler reads as "the user scrolled up" and
answers by showing the dock again — which grows the padding back and re-arms the
loop.

The chain, with the file and line that closes each link:

1. `tab-bar-functions.js` `onScroll` adds `.tab-bar-hidden` on a >8px downward delta.
2. `formularz.js:809 watchBar()` — `MutationObserver` on the bar's `class`/`style` — fires and calls `updateComposerLayout()`. Because the handler re-writes the attribute every tick, this runs **once per scroll event**, each time forcing a synchronous style/layout read (`bar.offsetHeight`, three `getComputedStyle` calls, `form.offsetHeight`) from inside a MutationObserver microtask.
3. `formularz.js:767` — `if (bar.classList.contains('tab-bar-hidden')) return Math.max(inset, 12);` — so `tabBarOffset()` drops from 110 to 12.
4. `formularz.js:791–793` writes `--quick-add-bottom: 12px` on `body` and the form. The composer animates `bottom` 110px→12px (a **layout**-animated property, `0.25s ease`) while the dock animates `transform` (`0.3s cubic-bezier`): different property, different duration, different easing.
5. `formularz.html:897` `body.has-tab-bar.quick-add-docked { padding-bottom: calc(var(--quick-add-bottom) + var(--quick-add-h) + 20px); transition: padding-bottom 0.25s ease; }` → `scrollHeight` **animates** 1347 → 1249 over ~250ms.
6. `maxScroll` shrinks with it (597 → 499). Any `scrollY` inside that 98px band is clamped downward in ~5 steps.
7. One of those steps exceeds `DELTA = 8` → `onScroll` removes `.tab-bar-hidden` → back to step 2 in the opposite direction.

### The numbers that prove it

**Decisive single-input run** (375×750, settled at the bottom, dock visible,
`scrollY` 502 / `maxScroll` 597 / padding 200px; then **one** 30px wheel tick and
no further input for 3s):

| t (ms) | scrollY | scrollHeight | maxScroll | padding | `.tab-bar-hidden` | dock top | composer top | composer `bottom` |
|---|---|---|---|---|---|---|---|---|
| 23 | 532 | 1347 | 597 | 200 | false | 668 | 570 | 110px |
| 56 | 532 | 1347 | 597 | 200 | **true** | 668 | 570 | 110px → var written 12px |
| 109 | 532 | 1318 | 568 | 171.1 | true | 676.3 | 598.9 | 81.1px |
| 141 | 532 | 1290 | 540 | 143.5 | true | 698.2 | 626.5 | 53.5px |
| 158 | **530** | 1280 | 530 | 133.1 | true | 712.8 | 636.9 | 43.1px |
| 173 | **521** | 1271 | 521 | 124.8 | true | 725.9 | 645.2 | 34.8px |
| 207 | 521 | 1289 | 539 | 142.6 | **false** | 719.2 | 627.5 | var written back 110px |
| 375 | 521 | 1347 | 597 | 200 | false | 668 | 570 | 110px |

- `scrollEvents = 3` for **one** user input: the wheel, plus two clamp events the page generated itself (532 → 530 → 521).
- `hideShowFlips = 2`; the second flip is caused purely by the −11px clamp. The user never scrolled up.
- `bodyVarWrites = 2`; the composer travels **75px down and 75px back up** for one 30px flick.
- `scrollHeight` takes **16 distinct values** between 1271 and 1347 inside those 3 seconds.
- The dock **never finishes hiding**: its top only reaches 725.9 of the 766 it needs, then reverses — measured, and exactly the reported "the tap bar can't hide properly".
- Same result at 320px (2 flips, 73px scrollHeight churn, 72px composer travel) and 414px (2 flips, 76px churn, 75px travel).

**Isolation (the control that names the cause).** Same page, same gesture, with
only `body.has-tab-bar.quick-add-docked { padding-bottom: 260px !important; transition: none !important }`
injected so `scrollHeight` cannot move:

| variant | scrollEvents | hide/show flips | var writes | distinct scrollHeight | composer travel |
|---|---|---|---|---|---|
| as shipped | 3 | **2** | 2 | **16** | **75px** |
| padding pinned | 0 | **0** | 0 | **1** | **0px** |

Pinning the composer's `bottom` while leaving the padding alive changed nothing
(2 flips, 15 scrollHeight values) — so the `bottom` animation is an aggravator,
not the cause. Pinning the padding alone removes the loop entirely.

**Continuous-gesture run** (375px, 12 alternating ±wheel ticks over ~1.1s at the
bottom): **6 hide/show flips, 12 `--quick-add-bottom` writes**, `scrollHeight`
oscillating 1347 ↔ 1303, the composer wobbling between top 570 and 613 while the
dock only ever manages 668 → 685 of its 98px travel. That is the judder.

**Gap proof** (the two elements visibly separate): at rest the composer's bottom
edge sits 28px above the dock's top edge. 215ms into a hide, measured composer
bottom 683.9 vs dock top 685.4 — a **1.5px** gap; they nearly collide because the
composer (0.25s ease, `bottom`) outruns the dock (0.3s cubic-bezier, `transform`).

### Secondary findings (fix them, but they are not the root cause)

- **S1 — attribute churn.** The class is re-written every scroll tick, so
  `updateComposerLayout()` and its forced layout read run once per scroll event
  even when nothing changed. With the dock's class artificially held at "visible"
  the coupling is laid bare: **53 dock mutations → 52 `--quick-add-bottom` writes**
  in one 1.5s gesture.
- **S2 — no precedence between the two hiding mechanisms.** Scrolling *inside* add
  mode produced **26 `tab-bar-hidden` mutations**, ending with the class
  **removed** (`hidClass: false`) while `visibility: hidden` + `inert` +
  `aria-hidden` were still applied by add mode. The dock's post-exit state
  therefore depends on which way the user last scrolled while the dock was
  deliberately hidden.
- **S3 — the bottom of the page is hard to reach.** `window.scrollTo(0, scrollHeight)`
  settles at `scrollY` 502 against `maxScroll` 597 (95px short), because the
  arrival itself triggers the loop and the clamp pulls the reader back.
  Mid-churn the "Dodaj dla kogoś innego" button measured **−17px** of clearance
  (partly behind the composer).
- **S4 — `.quick-add-submit` inherits `transition: all 0.3s ease` from `.btn-green`**
  (computed `transition: 0.3s`). `visibility` is a transitionable discrete
  property, so a `visibility` flip on that button lags ~150ms+. Measured:
  50ms after the rule applied the button was still `visible`; by 200ms it was
  `hidden`. Relevant to Requirement 1, which hides it in the collapsed state.

---

## 2. Decisions

### 2.1 Requirement 1 — the collapsed bar

**Confirmed the premise.** In the collapsed state focusing `#quickAddTitle` enters
add mode (`focusin` → `enterAddMode`, `formularz.js:701`) and typing enters add
mode (`input` → `onComposerInput`, `formularz.js:709`). So the only way to have
text in the field while collapsed is a *preserved draft* after a close — so the
collapsed `+` is a submit control that normally cannot submit anything.

It is also almost perfectly stacked on top of the dock's own green **Dodaj** tab,
measured against the real server:

| | collapsed `+` (centre x / bottom) | dock **Dodaj** tab (centre x / top) | centre offset | vertical gap |
|---|---|---|---|---|
| 320px | 273 / 637 | 274 / 679 | **1px** | 42px |
| 375px | 328 / 633 | 322 / 679 | **6px** | 46px |

Two green "add" affordances on the same vertical line, 42–46px apart, one of which
does nothing. Removing it from the collapsed state is right.

**Design.** Keep the existing mobile grid `48px | minmax(0,1fr) | 52px` and all
existing children in place; swap which of them are *visible*:

| Cell | Collapsed | Add mode |
|---|---|---|
| `toggle` (48px) | new decorative `.quick-add-cue` (green circle + `+`, `aria-hidden`, `pointer-events: none`) | `#quickAddToggle` chevron |
| `name` (1fr) | `#quickAddTitle`, borderless/transparent, placeholder `Dodaj nowy prezent…` | `#quickAddTitle`, normal field, placeholder `Nazwa prezentu…` |
| `submit` (52px) | `#quickAddBtn` `visibility: hidden; pointer-events: none` (box reserved) | `#quickAddBtn` visible |
| `head` row | collapsed to 0 (unchanged) | title + `#quickAddClose` (unchanged) |

The whole row becomes the "start adding" affordance via a **`click` listener on
`#quickAddForm`** (no new focusable element, no `aria-hidden` button, no duplicate
accessible name): a click anywhere in the composer while collapsed and docked
calls `enterAddMode({ focus: true })`.

- Effective target: the full composer row, **351×70** at 375px / **296×70** at 320px — far over 44px.
- Keyboard-focusable: `#quickAddTitle` is the single tab stop in the collapsed row (label `Nazwa prezentu`, inside `<section aria-labelledby="quickAddHeading">` = "Dodaj nowy prezent"). Focusing it enters add mode, so keyboard and pointer reach the same state.
- Gender-neutral Polish, sentence case throughout: `Dodaj nowy prezent…`, `Nazwa prezentu…`, `Dodaj opis (opcjonalnie)` / `Ukryj opis`, `Zamknij formularz dodawania`.

**No layout jump — measured.** Because both hidden controls keep their grid cells,
`#quickAddTitle`'s box is byte-identical in both states:

| | 320px | 375px | 414px |
|---|---|---|---|
| input left / width, collapsed | 77 / 162 | 77 / 217 | 77 / 256 |
| input left / width, add mode | 77 / 162 | 77 / 217 | 77 / 256 |
| composer height collapsed → add mode → back | 70 → 215 → 70 | 70 → 215 → 70 | 70 → 215 → 70 |
| `body` padding collapsed → add mode → back | 196 → 247 → 196 | 200 → 247 → 200 | 200 → 247 → 200 |

`--quick-add-h` stays 70px in the collapsed state, so Requirement 1 changes the
page's `scrollHeight` by **0px**. The 70px→215px growth on entry is the form
opening and is unchanged from today.

**Chevron: removed from collapsed, kept in add mode.** Verified the reasoning in
the harness. With the chevron `visibility: hidden` in the collapsed row:
`#quickAddToggle.focus()` leaves `activeElement` elsewhere (measured) — it is out
of the tab order **and** the accessibility tree, so review finding 1 (tabbing onto
the chevron enters add mode, relabels the control to `Ukryj opis`, and the first
Enter collapses what the user was reaching for) is structurally impossible, and
finding 2 (a chevron press-and-cancel from the compact bar leaving add mode on
with details collapsed) cannot be reached at all. Keeping it in add mode is right:
it is the only control that re-opens a manually collapsed details row, the review
APPROVED it as a details-only toggle, and removing it there would change behaviour
the user has not asked about.

**`keepDesc` / `togglePointerDown` become dead — delete them.** Their entire
purpose was the race where a tap on the chevron *from the compact bar* fired
`focusin` → `enterAddMode` → which opened the details row *before* the chevron's
own `click` could decide. The chevron can no longer be pressed from the compact
bar, so every chevron event now happens with add mode already on, where
`enterAddMode()` early-returns at `formularz.js:554` and never touches the row.
Delete: `let togglePointerDown`, `markTogglePointer`, the `pointerdown` and
`mousedown` listeners, the `keepDesc` option and its branch in `enterAddMode`,
and the `fromTogglePointer` branch in the `focusin` listener. **Keep `focusDesc()`** —
the textarea still inherits the row's in-flight `visibility` change when the
chevron opens it in add mode, and the one-shot 260ms retry is still required.

**`descDismissed` (finding 3) — delete the flag.** Making it drive the rule would
be wrong: on a *fresh* entry the required behaviour is "details open with the
form", so a flag that survived entry would contradict that, and within a session
`enterAddMode`'s early return already makes the rule unconditional. The rule
"a manually collapsed details row stays collapsed for the rest of this add-mode
session" lives in exactly three places and must be documented there as a comment
at `enterAddMode`'s `if (isAddMode()) … return true` early return: (a) that early
return, (b) the absence of any first-keystroke expand, (c) the chevron's `click`
handler being the only writer of `is-expanded` while add mode is on.

**Preserved draft while collapsed.** The collapsed bar shows **no `+`**; the draft
stays visible as the (borderless) field's value, and a tap anywhere on the row
re-enters add mode with the text intact. No conditional `+`, so no layout shift.
One extra guard is needed: with a draft present, an implicit form submission
(Enter reaching the form, `enterkeyhint="send"`, or an AT "submit") could add the
draft straight from the collapsed bar, which contradicts "the collapsed bar can
never submit". `quickAddPresent()` gets a guard at the top: when docked and not in
add mode it opens the composer instead of posting.

**Desktop (≥769px): visibly unchanged, nothing applies.** The collapsed state does
not exist there — `.quick-add-toggle` and `.quick-add-close` are `display: none`,
the textarea is permanently visible and `#quickAddBtn` is the card's labelled
primary button. So every new rule goes **inside** `@media (max-width: 768px)`, and
`.quick-add-cue` gets `display: none` in the base (desktop) block. The new form
`click` handler is a no-op on desktop because `enterAddMode()` bails out of
`refreshDocked()`. Measured at 1024px and in the 769–991px gap: `docked: false`,
no add mode, dock untouched.

### 2.2 Requirement 2 — one source of truth, one unit, real hysteresis

**One source of truth: `body.dock-hidden`.** `tab-bar-functions.js` stops writing
`tab-bar-hidden` on the bar and writes a single class on `<body>` instead; the
shared CSS selector becomes `body.dock-hidden .bottom-tab-bar`. Neither element
reads the other's live geometry in a scroll handler any more — the scroll handler
touches only `window.scrollY`, `window.innerWidth`, `document.documentElement.scrollHeight`
and that one class. `formularz.js` loses the `tab-bar-hidden` read (line 767) and
the `watchBar()` MutationObserver (line 809), so `--quick-add-bottom`,
`--quick-add-h` and therefore the page's `padding-bottom` and `scrollHeight`
become **constant while scrolling**. That alone closes the loop.

Degradation if one of the two shared files is served stale from cache: old JS +
new CSS, or new JS + old CSS, both resolve to "the dock never auto-hides", which
is safe. The `?v=` bumps plus the final step's `sw.js` `CACHE_NAME` bump fix it.

**They move as ONE unit, by exactly the same number of pixels.** Both get
`transform: translateY(var(--dock-hide-shift, …))` with the **identical**
`0.3s cubic-bezier(0.4, 0, 0.2, 1)`. `formularz.js` sets `--dock-hide-shift` on
`<body>` to `dockRestOffset() − dockFloor`, i.e. exactly the distance from the
composer's resting offset down to the dock's own bottom inset: **94px at 320px,
98px at 375px and 414px** (measured). The dock takes the same value, so the 28px
gap between them is preserved for the whole travel and no gap can open. On the
other seven pages `--dock-hide-shift` is never set and the CSS fallback
`calc(100% + 28px)` keeps today's behaviour byte-for-byte. The composer keeps
`transition: bottom 0.25s ease` for the add-mode / on-screen-keyboard changes;
`bottom` and `transform` are driven by disjoint triggers, and the one overlap
(entering add mode while `dock-hidden`) is made instant by
`body.quick-add-active .quick-add-composer { transform: none; transition: bottom 0.25s ease; }`.

**Hysteresis, with an accumulator.** Keep the existing rAF throttle; replace the
single `DELTA = 8` with a direction accumulator and two thresholds:
`HIDE = 14px` of sustained downward travel, `SHOW = 8px` of upward travel, reset
on any direction change, and deltas under 1px ignored. The measured −11px clamp
that used to reverse the state is now below `HIDE` and, after the accumulator
reset, cannot flip anything. Add a **no-op guard** so the class is only written
when the state actually changes (kills S1).

**New force-show rule: near the bottom.** `maxScroll - scrollY < 72` forces the
dock (and the composer) visible, mirroring the existing `scrollY < 40`. Two
reasons: the reader lands at the true bottom with both bars shown, so the reserved
200px of padding is exactly right there and nothing is clipped; and it removes the
one scroll region where the clamp used to live. It is a position rule, not a delta
rule, and `scrollHeight` is now constant, so it cannot flap.

**Padding does not change with dock visibility.** `body.has-tab-bar.quick-add-docked`
keeps its existing `calc(var(--quick-add-bottom) + var(--quick-add-h) + 20px)`,
which is now sized for the **dock-shown** resting state (196px at 320px, 200px at
375/414px) and never recomputed by scrolling. Accepted consequence, to be measured
and reported: while the pair is transform-hidden mid-scroll there are up to 98px
of reserved blank below the content — but the near-bottom force-show means the
reader never *lands* on it. The compact ↔ add-mode padding change (200 ↔ 247px)
is unchanged and is not scroll-driven; entering grows it (cannot clamp) and the
47px shrink on leaving keeps its documented 0.25s settle.

**Precedence rule — write this as a comment in both files.**

> `body.quick-add-active` and `body.dock-hidden` are **mutually exclusive, enforced
> in JS, not by cascade order.**
> 1. `quick-add-active` (deliberate add-mode hide) wins absolutely. Entering add
>    mode removes `dock-hidden`; while it is set the scroll handler returns before
>    reading or writing anything (it only re-seeds `lastY`/`accum`). It is the only
>    mechanism that ever touches `visibility`, `inert` or `aria-hidden` on the dock.
> 2. `dock-hidden` (transient hide-on-scroll) is only ever set while
>    `quick-add-active` is off, and only ever affects `transform`, `opacity` and
>    `pointer-events` — matching today's `.tab-bar-hidden` contract on the other
>    seven pages, which is deliberately not changed here.
> 3. Leaving add mode calls `window.resetDockAutoHide()`, which re-seeds `lastY`
>    from the current scroll position, zeroes the accumulator and leaves the dock
>    **shown** — so the dock's state after an exit never depends on which way the
>    user last scrolled.

**Reduced motion.** `@media (prefers-reduced-motion: reduce) { .bottom-tab-bar { transition: none; } }`
is added to the shared CSS (it is the only file that defines the dock's travel for
the other seven pages). `formularz.html`'s existing reduced-motion group already
lists `.quick-add-composer` and `.bottom-tab-bar`; leave it in place and add the
new composer transform rules to it. `env(safe-area-inset-bottom)` is untouched —
`dockRestOffset()` still derives from `getComputedStyle(bar).bottom`, which is
`max(12px, env(safe-area-inset-bottom))`. The `visualViewport` resize/scroll
listeners and `keyboardOffset()` are untouched.

### 2.3 Cache-busters — exact page list

Both shared files change, so both bump on **all 8 pages that load them** (verified
by grep; `archiwum.html` and `osoby.html` load neither, `tab-bar-demo.html` loads
an unversioned copy and is a demo page — leave it alone):

| File | From | To | Pages and line numbers |
|---|---|---|---|
| `tab-bar-functions.js` | `?v=17` | `?v=18` | `activity.html:1037`, `formularz.html:1512`, `home.html:1501`, `leaderboard.html:1509`, `recipients.html:2442`, `rezerwacje.html:380`, `ustawienia.html:781`, `wiadomosci.html:840` |
| `bottom-tab-bar.css` | `?v=41` | `?v=42` | `activity.html:35`, `formularz.html:18`, `home.html:51`, `leaderboard.html:12`, `recipients.html:37`, `rezerwacje.html:22`, `ustawienia.html:22`, `wiadomosci.html:23` |
| `formularz.js` | `?v=20` | `?v=21` | `formularz.html:1505` (one occurrence) |

`app-theme.css?v=14` is **not** touched (nothing in this change needs it).
`public/sw.js` is **not** touched — the final step bumps `CACHE_NAME`.
`public/chat-reactions.js`, `chat-reactions.css`, `notification-text.js`,
`pluralize-pl.js` and `server.js` are not touched.

### 2.4 Verification runs through the project's real test suite

The repo now carries a committed Playwright suite — `npm test` → `npm run test:e2e`
→ `playwright test`, `playwright.config.js` + `tests/` — which boots **the real
`server.js` in demo mode** on a free port (`tests/global-setup.js` →
`tests/helpers/start-demo-server.js`), logs in once into `tests/.auth/demo.json`,
and drives the real pages through `channel: 'msedge'`. That is the project's real
test command and this task's primary gate.

It was built **for this work**: `tests/helpers/scroll.js` says in its own header
that it is "kept here for the composer/dock work that is still in flight", and
`.agents/tasks/e2e-harness-plan.md` item 15 reserves
`tests/e2e/composer.placeholder.spec.js` as a `test.fixme()` placeholder listing
behaviours (a)–(j) — including "(f) the collapsed bar has no redundant `+` button"
and "(h) the composer and the dock do not fight during scroll-hide (frame sampling
of both boxes, the 'jumpy' complaint)" — explicitly deferred to us. So this task
fills that placeholder in.

**Concurrency boundary.** That harness workflow declares `public/formularz.html`,
`public/formularz.js`, `public/tab-bar-functions.js`, `public/bottom-tab-bar.css`
and `public/app-theme.css` read-only for itself, and claims `tests/**`,
`playwright.config.js`, `package.json`, `.gitignore` and `DEMO_MODE`-only branches
in `server.js` for itself. Respect the mirror image: this task's **only** write
under `tests/` is the one spec file `tests/e2e/composer.spec.js` (replacing
`tests/e2e/composer.placeholder.spec.js` if it exists by then — delete the
placeholder in the same item). Do **not** touch any other file in `tests/`, nor
`playwright.config.js`, `package.json`, `.gitignore` or `server.js`. Put any new
sampler code **inline in the spec**, not in a new `tests/helpers/` file, so the two
workflows cannot collide in that namespace.

**Measured baseline of the suite as it stands (run before this plan was written):**
`npm run test:e2e` → **19 passed, 2 failed in ~1.3m**. Both failures are
pre-existing and belong to the harness workflow, not to this task:
`tests/e2e/helpers.spec.js:134` ("reports a mid-word break and accepts a space
break", a helper self-test) and `tests/e2e/smoke.spec.js:31` ("shared session is
authenticated", `/api/auth` returned `authenticated: false`). The gate for this
task is therefore **"no new failures, and the new composer spec green"** — not a
clean exit code. Re-run the baseline before starting so the comparison is honest,
and report both numbers.

**Two demo-mode facts the spec must handle** (both verified against the real server
at `/formularz`, 375×750, 9 demo presents, `quick-add-docked: true`,
`--quick-add-bottom: 110px`, body padding 200px, `scrollHeight` 1795 /
`maxScroll` 1045 — so the page scrolls plenty):

1. `GET /api/user/identification` returns `isIdentified: false, name: null` in
   `DEMO_MODE` (`server.js` ~1025), so `identifiedName` stays null and
   `quickAddPresent()` refuses with "Najpierw zidentyfikuj się…". Any test of the
   **add** path must `page.route('**/api/user/identification', …)` and fulfil with
   `{ isIdentified: true, name: 'Jan Nowak', identifiedRecipient: { id: 2, name: 'Jan Nowak' }, username: 'e2e', userId: 1 }`.
   Verified end to end: the add then succeeds with the `Prezent dodany! 🎁` pill,
   add mode off, fields cleared and focus on `#myPresentsHeading`.
2. `POST /api/formularz/present` in `DEMO_MODE` returns `{ success: true }` with no
   `presentId` and **does not persist** — the list re-fetches the same 9 items. So
   assert the success pill and the post-add state, **never** an item-count increase.

**The bug reproduces against the real server**, not just a static harness: one
continuous 30 × 22px downward gesture at 375×750 produced **30 dock attribute
mutations for 30 scroll events** and **12 distinct `scrollHeight` values**
(1795 → 1697, 98px of mid-gesture churn). Those are the "before" numbers the new
spec must drive to 1 distinct value and ≤ 2 state changes.

---

## 3. Edit discipline — mandatory for every item below

- Use **targeted `str_replace` edits only** on every existing file. Never rewrite a
  whole file and never do a full-offset write: a full write in this repo recently
  corrupted a `<link>` tag silently (`app-theme.css?v=14" rel="stylesheet">et">`).
  The single exception is the brand-new `tests/e2e/composer.spec.js`, which is
  created from scratch.
- After **every** HTML edit, re-read the edited region (±6 lines) and confirm the
  surrounding `<link>` / `<script>` / tag boundaries are intact.
- After the `?v=` bumps, re-run the audit and confirm 8 × `?v=18` and 8 × `?v=42`
  with no stray bare references:
  `Get-ChildItem public\*.html | ForEach-Object { $c=Get-Content $_.FullName -Raw; foreach($m in [regex]::Matches($c,'(tab-bar-functions\.js|bottom-tab-bar\.css|formularz\.js)(\?v=\d+)?')){ "{0} {1}" -f $_.Name, $m.Value } }`
- `node --check public/formularz.js` and `node --check public/tab-bar-functions.js`
  must exit 0 after every JS item.
- The project's real test command is **`npm run test:e2e`** (= `npm test` =
  `playwright test`, see §2.4). Record its pass/fail counts **before** item 1 as
  the baseline (expected: 19 passed / 2 failed), and re-run it after items 1–9 and
  again after item 10. "No new failures" is the gate.
- During items 1–9, for fast feedback, drive the same pages with a throwaway
  per-frame sampler in `%TEMP%` (outside the repo; delete it in item 12) pointed at
  the demo server from `npm run offline`. The committed spec from item 10 is the
  authoritative proof; the sampler is the inner loop.
- Only one file under `tests/` may be written: `tests/e2e/composer.spec.js` (§2.4).
- Do not commit, do not push.
- OneDrive: file reads occasionally fail with a cloud timeout / `UNKNOWN` error.
  Wait a few seconds and retry; never treat it as a missing file.

---

## Implementation Plan

- [ ] 1. Replace the dock's hide mechanism with one body-class source of truth.
      In `public/tab-bar-functions.js` rewrite the `initTabBarAutoHide()` IIFE
      (~lines 437–470): keep the rAF `ticking` throttle and the `.bottom-tab-bar`
      existence guard; add `function setDockHidden(flag)` that returns early when
      `document.body.classList.contains('dock-hidden') === flag` and otherwise
      toggles that one class (no writes to the bar at all); add
      `function reseed() { lastY = window.scrollY; accum = 0; setDockHidden(false); }`
      and export it as `window.resetDockAutoHide = reseed;`. Inside the rAF
      callback, in this order: (a) if `document.body.classList.contains('quick-add-active')`
      set `lastY = window.scrollY; accum = 0;` and return; (b) read `y = window.scrollY`,
      `maxY = document.documentElement.scrollHeight - window.innerHeight`,
      `diff = y - lastY`, then `lastY = y` (all reads before any write);
      (c) force-show (`accum = 0; setDockHidden(false); return;`) when
      `window.innerWidth >= 992`, a `.tab-bar-menu-panel.show, .tab-bar-notifications-panel.show`
      is open, `y < 40`, or `maxY - y < 72`; (d) ignore `Math.abs(diff) < 1`;
      (e) reset `accum` on a direction change, add `diff`, then
      `accum > 14 → setDockHidden(true)` / `accum < -8 → setDockHidden(false)`,
      zeroing `accum` on each state change. Call `reseed()` once at the end of the
      IIFE. Add the §2.2 precedence comment above the IIFE. Keep the `{ passive: true }`
      scroll listener. In `public/bottom-tab-bar.css` change the `:29` rule from
      `.bottom-tab-bar.tab-bar-hidden { transform: translateY(calc(100% + 28px)); … }`
      to `body.dock-hidden .bottom-tab-bar { transform: translateY(var(--dock-hide-shift, calc(100% + 28px))); opacity: 0; pointer-events: none; }`
      (keep the comment, update it to name the body class), and append
      `@media (prefers-reduced-motion: reduce) { .bottom-tab-bar { transition: none; } }`
      next to it.
      Files: `public/tab-bar-functions.js`, `public/bottom-tab-bar.css`
      Verify: `node --check public/tab-bar-functions.js` exits 0; `npm run test:e2e`
      shows no new failures against the §2.4 baseline; the sampler on a 30 × 22px
      gesture at 375px reports the dock hiding/showing on `body.dock-hidden` only,
      **0** attribute mutations on `.bottom-tab-bar` itself (was 30 for 30 scroll
      events) and **≤ 2 state changes per continuous gesture** (was 2 for a single
      30px input and 6 for an alternating gesture).

- [ ] 2. Bump the two shared cache-busters on all 8 pages.
      One `str_replace` per occurrence, using the exact line list in §2.3:
      `tab-bar-functions.js?v=17` → `?v=18` and `bottom-tab-bar.css?v=41` → `?v=42`.
      Re-read each edited line after the edit and confirm the `<script src=…></script>`
      / `<link href=… rel="stylesheet">` boundaries are intact.
      Files: `public/activity.html`, `public/formularz.html`, `public/home.html`,
      `public/leaderboard.html`, `public/recipients.html`, `public/rezerwacje.html`,
      `public/ustawienia.html`, `public/wiadomosci.html`
      Verify: the §3 audit command prints exactly 8 × `tab-bar-functions.js?v=18`
      and 8 × `bottom-tab-bar.css?v=42` and no `?v=17` / `?v=41`;
      `npm run test:e2e -- smoke` still loads all 10 pages with no page errors
      (`tests/e2e/smoke.spec.js` already asserts a visible heading on each).

- [ ] 3. Decouple `formularz.js`'s composer layout from the dock's visibility.
      In `public/formularz.js`: delete line 767
      (`if (bar.classList.contains('tab-bar-hidden')) return Math.max(inset, 12);`)
      and its comment; split `tabBarOffset()` (line 754) into a new
      `dockRestOffset()` holding the pure-geometry branch
      (`inset + bar.offsetHeight + fabPoke + 8`, 12 when the bar is missing or
      `display: none`) plus `dockFloor()` returning `Math.max(inset, 12)`, and make
      `tabBarOffset()` return `isAddMode() ? dockFloor() : dockRestOffset()`.
      In `updateComposerLayout()` (line 781), after `const docked = refreshDocked();`
      and the `!docked` early return, add the shift write:
      `body.style.setProperty('--dock-hide-shift', Math.max(0, dockRestOffset() - dockFloor()) + 'px');`
      and, in the `!docked` branch **before** its `return`, `body.style.removeProperty('--dock-hide-shift')`
      so the 769–991px range and desktop fall back to the shared CSS default.
      Delete the `watchBar` helper and its invocation (lines ~808–816) together with
      its comment — nothing else mutates the dock's `class`/`style` on this page
      (confirm with `Select-String -Path public\*.js -Pattern "bottom-tab-bar"`
      before deleting), and the composer's offset no longer depends on it.
      Files: `public/formularz.js`
      Verify: `node --check public/formularz.js` exits 0; the sampler loop (�3) shows
      `--quick-add-bottom` / `--quick-add-h` / `body` padding / `scrollHeight`
      **constant** across a full 40-tick downward gesture (1 distinct
      `scrollHeight` value, 0 var writes), and `--dock-hide-shift` = 94px at 320px,
      98px at 375px and 414px.

- [ ] 4. Make the composer and the dock travel as one unit (page-local CSS).
      In `public/formularz.html`'s `@media (max-width: 768px)` block: extend the
      `.quick-add-composer` rule at line 744 from `transition: bottom 0.25s ease;`
      to `transition: bottom 0.25s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);`
      and add, after it,
      `body.dock-hidden:not(.quick-add-active) .quick-add-composer { transform: translateY(var(--dock-hide-shift, 98px)); }`
      and `body.quick-add-active .quick-add-composer { transform: none; transition: bottom 0.25s ease; }`.
      Update the stale comment inside `body.quick-add-active .bottom-tab-bar`
      (line ~957, "Higher specificity than `.bottom-tab-bar.tab-bar-hidden` …") to
      state the §2.2 precedence rule instead. Add the two new selectors to the
      `@media (prefers-reduced-motion: reduce)` group at line 973.
      Files: `public/formularz.html`
      Verify: re-read lines 740–760 and 950–995 and confirm the rules and the
      surrounding braces are intact; the sampler loop samples the hide every frame and
      asserts the composer-to-dock gap stays **28px ± 1px for the whole travel**
      (was 28 → 1.5px), both elements' computed `transition-duration` are `0.3s`
      for `transform`, and under `reducedMotion: 'reduce'` both read
      `transition: none` and are fully translated 60ms after the class lands.

- [ ] 5. Collapsed-bar markup: add the decorative cue.
      In `public/formularz.html`, immediately before the
      `<button type="button" class="quick-add-toggle" id="quickAddToggle"` element
      (line 1176), insert
      `<span class="quick-add-cue" aria-hidden="true"><i class="fas fa-plus"></i></span>`.
      It is decorative and non-interactive by design (the whole row is the tap
      target, item 7), so it adds no tab stop and no accessible name.
      Files: `public/formularz.html`
      Verify: re-read lines 1170–1200 and confirm the `<form>` children and the
      `#quickAddToggle` / `.quick-add-name` boundaries are intact; the sampler loop
      reports exactly one `.quick-add-cue`, `aria-hidden="true"`, and 0 new
      focusable elements in the composer.

- [ ] 6. Collapsed-bar CSS.
      In `public/formularz.html`'s base (desktop) block, next to
      `.quick-add-toggle { display: none; }` (line 523), add
      `.quick-add-cue { display: none; }` so desktop is untouched. In the
      `@media (max-width: 768px)` block add: `.quick-add-cue` positioned
      `grid-area: toggle` as a 48×48 circle (`background: #e3f2e6; color: #1b5e20;`
      — the same palette the expanded chevron already uses) with
      `pointer-events: none`, hidden by `body.quick-add-active .quick-add-cue { visibility: hidden; }`;
      `.quick-add-toggle { visibility: hidden; pointer-events: none; }` +
      `body.quick-add-active .quick-add-toggle { visibility: visible; pointer-events: auto; }`;
      `.quick-add-submit { visibility: hidden; pointer-events: none; transition: visibility 0s, background-color 0.18s ease, box-shadow 0.18s ease; }`
      + `body.quick-add-active .quick-add-submit { visibility: visible; pointer-events: auto; }`
      — the explicit `transition` is required, `.btn-green`'s `transition: all 0.3s ease`
      otherwise delays the `visibility` flip by ~150ms+ (measured, finding S4);
      `.quick-add-composer:not(.is-expanded) .quick-add-name .form-control { background: transparent; border-color: transparent; box-shadow: none; }`
      so the collapsed field reads as prompt text rather than an input; and
      `body:not(.quick-add-active) .quick-add-composer { cursor: pointer; }` plus a
      subtle `:active` background for tap feedback.
      Files: `public/formularz.html`
      Verify: re-read the edited regions (±6 lines each) for intact braces; harness
      run D measures, at 320/375/414px, collapsed `#quickAddToggle` / `#quickAddBtn` /
      `#quickAddClose` all `visibility: hidden` and **none of them focusable**
      (probe them *before* touching `#quickAddTitle`, which itself enters add
      mode), `.quick-add-cue` visible at the toggle's exact 48×48 box, and
      `#quickAddTitle`'s `left`/`width` **identical** collapsed vs add mode
      (77/162, 77/217, 77/256) with the composer height 70 → 215 → 70 and body
      padding 196|200 → 247 → 196|200.

- [ ] 7. Collapsed-bar behaviour in `formularz.js`.
      Inside `setupQuickAddComposer()`, after the `focusin` listener (line ~707):
      add a `click` listener on `form` that returns when `isAddMode()`, when
      `Date.now() < suppressEnterUntil` (so the tap that closed add mode cannot
      re-open it), and otherwise calls `enterAddMode({ focus: true })` — the
      `refreshDocked()` guard inside `enterAddMode` makes it a no-op on desktop.
      Add `function syncPlaceholder(docked)` setting `#quickAddTitle.placeholder` to
      `'Nazwa prezentu…'` when not docked or in add mode and `'Dodaj nowy prezent…'`
      when docked and collapsed, and call it from `updateComposerLayout()`
      immediately after `const docked = refreshDocked();` (before the `!docked`
      early return), which covers setup, entry, exit, resize and the mql change.
      At the top of `quickAddPresent()` (line 413), before the `title`/`btn` reads,
      add the collapsed-submission guard: when `document.body` has
      `quick-add-docked` and not `quick-add-active`, call
      `window.enterQuickAddMode({ focus: true })` and `return` — so the collapsed
      bar can never post a preserved draft. Leave the `onsubmit` attribute in the
      HTML untouched.
      Files: `public/formularz.js`
      Verify: `node --check public/formularz.js` exits 0; the sampler loop asserts a
      real `tap()` on (a) the cue, (b) the middle of the row, (c) the empty cell
      where the `+` used to be, each enters add mode with
      `activeElement = quickAddTitle` and details expanded; the placeholder reads
      `Dodaj nowy prezent…` collapsed and `Nazwa prezentu…` in add mode and on
      desktop; a draft typed, closed with X and re-opened is still present in both
      fields; and with a draft present, dispatching a `submit` on `#quickAddForm`
      while collapsed opens add mode and posts **nothing** (request count unchanged).

- [ ] 8. Delete the now-dead chevron coordination code and document the
      session-sticky rule.
      In `public/formularz.js`: delete `let descDismissed = false;` (line 498) and
      its comment, plus the three assignments (lines 574, 592, 660); delete
      `let togglePointerDown = false;` (line 632) and the paragraph of comment
      explaining it, `markTogglePointer` and the `pointerdown` / `mousedown`
      listeners (lines ~650–656), the `keepDesc` option and its
      `if (keepDesc) … else …` branch in `enterAddMode` (lines 551, 575–580, leaving
      the unconditional `setDescExpanded(true)`), the `togglePointerDown = false;`
      line in the chevron's `click` handler, and the `fromTogglePointer` branch in
      the `focusin` listener (lines 704–705, leaving `enterAddMode()`). Keep
      `focusDesc()` and the chevron's `click` handler otherwise intact. Add the
      comment at `enterAddMode`'s `if (isAddMode()) { … return true; }` early
      return (line 554) naming it as the place the "a manually collapsed details
      row stays collapsed for the rest of this add-mode session" rule lives, with
      the other two supports (no first-keystroke expand; the chevron's `click` is
      the only writer of `is-expanded` in add mode).
      Files: `public/formularz.js`
      Verify: `node --check public/formularz.js` exits 0;
      `Select-String -Path public\formularz.js -Pattern "descDismissed|togglePointerDown|keepDesc"`
      returns nothing; the sampler loop re-walks the surviving chevron paths in add
      mode — three consecutive taps toggle `is-expanded` / `aria-expanded` /
      `Ukryj opis` ↔ `Dodaj opis (opcjonalnie)` and the body padding 247 ↔ 152px,
      the caret lands in `#quickAddComments` on each open (the `focusDesc` retry),
      typing in the name field after a manual collapse does **not** re-expand, and
      leaving and re-entering add mode opens the details again with the typed text
      intact.

- [ ] 9. Wire the add-mode ↔ hide-on-scroll precedence in `formularz.js`.
      In `enterAddMode()`, next to `body.classList.add('quick-add-active')`
      (line ~566), add `body.classList.remove('dock-hidden')`. In `exitAddMode()`,
      after `body.classList.remove('quick-add-active')` and the `inert` /
      `aria-hidden` restore (line ~589), add
      `if (typeof window.resetDockAutoHide === 'function') window.resetDockAutoHide();`
      (the `typeof` guard matters: a stale cached `tab-bar-functions.js?v=17` does
      not define it). Add the §2.2 precedence comment above both.
      Files: `public/formularz.js`
      Verify: `node --check public/formularz.js` exits 0; the sampler loop: scroll down
      until `dock-hidden` is set, enter add mode → `dock-hidden` removed,
      `visibility: hidden` + `inert: true` + `aria-hidden="true"` still applied and
      the composer's `transform` is `none`; scroll up and down inside add mode →
      **0** `dock-hidden` flips and 0 var writes; exit at that mid-page scroll
      position → `dock-hidden` absent, dock `visibility: visible`, `transform: none`,
      `opacity: 1`, `inert: false`, no `aria-hidden`, composer back at
      `--quick-add-bottom` 110px; repeat with the last motion being *downward*
      before the exit and assert the same end state.

- [ ] 10. Write the committed spec `tests/e2e/composer.spec.js`.
      This is the authoritative proof and it fills the placeholder reserved for this
      work (§2.4). Delete `tests/e2e/composer.placeholder.spec.js` if it exists by
      then and carry over every behaviour it lists. Import `{ test, expect }` from
      `../fixtures` (never `@playwright/test` directly), use `sampleScrollY` /
      `describeSamples` from `../helpers/scroll`, `activeDescription` /
      `describeFocus` from `../helpers/focus`, and `collectOverflow` /
      `describeOverflow` from `../helpers/overflow`. Keep the per-frame sampler
      **inline** in this file (no new `tests/helpers/` file, §2.4): a
      `page.evaluate` that starts a `requestAnimationFrame` loop recording, per
      frame, `scrollY`, `documentElement.scrollHeight`, `maxScroll`, `body`
      computed `padding-bottom`, the dock's and composer's
      `getBoundingClientRect().top`/`height` and computed
      `transform`/`bottom`/`visibility`, `--quick-add-bottom`, `--quick-add-h`,
      `--dock-hide-shift`, and whether `quick-add-active` / `dock-hidden` are set —
      plus MutationObservers counting `body` class changes, `body` style writes and
      `.bottom-tab-bar` attribute changes, and a `scroll` event counter. Set the
      viewport per `test.describe` with `test.use({ viewport: { width, height: 750 }, isMobile: true, hasTouch: true })`
      for **320 / 375 / 414** and a desktop block at 1024×800. Route-override
      `/api/user/identification` per §2.4 in the add-path tests only. Cover, with
      the failure message quoting the numbers:
      **(1) collapsed bar** — no `+` (`#quickAddBtn` `visibility: hidden` and not
      focusable, probed *before* anything touches `#quickAddTitle`), no chevron
      (`#quickAddToggle` likewise), `.quick-add-cue` visible at the toggle's exact
      48×48 box, `#quickAddTitle` `left`/`width` identical collapsed vs add mode,
      composer height 70 → 215 → 70, `cursor: pointer`;
      **(2) whole row opens it** — `tap()` on the cue, on the middle of the row and
      on the empty cell where the `+` used to be each enter add mode with
      `activeDescription()` = `#quickAddTitle` and details expanded;
      **(3) the scroll fight** — a continuous 30 × 22px wheel gesture yields
      **1 distinct `scrollHeight`**, **0** `--quick-add-bottom` writes, **0**
      `.bottom-tab-bar` attribute mutations, **≤ 2** `body.dock-hidden` changes, and
      `scrollEvents` equal to the ticks sent (no self-generated clamp events);
      **(4) one unit** — across the hide, every sampled frame has the
      composer-to-dock gap within 1px of its resting 28px, and both computed
      `transform` transitions are `0.3s`;
      **(5) the single-input case** — settle at the bottom, flick **up** ~40px so
      the dock returns and the padding grows back, then send **one** 30px tick and
      assert exactly one state change, no scroll reversal, and the dock completing
      its travel (`getBoundingClientRect().top >= innerHeight`);
      **(6) precedence** — in add mode `body.dock-hidden` is absent, the dock is
      `visibility: hidden` + `inert` + `aria-hidden="true"`, scrolling produces
      **0** `dock-hidden` changes, and after every exit (close, Escape, scrim,
      successful add) the dock is visible / `transform: none` / `inert: false` /
      no `aria-hidden`, whichever way the user last scrolled;
      **(7) reachability** — at max scroll `dock-hidden` is absent and both the last
      `#myPresentsList .my-present-item` and the "Dodaj dla kogoś innego" button sit
      fully above the composer's top edge;
      **(8) no horizontal overflow** — `collectOverflow(page, { ignoreGuard: true })`
      reports 0 offenders in both states at 320px;
      **(9) the behaviours the placeholder lists** — details open with the form (not
      on first keystroke); the dock's **Dodaj** tab opens and focuses the name
      field; after a successful add the form collapses, blurs, and focus lands on
      `#myPresentsHeading` (assert the `Prezent dodany! 🎁` pill, **not** an item
      count, §2.4); an explicit close control plus Escape and scrim-tap exits, and
      **no exit clears typed text**; no scroll jump on entry via `sampleScrollY` at
      0/60/150/300/450ms, including pinned to the very bottom;
      `#editPresentComments` default height ≥ 120px;
      **(10) reduced motion** — a `test.use({ reducedMotion: 'reduce' })` block
      asserting both elements compute `transition: none` and are fully translated
      60ms after the class lands;
      **(11) desktop at 1024px** — `quick-add-docked` false, no add mode, no scrim,
      `.quick-add-cue` and `#quickAddClose` `display: none`, `#quickAddBtn` visible
      and labelled, and the dock `display: none`.
      Files: `tests/e2e/composer.spec.js` (and delete
      `tests/e2e/composer.placeholder.spec.js` if present)
      Verify: `npm run test:e2e -- composer` passes with every test green, and the
      full `npm run test:e2e` shows **no new failures** against the §2.4 baseline
      (19 passed / 2 failed). Quote the before/after numbers for (3) in the run
      output: the pre-change real-server measurement was 30 attribute mutations for
      30 scroll events and 12 distinct `scrollHeight` values.

- [ ] 11. Cross-page spot check for the shared edits.
      The dock lives on 8 pages; `tests/e2e/smoke.spec.js` already proves all 10
      pages render. Add a small `test.describe` **inside** `composer.spec.js`
      (not a new file) that loads `/` (home) and `/recipients` at 375×750 with the
      same inline sampler and runs the 30 × 22px gesture on each.
      Files: `tests/e2e/composer.spec.js`
      Verify: `npm run test:e2e -- composer` stays green; on both pages the dock
      hides and returns with **≤ 2** `body.dock-hidden` changes, `scrollHeight` has
      **1** distinct value, `--dock-hide-shift` is **unset** (so the shared CSS
      fallback `calc(100% + 28px)` is in use), and the `pageErrors` fixture reports
      nothing — which is what proves the shared-file change did not break the dock
      elsewhere.

- [ ] 12. Screenshots and the verification document.
      Capture with the throwaway `%TEMP%` script pointed at the demo server
      (`npm run offline`, which boots the real `server.js` — do **not** add
      screenshot-writing code to the committed spec, whose artifacts belong under
      `tests/`), at `deviceScaleFactor: 2`, into `.agents/tasks/screenshots/`:
      `composer2-375-idle.png` (new collapsed bar: cue + prompt, no `+`, no chevron,
      dock's green **Dodaj** tab below it), `composer2-320-idle.png`,
      `composer2-375-draft.png` (collapsed with a preserved draft and still no `+`),
      `composer2-375-active.png` (add mode: chevron, `+`, close, details open),
      `composer2-375-midscroll.png` (sampled ~140ms into the hide, proving the 28px
      gap is preserved), `composer2-375-dockhidden.png` (both fully away),
      `composer2-375-bottom.png` (at max scroll: both shown, nothing clipped),
      `composer2-375-reduced-motion.png`, `composer2-1024.png` (desktop card
      unchanged), `composer2-home-375.png` and `composer2-recipients-375.png`.
      Then write `.agents/tasks/composer-v2-verification.md` in the style of
      `.agents/tasks/addmode-verification.md`: the state table, the before/after
      scroll numbers side by side, the named root cause, the chevron /
      `keepDesc` / `descDismissed` disposition, the precedence rule, the accepted
      trade-offs (up to 98px of reserved blank while transform-hidden mid-scroll;
      the unchanged 47px padding settle when leaving add mode; the transient hide
      still leaving the dock tabbable, as on the other seven pages), the `?v=` table,
      and an explicit "still to do by the orchestrator: `public/sw.js` `CACHE_NAME`
      bump". Delete the `%TEMP%` harness.
      Files: `.agents/tasks/screenshots/composer2-*.png`,
      `.agents/tasks/composer-v2-verification.md`
      Verify: every listed screenshot exists and has been looked at; the
      verification document names the root cause and quotes the before/after
      measurements; `git -P status --short` shows this task's changes confined to
      `public/formularz.html`, `public/formularz.js`, `public/tab-bar-functions.js`,
      `public/bottom-tab-bar.css`, the seven other bumped HTML pages,
      `tests/e2e/composer.spec.js` and the `.agents/tasks/` artifacts — and **not**
      `public/sw.js`, `public/app-theme.css`, `public/chat-reactions.*`,
      `public/notification-text.js`, `public/pluralize-pl.js`, `server.js`,
      `playwright.config.js`, `package.json`, `.gitignore` or any other file under
      `tests/`. Note that the working tree already carried unrelated local
      modifications when this plan was written (`.gitignore`, `package.json`,
      `package-lock.json`, `public/notification-text.js`, `server.js`, several
      deletions, and the untracked `tests/` + `playwright.config.js` from the
      concurrent harness workflow) — those are not this task's and must be left
      exactly as found.

---

## Evidence already captured by this planning pass

These live in `.agents/tasks/screenshots/` and are the "before" / design-validation
record behind §1 and §2.1. Keep them; the `composer2-*.png` names item 12 asks for
are distinct.

| File | What it shows |
|---|---|
| `composer2-before-375-idle.png` | the shipped collapsed bar: chevron, field, round green `+` — with the dock's green **Dodaj** tab 28px below it |
| `composer2-before-375-midscroll-gap.png` | ~130ms into a hide: the composer has closed on the dock (measured gap 1.5px vs 28px at rest) |
| `composer2-before-375-dockhidden.png` | settled with the dock hidden, the composer dropped to `bottom: 12px` |
| `composer2-before-375-settled-bottom.png` | where a fast scroll to the bottom actually lands |
| `composer2-proto-375-idle.png`, `composer2-proto-320-idle.png` | the §2.1 collapsed design validated by injecting only the proposed CSS over the real page: green `+` cue, `Dodaj nowy prezent…`, no `+`, no chevron |
| `composer2-proto-375-active.png` | the same page in add mode, unchanged |

## Known gaps and assumptions

- **No real iOS Safari engine.** The iOS-shaped paths are simulated in the shape
  iOS produces (`activeElement = BODY` before the handler runs), as in the previous
  iteration. iOS momentum scrolling is also not reproducible in the harness:
  Chromium's `Input.synthesizeScrollGesture` silently no-ops here (verified), so
  the gestures are wheel ticks at ~1 per frame plus CDP touch drags. The fix does
  not depend on momentum behaviour — it removes the mid-gesture `scrollHeight`
  change that momentum scrolling would amplify.
- **The transient hide leaves the dock tabbable** (`opacity: 0` + `pointer-events: none`,
  no `visibility`/`inert`). That is today's contract on all 8 pages and is
  deliberately not changed here; only the deliberate add-mode hide removes the dock
  from the tab order and the a11y tree.
- **`document.documentElement.scrollHeight` is read inside the scroll handler** for
  the near-bottom rule. It is a read of the document, not of either bar, it happens
  once per rAF tick before any write, and `scrollHeight` is now constant while
  scrolling — so it cannot reintroduce the loop.
- Assumed the dock markup is static on every page that loads
  `tab-bar-functions.js` (verified: `class="bottom-tab-bar"` is present in the HTML
  of all 8). If a page ever injects it later, `reseed()` would need re-running —
  noted, not handled.
