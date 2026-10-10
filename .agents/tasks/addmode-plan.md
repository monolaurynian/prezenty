# Add mode for the quick-add composer - implementation plan

Turns the mobile quick-add composer on **Dodaj i edytuj moje prezenty**
(`formularz.html` → `#editTab`) into an explicit ADD MODE with a clear
open/close lifecycle. Everything below was derived by reading
`public/formularz.html`, `public/formularz.js`, `public/tab-bar-functions.js`,
`public/bottom-tab-bar.css`, `public/app-theme.css`,
`public/bottom-tab-bar-snippet.html`, `public/sw.js` (read-only) and the two
verification docs.

---

## 0. Findings that shape the plan

- **`bottom-tab-bar-snippet.html` is a dead template.** It is not included by any
  page (pages have their own inline `.bottom-tab-bar` markup, and it carries its
  own duplicate `toggleTabBarMenu`/`loadNotifications` script). `formularz.html`
  has the real bar inline at lines 1294-1325. **Do not edit the snippet** - it
  would change nothing and only add diff noise.
- **The `Dodaj` tab is per-page inline markup**, identical on every page:
  `<a href="formularz.html" class="tab-item form-tab">`. Pages: `activity.html:962`,
  `formularz.html:1312` (+`active`), `home.html:1190`, `leaderboard.html:1423`,
  `recipients.html:2476`, `rezerwacje.html:305`, `ustawienia.html:706`,
  `wiadomosci.html:741` (+ the dead snippet and `tab-bar-demo.html`). The only
  *shared* hook is `tab-bar-functions.js`, loaded as `?v=16` by eight pages.
  `leaderboard.html` and `wiadomosci.html` are on the do-not-edit list, so the
  marker **must** come from the shared script, not from per-page hrefs (see §4).
- **The desktop sidebar does not use `.tab-item`.** `desktop-nav.js` builds its own
  `href: '/formularz.html'` items with its own classes, so a delegated
  `a.tab-item.form-tab` handler cannot fire on desktop nav.
- **`body.quick-add-active` already exists** and already drives the scrim
  (`formularz.html` lines ~845-875) and the opaque composer surface. It is
  toggled only from `setupQuickAddComposer`, and no other file reads it
  (grepped). It becomes the add-mode class (§1) - no second class, so the two can
  never desynchronise.
- **`window._resetQuickAddComposer` / `window._updateQuickAddComposer`** are read
  only inside `formularz.js`. Safe to rename.
- **The tab bar is hidden on ≥992px** by `app-theme.css`
  `body.has-desktop-nav .bottom-tab-bar { display: none !important }`, and the
  mobile composer only exists at ≤768px. So 769-991px keeps the desktop inline
  card *and* a visible bar: add mode must simply never activate there.
- **`sw.js` runtime-caches by request URL** inside `CACHE_NAME` (`prezenty-v120`),
  and `?v=` is only a cache-buster - the server returns the current file for any
  `?v`. So the final step's cache bump refreshes even
  `tab-bar-functions.js?v=16`, which is why the two un-editable pages degrade
  only temporarily (§7).
- No test runner in this repo (`npm test` is a stub). Verification = `node --check`
  plus the established Playwright-over-Edge harness in `%TEMP%` (see
  `.agents/tasks/formularz-scrim-verification.md`).

---

## 1. The add-mode state machine

One class is the single source of truth: **`body.quick-add-active` = "add mode is
on"**. `body.quick-add-docked` keeps its current meaning ("the mobile composer is
fixed above the bar") and is the precondition for add mode.

### States

