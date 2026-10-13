# Verification: CSS consolidation (iteration 1)

Worktree `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\css-consolidate-1`, branch `refactor/css-consolidate-1`, base `e939a28` (snapshot baseline commit; product base `bc8be84`).
Plan: `.agents/tasks/css-plan.md`. Audit: `.agents/tasks/css-audit.md`. Removed rules: `.agents/tasks/css-dead-rules-removed.txt`. Nothing was pushed, no CR was raised.

## Result

| Check | Result |
|---|---|
| Final 14-page snapshot (`snap-final`, 4 viewports, 56 files) vs `css-baseline` (plain compare) | 56 files, 0 differing cells, exit 0 |
| Leaderboard extra states (11 states x 4 viewports, `snap-lb-final` vs `snap-lb-before`) | 0 differences (464,419 cells per viewport), exit 0 |
| Full Playwright suite, run 1 (`npm test`, final tree) | 120 passed, 1 failed, 11 skipped (7.9 min); the failure is `no-horizontal-overflow` "home does not scroll sideways" with `page.goto: net::ERR_ABORTED` (see "E2E" below) |
| Same spec rerun alone | 10 passed, 0 failed |
| Full Playwright suite, run 2 (`npm test`, final tree) | **121 passed, 0 failed, 11 skipped** (8.6 min), identical to the reference |
| Reference (FEAT-001, untouched `e939a28`) | 121 passed, 0 failed, 11 skipped (7.0 min) |
| Phase B (single source of truth) | build script + docs added; regenerated deduped file REJECTED, committed file stays FROZEN (byte-identical to `e939a28`) |
| Leaderboard decision | switched to `styles.deduped.min.css` (one href), 0 diffs |
| Phase C (dead + duplicate rules) | 1,993 rules removed from 8 hand-written files, 335,678 B saved, rulecheck exit 0 per file, 0 snapshot diffs |
| Phase D (`.container` `overflow-x: clip`) | DROPPED: 1,620 differing layout cells (content moves 6 to 32 px) |
| `node --check public/sw.js` | ok; `CACHE_NAME` appears once: `prezenty-v128`; 40 `urlsToCache` entries, 40 unique, every local entry exists on disk |
| `tests/` and `package-lock.json` diff `e939a28..HEAD` | empty |
| `public/styles.deduped.min.css` diff `e939a28..HEAD` | empty |
| `<link>` order | unchanged on every page; the only HTML edits are `?v=` values plus one `href` on `leaderboard.html` |

## Commits (`git -P log --oneline e939a28..HEAD`, oldest last)

```
7687a25 chore: bump service worker cache and CSS versions
7ef3839 docs(css): record removed CSS rules
095d644 refactor(css): remove dead rules from styles
7ca3fcf refactor(css): remove dead rules from aws-design
d7ec9f9 refactor(css): remove dead rules from recipients-page
b57a75a refactor(css): remove dead rules from leaderboard-page
0393ccf refactor(css): remove dead rules from formularz-page
1cbbe3a refactor(css): remove dead rules from activity-page
7ae5863 refactor(css): remove dead rules from filters
33c0f7c refactor(css): drop dead rules in bottom-tab-bar
bdc0199 perf(css): load deduped CSS on leaderboard page
1aac802 docs(css): document CSS sources and generated files
ae89390 build(css): add reproducible CSS build script
e2cc2a4 docs(css): add stylesheet audit and coverage report
```

Each Phase C file is its own commit, so any one of them (and the leaderboard switch `bdc0199`) can be reverted alone. A verification-report commit follows this file.

## Evidence per phase

### A. Audit (e2cc2a4, no CSS change)
- `snap-A0` vs `css-baseline`: 56 files, 0 diffs (activity included, no clock re-baseline needed). Baseline e2e on `e939a28`: 121 passed, 0 failed, 11 skipped.
- `styles.css`: 2,312 rules, 17,641 lines, 437,177 B on disk (CRLF), 1,770 exact duplicate rules (300,509 B of 419,525 B LF).
- Edge coverage (375x812 + 1024x768, 30 runs, 0 errors): `styles.css` 5,872 of 437,177 B used; `styles.deduped.min.css` 20,905 of 40,148; `aws-design.css` 25,600 of 114,692 (77.7 % unused); all local CSS 171,294 of 793,263 B used.
- `styles.deduped.min.css` is a hand-patched derivative of an old build, not reproducible (details in B).
- Defect found and left alone: `public/styles.css` has a truncated `.profile-picture-placeholder` rule that makes the following `:root{...}` block a nested rule that never matches (same in the deduped file). Effective `--ios-success` is `#34c759`, not the `#00693E` written in the nested block.

