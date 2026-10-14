# Plan: home page bucket consistency (home-buckets-1)

Worktree: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\home-buckets-1`
Decision on workflow shape: the work is one small CSS change plus a cache-bust bump. It does not decompose into separable features, so the workflow tail is NOT restructured. The existing implement-and-review loop runs this plan.

## 0. Honesty note about measurement

Every shell command I tried in this step (git status, PowerShell, a read-only grep of the frozen CSS) was declined or cancelled by the approval prompt. That means:

- I could NOT boot the demo server or run Playwright. Nothing below is browser-measured.
- The "before" table is derived by reading the markup (`public/home.html`), the render code (`public/home-page.js`), the CSS (`public/home-page.css`, `public/app-theme.css`), and Bootstrap 5.3 accordion defaults. Inline styles are read verbatim from the JS template strings, so card values are exact. Bootstrap-derived values (accordion radius, border) are from the documented defaults and the CDN is pinned to 5.3.0 (`home.html` line 47).
- `public/styles.deduped.min.css` contains no `accordion` rule at all (grep returned nothing), so nothing in the frozen file overrides Bootstrap's accordion.
- Step 1 below is a measurement script the coder runs BEFORE editing and AFTER editing. If the coder also cannot run a shell, it must say so in its report and not claim measured results.

## 1. Inventory (read from source)

Link order in `home.html`: Bootstrap CDN, Font Awesome CDN, Remixicon, `styles.deduped.min.css`, `bottom-tab-bar.css?v=42`, `app-theme.css?v=14`, `home-page.css?v=1`. `home-page.css` is last, so it wins ties against everything except `!important` and inline styles.

Home page has exactly THREE buckets, each in its own `.stats-container > .accordion#accordionX > .accordion-item > .accordion-collapse > .accordion-body[style="padding:0"] > #xList`:

| Bucket | Accordion id | List container | Renderer | Empty message |
|---|---|---|---|---|
| Dostępne prezenty (red header) | `#accordionAvailable` | `#availablePresentsList` | `renderAvailablePresents` (home-page.js ~L91) | "Brak dostępnych prezentów" |
| Moje rezerwacje (orange) | `#accordionReservations` | `#myReservationsList` | `renderPresentsList(..., 'myReservationsList', ...)` (~L251) | "Brak zarezerwowanych prezentów" |
| Kupione (green) | `#accordionBought` | `#boughtPresentsList` | `renderPresentsList(..., 'boughtPresentsList', ...)` (~L251) | "Brak kupionych prezentów" |

Key finding: the two renderers emit the SAME card markup and the SAME inline card styles. Both produce `div.home-recipient-card` with inline `margin-bottom:20px; border-radius:20px; padding:20px; border:1px solid rgba(255,255,255,.55); box-shadow:0 6px 20px rgba(0,0,0,.13)`, and inside it `div.home-present-row` with inline `padding:12px; border-radius:10px; border-left:4px solid ...`. Only colors and the action buttons differ (background `rgba(248,249,250,.7)` vs `#f8f9fa`, border-left color, 1 vs 2 buttons). Those are out of scope (user said do not change colors/content).

So the card padding is already identical. The inconsistency is in the LIST CONTAINER. Only `#availablePresentsList` has a rule in `home-page.css`:

```css
#availablePresentsList { display:flex; flex-direction:column; gap:12px; padding:14px; }
@media (max-width:480px) { #availablePresentsList { padding:10px 6px; } }
```

`#myReservationsList` and `#boughtPresentsList` have no rule. Their cards sit in a plain block with zero inset, so cards touch the accordion frame edges, with no gap between sibling cards other than the inline 20px margin.

Skeleton placeholders: all three lists ship the same skeleton (`.skeleton-cards` with inline `padding:14px`, `.skeleton-card` radius 14px / padding 18px from `app-theme.css`). Same in all three; it is transient and gets replaced by `innerHTML`. Leave untouched.

Empty-state boxes: all three use `<div class="text-center py-5"><p class="text-muted">…</p></div>` (Bootstrap `py-5` = 3rem top/bottom). Identical markup; they inherit whatever container padding the list gets, so the container fix automatically aligns them.

