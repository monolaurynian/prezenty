# Progressive disclosure for the optional present description

The mobile quick-add composer now opens the description field as soon as a name is typed, instead of hiding it behind the chevron. This targets the user's complaint that people skip the second field. A short gender-neutral hint ("Szczegóły pomagają trafić 🎯") and a concrete placeholder ("Rozmiar, kolor, link do sklepu…") explain why the field is worth filling. In the textarea, Ctrl/Cmd+Enter submits. Presents that have no description and no link in the title get a "+ Dodaj szczegóły" chip that opens the existing edit modal with the description focused. The diff touches only `formularz.html` and `formularz.js`. Other modified files in the working tree come from earlier tasks.

Watch for: the `shown.bs.modal` once-listener can outlive a no-op `show()` (possible, minor). The expanded composer takes a large share of a 320px screen once a real keyboard is open (possible, not verifiable in the harness). Neither one blocks shipping.

**Verdict**: APPROVED

## High-level view

Disclosure state lives in one place now. `setDescExpanded()` toggles `.is-expanded` and `aria-expanded`/`aria-label`, and calls `updateComposerLayout()`. Because of that call, the composer height, `--quick-add-h`, the body bottom padding and the visualViewport lift all follow the new height through the same path the chevron used before. A `descDismissed` flag respects a manual collapse for the current entry. It resets when the name is cleared or a present is added. Auto-expand never moves focus.

The collapsed state changed from `display: none` to a 0-height grid row with `visibility: hidden`. This lets the row animate upward while keeping the field out of the tab order and the accessibility tree. Expanding switches visibility with no delay, so the chevron's immediate `focus()` still lands. Reduced-motion users get no transition.

The chip is rendered in the `displayMyPresents()` template. One delegated listener on `#myPresentsList` handles clicks, so innerHTML re-renders and the delete-undo restore keep working. Every list refresh on this page goes through `loadMyPresents → displayMyPresents`. The aria-label title is escaped with a new `escapeAttr()`, and the harness confirmed the quote/angle-bracket title round-trips exactly.

<details>
<summary>Issues (2)</summary>

1. **Stale focus listener on the edit modal**: `openEditPresentModal(..., true)` adds a `{ once: true }` `shown.bs.modal` listener before `show()`. If `show()` does nothing (the modal is already open or mid-transition, e.g. a double tap), the listener stays and the next normal "edit" open focuses the description instead of the title. Possible, non-blocking. Remove the listener on `hidden.bs.modal`, or check a flag set per open.
2. **Expanded composer height with a real keyboard**: the expanded composer is about 165px. At 320×640 with an on-screen keyboard, very little of the list stays visible. Possible, and the harness couldn't verify it. Check on a device. If it's cramped, reduce the textarea rows while the keyboard is open.

</details>

<details>
<summary>Details</summary>

### Auto-expand and the dismiss flag

The composer is anchored at the bottom and grows upward, so on the first typed character the name field jumps about 95px up mid-typing. Focus and caret stay put (confirmed in the harness), and this is the agreed behaviour, but the visual jump is the main UX cost of the approach. Collapse on clear is skipped when the description already holds text, so typed details are never hidden. Clearing the name also resets `descDismissed`. A user who dismissed the field, deleted the name and typed a new one sees it reopen, which matches the "same entry" wording.

### Layout and keyboard

The open state's `max-height: calc(30vh + 40px)` has to cover the hint plus the textarea's existing `max-height: 30vh`. If either of those grows later, the textarea will be clipped by `overflow: hidden` while the user drags the resize handle. The visualViewport path is unchanged, and expansion goes through `updateComposerLayout()`. A real soft keyboard wasn't exercised (Issue 2).

### "+ Dodaj szczegóły" chip

The 44px hit area comes from an `::after` with `inset: -6px -4px` around a 32px pill. It only extends into the gaps around the chip. When the chip is shown there is no comments paragraph and no link in the title, so the hit area overlaps nothing interactive. The chip is shown only when comments are empty or whitespace-only and the title has no `http(s)://`. Focus on `#editPresentComments` is applied in `shown.bs.modal`, after Bootstrap's focus trap activates, so it wins over the trap's default. Issue 1 covers the no-op `show()` edge case.

</details>

<details>
<summary>File map</summary>

`public/formularz.html`: hint and chip styles, an always-present desc grid row with a max-height/opacity/visibility transition, reduced-motion overrides, the hint paragraph with `aria-describedby`, a new placeholder, and `formularz.js?v=18`.

`public/formularz.js`: `setDescExpanded`/`descDismissed`, auto-expand on name input, Ctrl/Cmd+Enter in the textarea, `_resetQuickAddComposer` after add, chip rendering with `escapeAttr`, a delegated chip listener, and a `focusComments` option on `openEditPresentModal`.

Full diff: `git -P diff public/formularz.html public/formularz.js`.

</details>
