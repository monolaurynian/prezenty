# CSS audit (Phase A, no CSS changed)

Branch `refactor/css-consolidate-1`, measured at base commit `e939a28` on 2026-10-13. Everything below was produced by parsing the working tree, rebuilding to a temp dir, or driving Edge; nothing under `public/` was touched. Temporary tooling lives untracked in `.agents/tasks/tmp-css-*.js`; raw evidence (coverage.json, transfer-before.json, snapshots, logs) lives in `$env:TEMP\css-consolidate-1` and is summarised here.

## 0. Findings that change the plan

- **`styles.deduped.min.css` is frozen, not generated.** No npm script builds it; the only tooling is `postcss.config.js` plus the implied `npx postcss public/styles.css -o <out>`. A rebuild (deterministic, 35,231 B) differs from the committed 40,111 B file: 314 identical rules, 13 with different declarations, 72 only in the committed file, 30 only in the rebuild. Git shows `8d441c7` and `026f853` (2025-07-08) changed only the minified file, and `072bc5d` removed a rule from it by hand, so **Phase B should expect the "frozen" fallback (plan B.6)**; the snapshot proof still decides.
- **Source defect shared by `styles.css` and the generated file:** `styles.css` lines 5643-5648 open a `.profile-picture-placeholder` rule that is cut off after `display: flex !important;` and never closed; the copy-pasted `:root { ... }` block that follows (5650-5679, closed by `}}`) therefore becomes a rule NESTED inside it. In Edge 154/155 (CSS nesting) it compiles to `.profile-picture-placeholder :root` and never matches, so that second `:root` (including the `--ios-success` value that differs between committed `#00693E` and rebuild `#34c759`) has no effect; the first `:root` at line 2 is the one that applies. Measured in Edge (Edg/155.0.0.0): effective `--ios-success` on documentElement is `#34c759` on recipients (deduped file) and `#34c759` on leaderboard (raw file); CSS nesting is supported (`CSS.supports('selector(&)')` = true). The committed minified file and the rebuild both carry the same nesting. Not fixed here (out of scope); Phase C tooling must keep treating nested rules as children (`rule.parent.type === 'rule'`) and must not "clean" that block without a snapshot proof.
- **`styles.css` is mostly duplicate text.** 2,312 rules (keyframe steps excluded), of which 1,770 are exact repeats of an earlier rule with the same context, selector and declarations (300,509 B of 419,525 B LF). Real Edge coverage on leaderboard (the only raw consumer) used 5,872 B of 437,177 B.
- **Wire size is not the win.** The server compresses with brotli: leaderboard's raw `styles.css` is 437,177 B decoded but only 14,333 B transferred (26,519 B at gzip -6). Total local CSS: recipients 237,999 B decoded / 43,940 B transferred, leaderboard 501,598 B / 28,649 B. The saving from Phases B/C is mostly parse/memory size and maintainability, plus gzip-only hosts.
- **Coverage summary (union of all runs, both viewports):** styles.deduped.min.css 20,905/40,148 B used (52.1%); aws-design.css 25,600/114,692 B used (22.3%); bottom-tab-bar.css 17,022/26,165 B used (65.1%); app-theme.css 9,207/14,403 B used (63.9%); filters.css 3,664/13,023 B used (28.1%); chat-reactions.css 6,796/12,051 B used (56.4%). `aws-design.css` is 77.7% unexercised (only activity and recipients load it) and is the biggest hand-written candidate once Phase C's static criterion is applied. Coverage is a report only (limitation in section 7).
- **`main` moved.** `main` is now at `4f94a3c` and its `public/sw.js` reads `const CACHE_NAME = 'prezenty-v127';`, while this worktree still has `prezenty-v125`. The final service-worker bump must be `max(127, main + 1, sibling + 1)` = at least `prezenty-v128` unless main changes again; re-check right before the bump.
- **Harness is deterministic:** `snap-A0` (captured today) vs the committed `css-baseline`: 56 files, 0 diffs, activity included (no clock re-baseline needed). Negative self-test of `tmp-css-compare.js` (one edited cell) exits 1 and prints the exact cell.

## 1. Environment and harness sanity

- Worktree `.worktrees/css-consolidate-1`, branch `refactor/css-consolidate-1`, HEAD `e939a28` (base `bc8be84`), `git status` clean at start; Windows + PowerShell; Node v24.11.0; Playwright 1.61.0 (`channel: msedge`, workers 1); installed Edge channels: 154.0.4258.62, 155.0.4283.45; `tests/.cache/cdn` present (20 files, git-ignored).
- CSS tooling (from `node_modules`): postcss 8.5.6, postcss-cli 11.0.1, @fullhuman/postcss-purgecss 4.1.3 (purgecss 4.1.3), cssnano 7.0.7 (cssnano-preset-default 7.0.7), browserslist 4.25.1, caniuse-lite 1.0.30001727 (postcss prints "browsers data is 16 months old" on every build).
- Snapshot harness: `tmp-css-snapshot.js` 4 viewports x 14 pages = 56 files; `snap-A0` vs `css-baseline`: 56 files, 0 differing cells; negative self-test (ustawienia@375x812 element 5 `color` edited) exits 1.
- Compare tool: `node .agents/tasks/tmp-css-compare.js <dirA> <dirB> [--allow overflow-container]`; exit 0 only with zero diffs; prints per-page counts and the first 40 differing cells. Coverage tool: `node .agents/tasks/tmp-css-coverage.js <out.json>` (env `COV_ONLY=page,page` limits pages; about 12 minutes for everything). Transfer tool: `node .agents/tasks/tmp-css-transfer.js <out.json>`.

## 2. Stylesheets per page, in load order (A.2)

Parsed from `public/*.html` (`<link rel=stylesheet>` and `<style>` in document order). In-scope pages: 14. `bottom-tab-bar-snippet.html` and `tab-bar-demo.html` are excluded (their class tokens still count as usage in Phase C). Bytes are working-tree bytes (CRLF). CDN sheets are not measured. Sheets injected by JS are listed after the table.

| Page | # | Kind | href / note | ?v | bytes |
|---|---|---|---|---|---|
| activity | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `aws-design.css` | (none) | 114,692 |
|  | 6 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 7 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 8 | inline | inline `<style>` (html line 37) |  | 388 |
|  | 9 | local | `activity-page.css?v=1` | ?v=1 | 8,265 |
| archiwum | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 4 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 5 | local | `archiwum-page.css?v=1` | ?v=1 | 2,741 |
| formularz | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 6 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 7 | inline | inline `<style>` (html line 20) |  | 390 |
|  | 8 | local | `formularz-page.css?v=1` | ?v=1 | 13,852 |
|  | 9 | local | `formularz-page-edit.css?v=1` | ?v=1 | 30,720 |
| home | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 6 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 7 | local | `home-page.css?v=1` | ?v=1 | 5,435 |
| index | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | local | `styles.deduped.min.css` | (none) | 40,148 |
| intro | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css` |  |  |
|  | 3 | local | `intro-page.css?v=1` | ?v=1 | 8,851 |
| leaderboard | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.css` | (none) | 437,177 |
|  | 5 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 6 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 7 | inline | inline `<style>` (html line 14) |  | 390 |
|  | 8 | local | `leaderboard-page.css?v=1` | ?v=1 | 23,853 |
| maintenance | 1 | inline | inline `<style>` (html line 9) |  | 1,735 |
| osoby | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 4 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 5 | local | `osoby-page.css?v=1` | ?v=1 | 1,741 |
| recipients | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `aws-design.css?v=4` | ?v=4 | 114,692 |
|  | 6 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 7 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 8 | local | `filters.css?v=7` | ?v=7 | 13,023 |
|  | 9 | inline | inline `<style>` (html line 40) |  | 388 |
|  | 10 | local | `recipients-page.css?v=1` | ?v=1 | 29,568 |
| register | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | local | `styles.deduped.min.css` | (none) | 40,148 |
| rezerwacje | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 6 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 7 | local | `rezerwacje-page.css?v=1` | ?v=1 | 2,425 |
| ustawienia | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 6 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 7 | local | `ustawienia-page.css?v=1` | ?v=1 | 1,854 |
| wiadomosci | 1 | cdn | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |  |  |
|  | 2 | cdn | `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css` |  |  |
|  | 3 | cdn | `https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css` |  |  |
|  | 4 | local | `styles.deduped.min.css` | (none) | 40,148 |
|  | 5 | local | `bottom-tab-bar.css?v=42` | ?v=42 | 26,165 |
|  | 6 | local | `app-theme.css?v=14` | ?v=14 | 14,403 |
|  | 7 | local | `chat-reactions.css?v=3` | ?v=3 | 12,051 |
|  | 8 | local | `wiadomosci-page.css?v=1` | ?v=1 | 6,299 |

Cross-check against the exploration notes: identical for all 14 pages (counts, order, `?v=` values). Notes:

- `intro` loads only `intro-page.css`; `maintenance` has one inline `<style>` (1,735 B) and no link; `index` and `register` load only `styles.deduped.min.css`.
- `aws-design.css` is requested as `aws-design.css?v=4` by recipients and as `aws-design.css` (no query) by activity. Both are different cache keys for the service worker (section 6).
- Font Awesome is 6.0.0 on most pages and 6.4.0 on home, intro and leaderboard. Remixicon is linked on 8 pages and injected at runtime by `desktop-nav.js:10-13` when absent.
- JS-created style/link elements (outside the table): `public/desktop-nav.js:10-13` (remixicon CDN link), `public/update-checker.js:98` (a `<style>` holding `@keyframes slideDown` for the update banner), `public/fast-loader.js:263` only creates `rel=prefetch` links for API endpoints (not a stylesheet).

