# Add mode for the quick-add composer on formularz.html

The mobile quick-add composer gets an explicit open/close lifecycle: `body.quick-add-active`
is the single state flag, entered on focus/typing/`?add=1`/a tap on the dock's **Dodaj** tab,
and left by a new 44×44 close button, Escape, a scrim tap, a successful add, undocking or the
edit bottom sheet opening. Entering opens the description row and slides the whole bottom dock
(including the floating red FAB) out of the thumb zone via page-local CSS; leaving restores it.
The old `focusout` / `blurTimer` / document-level `pointerdown` machinery and the "expand the
description on the first keystroke" listener are deleted, which is what makes "closing never
discards typed text" true. Desktop is deliberately untouched — everything hangs off the single
`refreshDocked()` guard that is only true at ≤768px with the composer actually `position: fixed`.

Watch for: tapping the chevron **from the compact bar** now collapses the description it just
opened on any engine that focuses buttons on tap (Chromium/Android), because `focusin` →
`enterAddMode()` expands the row before the chevron's own click handler reads
`!isDescExpanded()` (confirmed by reading `formularz.js:505-513, 565-600, 617-630`). That path
(plan E3) is the one row missing from the harness matrix. Everything else in the gate list
holds up under the diff and the captured evidence.

**Verdict**: NEEDS_CHANGES

## High-level view

The state machine is coherent and single-sourced. `body.quick-add-active` drives the scrim, the
head row, the description row and the dock-hiding CSS; `refreshDocked()` is the only gate, so
desktop and the 769-991px band fall out as "add mode never exists" without a second code path.
`exitAddMode` is idempotent, resets `descDismissed`, restores `inert`/`aria-hidden` on the bar
and recomputes the layout vars on every reason including `undocked` and `modal`, so there is no
path that can leave a hidden dock or a stuck scrim behind.

The one real defect is the chevron. Entering add mode expands the description, and the chevron's
click handler derives its intent from the *post-entry* DOM state. On engines that focus a
`<button>` on tap, a tap on the chevron in the compact bar therefore reads as "collapse": add
mode opens, the description closes, and `descDismissed = true` sticks for the rest of the
session — the inverse of what the control's own label (`Dodaj opis (opcjonalnie)`) promised, and
a direct dent in requirement 1.

The shared-file edit is one 24-line capture-phase click handler scoped to `a.tab-item.form-tab`
links whose href points at `formularz`, calling `preventDefault()` only when
`window.enterQuickAddMode` exists and actually entered — so pages without `formularz.js` navigate
exactly as before and middle-click/modifier-click survive. `formularz.js` strips `?add=1` with
`history.replaceState` at module scope before any async work, preserving `?osoba=`. The
`?v=16 → ?v=17` bump landed on six of the eight pages that load the script; `leaderboard.html`
and `wiadomosci.html` are on this task's do-not-edit list and are listed as a carry-over with the
degradation spelled out.

The dock hiding is entirely page-local — `bottom-tab-bar.css` and `app-theme.css` are untouched,
and the new `body.quick-add-active .bottom-tab-bar` rule wins over `.bottom-tab-bar.tab-bar-hidden`
on cascade order (the inline `<style>` at line 475 follows the stylesheet link at line 18;
specificity is equal at 0,2,0, not higher as the verification doc claims — order is what
actually resolves it). `visibility: hidden` plus JS `inert` plus `aria-hidden` take the bar out of
both the tab order and the a11y tree, verified by failed focus attempts on the `Dodaj` link and
the FAB. No `role="dialog"`, no focus trap, no scroll lock, scrim still `aria-hidden`.

Exit focus is the one accessibility soft spot: `exitAddMode` only parks focus on
`#myPresentsHeading` when `document.activeElement` is still inside the form, which is not the case
on iOS Safari where tapping the X blurs the input first.

The forbidden files are clean. `public/sw.js`, `public/wiadomosci.html` and
`public/chat-reactions.css` are modified in the working tree, but every hunk belongs to the
earlier chat-reactions / chat-noscroll tasks (precache entries + `CACHE_NAME v119→v120`, chat
wrapping rules, `app-theme.css?v=13→14`); nothing add-mode-related appears in them.
`leaderboard.html`, `chat-reactions.js`, `notification-text.js` and `server.js` are untouched.
`formularz.js?v=19 → ?v=20` was bumped, and all `<link>`/`<script>`/`<style>` boundaries in the
edited HTML are intact.

<details>
<summary>Issues (4)</summary>

1. **Chevron from the compact bar inverts (blocking)** — `focusin → enterAddMode()` expands the
   description before the chevron's click handler computes `open = !isDescExpanded()`, so on
   Chromium/Android a tap on the chevron in the compact state enters add mode and immediately
   collapses the description, setting `descDismissed = true` for the session. Fix by making the
   intent explicit rather than state-derived — e.g. pass the focus origin
   (`form.addEventListener('focusin', e => enterAddMode({ fromToggle: e.target === toggle }))`)
   and skip `setDescExpanded(true)` on that entry, letting the click handler open it.
