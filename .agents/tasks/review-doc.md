# Readable present rows on phones and "Dodaj dla kogoś innego" moved below the list

The change fixes two mobile UI complaints. On recipients.html, present titles were collapsing into narrow columns and breaking mid-word next to the nowrap action buttons. A scoped inline `<style>` block now resets `word-break` to `normal`, keeps `overflow-wrap: break-word` only as a fallback, and below 480px moves the action buttons onto their own right-aligned row so the title gets the full card width. Title and comment text are larger and darker on mobile. Long URLs collapse to a single line with an ellipsis, and the full URL is kept in `title`. On formularz.html, the "Dodaj dla kogoś innego" button now sits after `#myPresentsList`. The edit-list items use a near-opaque white surface with a yellow left accent and darker typography. Both pages get 128px of bottom padding (plus the safe-area inset) to clear the floating tab bar and FAB. The previous pass's contrast finding on the secondary button is addressed with a `#718096` border and a stronger fill, and the class is renamed to `.btn-secondary-light`.

**Watch for:** (1) **confirmed**: the recipients overrides are an inline `<style>` in recipients.html rather than one of the shared stylesheets. They load after the linked sheets and use `!important`, so they win the cascade, but the rules aren't reusable on other pages. (2) **confirmed**: at 320px the "Kupione" and "Anuluj" pair wraps to two lines. That's acceptable but slightly tall.

**Verdict**: APPROVED

---

## High-level view

The recipients fix targets the real `generatePresentItem` structure (`.present-item > .d-flex > .present-details` and `.present-actions.d-flex`). Under 480px it switches that row to wrap, giving the details block 100% width and the actions a full-width, right-aligned row. Above 480px, including the 768px desktop shot, the original side-by-side layout is unchanged. The URL change is in the second `convertUrlsToLinks` definition (around line 2432), which is the one that takes effect. Its input is already HTML-escaped by the caller, so the new `title="${cleanUrl}"` attribute adds no injection surface.

On formularz, `displayMyPresents` drops its inline translucent styles in favour of classes (`my-present-*`) styled in the page's `<style>` block. The text is now 16px / 600 `#1a1a1a` for titles and 15px `#333` for comments, on a 0.92-white surface, which is readable over the photo background. The edit and delete buttons stay a compact 40px column and gain `aria-label`s. The moved button keeps `onclick="switchTab('add', true)"` unchanged.

The screenshots support the claims. At 320px the titles wrap only at spaces ("Nebulizator do / olejków eterycznych"), the URL is truncated cleanly, and the orange buttons and orange/yellow accents remain. In formularz-375-bottom the secondary button sits below both items, clearly bordered, with about 80px of clearance above the FAB. `vercel.json` is untouched and nothing is committed. The cache-busting bumps (`formularz.js?v=16`, `recipients.js?v=22`, `prezenty-v112`) ensure returning PWA users receive the new JS.

<details>
<summary>Issues (2)</summary>

1. **Recipients overrides live in an inline page style**: this is non-blocking. The rules win the cascade today. If other pages render `.present-item`, consider moving them into `app-theme.css` in a follow-up.
2. **320px reserved-state buttons wrap to two lines**: this is non-blocking. "Kupione" and "Anuluj" stack at 320px because the row is about 177px wide. Optionally use icon-only or smaller padding below 360px if the extra height bothers anyone.

</details>

<details>
<summary>Details</summary>

## Cascade placement on recipients.html

The new block sits in the existing inline `<style>` in `<head>`, after the linked `styles.deduped.min.css`, `aws-design.css`, `app-theme.css`, `bottom-tab-bar.css` and `filters.css`. The selectors are prefixed with `.recipients-page`, which `<body>` carries, and the declarations are `!important`. That beats the legacy `word-break: break-word/break-all` rules in the minified sheet on both specificity and order. The title colour override excludes `.checked`, `.reserved-by-other` and `.reserved-by-me`, so the struck-through grey and the orange reserved-by-me title treatments are preserved, as the 320px shot shows.

## Bottom clearance

Both pages use `@media (max-width: 991.98px)` with `padding-bottom: calc(128px + env(safe-area-inset-bottom))`. On recipients the selector is `body.recipients-page.has-tab-bar`, and on formularz it is `body.has-tab-bar`, which is scoped by the page's own style block. The verification note measures the formularz button ending at 618px against a FAB at 700px, and the screenshot matches.

</details>

---

<details>
<summary>File map</summary>

- `public/recipients.html`: scoped mobile typography, no-mid-word wrapping, actions-below-title layout under 480px, URL ellipsis, bottom padding; JS version bump.
- `public/recipients.js`: `convertUrlsToLinks` emits a `.present-link` with ellipsis truncation, a darker blue, and a `title` attribute.
- `public/formularz.html`: button moved below `#myPresentsList` and renamed `.btn-secondary-light` with a higher-contrast border; `#myPresentsList` item styles; bottom padding; JS version bump.
- `public/formularz.js`: `displayMyPresents` uses classes instead of inline translucent styles and adds aria-labels; `makeLinksClickable` truncates with an ellipsis.
- `public/sw.js`: cache name bump.

Full diff: `git -P diff -- public/`

</details>
