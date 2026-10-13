# Verification: extract inline CSS/JS from public/ pages (iteration 1)

Worktree `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\extract-inline-1`, branch `refactor/extract-inline-1`, base `91e02a6`.
Plan: `.agents/tasks/extract-inline-plan.md`. Nothing was pushed.

## Result

| Check | Result |
|---|---|
| Byte-level reassembly proof (`--verify --batch all`) | 12 of 12 pages byte-identical to the frozen originals; every new file SHA-256 equals the manifest |
| Computed styles, 26 snapshots (13 descriptors x 375x812 and 1024x768) | 0 differences against `before-1` (noise mask applied, 32 of 276,390 cells masked = 0.0116 %) |
| `document.styleSheets` (count, per-sheet rule count, per-sheet rules hash, media) | identical; only allowed change `STYLE`/null -> `LINK`/`/<name>.css?v=1` at the extracted indexes |
| Window globals (own names added by page scripts, `typeof`, function-source hashes, global lexical names) | identical (see "Deviations" for the CRLF note) |
| Console errors/warnings, pageerror, requestfailed, HTTP >= 400 | identical multiset after normalisation; 0 HTTP >= 400 in `after-final`; no 404 for any new file |
| New assets | 58 responses checked across the 26 snapshots (27 files), all `200`, CSS = `text/css; charset=UTF-8`, JS = `application/javascript; charset=UTF-8` |
| Full Playwright suite (`npm test`) | before: 121 passed, 11 skipped, 0 failed; after (final tree): 121 passed, 11 skipped, 0 failed |
| `tests/` modified | no (zero diff) |
| Forbidden paths (`routes lib server.js package.json package-lock.json tests`, `public/recipients.js formularz.js tab-bar-functions.js app-theme.css`) | `git diff --stat 91e02a6..HEAD` empty |
| Other `public/` files vs `orig\SHA256SUMS.json` | unchanged; only the 12 HTML files, `sw.js` and `postcss.config.js` differ |
| Service worker | `node --check` ok; 27 `'/<name>?v=1'` entries, each exactly once, all files exist; `prezenty-v124` 0x, `prezenty-v125` 1x; diff vs base = 28 added lines + 1 changed line (the cache name) |

## Commits (branch `refactor/extract-inline-1`)

```
c3276c2 chore: bump service worker cache to v125
8d9e887 chore: let PurgeCSS scan extracted page CSS
511df58 refactor: extract inline CSS/JS from 5 small pages   (osoby, archiwum, intro, rezerwacje, index; 10 files)
c684172 refactor: extract inline CSS/JS from 3 mid pages     (activity, wiadomosci, ustawienia; 6 files)
fd93635 refactor: extract inline CSS/JS from 4 big pages     (recipients, home, formularz, leaderboard; 11 files)
```

`git diff --name-status 91e02a6..HEAD`: 27 `A` (new files in `public/`), 12 `M` HTML, `M public/sw.js`, `M postcss.config.js`. Nothing else.

## What was run

