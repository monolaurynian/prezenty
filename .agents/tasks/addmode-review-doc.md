# Add mode for the quick-add composer on formularz.html (iteration 2)

The mobile quick-add composer has an explicit open/close lifecycle: `body.quick-add-active` is
the single state flag, entered on focus/typing/`?add=1`/a tap on the dock's **Dodaj** tab, and
left by a 44×44 close button, Escape, a scrim tap, a successful add, undocking or the edit bottom
sheet opening. Entering opens the description row and slides the whole dock (including the red
FAB) out of the thumb zone via page-local CSS; leaving restores it. Iteration 2 addresses the two
blocking findings from the previous pass: the chevron tapped from the compact bar no longer
collapses the row it just opened (a pointer-driven entry now runs with `{ keepDesc: true }` and
the chevron's own click is the only writer of the row's state), and plan row E3 is now covered by
real `tap()` rows in the harness. The iOS exit focus hand-off was also made unconditional for the
four deliberate exits.

Watch for: tabbing onto the chevron from the compact bar enters add mode and opens the details,
so the control a keyboard user just reached now reads `Ukryj opis` and their first Enter collapses
it (confirmed — `keepDesc` is pointer-only by design, measured as rows c3/c4). A chevron press
that never produces a click (drag-cancel) leaves add mode on with the details collapsed
(confirmed, low impact). `descDismissed` is now written in three places and read nowhere
(confirmed).

**Verdict**: APPROVED

## High-level view

The chevron fix is the right shape. Intent is no longer derived from post-entry DOM state: a
`pointerdown` on `#quickAddToggle` marks the entry it causes so that entry leaves the description
row exactly as it found it, and the click handler decides. Keyboard activation never sets the
flag, which is what produces the one remaining asymmetry — a Tab-in opens the row, so the
chevron's label and `aria-expanded` flip before the user has activated anything.

A second defect surfaced and was fixed while writing that row: `descInput.focus()` silently
failed because the textarea inherits the description row's in-flight `visibility` change.
`focusDesc()` focuses, checks whether it took, and retries once after 260ms behind guards on
add mode, the row still being open, and nothing else having taken focus.

"Stays collapsed for the rest of the session" is now structural rather than enforced by
`descDismissed`: `enterAddMode` returns early when add mode is already on, and the
first-keystroke expand is gone, so within a session only the chevron can reopen the row. The flag
itself is dead weight — correct today, but nothing fails if a future entry path re-expands.

Exit focus is unconditional for `close` / `escape` / `scrim` / `added` and still skipped for
`undocked` / `modal`, which fixes the iOS case where the tap on X blurs the input before the
handler runs. The blur stays conditional, which is right — there is nothing to blur when the
platform already did it.

Scope is otherwise unchanged from the first pass and holds up: one 24-line capture-phase handler
in `tab-bar-functions.js` scoped to `a.tab-item.form-tab` links pointing at `formularz`, calling
`preventDefault()` only when `window.enterQuickAddMode` exists and actually entered; `?add=1`
stripped with `history.replaceState` at module scope before any async work, with `?osoba=`
preserved; all dock-hiding CSS page-local, so no shared stylesheet churn. `formularz.js?v=19 →
?v=20` (kept at 20 for iteration 2, since production still serves 19), `tab-bar-functions.js?v=16
→ ?v=17` on six of the eight pages that load it.

The forbidden files are clean. `public/sw.js`, `public/wiadomosci.html` and
`public/chat-reactions.css` are modified in this tree, but every hunk belongs to the
chat-reactions / chat-noscroll work (precache entries + `CACHE_NAME v119→v120`, chat wrapping
rules, `app-theme.css?v=13→14`, `chat-reactions.css?v=2→3`); nothing add-mode-related appears in
them. `leaderboard.html`, `chat-reactions.js`, `notification-text.js` and `server.js` are
untouched by this work. `archiwum.html`'s two-line change repairs a previously corrupted
`<link href="app-theme.css?v=14" rel="stylesheet">et">` tag and restores the dropped
`styles.deduped.min.css` link; every `<link>` / `<script>` boundary in `formularz.html` and
`archiwum.html` reads intact now.

<details>
<summary>Issues (4)</summary>

1. **Keyboard entry flips the chevron's meaning** — tabbing into the composer from the compact
   state lands on `#quickAddToggle` (the close button is not tabbable there), which enters add
   mode and opens the details, so the button relabels to `Ukryj opis` and the user's first Enter
   collapses the row they were reaching for. Consider applying `keepDesc` to any entry whose
   focus target is the toggle, letting the activation open the row in both input modes.
2. **Chevron press-and-cancel leaves details collapsed in add mode** — `pointerdown` marks the
   entry `keepDesc`, so if no click follows (drag off the button, pointer cancel) add mode is on
   with the description never opened: the one entry path that does not satisfy "details open on
   entering add mode". The existing 700ms safety timer could open the row when it fires while
   still in add mode and nothing toggled it.