## 3. Per-stylesheet table (A.3)

Rules are counted with postcss `walkRules` on LF-normalised text (keyframe steps included, so these counts are slightly higher than the keyframe-excluding counts in section 7). "Blob" is `git cat-file -s HEAD:public/<file>` (LF); the working tree is CRLF (`core.autocrlf=true`, no `.gitattributes`), hence the ~1 byte per line difference.

| File | Working B | Blob B | Lines | Rules | Declarations | Class | Generator | Loaded by (reverse index) |
|---|---|---|---|---|---|---|---|---|
| `activity-page.css` | 8,265 | 7,999 | 267 | 37 | 122 | hand-written | none | activity |
| `app-theme.css` | 14,403 | 13,900 | 503 | 61 | 220 | hand-written | none | activity, archiwum, formularz, home, leaderboard, osoby, recipients, rezerwacje, ustawienia, wiadomosci |
| `archiwum-page.css` | 2,741 | 2,667 | 75 | 13 | 55 | hand-written | none | archiwum |
| `aws-design.css` | 114,692 | 110,013 | 4,679 | 692 | 2,300 | hand-written | none | activity, recipients |
| `bottom-tab-bar.css` | 26,165 | 25,257 | 908 | 112 | 450 | hand-written | none | activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci |
| `chat-reactions.css` | 12,051 | 11,633 | 418 | 46 | 192 | hand-written | none | wiadomosci |
| `filters.css` | 13,023 | 12,393 | 630 | 96 | 274 | hand-written | none | recipients |
| `formularz-page-edit.css` | 30,720 | 30,022 | 699 | 72 | 298 | hand-written | none | formularz |
| `formularz-page.css` | 13,852 | 13,411 | 442 | 63 | 240 | hand-written | none | formularz |
| `home-page.css` | 5,435 | 5,272 | 164 | 24 | 76 | hand-written | none | home |
| `intro-page.css` | 8,851 | 8,506 | 346 | 53 | 183 | hand-written | none | intro |
| `leaderboard-page.css` | 23,853 | 22,967 | 887 | 132 | 432 | hand-written | none | leaderboard |
| `osoby-page.css` | 1,741 | 1,695 | 47 | 9 | 39 | hand-written | none | osoby |
| `recipients-page.css` | 29,568 | 28,784 | 785 | 107 | 367 | hand-written | none | recipients |
| `rezerwacje-page.css` | 2,425 | 2,366 | 60 | 18 | 53 | hand-written | none | rezerwacje |
| `styles.css` | 437,177 | 419,537 | 17,640 | 2,365 | 9,863 | hand-written (generator INPUT) | none | leaderboard |
| `styles.deduped.min.css` | 40,148 | 40,111 | 38 | 399 | 1,252 | FROZEN artifact (derived, not reproducible) | postcss.config.js: PurgeCSS 4 + cssnano 7 over styles.css | activity, archiwum, formularz, home, index, osoby, recipients, register, rezerwacje, ustawienia, wiadomosci |
| `ustawienia-page.css` | 1,854 | 1,810 | 45 | 11 | 44 | hand-written | none | ustawienia |
| `wiadomosci-page.css` | 6,299 | 6,148 | 152 | 32 | 126 | hand-written | none | wiadomosci |

Total local CSS in `public/`: 793,263 B across 19 files. `styles.css` is 55.1% of it and is loaded by exactly one page (leaderboard). Only `styles.css` and `styles.deduped.min.css` have a generator relationship; every other file is hand-written (the `*-page*.css` files were extracted from inline `<style>` blocks in commit `f5b7abf`).

## 4. How `styles.deduped.min.css` is produced (A.3)

**Command (implied, never scripted):** from the repo root `npx postcss public/styles.css -o <out>`; `postcss-cli` auto-discovers `postcss.config.js`. Nothing in `package.json` scripts, `Dockerfile`, `render.yaml`, `vercel.json` or any doc references it (`git grep -i "postcss\|deduped"`, excluding the HTML link tags, finds only `package.json` devDependencies, `postcss.config.js`, `public/sw.js` and two CSS comments).

**Tool versions:** postcss 8.5.6, postcss-cli 11.0.1, @fullhuman/postcss-purgecss 4.1.3 (purgecss 4.1.3), cssnano 7.0.7 with `preset: 'default'`, browserslist 4.25.1, caniuse-lite 1.0.30001727. No `.browserslistrc`/`browserslist` key, so cssnano targets the browserslist default query against that caniuse-lite snapshot. All are `devDependencies`; `package-lock.json` pins them.

**Inputs (plugin order: PurgeCSS, then cssnano):** source `public/styles.css`; PurgeCSS `content` = `./public/**/*.html`, `./public/**/*.js`, `./public/**/*-page*.css` (the last glob was added by `052ff8f` on 2026-10-13, after the committed file was last touched); `defaultExtractor` = `content.match(/[A-Za-z0-9-_:/.]+/g)`. **Safelist: none** (this task adds one in Phase B). Server-built HTML strings in `server.js`, `routes/`, `lib/` are not scanned.

**Committed:** yes (`public/styles.deduped.min.css`, 38 lines, 40,111 B LF / 40,148 B CRLF in the working tree). Deploys never build CSS (section 6), so it must stay committed.

**Git history:**

- `af170e2` (2025-07-08, "css"): added `postcss.config.js` (content globs html+js only), the devDependencies, `public/styles.deduped.min.css`, `public/styles.purged.css` (15,483 lines) and `public/styles-clean.css`; switched `index.html` and `register.html` from `styles-clean.css` to the deduped file.
- `8d441c7` and `026f853` (same day, "stykes", "visual tweaks"): modified ONLY `styles.deduped.min.css` (+5/-1 and +34/-1 lines). No `styles.css` change in those commits, so the min file was edited by hand (or regenerated from an uncommitted source).
- `072bc5d` (2026-10-09): removed 12 duplicate lines from `styles.css` and `styles.purged.css` and, in the minified file, deleted exactly one rule by hand (`.recipient-item .alert-warning{background:rgba(255,149,0,.1);border-left:3px solid #ff9500;color:#ff9500}`, 105 characters); `aws-design.css` gained 87 lines in the same commit.
- `d689cc6` (2026-10-12): deleted `styles.purged.css` (15,471 lines) and `styles-clean.css` (336 lines); the repository now has no other generated CSS artifact.
- `052ff8f` (2026-10-13): `postcss.config.js` gained the `./public/**/*-page*.css` glob.

**Why it cannot be regenerated today:** the file differs from the rebuild in 13 rules whose declarations differ (some carry unminified values such as `rgba(16, 212, 65, 0.25)` or `#00693E` that cssnano would have rewritten, i.e. hand edits) and in 102 rules that exist on only one side. Git cannot tell which of these come from an older `styles.css`, an older config/tool version, or manual edits. The committed file holds 399 rules; the rebuild yields 357.

### Drift report (rebuild vs committed)

Rebuilt twice with the exact command above into `$env:TEMP\css-consolidate-1\css-audit\regen-cli1.css` / `regen-cli2.css`: both 35,231 B (the CLI emits LF), SHA-256 `1ff9cf6cf0de24bbb670f7dc8bb6e30b23f3453571b025ab6bce21362e723c94` identical, so the build is deterministic on this machine with the locked versions. The committed blob is 40,111 B, SHA-256 `eb22c6e67aa4f795427050840ad84f1757644d26d90e4756b2cc0798c3d02b18` (LF). Rule-level comparison (key = at-rule/parent context + normalised selector list + occurrence index; CRLF normalised; declarations compared as `prop:value`):

| Measure | Count |
|---|---|
| Rules in committed file | 399 |
| Rules in rebuild | 357 |
| Identical | 314 |
| Same selector, different declarations | 13 |
| Only in committed (7,856 B) | 72 |
| Only in rebuild (3,197 B) | 30 |

**The committed file is NOT in sync with `styles.css` + `postcss.config.js` and cannot be reproduced.**

Changed-declaration rules (all 13; "committed" vs "rebuild"):

| Rule | Committed | Rebuild |
|---|---|---|
| `{.profile-picture-placeholder} \| :root` | --ios-success:#00693E | --ios-success:#34c759 |
| `.login-header` | (none) | background:transparent; position:relative |
| `.login-body` | (none) | background:transparent; position:relative |
| `.alert-success` | color:#00693E | color:#2db84d |
| `.badge` | (none) | max-width:100%; overflow:hidden |
| `.present-item` | (none) | max-width:100%; overflow:hidden |
| `.btn-success` | box-shadow:0 6px 20px rgba(16, 212, 65, 0.25) | box-shadow:0 6px 20px rgba(52,199,89,.25) |
| `.btn-success:hover` | background:#34c759 | background:#2db84d |
| `.recipient-item .btn-outline-success` | background:rgba(52, 199, 89, 0.05) | background:rgba(52,199,89,.05) |
| `.recipients-page .present-item .btn-success:hover` | background-color:#34c759; border-color:#34c759 | background-color:#157347; border-color:#146c43 |
| `#selfIdentificationModal .btn-success:hover` | background:#34c759 | background:#2db84d |
| `#recipientSelectionModal .btn-success:hover` | background:#34c759 | background:#2db84d |
| `@keyframes slideDown \| 0%` | transform:translateY(-20px) | transform:translateY(-100%) |

