# Implementation Plan — UI Cleanup & Polish

> **Scope:** Visual/CSS only. No functional JS changes, no tab-bar layout changes,
> no frosted-glass removal from recipients.html, no formularz.html tab structure changes.
>
> **Priority order:** Changes are listed highest-impact first within each file group.
> Items are independent unless noted. Each item leaves the build in a working state.

---

## A · home.html — present-row sub-cards

The three accordion sections (Dostępne, Moje Rezerwacje, Kupione) render
recipient sub-groups as plain-white `div` cards built with inline styles directly
in `renderAvailablePresents` / `renderPresentsList` in `home.html`.
These are the only containers in the app that are NOT frosted glass —
every other card on the page uses `rgba(255,255,255,0.78) + backdrop-filter`.

- [ ] **A1. Make recipient sub-group cards frosted glass to match the rest of the page.**

  In `home.html`, find the two `renderAvailablePresents` / `renderPresentsList`
  JS template literals that produce the per-recipient wrapper `div`:

  ```js
  // Current (both functions, ~line 410 and ~line 680):
  style="margin-bottom: 25px; background: white; border-radius: 15px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
  ```

  Replace with:

  ```js
  style="margin-bottom: 20px; background: rgba(255,255,255,0.72); backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%); border: 1px solid rgba(255,255,255,0.55); border-radius: 20px; padding: 20px; box-shadow: 0 6px 20px rgba(0,0,0,0.13);"
  ```

  Files: `public/home.html` (two occurrences of the recipient-group wrapper style —
  one in `renderAvailablePresents`, one in `renderPresentsList`).

  Verify: open the home page; the recipient sub-cards inside each accordion
  section should now show a frosted translucent surface instead of solid white.

---

- [ ] **A2. Standardise accordion header colors — remove gradient-override inline styles.**

  Each accordion button has a full inline `style=` block setting a
  `linear-gradient`. This duplicates a pattern that could live in the page's
  `<style>` block and is the source of the three slightly-different red/orange/green
  shades. Keeping inline styles is fine, but the padding is inconsistent
  (the button itself inherits Bootstrap's 1rem padding; the nested `<h5>` inside
  `#cumulativeProgressSection` uses `margin-bottom: 20px` with no matching style
  on the accordion buttons). No change needed here — covered by A3 below.

---

- [ ] **A3. Fix vertical spacing between accordion sections on home page.**

  The three `.stats-container` cards use `margin: 28px auto` (desktop). On mobile
  the inner `@media` override sets `margin: 20px auto`. The cumulative-progress
  section (`#cumulativeProgressSection`) has no accordion wrapper and uses
  `margin-bottom: 25px` on its internal progress rows, but the outer container
  already has `padding: 40px` (desktop) / `padding: 20px` (mobile). This creates
  inconsistent perceived spacing between the progress section and the accordions.

  In `home.html` `<style>` block, change the `.stats-container` rule:

  ```css
  /* Before */
  margin: 28px auto;

  /* After */
  margin: 20px auto;
  ```

  And in the `@media (max-width: 768px)` block:

  ```css
  /* Before */
  margin: 20px auto;

  /* After */
  margin: 14px auto;
  ```

  Files: `public/home.html` (inline `<style>` block, `.stats-container` rule).

  Verify: on a narrow viewport the sections should have a consistent, tighter gap;
  on desktop the gap shrinks from 28 px to 20 px, matching the section-gap used on
  recipients.html (16 px margin-bottom on `.recipient-item`).

---

## B · home.html — present-count badge

Inside the recipient sub-group header (in both `renderAvailablePresents` and
`renderPresentsList`), each recipient name row has:

```js
<span style="background: #e3f2fd; color: #1976d2; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 500;">
    N prezentów
</span>
```