### B. Reproducible build and leaderboard (ae89390, 1aac802, bdc0199)
- Added `scripts/build-css.js` (`npm run build:css` writes to git-ignored `build/css/`, `npm run build:css:check` prints drift), widened `postcss.config.js` content globs and added a PurgeCSS safelist of patterns from the dynamic-class scanner, added `public/CSS-README.md` and one line in `README.md`.
- Regenerated vs committed deduped file: rebuild is deterministic (37,758 B LF, sha256 `02bd3211...a4`), committed blob 40,111 B (sha256 `eb22c6e6...2b18`). Rules (keyframe steps included): committed 399, rebuild 380; identical 326, changed declarations 14, only in committed 59, only in rebuild 40.
- **B decision with numbers: FROZEN.** Copying the rebuild over `public/styles.deduped.min.css` and comparing with `css-baseline` gave 56 files and 1,129 differing cells (exit 1). Pages with diffs: archiwum 104, formularz 84, home 4, osoby 4, recipients 718, ustawienia 126, wiadomosci 89; zero on activity, index, intro, leaderboard, maintenance, register, rezerwacje. First diff: `#archiveYearSelect.form-select` padding `6px 36px 6px 12px` -> `14px 20px`, radius `6px` -> `16px`, border `1px` -> `2px`. The file was restored; `build-css.js` has `FROZEN=true` and refuses to write the public file without `--force`.
- **Leaderboard decision: switched** from raw `styles.css` to `styles.deduped.min.css`. Evidence: leaderboard-only harness (4 viewports x 11 states: base, scrolled-bottom, sidebar-open, tabbar-menu-open, notifications-panel-open, hover-podium, hover-ranking-card, hover-tab-item, empty, error, loading; ~650 elements, 90 computed properties + rect each). Untouched-tree capture is deterministic (0 diffs between two captures). Swapping the deduped file in via request routing: 0 diffs; after the real edit: 0 diffs; full 14-page harness after the switch: 56 files, 0 diffs. Canary `smoke wrapping no-horizontal-overflow a11y`: 39 passed, 10 skipped. Caveat: only demo-server data was exercised.

### C. Dead and duplicate rules (33c0f7c .. 7ef3839)
Removal rules: DEAD = every class/id token of every selector is absent from the whole corpus (public, server, routes, lib, scripts, tests, cached Bootstrap/Font Awesome/Remixicon, dynamic prefixes/suffixes/infixes); DUP = exact earlier duplicate with identical context chain, selector and declarations (last copy kept). Untouched by policy: `@font-face`, `@keyframes`, `:root`/`html`/`body`, class/id attribute selectors, nested rules, anything with any used token. Coverage cross-check: 0 conflicts. Unsure means KEEP.

| File | Rules removed | DEAD | DUP | Bytes saved (LF blobs) |
|---|---:|---:|---:|---:|
| styles.css | 1,854 | 164 | 1,690 | 317,340 |
| aws-design.css | 103 | 96 | 7 | 13,197 |
| filters.css | 27 | 27 | 0 | 3,262 |
| recipients-page.css | 3 | 3 | 0 | 577 |
| formularz-page.css | 2 | 2 | 0 | 420 |
| bottom-tab-bar.css | 2 | 2 | 0 | 381 |
| activity-page.css | 1 | 1 | 0 | 307 |
| leaderboard-page.css | 1 | 1 | 0 | 194 |
| **Total** | **1,993** | **296** | **1,697** | **335,678** |

`chat-reactions.css`, `app-theme.css` and the other `*-page.css` files had no candidates and are byte-identical. The full per-rule list (selector, line, size, context) is `css-dead-rules-removed.txt`.

