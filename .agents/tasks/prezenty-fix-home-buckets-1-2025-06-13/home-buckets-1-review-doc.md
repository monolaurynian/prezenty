# Home bucket card and frame consistency (CSS only)

The Available-only list rule in `home-page.css` now covers all three home bucket lists, so Reservations and Bought get the same flex/12px gap/14px padding (10px 6px at <=480px) that Available already had. The three home accordions also override Bootstrap's accordion radius variables with a nested-radius formula, so the frame corners follow the 20px card radius. Cache busting is `home-page.css?v=2` in `home.html` and `sw.js`, plus `CACHE_NAME` v128 to v129. I booted the demo server independently and re-ran the coder's computed-style measurement script (label `review`), then ran my own assertions against the output. All blocking checks pass.

Watch for: the frame is now 35px (27px at <=480px), a large visual jump from 6px that was verified numerically only, not by eye (possible, subjective). The verification doc is committed under `.agents/` in the same commit (confirmed, minor).

**Verdict**: APPROVED

## High-level view

The inconsistency was purely in the list container. Both renderers emit identical card markup and inline styles, so extending the container rule to the other two IDs is the whole fix, with no JS or HTML structure change.

The frame radius is derived from the card radius through local custom properties scoped to `#accordionAvailable`, `#accordionReservations` and `#accordionBought`. Bootstrap's own `--bs-accordion-border-radius` and `--bs-accordion-inner-border-radius` consume them, so the coloured header button and collapse panel follow without touching `.accordion-button`.

Scope is clean. Only three files under `public/` changed (plus the verification doc), the frozen `styles.deduped.min.css` is untouched, and other pages are unaffected.

<details>
<summary>Issues (2)</summary>

1. **Visual check of 35px frame** (possible) — radius and nesting are numerically correct, but nobody has looked at it. A collapsed header at >=768px renders as a pill (frame height 54px, radius capped at 27px). Eyeball it in a real browser and, if too round, lower `--home-bucket-inset`.
2. **Task doc committed with the code** (confirmed, non-blocking) — `.agents/tasks/.../home-buckets-1-verification.md` is in the commit. Drop it from the CR or confirm that is intended.

</details>

<details>
<summary>Details</summary>

## Independent re-measurement

Same harness as the coder (demo server via `tests/helpers/start-demo-server.js`, Edge via Playwright, state set through the API: reserve 1, 3, 6, 7 and mark 6 bought, giving 3/3/3 cards). I wrote a separate assertion script over the fresh `review.json` rather than reusing `tmp-compare.js`. The data was compared with the pre-edit `before.json`.

Results, at 320x640, 375x812, 768x1024 and 1024x768:

- Available list, all cards, all rows and all offsets are identical to `before.json` (computed style excluding w/h). Diff = 0.
- Card padding is 14px 12px at <=480 and 20px at >=768, and card radius is 20px, in all three buckets. Row padding is identical in all three.
- The list container is identical across buckets (flex column, gap 12px, padding 10px 6px or 14px). Between-card distance is 32px in all three. The first-card, last-card and right insets match Available.
- Reservations and Bought card styles are unchanged versus before. Only their position moved.
- Frame radius: `.accordion-item` is 27px at 320/375 and 35px at 768/1024, which equals R(20) + inset + 1px border, for all four corners and all buckets. I also checked it against the measured card gap (card left offset minus the 1px border). The header button is 26/34px (R + inset), and the collapse panel bottom radius is 27/35px. The container radius equals the card radius plus the gap between them, as the nesting rule requires.
- Horizontal overflow: `scrollWidth == innerWidth` at all four widths. With injected long titles and names there is no overflow, no row has inner overflow, and the card's right edge stays inside the frame.
- Focus: the first action button of each bucket was focused (focus-visible true), and no clipping ancestor cuts the ring. The only clipper is the pre-existing `.container` (overflow hidden/auto).

Other pages (recipients, activity, rezerwacje, leaderboard, formularz, wiadomosci) at 375 and 1024: padding, margin, gap, radius, border, shadow and size are equal to before on all elements. The only deltas are four animated `progress-bar` glow `box-shadow` values on recipients. They differ between the coder's `after.json` and `before.json` too, so they are animation phase and not the diff. No page other than `home.html` loads `home-page.css` (grep over `public/`, `tests/`, `lib/`), and every selector is an ID scoped to the home accordions.

## Scope and cache busting

The diff against main touches `public/home-page.css`, `public/home.html` (only `home-page.css?v=1` to `?v=2`), `public/sw.js` (precache entry `?v=2` and `CACHE_NAME` `prezenty-v128` to `prezenty-v129`, exactly main + 1) and the verification doc. `public/styles.deduped.min.css` is not in the diff and `public/home-page.js` is untouched, as the plan intended. `node --check public/sw.js` exits 0. No other file references `home-page.css?v=1`.

## Test suite note

I did not re-run `npm test`. The coder's one failure (`no-horizontal-overflow.spec.js:22`, `net::ERR_ABORTED` on the one-shot reload navigation) is a navigation abort, passed 3 of 3 on isolated reruns, and my own overflow measurements at all widths pass. I accept the explanation: it is unrelated to the CSS (likely, not traced to a root cause).

## Not verified

No screenshots or pixel comparison. The service worker was not exercised, since tests and measurement block it.

</details>

<details>
<summary>File map</summary>

- `public/home-page.css` — shared bucket list rule, scoped accordion radius custom properties, <=480px inset override
- `public/home.html` — `home-page.css?v=1` to `?v=2`
- `public/sw.js` — precache `?v=2`, `CACHE_NAME` v128 to v129
- `.agents/tasks/prezenty-fix-home-buckets-1-2025-06-13/home-buckets-1-verification.md` — coder's verification report

Full diff: `git -P diff main...HEAD` in the worktree (commit e20c501).

</details>
