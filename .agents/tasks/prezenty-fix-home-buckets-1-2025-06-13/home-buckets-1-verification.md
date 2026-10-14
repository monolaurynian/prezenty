# Verification: home buckets consistency (home-buckets-1)

Branch `fix/home-buckets-1`. Everything below is browser-measured (Edge via Playwright, computed style + `getBoundingClientRect`, no screenshots).

## Setup notes

- The worktree was 19 commits behind `main` (CACHE_NAME `prezenty-v127`; main is `v128`). `setup-notes.md` did not exist, so I read main's `public/sw.js` directly (`v128`) and fast-forwarded the branch to main (`git merge --ff-only main`, no local commits were lost). `public/home-page.css` is identical on main and the old base, so the plan still applied as written. CACHE_NAME is now `prezenty-v129` (main + 1).
- Demo server booted through `tests/helpers/start-demo-server.js` (free port, `OFFLINE_MODE`/demo, `NODE_ENV=development`). Login via `POST /api/login`.
- Demo data has no reserved-not-bought presents, so state was set through the API before loading the page: reserved presents 1, 3, 6, 7 (`POST /api/presents/:id/reserve`), then marked 6 bought (`PUT /api/presents/6/check`). Result: Available 3 cards, Reservations 3 cards, Bought 3 cards (ids 2, 9 from demo data plus 6). I did not use the UI reserve action (known move bug), the page was freshly loaded after the API calls.
- All three accordions are expanded by default (`collapse show`); I forced `show` as well.
- Viewports: 320x640, 375x812, 768x1024, 1024x768. Data: `home-buckets-baseline/before.json` (taken BEFORE any CSS edit) and `after.json`. Comparison output: `home-buckets-baseline/compare-result.txt` (97 lines, 0 FAIL).
- Measurement scripts kept next to this file: `tmp-measure.js`, `tmp-summary.js`, `tmp-compare.js`, `tmp-collapsed.js`.

## Change

`public/home-page.css`: the Available-only list rule is now shared by all three lists (`display:flex; flex-direction:column; gap:12px; padding:14px`, `10px 6px` at <=480px). Bootstrap accordion radius variables are overridden on the three home accordions with a nesting formula (card radius + inset + border). `public/home.html` `home-page.css?v=1` -> `?v=2`; `public/sw.js` precache entry `?v=2` and `CACHE_NAME` v128 -> v129. No HTML structure, JS, or `styles.deduped.min.css` change.

## Measured before / after

Card (`.home-recipient-card`) and row (`.home-present-row`) values are the same in all buckets before and after. Only the list container and the frame changed.

| Property | Viewport | Available before | Available after | Reservations before | Reservations after | Bought before | Bought after |
|---|---|---|---|---|---|---|---|
| List display / gap | all | flex / 12px | flex / 12px (same) | block / normal | flex / 12px | block / normal | flex / 12px |
| List padding | 320, 375 | 10px 6px | 10px 6px (same) | 0 | 10px 6px | 0 | 10px 6px |
| List padding | 768, 1024 | 14px | 14px (same) | 0 | 14px | 0 | 14px |
| Card padding | 320, 375 | 14px 12px | 14px 12px (same) | 14px 12px | 14px 12px | 14px 12px | 14px 12px |
| Card padding | 768, 1024 | 20px | 20px (same) | 20px | 20px | 20px | 20px |
| Card radius | all | 20px | 20px | 20px | 20px | 20px | 20px |
| Row padding / radius | <=480 | 10px / 10px | same | 10px / 10px | same | 10px / 10px | same |
| Row padding / radius | >=768 | 12px / 10px | same | 12px / 10px | same | 12px / 10px | same |
| Card left inset from frame edge | 320, 375 | 7px | 7px (same) | 1px | 7px | 1px | 7px |
| Card left inset from frame edge | 768, 1024 | 15px | 15px (same) | 1px | 15px | 1px | 15px |
| First card top from collapse edge | <=480 / >=768 | 10 / 14 | 10 / 14 (same) | 0 | 10 / 14 | 0 | 10 / 14 |
| Gap between sibling cards | all | 32px | 32px (same) | 20px | 32px | 20px | 32px |
| Last card bottom to frame bottom | <=480 / >=768 | 31 / 35 | 31 / 35 (same) | 21 | 31 / 35 | 21 | 31 / 35 |
| Frame (`.accordion-item`) radius | 320, 375 | 6px | 27px | 6px | 27px | 6px | 27px |
| Frame (`.accordion-item`) radius | 768, 1024 | 6px | 35px | 6px | 35px | 6px | 35px |
| Header button top radius | 320, 375 / 768, 1024 | 5px | 26px / 34px | 5px | 26px / 34px | 5px | 26px / 34px |
| Collapse panel bottom radius | 320, 375 / 768, 1024 | 6px | 27px / 35px | 6px | 27px / 35px | 6px | 27px / 35px |

