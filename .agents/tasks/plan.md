# Implementation Plan: mobile present-item readability + "Dodaj dla kogoś innego" placement

Repo root: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty` (branch `main`, edit in place).
Constraints: do NOT touch `vercel.json`. Do NOT commit or push. OneDrive may throw "cloud operation was not completed" / UNKNOWN on read/write: wait a few seconds and retry.
No build or test tooling exists (`npm test` is an echo, `npm run build` is an echo). Verification = `node --check` on changed JS + the headless-browser screenshot harness in the Verification section.

## Priority (user clarification)

The "better text visibility" request is mainly about the Dodaj / Edytuj prezenty page (`formularz.html`, `#editTab`, list rendered by `displayMyPresents()` in `formularz.js`): title, link, comments and date metadata must be clearly readable against the semi-transparent blurred card. This is the top priority for coder and reviewer. On the recipient cards (`recipients.html`), the must-have is the mid-word wrapping / squeezed title fix around the "Zarezerwuj" button. Contrast changes there are optional (a light touch is fine).

## Findings that drive the design

- There are two pages, not one:
  - The recipient cards with "Zarezerwuj" are `public/recipients.html` + `public/recipients.js` (`generatePresentsList()` ~L1854, `generateReservationButton()` ~L2137, `convertUrlsToLinks()` ~L2432; the second definition overrides the dead one at ~L2352).
  - The "add/edit my presents" view (long URL, edit/delete icon buttons, "Dodaj dla kogoś innego") is `public/formularz.html` `#editTab` + `public/formularz.js` (`displayMyPresents()` ~L632, `makeLinksClickable()` ~L664).
- Stylesheets:
  - `recipients.html` links `styles.deduped.min.css`, `aws-design.css?v=3`, `bottom-tab-bar.css?v=41`, `app-theme.css?v=13`, `filters.css?v=7`. Its inline `<style>` blocks in `<head>` (L39 onward) come AFTER the links, and they already own the "Homepage-style present rows" overrides (L186–245), including `.recipients-page .present-item .d-flex { flex-wrap: nowrap !important; ... }`.
  - `formularz.html` links only `styles.deduped.min.css`, `bottom-tab-bar.css?v=41` and `app-theme.css?v=13` (no aws-design or filters), then has its own inline `<style>` blocks.
- Root causes of the mid-word breaks:
  - `styles.deduped.min.css` `.present-title{word-break:break-word}`, `aws-design.css` `.recipients-page .present-title{word-break:break-word}` and `.recipients-page .present-comments{word-break:break-all}`. The legacy `word-break: break-word` lets the min-content width collapse to single letters, so a `flex-shrink:0` nowrap button column squeezes the title into a sliver.
  - `.present-actions` is `flex-shrink:0` with `white-space:nowrap` buttons, plus bootstrap `.w-100{width:100%!important}`, plus min.css `@media(max-width:575.98px){.recipients-page .present-item .w-100.w-md-auto{width:100%!important}}`.
  - Links: `recipients.js convertUrlsToLinks` uses inline `word-break: break-all; display: inline-block`. `formularz.js` `displayMyPresents` uses inline `word-break: break-word` on the wrapper, h6 and p, and `makeLinksClickable` uses inline `word-break: break-all` on `<a>`.
