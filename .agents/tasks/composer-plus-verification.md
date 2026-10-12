# Collapsed composer bar: [chevron] [full-width bordered input]

Request, as it settled: in the collapsed add-present bar the bordered field must
be visible and take the whole row, the leading icon is the normal chevron, and
there is no `+` / green submit button on the right.

## 1. Ground truth

HEAD (`d689cc6`, equal to `origin/main`) and the working tree before this task
differed in nothing relevant, so the deployed bar is what HEAD renders (real app,
demo mode, Edge, 375px and 320px):

| | HEAD / deployed | Why |
|---|---|---|
| leading icon | green circle with a `+` (`.quick-add-cue`, fa-plus) | decorative cue added in composer v2 |
| real chevron `#quickAddToggle` | `visibility: hidden` | v2 design |
| green submit `#quickAddBtn` | `visibility: hidden` (correct) | v2 design |
| input border | `rgba(0,0,0,0)`, transparent fill (not visibly bordered) | `body:not(.quick-add-active) .quick-add-name .form-control` painted it transparent |
| input right edge | stopped 60px short of the row's inner right edge (375px: input 77..294, inner edge 354; 320px: 77..239 vs 299) | `.quick-add-name` only occupied grid column 2; the 52px submit column + 8px gap stayed empty |

Root cause of the lopsided bar: the v2 plan deliberately reserved the submit
column so the field's box stayed identical in both states. The user now wants
the opposite, so the column is given to the field while collapsed.

## 2. What changed (all in `public/formularz.html`, targeted edits)

1. `body:not(.quick-add-active) .quick-add-name { grid-column: 2 / 4; }` inside
   `@media (max-width: 768px)`. Only the column span changes, never the row, and
   `grid-template-columns` is untouched, so nothing for WebKit to interpolate.
   The swap on entering add mode is instant.
2. Collapsed input: `background: #fff; border-color: #8a96a3` (was transparent),
   scoped to the collapsed state. Width/height come from `.form-control`.
3. `.quick-add-cue` is now a visual twin of the real toggle's collapsed look:
   fa-chevron-up, 48x48, 1px `#cbd2d9` border, `#eef1f4` fill, `#2d3748`, 1rem.
   Still `aria-hidden`, `pointer-events: none`, no tab stop, not a button.
   A tap on it falls through to the row-level click handler.
4. Comments that described the old design updated.

Not changed: `formularz.js` (the state machine is untouched; no `keepDesc`,
pointerdown or focusin coordination returned), the real toggle's CSS and
behaviour, the hint wording, desktop (all new rules are inside the mobile media
query; the `.quick-add-cue { display: none }` base rule is intact).

Keyboard defects stay unreachable: the real `#quickAddToggle` is still
`visibility: hidden` while collapsed (focus probe asserts it does not take
focus); in add mode it is the real focusable button with correct
`aria-expanded`.

## 3. Numbers

Right gap = composer inner right edge minus input right edge.

| | before (HEAD) | after |
|---|---|---|
| 375px right gap | 60px | 0px |
| 320px right gap | 60px | 0px |
| circle left inset | 8px | 8px |

Entering add mode, sampled on every animation frame (320px / 375px):

- input left: 77 -> 77 (range 77..77) at both widths
- circle left: 21 -> 21 at both widths
- input offset from the chevron circle (same grid row): range -1..0px
- input width 222 -> 162 (320px) and 277 -> 217 (375px): the submit button
  taking its column back, instant, as intended

Deviation from the literal "top unchanged" wording: the input's viewport `top`
is not invariant (320px: 585.5 -> 583.1, 375px: 581.5 -> 583.1). That is the
composer itself moving: its `bottom` goes 106/110 -> 12 and the head and
description rows open, as in the approved v2 behaviour. The input's position
relative to the chevron circle in the same row is what stays put, and that is
what the test asserts.

## 4. Test changes (`tests/e2e/composer.spec.js`)

Run: `npx playwright test tests/e2e/composer.spec.js` -> 21 passed, 0 failed,
0 skipped (was 20; one test added).
Other specs touching /formularz or shared dock behaviour (`smoke`, `a11y`,
`no-horizontal-overflow`, `wrapping`, `edit-sheet`): 43 passed, 11 skipped,
0 failed. I did not run the full suite or the remaining specs
(`chat-reactions`, `escaping`, `helpers`, `pluralization`, `xss-usernames`), which
do not exercise the composer.

Changed assertions and why:

- Test 1 (renamed, "collapsed bar is [chevron] [full-width bordered input]"):
  kept every earlier check (real submit/chevron/close not focusable and hidden,
  cue visible 48x48 in the toggle's cell, pointer-events none, row height,
  pointer cursor, prompt text and fit). Reworded the "+ must be hidden" message
  to "green submit must be hidden". Added: input visible, border width >= 1 and
  not transparent, fill not transparent; cue icon is fa-chevron-up, not fa-plus,
  and equals the real toggle's icon; the cue's computed look equals the real
  toggle's; input right edge within 1px of the composer's inner right edge; circle
  left within 1px of the inner left edge.
- Test 2 (renamed "keeps the name field's left edge in place"): the old
  assertions `active.nameWidth == collapsed.nameWidth` encoded the reserved
  empty column, which the user rejected. Replaced by: left edge equal in all
  three states, width after closing equals collapsed width, add-mode width is
  smaller and its right edge is at or left of the submit button's left edge.
  Everything else (placeholders, heights, padding, visibility swaps) unchanged.
- Test 3 (added in the previous step of this task, rewritten here): per-frame
  sampler asserts left edge, offset from the circle and circle left drift <= 1px
  at 320 and 375; width must shrink; real toggle visible, focusable and
  `aria-expanded` correct through open/collapse/open/close; decorative chevron
  hidden in add mode and back after closing. It no longer asserts a constant
  width.
- Test 4: spot labels renamed (decorative chevron; right end of the input). The
  third tap now lands on the input itself instead of an empty cell.
- Header comment updated. No assertion was deleted or loosened.

## 5. Bumps

- `public/sw.js` `CACHE_NAME`: `prezenty-v123` -> `prezenty-v124`.
- `formularz.js?v=22`: unchanged (file not touched). `formularz.html` carries no
  `?v=` of its own. No other versioned asset touched.

## 6. Screenshots (`.agents/tasks/screenshots/`)

`composer-plus-375-collapsed.png`, `composer-plus-320-collapsed.png`,
`composer-plus-375-addmode.png`. I looked at all three: collapsed reads
[grey chevron circle] [bordered input to the right inset] with no submit button;
add mode is unchanged (title, close, real chevron, bordered focused field, hint
"Szczegóły ułatwią zakupy", textarea, green submit).

Visible side effect: on entry the decorative grey chevron is replaced by the real
toggle, which is green and points down because the details open with the form
(existing behaviour). The swap is not pixel-invisible.

Nothing committed or pushed. Working tree changes: `public/formularz.html`,
`public/sw.js`, `tests/e2e/composer.spec.js`, three PNGs, this file.
Temporary specs were deleted.