Custom properties in `:root` that differ: `--ios-success` committed `#00693E` vs rebuild `#34c759`. Note the committed value sits in the nested `:root` described in section 0, so it has no effect in the browser either way.

Rules only in the committed file (first 40 of 72):

- `.login-body,.login-header` (67 B)
- `.form-control` (290 B)
- `.form-control:focus` (149 B)
- `.badge,.present-item` (52 B)
- `.present-item .col-md-2,.present-item .col-md-4` (81 B)
- `.recipient-item .btn-outline-warning` (107 B)
- `.recipient-item .btn-outline-warning:hover` (94 B)
- `@media (max-width:768px) \| .recipient-item .col-md-2,.recipient-item .col-md-4,.recipient-item .col-md-6` (107 B)
- `.col-md-2,.col-md-4,.col-md-6,.col-md-8` (73 B)
- `.recipient-item .btn-outline-success.btn-sm,.recipient-item .btn-outline-warning.btn-sm` (332 B)
- `.recipient-item .btn-outline-success.btn-sm:hover,.recipient-item .btn-outline-warning.btn-sm:hover` (165 B)
- `.present-item.checking` (65 B)
- `.present-item .col-md-2.text-end` (90 B)
- `@media (max-width:768px) \| .navbar-nav` (95 B)
- `@media (max-width:768px) \| .navbar-nav .btn` (96 B)
- `@media (max-width:576px) \| .btn,.form-control` (55 B)
- `.navbar-nav .btn i` (38 B)
- `@media (max-width:576px) \| .navbar-nav` (25 B)
- `@media (max-width:768px) \| .col-md-2,.col-md-4` (41 B)
- `@media (max-width:768px) \| .col-md-2` (29 B)
- `@media (max-width:768px) \| .present-item .col-md-2` (65 B)
- `@media (max-width:768px) \| .present-item .text-end` (52 B)
- `.recipients-page .compact-card` (59 B)
- `@media (max-width:575.98px) \| .recipients-page .compact-card .card-body` (169 B)
- `@media (max-width:575.98px) \| .recipients-page .compact-card .btn-lg` (91 B)
- `@media (max-width:575.98px) \| .recipients-page .compact-card .text-muted` (59 B)
- `@media (max-width:575.98px) \| .recipients-page .action-btn .btn-text` (52 B)
- `@media (max-width:575.98px) \| .recipients-page .action-btn i` (63 B)
- `@media (max-width:575.98px) \| .recipients-page .compact-card .btn-lg #2` (159 B)
- `@media (max-width:575.98px) \| .recipients-page .row .col-4:nth-child(3) .compact-card .card-body` (89 B)
- `@media (max-width:575.98px) \| .recipient-item .col-md-2` (129 B)
- `.recipients-page .row:first-child,.recipients-page .row:first-child .col-4,.recipients-page .row:first-child .compact-card` (139 B)
- `.recipients-page .present-item .btn-outline-warning` (87 B)
- `.recipients-page .present-item .btn-outline-warning:hover` (115 B)
- `@media (max-width:768px) \| .recipients-page .row .col-4` (69 B)
- `@media (max-width:768px) \| .recipients-page .row .col-4:nth-child(2),.recipients-page .row .col-4:nth-child(3)` (125 B)
- `@media (max-width:768px) \| .recipients-page .compact-card .card-body` (78 B)
- `@media (max-width:768px) \| .recipients-page .action-btn` (130 B)
- `@media (max-width:768px) \| .recipients-page .action-btn .btn-text` (52 B)
- `@media (max-width:768px) \| .recipients-page .action-btn i` (55 B)

Rules only in the rebuild (all 30):

- `.login-header h2` (208 B)
- `.form-control,.form-select` (303 B)
- `.form-control:focus,.form-select:focus` (168 B)
- `.tooltip` (71 B)
- `.popover` (111 B)
- `.present-item .col-md-4` (57 B)
- `.present-comments` (126 B)
- `.form-select option.text-primary` (120 B)
- `.form-select option.text-primary:hover` (75 B)
- `@media (max-width:768px) \| .recipient-item .col-md-4,.recipient-item .col-md-6` (81 B)
- `.col-md-4,.col-md-6,.col-md-8` (63 B)
- `.main-card .card-header h3` (181 B)
- `.recipient-item .btn-outline-success.btn-sm` (288 B)
- `.recipient-item .btn-outline-success.btn-sm:hover` (115 B)
- `.present-item.checking,.present-item.unchecking` (90 B)
- `@media (max-width:576px) \| .main-card .card-header h3` (44 B)
- `@media (max-width:576px) \| .btn,.form-control,.form-select` (68 B)
- `@media (max-width:768px) \| .col-md-4` (31 B)
- `.recipients-page .row:first-child` (50 B)
- `.present-item.reserved-by-other .present-comments` (64 B)
- `.present-item-modal.slide-up` (60 B)
- `.present-item.slide-up` (62 B)
- `.present-item.animating` (44 B)
- `.present-item-modal.slide-up #2` (60 B)
- `.present-item-modal.animating` (50 B)
- `.notification-banner` (221 B)
- `.notification-banner .btn-light` (114 B)
- `.notification-banner .btn-light:hover` (95 B)
- `.notification-banner .btn-outline-light` (83 B)
- `.notification-banner .btn-outline-light:hover` (94 B)

## 5. Which pages use raw `styles.css` vs `styles.deduped.min.css`, and why (A.3)

| Page | Stylesheet | Link introduced / changed (git log -S) | Reason recorded? |
|---|---|---|---|
| activity | deduped | `c2901f1` 2025-10-20 "feat: implement complete notification center system" | no (message only names the feature) |
| archiwum | deduped | `2b23034` 2026-07-18 "feat: Maintenance mode, UX improvements, and year archiving" (page created with the deduped link) | no |
| formularz | deduped | `b99f29e` 2025-10-30 "formularz" | no |
| home | deduped (raw link removed) | `8473a39` 2025-11-11 "statystyki as homepage" added the page with BOTH `styles.css` and `styles.deduped.min.css`; `9c20421` 2026-10-09 "UX fixes" removed the raw link | no |
| index | deduped | `0ee5f75` 2025-07-06 raw `styles.css`; `5a46534` 2025-07-08 "logic" `styles-clean.css`; `af170e2` 2025-07-08 "css" deduped | no |
| intro | none (`intro-page.css` only) | `a250dd5` 2026-10-13 extracted its inline CSS; never linked a styles.* file | n/a |
| leaderboard | **raw `styles.css`** | `18bbc8c` 2025-11-02 "leaderboard" (page creation); its stylesheet links were never switched | no: reason not recorded |
| maintenance | none (inline `<style>` only) | `2b23034` 2026-07-18 page creation | n/a |
| osoby | deduped | `3739f9f` 2026-07-19 "feat: People management page, orange reservations, gift tab icon" | no |
| recipients | deduped | `0ee5f75` 2025-07-06 raw; `8d441c7` 2025-07-08 "stykes" switched to deduped | no |
| register | deduped | `0ee5f75` raw; `5a46534` styles-clean; `af170e2` deduped | no |
| rezerwacje | deduped | `bc99592` 2026-07-18 "feat: Dedicated reservations page, formularz link on login" | no |
| ustawienia | deduped | `9436905` 2026-07-18 "feat: Settings page, simplify recipients page" | no |
| wiadomosci | deduped | `2269e78` 2026-07-19 "feat: Anonymous messages between users with threads and notifications" | no |

- Ten of 14 pages load the deduped file, one (leaderboard) loads raw `styles.css`, and `intro`/`maintenance` load neither. All commit messages are one-liners; none explains a raw-vs-deduped choice. The simplest reading of the history (an inference, not a recorded reason) is that `leaderboard.html` was created on 2025-11-02 by copying a template that still linked `styles.css` and the link was never revisited.
- Consequence: leaderboard is the only page that exercises the raw source (including the nested-`:root` defect and ~1,770 duplicate rules), and it is the only page whose styling would change if `styles.css` rules are removed in Phase C.

## 6. Deploy, service worker and server consequences (A.3)

