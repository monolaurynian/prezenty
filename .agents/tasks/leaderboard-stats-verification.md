# Leaderboard stats (kupione / zarezerwowane) - verification

## What changed

Only `public/leaderboard.html`. Nothing else, so no `?v=` cache-buster needed bumping
(`styles.css`, `bottom-tab-bar.css?v=41`, `app-theme.css?v=14`, `tab-bar-functions.js?v=16`,
`desktop-nav.js?v=5` and `pluralize-pl.js` are untouched). Note: `sw.js` precaches pages, so the
service-worker cache version bump that another change owns will also pick this page up.

The rows are rendered by inline JS in the page: `renderActivityLeaderboard()` (section
`#activityLeaderboard`, "Pełna lista aktywności"). The old markup was one inline text line with
`•` between the stats, built from inline styles. It is now a small grid with page-scoped classes,
added at the end of the page's own second `<style>` block (after the existing `max-width: 768px`
media query so it wins without `!important`).

New selectors, all page-scoped and new (checked: no collisions in `styles.css`,
`bottom-tab-bar.css`, `app-theme.css` or elsewhere in the page):

`.activity-card`, `.activity-rank`, `.activity-avatar-img`, `.activity-avatar-emoji`,
`.activity-name`, `.activity-stats`, `.activity-stat`, `.activity-stat i`, `.activity-stat-noun`,
`.activity-stat-sep`, `.activity-score`, `.activity-score-value`, `.activity-score-label`.

The card keeps `class="user-card activity-card"`, so the existing `.user-card:hover` treatment and
the `max-width: 768px` padding still apply.

## Layout choice

- **Stacked by default** (every width below 768px): one stat per line, icons in a fixed 14px column
  so the labels line up, `gap: 3px`, `line-height: 1.3`. The `•` separator is `display: none` here.
- **Inline row from `min-width: 768px`**, with the bullet back, which is exactly how the page looked
  before. At 768px the stats column is ~440px wide and the longest row measures 271px, so it has
  plenty of room; keeping it inline also keeps desktop entries at their old 84px height instead of
  growing them for no reason. `flex-wrap: wrap` is set there, so if it ever did run out of room it
  would break *between* the two stats, never inside one.
- **Below 360px** the name and the activity score cannot share a row without the name breaking
  mid-word ("Włodzimi / erz"), so there the score drops to its own line under the stats
  (`grid-template-areas` with a third `score` row). From 360px up the name and score share row 1 and
  the stats span the full width underneath.

Each stat is `display: inline-flex` + `white-space: nowrap`, so a count can never be separated from
its adjective - that is what produced the orphaned "zarezerwowany" on a third line.

## Polish strings produced (plCount / plPlural from pluralize-pl.js)

Visible text, then in brackets the extra screen-reader-only noun (`.activity-stat-noun`, clipped,
costs no layout width) that makes the phrase self-contained:

| count | bought | reserved |
|---|---|---|
| 0 | 0 kupionych [prezentów] | 0 zarezerwowanych [prezentów] |
| 1 | 1 kupiony [prezent] | 1 zarezerwowany [prezent] |
| 2 | 2 kupione [prezenty] | 2 zarezerwowane [prezenty] |
| 5 | 5 kupionych [prezentów] | 5 zarezerwowanych [prezentów] |
| 12 | 12 kupionych [prezentów] | 12 zarezerwowanych [prezentów] |
| 22 | 22 kupione [prezenty] | 22 zarezerwowane [prezenty] |
| 112 | 112 kupionych [prezentów] | 112 zarezerwowanych [prezentów] |

The adjective comes from the existing `plCount(n, 'kupiony', 'kupione', 'kupionych')` /
`plCount(n, 'zarezerwowany', 'zarezerwowane', 'zarezerwowanych')` calls (unchanged), and the hidden
noun from `plPlural(n, 'prezent', 'prezenty', 'prezentów')`, so number, adjective and noun all agree.
The noun stays hidden because "112 zarezerwowanych prezentów" needs ~190px and does not fit the
~146px available at 320px. All wording is gender-neutral and in sentence case.