Classes on other pages: `home-recipient-card` and `home-present-row` appear only in `home-page.js` and `home-page.css` (repo-wide grep, excluding `.agents` notes). `#availablePresentsList`, `#myReservationsList`, `#boughtPresentsList` appear only in `home.html`, `home-page.css`, `home-page.js`, plus `tests/helpers/pages.js` (a `ready` selector, not a style). `.skeleton-cards` / `.skeleton-card` ARE shared with recipients (app-theme.css and recipients-page.css), so the plan does not touch them.

Test impact: `tests/helpers/pages.js` waits on `#availablePresentsList`; unaffected by CSS.

## 2. BEFORE table (derived from source; confirm with the script in step 1)

Card values are identical across buckets and breakpoints are driven by the `@media (max-width:480px)` block, which uses `!important` for card/row padding.

Reference card (all three buckets, `.home-recipient-card`):

| Property | 320 / 375 (<=480) | 768 | 1024 |
|---|---|---|---|
| padding | 14px 12px (`!important` rule) | 20px | 20px |
| border-radius | 20px | 20px | 20px |
| margin-bottom | 20px | 20px | 20px |
| border | 1px | 1px | 1px |
| inner `.home-present-row` padding / radius | 10px / 10px | 12px / 10px | 12px / 10px |

Container per bucket:

| Property | Available list | Reservations list | Bought list |
|---|---|---|---|
| display | flex column | block | block |
| gap | 12px | none | none |
| padding <=480 | 10px 6px | 0 | 0 |
| padding >480 | 14px | 0 | 0 |
| card inset from frame (side), >480 | 14px | 0 | 0 |
| card inset from frame (side), <=480 | 6px | 0 | 0 |
| distance between sibling cards | 12px gap + 20px margin = 32px | 20px margin only | 20px margin only |
| top inset / bottom inset (>480) | 14px / 14+20 = 34px (last card margin) | 0 / 20px | 0 / 20px |

Frame (shared by all three; Bootstrap 5.3.0 defaults, not overridden anywhere):

| Property | Value |
|---|---|
| `.accordion-item` border-radius (`--bs-accordion-border-radius`) | 0.375rem = 6px |
| `--bs-accordion-inner-border-radius` (header button corners) | 6px - 1px = 5px |
| border | 1px solid `--bs-accordion-border-color` |
| background | `--bs-accordion-bg` (white) |
| `.accordion-body` padding | 0 (inline) |
| outer `.stats-container` radius / padding | 20px / 40px (<=768: 20px, <=480: 16px 12px) |

Visual consequence: a 6px-cornered frame holds 20px-cornered cards. In Reservations and Bought the cards also touch the frame. In Available the cards are inset 14px but the frame corner is still 6px. That is the mismatch the user sees.

Asymmetry note (kept on purpose): Available's bottom inset is 14px + the last card's inline 20px margin = 34px, and its top inset is 14px. The user called Available "good", so the plan reproduces this exactly in the other buckets instead of "fixing" it. Changing the inline `margin-bottom` would need a JS change and would alter the reference.

## 3. Target spec

(a) Reference padding/gap: exactly what Available has now. `#availablePresentsList` padding/gap/display values do NOT change.

(b) Card radius R = 20px, the `border-radius` of `.home-recipient-card` (the present cards). Ambiguity flagged: `.home-present-row` is 10px, but those are rows nested inside a card; the cards are the "present items" the user compares to. If the user later means rows, change the single token `--home-card-radius`.

(c) Frame corner radius, using the nested-radius rule (outer = inner + gap):

```
R_frame_outer (border box) = R_card + inset + border_width
R_frame_inner (padding box, header button) = R_card + inset
```

- inset = distance between frame padding edge and card edge = list padding (the smaller of the horizontal/vertical padding, so corners stay concentric where the gap is tightest)
- >480px: inset = 14px, so outer = 20 + 14 + 1 = 35px, inner = 34px
- <=480px: inset = 6px (side padding of `10px 6px`), so outer = 20 + 6 + 1 = 27px, inner = 26px

Applied by overriding Bootstrap's own accordion custom properties on each `#accordionX` (same element as `.accordion`; an ID selector beats the `.accordion` class rule). Bootstrap uses these variables for the item corners, the header button corners (including the collapsed state) and the collapse panel bottom corners, so the colored header follows automatically without touching `.accordion-button`.