| State | Condition | Scrim | Details (`.is-expanded`, `aria-expanded`) | Tab bar | Head row / close | `--quick-add-bottom` | Body padding-bottom |
|---|---|---|---|---|---|---|---|
| **S0 OFF** | `>768px`, or `#editTab` hidden (not docked) | `display:none` (desktop) / off | desktop: textarea always visible, chevron `display:none` | normal (hidden ≥992px by `has-desktop-nav`) | close `display:none` | n/a | `has-tab-bar` default |
| **S1 COMPACT** | docked, no `quick-add-active` | off | collapsed, `aria-expanded="false"` | visible, interactive | collapsed (`max-height:0`, `visibility:hidden`) → close not tabbable | `tabBarOffset()` ≈ inset + barH + fabPoke + 8 ≈ 100px | `bottom + h + 20` ≈ 190px |
| **S2 ADD / details open** | docked + `quick-add-active` | visible, `pointer-events:auto` | expanded, `aria-expanded="true"` | hidden: `visibility:hidden` + `opacity:0` + `translateY` + JS `inert`/`aria-hidden` | visible, close is 44×44 and tabbable | `max(barInset, 12px)`, or `keyboard + 8` when the OSK is up | `bottom + h + 20` ≈ 260px |
| **S2b ADD / details collapsed** | S2 after a chevron collapse (`descDismissed = true`) | visible | collapsed, `aria-expanded="false"` | hidden | visible | same as S2 | recomputed (smaller `h`) |

Add mode is **not** a dialog: no `role="dialog"`, no focus trap, no body scroll
lock, the scrim stays `aria-hidden="true"`.

### Entry transitions (all require docked, i.e. ≤768px and `#editTab` visible)

| # | Trigger | Effect |
|---|---|---|
| **E1** | `focusin` anywhere in `#quickAddForm` (tap/Tab into name, textarea, chevron, `+`, close) | enter |
| **E2** | `input` in `#quickAddTitle` / `#quickAddComments` | enter (safety net after a suppression window) |
| **E3** | Chevron tapped while in S1 | enter, then details open + textarea focused (its own `focusin` is idempotent) |
| **E4** | `?add=1` present on load, user authenticated, docked | enter **with focus** on `#quickAddTitle` |
| **E5** | `Dodaj` tab tapped while already on the page | `preventDefault()`, enter **with focus** on `#quickAddTitle` |

**Every entry does, in this order:** (1) re-entrancy guard; (2) if `opts.focus` or
`document.activeElement` is inside `.bottom-tab-bar`, `#quickAddTitle.focus({preventScroll:true})`
*first*, so focus is never left inside the element we are about to hide;
(3) `descDismissed = false` and `setDescExpanded(true)` → details open +
`aria-expanded="true"`; (4) add `body.quick-add-active` → scrim fades in, head row
+ close appear, tab bar slides out; (5) `bar.inert = true`,
`bar.setAttribute('aria-hidden','true')`; (6) `updateComposerLayout()` → new
`--quick-add-bottom` / `--quick-add-h` / padding. **Field values are never
touched on entry.**

### Exit transitions

| # | Trigger | Moves focus to `#myPresentsHeading`? | Clears fields? |
|---|---|---|---|
| **X1** | Close button (`#quickAddClose`) | yes (focus is inside the form) | no |
| **X2** | Scrim tap (tap, not drag - existing 12px/700ms discrimination) | only if focus is still inside the form | no |
| **X3** | `Escape` | yes | no |
| **X4** | Successful add | yes | yes - `quickAddPresent()` clears them *before* exiting |
| **X5** | No longer docked: desktop resize, `switchTab('add')`, `#editTab` hidden | no (leave focus alone) | no |
| **X6** | `#editPresentModal` `show.bs.modal` | no | no |

**Every exit does:** (1) remove `body.quick-add-active` → scrim fades out, head row
collapses, bar slides back; (2) `bar.inert = false`, remove `aria-hidden`;
(3) `descDismissed = false` + `setDescExpanded(false)` → `aria-expanded="false"`;
(4) if `document.activeElement` is inside the form: `blur()` it (this is what
closes the on-screen keyboard) and then focus `#myPresentsHeading`
(`tabindex="-1"`, `preventScroll: true`) for X1/X3/X4 and for X2 when focus was
still inside; (5) `suppressActivateUntil = Date.now() + 300` so the same tap
cannot immediately re-enter; (6) `updateComposerLayout()`. **Field values are
never cleared by an exit.**

### Explicitly *not* exits any more

- **Chevron collapse** - it is a details toggle only (today it also dismissed the
  scrim). See §5.