- `Dockerfile`: `node:18-alpine`, `npm install --only=production` (devDependencies, hence postcss/PurgeCSS/cssnano, are NOT installed in the image), then `COPY . .` and `CMD ["node","server.js"]`. No CSS build step.
- `render.yaml`: `buildCommand: npm install`, `startCommand: npm start` (`node server.js`). No CSS build step.
- `vercel.json`: builds only `server.js` with `@vercel/node`; every route goes to `server.js`. No CSS build step.
- `.dockerignore` excludes `node_modules`, `.git`, `.env`, `README.md`, logs, zips; it does not exclude anything under `public/`. `package.json` `build` script is `echo 'No build step required'`.
- **Conclusion:** nothing in any deploy path builds CSS, so every file under `public/` that a page links, including `styles.deduped.min.css`, is served exactly as committed and generated output must stay committed.
- `server.js:54-70` (`express.static`): `.html` gets `no-cache, no-store, must-revalidate`; `.css` and `.js` get `no-cache, must-revalidate` (so `?v=` is irrelevant for the browser HTTP cache); other assets `public, max-age=3600`. The demo server used by the tests is the same `server.js` (compression: brotli negotiated by Edge).
- `public/sw.js`: `CACHE_NAME = 'prezenty-v125'` in this worktree. `urlsToCache` (install, `Promise.allSettled`, one `cache.add` per URL) contains `/styles.deduped.min.css`, `/aws-design.css`, `/chat-reactions.css` (all unversioned) and every `/<page>-page*.css?v=1`, plus bootstrap and Font Awesome 6.0.0 from CDN. Non-HTML requests are cache-first with `caches.match(event.request)` and NO `ignoreSearch`, so the cache key is the full URL including the query.
- **Precache vs page URL mismatches (reported, not fixed):** (1) recipients requests `/aws-design.css?v=4` but the precache holds `/aws-design.css`; they are different keys, so recipients never hits the precached copy (it is cached on first runtime fetch instead). activity requests `/aws-design.css` and matches. (2) `chat-reactions.css` is precached unversioned while wiadomosci requests `chat-reactions.css?v=3`: same mismatch. (3) Not precached at all: `bottom-tab-bar.css?v=42`, `app-theme.css?v=14`, `filters.css?v=7`, `styles.css`, remixicon CSS, Font Awesome 6.4.0 (home, intro, leaderboard). (4) `styles.deduped.min.css` has no `?v=` anywhere, so a changed file only reaches an installed PWA when `CACHE_NAME` changes (the old cache is deleted on activate) or the runtime cache entry is replaced.
- Consequence for later phases: any change to a served CSS byte needs the `?v=` bump on its link tag where one exists AND a single final `CACHE_NAME` bump; unversioned files (`styles.deduped.min.css`, `styles.css`, `aws-design.css` on activity) rely on the `CACHE_NAME` bump alone.

## 7. Real Edge coverage (A.4)

Driver: `tmp-css-coverage.js`, Edge (`channel: msedge`, headless), `page.coverage.startCSSCoverage({ resetOnNavigation: false })`, demo server (`e2e`/`e2e` login), service worker blocked, CDN responses from `tests/.cache/cdn`. Pages: all 14 in-scope pages (`wiadomosci` twice: the thread list and `?rozmowa=1`), viewports **375x812** and **1024x768**, 30 runs, 0 run errors, 0 runs left the page under test (guard: URL compared after every step). Ranges are unioned per URL (query stripped, CDN ignored) and indexed into the stylesheet text as served; bytes are UTF-8 bytes; every file's served text equals the working-tree file (`matchesDisk` true for all 19).

**Limitation (read before using these numbers).** Coverage only reports rules matched by elements that existed while the run was recording. Classes added later by JavaScript (status badges, error and empty states, toasts, modals that were not opened, rows that demo data never creates), pseudo-state rules (`:hover`, `:focus-visible`, `:disabled`) on controls the run did not reach, `prefers-color-scheme` and `print` media, other viewport widths and other user roles all look "unused" here. **Uncovered rules are therefore REPORTED, never removed.** Phase C uses the stricter static criterion (a token must be absent from the whole usage corpus, including dynamic prefixes and third-party JS) and a rule-set proof.

### Interactions replayed

Read first: every `tests/e2e/*.spec.js` (a11y, chat-reactions, composer, edit-sheet, escaping, helpers, no-horizontal-overflow, pluralization, smoke, wrapping, xss-usernames) and `tests/helpers/*.js` (a11y, cdn-cache, contrast, focus, line-breaks, non-color-cue, overflow, pages, scroll, start-demo-server). The state transitions (not the assertions) were replayed:

- **All pages, both viewports:** hover the first 14 visible buttons/links/cards/inputs; keyboard Tab x12 then Shift+Tab (focus-visible styles); `form.reportValidity()` on every form (`:invalid`); click every collapsed accordion/collapse toggle; call the page's own `toggleTabBarMenu()`, `toggleNotificationsPanel()`, `toggleSidebar()` open and close when defined; open and close EVERY `.modal` in the DOM through the Bootstrap API (`shown.bs.modal`/`hidden.bs.modal`, 1-14 per page); scroll to the bottom and back.
- **formularz (composer.spec):** focus `#quickAddTitle` (add mode), fill `#quickAddTitle`/`#quickAddComments` then clear (submit enabled/disabled), `#quickAddToggle` x2, `#quickAddClose`, Escape, hover a `#myPresentsList` button.
- **recipients (edit-sheet.spec):** expand `#accordion-own-2-collapse`, open the edit present bottom sheet (`button.edit-present-btn` then `shown.bs.modal`), focus `#editPresentComments`, Tab, Escape; click every `.filter-option` status filter; cycle every option of `#personFilter`; hover an action button.
- **wiadomosci thread (`?rozmowa=1`, chat-reactions.spec):** toggle a `.chat-reaction-chip` twice, open the picker sheet via `.chat-reaction-add` (`#reactionSheet.is-open`), hover and Tab inside `#reactionSheetGrid`, Escape; focus and fill the composer input. **wiadomosci list:** hover thread rows.
- **leaderboard (xss-usernames/pluralization specs):** hover `#podium .podium-place`, `#usersList .user-card`, `.activity-card`; click the first visible tab/period toggles. Cards and podium places are hover-only because a click navigates to `/recipients.html?osoba=...` (`leaderboard-page.js:256`), which discards the page's coverage.
- **osoby:** `startEdit` button then "Anuluj", hover `[data-delete-present]`. **activity:** hover a `.notification-item`, click filter-like buttons. **ustawienia:** toggle every visible checkbox/switch twice, focus first select/input. **home:** hover the available presents list (sidebar button does not exist on this page). **index/register:** type into and clear every input, submit the empty form. **intro:** hover the first button. **maintenance:** load only.
- Not reproduced: network-failure and empty-state flows, real file uploads, push notifications, the install prompt, other roles/data than the seeded demo user, any viewport other than the two above.

Steps that were attempted but could not run (element absent in demo data, hidden at that viewport, or timed out; all other steps ran): 

- `archiwum@375x812: skip archiwum: list item click/expand (locator.scrollIntoViewIfNeeded: Timeout 1500ms exceeded.)`
- `archiwum@1024x768: skip archiwum: list item click/expand (locator.scrollIntoViewIfNeeded: Timeout 1500ms exceeded.)`
- `formularz@1024x768: skip composer: toggle (#quickAddToggle) x2 (locator.click: Timeout 3000ms exceeded.)`
- `home@375x812: skip home: sidebar open/close via menu button (locator.click: Timeout 2000ms exceeded.)`
- `home@375x812: skip home: available presents list hover (locator.scrollIntoViewIfNeeded: Timeout 1500ms exceeded.)`
- `home@1024x768: skip home: sidebar open/close via menu button (locator.click: Timeout 2000ms exceeded.)`
- `home@1024x768: skip home: available presents list hover (locator.scrollIntoViewIfNeeded: Timeout 1500ms exceeded.)`
- `rezerwacje@375x812: skip rezerwacje: list item click/expand (locator.scrollIntoViewIfNeeded: Timeout 1500ms exceeded.)`
- `rezerwacje@1024x768: skip rezerwacje: list item click/expand (locator.scrollIntoViewIfNeeded: Timeout 1500ms exceeded.)`

Handlers that do not exist on a page (`toggleTabBarMenu`, `toggleNotificationsPanel`, `toggleSidebar`) are skipped silently on those pages; they are defined only where the dock or sidebar markup exists.

### Used vs unused bytes per file (union of all runs)

| File | Total B | Used B | Unused B | % unused | Used @375x812 | Used @1024x768 | Loaded by |
|---|---|---|---|---|---|---|---|
| `activity-page.css` | 8,265 | 5,157 | 3,108 | 37.6% | 5,157 | 4,685 | activity |
| `app-theme.css` | 14,403 | 9,207 | 5,196 | 36.1% | 4,894 | 7,341 | activity, archiwum, formularz, home, leaderboard, osoby, recipients, rezerwacje, ustawienia, wiadomosci |
| `archiwum-page.css` | 2,741 | 1,017 | 1,724 | 62.9% | 1,017 | 1,017 | archiwum |
| `aws-design.css` | 114,692 | 25,600 | 89,092 | 77.7% | 24,326 | 23,112 | activity, recipients |
| `bottom-tab-bar.css` | 26,165 | 17,022 | 9,143 | 34.9% | 17,022 | 15,757 | activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci |
| `chat-reactions.css` | 12,051 | 6,796 | 5,255 | 43.6% | 5,990 | 6,796 | wiadomosci |
| `filters.css` | 13,023 | 3,664 | 9,359 | 71.9% | 3,664 | 3,148 | recipients |
| `formularz-page-edit.css` | 30,720 | 15,533 | 15,187 | 49.4% | 15,331 | 4,130 | formularz |
| `formularz-page.css` | 13,852 | 8,634 | 5,218 | 37.7% | 8,331 | 8,487 | formularz |
| `home-page.css` | 5,435 | 4,203 | 1,232 | 22.7% | 4,203 | 2,910 | home |
| `intro-page.css` | 8,851 | 5,029 | 3,822 | 43.2% | 5,029 | 4,843 | intro |
| `leaderboard-page.css` | 23,853 | 18,981 | 4,872 | 20.4% | 18,367 | 14,974 | leaderboard |
| `osoby-page.css` | 1,741 | 1,645 | 96 | 5.5% | 1,645 | 1,645 | osoby |
| `recipients-page.css` | 29,568 | 14,768 | 14,800 | 50.1% | 14,564 | 12,172 | recipients |
| `rezerwacje-page.css` | 2,425 | 1,810 | 615 | 25.4% | 1,810 | 1,810 | rezerwacje |
| `styles.css` | 437,177 | 5,872 | 431,305 | 98.7% | 5,872 | 4,928 | leaderboard |
| `styles.deduped.min.css` | 40,148 | 20,905 | 19,243 | 47.9% | 20,818 | 18,180 | activity, archiwum, formularz, home, index, osoby, recipients, register, rezerwacje, ustawienia, wiadomosci |
| `ustawienia-page.css` | 1,854 | 1,461 | 393 | 21.2% | 1,461 | 1,461 | ustawienia |
| `wiadomosci-page.css` | 6,299 | 3,990 | 2,309 | 36.7% | 3,990 | 3,990 | wiadomosci |

