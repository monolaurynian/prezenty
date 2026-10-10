# Add mode for the quick-add composer - verification

Turns the mobile quick-add composer on **Dodaj i edytuj moje prezenty**
(`formularz.html` → `#editTab`) into an explicit add mode with an open/close
lifecycle: details open with the form, the dock's **Dodaj** tab opens and
focuses it, a successful add closes it, the bottom tab bar hides while it is
open, and there is a real close button.

---

## 0. Review findings handled (iteration 2)

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | *blocking* — a chevron tap **from the compact bar** entered add mode (via `focusin`, because Chromium/Android focus a `<button>` on tap) and then collapsed the description it had just opened, latching `descDismissed` | the chevron's intent is no longer derived from post-entry DOM state. A `pointerdown`/`mousedown` on `#quickAddToggle` sets `togglePointerDown`; the `focusin` entry it causes is passed `{ keepDesc: true }` and leaves the description row exactly as it found it, so the chevron's own `click` is the only thing that decides. Keyboard activation never sets the flag, so tabbing in still opens the details like any other entry | §5(d) `c1`/`c1b`/`c2`/`c3`/`c4` — the recorded event order is `pointerdown:toggle → focusin:quickAddToggle → click:toggle` (so the engine *does* focus the button on tap, i.e. the reported ordering reproduces) and the row ends **open** with `aria-expanded="true"` and the caret in the textarea |
| 2 | *blocking* — plan row **E3** (chevron from the compact state) was missing from the harness matrix | added as the `c*` rows of §5(d): a real `tap()` on `#quickAddToggle` from S1, asserted mid-transition and settled, plus "leave and re-enter still opens the details" (dismissal not latched), the keyboard-shaped variant and the add-mode re-open | §5(d) `c1`–`c4`, `d1b`/`d1c` |
| 3 | *non-blocking* — `leaderboard.html` and `wiadomosci.html` still load `tab-bar-functions.js?v=16` | **not fixed here** — both are on this task's do-not-edit list. Still carried over in §3 and §7 with the degradation spelled out | §3 |
| 4 | *non-blocking* — the exit focus hand-off to `#myPresentsHeading` was gated on "focus is still inside the form", which is false on iOS Safari (the tap on X / `+` blurs the input first), dropping the reading position to the top of the page | the hand-off is now **unconditional** for the four deliberate exits (`close`, `escape`, `scrim`, `added`); only the *blur* stays conditional, since there is nothing to blur when the platform already did it. `undocked` and `modal` still leave focus alone | §5(e) `e6` and §5(f) `f5` — the field is blurred *before* the click, as on iOS, and focus still lands on `myPresentsHeading` |

One extra defect surfaced while writing the E3 row and is fixed: the
chevron's `descInput.focus()` **silently failed**. The textarea inherits the
description row's in-flight `visibility` change, so it is not focusable in the
same tick as the class change (measured: `visibility: hidden` at click time,
and a `setTimeout(…, 0)` retry still fails). `focusDesc()` now focuses, and if
that did not take, retries once after the transition — guarded so it only
fires while add mode and the open row still hold and nothing else has taken
focus. Evidence: §5(d) `c1b` (`activeElement = quickAddComments`) and `d1b`.

---

## 1. The state machine as implemented