- **`focusout` / blur** - the whole `focusout` + `blurTimer` + `composerPointerAt`
  machinery is deleted. Add mode now ends only on an explicit signal, which is
  what makes "closing does not discard typed text" true, and it removes the iOS
  "buttons don't take focus on tap" race the current code works around.
  *Tradeoff:* dismissing the on-screen keyboard with the keyboard's own
  Done/▼ button leaves add mode on (scrim up, bar still hidden) - correct, because
  the visible close button and the scrim are both one tap away.

### Layout consequences (no clipping, no jump)

- `tabBarOffset()` gains an early branch: when add mode is on and we are docked,
  return `Math.max(parseFloat(getComputedStyle(bar).bottom) || 0, 12)` - i.e. the
  bar's own `bottom: max(12px, env(safe-area-inset-bottom))`, so the safe-area
  inset is preserved automatically and the composer drops to the dock's inset
  instead of floating ~90px above nothing. Fall back to `12` when there is no bar.
- The composer already has `transition: bottom 0.25s ease` and the bar already has
  `transition: transform .3s …, opacity .3s …` in `bottom-tab-bar.css`, so the two
  move together.
- Padding: `body.has-tab-bar.quick-add-docked` already derives from
  `--quick-add-bottom + --quick-add-h + 20px`. On entry `bottom` shrinks ~88px
  while `h` grows ~150px (head + details) → padding **grows**, which cannot clamp
  the scroll position. On exit it shrinks, and because `--quick-add-h` is driven by
  the `ResizeObserver` on the form, it shrinks *progressively* as the composer
  collapses rather than in one step. A residual browser scroll clamp is possible
  only when the user sits at the very bottom of the page; measure it in the harness
  and accept ≤4px.

---

## 2. Requirement 1 - details open with the form

- **Delete** the whole `nameInput.addEventListener('input', …)` progressive-disclosure
  block (`formularz.js` ~lines 517-531: expand on first character, collapse when the
  name is cleared). Keep the separate `onComposerInput` listener (renamed, see §3).
- Details now open as part of **entry** (`setDescExpanded(true)` in `enterAddMode`).
- `descDismissed` survives only for the current add-mode session: set to `true` on a
  manual chevron collapse, reset to `false` on every entry *and* every exit. So a
  manual collapse sticks for the rest of the session and details reopen the next
  time add mode is entered.

## 3. Requirement 3 - collapse and blur after a successful add

In `quickAddPresent()`:

- Replace `if (window._resetQuickAddComposer) window._resetQuickAddComposer();`
  with `if (window.exitQuickAddMode) window.exitQuickAddMode('added');`.