1. Preflight: branch and HEAD correct, tree clean, Node v24.11.0, Playwright from the worktree, Edge present. Copied `tests\.cache` (20 CDN files, git-ignored) from the main workspace.
2. Froze the 12 HTML files, `sw.js`, `postcss.config.js` to `.agents/tasks/extract-inline-baseline/orig/` and wrote `SHA256SUMS.json` for all 57 files under `public/` plus `postcss.config.js`.
3. Wrote the temporary harness `.agents/tasks/tmp-extract-snapshot.js` (outside `tests/` and outside the worktree) and the extraction tool `tmp-extract-apply.js`. Both are deleted at the end.
4. Baseline: `capture --run before-1`, `before-2`, `mask`. Negative self-test: `capture --run selftest --pages recipients,index --inject-css "body{margin-left:1px!important}" --inject-js "window.__selftest=function(){}"` then `compare --a before-1 --b selftest` exited 1 and reported element-style, stylesheet-count/total-rules and added-global differences. A clean `compare --a before-1 --b before-2 --mask noise-mask.json` exited 0 (26 snapshots, 0 differences).
5. Baseline e2e: `npm test` -> `e2e-before.txt`: 121 passed, 11 skipped (the intentional `test.fixme`), 0 failed (9.5 min; the machine was also running another workflow's suite).
6. Tool rehearsal in `%TEMP%\extract-rehearsal` (27 files created, `--verify` exit 0, then one flipped byte in a new file made `--verify` exit 1). Directory deleted. `--dry-run` against the worktree printed 27 extractions and 11 keeps and wrote nothing.
7. Batches A, B, C applied with the tool, each followed by `--verify --batch X` (exit 0), `node --check` on every new `.js` (exit 0), `capture`+`compare` for the batch pages (0 differences), an e2e check and a commit:
   - A: `after-A`, full `npm test` -> `e2e-after-A.txt`: 121 passed, 11 skipped.
   - B: `after-B`, canary `npm run test:e2e -- smoke wrapping no-horizontal-overflow` -> `e2e-canary-B.txt`: 29 passed.
   - C: `after-C`, canary `npm run test:e2e -- smoke xss-usernames` -> `e2e-canary-C.txt`: 36 passed.
8. PurgeCSS glob and cache-name bump as separate commits (`--check-sw` printed `SW OK: all 27 entries present exactly once and files exist`).
9. Final tree: `--verify --batch all` (exit 0, `final-byte-proof.txt`), `capture --run after-final` + `compare --a before-1 --b after-final --mask noise-mask.json` (26 snapshots, 0 differences, `compare-after-final.txt`), full `npm test` -> `e2e-after.txt`: 121 passed, 11 skipped, 0 failed (7.7 min).

Evidence files (not committed, in `.agents/tasks/extract-inline-baseline/`): `before-1`, `before-2`, `after-A`, `after-B`, `after-C`, `after-final` snapshot folders, `noise-mask.json`, `compare-after-final.txt/.json`, `final-byte-proof.txt`, `e2e-before.txt`, `e2e-after-A.txt`, `e2e-after.txt`, `e2e-canary-B.txt`, `e2e-canary-C.txt`, `frozen/` (recorded API replies), `orig/`.

## Deviations from the plan, and why (all in the measuring harness, none in the product)

- **Frozen API replies and shifted clock.** Two identical captures ten minutes apart disagreed on `activity` (359 vs 335 elements): the demo notifications are created relative to server start and the page groups them by calendar day, and the run happened close to midnight (Warsaw). The plan says to fix the wait, not mask, when element counts differ, but no wait can fix data that changes with the wall clock. So the harness records every `GET /api/*` reply once (`frozen/`, recorded in the first baseline run) and replays it in every later run, and a context init script offsets `Date` so "now" is the recording moment (time still flows; it is not frozen). The page code, the static files and every non-GET request are untouched and still hit the real server. This makes before and after use identical data.
- **Function-source hashes ignore CRLF.** The HTML parser turns CRLF into LF inside inline scripts, but an external script keeps CRLF, so `Function.prototype.toString` differs by `\r` alone (first compare showed 134 such differences). The hash is taken after `\r\n` -> `\n`. This cannot change behaviour: JS treats CRLF as one line terminator and normalises it in template literals. The baseline was re-captured with this hashing from a pristine copy of the original tree (`%TEMP%\extract-orig`: worktree minus `.git`/`node_modules`, the 4 batch-A HTML files and `sw.js` restored from `orig/`, new files removed, all 57 `public/` hashes checked against `SHA256SUMS.json`; deleted afterwards).
- **Console noise.** Stack-frame lines are dropped (file names and line numbers legitimately change), `requestfailed ... net::ERR_ABORTED` is ignored (races with navigation), and on `home` the `TypeError: Failed to fetch` errors that follow from the page's own one-shot reload are ignored. `class` values are compared with whitespace collapsed and the transient `appearing` animation token removed (both varied between two baseline runs, 5 cells in `recipients`).
- **Noise mask size.** 32 of 276,390 style cells (0.0116 %); the largest share is `index@1024x768` at 0.092 %. No snapshot is above 0.1 %.
- The first PowerShell attempt to edit `postcss.config.js` and `sw.js` failed on quoting and changed nothing; both were redone with a small Node script using Buffer I/O (no encoding or line-ending change).
- Another workflow (`harden-server-1`) was running its own Playwright suite on this machine during some of the runs. Each suite boots its own server on a free port, so there was no interference, only longer run times.

## HTML sizes (bytes)

| Page | Before | After | Moved out |
|---|---|---|---|
| recipients.html | 118562 | 47754 | 70808 |
| home.html | 79698 | 34894 | 44804 |
| formularz.html | 75667 | 31176 | 44491 |
| leaderboard.html | 59142 | 17559 | 41583 |
| activity.html | 45697 | 13743 | 31954 |
| wiadomosci.html | 41494 | 13494 | 28000 |
| ustawienia.html | 40663 | 15075 | 25588 |
| osoby.html | 24441 | 5000 | 19441 |
| archiwum.html | 17471 | 4820 | 12651 |
| intro.html | 24096 | 8425 | 15671 |
| rezerwacje.html | 19688 | 9862 | 9826 |
| index.html | 15892 | 6749 | 9143 |
| Total | 562511 | 208551 | 353960 |

(The 27 files total 354,838 B; the difference to 353,960 B is the 12 page replacement tags that remain in the HTML.)

## New files (27, all in `public/`, all referenced as `?v=1`, all in `urlsToCache`)

recipients-page.css 29568, recipients-page.js 35399, recipients-page-notifbell.js 3262, recipients-page-scroll.js 2722,
home-page.css 5435, home-page-auth.js 4951, home-page.js 34502,
formularz-page.css 13852, formularz-page-edit.css 30720,
leaderboard-page.css 23853, leaderboard-page.js 17800,
activity-page.css 8265, activity-page.js 23753,
wiadomosci-page.css 6299, wiadomosci-page.js 21769,
ustawienia-page.css 1854, ustawienia-page.js 23802,
osoby-page.css 1741, osoby-page.js 17758,
archiwum-page.css 2741, archiwum-page.js 9974,
intro-page.css 8851, intro-page.js 6878,
rezerwacje-page.css 2425, rezerwacje-page.js 7469,
index-page-pwa.js 2908, index-page.js 6287.

Kept inline as decided in the plan: home script #1 (cache purge guard) and #8 (`SKIP_RECIPIENTS_INIT`), the 388/390 B critical notification-panel styles on recipients/formularz/leaderboard/activity, and the small `toggleSidebar`/`logout` snippets.

## Not covered (honest limits)

Interactive states (open modals, composer, edit sheet), real service-worker behaviour (blocked in the suite; verified statically only), non-Chromium engines, and server-side regeneration of `styles.deduped.min.css` with PurgeCSS (the glob line was added but a rebuild was not run). The byte proof plus the CSS-rule hashes cover style and script content for those cases.