3. **`descDismissed` is write-only** — set in `enterAddMode`, `exitAddMode` and the chevron
   handler, read nowhere; the session-sticky rule now rests on `enterAddMode`'s early return.
   Either drop the flag or gate the re-expand on it, so a future entry path cannot silently
   reopen the row with nothing failing.
4. **Two pages still load `tab-bar-functions.js?v=16`** — `leaderboard.html:1509` and
   `wiadomosci.html:840`; both carry a `Dodaj` tab, which navigates without `?add=1` until their
   cached copy is revalidated. Correctly deferred (do-not-edit list) and documented; fold the
   one-line bump into the merge step — `wiadomosci.html` is already modified in this tree by the
   chat work.

</details>

<details>
<summary>Details</summary>

### The chevron's intent is now pointer-marked instead of state-derived

```js
toggle.addEventListener('pointerdown', markTogglePointer);   // togglePointerDown = true, 700ms safety clear
form.addEventListener('focusin', (e) => {
    const fromTogglePointer = !!toggle && e.target === toggle && togglePointerDown;
    enterAddMode(fromTogglePointer ? { keepDesc: true } : undefined);
});
toggle.addEventListener('click', () => {
    const open = !isDescExpanded();
    togglePointerDown = false;
    ...
});
```

With `keepDesc`, `enterAddMode` calls `updateComposerLayout()` instead of `setDescExpanded(true)`,
so the row — and `aria-expanded` with it — is untouched by the entry and the click handler reads
the state the user actually saw. The recorded event order (`pointerdown:toggle →
focusin:quickAddToggle → click:toggle`) confirms the engine does focus the button on tap, i.e. the
reported ordering reproduces, and the row ends open with the caret in the textarea.

The keyboard path deliberately has no marker, so a Tab-in behaves like any other entry and opens
the details. That keeps requirement 1 true for keyboard users but means the chevron is already
`aria-expanded="true"` / `Ukryj opis` when they arrive on it, and `Enter` collapses (measured c3 →
c4). The label is truthful at the moment of activation; the cost is that the first keyboard
activation of that control does the opposite of what the user was reaching for.

Press-and-cancel is the mirror case: `pointerdown` marks the entry, `focusin` enters with
`keepDesc`, and if the pointer is dragged off the button no click ever arrives. Add mode is then
on in S2b with the details collapsed. The 700ms timer only clears the flag.

### Focusing the textarea needed a retry

At `click` time `getComputedStyle(#quickAddComments).visibility` is still `hidden` — the textarea
inherits the description row's in-flight change — and even a `setTimeout(…, 0)` focus attempt
fails. `focusDesc()` focuses, returns if that took, and otherwise retries at 260ms behind
`isAddMode()`, `isDescExpanded()` and `activeElement` still being the chevron or `<body>`, so a
quick tap on another field wins the race. Measured: `t+0` `quickAddToggle`, settled
`quickAddComments`.

### Session stickiness is structural, not flag-driven

`enterAddMode` returns early once `body.quick-add-active` is set (focusing the name field if
asked), the first-keystroke expand is deleted, and `onComposerInput` funnels into the same early
return. So after a manual collapse nothing re-expands the row until the next entry — measured d1
→ d2 → d3, including typing into the name field after the collapse. `descDismissed` records the
intent and is reset on entry and exit, but no branch reads it.

### Exit focus hand-off

```js
const inForm = el && form.contains(el);
if (inForm && typeof el.blur === 'function') el.blur();
if (reason === 'close' || reason === 'escape' || reason === 'scrim' || reason === 'added') {
    heading.focus({ preventScroll: true });
}
```

iOS Safari blurs the focused input before the tap on X or `+` lands, so gating the hand-off on
`inForm` dropped the reading position to the top of the document on exactly the target platform.
Both iOS-shaped rows (`e6` submit, `f5` close, with `activeElement = BODY` before the handler)
now land on `myPresentsHeading`. `undocked` and `modal` still leave focus with whoever caused
them. On a scrim tap the heading is focused and then cleared to `<body>` by the engine's own
`mousedown` handling — pointer-only, no keyboard or AT equivalent.

### The dimmed page stays keyboard-reachable

The scrim blocks pointer input but nothing inert-ifies the list behind it, so a keyboard user can
Tab from the composer onto a card's edit button that a mouse user cannot click. That is the
accepted consequence of the no-focus-trap constraint, and it degrades gracefully: activating the
edit button fires `show.bs.modal`, which exits add mode and restores the dock.

### Accessibility and dock hiding

The dock leaves the tab order and the a11y tree through three mechanisms at once
(`visibility: hidden`, `bar.inert = true`, `aria-hidden="true"`), verified by failed focus
attempts on the `Dodaj` link and on the FAB even with a temporary `tabindex="0"`, and all three
are restored after every exit reason including `undocked` and `modal`. Focus is moved into the
composer *before* the class is added, so it is never left inside the element about to be hidden.