- In `.finally()`, replace `if (added && input) input.focus({ preventScroll: true });`
  with a docked check: refocus the name input **only when not docked** (desktop keeps
  today's fast-repeat behaviour); when docked, do nothing - `exitQuickAddMode` has
  already blurred and moved focus. Expose a tiny `window.isQuickAddDocked()` (or read
  `document.body.classList.contains('quick-add-docked')`) for that check.
- Keep the success pill (`showQuickAddMessage('Prezent dodany! 🎁','success')`,
  `role="status"` / `aria-live="polite"`, auto-hides after 4s) and
  `loadMyPresents(data.presentId || 'first')` → `revealNewPresent()` highlight
  untouched. **No new live-region announcements** for enter/exit.

*Tradeoff to note in the verification doc:* fast repeat adding now costs one extra
tap (tap the name field → add mode again). Mitigations kept: the composer stays
docked in its compact form (one tap, nothing to scroll to), the fields are cleared,
the success pill confirms, and the new item still flashes - and the flash is
actually visible now, because the scrim is down and the bar is back.

## 4. Requirement 2 - the `Dodaj` marker

**Chosen mechanism: `formularz.html?add=1`** (a query param, not `#dodaj`:
`history.replaceState` can drop a param cleanly while still leaving any existing
`?osoba=` deep-link intact, and the hash would fight the browser's
scroll-to-fragment).

**Where it is added: one delegated capture handler in `tab-bar-functions.js`** -
*not* per-page hrefs. Rationale: `leaderboard.html` and `wiadomosci.html` carry a
`Dodaj` tab but are on the do-not-edit list, so per-page hrefs cannot cover them;
the shared script can. The handler is ~12 lines, touches only
`a.tab-item.form-tab` links whose href points at `formularz`, never calls
`preventDefault()` unless `window.enterQuickAddMode` exists and returns `true`, and
is a no-op on every page that has no such link. The menu-panel item
`a.tab-bar-menu-item.edit-presents-item` ("Edytuj moje prezenty") is deliberately
**not** matched - that is an edit intent, not an add intent.

Sketch (append at the end of `tab-bar-functions.js`):

```js
// ---- "Dodaj" tab opens the add composer on the form page ----
// Marks the navigation with ?add=1 so formularz.js knows to enter add mode
// and focus the name field. Already on the form page: formularz.js handles
// it in place (no reload). Only touches .tab-item.form-tab links that point
// at formularz - a no-op everywhere else.
document.addEventListener('click', function (e) {
    const link = e.target.closest && e.target.closest('a.tab-item.form-tab');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!/formularz(\.html)?($|[?#])/.test(href) || href.indexOf('add=1') !== -1) return;
    if (typeof window.enterQuickAddMode === 'function' &&
        window.enterQuickAddMode({ focus: true })) {
        e.preventDefault();   // already here - no reload
        return;
    }
    link.setAttribute('href', href + (href.indexOf('?') === -1 ? '?' : '&') + 'add=1');
}, true);
```

No `preventDefault` on the navigating path, so middle-click / modifier-click /
long-press keep working; the rewrite is idempotent.

**In `formularz.js`, at module scope (before any async work):**

```js
let pendingAddMode = false;
try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('add') === '1') {
        pendingAddMode = true;
        p.delete('add');
        const qs = p.toString();
        history.replaceState(null, '',
            window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    }
} catch (e) {}
```

The param is stripped **immediately**, before `checkAuth()` resolves, so refresh /
back / forward never re-trigger add mode. Other params (`?osoba=`) are preserved -
`loadRecipients()` reads `?osoba=` later from `window.location.search`, so the
rewrite must keep it. Then, in `checkAuth()`'s authenticated branch, after
`document.getElementById('editTab').style.display = 'block'; loadMyPresents();`:

```js
if (pendingAddMode) {
    pendingAddMode = false;
    if (window.enterQuickAddMode) window.enterQuickAddMode({ focus: true });
}
```

Not authenticated, or not docked (desktop / 769-991px) → the marker is simply
ignored (`enterQuickAddMode` returns `false`). A plain visit to `formularz.html`
never auto-focuses.

**iOS caveat to record:** a programmatic `.focus()` outside a user gesture does not
open the on-screen keyboard on iOS Safari, so E4 (arriving with `?add=1`) gives the
field focus and the open composer, but the keyboard appears on the first tap. E5
(already on the page) runs inside the click gesture, so the keyboard does open.
This is a platform limit, not a bug to chase.

## 5. Requirements 4 + 5 - hidden tab bar, close button, chevron role

### Tab bar hiding (CSS only, in `formularz.html`'s own inline `<style>`)

Inside the existing `@media (max-width: 768px)` block, after the
`body.quick-add-active .quick-add-composer` rule:

```css
/* Add mode owns the thumb zone: the dock (and the FAB inside it) slide
   out. visibility:hidden - not just a transform - so the bar leaves the
   accessibility tree and the tab order while hidden. formularz.js also
   sets inert/aria-hidden on it. The composer drops to the dock's own
   inset (see tabBarOffset) so nothing is clipped. */
body.quick-add-active .bottom-tab-bar {
    transform: translateY(calc(100% + 28px));
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        opacity 0.3s ease, visibility 0s linear 0.3s;
}
```

- Higher specificity than `.bottom-tab-bar.tab-bar-hidden` **and** later in the
  cascade (the inline `<style>` blocks follow the `bottom-tab-bar.css` link), so the
  scroll auto-hide in `tab-bar-functions.js` cannot fight it.
- On exit the rule stops applying, the base transition animates the bar back and
  `visibility` returns to `visible` immediately (correct - appearing must not be
  delayed).
- Add `body.quick-add-active .bottom-tab-bar` to the existing
  `@media (prefers-reduced-motion: reduce)` `transition: none !important` group
  (`formularz.html` ~lines 876-888). The *return* animation comes from the shared
  base rule in `bottom-tab-bar.css`, which we are not editing; that is the same
  behaviour the existing scroll auto-hide already has, so it is accepted, not
  regressed.
- **No shared stylesheet is edited**, therefore **no `bottom-tab-bar.css` /
  `app-theme.css` `?v=` churn on other pages.**

### Close button

A new **head row** at the top of the composer, visible in add mode only:
`[ Dodaj nowy prezent        (X) ]`.

- `#quickAddClose`: 44×44, `border-radius: 12px` (rounded square), `#eef1f4`
  background, `#44515e` icon, `fa-xmark` glyph, `aria-label="Zamknij formularz dodawania"`
  (gender-neutral, Polish sentence case), `type="button"`,
  `:focus-visible { outline: 3px solid #1a56db }` matching the toggle/submit.
- The head row carries the existing `#quickAddHeading` h6. On mobile the heading
  stays screen-reader-only in S1 (it names the `<section>` via `aria-labelledby`)
  and becomes **visible** in add mode via an add-mode override of the
  visually-hidden clip, so there is no duplicated string and no empty accessible
  name.
- Collapsed in S1 exactly like the desc row (`max-height: 0; overflow: hidden;
  visibility: hidden`), so the compact bar keeps its current slim height and the
  close button is **not** in the tab order when there is nothing to close.
- Desktop: `.quick-add-close { display: none; }` in the base block (same pattern as
  `.quick-add-toggle`).

### Chevron vs close - decision

**The chevron stays a details toggle and nothing else.** It keeps
`aria-controls="quickAddDescWrap"`, keeps `aria-expanded` in sync at every
transition, and keeps its label swap (`Ukryj opis` / `Dodaj opis (opcjonalnie)`).
It no longer dismisses the scrim (today's `else deactivateComposer(300)` branch is
removed) - a control that sometimes collapses a field and sometimes exits the whole
mode is exactly the ambiguity the requirement warns about. The two are kept
visually unconfusable on three axes: **position** (chevron bottom-left of the input
row vs close top-right of the head row), **shape** (48px circle vs 44px rounded
square), **glyph** (chevron vs ×), plus colour (the chevron turns green while
expanded, the close button stays neutral grey).

### Typed text on close

Closing is a pure state change: `enterAddMode`/`exitAddMode` never read or write
`#quickAddTitle.value` or `#quickAddComments.value`. Reopening therefore shows
exactly what was typed, with details expanded again (so nothing stays hidden even
if the user had collapsed them with the chevron). Only a successful add clears the
fields, and it does so in `quickAddPresent()` before exiting.

## 6. Desktop decision (≥769px)

Desktop must look and behave as it does today. Of the five behaviours:

| Requirement | Desktop | Why |
|---|---|---|
| 1 - details open with the form | **already true, no change** | the textarea is permanently visible in the green card; the chevron is `display:none` |
| 2 - `Dodaj` opens + focuses the form | **no** | the card is already at the top of the page and fully visible; grabbing focus on navigation would scroll-jack and fight the mouse. `?add=1` is stripped but ignored |
| 3 - collapse + blur after add | **no** | nothing to collapse, and blurring would break fast repeat adding with a keyboard. Desktop keeps today's refocus of the name input |
| 4 - hide the bottom tab bar | **no** | ≥992px there is no bar (desktop sidebar); 769-991px the bar is navigation, not an obstacle, and there is no thumb zone to free |
| 5 - close button | **no** (`display: none`) | the form is a permanent inline card, not an overlay - there is nothing to close |

Mechanically this falls out of one guard: add mode requires
`body.quick-add-docked`, which `updateComposerLayout()` only sets at ≤768px with
the composer actually `position: fixed`. 769-991px behaves like desktop.

---

## Implementation steps

> **Editing rule for every step: targeted `str_replace` only.** Never rewrite a
> whole file and never write by line offset - a recent full-file write silently
> corrupted a `<link>` tag in this repo. After each HTML edit, **re-read the edited
> region (±15 lines)** and confirm the surrounding lines - especially neighbouring
> `<link>` / `<script>` / `<style>` boundaries - are intact. `formularz.html` is
> 1275 lines; `formularz.js` is 1142.
> The repo lives in OneDrive: a read can fail with a cloud/UNKNOWN error - wait a
> few seconds and retry rather than switching to a different write strategy.

- [ ] 1. **`formularz.html`: head row markup + its CSS.**
      Wrap `#quickAddHeading` (line ~1059) in `<div class="quick-add-head">` and add
      `#quickAddClose` next to it inside that wrapper, keeping the h6's id and text.
      CSS: move `grid-area: heading` from `.quick-add-heading` (line ~508) onto a new
      `.quick-add-head { grid-area: heading; display: flex; align-items: center;
      justify-content: space-between; gap: 8px; }` in the desktop block, add
      `.quick-add-close { display: none; }` next to `.quick-add-toggle { display: none; }`
      (line ~516); in the `@media (max-width: 768px)` block add `head` to
      `grid-template-areas` (line ~721) as
      `"head head head" / "toggle name submit" / "desc desc submit"`, the collapsed
      `.quick-add-head` rule, `body.quick-add-active .quick-add-head` (visible,
      `max-height: 56px`, `margin-bottom: 6px`), the add-mode override that un-hides
      `.quick-add-heading` (`position: static !important; width/height: auto !important;
      margin: 0 !important; clip: auto !important; overflow: visible !important;` plus
      `font-size: 0.9rem`), and the `.quick-add-close` mobile rule (44×44,
      `border-radius: 12px`, `#eef1f4`, `#44515e`, `font-size: 1.1rem`) with a
      `:focus-visible` outline. Add `.quick-add-head` to the reduced-motion
      `transition: none !important` group (~line 876). Also add `tabindex="-1"` to
      `#myPresentsHeading` (line ~1089) - the exit focus target.
      Files: `public/formularz.html`
      Verify: `node -e "..."` is not applicable to HTML; instead load the page in the
      harness (step 9) at 375px and 1024px and assert: compact head row
      `getBoundingClientRect().height === 0` and `visibility: hidden`; close button
      `display: none` at 1024px; desktop heading still renders as today
      (screenshot diff against `.agents/tasks/screenshots/formularz-opacity-768.png`
      region). Until step 3 lands, the class is never set, so the page must look
      byte-for-byte the same as before at both widths.

- [ ] 2. **`formularz.html`: tab-bar hiding CSS.**
      Add the `body.quick-add-active .bottom-tab-bar` rule from §5 inside the existing
      `@media (max-width: 768px)` block, directly after
      `body.quick-add-active .quick-add-composer` (~line 869), and add the same
      selector to the reduced-motion group.
      Files: `public/formularz.html`
      Verify: in the harness at 375px, `document.body.classList.add('quick-add-active')`
      by hand → the bar computes `visibility: hidden`, `opacity: 0`, and
      `document.querySelector('.bottom-tab-bar a').matches(':focus')` is impossible
      (focus() leaves `activeElement` as `body`); removing the class restores
      `visibility: visible`. At 1024px the rule must not apply.

- [ ] 3. **`formularz.js`: the add-mode state machine in `setupQuickAddComposer`.**
      Replace `activateComposer` / `deactivateComposer` with
      `enterAddMode(opts)` / `exitAddMode(reason)` implementing §1 exactly (entry
      order: focus-first, then class, then `inert`/`aria-hidden`, then layout; exit
      order: class, attributes, `setDescExpanded(false)`, blur + focus
      `#myPresentsHeading`, 300ms suppression, layout). Expose
      `window.enterQuickAddMode = (opts) => enterAddMode(opts)` returning `true` only
      when it actually entered, `window.exitQuickAddMode = exitAddMode`, and keep
      `window._updateQuickAddComposer`. Delete: the `nameInput` progressive-disclosure
      `input` listener (§2), the `form` `focusout` listener, `blurTimer`,
      `composerPointerAt` and the document-level capture `pointerdown` listener.
      Rewire: `focusin` → `enterAddMode()`; the chevron handler → details only
      (`descDismissed = !open`, no deactivate); `#quickAddClose` click →
      `exitAddMode('close')`; `Escape` → `exitAddMode('escape')` (keep the
      `e.preventDefault()` when focus is inside the composer so engines don't revert
      the input value); scrim tap/drag discrimination unchanged but calling
      `exitAddMode('scrim')`; `updateComposerLayout()`'s non-docked branch →
      `exitAddMode('undocked')`. Add the add-mode early branch to `tabBarOffset()`
      (§1) and a `#editPresentModal` `show.bs.modal` listener → `exitAddMode('modal')`.
      Guard `enterAddMode` with `mobileQuery.matches && body.classList.contains('quick-add-docked')`.
      Files: `public/formularz.js`
      Verify: `node --check public/formularz.js` exits 0, then the harness matrix in
      step 9 (entry/exit for E1-E3, X1-X3, X5, X6).

- [ ] 4. **`formularz.js`: post-add behaviour (requirement 3).**
      In `quickAddPresent()` swap `_resetQuickAddComposer` for
      `window.exitQuickAddMode('added')` (~line 430) and make the `.finally()` refocus
      conditional on **not** being docked (~line 447).
      Files: `public/formularz.js`
      Verify: `node --check` exits 0; harness: a stubbed successful POST leaves
      `body.quick-add-active` absent, `.is-expanded` false, `aria-expanded="false"`,
      the bar `visibility: visible`, `document.activeElement.id === 'myPresentsHeading'`,
      both fields empty, the success pill shown, and the new item carrying `.is-new`.

- [ ] 5. **`formularz.js`: the `?add=1` marker (requirement 2).**
      Add the module-scope parse + `history.replaceState` block from §4 near the top
      (after the `localStorage` fast-path `try` block, ~line 22), and the
      `pendingAddMode` hand-off inside `checkAuth()`'s authenticated branch
      (~line 163, after `loadMyPresents()`).
      Files: `public/formularz.js`
      Verify: `node --check` exits 0; harness: load `harness.html?add=1` →
      `location.search` no longer contains `add`, add mode is on, `#quickAddTitle` is
      `activeElement`; load `harness.html?add=1&osoba=Babcia` → `?osoba=Babcia`
      survives and the recipient pre-selection still happens; reload the cleaned URL →
      no add mode; load plain `harness.html` → no add mode, no focus change.

- [ ] 6. **`tab-bar-functions.js`: the delegated `Dodaj` handler.**
      Append the handler from §4 at the end of the file. Nothing else in that file
      changes.
      Files: `public/tab-bar-functions.js`
      Verify: `node --check public/tab-bar-functions.js` exits 0; harness: clicking the
      `Dodaj` tab on the form page does **not** navigate and enters add mode with focus;
      on a second harness page that has the bar but no `formularz.js`, the same click
      rewrites the href to `formularz.html?add=1` and navigates normally; clicking
      `Główna`, `Aktywność`, `Czat`, the FAB, and the menu item
      `Edytuj moje prezenty` behaves exactly as before (notification panel still opens,
      menu still toggles, `edit-presents-item` href unchanged).

- [ ] 7. **Cache-busters.**
      `public/formularz.html`: `formularz.js?v=19` → `?v=20` (line ~1274) and
      `tab-bar-functions.js?v=16` → `?v=17` (line ~1397). Then `?v=16` → `?v=17` for
      `tab-bar-functions.js` on every other page that may be edited:
      `activity.html:1037`, `home.html:1501`, `recipients.html:2442`,
      `rezerwacje.html:380`, `ustawienia.html:781`.
      **Deliberately NOT bumped (do-not-edit list):** `leaderboard.html:1509` and
      `wiadomosci.html:816` - both load `tab-bar-functions.js?v=16` and both carry a
      `Dodaj` tab. Until their cached copy is revalidated their `Dodaj` tab navigates
      without `?add=1` (the form opens normally, just without auto-focus) - graceful
      degradation, nothing breaks. The final step's `sw.js` `CACHE_NAME` bump
      (`prezenty-v120` → next) drops the stale entries, after which even the `?v=16`
      URL returns the new script. **Report both pages to the merge step.**
      No other `?v=` changes: `bottom-tab-bar.css?v=41` and `app-theme.css?v=14` are
      untouched because all new CSS lives in `formularz.html`'s inline `<style>`.
      Files: `public/formularz.html`, `public/activity.html`, `public/home.html`,
      `public/recipients.html`, `public/rezerwacje.html`, `public/ustawienia.html`
      Verify: `Select-String -Path public/*.html -Pattern 'tab-bar-functions\.js\?v=\d+'`
      lists `?v=17` for the six edited pages and `?v=16` only for `leaderboard.html`
      and `wiadomosci.html`; `formularz.js?v=20` appears exactly once. Re-read ±10
      lines around each edited `<script>` tag to confirm no neighbouring tag was
      damaged.

- [ ] 8. **Accessibility + no-regression sweep (read-and-fix pass).**
      Walk the list and fix anything broken: `aria-expanded` on `#quickAddToggle`
      correct in all four states; `#quickAddClose` reachable by Tab in add mode and
      skipped in compact; `.bottom-tab-bar` not focusable while hidden (`inert`,
      `aria-hidden`, `visibility: hidden`) and fully restored after every exit path
      including X5/X6; no `role="dialog"`, no focus trap, no `body` scroll lock, scrim
      still `aria-hidden="true"`; `#quickAddMessage` is the only live region and fires
      only on add/error; labels still gender-neutral Polish sentence case.
      Files: `public/formularz.html`, `public/formularz.js` (fixes only)
      Verify: part of the harness matrix in step 9 - each row asserted explicitly.

- [ ] 9. **Verification harness + evidence doc.**
      Rebuild the harness exactly as in `.agents/tasks/formularz-scrim-verification.md`:
      `playwright-core@1.47.2` in `%TEMP%\prezenty-addmode` (outside the repo, deleted
      afterwards) driving the locally installed Edge, headless,
      `deviceScaleFactor: 2`, `isMobile`/`hasTouch`, viewports 320×700, 375×750 and
      1024×800; `build.js` copies the real `public/` into the temp dir and writes
      `harness.html` from the real `formularz.html` with one injected script stubbing
      `/api/auth`, `/api/user/identification`, `/api/formularz/recipients`,
      `/api/formularz/my-presents`, `/api/formularz/present`, `/api/presents/:id` with
      ~6 seeded presents. Assert the full matrix: every E1-E5 and X1-X6 transition
      against the §1 table (scrim opacity/visibility, `.is-expanded`,
      `aria-expanded`, bar `visibility`/`inert`, head row height, `activeElement`,
      both field values, computed `--quick-add-bottom`/`--quick-add-h` and
      `body` `padding-bottom`); chevron collapse keeps add mode and sticks for the
      session; close preserves typed text and reopening restores it with details
      expanded; `scrollY` before/after entry and exit while scrolled to the bottom
      (≤4px); `prefers-reduced-motion: reduce` removes the new transitions; no
      regression in add / edit (`#editPresentModal` bottom sheet still slides from the
      bottom, taller textarea intact) / delete / the `+ Dodaj szczegóły` chip /
      `Dodaj dla kogoś innego` / Enter and Ctrl+Enter submit / the `.is-new` highlight /
      the `visualViewport` keyboard lift (simulated) / 1024px desktop unchanged.
      Also run `node --check` on `public/formularz.js` and `public/tab-bar-functions.js`,
      and `git -P diff --stat` to confirm the diff contains only the files listed in
      step 7 plus `public/formularz.js` and `public/tab-bar-functions.js`.
      Files: `.agents/tasks/addmode-verification.md` (new), plus screenshots under
      `.agents/tasks/screenshots/` (`addmode-375-compact.png`,
      `addmode-375-active.png`, `addmode-375-details-collapsed.png`,
      `addmode-320-active.png`, `addmode-1024.png`)
      Verify: the doc records every matrix row with its measured value, the known
      tradeoffs (fast-repeat costs one tap; iOS keyboard on E4; the two un-bumped
      pages; the bar's return transition under reduced motion), and `node --check`
      exit codes.

---

## Assumptions

- "The menu" in the user's request means the bottom tab bar's `Dodaj` tab (the FAB
  menu panel has no `Dodaj` entry, only `Edytuj moje prezenty`, which keeps its
  current add-mode-free behaviour).
- Tapping the `+ Dodaj szczegóły` chip or a card's edit button while add mode is on
  still needs two taps (the first lands on the scrim and exits). That is today's
  scrim behaviour and is left as is.
- `fa-xmark` is used for the close glyph; the page loads Font Awesome 6.0.0, where
  that name exists.