2. **Missing harness row for plan E3 (blocking, with 1)** — the matrix tests the chevron only *from* add mode
   (§5(d)), never from the compact bar, which is why issue 1 was not observed. Add a
   compact → chevron-tap row asserting add mode on, `is-expanded` true,
   `aria-expanded="true"`, `descDismissed` not set, textarea focused.
3. **Two pages still load `tab-bar-functions.js?v=17`'s predecessor** —
   `leaderboard.html:1509` and `wiadomosci.html:840` stay at `?v=16`, so their `Dodaj` tab
   navigates without `?add=1` until the cache is revalidated. Correctly deferred (do-not-edit
   list) and documented; `wiadomosci.html` is already modified in this tree by another task, so
   the merge step should fold the one-line bump in there.
4. **iOS close path loses the focus hand-off** — `exitAddMode` moves focus to
   `#myPresentsHeading` only when `document.activeElement` is still inside the form; on iOS
   Safari the tap on X blurs the input first, so `activeElement` is `<body>` and screen-reader
   focus is dropped to the top of the document. Consider remembering whether focus was in the
   form at `pointerdown` on the close button, or always focusing the heading for the `close` /
   `escape` / `added` reasons.

</details>

<details>
<summary>Details</summary>

### The chevron's intent is read after add mode has already changed the DOM

`setDescExpanded(open)` is the only writer of `is-expanded` and `aria-expanded`, and
`enterAddMode()` calls `setDescExpanded(true)` as its last step. The chevron handler derives its
action from the live DOM:

```js
form.addEventListener('focusin', () => enterAddMode());
...
toggle.addEventListener('click', () => {
    const open = !isDescExpanded();
    descDismissed = !open;
    setDescExpanded(open);
    if (open) { enterAddMode(); if (descInput) descInput.focus({ preventScroll: true }); }
});
```

In the compact state a tap on the chevron runs, in order: focus lands on the button → `focusin`
bubbles to the form → `enterAddMode()` adds `quick-add-active`, resets `descDismissed`, expands
the description → then `click` fires, `isDescExpanded()` is now `true`, so `open` is `false`,
`descDismissed` becomes `true` and the row collapses again. Chromium (desktop and Android)
focuses buttons on pointerdown, so that is the mainstream mobile path; iOS Safari does not focus
buttons on tap, so there `focusin` never fires and the handler behaves as designed. The result is
engine-dependent behaviour on the one control whose label at tap time read
`Dodaj opis (opcjonalnie)`, and the spurious `descDismissed = true` keeps the description shut
for the remainder of the session.

`aria-expanded` stays truthful at each step (it is written on every `setDescExpanded` call), so
this is a behaviour defect, not an ARIA desync. The harness started its chevron scenario from add
mode, so the row never ran.

### Scope of the `inert` call

`#tabBarMenuPanel` and `#tabBarOverlay` are siblings of
`.bottom-tab-bar`, not children, so neither the hiding CSS nor `inert`/`aria-hidden` reaches them.
Not reachable in practice — the FAB that opens the panel is inside the bar and hidden with it, and
while the panel is open its overlay covers the composer so add mode cannot be entered underneath
it — but it is the boundary of what the one-class approach covers.

### Exit focus is conditional on focus still being in the form

```js
const el = document.activeElement;
const inForm = el && form.contains(el);
if (inForm && typeof el.blur === 'function') el.blur();
if (inForm && reason !== 'undocked' && reason !== 'modal') { heading.focus({ preventScroll: true }); }
```

Gating the *blur* on `inForm` is right. Gating the *heading focus* on it means the hand-off only
happens on engines that keep focus inside the form across the tap — true on Chromium, false on
iOS Safari, where the keyboard dismissal that accompanies the tap on X leaves `activeElement` as
`<body>`. The keyboard still closes (the platform did it), and the close button and Escape are
still reachable, so the requirement's "always a reachable way out" holds; what is lost is the
screen-reader reading position, which drops to the top of the document on the exact platform the
thumb-reach work targets. The same applies to the `added` path when the submit `+` is tapped on
iOS.

### The shared-file edit

The href mutation (`link.setAttribute('href', href + '?add=1')`) is permanent on the element once
applied. Benign — a repeat click early-returns on the `add=1` check and navigates with the same
marker, which `formularz.js` strips on arrival — but the DOM of a non-form page carries
`formularz.html?add=1` from the first tap onwards.
`a.tab-bar-menu-item.edit-presents-item` ("Edytuj moje prezenty") is not matched, keeping the edit
intent distinct from the add intent.