- Formularz items: inline `background: rgba(255,255,255,0.18)` on top of a 0.78 white card, text in bootstrap `.text-muted` (#6c757d) and `small`. That reads as low contrast against the reddish blurred photo.
- Bottom nav: `bottom-tab-bar.css` sets `body.has-tab-bar { padding-bottom: 104px }`. The bar sits at `bottom: max(12px, env(safe-area-inset-bottom))` and is about 70px tall, and the FAB sticks out 24px above it. On iPhones with a safe-area inset the last content is covered. On desktop (>=992px), `app-theme.css` sets `body.has-desktop-nav { padding-bottom: 24px !important }`, which must keep winning.
- Caching: `sw.js` is cache-first for non-HTML assets (`CACHE_NAME = 'prezenty-v111'`). HTML is network-first, so inline `<style>` edits ship immediately, but changed JS needs `?v=` bumps plus a `CACHE_NAME` bump.

## Decisions

- **D1. Put CSS in the pages' inline `<style>` blocks, not in `styles.deduped.min.css`.** Edit `recipients.html` for the recipient cards and `formularz.html` for the edit view. Those blocks load last and already hold the present-row overrides, so new rules win the cascade without editing minified output that has no regeneration step for this file. The minified file stays untouched, so there is nothing to keep in sync.
- **D2. Breakpoints:**
  - `@media (max-width: 480px)` stacks the recipient-card actions under the title. This covers 320, 360, 375 and 414px.
  - `@media (max-width: 767.98px)` holds the mobile typography and wrapping rules.
  - `@media (max-width: 991.98px)` holds the bottom padding (desktop >=992 uses the sidebar and has its own 24px padding).
  - At 768px the layout stays side-by-side, as it is today.
- **D3. Wrapping policy:**
  - Text gets `word-break: normal !important; overflow-wrap: break-word !important;`. Normal words never break. Only unbreakable runs that would overflow get broken.
  - URLs render on one line with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 100%`. Display text is already truncated to 47/57 chars in JS, and the ellipsis covers narrow widths.
- **D4. Edit the link markup in JS.** Fix the inline styles at the source and add a class, rather than fighting inline styles with `!important`. In `formularz.js`, replace the inline styles in `displayMyPresents` with semantic classes so formularz.html CSS controls readability.
- **D5. Move the button in HTML.** Move the "Dodaj dla kogoś innego" block in `formularz.html` from before `#myPresentsList` to after it. Its handler is an inline `onclick="switchTab('add', true)"`, so moving the markup keeps it working. No JS references that block.

## Steps

- [ ] 1. **Fix link markup in recipients.js and bump cache versions.**
      - In `public/recipients.js`, second `convertUrlsToLinks()` (~L2432): change the generated `<a>` to `class="present-link"` with inline `style="color: #1565C0; text-decoration: underline; display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"`. Remove `word-break: break-all` and `display: inline-block`. Add `title="${cleanUrl}"` so the full URL is still visible on hover/long-press. Leave the dead first definition (~L2352) alone.
      - Do not change `generatePresentItem` or `generateReservationButton` markup. Layout is solved in CSS (step 2), so `refreshPresentButtons()`, `updateButtonOptimistically()` and the reserve-button updates (~L3098, ~L4059) keep working unchanged.
      - In `public/recipients.html` L2315, bump `recipients.js?v=21&t=1111111111` to `recipients.js?v=22&t=1111111111`.
      Files: `public/recipients.js`, `public/recipients.html`
      Verify: `node --check public/recipients.js` exits 0.

- [ ] 2. **Recipient-card CSS (Issue 1, must-have: wrapping and layout).** Add a new block to the `recipients.html` inline `<style>`, directly after the `I1` `@media (max-width: 480px)` block (~L238–245) and before "Gray text with white shadow in modals":
      ```css
      /* Present rows: readable titles, no mid-word breaks */
      .recipients-page .present-item .present-title,
      .recipients-page .present-item .present-comments {
          word-break: normal !important;
          overflow-wrap: break-word !important;
          hyphens: manual;
      }
      .recipients-page .present-item .present-title {
          color: #1a1a1a !important;
          line-height: 1.4 !important;
      }
      .recipients-page .present-item .present-link {
          display: block; max-width: 100%;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-weight: 500;
      }
      @media (max-width: 767.98px) {
          .recipients-page .present-item .present-title { font-size: 16px !important; }
          .recipients-page .present-item .present-comments { font-size: 15px !important; line-height: 1.45; color: #2b2b2b !important; }
      }
      /* Narrow phones: actions drop below the title instead of squeezing it */
      @media (max-width: 480px) {
          .recipients-page .present-item > .d-flex {
              flex-wrap: wrap !important;
              row-gap: 10px !important;
          }
          .recipients-page .present-item .present-details {
              flex: 1 1 100% !important;
              width: 100% !important;
          }
          .recipients-page .present-item .present-actions.d-flex {
              flex: 1 1 100% !important;
              flex-direction: row !important;
              justify-content: flex-end !important;
              align-items: center !important;
              flex-wrap: wrap !important;
              gap: 8px !important;
              width: 100% !important;
          }
          .recipients-page .present-item .present-actions .btn,
          .recipients-page .present-item .present-actions .btn.w-100 {
              width: auto !important;
              min-width: 0 !important;
              white-space: nowrap !important;
              min-height: 40px;
              padding: 0.5rem 0.9rem !important;
              font-size: 0.875rem !important;
          }
      }
      ```
      - Cascade notes:
        - `.recipients-page .present-item > .d-flex` has the same specificity as the existing nowrap rule (0,3,0) and comes later, so it wins.
        - `.recipients-page .present-item .present-actions .btn.w-100` (0,5,0) beats both the min.css `.w-100.w-md-auto` (0,4,0) and bootstrap `.w-100`.
        - The `.present-actions.d-flex` rule also beats the earlier `.present-actions.d-flex { flex-direction: column }` (same specificity, later).
      - Keep `.reserved-by-me` (orange left border from app-theme.css), `.checked` and `.reserved-by-other` looks untouched. Do not override `color` on `.reserved-by-me .present-title` (app-theme sets `#e65100 !important` with higher specificity). Do not add `!important` color to `.checked` / `.reserved-by-other` titles. If the generic `#1a1a1a !important` would beat their grey/line-through look, scope it with `:not(.checked):not(.reserved-by-other):not(.reserved-by-me)`.
      Files: `public/recipients.html`
      Verify: harness screenshots (see Verification) at 320 and 375px.
      - Title "Róisín Murphy Overpowered - vinyl" wraps only at spaces and spans the full card width.
      - The orange "Zarezerwuj" button sits right-aligned below the title.
      - The Kupione/Anuluj pair sits side-by-side below the title.
      - A long URL shows on one line with an ellipsis.
      At 768px the row stays side-by-side with the title wrapping at spaces only.

- [ ] 3. **Formularz edit-view readability (top priority) and link fix.** In `public/formularz.js`:
      - `displayMyPresents()` (~L632): keep the outer element as `class="list-group-item my-present-item" data-present-id="${present.id}"`. `deletePresent` looks items up with `#myPresentsList .list-group-item[data-present-id=...]`, so both must stay. Remove its inline `background/backdrop-filter/border/border-radius/margin-bottom` style; CSS takes over.
      - Inner layout: `<div class="d-flex justify-content-between align-items-start my-present-row">`.
      - Text column: `<div class="flex-grow-1 my-present-body">` with no inline styles.
      - Title: `<h6 class="mb-1 my-present-title">`.
      - Comments: `<p class="mb-1 my-present-comments">` (drop `text-muted small`).
      - Date: `<small class="my-present-date">` (drop `text-muted`).
      - Buttons: `<div class="btn-group-vertical ms-2 my-present-actions">`. Add `aria-label="Edytuj prezent"` / `aria-label="Usuń prezent"` to the two icon-only buttons. Leave their `onclick` exactly as is.
      - `makeLinksClickable()` (~L664): in the `<li>`, keep `display:flex; align-items:center; min-width:0`. On the `<a>`, use `class="my-present-link"`, `title="${escapeHtml(cleanUrl)}"`, and inline `style="color: #0D47A1; text-decoration: underline; display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"`. Remove `word-break: break-all`.
      - In `public/formularz.html` L716, bump `formularz.js?v=15` to `formularz.js?v=16`.
      Files: `public/formularz.js`, `public/formularz.html`
      Verify: `node --check public/formularz.js` exits 0. Then load the harness: edit and delete buttons render, and the markup still matches `#myPresentsList .list-group-item[data-present-id]`.

- [ ] 4. **Formularz CSS: contrast, sizes, and bottom padding.** Append to the second inline `<style>` block in `public/formularz.html`, after the `.btn-green:hover` rule and before `/* Hide default navbar */`:
      ```css
      /* My presents list: high-contrast items on the frosted card */
      #myPresentsList .my-present-item {
          background: rgba(255, 255, 255, 0.92) !important;
          border: 1px solid rgba(0, 0, 0, 0.08) !important;
          border-left: 4px solid #FFC107 !important;   /* yellow accent */
          border-radius: 14px !important;
          margin-bottom: 10px;
          padding: 12px 12px 12px 14px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }
      #myPresentsList .my-present-body { min-width: 0; }
      #myPresentsList .my-present-title,
      #myPresentsList .my-present-comments {
          word-break: normal; overflow-wrap: break-word; hyphens: manual;
      }
      #myPresentsList .my-present-title {
          color: #1a1a1a; font-size: 16px; font-weight: 600; line-height: 1.4;
      }
      #myPresentsList .my-present-comments {
          color: #333333; font-size: 15px; line-height: 1.45;
      }
      #myPresentsList .my-present-date { color: #555555; font-size: 13px; }
      #myPresentsList .my-present-link { color: #0D47A1 !important; font-weight: 500; }
      #myPresentsList .my-present-actions { flex-shrink: 0; }
      #myPresentsList .my-present-actions .btn { min-width: 40px; min-height: 40px; }
      /* Keep the last item and the button clear of the floating tab bar + FAB */
      @media (max-width: 991.98px) {
          body.has-tab-bar { padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px)) !important; }
      }
      ```
      - The `@media` scope keeps the desktop `body.has-desktop-nav { padding-bottom: 24px !important }` from app-theme.css in effect.
      - Contrast: #1a1a1a, #333 and #555 on about 92% white, and #0D47A1 on white, are each at or above 7:1 / 4.5:1.
      - Check that the global `.list-group-item{padding:1rem 1.5rem}` from min.css does not squeeze the content. The `#myPresentsList` padding (higher specificity) overrides it.
      Files: `public/formularz.html`
      Verify: harness formularz screenshots at 320, 375 and 768px.
      - "Nebulizator do olejkow eterycznych Tokio" wraps only between words in dark text.
      - The URL is a single line ending in an ellipsis.
      - The date is dark grey.
      - The edit/delete buttons stay a compact column on the right.

- [ ] 5. **Move "Dodaj dla kogoś innego" below the list (Issue 2).** In `public/formularz.html` `#editTab .card-body` (~L590–603), cut the block:
      ```html
      <div class="d-grid mb-4">
          <button type="button" class="btn btn-transparent-blur btn-lg" onclick="switchTab('add', true)" style="border-radius: 14px;">
              <i class="fas fa-user-friends me-2"></i>Dodaj dla kogoś innego
          </button>
      </div>
      ```
      - Paste it immediately after the closing `</div>` of `<div id="myPresentsList">…</div>`, still inside `.card-body`.
      - Change the wrapper class to `d-grid mt-3 mb-1`.
      - Order becomes: quick-add form, `#myPresentsList`, button.
      Files: `public/formularz.html`
      Verify: the harness formularz screenshot shows the button under the last present item. In a full-page screenshot at 375px it is fully visible above the floating tab bar when scrolled to the bottom (body bottom padding >= 128px).

- [ ] 6. **Same bottom-padding guard on recipients.html.** Add to the same block from step 2:
      ```css
      @media (max-width: 991.98px) { body.recipients-page.has-tab-bar { padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px)) !important; } }
      ```
      Then bump `const CACHE_NAME = 'prezenty-v111'` to `'prezenty-v112'` in `public/sw.js` so cache-first clients drop the old JS.
      Files: `public/recipients.html`, `public/sw.js`
      Verify: `node --check public/sw.js` exits 0. In the harness, the last recipient card is fully visible above the bar at 375px.

- [ ] 7. **Final check.**
      - `git -P diff --stat` lists only `public/recipients.html`, `public/recipients.js`, `public/formularz.html`, `public/formularz.js` and `public/sw.js`. `vercel.json` must not appear in this task's changes; it already has a separate unrelated modification, so leave it alone.
      - Run `node --check` on the three JS files.
      - Clean up the temp harness directory.

## Verification: headless screenshot harness (outside the repo)

1. Create `$env:TEMP\prezenty-harness\` and do not put any harness file in the repo.
2. Write `$env:TEMP\prezenty-harness\build.js`, a Node script with no dependencies that:
   - Reads `public/recipients.html` and `public/formularz.html` from the repo and extracts everything between `<head>` and `</head>` (all `<link rel="stylesheet">` and inline `<style>` blocks, i.e. the REAL served CSS).
   - Rewrites relative stylesheet hrefs (`styles.deduped.min.css`, `aws-design.css?v=3`, etc.) to absolute `file:///` URLs pointing into the repo's `public/`. Keep the CDN bootstrap, font-awesome and remixicon links.
   - Copies the body background: `background-image: url('seba.jpg')` resolves relative to the harness, so also rewrite `url('seba.jpg')` to the absolute file URL of `public/seba.jpg`.
   - Emits `recipients-harness.html` with `<body class="recipients-page has-tab-bar">`, containing a `.recipient-item` card wrapping `<div class="presents-list presents-list-container">`. Present markup is copied verbatim from the post-change `generatePresentItem` template in recipients.js (`.present-item > .d-flex.align-items-start.justify-content-between.w-100` > `.d-flex.present-details` + `.present-actions.d-flex.flex-column`). Include three items:
     - "Róisín Murphy Overpowered - vinyl" with the Zarezerwuj button (exact `generateReservationButton` unreserved markup).
     - A `reserved-by-me` item with the Kupione + Anuluj pair.
     - A title containing `https://www.example-shop.pl/produkty/nebulizator-do-olejkow-eterycznych-tokio-123456789` processed into the post-change `convertUrlsToLinks` output.
     - Copy the real `.bottom-tab-bar` markup from formularz.html too.
   - Emits `formularz-harness.html` with `<body class="has-tab-bar">`. It contains the real `#editTab` card markup from formularz.html (after step 5): quick-add form, then `#myPresentsList` holding two items in the exact post-change `displayMyPresents()` + `makeLinksClickable()` output, then the "Dodaj dla kogoś innego" button. Items:
     - "Nebulizator do olejkow eterycznych Tokio" with the long URL in comments.
     - "Róisín Murphy Overpowered - vinyl".
     - Also include the `.bottom-tab-bar` markup.
   - Run it with `node build.js`.
3. Screenshot with headless Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) or Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`). Both exist. For each harness and each width in 320, 375 and 768:
   ```powershell
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=375,1600 --screenshot="$env:TEMP\prezenty-harness\formularz-375.png" "file:///$($env:TEMP -replace '\\','/')/prezenty-harness/formularz-harness.html"
   ```
   Wait about 3s for the CDN CSS. Add `--virtual-time-budget=5000` if fonts or icons are missing.
4. Inspect each PNG with the image reader. Pass criteria:
   - No normal word split mid-word (e.g. no "Murph/y", "Overpo/wered").
   - Title text uses most of the row width at 320 and 375px.
   - URLs are on one line with an ellipsis.
   - On formularz, title/comments/date text is dark and clearly legible on the frosted card, title >= 16px and comments >= 15px.
   - "Dodaj dla kogoś innego" is below the list.
   - The yellow (formularz) / orange (reserved-by-me) left accents and orange Zarezerwuj button are intact.
   - At 768px the recipient rows stay side-by-side.
   - Bottom check: also take a 375x700 shot of each harness after adding `<script>window.scrollTo(0, document.body.scrollHeight)</script>`. The last item and button must be fully visible above the floating tab bar.
5. Delete `$env:TEMP\prezenty-harness\` when done.

## Assumptions / gaps

- The "yellow left-border accent" appears on the reserved-by-me state on recipient cards (app-theme.css currently makes it orange #F57C00). That is kept as is. On formularz items, a #FFC107 yellow left accent is added to match the user's description of the look.
- The identified-user "Twoje dodane prezenty" list in recipients.js (~L1125, `li.present-item .present-name`) is out of scope beyond inheriting the generic wrapping rules.
