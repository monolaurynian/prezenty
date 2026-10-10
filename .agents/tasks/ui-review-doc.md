# Thumb-zone quick-add composer and form/list separation on "Dodaj i edytuj moje prezenty"

The edit tab's quick-add form is rebuilt as a CSS-grid composer. On desktop (>768px) it is a bounded light-green card at the top. On mobile it is a fixed pill above the bottom tab bar: chevron toggle, name input, round submit button. A "Moje prezenty" header with a divider and a pluralised count badge now separates the list from the form. `formularz.js` gains `setupQuickAddComposer()`. It keeps `--quick-add-bottom`/`--quick-add-h` in sync with the tab bar, its FAB, the bar's hide-on-scroll state and the on-screen keyboard (visualViewport), and it reserves matching body padding. After a successful add, focus goes back to the name field and the new item is scrolled into the visible band and flashed. Both requested language fixes are in: the gender-neutral placeholder "Np. książka, słuchawki…" and the sentence-case "Dodaj swój prezent". There are also extra sentence-case and `aria-label="Zamknij"` fixes in the same file. The joke and the add/edit/delete and "Dodaj dla kogoś innego" flows are untouched.

Watch for: the new-item highlight and the keyboard lift have no visual evidence, but the code reads correctly (likely fine). Twenty files are modified in the shared working tree, so git alone cannot prove which branch changed which file. `public/sw.js` is confirmed unmodified.

**Verdict**: APPROVED

## High-level view

Separation comes from two distinct regions. On desktop, the form is a tinted, bordered card with its own "Dodaj nowy prezent" heading, followed by a 28px gap and then a "Moje prezenty" header with a count badge and a rule. On mobile, the form leaves the document flow entirely, so the card holds only the list and the "Dodaj dla kogoś innego" button. The 1024 and 375 screenshots show both layouts.

The mobile composer is a docked composer, not a bottom sheet. So no dialog role, focus trap or Escape handling is needed. The submit button comes after the fields in DOM and tab order, the label is visually hidden, and the toggle has `aria-expanded`/`aria-controls`. Enter in the name field submits through the native form (`enterkeyhint="send"`), and Enter in the description adds a newline. A disabled-button guard blocks double submits.

Placement is computed rather than guessed. The bottom offset is the larger of (tab bar inset + bar height + FAB overhang + 8px) and (keyboard-covered height + 8px). When the bar slides away, the composer drops into its place. Observers cover the composer size, visualViewport resize/scroll, the media query, and class/style changes on the tab bar and `#editTab`. Body padding is only applied while the composer is actually docked (edit tab visible and ≤768px). The scrolled 375 screenshot shows the last item and "Dodaj dla kogoś innego" fully clear of the composer and the bar.

Ownership: the UI changes are confined to `formularz.html` and `formularz.js`, and `formularz.js?v=16→17` is bumped. That bump is enough for the cache-first service worker, because the new URL misses the cache. `public/sw.js` has no diff.

<details>
<summary>Issues (3)</summary>

1. **Highlight and keyboard lift unevidenced** (possible): none of the screenshots shows the `.is-new` flash or the visualViewport keyboard offset. Check both on a real iOS/Android device before release. Not blocking, since the code paths are simple and correct on reading.
2. **Shared-tree attribution** (likely): `server.js`, `recipients.*`, `archiwum.html`, `tab-bar-functions.js` and other files are also modified. They look like the language/pluralisation branch's work, but the diff cannot attribute them. Confirm at merge that Branch UI's commit contains only `formularz.html`/`formularz.js`.
3. **Coder verification notes not available to the reviewer** (confirmed): only the screenshots were available for this review. If Enter-submit, focus return and highlight have not been exercised in a browser, run a quick manual pass.

</details>

<details>
<summary>Details</summary>

### Docking the composer under a frosted card

A `position: fixed` element is positioned against the nearest ancestor with a `transform`, `filter` or `backdrop-filter`, not the viewport. `#editTab .main-card` has an inline `backdrop-filter` and a hover lift. On ≤768px the diff overrides these with `!important` (the card becomes 0.94 opaque white instead), which is what makes the fixed composer anchor correctly. Any future ancestor that adds a transform (for example a tab fade-in animation) would silently break the docking (possible). `switchTab()` currently toggles only `style.display`, so nothing does that today.

### Keyboard and tab-bar offset

`keyboardOffset()` uses `innerHeight - (vv.height + vv.offsetTop)` with a 60px threshold. That fits iOS Safari, where the layout viewport does not shrink. On browsers that resize the layout viewport, the result is ~0 and the tab-bar offset applies, which is also correct. While the keyboard is open, body padding grows by the same amount, so the end of the list stays reachable. `env(safe-area-inset-bottom)` only appears in the CSS fallback before JS runs. After that, the measured bar inset (which already includes the safe area) is used.

### Add flow and regressions

`quickAddPresent()` is now called once from `onsubmit`. The old double wiring (`onclick` plus `onsubmit="return false"`) is gone. On success it calls `loadMyPresents(data.presentId || 'first')`. The server's `/api/formularz/present` does return `presentId`, and items carry `data-present-id`, so the exact item is found. The refresh after an add skips the spinner, so the scroll position is kept. `revealNewPresent` scrolls only the needed delta into the band above the composer and keyboard, honours reduced motion, and restarts the flash animation. The count badge is updated on render, delete, undo and the empty state. The `.list-group-item[data-present-id]` markup that `deletePresent` relies on is unchanged, and edit/delete handlers are untouched. The "Dodaj dla kogoś innego" button keeps its `onclick="switchTab('add', true)"` and only gains a wrapper class.

### Accessibility

The submit button uses #1e7e34→#19692c behind white text, about 5:1. Status messages use opaque Bootstrap-equivalent colours inside a `role="status" aria-live="polite"` region. Focus-visible gets a 3px blue outline on the toggle and submit. Targets are 48–52px. Inputs are 16px, so iOS does not zoom on focus. Reduced motion disables the transitions and swaps the flash animation for a static ring.

</details>

<details>
<summary>File map</summary>

- `public/formularz.html`: new inline `<style>` for `.quick-add-*`, `.my-presents-*`, the new-item flash and the mobile docked composer. The quick-add form is restructured into a section with a hidden-label input, a collapsible description, a toggle, a submit button and a live status region. "Moje prezenty" header with count. Sentence-case and `aria-label="Zamknij"` fixes, and the gender-neutral placeholder. `formularz.js?v=17`.
- `public/formularz.js`: `setupQuickAddComposer()`, `revealNewPresent()`, `updateMyPresentsCount()`. `quickAddPresent()` gets a double-submit guard, focus return and highlight. `loadMyPresents(highlightId)` skips the spinner on refresh and returns its promise. Status-message timer handling. Empty-state copy.

Full diff: `git -P diff public/formularz.html public/formularz.js`

</details>