Verified independently: six of the eight pages loading the script now request `?v=17`
(`activity`, `formularz`, `home`, `recipients`, `rezerwacje`, `ustawienia`); `leaderboard.html`
and `wiadomosci.html` remain at `?v=16` and are both named in the verification doc's carry-over
list. No `bottom-tab-bar.css` / `app-theme.css` churn, consistent with all new CSS living in
`formularz.html`'s own `<style>`.

### Reveal of the visually-hidden heading

Spot-checked because a `clip-path`-based hide would have survived the add-mode override and left
an empty head row: the compact rule at formularz.html:746-758 uses only
`position/width/height/margin/overflow/clip/white-space`, all of which the override resets.
`addmode-375-active.png` shows the title and the X side by side; `addmode-375-idle.png` shows the
compact bar with neither, at the same slim height as before.

### Scroll settle on exit

Entering grows the reserved bottom padding (200px → 247px) so the scroll position can never be
clamped — measured 0px jump even when pinned to the bottom. Leaving shrinks it back, and a reader
at the absolute bottom is clamped upwards by the 47px difference; the new
`transition: padding-bottom 0.25s ease` spreads that over the composer's own `bottom` transition
(measured ramp 678 → 631 over 400ms) and it is neutralised under `prefers-reduced-motion`. This is
inherent to not permanently reserving add-mode padding, and it is reported rather than hidden.

### Reduced motion

`.quick-add-head`, `body.quick-add-active .quick-add-head`,
`body.has-tab-bar.quick-add-docked`, `.bottom-tab-bar` and
`body.quick-add-active .bottom-tab-bar` all join the existing
`@media (prefers-reduced-motion: reduce)` `transition: none !important` group. Listing
`.bottom-tab-bar` bare also kills the shared scroll auto-hide animation on this page only — a
deliberate trade to avoid editing `bottom-tab-bar.css` and bumping its `?v=` across every page.
The CSS comment sitting between two selectors in that list is valid in a selector list.

### Test coverage

Covered by the captured harness evidence: all six exit reasons including `undocked` (resize and
`switchTab('add')`) and `modal`; `?add=1` with and without `?osoba=`, the `replaceState` clean-up,
reload and history-back; the plain visit (no focus stolen, `activeElement = BODY`); a real tap on
`Dodaj` both in-page (no reload, sentinel survived) and from a dock-only page (href rewritten,
default not prevented); tab order in both states including failed focus attempts on the hidden
bar and FAB; all three submit paths; typed-text preservation across X/Escape/scrim; scrim
tap-vs-drag; the simulated on-screen keyboard; 320/375/820/1024px; add, edit, delete, the
`+ Dodaj szczegóły` chip, `Dodaj dla kogoś innego`, the `.is-new` highlight and the edit bottom
sheet's `rows="3"` textarea.

Not tested: the chevron from the compact state (plan E3) — the gap that hides issue 1; a real iOS
Safari engine, so the `focusin`-ordering and exit-focus differences described above are reasoned
from the engine's known behaviour rather than measured; `prefers-reduced-motion` is asserted only
at 100ms after entry, not across a full enter/exit cycle.

</details>

<details>
<summary>Files changed</summary>

| File | What changed |
|---|---|
| `public/formularz.html` | New `.quick-add-head` wrapper + `#quickAddClose` button, `tabindex="-1"` on `#myPresentsHeading`, mobile head-row/close/heading-reveal CSS, `body.quick-add-active .bottom-tab-bar` hide, `padding-bottom` transition, reduced-motion additions, `formularz.js?v=20`, `tab-bar-functions.js?v=17` |
| `public/formularz.js` | `?add=1` parse + `replaceState`, `pendingAddMode` hand-off in `checkAuth`, `enterAddMode`/`exitAddMode`/`refreshDocked`/`isAddMode`/`tabBar`, `window.enterQuickAddMode`/`exitQuickAddMode`, add-mode branch in `tabBarOffset`, docked-conditional post-add refocus; deleted the `focusout`/`blurTimer`/`pointerdown` and first-keystroke-expand logic |
| `public/tab-bar-functions.js` | One appended capture-phase click handler on `a.tab-item.form-tab` |
| `public/activity.html`, `home.html`, `recipients.html`, `rezerwacje.html`, `ustawienia.html` | `tab-bar-functions.js?v=16 → ?v=17` only |
| *(in-tree, other tasks)* `public/sw.js`, `wiadomosci.html`, `chat-reactions.css`, `archiwum.html` | chat-reactions / chat-noscroll work; no add-mode content — `archiwum.html` also repairs a previously corrupted `app-theme.css` `<link>` |

Full diff: `git -C "c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty" -P diff -- public/formularz.html public/formularz.js public/tab-bar-functions.js`

</details>