All local files together: 793,263 B, 171,294 B used by at least one page/viewport (21.6%), 78.4% not exercised by this run. Each file's number is a union over every page that loads it, so shared files look better here than they do on any single page; see the per-page matrix.

### Per-page matrix: used bytes / total bytes of each shared or page file (375x812 | 1024x768)

| File | activity | archiwum | formularz | home | index | intro | leaderboard | maintenance | osoby | recipients | register | rezerwacje | ustawienia | wiadomosci |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `activity-page.css` (8,265) | 5,157 / 4,685 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `app-theme.css` (14,403) | 551 / 3,776 | 958 / 4,139 | 2,018 / 3,883 | 3,965 / 6,211 |  |  | 680 / 4,035 |  | 1,185 / 4,017 | 3,666 / 5,871 |  | 1,185 / 4,446 | 1,398 / 4,659 | 1,398 / 4,659 |
| `archiwum-page.css` (2,741) |  | 1,017 / 1,017 |  |  |  |  |  |  |  |  |  |  |  |  |
| `aws-design.css` (114,692) | 7,690 / 6,455 |  |  |  |  |  |  |  |  | 21,475 / 21,406 |  |  |  |  |
| `bottom-tab-bar.css` (26,165) | 15,894 / 14,777 |  | 15,559 / 14,766 | 15,559 / 14,766 |  |  | 15,224 / 14,283 |  |  | 14,924 / 14,283 |  | 15,072 / 12,015 | 15,076 / 12,015 | 15,721 / 14,780 |
| `chat-reactions.css` (12,051) |  |  |  |  |  |  |  |  |  |  |  |  |  | 5,990 / 6,796 |
| `filters.css` (13,023) |  |  |  |  |  |  |  |  |  | 3,664 / 3,148 |  |  |  |  |
| `formularz-page-edit.css` (30,720) |  |  | 15,331 / 4,130 |  |  |  |  |  |  |  |  |  |  |  |
| `formularz-page.css` (13,852) |  |  | 8,331 / 8,487 |  |  |  |  |  |  |  |  |  |  |  |
| `home-page.css` (5,435) |  |  |  | 4,203 / 2,910 |  |  |  |  |  |  |  |  |  |  |
| `intro-page.css` (8,851) |  |  |  |  |  | 5,029 / 4,843 |  |  |  |  |  |  |  |  |
| `leaderboard-page.css` (23,853) |  |  |  |  |  |  | 18,367 / 14,974 |  |  |  |  |  |  |  |
| `osoby-page.css` (1,741) |  |  |  |  |  |  |  |  | 1,645 / 1,645 |  |  |  |  |  |
| `recipients-page.css` (29,568) |  |  |  |  |  |  |  |  |  | 14,564 / 12,172 |  |  |  |  |
| `rezerwacje-page.css` (2,425) |  |  |  |  |  |  |  |  |  |  |  | 1,810 / 1,810 |  |  |
| `styles.css` (437,177) |  |  |  |  |  |  | 5,872 / 4,928 |  |  |  |  |  |  |  |
| `styles.deduped.min.css` (40,148) | 2,805 / 2,590 | 3,183 / 3,082 | 5,646 / 5,391 | 6,502 / 5,858 | 6,685 / 6,612 |  |  |  | 2,848 / 2,747 | 14,510 / 12,148 | 7,218 / 6,942 | 1,856 / 1,755 | 3,107 / 3,006 | 2,747 / 2,646 |
| `ustawienia-page.css` (1,854) |  |  |  |  |  |  |  |  |  |  |  |  | 1,461 / 1,461 |  |
| `wiadomosci-page.css` (6,299) |  |  |  |  |  |  |  |  |  |  |  |  |  | 3,881 / 3,881 |

(Wiadomosci shows the larger of its two runs. A blank cell means the page does not load that file.)

### Inline `<style>` blocks (reported per page, not per file)

Bytes are as reported by the browser (CRLF folded to LF), so they are a few dozen bytes below the HTML-side sizes in section 2.

| Page | Inline bytes | Used @375 | Used @1024 |
|---|---|---|---|
| activity | 377 | 300 | 300 |
| formularz | 378 | 300 | 300 |
| leaderboard | 378 | 300 | 300 |
| maintenance | 1690 | 1459 | 1459 |
| recipients | 377 | 300 | 300 |

Coverage-based rule counts (rules with no overlap with any used range, keyframe steps excluded; REPORT ONLY):

| File | Rules | Uncovered rules | Uncovered rule bytes |
|---|---|---|---|
| `activity-page.css` | 37 | 8 | 1,340 |
| `app-theme.css` | 59 | 4 | 850 |
| `archiwum-page.css` | 13 | 7 | 1,446 |
| `aws-design.css` | 616 | 471 | 72,184 |
| `bottom-tab-bar.css` | 108 | 36 | 5,178 |
| `chat-reactions.css` | 46 | 8 | 696 |
| `filters.css` | 90 | 64 | 6,929 |
| `formularz-page-edit.css` | 68 | 10 | 2,359 |
| `formularz-page.css` | 63 | 19 | 3,296 |
| `home-page.css` | 24 | 1 | 160 |
| `intro-page.css` | 51 | 25 | 2,931 |
| `leaderboard-page.css` | 128 | 8 | 1,235 |
| `osoby-page.css` | 9 | 0 | 0 |
| `recipients-page.css` | 105 | 37 | 8,140 |
| `rezerwacje-page.css` | 18 | 6 | 435 |
| `styles.css` | 2,312 | 2,273 | 382,604 |
| `styles.deduped.min.css` | 373 | 146 | 14,720 |
| `ustawienia-page.css` | 11 | 1 | 278 |
| `wiadomosci-page.css` | 32 | 6 | 993 |

## 8. Transfer baseline, "before" side of the final report (A.5)

`tmp-css-transfer.js`: demo server, Edge, 375x812, service worker blocked, cold context per page. "Decoded" is `(await response.body()).length`; "Transferred" is `request.sizes().responseBodySize` as sent by this server (`compression` middleware; Edge negotiated **br**); "gzip -6" is `zlib.gzipSync` level 6 for comparison with hosts that only gzip. CDN sheets (3 per page) are excluded from totals.

**recipients.html**

| URL | Decoded B | Transferred B | gzip -6 B | Encoding |
|---|---|---|---|---|
| `/styles.deduped.min.css` | 40,148 | 7,213 | 6,709 | br |
| `/aws-design.css?v=4` | 114,692 | 17,994 | 16,706 | br |
| `/bottom-tab-bar.css?v=42` | 26,165 | 6,080 | 5,847 | br |
| `/filters.css?v=7` | 13,023 | 2,858 | 2,731 | br |
| `/app-theme.css?v=14` | 14,403 | 4,060 | 3,953 | br |
| `/recipients-page.css?v=1` | 29,568 | 5,735 | 5,563 | br |
| **Total local CSS** | **237,999** | **43,940** | **41,509** | |

**leaderboard.html**

| URL | Decoded B | Transferred B | gzip -6 B | Encoding |
|---|---|---|---|---|
| `/styles.css` | 437,177 | 14,333 | 26,519 | br |
| `/bottom-tab-bar.css?v=42` | 26,165 | 6,080 | 5,847 | br |
| `/app-theme.css?v=14` | 14,403 | 4,060 | 3,953 | br |
| `/leaderboard-page.css?v=1` | 23,853 | 4,176 | 4,016 | br |
| **Total local CSS** | **501,598** | **28,649** | **40,335** | |

Raw file: `$env:TEMP\css-consolidate-1\transfer-before.json` (the numbers above are the committed copy).

## 9. Baselines (A.1, A.6)

- Harness determinism (A.1): `snap-A0` vs `css-baseline`: 56 files, 0 diffs; self-test with one edited cell exits 1.
- Baseline e2e (A.6) on this base, `npm test` (Playwright, 1 worker, Edge): **121 passed, 0 failed, 11 skipped** in 7.0m. Reference for the rest of the task: 121 passed / 0 failed / 11 skipped. Full log: `$env:TEMP\css-consolidate-1\e2e-before.txt`.
- Not run in Phase A: leaderboard-only snapshot (`tmp-css-snapshot-lb.js`) and the Phase B/C tools (`dyn`, `candidates`, `apply`, `rulecheck`); they are written when their phase starts.

## Appendix A. Top 30 uncovered rules per file (REPORT ONLY, nothing is removed on this basis)

Sorted by rule size. "Line" is the 1-based line in the working-tree file (CRLF). For the minified file the line is always its physical line (38 lines).