Proof per CSS commit: `tmp-css-rulecheck` (after = before minus approved rules, ordered signatures, pure line deletion, a surviving later copy for every DUP) exit 0; targeted snapshot of every page that loads the file = 0 diffs against `css-baseline`; canary `smoke wrapping no-horizontal-overflow a11y` = 39 passed, 10 skipped. Final full 14-page snapshot after Phase C: 0 diffs.

`styles.css` caveat: since the leaderboard switch no page links it, so the normal compare is vacuous for it. Extra proof: a raw-swap harness serves `styles.css` bytes in place of the deduped file (sanity: swapping the unedited file in differs from baseline by 163 cells on recipients@375). Unedited vs edited `styles.css`, 14 pages x 4 viewports: 56 files, 0 diffs.

Kept and reported only (not removed): 1,015 rules / 150,183 B that are uncovered in the Edge run but fail the static criterion (aws-design 372, styles 439, recipients-page 34, bottom-tab-bar 34, filters 37, other files 99). Unreferenced `@keyframes` (filters `highlightPulse`; aws-design `pulse-notification`, `spinner-rotate`, `dropdown-slide-in`, `fade-out`) are reported, never removed.

### D. `.container { overflow-x: hidden }` -> `clip`: DROPPED (nothing committed)
`overflow-x: clip` removes the block formatting context that `overflow: hidden` gave `.container`, so first/last child margins now escape and collapse. A rect-level snapshot (14 pages x 4 viewports, states, scrolled-bottom, plain compare) had 1,620 differing cells. Clean at all viewports: activity, archiwum, index, intro, maintenance, recipients, register, rezerwacje. Differences on formularz, home, leaderboard, osoby, ustawienia, wiadomosci, for example: osoby@375x812 document height 2489 -> 2469 px; ustawienia@375x812 1558 -> 1538; wiadomosci@375x812 995 -> 975; home@375x812 `.container` shifted down 6 px; leaderboard@375x812 shifted down 15 px; formularz `.container` height 1535 -> 1503 px. This is a visible change, so the hard rule applies. The sticky check was clean but moot (0 `position:sticky` elements anywhere). Because D is not applied, the final compare above is plain (not `--allow overflow-container`) and has 0 diffs.

## Final E2E

Command: `npm test` on `7687a25` (service worker + `?v=` bump included), output `%TEMP%\css-consolidate-1\e2e-after.txt` and `e2e-after-2.txt`.

- Run 1: 120 passed, 1 failed, 11 skipped (7.9 min). The one failure was `no-horizontal-overflow.spec.js:22` "home does not scroll sideways at any width": `page.goto: net::ERR_ABORTED at http://127.0.0.1:<port>/` after 2.5 s, a navigation race, not an assertion about layout. The same spec rerun alone: 10 passed, 0 failed.
- Run 2 (full suite again, nothing changed in between): 121 passed, 0 failed, 11 skipped (8.6 min). The 11 skipped are the intentional `test.fixme` tests, same as the reference.
- `tests/` is unmodified, so the counts are directly comparable with the `e939a28` reference (121 / 0 / 11).

## Bytes per CSS file (git blob sizes, LF; `e939a28` vs `HEAD`; gzip level 6 and brotli default computed from the same blobs)