(d) Same treatment for all three buckets. The Available container's own padding/gap are unchanged. Its frame corners DO change, because the user's first request is about those corners.

## 4. Exact CSS plan

File: `public/home-page.css` only (hand-written). Do NOT edit `styles.deduped.min.css`. Do NOT edit `app-theme.css` (no shared tokens exist there; there is no `:root` block, so new tokens are scoped to the three home accordions).

4.1 Replace the existing standalone block

```css
        #availablePresentsList {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 14px;
        }
```

with:

```css
        /* Home buckets (Dostępne / Moje rezerwacje / Kupione) share one look.
           Tokens are local: app-theme.css has no radius/spacing tokens. */
        #accordionAvailable,
        #accordionReservations,
        #accordionBought {
            /* = border-radius of .home-recipient-card (inline in home-page.js) */
            --home-card-radius: 20px;
            /* gap between the frame edge and the cards (smallest side) */
            --home-bucket-inset: 14px;
            /* Nested radius: outer = inner + gap (+1px frame border) */
            --bs-accordion-border-radius: calc(var(--home-card-radius) + var(--home-bucket-inset) + 1px);
            --bs-accordion-inner-border-radius: calc(var(--home-card-radius) + var(--home-bucket-inset));
        }

        #availablePresentsList,
        #myReservationsList,
        #boughtPresentsList {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 14px;
        }
```

4.2 In the existing `@media (max-width: 480px)` block, replace

```css
            #availablePresentsList {
                padding: 10px 6px;
            }
```

with:

```css
            #accordionAvailable,
            #accordionReservations,
            #accordionBought {
                --home-bucket-inset: 6px;
            }
            #availablePresentsList,
            #myReservationsList,
            #boughtPresentsList {
                padding: 10px 6px;
            }
```

Keep everything else in the file as is. No new breakpoint is needed: the file only has the 768 rule for `.stats-container` and the 480 block, and the bucket lists never had a 768 rule. The 768 and 1024 widths use the >480 values. 320 and 375 use the <=480 values. The existing `.home-recipient-card { padding: 14px 12px !important }` and `.home-present-row { padding: 10px !important }` rules stay and now apply identically inside every bucket (they already did; only the container inset changes).

4.3 Cache busting (required, otherwise existing users keep the old CSS)

`public/sw.js` serves non-HTML assets cache-first and precaches `/home-page.css?v=1`. So:

- `public/home.html`: change `<link href="home-page.css?v=1" rel="stylesheet">` to `home-page.css?v=2`.
- `public/sw.js`: change `'/home-page.css?v=1'` to `'/home-page.css?v=2'` in `urlsToCache`, and bump `CACHE_NAME` from `'prezenty-v127'` to `'prezenty-v128'`.

These are one-token edits, not structure changes. Check for other files that reference `home-page.css?v=1` outside `.agents/` notes before editing (the repo-wide grep showed only `home.html` and `sw.js`, though the output was truncated, so re-grep with `public/` and `tests/` scoping).

4.4 JS / HTML structure: NO change. CSS alone reaches the target because both renderers already emit identical card markup; only the list container rules differ. No class addition in `home-page.js` is needed.

## 5. Per-bucket result

| Aspect | Available | Reservations | Bought |
|---|---|---|---|
| List display / gap / padding | unchanged | becomes flex column / 12px / 14px (10px 6px <=480) | same as Reservations |
| Card padding, radius, shadow, colors | unchanged | unchanged (already identical) | unchanged (already identical) |
| Card spacing | unchanged (32px between, 14px top) | becomes identical to Available | becomes identical to Available |
| Frame corner radius | 6px becomes 35px (27px <=480) | 6px becomes 35px (27px <=480) | 6px becomes 35px (27px <=480) |
| Header (colored button) corners | follow frame, 34px (26px <=480) | same | same |
| Empty-state box | same markup, now inside padded container | now inside padded container, like Available | same |
| Skeleton | unchanged | gains 14px list padding around its own 14px (28px total, same as Available today) | same |

Things that must stay identical to Available: list padding/gap, card inset, frame radius, breakpoint behavior.