Gate items confirmed in one line each: `#quickAddClose` is 44×44 with
`aria-label="Zamknij formularz dodawania"`, tabbable in add mode and unreachable in the compact
state through `visibility: hidden` rather than an offscreen clip; no `role="dialog"`, no focus
trap, no scroll lock; the scrim stays `aria-hidden="true"`; `#quickAddMessage` is still the only
live region and gained no new announcements.

`#tabBarMenuPanel` and `#tabBarOverlay` are siblings of `.bottom-tab-bar`, so neither the hiding
CSS nor `inert`/`aria-hidden` reaches them — unreachable in practice, since the FAB that opens the
panel is inside the bar and hidden with it, but it is the boundary of the one-class approach.

### Reduced motion

The previous pass noted only entry was asserted; iteration 2 measures both directions at +60ms
(dock hidden / padding already 247px; dock visible / padding already back to 200px) with no
half-states. Listing `.bottom-tab-bar` bare in the `transition: none !important` group also
neutralises the shared scroll auto-hide animation on this page only — the deliberate trade for
keeping the change page-local and avoiding a `bottom-tab-bar.css` `?v=` bump everywhere.

### Scroll settle on exit

Entering grows the reserved bottom padding (200px → 247px), so the scroll position can never be
clamped: 0px jump at every sampled frame even when pinned to the very bottom. Leaving shrinks it,
and a reader at the absolute bottom is clamped upwards by the 47px difference, spread over the new
`transition: padding-bottom 0.25s ease` (re-measured ramp 669 → 622 over 446ms) and instant under
reduced motion. Inherent to not permanently reserving add-mode padding; reported rather than
hidden.

### Test coverage

Covered by the captured evidence: all six exit reasons including `undocked` (resize and
`switchTab('add')`) and `modal`; `?add=1` with and without `?osoba=`, the `replaceState` clean-up,
reload and history-back; the plain visit (no focus stolen); a real tap on `Dodaj` both in-page (no
reload, sentinel survived) and from a dock-only page (href rewritten, default not prevented, and
the resulting load landed in add mode); the chevron from the compact bar as a real `tap()`, as a
keyboard entry, and three times in a row inside add mode, with `aria-expanded` checked at every
step; tab order in both states; four submit paths including the iOS-shaped one and the empty-name
error; typed-text preservation across X / Escape / scrim; scrim tap-vs-drag; the simulated
on-screen keyboard (`--quick-add-bottom` 12px → 358px); 320 / 375 / 820 / 1024px; add, edit,
delete, the `+ Dodaj szczegóły` chip, `Dodaj dla kogoś innego`, the `.is-new` highlight and the
edit bottom sheet's `rows="3"` textarea. `node --check` exits 0 on both scripts.

Not tested: a real iOS Safari engine — the two iOS behaviours are simulated in the shape iOS
produces (`activeElement = BODY` before the handler), and the chevron's iOS path (no `focusin`, so
`click` alone decides) is reasoned from the same known behaviour; the chevron press-and-cancel
path (issue 2).

### Screenshots

Looked at all five. The close button and the chevron are unconfusable where it matters — grey
rounded square top-right of the head row vs green circle down-left of the name field
(`addmode-375-active.png`) — the dock and FAB are gone in add mode and back after an add with the
new item highlighted and `7 prezentów` pluralized, nothing is clipped at 320px, and the 1024px
card carries no close button and no scrim.

</details>

<details>
<summary>Files changed</summary>

| File | What changed |
|---|---|
| `public/formularz.html` | `.quick-add-head` wrapper + `#quickAddClose`, `tabindex="-1"` on `#myPresentsHeading`, mobile head-row/close/heading-reveal CSS, `body.quick-add-active .bottom-tab-bar` hide, `padding-bottom` transition, reduced-motion additions, `formularz.js?v=20`, `tab-bar-functions.js?v=17` |
| `public/formularz.js` | `?add=1` parse + `replaceState`, `pendingAddMode` hand-off in `checkAuth`, `enterAddMode`/`exitAddMode`/`refreshDocked`/`isAddMode`/`tabBar`, `togglePointerDown` + `keepDesc`, `focusDesc` retry, unconditional exit focus hand-off, add-mode branch in `tabBarOffset`, docked-conditional post-add refocus; deleted the `focusout`/`blurTimer`/`pointerdown` and first-keystroke-expand logic |
| `public/tab-bar-functions.js` | One appended capture-phase click handler on `a.tab-item.form-tab` |
| `public/activity.html`, `home.html`, `recipients.html`, `rezerwacje.html`, `ustawienia.html` | `tab-bar-functions.js?v=16 → ?v=17` only |
| `public/archiwum.html` | Repairs the corrupted `app-theme.css` `<link>` and the dropped `styles.deduped.min.css` link |
| *(in-tree, other tasks)* `public/sw.js`, `wiadomosci.html`, `chat-reactions.css` | chat-reactions / chat-noscroll work; no add-mode content |

The work was committed as `7b0faa3` while this review was in progress; the diff reviewed is the
working-tree diff captured beforehand, which matches `git -P diff f66c607 HEAD -- public/`.

</details>