| File | Before B | After B | Delta B | Delta % | gzip before | gzip after | br before | br after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| activity-page.css | 7,999 | 7,692 | -307 | -3.8% | 1,826 | 1,785 | 1,469 | 1,434 |
| app-theme.css | 13,900 | 13,900 | 0 | 0.0% | 3,933 | 3,933 | 3,309 | 3,309 |
| archiwum-page.css | 2,667 | 2,667 | 0 | 0.0% | 845 | 845 | 682 | 682 |
| aws-design.css | 110,013 | 96,816 | -13,197 | -12.0% | 16,555 | 14,943 | 13,526 | 12,286 |
| bottom-tab-bar.css | 25,257 | 24,876 | -381 | -1.5% | 5,811 | 5,767 | 4,907 | 4,852 |
| chat-reactions.css | 11,633 | 11,633 | 0 | 0.0% | 3,616 | 3,616 | 3,042 | 3,042 |
| filters.css | 12,393 | 9,131 | -3,262 | -26.3% | 2,709 | 2,219 | 2,304 | 1,852 |
| formularz-page.css | 13,411 | 12,991 | -420 | -3.1% | 2,846 | 2,797 | 2,387 | 2,348 |
| formularz-page-edit.css | 30,022 | 30,022 | 0 | 0.0% | 7,836 | 7,836 | 6,679 | 6,679 |
| home-page.css | 5,272 | 5,272 | 0 | 0.0% | 1,566 | 1,566 | 1,292 | 1,292 |
| intro-page.css | 8,506 | 8,506 | 0 | 0.0% | 1,550 | 1,550 | 1,282 | 1,282 |
| leaderboard-page.css | 22,967 | 22,773 | -194 | -0.8% | 3,983 | 3,959 | 3,328 | 3,310 |
| osoby-page.css | 1,695 | 1,695 | 0 | 0.0% | 590 | 590 | 454 | 454 |
| recipients-page.css | 28,784 | 28,207 | -577 | -2.0% | 5,545 | 5,470 | 4,620 | 4,561 |
| rezerwacje-page.css | 2,366 | 2,366 | 0 | 0.0% | 734 | 734 | 588 | 588 |
| styles.css | 419,537 | 102,197 | -317,340 | -75.6% | 26,032 | 12,614 | 10,737 | 9,534 |
| styles.deduped.min.css | 40,111 | 40,111 | 0 | 0.0% | 6,697 | 6,697 | 5,923 | 5,923 |
| ustawienia-page.css | 1,810 | 1,810 | 0 | 0.0% | 631 | 631 | 487 | 487 |
| wiadomosci-page.css | 6,148 | 6,148 | 0 | 0.0% | 1,805 | 1,805 | 1,483 | 1,483 |
| **Total (19 files)** | 764,491 | 428,813 | -335,678 | -43.9% | 95,110 | 79,357 | 68,499 | 65,398 |

Notes: `styles.css` is no longer linked by any page (the leaderboard was the last one); it only feeds `npm run build:css`. Its 317,340 B reduction therefore changes no byte served to users. Bytes actually served change through `aws-design.css` (-12.0 %), `filters.css` (-26.3 %) and the small page files.

## Total local CSS transferred (`tmp-css-transfer.js`, 375x812, cold cache, service worker blocked, server compression negotiated = brotli)

| Page | Metric | Before | After | Delta |
|---|---|---:|---:|---:|
| recipients.html (6 local sheets) | decoded | 237,999 B | 219,743 B | -18,256 B (-7.7 %) |
| | transferred (br) | 43,940 B | 41,379 B | -2,561 B (-5.8 %) |
| | gzip level 6 | 41,509 B | 39,267 B | -2,242 B (-5.4 %) |
| leaderboard.html (4 local sheets) | decoded | 501,598 B | 103,976 B | -397,622 B (-79.3 %) |
| | transferred (br) | 28,649 B | 21,478 B | -7,171 B (-25.0 %) |
| | gzip level 6 | 40,335 B | 20,462 B | -19,873 B (-49.3 %) |

Per sheet after: recipients `styles.deduped.min.css` 40,148 decoded / 7,213 br; `aws-design.css?v=5` 100,848 / 16,106 (was `?v=4` 114,692 / 17,994); `bottom-tab-bar.css?v=43` 25,773 / 6,040 (was 26,165 / 6,080); `filters.css?v=8` 9,599 / 2,302 (was 13,023 / 2,858); `app-theme.css?v=14` unchanged 14,403 / 4,060; `recipients-page.css?v=2` 28,972 / 5,658 (was 29,568 / 5,735). Leaderboard after: `styles.deduped.min.css` 40,148 / 7,213 (replaces `styles.css` 437,177 decoded / 14,333 br); `bottom-tab-bar.css?v=43`; `leaderboard-page.css?v=2` 23,652 / 4,165 (was 23,853 / 4,176); `app-theme.css?v=14`. (Transfer sizes are served bytes on disk, CRLF working tree; the table above is LF blobs, so they differ by about one byte per line.) CDN sheets (Bootstrap, Font Awesome, Remixicon) are unchanged and not included; they add about 445,515 B decoded on recipients (the harness serves them from the local CDN cache, so their transferred size equals the decoded size here and real CDN numbers would be smaller).

