# CSS consolidation: implementation and tooling design (phases A-D)

Worktree (ALL edits happen here, relative paths land in the wrong repo):
`W = c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\css-consolidate-1`, branch `refactor/css-consolidate-1`, HEAD `e939a28` (base `bc8be84`).
Parent workspace (plan, FEAT files, gate file only): `P = c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty`.
Windows + PowerShell: chain with `;`, never `&&`. Never `git push`, never `cr`. Commit locally, stage files by name.

This plan is conservative on purpose: a missing style is a user-visible bug. Whenever evidence is not conclusive, KEEP.

---------------------------------------------------------------------------------------------------

## 0. What exploration found (facts the coder must not rediscover)

### 0.1 Stylesheets per page (link order, verbatim from `public/*.html`; CDN sheets first on every page)

| Page | Local sheets in load order |
|---|---|
| activity | styles.deduped.min.css, aws-design.css (no ?v), bottom-tab-bar.css?v=42, app-theme.css?v=14, [inline critical style], activity-page.css?v=1 |
| archiwum | styles.deduped.min.css, app-theme.css?v=14, archiwum-page.css?v=1 |
| formularz | styles.deduped.min.css, bottom-tab-bar.css?v=42, app-theme.css?v=14, [inline], formularz-page.css?v=1, formularz-page-edit.css?v=1 |
| home | styles.deduped.min.css, bottom-tab-bar.css?v=42, app-theme.css?v=14, home-page.css?v=1 |
| index | styles.deduped.min.css |
| intro | intro-page.css?v=1 (no styles.*) |
| leaderboard | **styles.css (raw)**, bottom-tab-bar.css?v=42, app-theme.css?v=14, [inline], leaderboard-page.css?v=1 |
| maintenance | none (inline `<style>` only) |
| osoby | styles.deduped.min.css, app-theme.css?v=14, osoby-page.css?v=1 |
| recipients | styles.deduped.min.css, aws-design.css?v=4, bottom-tab-bar.css?v=42, app-theme.css?v=14, filters.css?v=7, [inline], recipients-page.css?v=1 |
| register | styles.deduped.min.css |
| rezerwacje | styles.deduped.min.css, bottom-tab-bar.css?v=42, app-theme.css?v=14, rezerwacje-page.css?v=1 |
| ustawienia | styles.deduped.min.css, bottom-tab-bar.css?v=42, app-theme.css?v=14, ustawienia-page.css?v=1 |
| wiadomosci | styles.deduped.min.css, bottom-tab-bar.css?v=42, app-theme.css?v=14, chat-reactions.css?v=3, wiadomosci-page.css?v=1 |

Out of scope pages: `bottom-tab-bar-snippet.html`, `tab-bar-demo.html` (but their class tokens still count as USAGE in Phase C).
Pre-existing oddities to REPORT, not fix: `aws-design.css` is requested as `aws-design.css?v=4` (recipients) and `aws-design.css` (activity), sw.js precaches the unversioned URL; sw.js does not precache `bottom-tab-bar.css`, `app-theme.css`, `filters.css`, `styles.css`.

### 0.2 Sizes (working tree, CRLF; git blobs are LF and ~1 byte/line smaller)

styles.css 437,177 B (15.5k lines, 2,312 rules) | aws-design.css 114,692 | styles.deduped.min.css 40,148 (35 lines) | bottom-tab-bar.css 26,165 | app-theme.css 14,403 | filters.css 13,023 | chat-reactions.css 12,051 | *-page.css 15 files, 1.7-30.7 KB each (formularz-page-edit 30,720; recipients-page 29,568; leaderboard-page 23,853).

### 0.3 styles.deduped.min.css is NOT reproducible today (measured)

