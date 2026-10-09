# Verification

## Review findings (review.json) handled
1. "Dodaj dla kogoś innego" contrast (blocking): the class now has a dark `#2d3748` text, a `rgba(0,0,0,0.09)` fill and a `2px solid #718096` border. That border is about 4:1 against the near-white card, so it clears 3:1. Hover goes to 0.14 fill with a `#4a5568` border. The button is clearly visible in `formularz-375-bottom.png`.
2. Class/context mismatch: renamed `.btn-transparent-blur` to `.btn-secondary-light`, with a comment saying it's for light cards only. It was used only in formularz.html.
3. styles.css on home.html: already resolved. home.html loads only `styles.deduped.min.css` (no `styles.css` link), so no change was needed.

## Commands run
- `node --check public/recipients.js`, `public/formularz.js` and `public/sw.js` all exited 0.
- I built the harness in `%TEMP%\prezenty-harness` (outside the repo, now deleted):
  - A `build.js` script copied the real `<head>` of `recipients.html` and `formularz.html`: every loaded stylesheet (`styles.deduped.min.css`, `aws-design.css`, `bottom-tab-bar.css`, `app-theme.css`, `filters.css`, CDN css) as `file:///` links into `public/`, plus all the inline `<style>` blocks.
  - It inserted markup matching the post-change `generatePresentItem`, `generateReservationButton` and `convertUrlsToLinks` output (recipients.js).
  - It also inserted the real `#editTab` markup from formularz.html, filled with `displayMyPresents` and `makeLinksClickable` output, plus the real `.bottom-tab-bar`.
- I took screenshots with `playwright-core@1.47.2` (installed only in the temp dir) driving the local Edge, with true viewports at 320, 375 and 768.
  - Plain headless Edge `--window-size` gets clamped to about 490px wide, so those shots were not real narrow viewports.
  - The harness has no app JS, so it forced `.present-item` to opacity 1 and showed `#editTab` (which `switchTab('edit')` normally does).

## Screenshots (`.agents/tasks/screenshots/`)
recipients-320.png, recipients-375.png, recipients-768.png, recipients-375-bottom.png,
formularz-320.png, formularz-375.png, formularz-768.png, formularz-375-bottom.png.
In the full-page shots the fixed tab bar and the background are drawn at viewport height. That's a full-page capture artifact. Use the `-bottom` shots to check clearance.

## Observations
- **Recipient cards, 320 and 375px**
  - Measured: the title is 16px, `#1a1a1a`, `word-break: normal`, line-height 1.4. Comments are 15px, `#2b2b2b`.
  - Titles wrap only at spaces ("Róisín Murphy / Overpowered - vinyl"), with no mid-word breaks.
  - Action buttons drop below the title, right-aligned, so the title uses the full row width.
  - Kupione and Anuluj sit side-by-side at 375px. At 320px they wrap onto two lines because the row is only about 177px wide.
- **Recipient cards, 768px:** the row stays side-by-side as before (title on the left, Zarezerwuj / Kupione+Anuluj column on the right). No regression.
- **Long URL:** shown on one line with an ellipsis (`white-space: nowrap; text-overflow: ellipsis`) in both views. The full URL is in `title`.
- **Formularz edit list**
  - Items sit on a 92% white background with a yellow left border.
  - Measured: title 16px / 600 `#1a1a1a`, comments 15px `#333`, date 13px `#555`, link `#0D47A1`.
  - "Nebulizator do olejkow / eterycznych Tokio" wraps at spaces only.
  - Edit and delete stay a compact 40px column on the right.
- **"Dodaj dla kogoś innego"** renders after `#myPresentsList` at all widths.
- **Bottom clearance at 375px after scrolling to the bottom**
  - Body `padding-bottom` is 128px on both pages.
  - Formularz: the button ends at 618px, while the FAB starts at 700px and the bar at 718px.
  - Recipients: the last card item ends at 575px, so it's clear as well.
## Opacity pass (formularz edit list)
- `#editTab .main-card` inline style: background 0.78 → `rgba(255,255,255,0.9)`, backdrop-filter `blur(16px) saturate(160%)` → `blur(20px) saturate(110%)`.
- `#myPresentsList .my-present-item`: `rgba(255,255,255,0.97)`, `backdrop-filter: none`, border `rgba(0,0,0,0.1)`, shadow `0 2px 8px rgba(0,0,0,0.1)`; hover `#fff`.
- sw.js cache `prezenty-v113`.
- Harness: real formularz.html (scripts stripped) over seba.jpg plus a forced red blurred blob, Edge via playwright-core, 320/375/768. Screenshots: `formularz-opacity-{320,375,768}.png`. Cards render clean white; the blob only shows faintly at the panel edges.
- Computed colors: title #1a1a1a, comments #333, date #555, link #0D47A1 on ~white (≥7:1); button #2d3748 on 9% black fill (≥9:1); inputs #212529 on rgba(255,255,255,0.95). Worst case, date on the panel over the red blob, works out to about 6:1.

- `git diff --stat` lists only `public/formularz.html`, `public/formularz.js`, `public/recipients.html`, `public/recipients.js`, `public/sw.js`, plus the `.agents/tasks/plan.md` edit, which was already there. `vercel.json` was not touched.