Reading the numbers: the real win is decoded/parsed CSS (leaderboard -79 %, recipients -7.7 %) and maintainability, not wire bytes. With brotli the raw `styles.css` was already small on the wire (14,333 B), so the leaderboard saves 7.2 kB, not 400 kB.

## Service worker and `?v=` changes (commit 7687a25)

- `public/sw.js`: `CACHE_NAME` `prezenty-v125` -> `prezenty-v128`. `main` is already `prezenty-v127` (the sibling split-recipients work was merged there as v126/v127; the branch `refactor/split-recipients-1` no longer exists), so the target is `max(127, 127 + 1) = 128`.
- `?v=` bumped on every page that links a changed file, link order untouched:

| File | Old -> new | Pages edited |
|---|---|---|
| bottom-tab-bar.css | 42 -> 43 | activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci |
| filters.css | 7 -> 8 | recipients |
| aws-design.css | 4 -> 5 | recipients |
| activity-page.css | 1 -> 2 | activity (+ precache) |
| formularz-page.css | 1 -> 2 | formularz (+ precache) |
| leaderboard-page.css | 1 -> 2 | leaderboard (+ precache) |
| recipients-page.css | 1 -> 2 | recipients (+ precache) |

- `urlsToCache`: four precache strings follow the HTML (`/recipients-page.css?v=2`, `/leaderboard-page.css?v=2`, `/formularz-page.css?v=2`, `/activity-page.css?v=2`); no entry added or removed. The diff is 19 changed lines in 9 files (`sw.js` 5, HTML 14), EOL preserved.
- Left unversioned on purpose: `styles.deduped.min.css` (frozen, bytes unchanged), `aws-design.css` on `activity.html` (no `?v`), `styles.css` (not linked), `tab-bar-demo.html` (links `bottom-tab-bar.css` without `?v`, demo page not in scope). The server sends `Cache-Control: no-cache` for CSS and the cache-name bump drops the old service worker cache, so unversioned links revalidate.
- Unchanged files keep their version: `app-theme.css?v=14`, `chat-reactions.css?v=3`, remaining `*-page.css?v=1`.
- Merge note: `git merge-tree --write-tree --name-only main HEAD` reports one conflict, `public/sw.js` (main changed line 1 to v127 and added recipients script precache entries). Resolve by taking main's `sw.js` and re-applying: `CACHE_NAME` = `max(main) + 1` (128 now, higher if main moved) and the four `?v=2` precache strings. HTML files auto-merge (home, recipients, wiadomosci).

## Decisions needed

1. **Source of truth for the deduped file.** `styles.deduped.min.css` (what 12 pages load) is stale and hand-patched; a clean rebuild changes 1,129 snapshot cells (forms, modals, `.btn-success`, `.alert-success`, `.badge`, `.present-item`, `.login-*`, `.list-group`, `@keyframes slideDown`). Options: (a) keep it frozen and edit it by hand (status quo, `build:css` stays a diagnostic); (b) fix the source so a rebuild matches (needs a rule-by-rule port of the 59 only-in-committed rules, including the `.form-control`/`.form-select` rules the archiwum diff exposes), then switch with the snapshot proof; (c) retire `styles.css` and make the deduped file the only source. Drift report: `%TEMP%\css-consolidate-1\drift-report-new.txt` (rules: committed 399, built 380, identical 326, changed 14, only-committed 59, only-built 40). Head of the regen compare: 1,129 differing cells, first `archiwum@1024x768 ... #archiveYearSelect.form-select padding: 6px 36px 6px 12px -> 14px 20px`, then background-color, background-image, border, radius and font-size.
2. **`styles.css` has no consumer.** After the leaderboard switch it is only a build input and 102,197 B. Decide whether to keep it (as the source for option b) or delete it with option c.
3. **`.container` overflow (Phase D).** Not applied. If the unwanted `overflow-y: auto` / scroll-container side effect matters, a BFC-preserving variant such as `display: flow-root` plus `overflow-x: clip` would need its own rect proof; it is a product decision (it is not a pure no-op). Pages without `app-theme.css` (index, register, intro, maintenance) would not get an override placed there, so the override variant would need `styles.css` and the frozen deduped file, which is why it was not pursued.
4. **Truncated `.profile-picture-placeholder` rule** (`styles.css` ~5643-5648, same in the deduped file): the following `:root` block is nested and ineffective, so `--ios-success` is `#34c759` in practice. Fixing it would change colours; deliberately left.
5. **Service worker precache gaps (reported, not changed):** recipients requests `aws-design.css?v=5` but the precache has `/aws-design.css`; wiadomosci requests `chat-reactions.css?v=3` but the precache has `/chat-reactions.css`; `bottom-tab-bar.css`, `app-theme.css`, `filters.css`, remixicon and Font Awesome 6.4.0 are not precached; the worker is cache-first without `ignoreSearch`. Adding entries changes offline behaviour, so it is a separate decision.
6. **Merge order.** Resolve the `public/sw.js` conflict against `main` as described above and re-check `main`'s cache name right before merging.