### activity-page.css (8 of 37 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 70 | 308 | `.fixed-header-bar` |  |
| 96 | 231 | `.activity-page .navbar .navbar-brand, .activity-page .navbar .brand-text` |  |
| 57 | 157 | `.activity-page .page-link, .activity-page .page-link *` |  |
| 64 | 153 | `.activity-page .page-item.active .page-link, .activity-page .page-item.active .page-link *` |  |
| 102 | 140 | `.activity-page .navbar i` |  |
| 182 | 137 | `.sidebar-item:hover` |  |
| 113 | 129 | `.activity-page h2` |  |
| 161 | 85 | `.sidebar-close:hover` |  |

### app-theme.css (4 of 59 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 316 | 492 | `.toast .toast-action-btn` |  |
| 479 | 170 | `#editPresentModal.modal.fade .modal-dialog, #editPresentModal.modal.show .modal-dialog` | @media (max-width: 768px) > @media (pref |
| 332 | 157 | `.toast .toast-action-btn:hover, .toast .toast-action-btn:active` |  |
| 106 | 31 | `.skeleton` | @media (prefers-reduced-motion: reduce) |

### archiwum-page.css (7 of 13 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 53 | 446 | `.archive-present` |  |
| 26 | 318 | `.year-pill` |  |
| 45 | 218 | `.archive-recipient-header` |  |
| 67 | 166 | `.spoiler-name` |  |
| 39 | 160 | `.year-pill.active, .year-pill.active *` |  |
| 36 | 76 | `.year-pill:hover` |  |
| 65 | 62 | `.archive-present .status` |  |

### aws-design.css (471 of 616 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 754 | 1380 | `.recipients-page .profile-check-btn` | @media (min-width: 1200px) |
| 2489 | 701 | `.recipients-page .aws-content-header .aws-header-title .fa-users.aws-gradient-icon, .recipients-page` |  |
| 4657 | 604 | `.verified-badge.is-open::after, .verified-badge:focus-visible::after` |  |
| 1335 | 580 | `.recipients-page .aws-header-title h5 i, .recipients-page .aws-header-title h5 .fa-users, .recipient` |  |
| 4445 | 498 | `.notification-bell-floating .notification-dropdown` |  |
| 3497 | 483 | `.fab-main` |  |
| 1371 | 471 | `.recipients-page .aws-content-header .aws-header-title i.fa-users.aws-gradient-icon` |  |
| 4404 | 455 | `.notification-bell-floating .notification-bell-btn` |  |
| 1360 | 451 | `.recipients-page .aws-header-title i.fa-users.aws-gradient-icon` |  |
| 3925 | 438 | `.notification-dropdown` |  |
| 1400 | 433 | `.recipients-page .aws-loading-state .logo-spinner` |  |
| 900 | 431 | `.recipients-page .aws-action-icon` |  |
| 548 | 423 | `.recipients-page .change-picture-btn` |  |
| 1099 | 414 | `.recipients-page .aws-action-section .col-lg-4, .recipients-page .aws-action-section .col-md-4, .rec` | @media (max-width: 768px) |
| 275 | 408 | `.recipients-page .brand-logo-container` |  |
| 2479 | 408 | `.recipients-page .aws-gradient-icon:not(.fa-users)` |  |
| 1298 | 407 | `.recipients-page .aws-content-header::before` |  |
| 3548 | 405 | `.fab-item` |  |
| 2143 | 399 | `.recipients-page .sort-button` |  |
| 507 | 396 | `.recipients-page .identify-btn-modal` |  |
| 1161 | 382 | `.recipients-page .aws-action-section .col-lg-4, .recipients-page .aws-action-section .col-md-4, .rec` | @media (max-width: 576px) |
| 9 | 378 | `.notification-bell-btn` |  |
| 819 | 375 | `.recipients-page .profile-check-btn.identified:hover` | @media (min-width: 1200px) |
| 576 | 368 | `.recipients-page .change-picture-btn-mobile` |  |
| 803 | 367 | `.recipients-page .profile-check-btn:hover` | @media (min-width: 1200px) |
| 1071 | 365 | `.recipients-page .aws-action-section .col-lg-4, .recipients-page .aws-action-section .col-md-4, .rec` |  |
| 1321 | 351 | `.recipients-page .aws-header-title h5` |  |
| 4254 | 349 | `.notification-dropdown` |  |
| 4430 | 348 | `.notification-bell-floating .notification-badge` |  |
| 2506 | 340 | `.recipients-page .aws-content-header *[class*="fa-users"]` |  |

### bottom-tab-bar.css (36 of 108 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 321 | 839 | `.tab-bar-menu-btn` |  |
| 577 | 337 | `.tab-bar-notifications-empty i, body.recipients-page .tab-bar-notifications-empty i, .recipients-pag` |  |
| 567 | 314 | `.tab-bar-notifications-empty, body.recipients-page .tab-bar-notifications-empty, .recipients-page .t` |  |
| 108 | 253 | `.tab-item.active.leaderboard-tab` |  |
| 351 | 251 | `.tab-bar-menu-btn:hover` |  |
| 588 | 234 | `.tab-bar-notifications-empty p, body.recipients-page .tab-bar-notifications-empty p, .recipients-pag` |  |
| 288 | 233 | `.tab-fab:hover` |  |
| 617 | 211 | `.tab-bar-notifications-view-all a:hover, body.recipients-page .tab-bar-notifications-view-all a:hove` |  |
| 858 | 198 | `.tab-bar-light-bg` |  |
| 852 | 190 | `.tab-bar-dark-bg` |  |
| 299 | 168 | `.tab-fab:active` |  |
| 899 | 145 | `.tab-bar-menu-tile:hover, .tab-bar-menu-tile:active` |  |
| 345 | 122 | `.tab-bar-menu-btn i` |  |
| 749 | 116 | `.tab-bar-menu-item.logout-item:hover` |  |
| 701 | 106 | `.tab-bar-menu-item:hover` |  |
| 242 | 95 | `.tab-item.active.leaderboard-tab i, .tab-item.active.leaderboard-tab span` |  |
| 796 | 93 | `.tab-bar-menu-btn` | @media (max-width: 480px) |
| 468 | 88 | `.tab-bar-notifications-close:hover` |  |
| 504 | 87 | `.tab-bar-notification-item:hover` |  |
| 830 | 84 | `.tab-fab` | @media (max-width: 360px) |
| 725 | 83 | `.tab-bar-menu-item.add-person-item i` |  |
| 729 | 83 | `.tab-bar-menu-item.add-present-item i` |  |
| 741 | 83 | `.tab-bar-menu-item.settings-item i` |  |
| 745 | 78 | `.tab-bar-menu-item.logout-item i` |  |
| 358 | 77 | `.tab-bar-menu-btn:hover i` |  |
| 808 | 72 | `.tab-bar-container` | @media (max-width: 360px) |
| 821 | 69 | `.tab-item i` | @media (max-width: 360px) |
| 681 | 68 | `.tab-bar-menu-close:hover` |  |
| 817 | 60 | `.tab-item span` | @media (max-width: 360px) |
| 316 | 59 | `body.has-tab-bar.expanded` |  |

### chat-reactions.css (8 of 46 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 357 | 166 | `.reaction-sheet-btn[aria-pressed="true"]` |  |
| 398 | 108 | `#reactionSheetOverlay, #reactionSheet, #reactionSheet.is-open` | @media (prefers-reduced-motion: reduce) |
| 414 | 96 | `#reactionSheet, #reactionSheet.is-open` | @media (prefers-reduced-motion: reduce)  |
| 182 | 79 | `.chat-reactions .chat-reaction-add::before` | @media (prefers-reduced-motion: reduce) |
| 205 | 71 | `.chat-reactions .chat-reaction-add` | @media (hover: hover) and (pointer: fine |
| 321 | 68 | `#reactionSheetClose:hover` |  |
| 408 | 58 | `#reactionSheet.is-open` | @media (prefers-reduced-motion: reduce) |
| 404 | 50 | `#reactionSheet` | @media (prefers-reduced-motion: reduce) |

### filters.css (64 of 90 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 318 | 275 | `.filter-toggle-btn` |  |
| 224 | 248 | `.search-input-wrapper` |  |
| 240 | 240 | `.search-icon-wrapper` |  |
| 178 | 234 | `.search-autocomplete-dropdown` | @media (max-width: 768px) |
| 11 | 226 | `.autocomplete-section-title` |  |
| 613 | 209 | `.aws-action-section` |  |
| 258 | 195 | `.search-input` |  |
| 626 | 183 | `.aws-action-section .aws-action-card:hover` |  |
| 106 | 174 | `.autocomplete-item-subtitle` |  |
| 599 | 171 | `button[onclick*="reservePresent"]:hover i, button[onclick*="reservePresent"]:hover .fas, button[oncl` |  |
| 30 | 167 | `.autocomplete-item` |  |
| 98 | 150 | `.autocomplete-item-title` |  |
| 115 | 147 | `.autocomplete-item mark` |  |
| 123 | 138 | `.autocomplete-more` |  |
| 592 | 132 | `.btn-outline-warning:hover i, .btn-outline-warning:hover .fas, .btn-outline-warning:hover .far` |  |
| 80 | 131 | `.autocomplete-more-presents` |  |
| 285 | 128 | `.search-container` | @media (max-width: 768px) |
| 149 | 125 | `.search-highlight` |  |
| 202 | 121 | `.search-autocomplete-dropdown::-webkit-scrollbar-track` |  |
| 61 | 120 | `.autocomplete-presents-list` |  |
| 235 | 120 | `.search-input-wrapper:focus-within` |  |
| 251 | 112 | `.search-icon` |  |
| 431 | 112 | `.filter-panel-content > div` | @media (max-width: 768px) |
| 377 | 109 | `.filter-select:focus` |  |
| 207 | 108 | `.search-autocomplete-dropdown::-webkit-scrollbar-thumb` |  |
| 344 | 107 | `.filter-panel` |  |
| 331 | 105 | `.filter-toggle-btn:hover` |  |
| 337 | 104 | `.filter-toggle-btn.active` |  |
| 273 | 102 | `.search-input-wrapper:focus-within .search-icon` |  |
| 622 | 97 | `.aws-action-section .aws-action-card` |  |

### formularz-page-edit.css (10 of 68 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 670 | 846 | `.quick-add-composer, body.dock-hidden:not(.quick-add-active) .quick-add-composer, body.quick-add-act` | @media (prefers-reduced-motion: reduce) |
| 200 | 331 | `#myPresentsList .my-present-item.is-new::before` |  |
| 689 | 184 | `#myPresentsList .my-present-item.is-new` | @media (prefers-reduced-motion: reduce) |
| 143 | 182 | `.quick-add-message.alert-success` |  |
| 149 | 181 | `.quick-add-message.alert-danger` |  |
| 109 | 176 | `#myPresentsList .my-present-add-details:focus-visible` |  |
| 195 | 142 | `#myPresentsList .my-present-item.is-new` |  |
| 694 | 128 | `#myPresentsList .my-present-item.is-new::before` | @media (prefers-reduced-motion: reduce) |
| 104 | 127 | `#myPresentsList .my-present-add-details:hover` |  |
| 116 | 62 | `#myPresentsList .my-present-add-details` | @media (prefers-reduced-motion: reduce) |

### formularz-page.css (19 of 63 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 65 | 419 | `.card-header.bg-transparent-blur` |  |
| 121 | 329 | `#editTab .btn-secondary-light:hover` |  |
| 147 | 326 | `#editTab .btn-secondary-light:active` |  |
| 139 | 283 | `#editTab .btn-secondary-light:focus-visible` |  |
| 202 | 260 | `.menu-home-link` |  |
| 75 | 246 | `.card-header.bg-transparent-blur .card-title` |  |
| 212 | 155 | `.menu-home-link:hover` |  |
| 157 | 142 | `#editTab .btn-secondary-light, #editTab .btn-secondary-light .btn-icon-badge` | @media (prefers-reduced-motion: reduce) |
| 303 | 142 | `.sidebar-menu-item:hover` |  |
| 30 | 140 | `.navbar-nav .btn:hover` |  |
| 195 | 139 | `.top-menu-container h4` |  |
| 162 | 138 | `#editTab .btn-secondary-light:hover, #editTab .btn-secondary-light:active` | @media (prefers-reduced-motion: reduce) |
| 130 | 128 | `#editTab .btn-secondary-light:hover .btn-icon-badge` |  |
| 135 | 108 | `#editTab .btn-secondary-light:focus` |  |
| 273 | 85 | `.sidebar-close:hover` |  |
| 191 | 75 | `.top-menu-container .container` |  |
| 26 | 70 | `.navbar-nav .btn` |  |
| 22 | 62 | `.tab-content.active` |  |
| 439 | 49 | `.navbar` |  |

### home-page.css (1 of 24 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 77 | 160 | `.stats-container h3` |  |

### intro-page.css (25 of 51 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 265 | 255 | `.user-row` |  |
| 241 | 242 | `.podium-base` |  |
| 200 | 214 | `.podium-avatar` |  |
| 209 | 207 | `.podium-place.first .podium-avatar` |  |
| 287 | 173 | `.user-avatar` |  |
| 280 | 153 | `.user-rank` |  |
| 229 | 149 | `.podium-name` |  |
| 323 | 133 | `.btn-start:hover` |  |
| 304 | 128 | `.user-score` |  |
| 183 | 108 | `.podium-place` |  |
| 275 | 104 | `.user-row:hover` |  |
| 145 | 103 | `.btn-prev:hover` |  |
| 216 | 97 | `.podium-place.second .podium-avatar` |  |
| 220 | 96 | `.podium-place.third .podium-avatar` |  |
| 224 | 90 | `.podium-rank` |  |
| 236 | 86 | `.podium-score` |  |
| 299 | 84 | `.user-name` |  |
| 249 | 74 | `.podium-place.first .podium-base` |  |
| 253 | 74 | `.podium-place.second .podium-base` |  |
| 257 | 73 | `.podium-place.third .podium-base` |  |
| 338 | 73 | `.podium-place` | @media (max-width: 768px) |
| 192 | 57 | `.podium-place.second` |  |
| 188 | 56 | `.podium-place.first` |  |
| 196 | 56 | `.podium-place.third` |  |
| 295 | 46 | `.user-info` |  |

### leaderboard-page.css (8 of 128 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 856 | 259 | `.activity-card` | @media (max-width: 359px) |
| 210 | 251 | `.leaderboard-title` |  |
| 219 | 190 | `.leaderboard-subtitle` |  |
| 563 | 146 | `.leaderboard-navbar .brand-logo-container img` | @media (max-width: 768px) |
| 145 | 137 | `.sidebar-item:hover` |  |
| 41 | 97 | `.brand-logo-container` |  |
| 124 | 85 | `.sidebar-close:hover` |  |
| 655 | 70 | `.leaderboard-title` | @media (max-width: 768px) |

### recipients-page.css (37 of 105 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 468 | 516 | `.recipients-page .navbar` |  |
| 508 | 502 | `.recipients-page .fab-main` |  |
| 578 | 498 | `.hamburger-menu-btn` |  |
| 741 | 438 | `.recipients-page .notification-bell-btn` |  |
| 62 | 389 | `.recipients-page .recipient-card` |  |
| 750 | 385 | `.recipients-page .notification-bell-btn::before` |  |
| 519 | 372 | `.recipients-page .fab-main::before` |  |
| 545 | 323 | `.recipients-page .aws-action-card .card-body` |  |
| 445 | 293 | `.recipients-page .card-header h5, .recipients-page .aws-content-header h5, .recipients-page .card-he` |  |
| 531 | 287 | `.recipients-page .fab-main:hover` |  |
| 362 | 277 | `.recipients-page #reservedPresentsModal .card-header[style*="fff3cd"] strong, .recipients-page #rese` |  |
| 374 | 277 | `.recipients-page #reservedPresentsModal .card-header[style*="d4edda"] strong, .recipients-page #rese` |  |
| 762 | 262 | `.notification-dropdown` |  |
| 492 | 235 | `.recipients-page .navbar .navbar-brand, .recipients-page .navbar .brand-text` |  |
| 733 | 227 | `.notification-bell-floating` |  |
| 461 | 215 | `.recipients-page .aws-action-title` |  |
| 538 | 196 | `.recipients-page .fab-main i` |  |
| 438 | 182 | `.recipients-page .card-header, .recipients-page .aws-content-header` |  |
| 357 | 181 | `.recipients-page #reservedPresentsModal .card-header[style*="fff3cd"]` |  |
| 369 | 181 | `.recipients-page #reservedPresentsModal .card-header[style*="d4edda"]` |  |
| 454 | 178 | `.recipients-page .card-header i, .recipients-page .aws-content-header i, .recipients-page .aws-gradi` |  |
| 688 | 169 | `.sidebar-item.active` |  |
| 778 | 159 | `.hamburger-menu-btn` | @media (max-width: 768px) |
| 566 | 152 | `.recipients-page .aws-action-card .card-body` | @media (max-width: 768px) |
| 498 | 142 | `.recipients-page .navbar i` |  |
| 91 | 138 | `.recipients-page .aws-main-content > .aws-content-header` |  |
| 559 | 137 | `.recipients-page .aws-action-title` |  |
| 682 | 137 | `.sidebar-item:hover` |  |
| 600 | 92 | `.hamburger-menu-btn i` |  |
| 487 | 89 | `.recipients-page .aws-action-section` |  |

### rezerwacje-page.css (6 of 18 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 53 | 121 | `.btn-cancel-res` |  |
| 45 | 113 | `.btn-buy` |  |
| 48 | 65 | `.btn-buy:hover` |  |
| 56 | 49 | `.btn-cancel-res *` |  |
| 57 | 47 | `.btn-cancel-res:hover` |  |
| 49 | 40 | `.btn-buy *` |  |

### styles.css (2273 of 2312 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 5643 | 1103 | `.profile-picture-placeholder` |  |
| 5650 | 873 | `:root` | @undefined undefined |
| 814 | 550 | `.sort-button` |  |
| 6462 | 550 | `.sort-button` |  |
| 17493 | 499 | `.notification-bell-floating .notification-dropdown` |  |
| 17452 | 457 | `.notification-bell-floating .notification-bell-btn` |  |
| 796 | 446 | `.search-input` |  |
| 6444 | 446 | `.search-input` |  |
| 3392 | 442 | `.profile-picture-placeholder-large` |  |
| 3457 | 442 | `.profile-picture-placeholder-large` |  |
| 3522 | 442 | `.profile-picture-placeholder-large` |  |
| 3587 | 442 | `.profile-picture-placeholder-large` |  |
| 3652 | 442 | `.profile-picture-placeholder-large` |  |
| 3717 | 442 | `.profile-picture-placeholder-large` |  |
| 3782 | 442 | `.profile-picture-placeholder-large` |  |
| 3847 | 442 | `.profile-picture-placeholder-large` |  |
| 3912 | 442 | `.profile-picture-placeholder-large` |  |
| 3977 | 442 | `.profile-picture-placeholder-large` |  |
| 4042 | 442 | `.profile-picture-placeholder-large` |  |
| 4107 | 442 | `.profile-picture-placeholder-large` |  |
| 4172 | 442 | `.profile-picture-placeholder-large` |  |
| 4237 | 442 | `.profile-picture-placeholder-large` |  |
| 4302 | 442 | `.profile-picture-placeholder-large` |  |
| 4367 | 442 | `.profile-picture-placeholder-large` |  |
| 4432 | 442 | `.profile-picture-placeholder-large` |  |
| 4497 | 442 | `.profile-picture-placeholder-large` |  |
| 4562 | 442 | `.profile-picture-placeholder-large` |  |
| 4627 | 442 | `.profile-picture-placeholder-large` |  |
| 4692 | 442 | `.profile-picture-placeholder-large` |  |
| 4757 | 442 | `.profile-picture-placeholder-large` |  |

### styles.deduped.min.css (146 of 373 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 5 | 347 | `.profile-picture-placeholder-large` |  |
| 5 | 335 | `.recipient-name .btn-outline-danger` |  |
| 5 | 275 | `.recipient-item .btn-group-vertical .btn` |  |
| 5 | 205 | `.recipients-page .action-btn.btn-warning` | @media (max-width:768px) |
| 5 | 202 | `.profile-picture-wrapper .fas.fa-user` |  |
| 5 | 202 | `.recipients-page .action-btn.btn-primary` | @media (max-width:768px) |
| 5 | 202 | `.recipients-page .action-btn.btn-success` | @media (max-width:768px) |
| 9 | 191 | `.present-item .d-flex.align-items-start.flex-wrap.flex-md-nowrap.w-100.gap-2` | @media (max-width: 576px) |
| 5 | 176 | `.profile-picture-wrapper .fas.fa-user,.profile-picture-wrapper img` |  |
| 5 | 173 | `.recipients-page .action-btn.btn-warning` |  |
| 5 | 172 | `.recipient-avatar img` |  |
| 5 | 170 | `.recipients-page .compact-card .card-body` | @media (max-width:575.98px) |
| 5 | 170 | `.recipients-page .action-btn.btn-primary` |  |
| 5 | 170 | `.recipients-page .action-btn.btn-success` |  |
| 5 | 161 | `.recipients-page .action-btn.btn-primary:hover` |  |
| 5 | 161 | `.recipients-page .action-btn.btn-warning:hover` |  |
| 5 | 161 | `.recipients-page .action-btn.btn-success:hover` |  |
| 5 | 160 | `.recipients-page .compact-card .btn-lg` | @media (max-width:575.98px) |
| 5 | 156 | `#recipientSelectionModal .list-group-item` |  |
| 5 | 152 | `.recipients-page .compact-card .card-body` |  |
| 5 | 150 | `.recipient-item .btn-group-vertical>.btn:last-child,.recipient-item .btn-group-vertical>.btn:only-ch` |  |
| 5 | 145 | `.present-item .btn-outline-danger:hover,.present-item .btn-outline-primary:hover` |  |
| 5 | 145 | `.recipients-page .present-item .d-flex.align-items-center.justify-content-between` | @media (max-width:575.98px) |
| 5 | 143 | `.present-item .btn-group-vertical .btn` |  |
| 5 | 141 | `.recipients-page .present-item .d-flex.align-items-center.justify-content-between` | @media (min-width:768px) |
| 5 | 141 | `#recipientSelectionModal .list-group-item:hover` |  |
| 5 | 138 | `.form-check-input` |  |
| 5 | 135 | `.recipients-page .action-btn` |  |
| 1 | 134 | `.login-body h4` |  |
| 5 | 131 | `.recipients-page .action-btn` | @media (max-width:768px) |

### ustawienia-page.css (1 of 11 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 37 | 278 | `.profile-pic` |  |

### wiadomosci-page.css (6 of 32 rules uncovered)

| Line | Bytes | Selector | Context |
|---|---|---|---|
| 117 | 319 | `.link-preview-card` |  |
| 134 | 259 | `.link-preview-card .lp-title` |  |
| 127 | 155 | `.link-preview-card img` |  |
| 139 | 153 | `.link-preview-card .lp-domain` |  |
| 114 | 56 | `.chat-bubble.from-them a` |  |
| 133 | 51 | `.link-preview-card .lp-body` |  |

## Appendix B. Dead-rule report for `styles.deduped.min.css` (REPORT ONLY, never removed: it is a frozen/generated artifact)

Crude static criterion (the Phase C idea, without its safelist review): a rule is "dead by token" if, for every selector in its list, at least one class or id token appears nowhere in the usage corpus (163 text files under public/, server.js, routes/, lib/, scripts/, tests/, plus 10 cached CDN files) and matches no dynamic prefix/suffix. Dynamic prefixes found by the crude scan: `alert-`, `e2e-cue-`, `editComments-`, `editTitle-`, `lp-`, `notif-`, `recipient-`, `thread-`; suffixes: `-collapse`. Result: **36 of 373 rules, 4,050 B**.

| Line | Bytes | Selector | Unused tokens |
|---|---|---|---|
| 5 | 59 | `.recipients-page .compact-card` | compact-card |
| 5 | 169 | `.recipients-page .compact-card .card-body` | compact-card |
| 5 | 91 | `.recipients-page .compact-card .btn-lg` | compact-card |
| 5 | 59 | `.recipients-page .compact-card .text-muted` | compact-card |
| 5 | 52 | `.recipients-page .action-btn .btn-text` | action-btn, btn-text |
| 5 | 63 | `.recipients-page .action-btn i` | action-btn |
| 5 | 159 | `.recipients-page .compact-card .btn-lg` | compact-card |
| 5 | 89 | `.recipients-page .row .col-4:nth-child(3) .compact-card .card-body` | compact-card |
| 5 | 78 | `.recipients-page .compact-card .card-body` | compact-card |
| 5 | 130 | `.recipients-page .action-btn` | action-btn |
| 5 | 52 | `.recipients-page .action-btn .btn-text` | action-btn, btn-text |
| 5 | 55 | `.recipients-page .action-btn i` | action-btn |
| 5 | 201 | `.recipients-page .action-btn.btn-primary` | action-btn |
| 5 | 204 | `.recipients-page .action-btn.btn-warning` | action-btn |
| 5 | 201 | `.recipients-page .action-btn.btn-success` | action-btn |
| 5 | 111 | `.recipients-page .compact-card` | compact-card |
| 5 | 99 | `.recipients-page .compact-card:hover` | compact-card |
| 5 | 151 | `.recipients-page .compact-card .card-body` | compact-card |
| 5 | 134 | `.recipients-page .action-btn` | action-btn |
| 5 | 57 | `.recipients-page .action-btn:hover` | action-btn |
| 5 | 64 | `.recipients-page .action-btn:focus` | action-btn |
| 5 | 169 | `.recipients-page .action-btn.btn-primary` | action-btn |
| 5 | 172 | `.recipients-page .action-btn.btn-warning` | action-btn |
| 5 | 169 | `.recipients-page .action-btn.btn-success` | action-btn |
| 5 | 99 | `.recipients-page .action-btn:hover` | action-btn |
| 5 | 160 | `.recipients-page .action-btn.btn-primary:hover` | action-btn |
| 5 | 160 | `.recipients-page .action-btn.btn-warning:hover` | action-btn |
| 5 | 160 | `.recipients-page .action-btn.btn-success:hover` | action-btn |
| 5 | 78 | `.recipients-page .compact-card` | compact-card |
| 5 | 107 | `.recipients-page .compact-card .card-body` | compact-card |
| 5 | 82 | `.present-item.smooth-slide-up` | smooth-slide-up |
| 5 | 86 | `.present-item.smooth-slide-down` | smooth-slide-down |
| 5 | 71 | `.present-item.fading` | fading |
| 5 | 92 | `.present-item.smooth-slide-up` | smooth-slide-up |
| 5 | 96 | `.present-item.smooth-slide-down` | smooth-slide-down |
| 5 | 71 | `.present-item.fading` | fading |

The full unfiltered lists for both appendices are in `$env:TEMP\css-consolidate-1\css-audit\analyze.json` (uncovered rules per file, dead-by-token list) and `drift.json` (drift report); `$env:TEMP\css-consolidate-1\coverage.json` has the merged used ranges per file for Phase C cross-checks.


## Phase C addendum (after dead and duplicate rule removal)

The uncovered-rule lists in the sections above were produced from the pre-Phase-C files, so their line numbers no longer match files that Phase C edited (see `css-dead-rules-removed.txt` for the removed rules per file, with the original line numbers).
Rules that runtime coverage never matched but that still pass the static criterion (some class/id token is used, or the rule is protected by a policy keep) were REPORTED only and left in place: 1,015 rules / 150,183 bytes across the 18 hand-written files (aws-design.css 372, styles.css 439, recipients-page.css 34, bottom-tab-bar.css 34, filters.css 37, remaining files 99). The totals and per-file counts are at the end of `css-dead-rules-removed.txt`.
Unreferenced `@keyframes` in hand-written files (reported, never removed): filters.css `highlightPulse`; aws-design.css `pulse-notification`, `spinner-rotate`, `dropdown-slide-in`, `fade-out`.