`body.quick-add-active` is the single source of truth ("add mode is on").
`body.quick-add-docked` keeps its existing meaning ("the composer is the fixed
mobile bar") and is the **precondition**: add mode cannot exist unless the
composer is docked, which is only true at ≤768px with `#editTab` on screen.
There is no second class, so the two can never desynchronise.

| State | Condition | Scrim | Details | Dock | Head row / close | `--quick-add-bottom` | body padding |
|---|---|---|---|---|---|---|---|
| **S0 off** | >768px, or `#editTab` hidden | `display: none` | textarea always visible, chevron `display: none` | `display: none` ≥992px, plain nav 769-991px | close `display: none` | unset | 24px / 128px |
| **S1 compact** | docked, no `quick-add-active` | `opacity 0`, `visibility hidden`, `pointer-events none` | collapsed, `aria-expanded="false"` | visible, interactive | `max-height: 0`, close `visibility: hidden` → not tabbable | **110px** | **200px** |
| **S2 add, details open** | docked + `quick-add-active` | `opacity 1`, visible, `pointer-events auto` | expanded, `aria-expanded="true"` | `visibility: hidden` + `opacity 0` + `translateY(100% + 56px)` + JS `inert` + `aria-hidden="true"` | 44px row, close `visibility: visible`, tabbable | **12px** | **247px** |
| **S2b add, details collapsed** | S2 after a chevron collapse | visible | collapsed, `aria-expanded="false"` | hidden | visible | 12px | **152px** |

Add mode is **not** a dialog: no `role="dialog"` (measured: 0 outside the
Bootstrap modals), no focus trap, no body scroll lock (`body` stays
`overflow: visible`), and the scrim stays `aria-hidden="true"`.

### Entry (all require docked)

| # | Trigger | Takes focus |
|---|---|---|
| E1 | `focusin` anywhere in `#quickAddForm` | no (the user's own tap already did) |
| E2 | `input` in `#quickAddTitle` / `#quickAddComments` (safety net, clears the suppression window) | no |
| E3 | Chevron tapped from S1 | yes, the textarea - and this entry runs with `{ keepDesc: true }` (see below) |
| E4 | `?add=1` on load, authenticated, docked | yes, `#quickAddTitle` |
| E5 | `Dodaj` tab tapped while already on the page | yes, `#quickAddTitle` |

Every entry, in order: (1) `refreshDocked()` - bail out with `false` if not
docked; (2) re-entrancy / suppression guard; (3) **focus first** -
`#quickAddTitle.focus({preventScroll:true})` when `opts.focus` is set or when
`document.activeElement` is inside `.bottom-tab-bar`, so focus is never left
inside the element about to be hidden; (4) add `body.quick-add-active`;
(5) `bar.inert = true` + `aria-hidden="true"`; (6) `descDismissed = false` and
`setDescExpanded(true)`, which also recomputes the layout vars. **Field values
are never touched on entry.**

**`{ keepDesc: true }` (E3 only).** Chromium and Android focus a `<button>` on
tap, so a tap on the chevron from the compact bar fires `focusin` - and with it
an entry - *before* the chevron's own `click` handler runs. If that entry
opened the description, the click handler would read the live state as "already
open, so collapse", and the tap would shut the row it had just opened. So a
`pointerdown` (or `mousedown` where `PointerEvent` is missing) on the chevron
sets a short-lived `togglePointerDown` flag, the `focusin` entry it causes is
passed `{ keepDesc: true }` and skips `setDescExpanded` entirely (it still
recomputes the layout), and the `click` handler is the single writer of the
row's state. The flag is cleared in that click handler and by a 700ms safety
timer, and keyboard activation never sets it - so Tab-ing onto the chevron
behaves like any other entry (details open, label `Ukryj opis`), and pressing
Enter then collapses them, which is exactly what the label promises at that
moment. `aria-expanded` is written on every `setDescExpanded` call and is
therefore truthful at each step of all of these paths.

One note on `descDismissed`: it records "the user collapsed the row by hand"
and is reset on entry and exit, but nothing **reads** it any more - the
"stays collapsed for the rest of the session" rule is structural, because
once add mode is on no code path re-expands the row except the chevron itself
(`enterAddMode` returns early when already in add mode, and the
first-keystroke expand is gone). It is kept as the explicit record of that
intent rather than removed, since removing it would be an unrelated edit;
either way the measured behaviour is §5(d) `d1`→`d2`→`d3`.

### Exit

| # | Trigger | Focus moves to `#myPresentsHeading` | Clears fields |
|---|---|---|---|
| X1 | `#quickAddClose` | yes, unconditionally | no |
| X2 | Scrim tap (tap, not drag: <12px and <700ms) | yes, unconditionally | no |
| X3 | `Escape` | yes, unconditionally | no |
| X4 | Successful add | yes, unconditionally | yes, `quickAddPresent()` clears them *before* exiting |
| X5 | No longer docked (desktop resize, `switchTab('add')`, `#editTab` hidden) | no | no |
| X6 | `#editPresentModal` `show.bs.modal` | no | no |

Every exit: (1) remove the class; (2) `bar.inert = false`, remove
`aria-hidden`; (3) `descDismissed = false` + `setDescExpanded(false)`;
(4) blur the focused field **if** it is inside the composer (this is what
closes the on-screen keyboard), then focus `#myPresentsHeading`
(`tabindex="-1"`, `preventScroll: true`) for X1-X4; (5) 300ms re-entry
suppression so the same tap cannot re-open; (6) recompute the layout. **No
exit ever clears a field.**

The blur is conditional and the hand-off is not, on purpose: iOS Safari blurs
the focused input *before* the tap on X (or on the submit `+`) lands, so by the
time the handler runs `document.activeElement` is `<body>`. Gating the
hand-off on "focus was still in the form" would therefore drop the
screen-reader reading position to the top of the document on exactly the
platform this work targets. X5 (`undocked`) and X6 (`modal`) still leave focus
alone - it belongs to whatever caused them.

### Deliberately no longer exits

- **Chevron collapse** - it is a details toggle only (it used to dismiss the
  scrim as well).
- **`focusout` / blur** - the whole `focusout` + `blurTimer` +
  `composerPointerAt` + document-level `pointerdown` machinery is deleted. Add
  mode now ends only on an explicit signal, which is what makes "closing does
  not discard typed text" true and removes the iOS "buttons don't take focus
  on tap" race the old code worked around. *Consequence:* dismissing the
  keyboard with its own Done/▼ button leaves add mode on - correct, because
  the close button and the scrim are both one tap away.

---

## 2. Files and selectors changed

**`public/formularz.html`** (markup)
- `#quickAddHeading` is now wrapped in a new `<div class="quick-add-head">`
  together with a new `<button type="button" class="quick-add-close"
  id="quickAddClose" aria-label="Zamknij formularz dodawania">` carrying
  `<i class="fas fa-xmark">`. The `<h6>` keeps its id and text, so
  `<section aria-labelledby="quickAddHeading">` keeps its accessible name.
- `#myPresentsHeading` gained `tabindex="-1"` (the exit focus target).

**`public/formularz.html`** (CSS, all in the page's **own** inline `<style>`;
no shared stylesheet was touched)
- Desktop block: new `.quick-add-head { grid-area: heading; display: flex;
  align-items: center; justify-content: space-between; gap: 8px; }`;
  `grid-area` removed from `.quick-add-heading`; new
  `.quick-add-close { display: none; }` next to the existing
  `.quick-add-toggle { display: none; }`; `.quick-add-close:focus-visible`
  added to the shared focus-ring group.
- `@media (max-width: 768px)`: `grid-template-areas` gained a `"head head head"`
  row; `.quick-add-head` (collapsed `max-height: 0; overflow: hidden`);
  `body.quick-add-active .quick-add-head` (`max-height: 56px;
  margin-bottom: 6px`); `body.quick-add-active .quick-add-heading` (un-does the
  visually-hidden clip, `font-size: 0.9rem`); `.quick-add-close` (44×44,
  `border-radius: 12px`, `#eef1f4` on `#cbd2d9`, `#44515e` glyph,
  `visibility: hidden`) and `body.quick-add-active .quick-add-close`
  (`visibility: visible`); `transition: padding-bottom 0.25s ease` added to the
  existing `body.has-tab-bar.quick-add-docked` padding rule; and the tab-bar
  hide:

  ```css
  body.quick-add-active .bottom-tab-bar {
      transform: translateY(calc(100% + 56px));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
          opacity 0.3s ease, visibility 0s linear 0.3s;
  }
  ```

  It has higher specificity than `.bottom-tab-bar.tab-bar-hidden` **and** comes
  later in the cascade (the inline `<style>` follows the `bottom-tab-bar.css`
  link), so the scroll auto-hide in `tab-bar-functions.js` cannot fight it.
  `+56px` clears the FAB, which pokes ~18px above the bar's own box.
- `@media (prefers-reduced-motion: reduce)`: added `.quick-add-head`,
  `body.quick-add-active .quick-add-head`, `body.has-tab-bar.quick-add-docked`,
  `.bottom-tab-bar` and `body.quick-add-active .bottom-tab-bar` to the existing
  `transition: none !important` group. `.bottom-tab-bar` is listed bare on
  purpose: the bar's *return* transition lives in the shared
  `bottom-tab-bar.css`, and neutralising it from here keeps the change
  page-local with no cross-page cache churn.

**`public/formularz.js`**
- New module-scope `?add=1` parse + `history.replaceState` clean-up, placed
  before any async work.
- `pendingAddMode` hand-off in `checkAuth()`'s authenticated branch, after
  `loadMyPresents()`.
- `quickAddPresent()`: `window._resetQuickAddComposer()` →
  `window.exitQuickAddMode('added')`; the `.finally()` refocus of the name
  input is now conditional on **not** `body.quick-add-docked`.
- `setupQuickAddComposer()`: `activateComposer`/`deactivateComposer` replaced
  by `enterAddMode(opts)` / `exitAddMode(reason)` / `refreshDocked()` /
  `isAddMode()` / `tabBar()`; `window.enterQuickAddMode` and
  `window.exitQuickAddMode` exposed (`window._resetQuickAddComposer` removed,
  `window._updateQuickAddComposer` kept). Deleted: the `nameInput` "expand on
  first character" listener, the `focusout` listener, `blurTimer`,
  `composerPointerAt`, the document-level capture `pointerdown` listener.
  Added: `#quickAddClose` click → `exitAddMode('close')`;
  `#editPresentModal` `show.bs.modal` → `exitAddMode('modal')`; an add-mode
  early branch in `tabBarOffset()`.
- **Iteration 2** (the review fixes), all inside `setupQuickAddComposer()`:
  - `enterAddMode(opts)` takes `opts.keepDesc`; when set it calls
    `updateComposerLayout()` instead of `setDescExpanded(true)`.
  - `togglePointerDown`, set by new `pointerdown` (plus `mousedown` when
    `PointerEvent` is missing) listeners on `#quickAddToggle`, cleared in that
    button's `click` handler and by a 700ms timer.
  - `form`'s `focusin` listener now reads the event target:
    `enterAddMode(e.target === toggle && togglePointerDown ? { keepDesc: true } : undefined)`.
  - the chevron's `click` handler zeroes `suppressEnterUntil` before entering
    (an explicit tap is not subject to the "the tap that closed must not
    re-open" window) and calls the new `focusDesc()`.
  - `focusDesc()`: focuses `#quickAddComments` and, only if that silently
    failed, retries once after 260ms - guarded on `isAddMode()`,
    `isDescExpanded()` and `document.activeElement` still being the chevron or
    `<body>`, so a quick tap on another field wins.
  - `exitAddMode()`: the `#myPresentsHeading` hand-off is no longer gated on
    `inForm`; it runs for `reason` in `close` / `escape` / `scrim` / `added`.
    The blur stays gated on `inForm`.

**`public/tab-bar-functions.js`** - one appended delegated capture-phase
`click` handler on `a.tab-item.form-tab` (24 lines, nothing else changed).
It only touches links whose href points at `formularz`, calls
`preventDefault()` **only** when `window.enterQuickAddMode` exists and returns
`true` (i.e. we are already on the form page and add mode actually started),
and otherwise just appends `add=1` to the href and lets the navigation
proceed - so middle-click, modifier-click and long-press keep working, and the
rewrite is idempotent. `a.tab-bar-menu-item.edit-presents-item`
("Edytuj moje prezenty") is deliberately **not** matched: that is an edit
intent, not an add intent.

---

## 3. Cache-busters

| File | Bumped | Where |
|---|---|---|
| `formularz.js` | `?v=19` → **`?v=20`** | `formularz.html` (one occurrence) |

Iteration 2 touched `formularz.js` again but **kept `?v=20`**: production still
serves `?v=19`, so `?v=20` is already a fresh URL for every client and a second
bump would buy nothing. `tab-bar-functions.js` was **not** touched in
iteration 2, so its `?v=17` set is unchanged.
| `tab-bar-functions.js` | `?v=16` → **`?v=17`** | `formularz.html`, `activity.html`, `home.html`, `recipients.html`, `rezerwacje.html`, `ustawienia.html` |

**Still needed, not done here (do-not-edit list):** `leaderboard.html:1509`
and `wiadomosci.html:816` both still load `tab-bar-functions.js?v=16` and both
carry a `Dodaj` tab. Until their cached copy is revalidated, their `Dodaj` tab
navigates **without** `?add=1`: the form page opens normally, just without the
composer auto-opening. Graceful degradation, nothing breaks. The final step's
`sw.js` `CACHE_NAME` bump drops the stale entries, after which even the `?v=16`
URL returns the new script. **Please bump these two to `?v=17` in the merge
step if they become editable.**

No other `?v=` changes. `bottom-tab-bar.css?v=41` and `app-theme.css?v=14` are
untouched because every new rule lives in `formularz.html`'s inline `<style>`.

---

## 4. Decisions

### Chevron vs close
**The chevron stays a details toggle and nothing else.** It keeps
`aria-controls="quickAddDescWrap"`, keeps `aria-expanded` in sync at every
transition and keeps its label swap (`Ukryj opis` / `Dodaj opis (opcjonalnie)`).
It no longer dismisses the scrim - a control that sometimes collapses a field
and sometimes exits the whole mode is exactly the ambiguity to avoid. The two
are unconfusable on four axes: **position** (chevron bottom-left of the input
row vs close top-right of the head row), **shape** (48px circle vs 44px rounded
square), **glyph** (chevron vs ×) and **colour** (the chevron turns green while
expanded, the close button stays neutral grey). Both are visible side by side in
`addmode-375-active.png`.

Its state is **never** inferred from the DOM after something else has written
to it: a pointer-driven entry hands the row over untouched
(`{ keepDesc: true }`) and the click handler is the only writer. That is what
keeps "tap the chevron on the compact bar" meaning *open the description*
instead of "enter add mode and immediately close the description" on engines
that focus buttons on tap. Opening it also puts the caret in the textarea,
which needs the one-shot retry in `focusDesc()` because the textarea inherits
the row's in-flight `visibility` change and is not focusable in the same tick.

### Typed text on close
Closing is a pure state change: `enterAddMode`/`exitAddMode` never read or
write `#quickAddTitle.value` or `#quickAddComments.value`. Reopening shows
exactly what was typed, with details expanded again, so nothing stays hidden
even if the user had collapsed them. Only a successful add clears the fields,
and it does so in `quickAddPresent()` *before* exiting. Measured for all three
close paths (X, Escape, scrim tap) - see §5(f).

### Desktop (≥769px)
Desktop looks and behaves exactly as before. Only requirement 1 applies there,
and it was already true (the textarea is permanently visible in the green card
and the chevron is `display: none`).

| Requirement | Desktop | Why |
|---|---|---|
| 1 details open with the form | already true | permanent textarea |
| 2 `Dodaj` opens + focuses | **no** - `?add=1` is stripped and ignored | the card is already at the top of the page; grabbing focus on navigation would scroll-jack and fight the mouse |
| 3 collapse + blur after add | **no** - keeps today's refocus of the name field | nothing to collapse, and blurring would break fast repeat adding with a keyboard |
| 4 hide the bottom tab bar | **no** | ≥992px there is no bar; 769-991px the bar is navigation, not an obstacle, and there is no thumb zone to free |
| 5 close button | **no** (`display: none`) | the form is a permanent inline card, not an overlay |

This falls out of the single `refreshDocked()` guard, so 769-991px behaves like
desktop too. Measured at 1024px and 820px - see §5.

### Fast repeat adding (the requirement 3 tradeoff)
A successful add now **blurs and closes** instead of leaving focus in the name
field, so adding several presents in a row costs **one extra tap** on mobile
(tap the compact bar → add mode again, measured as
`(e) one tap back in for the next present`). What is kept to make that cheap:
the composer stays docked in its compact form (one tap, nothing to scroll to),
both fields are cleared, the `Prezent dodany! 🎁` pill confirms for 4s, and the
new item still gets its `.is-new` highlight - which is actually *visible* now,
because the scrim is down and the dock is back (compare
`addmode-375-after-add.png`). Desktop keeps the old refocus behaviour, so
keyboard-driven bulk entry is unaffected.

### Scroll behaviour on exit (measured, not ideal)
Entering add mode **grows** the reserved bottom padding (200px → 247px),
because the composer gets taller faster than it drops, so the scroll position
can never be clamped: **measured 0px jump** even when entering while pinned to
the very bottom of the page. Leaving **shrinks** it back, and a reader pinned to
the absolute bottom is then clamped upwards by the 47px difference - there is
no page left to show, so this cannot be prevented without permanently reserving
the add-mode padding (which would leave a visible empty gap in the compact
state). It is spread over the matching 0.25s `padding-bottom` transition rather
than landing in one frame; measured ramp after pressing close at max scroll:

| t (ms) | 0 | 69 | 122 | 183 | 295 | 446 |
|---|---|---|---|---|---|---|
| `scrollY` | 669 | 669 | 664 | 650 | 631 | 622 |
| `padding-bottom` | 247px | 246.8px | 242.2px | 228.1px | 208.9px | 200px |

(re-measured in iteration 2; 47px total, same shape as before)

It reads as a settle, not a snap, and it only happens when closing from the
very bottom of the list. Disabled under `prefers-reduced-motion` (the shrink is
then instant, which is the correct trade for that preference).

---

## 5. Exercised transitions

Harness: `%TEMP%\prezenty-addmode2` (outside the repo, **deleted afterwards**;
iteration 2 rebuilt it from scratch and re-ran the whole matrix against the
fixed `formularz.js`, so every number below is a fresh measurement).
`playwright-core@1.47.2` driving the locally installed Edge, headless,
`deviceScaleFactor: 2`, `isMobile`/`hasTouch`, served over
`http://127.0.0.1:8787` by a 30-line static server so `history.replaceState`
and the dock's absolute script paths behave as in production. `build.js` copies
the real `public/` tree and writes the **real `formularz.html`** (under its real
name, so the dock's `href="formularz.html"` resolves to it) with one injected
script stubbing `/api/auth`, `/api/user/identification`,
`/api/formularz/recipients`, `/api/formularz/my-presents`,
`/api/formularz/present`, `/api/presents/:id` and the badge endpoints, seeded
with 6 presents. Everything else is real: real stylesheets, real
`formularz.js?v=20`, real `tab-bar-functions.js?v=17`, real
bootstrap/Font Awesome/Remix, real `seba.jpg` background. A second generated
page (`bartest.html`) carries the **real dock markup lifted out of
formularz.html** with no `formularz.js`, i.e. what every other page looks like
to the shared handler. Viewports 320×700, 375×750, 820×800, 1024×800.

`node --check public/formularz.js` → exit **0**.
`node --check public/tab-bar-functions.js` → exit **0**.
No page errors were logged in any run.

### (a) Load **with** the add marker - 375px

| Assertion | Measured |
|---|---|
| add mode active | `body.quick-add-active` ✔ |
| details already expanded | `is-expanded` true, `aria-expanded="true"`, desc `visibility: visible` |
| name input focused | `activeElement = quickAddTitle` |
| dock hidden | `visibility: hidden`, `opacity: 0`, `translateY(…98→126px)`, `inert: true`, `aria-hidden="true"`; FAB `visibility: hidden` |
| scrim visible | `opacity 1`, `visibility visible`, `pointer-events auto`, still `aria-hidden="true"` |
| URL marker cleaned | `location.pathname + search + hash` = `"/formularz.html"` |
| close button | 44×44, `visibility: visible` |
| layout | `--quick-add-bottom: 12px`, `--quick-add-h: 215px`, body padding 247px, composer bottom 738 / viewport 750 |
| reload the cleaned URL | **no** add mode, `activeElement = BODY`, dock visible |
| history back across the `replaceState` | `search = ""`, `addMode = false` |
| `?add=1&osoba=Babcia` | `search = "?osoba=Babcia"`, add mode on, `quickAddTitle` focused, `_osobaPreselected = true`, recipient select shows **Babcia** |

### (b) Load **without** the marker - 375px

`addMode: false`, `activeElement: BODY` (no focus stolen), dock
`visibility: visible` / `inert: false` / no `aria-hidden`, scrim `opacity 0` /
`visibility hidden`, head row height **0**, close button `visibility: hidden`,
`--quick-add-bottom: 110px`, `--quick-add-h: 70px`, body padding 200px.
Tab order: `#quickAddClose` **not** focusable (`focus()` leaves
`activeElement` elsewhere), the dock's `Dodaj` link **is** focusable - and
probing them did not change the state (re-snapshotted: still compact).
Screenshot: `addmode-375-idle.png` - identical to the pre-change compact bar.

### (c) Tapping **Dodaj** while already on the page

| Case | Result |
|---|---|
| Real tap on the dock's `Dodaj` from S1 | enters add mode, `activeElement = quickAddTitle`, **no reload** (`window.__alive` sentinel survived), details expanded, dock hidden, scrim up |
| `Dodaj` clicked while already in add mode (dispatched - the dock is hidden and `pointer-events: none`, so a real tap cannot reach it, by design) | stays in add mode, focus returns to `quickAddTitle`, no reload |
| Tab order in add mode | `quickAddClose` ✔, `quickAddToggle` ✔, `quickAddTitle` ✔, `quickAddBtn` ✔ focusable; the dock's `Dodaj` link **and** the FAB (even with a temporary `tabindex="0"`) **not** focusable |
| Dock-only page (`bartest.html`, no composer) | `href` rewritten `formularz.html` → `formularz.html?add=1`, `dispatchEvent` returned `true` (default **not** prevented, so the navigation proceeds), and the resulting load landed in add mode |
| Other dock items on that page | `Główna` `/`, `Aktywność` `#`, `Czat` `wiadomosci.html` and the menu's `Edytuj moje prezenty` `formularz.html` - all unchanged after a click; the FAB menu still opens and closes |

### (d) The chevron — from the compact bar (plan E3) and inside add mode

The E3 rows are new in iteration 2 and are what finding 1 was about. All of
them are **real `tap()`s** at 375×750 with `isMobile`/`hasTouch`.

| Step | Result |
|---|---|
| `c1` Tap the chevron from the compact state (S1) | event order recorded by capture-phase listeners: **`pointerdown:toggle` → `focusin:quickAddToggle` → `click:toggle`** - so this engine *does* focus the button on tap and the reported ordering reproduces. 120ms in, the transitions are mid-flight (dock `opacity 0.33`, scrim `0.91`) and the row is already `is-expanded` / `aria-expanded="true"` / label `Ukryj opis` |
| `c1b` the same tap, settled (+400ms) | add mode on, `is-expanded` **true**, `aria-expanded="true"`, label `Ukryj opis`, **`activeElement = quickAddComments`** (the caret is in the description), dock `visibility: hidden` + `inert`, scrim `opacity 1`, close 44×44 visible, padding 247px |
| `c2` close with X, then tap the name field again | add mode on, details **expanded again** - the E3 tap did **not** latch `descDismissed` |
| `c3` chevron focused by keyboard from S1 (no `pointerdown`: `events = ["focusin:quickAddToggle"]`) | add mode on and details **open** (`aria-expanded="true"`, label `Ukryj opis`) - `keepDesc` is pointer-only, so a Tab-in behaves like every other entry |
| `c4` `Enter` on the chevron straight after `c3` | collapses: `is-expanded` false, `aria-expanded="false"`, label `Dodaj opis (opcjonalnie)`, padding 247px → 161px (mid-transition) → 152px. Truthful: the label at that moment read `Ukryj opis` |
| `d1` Chevron tapped **in** add mode | add mode **stays on** (scrim up, dock hidden), `is-expanded` false, `aria-expanded="false"`, label back to `Dodaj opis (opcjonalnie)`, padding 247px → 152px |
| `d1b` Chevron tapped again | `is-expanded` true, `aria-expanded="true"`, padding back to 247px, `activeElement = quickAddComments` |
| `d1c` and again | collapsed again, `aria-expanded="false"`, padding 152px - the toggle is stable across repeats |
| `d2` Type into the name field after a manual collapse | still collapsed - the old "expand on first character" trigger is gone |
| `d3` Leave and re-enter add mode | expanded again, `aria-expanded="true"`, typed text still `"Lampka nocna"` |

Why the caret needed work: at `click` time `getComputedStyle(#quickAddComments)
.visibility` is still `hidden` (it inherits the row's in-flight change) while
the row itself already reads `visible`, and even a `setTimeout(…, 0)` focus
attempt fails. Measured focus timeline for the pointer path: `t+0ms`
`quickAddToggle`, settled **`quickAddComments`** via the 260ms retry in
`focusDesc()`.

### (e) Submit

| Path | Result |
|---|---|
| `+` button | list 6 → 7, payload `{recipientName: "Mateusz", presentTitle: "Lampka nocna", presentComments: "Cieple swiatlo, gwint E14"}`, add mode **off**, `is-expanded` false, `aria-expanded="false"`, both fields empty, `activeElement = myPresentsHeading` (field blurred → keyboard closes), scrim `opacity 0`, dock `visibility: visible` / `inert: false`, new item carries `.is-new`, pill `Prezent dodany! 🎁` shown |
| 3s later | highlight finished (`isNew: 0`), pill still up, state unchanged |
| One tap back in | add mode on, details expanded, `quickAddTitle` focused - the fast-repeat path |
| `Enter` in the name field | list 7 → 8, same end state, `.is-new` set |
| `Ctrl+Enter` in the description | list 8 → 9, same end state |
| Empty name | error pill `Wpisz nazwę prezentu`, **add mode kept** (nothing is lost) |
| **iOS-shaped submit** (`e6`): blur `#quickAddTitle` **before** clicking `+`, so `activeElement` is `BODY` when the handler runs - exactly what iOS Safari does | list 9 → 10, add mode off, dock back, **`activeElement = myPresentsHeading`** - the hand-off survives the missing in-form focus (finding 4) |

Screenshot: `addmode-375-after-add.png` - collapsed composer, dock and FAB back,
new item highlighted, pill visible.

### (f) Close

| Path | add mode | Dock | Focus | `#quickAddTitle` | `#quickAddComments` |
|---|---|---|---|---|---|
| `X` button | off | visible, `inert: false` | `myPresentsHeading` | `"Lampka nocna"` | `"Cieple swiatlo, gwint E14"` |
| Reopen after the X | on | hidden | `quickAddTitle` | `"Lampka nocna"` | `"Cieple swiatlo, gwint E14"`, details **expanded again** |
| `Escape` | off | visible | `myPresentsHeading` | preserved | preserved |
| Scrim tap | off | visible | `BODY` - `exitAddMode` *does* focus the heading, then the tap's own `mousedown` on the non-focusable scrim (it fires after `pointerup`) clears focus to the body. Pointer-only path, no keyboard/AT equivalent, so this is left as measured | preserved | preserved |
| **iOS-shaped close** (`f5`): blur the field, **then** click X (`activeElement = BODY` before the handler) | off | visible | **`myPresentsHeading`** - finding 4 | preserved | preserved |
| Scrim **drag** (120px) | **stays on** - treated as a scroll | hidden | unchanged | preserved | preserved |

### (g) Scrolling and clearance in add mode

| Assertion | Measured |
|---|---|
| Wheel scroll over the scrim | `scrollY` 0 → 369 (the scroll the gesture asked for), add mode unchanged |
| Entering while pinned to the very bottom | `scrollY` **524 → 524 at every sampled frame (0, 60, 150, 300, 450ms) - 0px jump**; `padding-bottom` 102px → 247px and `maxScroll` 524 → 669 grew underneath it, so the position can never be clamped |
| At max scroll in add mode | composer top 523; last list item ends 364 (**159px clear**), `Dodaj dla kogoś innego` ends 446 (**77px clear**) - nothing behind the composer |
| At max scroll in the compact state | last item 257px clear of the dock, `Dodaj dla kogoś innego` 77px clear of the composer |
| Closing while pinned to the very bottom | 47px upward clamp, spread over the 0.25s padding transition (ramp table in §4) |
| Dock steady state in add mode | `visibility: hidden`, `opacity: 0`, bar box top 794 / viewport 750, FAB box top 776 / viewport 750 - **both fully below the fold**; `elementFromPoint` at the FAB's centre returns `quickAddScrim` |
| Simulated on-screen keyboard (`visualViewport.height` 750 → 400) | `--quick-add-bottom` 12px → **358px**, composer bottom 738 → **392** (fits above the 350px keyboard), add mode unchanged |

### Other states

| Case | Result |
|---|---|
| **320×700** add mode | identical behaviour, head row 44px, close 44×44 visible, dock hidden, composer bottom 688 / 700. Screenshot `addmode-320-active.png` |
| **`prefers-reduced-motion: reduce`** | `.bottom-tab-bar`, `.quick-add-head` and `body` all compute `transition: none`. Measured across a **full cycle** this time (the review noted only entry was covered): 60ms after entering, dock `visibility: hidden` / `opacity 0`, head row 44px, padding already 247px; 60ms after leaving, dock `visibility: visible` / `opacity 1`, head row 0, padding already back to 200px - instant in both directions, no half-states |
| **1024×800 desktop** | `?add=1` ignored: `addMode false`, `docked false`, `activeElement BODY`. Scrim `display: none`, dock `display: none`, close `display: none`, head row 19px (the normal desktop title). Focusing the name field does **not** start add mode. After an add the name field **is** refocused (fast repeat kept) and the new item is highlighted. Screenshot `addmode-1024.png` - visibly identical to the pre-change card |
| **820×800 (769-991px gap)** | `docked false`, no add mode, dock `visibility: visible` and untouched, body padding 128px - behaves like desktop |
| **X5 `switchTab('add')` while in add mode** | add mode off, dock visible and `inert: false`, scrim down |
| **X5 resize 375 → 1024 while in add mode** | add mode off, dock `display: none`, close `display: none` - no stuck scrim or hidden bar |
| **X6 `+ Dodaj szczegóły` chip while in add mode** | add mode exits, dock restored, the `#editPresentModal` bottom sheet opens with `dialogBottom === innerHeight` (still a bottom sheet), textarea `rows="3"` / 120px tall (the taller default intact), `editPresentComments` focused |

### No regressions

Add ✔ (four submit paths above, including the iOS-shaped one), edit ✔ (bottom
sheet, focus, taller textarea, and the saved comment shows up in the list),
delete ✔ (6 → 5 items), the `+ Dodaj szczegóły` chip ✔ (present,
145×32 pill with its 44px hit area, `aria-label="Dodaj szczegóły do: …"`),
`Dodaj dla kogoś innego` ✔ (switches to `#addTab`, add mode off, dock visible
and not inert, recipient still pre-selected as `Mateusz`), Enter and
Ctrl/Cmd+Enter ✔, the `.is-new` highlight ✔, `visualViewport` keyboard lift ✔,
desktop layout ✔.

### Accessibility sweep

- `aria-expanded` on `#quickAddToggle` correct in **all four** states:
  S1 `false`, S2 `true`, S2b `false`, after every exit `false` - and now also
  checked at every step of the three chevron paths (pointer tap from S1,
  keyboard entry + `Enter`, and three consecutive taps inside add mode), where
  it tracked the row every time and the label swapped with it.
- `#quickAddClose` is in the tab order in add mode and out of it in the
  compact state - via `visibility: hidden`, not an offscreen clip, so it is
  genuinely unreachable rather than invisibly focusable.
- `.bottom-tab-bar` while hidden: `visibility: hidden` **plus** `inert`
  **plus** `aria-hidden="true"` → out of the accessibility tree and the tab
  order; verified by failing to focus both the `Dodaj` link and the FAB. Fully
  restored (`inert: false`, no `aria-hidden`, `visibility: visible`) after
  **every** exit path including X5 and X6.
- There is always a reachable way out for keyboard and screen-reader users:
  `#quickAddClose` (`aria-label="Zamknij formularz dodawania"` - gender-neutral
  Polish, sentence case) plus `Escape`.
- `#quickAddHeading` stays `visibility: visible` in both states (the compact
  state only clips it with the existing visually-hidden rule), so
  `<section aria-labelledby="quickAddHeading">` never loses its accessible
  name; in add mode the **same node** becomes visible, so there is no
  duplicated string.
- Not a modal: 0 `role="dialog"` outside the Bootstrap modals, no focus trap,
  `body` stays `overflow: visible`, scrim stays `aria-hidden="true"`.
- `#quickAddMessage` remains the only live region and still fires only on
  add/error. **No new announcements** for entering or leaving add mode.
- Labels are gender-neutral Polish in sentence case: `Dodaj nowy prezent`,
  `Zamknij formularz dodawania`, `Dodaj opis (opcjonalnie)` / `Ukryj opis`,
  `Szczegóły pomagają trafić`. Counts still go through
  `public/pluralize-pl.js` (`window.plCount` present, badge read
  `5 prezentów` / `7 prezentów` in the screenshots).

### Not measured

- A real iOS Safari engine. The two iOS-specific behaviours are **simulated**
  in the shape iOS produces (`activeElement = BODY` before the handler runs,
  rows `e6` and `f5`); the engine itself was not available. The chevron's
  iOS path (no `focusin` at all, so `click` alone decides) is reasoned from
  that same known behaviour - and it is the simpler of the two paths, since
  `keepDesc` simply never applies.
- The scrim-tap focus end state is left at `BODY` by the engine's own focus
  handling (see §5(f)); no attempt was made to fight it.

---

## 6. Screenshots (`.agents/tasks/screenshots/`)

All five were re-captured in iteration 2 from the rebuilt harness and looked
at: the composer reads as one card over the dimmed list, the X sits top-right
of the head row next to `+ Dodaj nowy prezent`, the green chevron circle is
down-left of the name field, and nothing is clipped at 320px.

| File | Shows |
|---|---|
| `addmode-375-idle.png` | compact state: slim bar, no head row, no close button, dock and FAB visible |
| `addmode-375-active.png` | add mode: title + close button in the head row, details open, dock and FAB gone, list dimmed, chevron green circle vs close grey square |
| `addmode-375-after-add.png` | after an add: composer collapsed, dock back, `Prezent dodany! 🎁`, new item highlighted |
| `addmode-320-active.png` | the same add mode at 320px with both fields filled |
| `addmode-1024.png` | desktop: inline green card, no close button, no scrim, sidebar nav - unchanged |

---

## 7. Still to do by the orchestrator

- `public/sw.js` `CACHE_NAME` bump (not touched here).
- `tab-bar-functions.js?v=16` → `?v=17` in `leaderboard.html` and
  `wiadomosci.html` when those files become editable (see §3).