## Not covered

- Interactive states beyond the harness: the snapshot harness samples 35 properties per element in base state per page/viewport plus the leaderboard's 11 extra states (90 properties); hover, focus, active and animation states elsewhere, and states needing data the demo server does not create (ties, very long names, missing avatars, archiwum/rezerwacje list items, home sidebar button), are not compared.
- Only Chromium (Edge 155) was used; Firefox and Safari were not run.
- Real service worker behaviour (install, activate, cache eviction, offline) was not exercised; e2e blocks service workers. Only `node --check` and the precache/disk consistency check were run.
- Coverage-based "used" figures come from two viewports (375x812, 1024x768) and the e2e-spec interactions; rules unused there were only removed when the static criterion also failed.
- Production deploys (Docker, Render, Vercel) were not run; none builds CSS, so only committed files matter.
- The Phase C proof for `styles.css` rests on the rule-level check and the raw-swap harness, not on any page that loads it today.

## Deviations from the plan, and why

- **Cache name 128, not 127.** The plan's rule `max(127, main + 1)` applies: `main` is at `prezenty-v127`. The sibling branch name in the plan no longer exists locally (merged into `main`).
- **FEAT-004 / Phase D dropped** (above), so the final compare is plain, not `--allow overflow-container`.
- **B regeneration not applied** (frozen fallback, expected by the plan), and the leaderboard was switched to the deduped file based on the leaderboard-only harness plus the full harness.
- **Extra proof tools.** A leaderboard-only harness (`tmp-css-snapshot-lb.js`), a raw-swap harness for `styles.css` and a rect-level harness for D were added (untracked, `tmp-css-*.js`). The temporary tooling and `css-baseline` are still present and are removed in the finalize step.
- **Flaky E2E.** Run 1 had one `net::ERR_ABORTED` on `page.goto('/')` of the home page in `no-horizontal-overflow`; the same flake hit unrelated canaries in Phase C (home, not affected by the edited files) and was green on rerun each time. The final CSS state is covered by the second full run.
- Console tool quirk: long PowerShell commands lost output, so heavy steps wrote to files under `%TEMP%\css-consolidate-1` and were read back; no effect on results.

## Evidence files (not committed, `%TEMP%\css-consolidate-1`)

`snap-final` (+`cmp-final.txt`), `snap-lb-final` (+`cmp-lb-final.txt`), `snap-C-final`, `snap-A0`, `snap-B`, `snap-B-regen` (+`cmp-B-regen.txt`), `snap-lb-before`, `snap-raw-before/after`, `snap-rects-before/after` (+`cmp-rects.txt`, `D-dropped-evidence.txt`), `transfer-before.json`, `transfer-after.json`, `bytes-full.json`, `e2e-before.txt`, `e2e-after.txt`, `e2e-after-2.txt`, `e2e-after-rerun-nho.txt`, `drift-report-new.txt`, `mergetree.txt`, `coverage.json`, `candidates.md`.