Not changed: any content, colors, shadows, typography, hover/click affordances (cards are not clickable and get none), other pages. Every selector is an ID-scoped home selector, and the Bootstrap variable overrides are scoped to the three home accordion ids, so other accordions (none found on other pages in `public/*.html`) are unaffected.

## 6. Steps for the coder

- [ ] 1. BEFORE measurement (skip with an explicit note if shell is unavailable). From the worktree, boot demo: `$env:PORT=<free>; $env:DEMO_MODE='true'; $env:NODE_ENV='development'; node server.js` (or `tests/helpers/start-demo-server.js`). Log in via `POST /api/login` with any non-empty username/password (cookie `prezenty.sid`, demo user 1). Demo data (`lib/demo-data.js`) already has bought-by-me presents (ids 2, 9) but NO reserved-not-bought presents, so `#myReservationsList` would show only the empty state. Populate with `POST /api/presents/1/reserve` (and optionally `/3/reserve`), then reload the page (the optimistic reserve flow has a known UI issue where the card may not move, so set state via the API and reload before measuring). Write a throwaway Playwright script outside the repo (Edge channel, `msedge`) that, at 320, 375, 768, 1024 widths, with all accordions expanded, logs `getComputedStyle` + `getBoundingClientRect` for: each `#xList` (display, gap, padding), each `.accordion-item` (border-radius per corner), each `.accordion-button` (corner radii), first `.home-recipient-card` (padding, margin, radius, border) and its left/top/bottom offset from the list's content box, and the empty-state div. Do not rely on screenshots. Save the table next to this plan as `home-buckets-1-measurements.md`. Compare against section 2 and note any difference.
- [ ] 2. Apply 4.1 and 4.2 to `public/home-page.css`. Verify: `git -P diff --stat` shows only that file; reload and re-run the script.
- [ ] 3. Apply 4.3 (`home.html`, `sw.js`). Verify: `git -P diff --stat` lists exactly `public/home-page.css`, `public/home.html`, `public/sw.js`; `node --check public/sw.js` exits 0.
- [ ] 4. AFTER measurement, same script. Expected, at 768 and 1024: all three lists `display:flex`, gap 12px, padding 14px; all three `.accordion-item` corner radii 35px; header button radii 34px; first card offset from list content box 0 and from frame padding edge 14px. Expected at 320 and 375: padding `10px 6px`, frame radius 27px, header 26px. Card padding/radius/margin identical to the BEFORE rows, and Available's list values identical to BEFORE. Check collapsed state too (click each header): collapsed header's bottom corners should be 34px / 26px (full-pill look is expected).
- [ ] 5. Regression: the e2e suite is Playwright (`npm test` runs `playwright test`; `npm run build` is a no-op). Run `npm test` and compare with a baseline taken at step 1 (same failures before/after are acceptable; new failures are not). Spot-check recipients, activity, rezerwacje, wiadomosci, leaderboard, formularz visually or by computed style that `.skeleton-card` and other shared classes are unchanged (no shared file other than `sw.js` cache name was touched).
- [ ] 6. Commit locally (never `git push`). Conventional commit, e.g. `style: align home bucket cards and frame corners`; body explains the container rule extension and the nested-radius formula.

## 7. Risks and judgment calls

- A 35px frame radius is noticeably rounder than today's 6px. It is the value the nested-radius rule gives for 20px cards with a 14px inset. If the result looks too round, the single knob is `--home-bucket-inset` (frame follows `card radius + inset`); a simpler alternative is a flat 20px frame, which matches the card radius numerically but is not concentric. I chose concentric because the user asked for "similar" corners and parallel curves read as similar.
- On <=480px the 27px frame sits inside a 20px `.stats-container` with only 12px side padding, so the frame is rounder than its parent. Parent radius is outside the scope of this task and the cards are the stated reference.
- The 20px last-card margin makes bottom inset larger than top inset in every bucket. That is Available's current (approved) look, copied on purpose.
- Hidden-risk check for the coder: the accordion `.accordion-collapse` has no `overflow:hidden` once expanded, so nothing clips. The `.collapsing` transition class clips with `overflow:hidden`, which now also rounds at 35px during animation. This is expected and harmless.