- No npm script builds it. `postcss.config.js` (PurgeCSS 4 with content globs `./public/**/*.html`, `./public/**/*.js`, `./public/**/*-page*.css`, then cssnano default) is the only tool config; the implied command is `npx postcss public/styles.css -o <out>`. `postcss-cli`, `@fullhuman/postcss-purgecss`, `cssnano`, `postcss` are devDependencies only; `Dockerfile` runs `npm install --only=production`, `render.yaml` runs `npm install`, `vercel.json` routes everything to server.js: **no deploy step builds CSS, so the generated file must stay committed**.
- Git archaeology: created in `af170e2` (2025-07-08, "css", together with `public/styles.purged.css`, since deleted), touched later in `8d441c7`, `026f853`, and `072bc5d` (2026-10-09), where ONE token was changed by hand in the minified file (the `.recipient-item .btn-outline-success:hover` line) while styles.css lost 12 duplicate lines. `:root --ios-success` is `#00693E` in the deduped file and `#34c759` in styles.css.
- A probe run (`npx postcss public/styles.css -o %TEMP%\css-probe\out.css`) gave 35,231 B vs the committed 40,148 B, SHA-256 differs. Rule-level comparison (selector+context keyed, CRLF normalised): 290 identical, 13 same selector with different declarations (including `:root`), 65 rules only in the committed file, 29 only in the regenerated one. **Expect Phase B to take the "frozen" fallback (section B.6) unless the snapshot proof says otherwise.** Do not pre-judge it: run the proof.
- `.gitattributes` absent, `core.autocrlf=true`: working tree is CRLF, git blobs are LF, and committed selectors contain `\r\n` in the working copy. **Every comparison/build must normalise CRLF to LF before hashing or parsing, and generated files must be written with LF.**
- `.container { overflow-x: hidden }` exists at `public/styles.css` lines ~1400 and ~7044 (identical blocks, 5,600 lines apart) and in the minified deduped file (`.container{margin:0 auto;max-width:1200px;overflow...`). `app-theme.css:250` has an unrelated `.container{max-width:100% !important}` inside `@media (max-width:991.98px)`; `formularz-page.css:231` sets `margin-top` only.
- A first probe of Phase C (crude word-set test, to size the work, NOT the final algorithm): styles.css has **1,771 exact-duplicate rules (~300 KB of 437 KB)** and ~172 dead-by-token rules; aws-design.css ~96 dead-by-token and 9 duplicates; filters.css ~27 dead; bottom-tab-bar.css 2; app-theme.css and chat-reactions.css 0. Duplicates dominate the savings; they mostly affect leaderboard.html (the only raw-styles.css consumer) and any future regeneration.
- `server.js:57-70` serves `.css`/`.js` with `Cache-Control: no-cache, must-revalidate`, so `?v=` only matters for the service worker (cache-first for non-HTML, keyed by full URL incl. query).
- `public/sw.js`: `CACHE_NAME = 'prezenty-v125'`; `urlsToCache` contains `/styles.deduped.min.css`, `/aws-design.css`, `/chat-reactions.css` (unversioned) and every `/<page>-page*.css?v=1`.
- Edge channel: `C:\Program Files (x86)\Microsoft\Edge\Application\154.0.4258.62` and `155.0.4283.45` (Chromium >= 90 so `overflow: clip` exists). Playwright 1.61.0, `channel: 'msedge'`, workers 1, demo server via `tests/helpers/start-demo-server.js`, CDN responses cached in `tests/.cache/cdn/*.bin|.json` (git-ignored; if missing in the worktree copy `P\tests\.cache`).
- Baseline: commit `e939a28` holds `.agents/tasks/tmp-css-snapshot.js` and `.agents/tasks/css-baseline/*.json` (56 files = 14 pages x 4 viewports 320x640, 375x812, 768x1024, 1024x768; computed styles of 35 properties for every element and `::before/::after` with content, plus document scroll size; extra states `composer-add-mode`, `composer-toggled` on formularz and `own-presents-expanded`, `edit-sheet-open` on recipients). Two captures were byte-identical. Known caveat from the previous task: `activity` data is clock-relative; if ONLY activity differs by element count, re-capture the baseline from the phase-start commit (section 4.4) instead of masking.
- `main` is at `a5f6015` (test-only changes: composer spec split into `tests/e2e/composer-*.spec.js`); CACHE_NAME on main is still v125. The sibling task `refactor/split-recipients-1` will touch recipients files and probably sw.js, so sw.js is edited ONCE, last.

### 0.4 Wording used below