A user with 0 bought *and* 0 reserved is skipped by `renderActivityLeaderboard` (pre-existing
behaviour), so the `0` forms were exercised via mixed rows (0 bought / 12 reserved, 112 / 0, 0 / 1).

## Harness

Built in `%TEMP%\prezenty-lb` (outside the repo, deleted afterwards):

- A tiny read-only Node static server over the real `public/` directory, so the page loads its real
  `styles.css`, `bottom-tab-bar.css?v=41`, `app-theme.css?v=14`, CDN Bootstrap / Font Awesome /
  Remix Icon, `pluralize-pl.js` and the page's own inline styles.
- `playwright-core@1.47.2` (installed only in the temp dir) driving the local Edge with true
  viewports at 320 / 359 / 360 / 375 / 600 / 767 / 768 / 1024, deviceScaleFactor 2.
- `/api/leaderboard` is stubbed with 10 users covering 0, 1, 2, 5, 12, 22 and 112 for both stats plus
  "Bardzo Długie Imię I Nazwisko Testowe Użytkownika". The page's own render code produces the
  markup, so what is measured is the real output.
- The tab bar's notifications panel is hidden before capture (it floats over the page in the harness).

## Measurements (`getBoundingClientRect`)

No `.activity-stat` is ever more than one line: `height` equals one `line-height` (16.9px) and
`getClientRects().length === 1` for every stat at every width, including 112/112. Stat widths at
320px (card 254px wide, no horizontal page overflow at any width):

```
112 kupionych        103.8 x 16.9  lines=1
112 zarezerwowanych  145.6 x 16.9  lines=1   <- widest case
12 zarezerwowanych   138.6 x 16.9  lines=1
0 zarezerwowanych    131.6 x 16.9  lines=1
22 zarezerwowane     125.8 x 16.9  lines=1
1 zarezerwowany      118.3 x 16.9  lines=1
1 kupiony             76.5 x 16.9  lines=1
```

Entry heights, first card (the 4-line long name) / stats block:

| width | before | after |
|---|---|---|
| 320 | 212.5px card, 58.5px stats block (3 lines) | 198.4px card, 36.8px stats block (2 lines) |
| 375 | 212.5px card, 58.5px stats block | 158.0px card, 36.8px stats block |
| 768 | 88.0px card, 19.5px stats | 84.0px card, 16.9px stats (inline) |
| 1024 | 88.0px card, 19.5px stats | 84.0px card, 16.9px stats (inline) |

Typical (short-name) entries measure ~100px at 320-375px. The old layout also pushed the activity
score outside the card at 320px (visible in the before shot); the grid with `minmax(0, 1fr)` fixes
that as a side effect.

## Accessibility

Computed in-page against the card background (white):

- stat text `#5a6677` at 13px -> **5.83:1** (AA for small text; the old `#718096` was 4.02:1, below AA)
- `aktywność` label `#5a6677` at 12px -> **5.83:1** (also raised from `#718096`)
- rank `#718096` at 20px/700 -> 4.02:1 (large text, needs 3:1)
- score value `#667eea` at 24px/700 -> 3.66:1 (large text, needs 3:1)

Both stat icons and the `•` separator carry `aria-hidden="true"`, the emoji avatar too, and the
hidden noun makes each stat read as a full phrase, e.g. "1 zarezerwowany prezent". Icon colours are
unchanged (`#4CAF50` check-circle, `#FF9800` bookmark).

## Screenshots (`.agents/tasks/screenshots/`)

`leaderboard-stats-320.png`, `leaderboard-stats-375.png`, `leaderboard-stats-768.png`,
`leaderboard-stats-1024.png`. Reviewed: stats stacked and intact at 320/375 with the icons in a
column, names wrapping only at spaces, and the familiar inline row with the bullet at 768/1024.
Intermediate widths (359, 360, 600, 767) were checked during iteration and were clean too.

## Not changed

`renderUsersList`, both podiums, the rest of the page, and every file another change owns
(`wiadomosci.html`, `notification-text.js`, `sw.js`, `chat-reactions.css`, `server.js`, `init-db.js`,
`app-theme.css` and the other shared stylesheets). Nothing was committed.