This is a stray blue (`#1976d2 / #e3f2fd`) badge that does not match the app
palette (red #F44336, orange #F57C00, green #43A047). It reads as noise.

- [ ] **B1. Neutralise the present-count badge color to a muted gray.**

  In `home.html`, both occurrences of the badge inline style:

  ```js
  // Before (both functions):
  style="background: #e3f2fd; color: #1976d2; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 500;"
  ```

  Replace with:

  ```js
  style="background: rgba(0,0,0,0.07); color: #4a5568; padding: 3px 10px; border-radius: 10px; font-size: 12px; font-weight: 500;"
  ```

  Files: `public/home.html` (two occurrences — one in `renderAvailablePresents`,
  one in `renderPresentsList`).

  Verify: recipient name rows show a quiet gray count pill instead of the bright
  blue badge.

---

## C · home.html — "Zarezerwuj" button style

The reserve button in `renderAvailablePresents` is fully inline-styled with raw hex:

```js
style="white-space: nowrap; padding: 6px 16px; font-size: 13px; flex-shrink: 0; background: #F57C00; color: #ffffff; border: none; font-weight: 600;"
```

`app-theme.css` already defines `.btn.btn-reserve` with the same orange color and
font-weight. Using the class removes the inline duplicate and ensures hover states
(defined in `app-theme.css`) work.

- [ ] **C1. Replace inline reserve button style with `.btn-reserve` class.**

  In `home.html` `renderAvailablePresents`, change:

  ```js
  // Before:
  <button class="btn btn-sm" onclick="reservePresent(event, ${present.id})"
    style="white-space: nowrap; padding: 6px 16px; font-size: 13px; flex-shrink: 0; background: #F57C00; color: #ffffff; border: none; font-weight: 600;">
    <i class="fas fa-bookmark me-1" style="color: #ffffff;"></i>Zarezerwuj
  </button>
  ```

  ```js
  // After:
  <button class="btn btn-sm btn-reserve" onclick="reservePresent(event, ${present.id})"
    style="white-space: nowrap; padding: 6px 16px; font-size: 13px; flex-shrink: 0;">
    <i class="fas fa-bookmark me-1"></i>Zarezerwuj
  </button>
  ```

  Files: `public/home.html`.

  Verify: reserve button still appears orange; hover state (darker orange from
  `app-theme.css .btn.btn-reserve:hover`) now works.

---

## D · formularz.html — Christmas alert banner

The alert in `#addTab` reads:
```html
<div class="alert alert-info mb-4">
    <i class="fas fa-info-circle me-2"></i>
    🎄 Nadchodzą święta! 🎁 Dodaj swoje pomysły na prezenty...
</div>
```

It appears inside the Add-present card and competes visually with the form.
The overall alert styling in `styles.css` (`.alert-info`) is already a light
`rgba(13,202,240,0.1)` tint, which is fine, but it's the only info-alert on
the page and its blue `#055160` text (from `formularz.html` inline `<style>`)
is off-palette.

- [ ] **D1. Reduce the Christmas alert to a quieter notice.**

  In `formularz.html` `<style>` block, update the `.alert-info` rule:

  ```css
  /* Before */
  .alert-info {
      background-color: rgba(13, 202, 240, 0.1);
      border: 1px solid rgba(13, 202, 240, 0.3);
      color: #055160;
      border-radius: 12px;
  }
  ```

  ```css
  /* After */
  .alert-info {
      background-color: rgba(0, 0, 0, 0.04);
      border: 1px solid rgba(0, 0, 0, 0.08);
      color: #4a5568;
      border-radius: 12px;
      font-size: 0.875rem;
  }
  ```

  Files: `public/formularz.html` (inline `<style>` block).

  Verify: the Christmas alert still appears in the form but is visually quieter —
  no bright cyan tint, muted gray text, slightly smaller font.

---

## E · formularz.html — editTab card body background

The `#editTab` card uses:
```html
style="background: transparent; border: none; box-shadow: none; backdrop-filter: none;"
```

This means the card-body content (quick-add form, "Dodaj dla kogoś innego" button,
and the presents list) floats on the raw background photo with no surface behind
them. On lighter parts of the photo the text becomes unreadable.

- [ ] **E1. Give the editTab card a frosted surface matching the addTab card.**

  In `formularz.html`, change the `#editTab` outer card inline style:

  ```html
  <!-- Before -->
  <div class="card main-card" style="background: transparent; border: none; box-shadow: none; backdrop-filter: none;">

  <!-- After -->
  <div class="card main-card" style="background: rgba(255,255,255,0.78); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%); border: 1px solid rgba(255,255,255,0.6); border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
  ```

  And give the `.card-header.bg-red` inside it a matching `border-radius` at the top:

  ```html
  <!-- Before -->
  <div class="card-header bg-red" style="text-align: center; border-radius: 14px;">

  <!-- After -->
  <div class="card-header bg-red" style="text-align: center; border-radius: 14px 14px 0 0;">
  ```

  Files: `public/formularz.html`.

  Verify: switching to the edit tab shows a frosted card with the same visual weight
  as the add-present tab; no raw photo bleeding through the form area.

---

## F · formularz.html — `<hr>` divider between quick-add and "Dodaj dla kogoś innego"

The edit tab has `<hr class="mb-4" style="opacity: 0.15;">`. This thin line
separates the quick-add form from the "Dodaj dla kogoś innego" button but adds
visual noise with no functional purpose — the vertical spacing alone creates
enough separation.

- [ ] **F1. Remove the decorative `<hr>` in the editTab card body.**

  In `formularz.html`, inside `#editTab` > `.card-body`, remove the `<hr>`:

  ```html
  <!-- Remove this line entirely -->
  <hr class="mb-4" style="opacity: 0.15;">
  ```

  And remove the `mb-4` class from the `#quickAddForm` to maintain spacing:
  change `<form id="quickAddForm" class="mb-4" …>` → `<form id="quickAddForm" class="mb-3" …>`.

  Files: `public/formularz.html`.

  Verify: the edit tab no longer shows a hairline rule; spacing between the
  quick-add form and the "Dodaj dla kogoś innego" button is preserved via margin.

---

## G · activity.html — card header missing

The activity feed card (`<div class="card main-card">`) has no `.card-header`;
it starts straight with `.card-body`. Every other card in the app has a colored
`bg-red` header. The page currently shows a plain frosted card with no title,
which is fine since the tab bar communicates location — but the card has no top
visual anchor, making it feel unfinished.

On closer inspection, the heading is replaced by the `d-flex justify-content-end`
button row ("Oznacz wszystkie jako przeczytane") which floats above the card with
no surface behind it. On smaller viewports this button is `d-none d-md-inline` text
inside the button — a separate label issue (see item I below).

No structural change needed here — the button row above the card is the implicit
header. The only fix needed is whitespace (see G1) and button text (see I1).

- [ ] **G1. Remove excess top margin on the activity container.**

  In `activity.html` `<style>` block, the existing rule is:

  ```css
  .activity-page .container.mt-4 {
      margin-top: 1rem !important;
  }
  ```

  On mobile, `app-theme.css` hides the navbar completely
  (`.activity-page nav.navbar { display: none !important }`), so the container
  starts near the top of the screen with a 1rem gap. This is acceptable.

  No change needed for the margin, but the fixed-header-bar div
  (`<div class="fixed-header-bar"></div>`) is still present in the HTML even though
  it has `display: none !important` in the CSS. It adds nothing and could confuse
  future readers.

  Remove the element from HTML:

  ```html
  <!-- Remove: -->
  <div class="fixed-header-bar"></div>
  ```

  Files: `public/activity.html`.

  Verify: page renders identically; no layout change.

---

## H · activity.html — notification-item unread background

The unread notification background is `#FDF0EF` (a very pale red), and hover is
`#FAE3E1`. These are custom hex values. The `.notification-item` has
`background: #ffffff` (solid white). This creates a minor inconsistency:
`.notification-item.unread` uses a custom pinkish tint while the rest of the
app uses `rgba` tints.

This is low-priority and intentional (solid white improves readability over the
photo). No change needed.

---

## I · activity.html & recipients.html — button label visibility on small screens

The "Oznacz wszystkie jako przeczytane" button in `activity.html`:

```html
<button class="btn btn-outline-light btn-sm" onclick="markAllAsRead()" id="markAllReadBtn">
    <i class="fas fa-check-double me-1"></i>
    <span class="d-none d-md-inline">Oznacz wszystkie jako przeczytane</span>
    <span class="d-inline d-md-none">Oznacz wszystkie</span>
</button>
```

On mobile this renders correctly as the short label — no fix needed here.

The problem reported ("buttons sometimes not showing properly on smaller screens")
most likely refers to the action buttons inside each present row on `recipients.html`.
The `recipients.html` present-item buttons use `.btn` from `styles.css` which sets
`min-height: 48px`, `padding: 0.875rem 1.5rem`, and critically `white-space: nowrap`.
On a 320px viewport these buttons can overflow their container.

- [ ] **I1. Cap button width and allow text wrapping inside present-row action buttons on recipients.html.**

  In `recipients.html` `<style>` block, after the existing
  `.recipients-page .present-item .present-actions .btn { white-space: nowrap; }` rule, add:

  ```css
  /* Small-screen button safety */
  @media (max-width: 480px) {
      .recipients-page .present-item .present-actions .btn {
          white-space: normal;
          font-size: 0.8rem;
          padding: 0.5rem 0.75rem;
          min-height: 36px;
      }
  }
  ```

  Files: `public/recipients.html` (inline `<style>` block).

  Verify: on a 375px viewport (iPhone SE size) the Reserve / Cancel / Bought
  buttons inside present rows are fully visible and do not overflow; text wraps
  to a second line if needed.

---

## J · recipients.html — filter panel header background

The filter panel header (`<div style="background: rgba(108, 117, 125, 0.12); …">`)
uses an inline style producing a muted gray tint. This clashes slightly with the
rest of the card headers in the app which are solid `#F44336` red (set by the
`.recipients-page .card-header, .recipients-page .aws-content-header { background: #F44336 }` rule).
The filter panel is intentionally not red (it's a utility control, not a section
title), so the gray is correct — no change needed.

---

## K · recipients.html — remove redundant `aws-main-content` wrapper card

The entire recipient list is wrapped in:
```html
<div class="card main-card aws-main-content">
```

This outer card has `.recipients-page .aws-main-content` rules that apply the
frosted surface — and then `.recipients-page .aws-content-body { padding: 0 }` 
strips the card-body padding to zero. The individual `.recipient-item` divs are
themselves frosted cards with their own `border-radius: 20px` and `box-shadow`.

The result is two layers of frosted glass stacked: outer wrapper + inner items.
On Chrome/Safari the outer wrapper's `backdrop-filter` breaks the inner items'
own backdrop-filter (stacking context issue), which is why the code has a long
block of `transform: none; filter: none; backdrop-filter: none` overrides on
`#recipientsList` — a workaround for the self-created problem.

The correct fix is to make the outer wrapper transparent (no surface), letting
the individual recipient cards float directly on the background photo.

- [ ] **K1. Make the outer aws-main-content wrapper invisible — cards float directly on the photo.**

  In `recipients.html` `<style>` block, update the `.recipients-page .aws-main-content` rule:

  ```css
  /* Before */
  .recipients-page .aws-main-content {
      background: rgba(255, 255, 255, 0.78) !important;
      backdrop-filter: blur(16px) saturate(160%) !important;
      -webkit-backdrop-filter: blur(16px) saturate(160%) !important;
      border: 1px solid rgba(255, 255, 255, 0.6) !important;
      border-radius: 20px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18) !important;
  }
  ```

  ```css
  /* After */
  .recipients-page .aws-main-content {
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
  }
  ```

  Also remove the now-redundant neutralization block for `.aws-main-content:hover`
  transforms (since the container has no hover effect when it's transparent), but
  keep the `#recipientsList` neutralizations as they protect the inner frosted
  items. Specifically, keep:

  ```css
  .recipients-page #recipientsList,
  .recipients-page #recipientsList .loading-placeholder {
      transform: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      …
  }
  ```

  and remove only the `.aws-main-content` and `.aws-main-content:hover` lines from
  that block.

  Files: `public/recipients.html` (inline `<style>` block).

  Verify: the page shows individual frosted person-cards floating directly on the
  background photo, identical to how the home page accordion content floats. The
  filter panel (which has its own inline frosted style) continues to show correctly.

---

## L · recipients.html — filter panel top margin

With item K1 applied, the outer card no longer provides its own padding above the
filter panel. The `filterAccordion` div has `margin-top: 20px; margin-bottom: 20px`
via inline style. On mobile `body.recipients-page` already has
`padding-top: calc(env(safe-area-inset-top, 0px) + 16px)` and
`.recipients-page .container.mt-4 { margin-top: 0 !important; padding-top: 8px }`.

- [ ] **L1. Adjust top margin on the filter accordion after K1.**

  In `recipients.html` HTML, change the `filterAccordion` inline style:

  ```html
  <!-- Before -->
  <div id="filterAccordion" style="margin-top: 20px; margin-bottom: 20px;">

  <!-- After -->
  <div id="filterAccordion" style="margin-top: 0; margin-bottom: 16px;">
  ```

  Files: `public/recipients.html`.

  Verify: there is no large blank gap above the filter panel on mobile; the 16px
  bottom margin provides breathing room before the first recipient card.

---

## M · Global CSS — `.btn` base padding in `styles.css`

`styles.css` sets:
```css
.btn {
    padding: 0.875rem 1.5rem;
    min-height: 48px;
}
```

This is very generous padding that makes buttons oversized in tight contexts
(present-row actions, quick-add form). Bootstrap's default (`0.375rem 0.75rem`
for regular and `0.25rem 0.5rem` for `.btn-sm`) is preferable for small action
buttons. However, `.btn-sm` is used for the action buttons in recipients.html and
home.html, and `.btn-sm` in Bootstrap already overrides padding to
`0.25rem 0.5rem`, so the `.btn` base rule only affects large buttons.

No global change needed — the existing `.btn-sm` usage already escapes the
over-padded base rule.

---

## N · Global CSS — duplicate `share-buttons` and `share-btn` rules in `styles.css`

`styles.css` defines `.share-buttons` and `.share-btn` twice (once around line 310
and again around line 600). The second definition resets the styles to solid
colored backgrounds. This is dead weight from legacy reorganization.

- [ ] **N1. Remove the first (older) `.share-buttons` / `.share-btn` block from `styles.css`.**

  In `public/styles.css`, remove the first block (around lines 305–335):

  ```css
  /* Remove this first occurrence: */
  .share-buttons {
      margin-top: 0.5rem;
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
  }
  .share-btn {
      padding: 0.375rem 0.75rem;
      font-size: 0.85rem;
      border-radius: 8px;
      …
  }
  /* (all .share-btn variants in the first block) */
  ```

  Keep the second block (around lines 595–625) which has the solid-colored
  backgrounds and correct hover transitions.

  Files: `public/styles.css`.

  Verify: share buttons on any page continue to render correctly with solid
  colored backgrounds; no visual difference because the second block's rules were
  already winning the cascade.

---

## O · Typography — heading hierarchy audit

Across the app the heading levels used in dynamically-rendered content are:

| Location | Element | Size |
|---|---|---|
| Home accordion buttons | `<button>` with inline style | ~1rem bold |
| Home section titles (`h3`) | `<h3>` inline style | `font-size` not set → Bootstrap ~1.75rem |
| Recipients — recipient name | JS-rendered (in `recipients.js`) | `font-size: 1.1rem` (from `.recipient-name` in styles.css) |
| Home sub-group headers | JS `<h5>` inline `font-weight: 600` | ~1rem (h5 default) |
| Formularz add tab header | `.card-header .card-title` | 1.5rem (from `.card-header.bg-transparent-blur .card-title`) |
| Formularz edit tab header | `.card-header .card-title` | not set → `.card-header.bg-red .card-title` = 1.1rem |

The `h3` in home.html (`Ogólny Postęp`) is 1.75rem while the accordion-button
headings are ~1rem — a large jump within the same card.

- [ ] **O1. Reduce the `Ogólny Postęp` h3 to match the accordion button scale.**

  In `home.html`, the progress-section heading:

  ```html
  <!-- Before -->
  <h3 style="color: #2d3748; font-weight: 700; margin-bottom: 20px; text-align: center;">
      <i class="fas fa-chart-line me-2"></i>Ogólny Postęp
  </h3>
  ```

  ```html
  <!-- After -->
  <h5 style="color: #2d3748; font-weight: 700; margin-bottom: 16px; text-align: center; font-size: 1rem;">
      <i class="fas fa-chart-line me-2"></i>Ogólny Postęp
  </h5>
  ```

  Files: `public/home.html`.

  Verify: the progress section title is the same visual size as the accordion
  section titles; the page has consistent heading scale throughout.

---

## P · Formularz card-header border-radius fix (related to E1)

After E1 sets the outer card border-radius, the red `card-header` in both tabs
needs consistent rounding so it doesn't cut sharply into the frosted card corners.

- [ ] **P1. Standardise card-header border-radius on both formularz tabs.**

  The `addTab` card already has `border-radius: 20px` on the outer card (from its
  inline style). Its `.card-header.bg-transparent-blur` has no explicit
  border-radius, so Bootstrap's `overflow: hidden` on the card clips it correctly.

  The `editTab` card after E1 also has `border-radius: 20px`.
  Its `.card-header.bg-red` has `style="text-align: center; border-radius: 14px;"` —
  a rounded header inside a rounded card. This mismatch (14px header inside 20px card)
  creates a visible gap at the top corners where the frosted card surface shows
  through.

  Change the editTab header radius to match the card:

  ```html
  <!-- Before (as updated in E1) -->
  <div class="card-header bg-red" style="text-align: center; border-radius: 14px 14px 0 0;">

  <!-- After -->
  <div class="card-header bg-red" style="text-align: center; border-radius: 20px 20px 0 0;">
  ```

  Also check the `addTab` card-header: `.card-header.bg-red` in `formularz.html`
  has no border-radius in its `<style>` block. Bootstrap's `.card` `overflow: hidden`
  handles clipping there — leave it as-is.

  Files: `public/formularz.html`.

  Verify: the editTab card shows a clean red header flush with the card's rounded
  top corners; no frosted surface visible in the header corners.

---

## Q · Dependency order note for implementer

Implement in this order to avoid re-work:

1. **K1** (recipients.html wrapper → transparent) + **L1** (margin fix) — do together
2. **E1** + **P1** (formularz editTab frosted card + header radius) — do together
3. **F1** (remove `<hr>`) — follow-up to E1
4. **A1** + **B1** + **C1** (home sub-cards: frosted, badge, button) — do together (all in same JS templates)
5. **A3** (home spacing)
6. **O1** (h3 → h5 heading fix)
7. **D1** (alert quiet)
8. **I1** (small-screen button wrapping)
9. **G1** (remove dead `fixed-header-bar` element)
10. **N1** (remove duplicate CSS block) — last, lowest risk

---

## R · Out of scope (do not touch)

- Bottom tab bar layout and styling (`bottom-tab-bar.css`) — recently stabilised
- Frosted glass on `recipients.html` recipient items — recently added, working
- `formularz.html` tab switching logic and `switchTab()` JS function
- Any server-side files
- `styles.deduped.min.css` — generated file, do not edit directly