- **Source** = hand-written, edited by people. **Generated** = produced by a tool from sources, never hand-edited. **Frozen artifact** = committed file whose generator cannot reproduce it (the likely status of styles.deduped.min.css).
- `TMP` = `$env:TEMP\css-consolidate-1` (outside the repo; all snapshot dirs, coverage JSON, logs go here). Temporary scripts live untracked at `W\.agents\tasks\tmp-css-*.js`. Deliverable docs live in `W\.agents\tasks\` and are committed.

---------------------------------------------------------------------------------------------------

## 1. Global rules

1. Phases run strictly in order A, B, C, D, then finalisation. Each phase ends with its own verification and its own commit(s); each CSS-changing phase must leave the tree green before the next starts.
2. **Never change `<link rel=stylesheet>` ORDER** on any page. `?v=` edits are allowed only per F.1 (section 8).
3. Never hand-edit `public/styles.deduped.min.css`. It may change only through `scripts/build-css.js` (Phase B) and only if the proof passes.
4. CSS edits to CRLF working files: use a Node script with postcss (`postcss.parse(css)`, `node.remove()`, `root.toString()`), read as a string, detect CRLF with `/\r\n/.test(text)`, and write back with the SAME line endings (`fs.writeFileSync(f, out)`; if the file was CRLF, `out.replace(/\r?\n/g, '\r\n')`). Never use PowerShell `Set-Content`/`-replace` on CSS. After each edit run `git -P diff --stat` and make sure only intended files changed and no whole-file line-ending churn shows.
5. Out of scope: redesigning styles, renaming classes, switching methodology, touching JS logic, splitting recipients.js, server code, tests code (`tests/` diff must be empty), `package-lock.json`.
6. Allowed non-CSS changes: `package.json` scripts, `postcss.config.js`, `scripts/build-css.js`, `public/CSS-README.md`, HTML `<link>` `?v=` numbers (F.1), `public/sw.js` (F.1), the docs under `.agents/tasks/`.
7. Commit messages: Conventional Commits, imperative, subject <= 50 chars, body explains why. No SIM exists, omit the `sim:` footer. Build/verify before each commit (here: the phase's snapshot compare plus `node --check` on touched JS; Brazil does not apply to this repo).
8. If a phase's proof fails and cannot be explained, revert that phase's commit(s) with `git revert` (new commit) or `git reset --soft` only for unpushed local commits, report why, and continue with the next independent phase.

---------------------------------------------------------------------------------------------------

## 2. Temporary tooling (written by the coder, untracked, deleted at the very end)

All under `W\.agents\tasks\`. They reuse the `require` style of `tmp-css-snapshot.js` (`@playwright/test`, `../../tests/helpers/start-demo-server`, `cdn-cache`, `pages`).

| Script | Purpose |
|---|---|
| `tmp-css-compare.js <dirA> <dirB> [--allow overflow-container]` | Compares two snapshot dirs. For every `<page>@WxH.json`: same file set, same `states` list, same `scroll`/`count`, then element-by-element (`path` must match at the same index, then each style prop). Prints per page counts, then the first 40 differing cells as `page@vp state path prop: A -> B`. Exit 0 only with zero diffs. `--allow overflow-container` ignores exactly: `overflow-x` `hidden`->`clip` and `overflow-y` `auto`->`visible` on elements whose path's LAST segment has the class `container` (`.container` token in `describe()` output), and nothing else. Used only by Phase D. |
| `tmp-css-coverage.js` | Phase A coverage driver (section A.4). |
| `tmp-css-transfer.js <out.json>` | For `recipients` and `leaderboard` at 375x812: load the page in demo mode, collect every same-origin `stylesheet` response; record URL, decoded bytes (`(await response.body()).length`), and transferred body bytes (`(await response.request().sizes()).responseBodySize`); also report gzip -6 size via `zlib.gzipSync`. CDN sheets listed separately and excluded from totals. |
| `tmp-css-dyn.js` | Phase B/C dynamic class-name scanner (section B.3). Writes `TMP\dyn-prefixes.json`. |
| `tmp-css-candidates.js` | Phase C candidate lister (section C.3). Writes `TMP\candidates.json` and `.md`. |
| `tmp-css-apply.js <approved.json>` | Removes the approved rules (by file + 1-based start line + selector + content hash) while preserving raws and EOLs. |
| `tmp-css-rulecheck.js <file> <beforeRef> <approved.json>` | Parses `git show <beforeRef>:<file>` (LF) and the working file; asserts `after == before minus approved` as ordered rule lists (context chain + selector + normalised declarations), and that no at-rule block disappeared except those that became empty. Exit 1 otherwise. |
| `tmp-css-snapshot-lb.js <outDir> [--css-swap deduped]` | Leaderboard-only copy of the harness with extra states read from `leaderboard.html`/`leaderboard-page.js` (period/tab toggles, any modal, the empty/error states reachable in demo mode, scrolled to bottom). `--css-swap deduped` intercepts nothing: it serves a TEMP copy of `leaderboard.html` with the `styles.css` link replaced by `styles.deduped.min.css` (route the HTML response with `context.route`, no file edits). |

Snapshot dirs: `TMP\snap-<label>` created with `node .agents\tasks\tmp-css-snapshot.js "$env:TEMP\css-consolidate-1\snap-<label>"` (run from W). Never overwrite `W\.agents\tasks\css-baseline`.

---------------------------------------------------------------------------------------------------

## 3. PHASE A: audit (no CSS change), output `W\.agents\tasks\css-audit.md`

A.1 Sanity: `git -P status --short` clean; `node --version`; Edge present; `npm ls @playwright/test` = 1.61.0. Capture `snap-A0` and run `tmp-css-compare.js .agents\tasks\css-baseline snap-A0`: must be 0 diffs (proves harness determinism on this machine today). If only `activity` differs, recapture per 4.4.

A.2 Stylesheet inventory table, for every in-scope page (14 pages: activity, archiwum, formularz, home, index, intro, leaderboard, maintenance, osoby, recipients, register, rezerwacje, ustawienia, wiadomosci): ordered list incl. CDN sheets and inline `<style>` (byte count each), `?v=`. Produce it by parsing the HTML (`<link rel=stylesheet>` and `<style>`), not by hand, and cross-check against section 0.1.

A.3 Per-stylesheet table: bytes (working tree and `git cat-file -s HEAD:path`), lines, rule count (postcss), hand-written vs generated vs frozen, generator, and which pages load it (reverse index). Then a subsection **"How styles.deduped.min.css is produced"** with: the exact command (`npx postcss public/styles.css -o <out>` with `postcss.config.js`), tool versions from `node_modules` (`postcss`, `@fullhuman/postcss-purgecss`, `purgecss`, `cssnano`, `postcss-cli`, `browserslist`/`caniuse-lite` age), inputs (content globs, extractor), safelist (none before this task), whether committed (yes), git history (the commits in 0.3, plus what `af170e2` and the deletion of `styles.purged.css` show: `git log --follow --stat`, `git show af170e2 --stat`), and the **drift report**: rebuild into `TMP\css-audit\regen.css` (twice, assert identical SHA-256 = deterministic), diff with `git show HEAD:public/styles.deduped.min.css` using a throwaway rule-level differ (selector+context keyed, CRLF normalised): counts of identical / changed declarations / only-committed / only-regenerated, plus the full list of changed declaration rules (selector, committed value, regenerated value) and the first 40 only-in-one-side selectors. State in one sentence whether the file is in sync.
Also: "which pages use raw vs deduped and why": `git log -S"styles.css" --format="%h %ad %s" -- public/leaderboard.html` and `-S"styles.deduped.min.css"` per page, quote the commit that introduced each link, say "reason not recorded" if the history does not give one (do not invent).
Also verify and record: Dockerfile/render.yaml/vercel.json/.dockerignore consequences (0.3), the sw.js precache vs page URL mismatches (0.1), `server.js` cache headers.

A.4 Real coverage (`tmp-css-coverage.js`). Chromium only: `chromium.launch({ channel: 'msedge', headless: true })`, context options as in the snapshot harness (`serviceWorkers: 'block'`, `reducedMotion: 'reduce'`, `storageState` from demo login `e2e/e2e`, `installCdnCache`). Per page: `await page.coverage.startCSSCoverage({ resetOnNavigation: false })`, `openPage`, wait for layout settled, run the interactions, `const cov = await page.coverage.stopCSSCoverage()`.
- Viewports: 375x812 and 1024x768, every in-scope page (public-only pages index/intro/register/maintenance without auth, others with it).
- Interactions: read EVERY `tests/e2e/*.spec.js` and `tests/helpers/*.js` first and replay the user-visible state transitions they perform on the real pages (not their assertions): at least formularz composer add mode + toggle + shared dock states, recipients own-presents expand + edit sheet + filters/search + notification bell/panel, wiadomosci chat reactions picker, activity notifications, home sidebar/tab bar toggles, ustawienia toggles, osoby/archiwum/rezerwacje list expand, leaderboard tabs/modals, scroll to bottom on every page, open every Bootstrap modal/collapse reachable in demo mode, `:hover`/`:focus-visible` on the first button of each page via `page.hover`/`keyboard.press('Tab')`. List what was replayed in the audit.
- Accumulate per URL (strip the query string, ignore CDN hosts): the union of used ranges over all runs. Entries give `{url, text, ranges:[{start,end}]}`; ranges index into `text`; assert `text` identical across runs of the same URL (else record per-variant). Merge intervals, `used = sum`, `unused = text.length - used`. Inline `<style>` entries have no URL: report per page separately as `inline@page`.
- Output per file: total bytes (as served = CRLF), used, unused, % unused; also per page (which pages touch which file) and per viewport. Save raw JSON to `TMP\coverage.json` and the summary table into `css-audit.md`. Write one paragraph stating the limit: coverage only sees rules matched by elements that existed during the run; classes added later by JS (status badges, error states, modals not opened, hover/focus/media states not reached, `prefers-color-scheme`) look unused, so **uncovered rules are REPORTED, never removed**, and Phase C uses the stricter static criterion.
- Also list the top 30 uncovered rules per file by bytes (selector + line) as a "report only" appendix, and keep `TMP\coverage.json` for Phase C cross-checks.

A.5 Record the current transfer baseline: `tmp-css-transfer.js TMP\transfer-before.json`; paste before-bytes per CSS file and total CSS for recipients.html and leaderboard.html into css-audit.md (these numbers are the "before" side of the final report; css-audit.md is committed so they survive).

A.6 Baseline e2e (only if main/HEAD changed since the last known green): `npm test *> TMP\e2e-before.txt` (about 8-10 min). Expectation on this base: **121 passed, 0 failed, 11 skipped**. Record counts. If different, that number is the reference for the rest of the task.

A.7 Commit only `.agents/tasks/css-audit.md`: `docs(css): add stylesheet audit and coverage report`.

Verification A: `git -P diff --stat HEAD~1` shows only css-audit.md; baseline compare 0 diffs; audit contains every table above.

---------------------------------------------------------------------------------------------------

## 4. Verification protocol (applies to B, C, D and finalisation)

4.1 After every CSS-changing step (B regeneration/switch, each C file commit, D): from W run `node .agents\tasks\tmp-css-snapshot.js "$env:TEMP\css-consolidate-1\snap-<label>"` then `node .agents\tasks\tmp-css-compare.js .agents\tasks\css-baseline "$env:TEMP\css-consolidate-1\snap-<label>"`.
- B and C: **ZERO diffs**, exit 0.
- D: diffs only via `--allow overflow-container` (and exit 0 with it); the plain compare must show diffs ONLY of that kind (the coder prints both).
- For D the baseline must be the post-C snapshot (`snap-C-final`), not the original; C's own result is already proven zero versus the original.
4.2 Any other diff blocks the phase. "Explained" means: pinned to a root cause AND shown to be invisible (e.g. a transient class, the activity clock issue handled per 4.4). A diff caused by a changed visible style is never "explained away": revert the offending change or take the fallback of that phase.
4.3 Also required per phase: rule-set proof for C (`tmp-css-rulecheck.js`), `node --check` for any touched JS (none expected), and the targeted e2e canary `npm run test:e2e -- smoke wrapping no-horizontal-overflow a11y` (about 2-3 min) after each CSS-changing commit. Leaderboard-specific proof: `tmp-css-snapshot-lb.js` before vs after (baseline for it is captured ONCE at the start of Phase B from the untouched tree into `TMP\snap-lb-before`).
4.4 Re-baselining rule (only when differences are provably clock-related): create `git worktree add "$env:TEMP\css-pristine" <phase-start-commit>`, junction `node_modules` into it, capture there into `TMP\snap-pristine-<phase>`, compare against that instead; delete the worktree (`git worktree remove`) afterwards. Never edit `css-baseline`.
4.5 Full suite before finalising (after D, with the sw bump applied): `npm test *> TMP\e2e-after.txt`. Expectation **121 passed, 0 failed, 11 skipped** (or the reference recorded in A.6). Failures block; do not edit tests.
4.6 Metrics for the final report: per CSS file before (`git cat-file -s e939a28:public/<f>`) and after (`git cat-file -s HEAD:public/<f>`), delta and %; gzip size of each; `tmp-css-transfer.js TMP\transfer-after.json` and a table "total local CSS for recipients.html / leaderboard.html: decoded and transferred, before vs after".
4.7 Results go to `W\.agents\tasks\css-consolidate-1-verification.md` (structure in section 8).

---------------------------------------------------------------------------------------------------

## 5. Phase B: single source of truth and reproducible build

B.1 Capture baselines from the untouched tree before editing anything: `snap-B0` is not needed (css-baseline is the baseline), but capture `TMP\snap-lb-before` with `tmp-css-snapshot-lb.js`.

B.2 `scripts/build-css.js` (NEW, tracked) + npm scripts in `package.json`:
- `"build:css": "node scripts/build-css.js"`, `"build:css:check": "node scripts/build-css.js --check"` (fallback variant in B.6).
- Behaviour: `process.chdir(repoRoot)` (globs are CWD-relative); read `public/styles.css` as a string, `replace(/\r\n/g, '\n')`; run `postcss(require('../postcss.config.js').plugins).process(css, { from: 'public/styles.css', to: 'public/styles.deduped.min.css', map: false })`; output string normalised to LF; write with `fs.writeFileSync(out, text)`. Flags: `--out <path>`, `--check` (build in memory, compare to `git`-independent file read with CRLF->LF; exit 1 and print a rule-level drift summary: counts + first 20 selectors; exit 0 if identical), `--report` (same print, exit 0). Prints source/output byte counts and SHA-256.
- Determinism: run twice, identical SHA-256; document that output also depends on the locked versions of `cssnano`/`browserslist`/`caniuse-lite` (package-lock.json pins them).

B.3 `postcss.config.js`: keep plugin order and `defaultExtractor`; change `content` to GLOBS only (no file lists): `./public/**/*.html`, `./public/**/*.js`, `./public/**/*-page*.css`, `./routes/**/*.js`, `./lib/**/*.js`, `./server.js` (server-built HTML strings). The `public/**/*.js` glob already covers `*-page.js` and the split recipients files after merge; do NOT enumerate them.
Add a PurgeCSS `safelist` with PATTERNS (PurgeCSS 4 syntax: `safelist: { standard: [...], deep: [...], greedy: [...] }`; confirm the option names in `node_modules/purgecss` before writing). Derivation (evidence first), via `tmp-css-dyn.js`, which scans `public/**/*.js`, `public/**/*.html`, `routes/**`, `lib/**`, `server.js`:
 1. `classList\.(add|remove|toggle|replace|contains)\(` arguments (literals and concatenations);
 2. `className\s*(\+?=)` and `setAttribute\(['"]class['"]`;
 3. `innerHTML`/template literals/`insertAdjacentHTML`/string concatenation containing `class=` with `${...}` or `+ x +` inside the class value;
 4. any string literal or template fragment ending in `-` or `_` directly followed by `+` or `${` (a PREFIX, e.g. `'btn-' + variant`, `` `status-${s}` ``), and fragments starting with `-`/`_` right after `${...}` (a SUFFIX);
 5. all `[class*=...]`, `[class^=...]`, `[class~=...]`, `[class$=...]`, `[id^=...]` substrings found in ANY local CSS (treat as prefix/infix);
 6. library-toggled names: every class token present in the cached Bootstrap 5.3.0 bundle JS, Bootstrap CSS, Font Awesome and Remixicon CSS (`tests/.cache/cdn/*.bin`, read `.json` siblings to find which URL each file is; treat as UTF-8 text) because Bootstrap JS adds `show`, `fade`, `collapsing`, `modal-open`, `modal-backdrop`, `was-validated` etc. at runtime.
 Output `TMP\dyn-prefixes.json` (`prefixes`, `suffixes`, `infixes`, `literalClassCalls` with file:line for review). Turn items 1-5 into regex PATTERNS under `safelist.greedy` (e.g. `/^btn-/`, `/^status-/`) and library toggles into `safelist.standard`/`greedy` patterns; every pattern gets a one-line comment naming the file:line that justified it. Prefer a pattern over a literal; if in doubt add the pattern.

B.4 `public/CSS-README.md` (NEW): table of every CSS file: role (source / generated / frozen), who loads it (pages in order), how to change it, and which files carry `?v=` and must be bumped plus the sw.js rule. Explain: how `styles.deduped.min.css` is produced (command, inputs, safelist), the CRLF/LF rule, that deploy never builds CSS so generated output stays committed, why leaderboard.html loads raw or deduped (B.5), the Phase C removal criterion in two sentences, and the rule "never hand-edit the generated file". Keep it factual and under ~150 lines. Cross-link from the root README.md with ONE line (the only README.md change).

B.5 Regeneration and proof:
 1. `npm run build:css -- --out "$env:TEMP\css-consolidate-1\regen.css"` (never straight into public/ yet). Compute drift vs committed (the A.3 numbers; recompute with the new config because globs/safelist changed).
 2. Temporarily copy regen.css over `public/styles.deduped.min.css` (LF) and run the 4.1 snapshot compare against `css-baseline`, PLUS `tmp-css-snapshot-lb.js` is irrelevant here (leaderboard does not load deduped).
 3. **Zero diffs** -> keep the regenerated file, verify `npm run build:css` is idempotent (second run leaves `git -P status` unchanged and `build:css:check` exits 0), and commit: `build(css): regenerate styles.deduped.min.css` (separate commit from the script commit).
 4. **Any diff** -> restore the committed file (`git checkout -- public/styles.deduped.min.css`) and go to B.6.

B.6 Frozen-artifact fallback (expected outcome unless B.5.3 passes):
 - Leave `public/styles.deduped.min.css` byte-identical to HEAD.
 - Package scripts become: `"build:css": "node scripts/build-css.js --out build/css/styles.deduped.min.css"` (the `build/` dir is git-ignored) and `"build:css:check": "node scripts/build-css.js --report"` (prints drift, exit 0). `build-css.js` REFUSES to write `public/styles.deduped.min.css` unless `--force` is passed, and its help text says why.
 - `CSS-README.md` states plainly: styles.deduped.min.css is a hand-patched derivative of an old styles.css build; regenerating changes N rules and M computed styles (list the top examples such as `--ios-success`), so it is the de facto source for the 10 pages that load it; reconciling that is a product decision, listed under "Decisions needed" in the verification report with the exact diff summary attached (`TMP` file copied into the report appendix).
 - Phase C and D consequences: C edits styles.css/aws-design.css/etc. only; D uses the override variant (D.3).

B.7 Leaderboard: deduped or raw? Evidence only:
 1. `tmp-css-snapshot-lb.js TMP\snap-lb-deduped --css-swap deduped` (the 4 viewports plus extra states) vs `TMP\snap-lb-before`; also run the full harness page `leaderboard` is already included.
 2. Zero diffs in every element/prop/state AND `npm run test:e2e -- smoke a11y wrapping no-horizontal-overflow` passes against a TEMP edit of `leaderboard.html` (revert the edit afterwards or keep it if switching) -> switch: change ONLY that `href` from `styles.css` to `styles.deduped.min.css`, no order change, update CSS-README.
 3. Otherwise keep raw `styles.css`, and record the top differing elements/props in the README ("why leaderboard stays on raw styles.css"). If B.5 fell back, the deduped file is the stale one, so a diff is likely; do not force it.
 4. If leaderboard switches, `styles.css` then has no page consumer and is only the generator input; say so in the README.

B.8 Commits: (1) `build(css): add reproducible CSS build script` (script, package.json scripts, postcss.config.js globs+safelist), (2) `docs(css): document CSS sources and generated files` (CSS-README.md, README.md one line), (3) regenerate commit only if B.5.3, (4) leaderboard link commit only if B.7.2 (one line).
Verification B: 4.1 compare zero diffs after every commit that touches a served file, `build:css` determinism, `npm run test:e2e -- smoke` canary.

---------------------------------------------------------------------------------------------------

## 6. Phase C: dead and duplicate rule removal

Scope: HAND-WRITTEN files only: `styles.css`, `aws-design.css`, `app-theme.css`, `bottom-tab-bar.css`, `filters.css`, `chat-reactions.css`, `*-page.css`. NEVER `styles.deduped.min.css` (report its dead rules in css-audit.md appendix instead).

C.1 Usage corpus (everything is searched as plain text, case-sensitive): `public/**/*.{html,js,json,webmanifest}` (all files, including tab-bar-demo.html, bottom-tab-bar-snippet.html, sw.js), `server.js`, `routes/**`, `lib/**`, `scripts/**`, `tests/**` (all text files incl. helpers/specs), and the third-party text from `tests/.cache/cdn` (Bootstrap JS/CSS, Font Awesome, Remixicon: their class names are toggled or injected by libraries). A token T (class or id name without `.`/`#`) is USED if the corpus matches `(?<![A-Za-z0-9_-])T(?![A-Za-z0-9_-])`, OR T starts with any dynamic PREFIX or ends with any dynamic SUFFIX or contains any INFIX from `dyn-prefixes.json` (B.3: if `btn-` is built dynamically, every `btn-*` is used), OR T appears inside any inline `style`/`class` attribute text in HTML.

C.2 Removal rule: a rule is a DEAD candidate only if ALL hold:
 - Its context chain is root or `@media`/`@supports` only (never inside `@keyframes`, `@font-face`, `@page`, `@layer`, unknown at-rules).
 - It has at least one class/id token, and EVERY class/id token of EVERY comma-separated selector (including inside `:not()`, `:is()`, `:where()`, `:has()`) is not USED. A single USED token anywhere keeps the whole rule (do not trim selector lists).
 - All selectors parse with `postcss-selector-parser` (available transitively under node_modules; it is a temp-script helper, do not add it to package.json). Selectors with escapes, `\`, or parse errors: KEEP.
 - It does not declare a custom property `--x` that is referenced by `var(--x)` anywhere (local CSS, HTML inline styles, JS strings). `:root` custom properties are never removed.
 - Attribute selectors do not count as tokens, but a rule whose selector contains `[class*=…]`-style attribute selectors is KEPT.
 KEEP always: `@font-face`, every `@keyframes` (report unreferenced ones, do not remove), `@import`, `@charset`, `:root`/`html`/`body` rules, rules without class/id tokens.
 Inside `@media`/`@supports`: remove inner rules individually under the same criterion; delete the at-rule block only if it becomes empty. Never delete a non-empty block.

C.3 `tmp-css-candidates.js`: for each hand-written CSS file parse the file AS SERVED (CRLF, so offsets line up with coverage) and emit candidates with `{file, line, endLine, bytes, category, selector, tokens, usedBecause?, coverage}` where category is `DEAD`, `DUP` (C.4) or `REPORT-UNCOVERED` (rules uncovered in `TMP\coverage.json` that failed the static criterion; report only). Cross-check: if a `DEAD` rule is covered by runtime coverage it was matched at runtime, so a dynamic name exists that the scanner missed: flag it `CONFLICT`, KEEP it, and add the missing prefix to the safelist/dyn list. Flag as `REVIEW` (default KEEP unless the coder reads the surrounding code and confirms) any candidate where: the token also appears in a comment or in a markdown/doc file only; the token is a near-match of a used token (edit distance <= 2 or same stem, e.g. `-item` vs `-items`); the rule sits next to used siblings of the same component; the token was used in the git history within the last 60 days (`git log -S<token> --since=60.days -- public`).
Output both a machine file (`candidates.json`) and a readable `candidates.md` grouped by file, sorted by line.

C.4 Duplicates (`DUP`): rule B is a duplicate of an earlier rule A when they are in the same file, have the identical context chain (same at-rule names and params, same nesting), identical selector text (whitespace-collapsed) and identical declaration list (same props, values, `!important`, order). **Remove the EARLIER copy A and keep the last one.** Why this is cascade-safe even with intervening conflicting rules: the kept copy B has the same specificity as A, comes later, and declares every property A declares with the same values and priority. So B overrides A on every element and property, which means A never contributes a winning declaration; removing A cannot change any computed value. (Removing the LATER copy would be unsafe when a conflicting rule sits between them, which is why only the earlier copy goes.) Cross-file order is unaffected because both copies sit in the same file. Do NOT treat as duplicates: `@font-face`, `@keyframes`, rules whose declaration lists differ in any way, rules whose selectors differ by whitespace in a way postcss cannot normalise, and anything you are unsure about (KEEP). Whole duplicated `@media` blocks collapse naturally rule by rule; remove the earlier at-rule block only when it becomes empty.
Before relying on this, check that no JS or test reads rules by index: `git -P grep -n -E "cssRules|styleSheets|insertRule|deleteRule|adoptedStyleSheets" -- public tests routes lib server.js` must show nothing relevant (if it does, KEEP all duplicates in the files involved and report).

C.5 Process:
 1. Run `tmp-css-dyn.js` and `tmp-css-candidates.js`; read `candidates.md` end to end. Decide per entry, writing `TMP\approved.json` (list of `{file, line, selector, hash, category}`) and `TMP\kept-review.md` (REVIEW/CONFLICT items kept, one-line reason each). The coder must actually look at the REVIEW entries.
 2. One file at a time, in this order: `chat-reactions.css`, `app-theme.css`, `bottom-tab-bar.css`, `filters.css`, each `*-page.css`, `aws-design.css`, `styles.css` (largest last). For each file: apply with `tmp-css-apply.js`, run `tmp-css-rulecheck.js <file> HEAD <approved.json filtered to the file>`, run the 4.1 snapshot compare (zero diffs; leaderboard extra states via `tmp-css-snapshot-lb.js` vs `TMP\snap-lb-before` for styles.css and leaderboard-page.css, and for files leaderboard loads), run the e2e canary (4.3), then commit that file alone: `refactor(css): remove dead rules from <file>`. If a file's compare shows ANY diff, `git checkout -- <file>`, bisect the approved list by halves, keep the offending rules, record them in kept-review.md.
 3. Record removals in `W\.agents\tasks\css-dead-rules-removed.txt` (tracked), format: header with totals, then per file a section `== <file>: <n> rules, <bytes> bytes saved (before X -> after Y)` followed by lines `DEAD|DUP  L<line>  <selector (<=160 chars)>  [<bytes> B]  [<context>]`. Include a final table of bytes saved per file and a section `KEPT (REVIEW/CONFLICT)` and `REPORTED uncovered, not removed` with counts only (full list stays in css-audit.md).
 4. Commit `css-dead-rules-removed.txt` and the per-file commits' summary in `docs(css): record removed CSS rules` after all files.
 5. Save the final snapshot as `TMP\snap-C-final` (needed for D).

Verification C: for every commit zero snapshot diffs; rulecheck exit 0; canary e2e green; `git -P diff --stat e939a28..HEAD -- public/styles.deduped.min.css` empty unless Phase B regenerated it.

---------------------------------------------------------------------------------------------------

## 7. Phase D: `.container { overflow-x: hidden }` (separate commit, easy to revert)

Why: `overflow-x: hidden` with `overflow-y: visible` computes `overflow-y: auto`, so every `.container` becomes a scroll container that silently clips and can capture sticky positioning.

D.1 Locate (post-C line numbers differ): `Select-String -Path public\*.css -Pattern 'overflow-x:\s*hidden'` then narrow to `.container` rules, in styles.css (the two identical blocks, one may be gone after C) and the minified deduped file. Also list every other rule that targets `.container` (app-theme.css:250 and formularz-page.css:231) to confirm none sets overflow.
D.2 Pre-checks, before editing: (a) in Edge: `CSS.supports('overflow-x','clip')` is `true` and print `browser.version()` (the test channel); (b) with `getComputedStyle` check that for `overflow-x: clip` + default `overflow-y` the computed `overflow-y` is `visible`; (c) BFC difference to look for: `overflow: hidden/auto` makes `.container` a block formatting context (contains floats, stops margin collapse between `.container` and its first/last child); `clip` does NOT, so possible side effects are collapsed margins (e.g. `.container > .mt-4`/`h1` top margins) and uncontained floats; (d) enumerate, per page and viewport, descendants of `.container` with computed `position: sticky` (and ancestors up to the container). A sticky element currently sticks to the container (non-scrolling), after the change it would stick to the viewport: that is a behaviour change, so if (d) finds any, DROP the phase unless it is the intended outcome shown by the e2e specs (report either way).
D.3 Change:
 - Source variant (default, always): in every HAND-WRITTEN `.container` block that has `overflow-x: hidden`, write `overflow-x: hidden;` followed by `overflow-x: clip;` on the next line. Browsers that know `clip` use it; older ones (Safari < 16) ignore it and keep today's behaviour, so there is no regression. If an extra capture with the declaration removed entirely (`snap-D-removed`, rect-level proof as in D.4) shows no visible effect, prefer removal and say so.
 - If Phase B regenerated the deduped file (zero-diff proof), run `npm run build:css` to propagate the change into `styles.deduped.min.css` in the SAME commit. Check that cssnano did not drop the fallback declaration (if it did, use `clip` alone and note the old-Safari impact).
 - If Phase B took the frozen fallback (expected), the generated file cannot be touched, so apply the override in `app-theme.css` (hand-written, loaded after the deduped sheet on every page that has the dock): add `.container { overflow-x: clip; }` with a comment pointing to this task. Pages that do NOT load app-theme.css (index, register, intro, maintenance) keep the old behaviour; say so in CSS-README and in the report. `overflow-y` then computes `visible` everywhere app-theme.css loads. The hand-written `styles.css` blocks are edited too, so leaderboard and a future regeneration agree.
D.4 Proof (baseline = `TMP\snap-C-final`; because the default harness has no layout rects, FIRST extend a COPY: `tmp-css-snapshot.js` copy `tmp-css-snapshot-rects.js` adds `rect: [x,y,w,h]` rounded to 0.5px from `getBoundingClientRect()` for every element, plus `scrollHeight/clientHeight` of every `.container`; capture `TMP\snap-rects-before` BEFORE editing, `TMP\snap-rects-after` after):
 1. `tmp-css-compare.js TMP\snap-C-final TMP\snap-D --allow overflow-container` exits 0, and the plain compare shows only `.container` `overflow-x`/`overflow-y` cells.
 2. The rects comparison shows ZERO differences at 320x640, 375x812, 768x1024, 1024x768 on every page (all states).
 3. `npm run test:e2e -- no-horizontal-overflow` passes (it neutralises `html, body {overflow-x:hidden}` and asserts `scrollWidth <= clientWidth`; it must still pass with the container fix, which proves the container was not the only thing hiding overflow) plus the 4.3 canary.
 4. A manual-style check script: on each page at 375 wide, scroll to the bottom and assert `document.scrollingElement.scrollWidth === clientWidth` (no horizontal scrollbar introduced).
 If ANY rect, scroll size, sticky, or e2e difference appears that is not the intended computed overflow change, DROP Phase D: revert the commit (new revert commit if already committed), and report precisely why (which element, which viewport, which prop).
D.5 Commit: `fix(css): use overflow-x clip on .container` (CSS files only, nothing else), so `git revert <sha>` undoes it cleanly.

---------------------------------------------------------------------------------------------------

## 8. Finalisation

F.1 Service worker and cache busting (ONE commit, `chore: bump service worker cache and CSS versions`):
 - `public/sw.js` line 1: `prezenty-v125` -> `prezenty-v127`. Read `git show main:public/sw.js | Select-Object -First 1` and `git show refactor/split-recipients-1:public/sw.js | Select-Object -First 1`; if either is already >= v126 use `max(127, thatNumber + 1)`. Edit sw.js with a Node Buffer script that preserves CRLF/LF.
 - Bump `?v=N` -> `N+1` on every CSS file whose git blob bytes differ from `e939a28`: same N+1 on EVERY page that links it (`app-theme.css?v=14`, `bottom-tab-bar.css?v=42`, `filters.css?v=7`, `chat-reactions.css?v=3`, `aws-design.css?v=4` (recipients), `<page>-page.css?v=1`). Files linked without `?v` (`styles.css`, `styles.deduped.min.css`, `aws-design.css` on activity) are left unversioned: the server sends `no-cache` for CSS and the cache-name bump invalidates the service worker copy; record this decision. Do not touch link order.
 - Keep `urlsToCache` consistent: for each bumped `*-page.css`/`*-page*.css` that is precached with `?v=1`, update the precache string to the same new `?v=`; do not add or remove entries; leave pre-existing unversioned precache entries as they are. Validate with a Node check that every `urlsToCache` local entry exists on disk (strip the query) and appears exactly once, and `node --check public/sw.js`.
F.2 Full suite `npm test` (4.5) and final snapshot: `snap-final` vs `css-baseline` with `--allow overflow-container` only if D landed (expected diff set = D's only), otherwise plain (zero diffs). Run `tmp-css-transfer.js` (after) and compute 4.6 tables.
F.3 Write `W\.agents\tasks\css-consolidate-1-verification.md` with: result table (check / result), commits list (`git -P log --oneline e939a28..HEAD`), per-phase evidence (counts, zero-diff statements, e2e counts), B decision (regenerated or frozen, with the evidence numbers), leaderboard decision with evidence, bytes per CSS file before/after/gzip, transferred CSS for recipients.html and leaderboard.html before/after, rules removed per file (from css-dead-rules-removed.txt), D outcome (applied / dropped and why / variant used), sw.js and `?v=` changes, "Decisions needed" (stale deduped, pages without app-theme.css), "Not covered" (interactive states beyond the harness, non-Chromium, real SW behaviour, hover/focus), deviations. Commit: `docs(css): add CSS consolidation verification`.
F.4 Merge/finalize step (separate workflow step): remove temp tooling (untracked `tmp-css-*.js`; `git rm -r .agents/tasks/tmp-css-snapshot.js .agents/tasks/css-baseline`), delete `TMP`, `git worktree prune` any pristine worktree, verify `git -P status` clean and `git -P diff --stat bc8be84..HEAD` contains only: CSS files, `scripts/build-css.js`, `package.json`, `postcss.config.js`, `public/CSS-README.md`, `README.md` (1 line), `public/sw.js`, HTML `?v=` link edits (and the leaderboard href if switched), and the three docs. Check `tests/` diff is empty. Then report merge-readiness against `main` without touching it: `git merge-tree --write-tree main HEAD` (conflict list only) and note that the sibling branch touches sw.js/recipients files. Commit `chore(css): remove temporary CSS tooling`. No push.

---------------------------------------------------------------------------------------------------

## 9. Risks and how the plan contains them

| Risk | Containment |
|---|---|
| Regenerating the deduped file changes visible styles (very likely: stale + hand-patched) | B.5 proof; B.6 frozen fallback; nothing regenerated without zero diffs |
| Dynamically built class names missed by grep | strict token rule + dyn scanner + library corpus + attribute-selector substrings + coverage CONFLICT cross-check + REVIEW heuristics; unsure means KEEP |
| Snapshot harness only samples 35 props and a few states | cascade-safety proof for duplicates, rule-set equality check (`rulecheck`) for dead rules, e2e canary after each commit, full suite at the end; report as a limit |
| CRLF/LF churn making huge diffs or non-reproducible output | edit via Node preserving EOL; build script normalises to LF; compare after LF normalisation |
| `overflow-x: clip` loses the BFC (margin collapse, floats) and unlocks sticky | D.2 pre-checks, rect snapshots, drop rule |
| sw.js conflicts with the sibling branch | edit sw.js once, last; merge-tree report |
| Activity page clock noise | 4.4 re-baseline rule, never mask |

---------------------------------------------------------------------------------------------------

## 10. Workflow decomposition (FEAT files live in `P\.agents\tasks\task-css-consolidate\`)

FEAT-001 Phase A audit | FEAT-002 Phase B build and source of truth | FEAT-003 Phase C dead/duplicate rules | FEAT-004 Phase D overflow | FEAT-005 finalisation (sw.js, `?v=`, full e2e, metrics, verification report).
Then the convergence loop (fixer + reviewer, gate `P\.agents\tasks\css-review.json`, `verdict` = `APPROVED`) and the finalize/merge step (F.4).
