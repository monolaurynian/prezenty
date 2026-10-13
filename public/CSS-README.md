# CSS in this project

No build step runs at deploy time (`Dockerfile`, `render.yaml` and `vercel.json` never build CSS), so every
stylesheet that is served must be committed. Files are one of three kinds:

- **Source**: written and edited by hand.
- **Generated**: produced by a tool from sources, never edited by hand.
- **Frozen artifact**: committed output whose generator can no longer reproduce it.

## Files

| File | Kind | Loaded by (after the CDN sheets, in this order) |
|---|---|---|
| `styles.deduped.min.css` | **Frozen artifact** (see below) | activity, archiwum, formularz, home, index, leaderboard, osoby, recipients, register, rezerwacje, ustawienia, wiadomosci. Always the first local sheet. |
| `styles.css` | Source, but now only the input of `scripts/build-css.js`. No page links it. | none |
| `aws-design.css` | Source | activity (`aws-design.css`), recipients (`aws-design.css?v=4`) |
| `bottom-tab-bar.css?v=42` | Source | activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci |
| `app-theme.css?v=14` | Source | every page above except index and register |
| `filters.css?v=7` | Source | recipients |
| `chat-reactions.css?v=3` | Source | wiadomosci |
| `<page>-page.css?v=1`, `formularz-page-edit.css?v=1` | Source (extracted from inline `<style>`) | their own page, always last |
| `intro-page.css?v=1` | Source | intro (the only sheet on that page) |

`maintenance.html` has no stylesheet, only an inline `<style>`. Link order on every page matters for the
cascade: do not reorder `<link>` tags.

## styles.deduped.min.css is a frozen artifact

It was made once from `styles.css` with PurgeCSS and cssnano (commit `af170e2`), then edited by hand in
later commits (`8d441c7`, `026f853`, `072bc5d`). A fresh build no longer matches it:

- 326 rules identical, 14 with different declarations, 59 only in the committed file, 40 only in the rebuild
  (`npm run build:css:check` prints the current numbers and the first 20 selectors of each group).
- Examples of changed declarations: `.alert-success` colour, `.btn-success:hover` backgrounds, `.badge` and
  `.present-item` (`max-width`, `overflow`), `.login-header`/`.login-body`, the `slideDown` keyframe.
- Putting the rebuild into `public/` was tried and changes 1,129 computed-style cells (per element, per
  property, at four viewports) on archiwum, formularz, home, osoby, recipients, ustawienia and wiadomosci.
  So the committed file, not `styles.css`, is the de facto source of what those pages look like.

Deciding which version is "right" is a product decision, not a refactor. Until it is made:

- Never hand-edit `styles.deduped.min.css`. It may change only through `scripts/build-css.js --force`, and
  only after a before/after computed-style comparison shows zero differences.
- Change styles in the page, theme or component sheets above, which load after it and win the cascade.

## Building

```
npm run build:css         # builds into build/css/styles.deduped.min.css (git-ignored), never into public/
npm run build:css:check   # prints how a fresh build differs from the committed file; exit code 0
node scripts/build-css.js --check     # same, but exit 1 when they differ
node scripts/build-css.js --force     # overwrite public/styles.deduped.min.css (see rule above)
```

- Command: `postcss` API with the plugins from `postcss.config.js`: PurgeCSS 4 (content globs `public/**/*.html`,
  `public/**/*.js`, `public/**/*-page*.css`, `routes/**`, `lib/**`, `server.js`), then cssnano `default`.
- The safelist in `postcss.config.js` keeps class and id names assembled at runtime (`'alert-' + type`) and the
  classes Bootstrap's own JS toggles (`show`, `fade`, `collapsing` ...). Each pattern names the file and line
  that needs it; revisit them when that JS changes.
- Line endings: the working tree is CRLF on Windows (`core.autocrlf`), git stores LF. The script converts input
  to LF and writes LF so output is the same on every machine.
- Output is deterministic (two runs give the same SHA-256) for the locked versions in `package-lock.json` of
  `postcss`, `purgecss`, `cssnano`, `browserslist` and `caniuse-lite`. Run `npm ci` first.

## Why leaderboard.html uses the deduped file

It used to load the raw 437 KB `styles.css` (history does not record why). Its stylesheet link now points to
`styles.deduped.min.css`: the computed styles of every element and pseudo-element on the page (about 650
elements, 90 properties plus layout rectangles) were identical at 320x640, 375x812, 768x1024 and 1024x768 in 11
states (loaded, scrolled to the bottom, sidebar open, tab-bar menu open, notifications open, three hover
states, empty, error and loading), and the smoke, wrapping, no-horizontal-overflow and a11y specs passed.
`styles.css` therefore has no page consumer left; it only feeds the build.

## Cache busting and the service worker

`server.js` sends `Cache-Control: no-cache, must-revalidate` for CSS and JS, so the `?v=` numbers only matter
for the service worker, which is cache-first for non-HTML requests keyed by the full URL.

- When the bytes of a linked stylesheet change, bump its `?v=` in every page that links it.
- Bump `CACHE_NAME` in `public/sw.js` once per change set and keep `urlsToCache` consistent with the URLs the
  pages request. Known gaps, not fixed: `aws-design.css?v=4` (recipients) vs the precached `/aws-design.css`,
  `chat-reactions.css?v=3` vs `/chat-reactions.css`; `bottom-tab-bar.css`, `app-theme.css` and `filters.css`
  are not precached.

## Removing dead rules

A rule may be removed from a hand-written sheet only if every class and id in every selector of the rule is
absent from all HTML, JS, server, test and CDN-library files and matches no runtime-built prefix or suffix.
A rule that is an exact duplicate of a later one in the same file and context may be removed (the earlier
copy goes, the last one stays). When in doubt, keep the rule.