("1px" before = the 1px frame border only; the card touched the frame.)

Nesting rule check (computed): outer frame radius = card R (20) + inset + border (1). Inset 14 gives 35 (header 34); inset 6 gives 27 (header 26). Asserted equal for all three buckets at all four viewports. Frame radius now follows the card radius (concentric curves).

Collapsed state (clicked each header at 375 and 1024): header 26px / 34px, frame 27px / 35px, frame height 54px. The browser caps radii at half the height (27px), so a collapsed bar at 1024 renders as a pill. Expected, called out in the plan.

## Assertions

| # | Assertion | Result |
|---|---|---|
| 1 | Available cards and rows computed-style diff = 0 vs before (all 4 viewports); Available list display/gap/padding unchanged; Available offsets unchanged | PASS |
| 2 | Card padding, card radius, row padding, list padding/gap/display, card offsets and gaps identical across the three buckets at all 4 viewports; Reservations and Bought card computed styles unchanged vs before (only position moved) | PASS |
| 3 | Frame radius satisfies the nesting rule and is derived from the 20px card radius (27 / 35, header 26 / 34) for all buckets at all viewports | PASS |
| 4 | Clipping ancestors of cards unchanged (only the pre-existing `.container` overflow hidden/auto); list/item/collapse/body/section are `overflow: visible`, so shadows are not cut more than before | PASS |
| 5 | No horizontal overflow at 320/375/768/1024, populated (`scrollWidth == innerWidth`) and after injecting very long titles (a 256-char unbroken word and 12 repeated phrases), comments and 130-char recipient names; no row has inner overflow; cards stay inside the frame | PASS |
| 6 | Other pages (recipients, activity, rezerwacje, leaderboard, formularz, wiadomosci) at 375 and 1024: every element's padding/margin/gap/radius/border/shadow/size equal before vs after (770, 332, 215, 552, 425, 190 elements). Normalised: animated spinner/progress glow/skeleton and random accordion ids | PASS |
| 7 | Keyboard focus (Tab then `.focus()`, `:focus-visible` true) on the first action button of each bucket: no clipping ancestor cuts the ring at any viewport | PASS |
| - | Empty state: markup unchanged, list padding identical across buckets (10px 6px / 14px); empty box size unchanged | PASS |
| - | Skeleton state: Available identical to before; Reservations and Bought now identical to Available (list padding 14px + skeleton 14px, card left offset 28px at >=768, 20px at <=480; previously 14px) | PASS |

Pre-existing, unchanged: Available's action button shows no visible focus indicator (`outline: none`, no box-shadow) while the other two buckets show a shadow. That predates this change and is covered by the existing a11y `fixme`s; I did not touch it.

## Test suite

`npm test` (full Playwright suite, baseline 121 passed / 0 failed / 11 skipped):

- Result: 120 passed, 1 failed, 11 skipped.
- The one failure: `no-horizontal-overflow.spec.js:22 home does not scroll sideways at any width`, `page.goto: net::ERR_ABORTED at /` thrown inside `openPage` during the second `goto` (the one-shot cache-busting reload in `home.html` racing the navigation). It is a navigation abort, not an assertion on layout.
- Re-run alone 3 times: 3 passed (13.9s, 12.4s, 14.3s). So the suite is 121 passed effectively; the failure is a pre-existing race, not caused by the CSS.

## Not verified

- No pixel/screenshot comparison (headless Edge screenshots are unreliable here), so the look of the 35px frame corner was verified numerically, not visually.
- `node --check public/sw.js` passes; I did not exercise the service worker (tests run with `serviceWorkers: 'block'`).
